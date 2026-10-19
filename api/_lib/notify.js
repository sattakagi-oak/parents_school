// 運営への通知。友だちの操作を parent_line_notify_targets のユーザーに push で知らせる（1通＝送信数1）。
// 通知の失敗は本来の処理（返信など）に影響させない。本文・userId はログに出さない。

import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { pushMessage, getDisplayName } from './line.js';
import { recordEvent } from './users.js';
import { log, errorSummary } from './log.js';

const MAX_QUOTE = 200;

async function nameOf(lineUserId) {
  const { rows } = await getDb().query('select display_name from parent_line_users where line_user_id = $1', [lineUserId]);
  return rows[0]?.display_name || (await getDisplayName(lineUserId)) || '（名前不明）';
}

/** body の先頭に「〇〇さん」を付けて通知。通知先本人の操作は通知しない。 */
export async function notifyAdmins(actorId, kind, body) {
  try {
    const { rows } = await getDb().query('select line_user_id from parent_line_notify_targets');
    const targets = rows.map((r) => r.line_user_id);
    if (!targets.length || targets.includes(actorId)) return 'skipped';
    const text = `🔔 ${await nameOf(actorId)}さん\n${body}`;
    for (const to of targets) {
      const res = await pushMessage(to, [{ type: 'text', text }], randomUUID());
      if (!res.sent) log.info('通知をスキップ', { kind, reason: res.reason });
    }
    await recordEvent(actorId, 'admin_notified', { kind });
    return 'notified';
  } catch (err) {
    log.error('通知失敗', { kind, error: errorSummary(err) });
    return 'failed';
  }
}

export function quote(text) {
  const t = text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE)}…` : text;
  return `「${t}」`;
}

/** テキスト以外のメッセージの表記 */
export function describeMessage(message) {
  const labels = { image: '画像', video: '動画', audio: '音声', file: 'ファイル', location: '位置情報', sticker: 'スタンプ' };
  return `（${labels[message?.type] || 'メッセージ'}）`;
}
