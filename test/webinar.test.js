import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseEnv, freshDb, stubLine, signedRequest, ev, postback, OWNER, OTHER,
} from './helpers.js';
import { POST as webhook } from '../api/line/webhook.js';
import { GET as cron } from '../api/cron/webinar-reminders.js';
import { setClockForTest, runWebinarReminders, reminderTimes } from '../api/_lib/webinar.js';
import { WEBINAR } from '../api/_lib/messages.js';

const CRON_SECRET = 'c'.repeat(40);
const ZOOM = {
  WEBINAR_ZOOM_URL: 'https://zoom.example.test/j/123?pwd=abc',
  WEBINAR_ZOOM_MEETING_ID: '123 456 789',
  WEBINAR_ZOOM_PASSCODE: '000000',
};
const THIRD = 'U' + '3'.repeat(32);
let db;
let calls;
let now;

const at = (iso) => { now = new Date(iso); };
const send = (...events) => webhook(signedRequest({ destination: 'Uxxx', events }));
const text = (userId, t) => ev('message', userId, { message: { type: 'text', id: '1', text: t } });
const pick = (userId, id) => postback(userId, `action=webinar_session&value=${id}`);
const change = (userId) => postback(userId, 'action=webinar_change');
const replies = () => calls.sends().filter((c) => c.url.endsWith('/reply'));
const pushes = () => calls.sends().filter((c) => c.url.endsWith('/push'));
const lastReply = () => replies().at(-1).body.messages;
const reg = async (userId) =>
  (await db.query('select * from parent_webinar_registrations where line_user_id = $1', [userId])).rows[0];
const testMode = (extra = {}) =>
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER, CRON_SECRET, ...ZOOM, ...extra });
const sessionIds = (msg) => msg.contents.body.contents.filter((c) => c.type === 'box').map((b) => b.action.data.split('value=')[1]);

beforeEach(async () => {
  testMode();
  db = await freshDb();
  calls = stubLine();
  at('2026-10-14T12:00:00+09:00');
  setClockForTest(() => now);
});
afterEach(() => setClockForTest(null));

async function register(userId, sessionId) {
  await send(text(userId, '無料講座に申し込む'));
  await send(pick(userId, sessionId));
}

// ---------- 申込 ----------

test('申込: 案内（顔出しなし・ミュートOK）＋4つの日時ボタン → 選択で保存・完了＋日程変更ボタン（すべてreply）', async () => {
  await send(text(OWNER, '無料講座に申し込む'));
  const [intro, sessions] = lastReply();
  assert.match(intro.text, /お子さんの「自走力」と「地頭」をきたえる/);
  assert.match(intro.text, /わが子3人東大進学の塾長があかす、家庭での関わり方/);
  assert.match(intro.text, /顔出しなし・ミュートでのご参加もOK/);
  assert.deepEqual(sessionIds(sessions), ['1020_am', '1020_pm', '1021_am', '1021_pm']);
  const actions = sessions.contents.body.contents.filter((c) => c.type === 'box').map((b) => b.action);
  assert.equal(actions[0].displayText, '【無料講座 希望日時】10/20（火）10:15〜');
  assert.equal(actions[3].displayText, '【無料講座 希望日時】10/21（水）21:00〜22:00');

  await send(pick(OWNER, '1020_pm'));
  const r = await reg(OWNER);
  assert.equal(r.session_id, '1020_pm');
  assert.equal(r.webinar_key, WEBINAR.key);
  const [done, changeCard] = lastReply();
  assert.match(done.text, /^お申し込みが完了しました😊/);
  assert.match(done.text, /【日時】10\/20（火）21:00〜22:00/);
  assert.match(done.text, /前日の20時ごろと当日の朝に、このLINEで参加用のZoomリンクをお送りします/);
  assert.ok(!done.text.includes(ZOOM.WEBINAR_ZOOM_URL), '早めの申込ではZoomリンクはまだ送らない');
  assert.equal(changeCard.contents.footer.contents[0].action.data, 'action=webinar_change');
  assert.equal(pushes().length, 0);
});

