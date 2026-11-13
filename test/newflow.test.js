import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { baseEnv, freshDb, stubLine, signedRequest, ev, postback, OWNER, OTHER } from './helpers.js';
import { POST as webhook } from '../api/line/webhook.js';
import { REPORT_SAMPLE } from '../api/_lib/messages.js';

let db, calls;
const send = (...events) => webhook(signedRequest({ destination: 'Uxxx', events }));
const text = (u, t) => ev('message', u, { message: { type: 'text', id: '1', text: t } });
const last = () => calls.sends().filter((c) => c.url.endsWith('/reply')).at(-1).body.messages;
async function answer(u) { await send(postback(u, 'action=stage&value=preschool')); await send(text(u, '【チェック数】5個')); }

beforeEach(async () => {
  db = await freshDb();
  calls = stubLine();
});

test('NEW_FLOW_FROM=off: 今までどおり（見本なし・旧カード）', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER, NEW_FLOW_FROM: 'off' });
  await answer(OWNER);
  assert.deepEqual(last().map((m) => m.type), ['text', 'video', 'text']);
  await send(text(OWNER, '個別診断'));
  assert.match(JSON.stringify(last()), /今どんな力が伸びているか/);
});

test('NEW_FLOW_FROM 以降に初めて回答した人だけ: お礼→動画→見本画像→案内、新カード', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: `${OWNER},${OTHER}`, NEW_FLOW_FROM: '2000-01-01T00:00:00Z' });
  await answer(OWNER);
  const msgs = last();
  assert.deepEqual(msgs.map((m) => m.type), ['text', 'video', 'image', 'text']);
  assert.ok(msgs[2].originalContentUrl.endsWith(`${REPORT_SAMPLE.path}?v=${REPORT_SAMPLE.version}`));
  assert.match(msgs[3].text, /こんなレポートが届きます/);
  await send(text(OWNER, '個別診断'));
  const card = JSON.stringify(last());
  assert.match(card, /今日からできる3つの関わり方/);
  assert.doesNotMatch(card, /6〜12か月/);

  // 区切りより前に回答済みの人は、今までどおり
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: `${OWNER},${OTHER}`, NEW_FLOW_FROM: '2999-01-01T00:00:00Z' });
  await answer(OTHER);
  assert.deepEqual(last().map((m) => m.type), ['text', 'video', 'text']);
  await send(text(OTHER, '個別診断'));
  assert.match(JSON.stringify(last()), /今どんな力が伸びているか/);
});

test('「申し込みました」の通知に、その方専用の記入フォームURLが付く', async () => {
  baseEnv({ LINE_SEND_MODE: 'production', LINE_SEND_ENABLED: 'true' });
  const ADMIN = 'U' + 'a'.repeat(32);
  await db.query('insert into parent_line_notify_targets (line_user_id) values ($1)', [ADMIN]);
  await answer(OWNER);
  await send(text(OWNER, '申し込みました'));
  const n = calls.sends().filter((c) => c.url.endsWith('/push') && c.body.to === ADMIN).map((c) => c.body.messages[0].text).at(-1);
  assert.match(n, /候補日程を送ってください/);
  assert.match(n, /https:\/\/example\.test\/admin\/report\/\?user=[0-9a-f-]{36}&exp=\d+&k=[0-9a-f]{64}/);
});
