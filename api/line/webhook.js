// POST /api/line/webhook — LINE Messaging API Webhook
// 署名検証 → イベント処理。bodyはDBに保存しない。

import { verifySignature, getDisplayName } from '../_lib/line.js';
import { isValidLineUserId } from '../_lib/config.js';
import { markFollowed, markBlocked, upsertUser, recordEvent } from '../_lib/users.js';
import { parsePostback, askFirstQuestion, handleSegmentAnswer, firstUnanswered } from '../_lib/segment.js';
import { START_KEYWORDS } from '../_lib/messages.js';
import { log, errorSummary } from '../_lib/log.js';

const MAX_BODY_BYTES = 256 * 1024;

export async function handleEvent(event) {
  const userId = event?.source?.type === 'user' ? event.source.userId : null;
  if (!isValidLineUserId(userId)) return 'ignored_no_user';
  const replyToken = event.replyToken;

  switch (event.type) {
    case 'follow': {
      const user = await markFollowed(userId, await getDisplayName(userId));
      await recordEvent(userId, 'follow');
      // 回答途中・未回答なら最初の質問から（完了済みの再追加では再質問しない）
      if (firstUnanswered(user)) {
        await askFirstQuestion(userId, replyToken);
        return 'follow:asked';
      }
      return 'follow:already_segmented';
    }
    case 'unfollow':
      await markBlocked(userId);
      await recordEvent(userId, 'unfollow');
      return 'unfollow';
    case 'postback': {
      const p = parsePostback(event.postback?.data);
      if (p?.action !== 'segment') return 'postback:ignored';
      await upsertUser(userId);
      if (p.question === 'start') {
        await askFirstQuestion(userId, replyToken, { withIntro: false });
        return 'postback:start';
      }
      return `postback:${await handleSegmentAnswer(userId, replyToken, p.question, p.value)}`;
    }
    case 'message': {
      const text = event.message?.type === 'text' ? event.message.text?.trim() : null;
      if (text && START_KEYWORDS.includes(text)) {
        await upsertUser(userId);
        await askFirstQuestion(userId, replyToken, { withIntro: false });
        return 'message:start';
      }
      // それ以外のメッセージはLINE公式アカウント側のチャット対応に任せる
      return 'message:ignored';
    }
    default:
      return 'ignored';
  }
}

export async function POST(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) return new Response('payload too large', { status: 413 });

  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) return new Response('payload too large', { status: 413 });

  let valid = false;
  try {
    valid = verifySignature(raw, request.headers.get('x-line-signature'));
  } catch (err) {
    log.error('署名検証エラー', { error: errorSummary(err) });
    return new Response('server misconfigured', { status: 500 });
  }
  if (!valid) {
    log.warn('不正な署名のためWebhookを拒否');
    return new Response('invalid signature', { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const events = Array.isArray(body.events) ? body.events : [];
  // LINE Developers の「検証」は events が空 → そのまま200
  for (const event of events) {
    try {
      const result = await handleEvent(event);
      log.info('webhook event', { event: event.type, result });
    } catch (err) {
      // 1件の失敗で他イベントを止めない。LINE側の再送ループを避けるため200を返す。
      log.error('webhook event 処理失敗', { event: event?.type, error: errorSummary(err) });
    }
  }
  return new Response('ok', { status: 200 });
}

export function GET() {
  return new Response('method not allowed', { status: 405 });
}