test('「申込」「申し込む」でも開始できる', async () => {
  for (const t of ['申込', '申し込む', '申し込み']) {
    await send(text(OWNER, t));
    assert.equal(sessionIds(lastReply()[1]).length, 4, t);
  }
});

test('日程変更: ボタン → 日時ボタン（変更用）→ 選び直しで上書き', async () => {
  await register(OWNER, '1020_am');
  await send(change(OWNER));
  assert.equal(lastReply()[0].altText, '変更後のご希望日時を選んでください👇');
  await send(pick(OWNER, '1021_pm'));
  const r = await reg(OWNER);
  assert.equal(r.session_id, '1021_pm');
  assert.ok(r.session_changed_at);
  assert.match(lastReply()[0].text, /^日程を変更しました😊/);
  assert.match(lastReply()[0].text, /10\/21（水）21:00〜22:00/);
  const { rows } = await db.query('select count(*)::int n from parent_webinar_registrations');
  assert.equal(rows[0].n, 1, '1人1行');
});

test('終了した回は選べない（ボタンから消え、押されても保存せず出し直す）。全回終了後は受付終了', async () => {
  at('2026-10-20T12:00:00+09:00');
  await send(text(OWNER, '無料講座に申し込む'));
  assert.deepEqual(sessionIds(lastReply()[1]), ['1020_pm', '1021_am', '1021_pm']);
  await send(pick(OWNER, '1020_am'));
  assert.equal(await reg(OWNER), undefined);
  assert.deepEqual(sessionIds(lastReply()[0]), ['1020_pm', '1021_am', '1021_pm']);
  await send(pick(OWNER, 'bogus'));
  assert.equal(await reg(OWNER), undefined);

  at('2026-10-21T23:00:00+09:00');
  await send(text(OWNER, '無料講座に申し込む'));
  assert.match(lastReply()[0].text, /受付は終了しました/);
});

test('前日20時以降の申込: 完了メッセージにZoom情報を入れ、前日リマインドは送らない（当日朝は送る）', async () => {
  at('2026-10-19T21:30:00+09:00');
  await register(OWNER, '1020_am');
  const done = lastReply()[0].text;
  assert.ok(done.includes(ZOOM.WEBINAR_ZOOM_URL));
  assert.match(done, /ミーティングID: 123 456 789/);
  assert.match(done, /パスコード: 000000/);
  assert.match(done, /当日の朝にもあらためてお送りします/);
  assert.equal((await reg(OWNER)).day_before_sent_for, '1020_am');

  let r = await runWebinarReminders('day_before', { now: new Date('2026-10-19T21:45:00+09:00') });
  assert.equal(pushes().length, 0);
  r = await runWebinarReminders('morning', { now: new Date('2026-10-20T08:20:00+09:00') });
  assert.equal(r.results.sent, 1);
});

test('当日朝以降の申込: 完了メッセージにZoom、「当日の朝にも」は書かない。朝のリマインドも送らない', async () => {
  at('2026-10-20T09:00:00+09:00');
  await register(OWNER, '1020_am');
  const done = lastReply()[0].text;
  assert.ok(done.includes(ZOOM.WEBINAR_ZOOM_URL));
  assert.ok(!done.includes('当日の朝にも'));
  await runWebinarReminders('morning', { now: new Date('2026-10-20T09:05:00+09:00') });
  assert.equal(pushes().length, 0);
});

// ---------- リマインド ----------

