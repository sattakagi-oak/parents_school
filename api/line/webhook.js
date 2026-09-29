// POST /api/line/webhook — LINE Messaging API Webhook
// 署名検証 → イベント処理。bodyはDBに保存しない。

import { verifySignature, getDisplayName } from '../_lib/line.js';
import { isValidLineUserId, matchesTestRegisterCode, isTestUser, sendMode } from '../_lib/config.js';
import { markFollowed, markBlocked, upsertUser, recordEvent, addTestUser, removeTestUser, isRegisteredTestUser, resetTestUserProgress } from '../_lib/users.js';
import { parsePostback, sendGreeting, handleStage, handleLegacySheet, handleCheckCount } from '../_lib/checklist.js';
import { replyUntracked } from '../_lib/delivery.js';
import {
  TEST_REGISTER_PREFIX, TEST_UNREGISTER_TEXT, TEST_REGISTERED, TEST_UNREGISTERED,
  TEST_RESET_TEXT, TEST_RESET_DONE, TEST_START_TEXT, legacySheetFor,
} from '../_lib/messages.js';
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
      // チェック数まで回答済みの人の再追加（ブロック解除）では挨拶を送り直さない
      if (user.parenting_check_answered_at) return 'follow:already_answered';
      await sendGreeting(userId, replyToken);
      return 'follow:greeting';
    }
    case 'unfollow':
      await markBlocked(userId);
      await recordEvent(userId, 'unfollow');
      return 'unfollow';
    case 'postback': {
      const p = parsePostback(event.postback?.data);
      if (p?.action === 'stage') {
        await upsertUser(userId);
        return `postback:${await handleStage(userId, replyToken, p.value, { supplement: p.supplement })}`;
      }
      if (p?.action === 'check_count') {
        return `postback:${await handleCheckCount(userId, replyToken, p.value)}`;
      }
      return 'postback:ignored';
    }
    case 'message': {
      const text = event.message?.type === 'text' ? event.message.text?.trim() : null;
      if (!text) return 'message:ignored';
      const devResult = await handleDevCommand(userId, replyToken, text);
      if (devResult) return devResult;
      // 旧導線の「①/②/1/2」（シート未取得の人のみ）
      const legacy = legacySheetFor(text);
      if (legacy) {
        const r = await handleLegacySheet(userId, replyToken, legacy);
        if (r) return `message:${r}`;
      }
      // それ以外のメッセージは美穂先生（LINE公式アカウントのチャット）が対応する。自動返信しない。
      return 'message:ignored';
    }
    default:
      return 'ignored';
  }
}

// 開発用コマンド（production では全て無効 = 通常のメッセージとして扱い、何もしない）
//   「テスト登録 <合言葉>」→ テスト送信対象に登録。合言葉が違う場合は何も返さない（存在を知らせない）
//   「テスト解除」→ 登録済みなら解除
//   「テストリセット」→ テスト用ユーザー本人の状態を友だち追加直後に戻す
//   「テスト開始」→ テスト用ユーザーに友だち追加直後の挨拶＋年代ボタンを送る（既存の自動応答ONのままテストするため）
// メッセージ本文はログに出さない。
async function handleDevCommand(userId, replyToken, text) {
  if (sendMode() === 'production') return null;
  if (text.startsWith(TEST_REGISTER_PREFIX)) {
    const code = text.slice(TEST_REGISTER_PREFIX.length).trim();
    if (!matchesTestRegisterCode(code)) return 'message:test_register_rejected';
    await addTestUser(userId);
    await recordEvent(userId, 'test_user_registered');
    await replyUntracked(userId, replyToken, [{ type: 'text', text: TEST_REGISTERED }], 'test:registered');
    return 'message:test_registered';
  }
  if (text === TEST_UNREGISTER_TEXT) {
    if (!(await isRegisteredTestUser(userId))) return 'message:ignored';
    // 解除前に返信（解除後はテスト対象外になり返信できないため）
    await replyUntracked(userId, replyToken, [{ type: 'text', text: TEST_UNREGISTERED }], 'test:unregistered');
    await removeTestUser(userId);
    await recordEvent(userId, 'test_user_unregistered');
    return 'message:test_unregistered';
  }
  if (text === TEST_RESET_TEXT || text === TEST_START_TEXT) {
    if (!(await isTestUser(userId))) return 'message:ignored';
    if (text === TEST_RESET_TEXT) {
      await resetTestUserProgress(userId);
      await recordEvent(userId, 'test_user_reset');
      await replyUntracked(userId, replyToken, [{ type: 'text', text: TEST_RESET_DONE }], 'test:reset');
      return 'message:test_reset';
    }
    await upsertUser(userId);
    await recordEvent(userId, 'test_start');
    await sendGreeting(userId, replyToken);
    return 'message:test_start';
  }
  return null;
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
