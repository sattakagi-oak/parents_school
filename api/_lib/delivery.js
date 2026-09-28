// 二重送信防止つきの送信。
// parent_line_message_logs の (line_user_id, campaign_key) 一意制約で「送信権」を1回だけ取得する。
//   - sent / pending のログがあれば二度と送らない
//   - skipped_* / failed のログは再取得できる（モード切替後やエラー後に送れるように）
// push は retry_key を X-Line-Retry-Key に使うため、LINE側でも重複が防がれる。

import { getDb } from './db.js';
import { sendPermission } from './config.js';
import { pushMessage, replyMessage } from './line.js';
import { log, errorSummary } from './log.js';

async function claim(lineUserId, campaignKey, messageType, scheduledFor) {
  const { rows } = await getDb().query(
    `insert into parent_line_message_logs
       (line_user_id, campaign_key, message_type, scheduled_for, status, attempts)
     values ($1, $2, $3, $4, 'pending', 1)
     on conflict (line_user_id, campaign_key) do update
       set status = 'pending', message_type = excluded.message_type,
           attempts = parent_line_message_logs.attempts + 1,
           error_message = null, updated_at = now()
       where parent_line_message_logs.status not in ('pending', 'sent')
     returning id, retry_key`,
    [lineUserId, campaignKey, messageType, scheduledFor],
  );
  return rows[0] || null;
}

async function finish(id, status, errorMessage = null) {
  await getDb().query(
    `update parent_line_message_logs
        set status = $2, error_message = $3,
            sent_at = case when $2 = 'sent' then now() else sent_at end,
            updated_at = now()
      where id = $1`,
    [id, status, errorMessage],
  );
}

export async function logStatus(lineUserId, campaignKey) {
  const { rows } = await getDb().query(
    `select status from parent_line_message_logs where line_user_id = $1 and campaign_key = $2`,
    [lineUserId, campaignKey],
  );
  return rows[0]?.status || null;
}

/**
 * 記録つき送信。
 * @param {object} p
 * @param {'push'|'reply'} p.messageType
 * @param {boolean} [p.dryRun] true ならログも書かず、送信可否だけ返す
 * @returns {Promise<'sent'|'already_sent'|'skipped_disabled'|'skipped_not_test_user'|'failed'|'dry_run'>}
 */
export async function sendTracked({ lineUserId, campaignKey, messageType, messages, replyToken, scheduledFor = null, dryRun = false }) {
  if (dryRun) {
    const status = await logStatus(lineUserId, campaignKey);
    return status === 'sent' || status === 'pending' ? 'already_sent' : 'dry_run';
  }

  const row = await claim(lineUserId, campaignKey, messageType, scheduledFor);
  if (!row) return 'already_sent';

  const perm = sendPermission(lineUserId);
  if (!perm.ok) {
    await finish(row.id, perm.reason);
    log.info('送信をスキップ', { reason: perm.reason, campaignKey, messageType });
    return perm.reason;
  }

  try {
    const res = messageType === 'reply'
      ? await replyMessage(lineUserId, replyToken, messages)
      : await pushMessage(lineUserId, messages, row.retry_key);
    if (!res.sent) {
      await finish(row.id, res.reason);
      return res.reason;
    }
    await finish(row.id, 'sent');
    return 'sent';
  } catch (err) {
    const summary = errorSummary(err);
    await finish(row.id, 'failed', summary);
    log.error('送信失敗', { campaignKey, messageType, error: summary });
    return 'failed';
  }
}

/** ログ不要な単発返信（質問の出題など）。送信モードで止まった場合も安全にスキップ。 */
export async function replyUntracked(lineUserId, replyToken, messages, label) {
  if (!replyToken) return 'no_reply_token';
  try {
    const res = await replyMessage(lineUserId, replyToken, messages);
    if (!res.sent) {
      log.info('送信をスキップ', { reason: res.reason, campaignKey: label, messageType: 'reply' });
      return res.reason;
    }
    return 'sent';
  } catch (err) {
    log.error('返信失敗', { campaignKey: label, error: errorSummary(err) });
    return 'failed';
  }
}
