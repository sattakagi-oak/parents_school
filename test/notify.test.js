import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { baseEnv, freshDb, stubLine, signedRequest, ev, postback, OWNER, OTHER } from './helpers.js';
import { POST as webhook } from '../api/line/webhook.js';
import { setClockForTest } from '../api/_lib/webinar.js';

const ADMIN = 'U' + 'a'.repeat(32);
let db;
let calls;

const send = (...events) => webhook(signedRequest({ destination: 'Uxxx', events }));
const text = (userId, t) => ev('message', userId, { message: { type: 'text', id: '1', text: t } });
const notices = () => calls.sends().filter((c) => c.url.endsWith('/push') && c.body.to === ADMIN).map((c) => c.body.messages[0].text);

beforeEach(async () => {
  baseEnv({ LINE_SEND_MODE: 'production', LINE_SEND_ENABLED: 'true', WEBINAR_ENABLED: 'true' });
  db = await freshDb();
  calls = stubLine();
  setClockForTest(() => new Date('2026-10-19T12:00:00+09:00'));
  await db.query('insert into parent_line_notify_targets (line_user_id) values ($1)', [ADMIN]);
});
afterEach(() => setClockForTest(null));

test('通知: チェック数（初回のみ）・申込報告・無料講座申込・自由メッセージを通知先へ push', async () => {
  await send(postback(OWNER, 'action=stage&value=elementary_lower'));
  await send(postback(OWNER, 'action=check_count&value=7'));
  await send(postback(OWNER, 'action=check_count&value=8')); // 選び直しは通知しない
  await send(text(OWNER, '申し込みました'));
  await send(text(OWNER, '無料講座に申し込む'));
  await send(postback(OWNER, 'action=webinar_session&value=1020_pm'));
  await send(text(OWNER, '質問です。うちの子は…'));
  await send(ev('message', OWNER, { message: { type: 'sticker', id: '2' } }));

  const n = notices();
  assert.equal(n.length, 5);
  assert.match(n[0], /^🔔 テスト保護者さん\nチェック数を回答しました：7個（/);
  assert.match(n[1], /「申し込みました」と報告/);
  assert.match(n[2], /無料講座に申し込みました：10\/20（火）21:00〜22:00/);
  assert.match(n[3], /メッセージが届きました：\n「質問です。うちの子は…」/);
  assert.match(n[4], /（スタンプ）/);
  // 通知は push、本人への返信は reply のまま
  assert.ok(calls.sends().filter((c) => c.url.endsWith('/push')).every((c) => c.body.to === ADMIN));
});

test('通知: 通知先本人の操作は通知しない／通知の失敗は返信に影響しない', async () => {
  await send(text(ADMIN, 'テストです'));
  assert.equal(notices().length, 0);

  calls = stubLine({ status: (c) => (c.url.endsWith('/push') ? 500 : 200) });
  await send(postback(OTHER, 'action=stage&value=preschool'));
  const res = await send(postback(OTHER, 'action=check_count&value=3'));
  assert.equal(res.status, 200);
  assert.ok(calls.sends().some((c) => c.url.endsWith('/reply') && c.body.messages.length >= 2), '完了メッセージは返信される');
});

test('通知: test モードでは通知先がテストユーザーでなければ送らない', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER });
  await send(text(OWNER, 'こんにちは'));
  assert.equal(notices().length, 0);
});
