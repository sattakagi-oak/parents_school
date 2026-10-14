// 無料講座（Zoom）の申込とリマインド。
//
//   相手「無料講座に申し込む」（告知のボタン）→ ご案内＋日時ボタン（reply）
//   日時タップ → 申込を保存 → 申込完了＋日程変更ボタン（reply）
//   「日程を変更する」→ 日時ボタン（reply）→ 選び直しで上書き
//   リマインド（push・申込者だけ・1回の種類ごとに1回）:
//     day_before  前日20時台（Vercel Cron 1日1回）
//     morning     当日朝8時台（Vercel Cron 1日1回）
//     hour_before 開始1時間前（10分おきのCron。Vercel Pro のときのみ設定）
//   前日リマインドの時刻を過ぎてから申し込んだ人には、申込完了メッセージに Zoom 情報を入れる。
//
// WEBINAR_ENABLED=true にするまでは、申込受付・リマインドともテスト用ユーザーだけ（本番の友だちには何もしない）。

import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { webinarOpen, zoomConfig, isTestUser } from './config.js';
import { pushMessage } from './line.js';
import { upsertUser, recordEvent } from './users.js';
import { replyUntracked } from './delivery.js';
import {
  WEBINAR, WEBINAR_CLOSED, webinarSession, webinarStartMessages, webinarSessionMessage,
  webinarCompleteMessages, webinarReminderMessages,
} from './messages.js';
import { log, errorSummary } from './log.js';

const HOUR = 3_600_000;

// 現在時刻（テストで差し替えられるように）
let clock = () => new Date();
export function setClockForTest(fn) {
  clock = fn || (() => new Date());
}
export const REMINDER_KINDS = ['day_before', 'morning', 'hour_before'];
const SENT_COLUMN = { day_before: 'day_before_sent_for', morning: 'morning_sent_for', hour_before: 'hour_before_sent_for' };

/** 日本時間で「開催日の n 日前の h 時」 */
function jstAt(startIso, daysBefore, hour) {
  const date = startIso.slice(0, 10); // 'YYYY-MM-DD'（start は +09:00 表記）
  const base = new Date(`${date}T00:00:00+09:00`).getTime();
  return new Date(base - daysBefore * 24 * HOUR + hour * HOUR);
}

/** 各リマインドの送信開始時刻 */
export function reminderTimes(session) {
  return {
    day_before: jstAt(session.start, 1, 20),
    morning: jstAt(session.start, 0, 8),
    hour_before: new Date(new Date(session.start).getTime() - HOUR),
  };
}

/** その種類のリマインドを今送ってよいか（送り損ねても、意味が変わる時間帯には送らない） */
export function isReminderDue(kind, session, now) {
  const t = reminderTimes(session);
  const start = new Date(session.start);
  if (now >= start) return false;
  if (kind === 'day_before') return now >= t.day_before && now < t.morning;
  if (kind === 'morning') return now >= t.morning && now < t.hour_before;
  return now >= t.hour_before;
}

export function availableSessions(now = clock()) {
  return WEBINAR.sessions.filter((s) => new Date(s.start) > now);
}

async function canUse(lineUserId) {
  return webinarOpen() || isTestUser(lineUserId);
}

async function getRegistration(lineUserId) {
  const { rows } = await getDb().query(
    'select * from parent_webinar_registrations where line_user_id = $1 and webinar_key = $2',
    [lineUserId, WEBINAR.key]);
  return rows[0] || null;
}

/** 「無料講座に申し込む」/「日程を変更する」。対象外なら null（通常メッセージとして扱う） */
export async function handleWebinarStart(lineUserId, replyToken, { changing = false, now = clock() } = {}) {
  if (!(await canUse(lineUserId))) return null;
  await upsertUser(lineUserId);
  const sessions = availableSessions(now);
  if (!sessions.length) {
    await replyUntracked(lineUserId, replyToken, [{ type: 'text', text: WEBINAR_CLOSED }], 'webinar:closed');
    return 'webinar_closed';
  }
  await recordEvent(lineUserId, changing ? 'webinar_change_start' : 'webinar_start');
  const messages = changing ? [webinarSessionMessage(sessions, { changing: true })] : webinarStartMessages(sessions);
  await replyUntracked(lineUserId, replyToken, messages, changing ? 'webinar:change' : 'webinar:start');
  return changing ? 'webinar_change' : 'webinar_start';
}

