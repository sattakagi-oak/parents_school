// 返信（reply）の送信と記録。
// - 送信可否は replyMessage 内の sendPermission で毎回判定（disabled / test の許可リスト / production）
// - 実際に送った・許可外で止めた、はどちらも parent_line_events に記録する（userIdはログには出さない）
//   → 「テストユーザー以外に送っていない」をDBで確認できる
// - 1回だけ送るべきもの（3問完了メッセージ＋CTA）は parent_line_message_logs の
//   (line_user_id, campaign_key) 一意制約で二重送信を防ぐ

import { getDb } from './db.js';
import { replyMessage } from './line.js';
import { recordEvent } from './users.js';
import { log, errorSummary } from './log.js';

async function reply(lineUserId, replyToken, messages, label) {
  if (!replyToken) return 'no_reply_token';
  try {
    const res = await replyMessage(lineUserId, replyToken, messages);
    if (!res.sent) {
      log.info('送信をスキップ', { reason: res.reason, campaignKey: label, messageType: 'reply' });
      if (res.reason === 'skipped_not_test_user') {
        await recordEvent(lineUserId, 'send_blocked', { message: label, reason: res.reason });
      }
      return res.reason;
    }
    await recordEvent(lineUserId, 'message_sent', { message: label });
    return 'sent';
  } catch (err) {
    log.error('返信失敗', { campaignKey: label, error: errorSummary(err) });
    return 'failed';
  }
}

/** 質問の出題など、何度送ってもよい返信 */
export async function replyUntracked(lineUserId, replyToken, messages, label) {
  return reply(lineUserId, replyToken, messages, label);
}

/**
 * 1ユーザーに1回だけ送る返信。
 * sent / pending のログがあれば送らない。skipped_* / failed は再度送れる。
 * @returns {Promise<'sent'|'already_sent'|'skipped_disabled'|'skipped_not_test_user'|'failed'|'no_reply_token'>}
 */
export async function replyOnce(lineUserId, replyToken, messages, campaignKey) {
  const { rows } = await getDb().query(
    `insert into parent_line_message_logs (line_user_id, campaign_key, message_type, status, attempts)
     values ($1, $2, 'reply', 'pending', 1)
     on conflict (line_user_id, campaign_key) do update
       set status = 'pending', attempts = parent_line_message_logs.attempts + 1,
           error_message = null, updated_at = now()
       where parent_line_message_logs.status not in ('pending', 'sent')
     returning id`,
    [lineUserId, campaignKey],
  );
  if (!rows[0]) return 'already_sent';

  const status = await reply(lineUserId, replyToken, messages, campaignKey);
  await getDb().query(
    `update parent_line_message_logs
        set status = $2, sent_at = case when $2 = 'sent' then now() else sent_at end, updated_at = now()
      where id = $1`,
    [rows[0].id, status],
  );
  return status;
}
