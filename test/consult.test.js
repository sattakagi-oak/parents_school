import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { baseEnv, freshDb, stubLine, signedRequest, ev, postback, user, OWNER, OTHER } from './helpers.js';
import { POST as webhook } from '../api/line/webhook.js';
import { classifyConsultText } from '../api/_lib/consult.js';
import { setClockForTest } from '../api/_lib/webinar.js';

let db;
let calls;
const send = (...events) => webhook(signedRequest({ destination: 'Uxxx', events }));
const text = (userId, t) => ev('message', userId, { message: { type: 'text', id: '1', text: t } });
const replies = () => calls.sends().filter((c) => c.url.endsWith('/reply'));
const hasCard = (r) => r.body.messages.some((m) => m.type === 'flex' && JSON.stringify(m).includes('個別相談を申し込む'));
const cardCount = () => replies().filter(hasCard).length;
async function answered(userId) {
  await send(postback(userId, 'action=stage&value=preschool'));
  await send(text(userId, '【チェック数】5個'));
}

beforeEach(async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: `${OWNER},${OTHER}`, WEBINAR_ENABLED: 'true' });
  db = await freshDb();
  calls = stubLine();
  setClockForTest(() => new Date('2026-11-20T12:00:00+09:00')); // 無料講座は受付終了後
});
afterEach(() => setClockForTest(null));

test('判定: 相談の言葉はexplicit、あいまいな言葉はcontextual、断り・長文・無関係はnull', () => {
  for (const t of ['個別相談', '個別相談お願いします', '個別相談を希望します！', '相談', '相談したいです', 'そうだん', '個別分析希望', '個別診断', '面談お願いします', '個別 相談']) {
    assert.equal(classifyConsultText(t), 'explicit', t);
  }
  for (const t of ['お願いします', 'お願いします！', 'お願いします😊', 'おねがいします', 'お願いいたします', 'ぜひお願いします', 'はい', '希望します', '希望です', '詳しく教えてください', '受けたいです', '話してみたいです', '申し込みたいです', '興味があります', '申し込む']) {
    assert.equal(classifyConsultText(t), 'contextual', t);
  }
  for (const t of ['個別相談は大丈夫です', '相談はいりません', '今回は結構です', 'よろしくお願いします', 'ありがとうございます', '5', 'こんにちは',
    '子どもの宿題について相談です。毎日声をかけても全然始めなくて、どうすればいいのか本当に困っています。']) {
    assert.equal(classifyConsultText(t), null, t);
  }
});

test('「個別相談」: 案内の前でも、何度でもカードを返す。チェック未回答の人にも返す', async () => {
  await send(text(OWNER, '相談したいです'));
  assert.equal(cardCount(), 1);
  await send(text(OWNER, '個別相談'));
  assert.equal(cardCount(), 2);
  const [reply, card] = replies().at(-1).body.messages;
  assert.match(reply.text, /個別相談のご案内です/);
  assert.equal(card.type, 'flex');
});

test('「お願いします」: 案内を送ったあとの1回だけ反応。案内がない人には反応しない', async () => {
  await send(text(OWNER, 'お願いします'));
  assert.equal(cardCount(), 0, '案内を送っていない人の「お願いします」には反応しない');

  await answered(OWNER);
  assert.equal(cardCount(), 0, '個数を送った時点ではカードを出さない');
  await send(text(OWNER, 'お願いします'));
  assert.equal(cardCount(), 1);
  await send(text(OWNER, 'お願いします'));
  assert.equal(cardCount(), 1, '2回目は普段の会話とみなす');
  await send(text(OWNER, '個別相談'));
  assert.equal(cardCount(), 2, 'はっきり言われたらまた返す');
});

test('「お願いします」: 案内から14日を過ぎたら反応しない', async () => {
  await answered(OWNER);
  await db.query(`update parent_line_events set created_at = now() - interval '15 days' where event_type = 'consult_offer'`);
  await send(text(OWNER, 'お願いします'));
  assert.equal(cardCount(), 0);
});

test('断りの言葉・申込済みの人にはカードを返さない', async () => {
  await answered(OWNER);
  await send(text(OWNER, '個別相談は大丈夫です'));
  assert.equal(cardCount(), 0);

  await answered(OTHER);
  await db.query('update parent_line_users set diagnosis_applied_at = now() where line_user_id = $1', [OTHER]);
  await send(text(OTHER, '個別相談'));
  assert.equal(cardCount(), 0);
});

test('「申し込みました」は報告として扱い、カードを返さない', async () => {
  await answered(OWNER);
  await send(text(OWNER, '申し込みました'));
  assert.equal(cardCount(), 0);
  assert.ok((await user(db, OWNER)).diagnosis_applied_at);
});

test('「申し込む」: 無料講座の受付中は講座を優先、受付後は案内済みの人にカードを返す', async () => {
  await answered(OWNER);
  setClockForTest(() => new Date('2026-10-15T12:00:00+09:00'));
  await send(text(OWNER, '申し込む'));
  assert.equal(cardCount(), 0);
  assert.match(JSON.stringify(replies().at(-1).body.messages), /希望日時/);
  setClockForTest(() => new Date('2026-11-20T12:00:00+09:00'));
  await send(text(OWNER, '申し込む'));
  assert.equal(cardCount(), 1);
});