test('前日20時台: 翌日の回の申込者だけにZoom付きでpush。再実行しても二重送信しない', async () => {
  await register(OWNER, '1020_am');
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: `${OWNER},${OTHER}`, CRON_SECRET, ...ZOOM });
  await register(OTHER, '1021_am');

  const r = await runWebinarReminders('day_before', { now: new Date('2026-10-19T20:15:00+09:00') });
  assert.equal(r.results.sent, 1);
  assert.equal(r.results.not_due, 1);
  const p = pushes();
  assert.equal(p.length, 1);
  assert.equal(p[0].body.to, OWNER);
  assert.ok(p[0].headers['x-line-retry-key']);
  const msg = p[0].body.messages[0].text;
  assert.match(msg, /^明日は無料講座の日です😊/);
  assert.match(msg, /【日時】10\/20（火）10:15〜/);
  assert.ok(msg.includes(ZOOM.WEBINAR_ZOOM_URL));
  assert.match(msg, /ミーティングID: 123 456 789\nパスコード: 000000/);

  await runWebinarReminders('day_before', { now: new Date('2026-10-19T20:45:00+09:00') });
  assert.equal(pushes().length, 1, '同じ日に再実行しても送らない');

  await runWebinarReminders('day_before', { now: new Date('2026-10-20T20:10:00+09:00') });
  assert.equal(pushes().length, 2);
  assert.equal(pushes()[1].body.to, OTHER);
});

test('当日朝・1時間前のリマインド', async () => {
  await register(OWNER, '1020_pm');
  let r = await runWebinarReminders('morning', { now: new Date('2026-10-20T08:10:00+09:00') });
  assert.equal(r.results.sent, 1);
  assert.match(pushes()[0].body.messages[0].text, /^本日、無料講座を開催します😊/);
  assert.match(pushes()[0].body.messages[0].text, /【日時】本日 21:00〜22:00/);

  r = await runWebinarReminders('hour_before', { now: new Date('2026-10-20T19:50:00+09:00') });
  assert.equal(r.results.not_due, 1, '1時間前より前は送らない');
  r = await runWebinarReminders('hour_before', { now: new Date('2026-10-20T20:00:00+09:00') });
  assert.equal(r.results.sent, 1);
  assert.match(pushes()[1].body.messages[0].text, /^まもなく（1時間後）無料講座が始まります/);
  r = await runWebinarReminders('hour_before', { now: new Date('2026-10-20T21:05:00+09:00') });
  assert.equal(pushes().length, 2, '開始後は送らない');
});

test('送り損ねても意味が変わる時間帯には送らない（前日分を当日に送らない等）', async () => {
  await register(OWNER, '1020_pm');
  const r = await runWebinarReminders('day_before', { now: new Date('2026-10-20T20:10:00+09:00') });
  assert.equal(r.results.not_due, 1);
  assert.equal(pushes().length, 0);
  const t = reminderTimes(WEBINAR.sessions[1]);
  assert.equal(t.day_before.toISOString(), new Date('2026-10-19T20:00:00+09:00').toISOString());
  assert.equal(t.morning.toISOString(), new Date('2026-10-20T08:00:00+09:00').toISOString());
  assert.equal(t.hour_before.toISOString(), new Date('2026-10-20T20:00:00+09:00').toISOString());
});

test('前日リマインド後に日程変更 → 変更後の回の前日にあらためて送る', async () => {
  await register(OWNER, '1020_am');
  await runWebinarReminders('day_before', { now: new Date('2026-10-19T20:10:00+09:00') });
  at('2026-10-19T22:00:00+09:00');
  await send(change(OWNER));
  await send(pick(OWNER, '1021_am'));
  assert.ok(!lastReply()[0].text.includes(ZOOM.WEBINAR_ZOOM_URL), '1021の前日20時前なのでZoomはまだ');
  await runWebinarReminders('morning', { now: new Date('2026-10-20T08:10:00+09:00') });
  assert.equal(pushes().length, 1, '変更前の回の当日朝リマインドは送らない');
  await runWebinarReminders('day_before', { now: new Date('2026-10-20T20:10:00+09:00') });
  assert.equal(pushes().length, 2);
  assert.match(pushes()[1].body.messages[0].text, /10\/21（水）10:00〜11:00/);
});