/** 日時ボタン */
export async function handleWebinarSession(lineUserId, replyToken, sessionId, { now = clock() } = {}) {
  if (!(await canUse(lineUserId))) return 'webinar_not_open';
  const session = webinarSession(sessionId);
  if (!session || new Date(session.start) <= now) {
    // 終了した回・不正な値 → 受付中の回を出し直す
    const sessions = availableSessions(now);
    const messages = sessions.length ? [webinarSessionMessage(sessions)] : [{ type: 'text', text: WEBINAR_CLOSED }];
    await replyUntracked(lineUserId, replyToken, messages, 'webinar:reask');
    return 'webinar_invalid_session';
  }

  await upsertUser(lineUserId);
  const before = await getRegistration(lineUserId);
  const changed = Boolean(before && before.session_id !== session.id);

  // 前日リマインドの時刻を過ぎてからの申込 → 完了メッセージに Zoom 情報を入れ、過ぎた分のリマインドは送信済み扱い
  const t = reminderTimes(session);
  const zoom = zoomConfig();
  const late = now >= t.day_before && zoom;
  const sentFor = (time) => (late && now >= time ? session.id : null);

  await getDb().query(
    `insert into parent_webinar_registrations
       (line_user_id, webinar_key, session_id, day_before_sent_for, morning_sent_for, hour_before_sent_for)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (line_user_id, webinar_key) do update
       set session_id = excluded.session_id,
           session_changed_at = case when parent_webinar_registrations.session_id <> excluded.session_id
                                     then now() else parent_webinar_registrations.session_changed_at end,
           day_before_sent_for = coalesce(excluded.day_before_sent_for, parent_webinar_registrations.day_before_sent_for),
           morning_sent_for = coalesce(excluded.morning_sent_for, parent_webinar_registrations.morning_sent_for),
           hour_before_sent_for = coalesce(excluded.hour_before_sent_for, parent_webinar_registrations.hour_before_sent_for),
           updated_at = now()`,
    [lineUserId, WEBINAR.key, session.id, sentFor(t.day_before), sentFor(t.morning), sentFor(t.hour_before)],
  );
  await recordEvent(lineUserId, changed ? 'webinar_changed' : 'webinar_registered', { session: session.id, late: Boolean(late) });

  const messages = webinarCompleteMessages(session, {
    changed,
    zoom: late ? zoom : null,
    morningStillComing: now < t.morning,
  });
  await replyUntracked(lineUserId, replyToken, messages, changed ? 'webinar:changed' : 'webinar:registered');
  return changed ? `webinar_changed:${session.id}` : `webinar_registered:${session.id}`;
}

/**
 * リマインド送信（Cron から呼ぶ）。申込者だけに、種類ごと・回ごとに1回だけ push。
 * WEBINAR_ENABLED が true でなければテスト用ユーザーだけ。
 */
export async function runWebinarReminders(kind, { now = clock() } = {}) {
  if (!REMINDER_KINDS.includes(kind)) throw new Error('invalid reminder kind');
  const counts = {};
  const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
  const zoom = zoomConfig();
  if (!zoom) return { kind, open: webinarOpen(), results: { held_missing_zoom: 1 } };

  const column = SENT_COLUMN[kind];
  const { rows } = await getDb().query(
    `select r.* from parent_webinar_registrations r
       join parent_line_users u on u.line_user_id = r.line_user_id
      where r.webinar_key = $1 and u.blocked_at is null
        and r.${column} is distinct from r.session_id`,
    [WEBINAR.key]);

  for (const reg of rows) {
    const session = webinarSession(reg.session_id);
    if (!session || !isReminderDue(kind, session, now)) { bump('not_due'); continue; }
    if (!webinarOpen() && !(await isTestUser(reg.line_user_id))) { bump('skipped_not_open'); continue; }

    // 送信権を1回だけ取得（同時実行・再実行でも二重送信しない）
    const claim = await getDb().query(
      `update parent_webinar_registrations set ${column} = session_id, updated_at = now()
        where id = $1 and session_id = $2 and ${column} is distinct from session_id
        returning id`,
      [reg.id, session.id]);
    if (!claim.rows[0]) { bump('already_sent'); continue; }

    try {
      const res = await pushMessage(reg.line_user_id, webinarReminderMessages(kind, session, zoom), randomUUID());
      if (!res.sent) {
        await getDb().query(`update parent_webinar_registrations set ${column} = $2 where id = $1`, [reg.id, reg[column]]);
        bump(res.reason);
        continue;
      }
      await recordEvent(reg.line_user_id, 'message_sent', { message: `webinar:${kind}`, session: session.id });
      bump('sent');
    } catch (err) {
      await getDb().query(`update parent_webinar_registrations set ${column} = $2 where id = $1`, [reg.id, reg[column]]);
      log.error('リマインド送信失敗', { campaignKey: `webinar:${kind}`, error: errorSummary(err) });
      bump('failed');
    }
  }
  return { kind, open: webinarOpen(), candidates: rows.length, results: counts };
}

export function isWebinarStartText(text) {
  return WEBINAR.startKeywords.includes(text);
}