test('Zoom URL未設定ならリマインドを保留（送らず、送信済みにもしない）', async () => {
  await register(OWNER, '1020_am');
  testMode({ WEBINAR_ZOOM_URL: '' });
  const r = await runWebinarReminders('day_before', { now: new Date('2026-10-19T20:10:00+09:00') });
  assert.deepEqual(r.results, { held_missing_zoom: 1 });
  assert.equal(pushes().length, 0);
  assert.equal((await reg(OWNER)).day_before_sent_for, null);
});

test('ブロックした人には送らない', async () => {
  await register(OWNER, '1020_am');
  await send(ev('unfollow', OWNER));
  await runWebinarReminders('day_before', { now: new Date('2026-10-19T20:10:00+09:00') });
  assert.equal(pushes().length, 0);
});

test('送信失敗は送信済みにせず、次回に再送できる', async () => {
  await register(OWNER, '1020_am');
  calls = stubLine({ status: (c) => (c.url.endsWith('/push') ? 500 : 200) });
  let r = await runWebinarReminders('day_before', { now: new Date('2026-10-19T20:10:00+09:00') });
  assert.equal(r.results.failed, 1);
  assert.equal((await reg(OWNER)).day_before_sent_for, null);
  calls = stubLine();
  r = await runWebinarReminders('day_before', { now: new Date('2026-10-19T20:40:00+09:00') });
  assert.equal(r.results.sent, 1);
});

// ---------- 本番の友だちへの安全装置 ----------

test('WEBINAR_ENABLED未設定: テスト用以外の人の「申込」は無視（返信もDB登録もしない）', async () => {
  baseEnv({ LINE_SEND_MODE: 'production', LINE_SEND_ENABLED: 'true', LINE_TEST_USER_IDS: OWNER, CRON_SECRET, ...ZOOM });
  await send(text(OTHER, '無料講座に申し込む'));
  await send(pick(OTHER, '1020_am'));
  await send(change(OTHER));
  assert.equal(calls.sends().length, 0);
  assert.equal(await reg(OTHER), undefined);

  // テスト用ユーザーは production モードでも試せる
  await register(OWNER, '1020_am');
  assert.match(lastReply()[0].text, /お申し込みが完了しました/);
});

test('WEBINAR_ENABLED未設定: リマインドもテスト用ユーザーだけ（DBに他の申込があっても送らない）', async () => {
  baseEnv({ LINE_SEND_MODE: 'production', LINE_SEND_ENABLED: 'true', LINE_TEST_USER_IDS: OWNER, CRON_SECRET, ...ZOOM });
  await register(OWNER, '1020_am');
  await db.query(`insert into parent_line_users (line_user_id) values ($1)`, [THIRD]);
  await db.query(`insert into parent_webinar_registrations (line_user_id, webinar_key, session_id) values ($1, $2, '1020_am')`, [THIRD, WEBINAR.key]);
  const r = await runWebinarReminders('day_before', { now: new Date('2026-10-19T20:10:00+09:00') });
  assert.equal(r.results.sent, 1);
  assert.equal(r.results.skipped_not_open, 1);
  assert.deepEqual(pushes().map((p) => p.body.to), [OWNER]);
  assert.equal((await reg(THIRD)).day_before_sent_for, null, '送っていない人は送信済みにしない');
});

test('WEBINAR_ENABLED=true かつ production: 申込者全員に送る', async () => {
  baseEnv({ LINE_SEND_MODE: 'production', LINE_SEND_ENABLED: 'true', WEBINAR_ENABLED: 'true', CRON_SECRET, ...ZOOM });
  await register(OTHER, '1020_am');
  assert.match(lastReply()[0].text, /お申し込みが完了しました/);
  const r = await runWebinarReminders('day_before', { now: new Date('2026-10-19T20:10:00+09:00') });
  assert.equal(r.results.sent, 1);
});

test('testモード: WEBINAR_ENABLED=true でもテスト用以外には送らない（送信モードが優先）', async () => {
  testMode({ WEBINAR_ENABLED: 'true' });
  await register(OTHER, '1020_am');
  assert.ok((await reg(OTHER)), '申込自体は保存される');
  assert.equal(calls.sends().length, 0);
  const r = await runWebinarReminders('day_before', { now: new Date('2026-10-19T20:10:00+09:00') });
  assert.equal(r.results.skipped_not_test_user, 1);
  assert.equal(pushes().length, 0);
  assert.equal((await reg(OTHER)).day_before_sent_for, null);
});

// ---------- Cron エンドポイント ----------

const cronReq = (qs, auth = `Bearer ${CRON_SECRET}`) =>
  new Request(`https://example.test/api/cron/webinar-reminders${qs}`, { headers: auth ? { authorization: auth } : {} });

test('Cron: 認証なし・誤り・CRON_SECRET未設定は401、kind不正は400、now指定で実行できる', async () => {
  assert.equal((await cron(cronReq('?kind=day_before', null))).status, 401);
  assert.equal((await cron(cronReq('?kind=day_before', 'Bearer wrong'))).status, 401);
  assert.equal((await cron(cronReq('?kind=nope'))).status, 400);
  assert.equal((await cron(cronReq('?kind=day_before&now=garbage'))).status, 400);

  await register(OWNER, '1020_am');
  const res = await cron(cronReq(`?kind=day_before&now=${encodeURIComponent('2026-10-19T20:10:00+09:00')}`));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).results.sent, 1);

  testMode({ CRON_SECRET: '' });
  assert.equal((await cron(cronReq('?kind=day_before', 'Bearer '))).status, 401);
});

test('テストリセットで講座の申込も消える', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER, ...ZOOM });
  await register(OWNER, '1020_am');
  await send(text(OWNER, 'テストリセット'));
  assert.equal(await reg(OWNER), undefined);
});

// ---------- 新規友だちへの告知（挨拶に添える） ----------

const follow = (userId, isUnblocked) => ev('follow', userId, { follow: { isUnblocked } });

test('新規友だち: 期間中の新規追加だけ挨拶に告知を添える（ブロック解除・期間外・申込済みは挨拶のみ）', async () => {
  at('2026-10-19T14:05:00+09:00');
  await send(follow(OWNER, false));
  const msgs = lastReply();
  assert.equal(msgs.length, 3);
  assert.match(msgs[2].text, /^【明日開催・まだ間に合います】/);
  assert.match(msgs[2].text, /10\/20（火）10:15〜[\s\S]*10\/21（水）21:00〜22:00/);
  assert.match(msgs[2].text, /「申し込む」と送るだけ/);

  await send(follow(OWNER, true));
  assert.equal(lastReply().length, 2, 'ブロック解除は対象外');

  at('2026-10-19T14:00:00+09:00');
  await send(follow(OWNER, false));
  assert.equal(lastReply().length, 2, '14:01より前は対象外');

  at('2026-10-20T12:00:00+09:00');
  await send(follow(OWNER, false));
  const day = lastReply()[2].text;
  assert.match(day, /^【本日開催・まだ間に合います】/);
  assert.doesNotMatch(day, /10\/20（火）10:15/, '終わった回は出さない');
  assert.match(day, /10\/20（火）21:00〜22:00/);

  await register(OWNER, '1020_pm');
  await send(follow(OWNER, false));
  assert.equal(lastReply().length, 2, '申込済みは対象外');

});

test('新規友だち: 10/21は「本日最終日」、21:00以降は挨拶のみ', async () => {
  at('2026-10-21T12:00:00+09:00');
  await send(follow(OWNER, false));
  const last = lastReply()[2].text;
  assert.match(last, /^【本日最終日・まだ間に合います】/);
  assert.match(last, /10\/21（水）21:00〜22:00/);
  assert.doesNotMatch(last, /10\/21（水）10:00/);

  at('2026-10-21T21:00:00+09:00');
  await send(follow(OWNER, false));
  assert.equal(lastReply().length, 2);
});
