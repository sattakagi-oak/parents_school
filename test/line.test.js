import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseEnv, freshDb, stubLine, signedRequest, ev, postback, answer, user, logs,
  OWNER, OTHER, CRON_SECRET, ADMIN_TOKEN,
} from './helpers.js';
import { POST as webhook } from '../api/line/webhook.js';
import { GET as cron } from '../api/cron/parent-line-education.js';
import { GET as cta } from '../api/line/cta.js';
import { GET as adminUsers } from '../api/admin/line/users.js';
import { POST as adminApplied } from '../api/admin/line/diagnosis-applied.js';
import { runEducation } from '../api/_lib/education.js';
import { sendMode, sendPermission } from '../api/_lib/config.js';
import { EDUCATION_STEPS } from '../api/_lib/messages.js';

let db;
let calls;
beforeEach(async () => {
  baseEnv();
  db = await freshDb();
  calls = stubLine();
});

const send = (...events) => webhook(signedRequest({ destination: 'Uxxx', events }));
const DAY = 86_400_000;

async function completeSegmentation(userId) {
  await send(ev('follow', userId));
  await send(answer(userId, 'grade', 'grade_1'));
  await send(answer(userId, 'exam_intent', 'planned'));
  await send(answer(userId, 'interest', 'study_habits'));
}

async function shiftStart(userId, daysAgo) {
  await db.query(`update parent_line_users set education_started_at = now() - ($2 || ' days')::interval where line_user_id = $1`, [userId, String(daysAgo)]);
}

const cronReq = (auth = `Bearer ${CRON_SECRET}`, qs = '') =>
  new Request(`https://example.test/api/cron/parent-line-education${qs}`, { headers: auth ? { authorization: auth } : {} });

// ---------- 署名検証 ----------

test('Webhook検証（events空・正しい署名）は200', async () => {
  const res = await send();
  assert.equal(res.status, 200);
});

test('不正署名は401で拒否され、DBに何も書かれない', async () => {
  const res = await webhook(signedRequest({ events: [ev('follow', OWNER)] }, { secret: 'wrong' }));
  assert.equal(res.status, 401);
  const res2 = await webhook(signedRequest({ events: [ev('follow', OWNER)] }, { signature: '' }));
  assert.equal(res2.status, 401);
  assert.equal(await user(db, OWNER), undefined);
});

test('巨大なbodyは413', async () => {
  const req = new Request('https://example.test/api/line/webhook', {
    method: 'POST', headers: { 'x-line-signature': 'x' }, body: 'a'.repeat(300 * 1024),
  });
  assert.equal((await webhook(req)).status, 413);
});

// ---------- follow / unfollow ----------

test('follow: userIdとdisplayNameを保存。disabledでは返信しない', async () => {
  await send(ev('follow', OWNER));
  const u = await user(db, OWNER);
  assert.ok(u.followed_at);
  assert.equal(u.display_name, 'テスト保護者');
  assert.equal(calls.sends().length, 0);
});

test('unfollow: blocked_atを記録、再followで解除', async () => {
  await send(ev('follow', OWNER));
  await send(ev('unfollow', OWNER));
  assert.ok((await user(db, OWNER)).blocked_at);
  await send(ev('follow', OWNER));
  assert.equal((await user(db, OWNER)).blocked_at, null);
});

// ---------- 3問セグメント ----------

test('Q1→Q2→Q3の遷移（testモード・運営者のみ実送信）', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER });
  await send(ev('follow', OWNER));
  let last = calls.sends().at(-1).body.messages.at(-1);
  assert.match(last.text, /^Q1\./);
  assert.equal(last.quickReply.items.length, 5);
  assert.equal(last.quickReply.items[1].action.data, 'action=segment&question=grade&value=grade_1');

  await send(answer(OWNER, 'grade', 'grade_1'));
  last = calls.sends().at(-1).body.messages.at(-1);
  assert.match(last.text, /^Q2\./);

  await send(answer(OWNER, 'exam_intent', 'considering_high'));
  last = calls.sends().at(-1).body.messages.at(-1);
  assert.match(last.text, /^Q3\./);

  await send(answer(OWNER, 'interest', 'parenting_communication'));
  const final = calls.sends().at(-1).body.messages;
  assert.match(final[0].text, /^ありがとうございます。/);
  assert.match(final[1].text, /【1日目】/);

  const u = await user(db, OWNER);
  assert.deepEqual([u.grade, u.exam_intent, u.interest], ['grade_1', 'considering_high', 'parenting_communication']);
  assert.ok(u.segmentation_completed_at);
  assert.ok(u.education_started_at);
  assert.equal(u.education_step, 1, 'Day0送信済みで次はDay1');
  assert.equal((await logs(db, OWNER))[0].status, 'sent');
});

test('disabledモード: 3問は保存・完了するが一切送信せず、Day0は未送信のまま', async () => {
  await completeSegmentation(OWNER);
  const u = await user(db, OWNER);
  assert.ok(u.segmentation_completed_at);
  assert.equal(u.education_step, 0);
  assert.equal((await logs(db, OWNER))[0].status, 'skipped_disabled');
  assert.equal(calls.sends().length, 0);
});

test('不正なpostback値は無視され保存されない', async () => {
  await send(ev('follow', OWNER));
  await send(answer(OWNER, 'grade', 'grade_99'));
  await send(answer(OWNER, 'hacked_column', 'x'));
  await send(postback(OWNER, 'action=segment&question=grade&value=grade_1;drop table x'));
  assert.equal((await user(db, OWNER)).grade, null);
});

test('再回答: 最新値で上書き、教育は再開始しない', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER });
  await completeSegmentation(OWNER);
  const before = await user(db, OWNER);
  await send(answer(OWNER, 'grade', 'grade_2'));
  assert.match(calls.sends().at(-1).body.messages.at(-1).text, /^Q2\./, '途中の質問なら次を順に出す');
  await send(answer(OWNER, 'interest', 'exam_decision'));
  assert.match(calls.sends().at(-1).body.messages[0].text, /更新しました/);
  const after = await user(db, OWNER);
  assert.equal(after.grade, 'grade_2');
  assert.equal(after.interest, 'exam_decision');
  assert.equal(after.segmentation_completed_at.getTime(), before.segmentation_completed_at.getTime());
  assert.equal((await logs(db, OWNER)).length, 1, 'Day0は1回だけ');
});

test('既存友だち: キーワード「3問に回答する」またはstart postbackでQ1', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER });
  await send(ev('message', OWNER, { message: { type: 'text', id: '1', text: '3問に回答する' } }));
  assert.match(calls.sends().at(-1).body.messages[0].text, /^Q1\./);
  await send(postback(OWNER, 'action=segment&question=start'));
  assert.match(calls.sends().at(-1).body.messages[0].text, /^Q1\./);
  await send(ev('message', OWNER, { message: { type: 'text', id: '2', text: 'こんにちは' } }));
  assert.equal(calls.sends().length, 2, '通常メッセージには反応しない');
});

// ---------- 送信モード ----------

test('送信モード判定', async () => {
  baseEnv({ LINE_SEND_MODE: '' });
  assert.equal(sendMode(), 'disabled');
  baseEnv({ LINE_SEND_MODE: 'typo' });
  assert.equal(sendMode(), 'disabled');
  baseEnv({ LINE_SEND_MODE: 'production', LINE_SEND_ENABLED: 'false' });
  assert.equal(sendMode(), 'disabled', 'productionはLINE_SEND_ENABLED=trueも必要');
  baseEnv({ LINE_SEND_MODE: 'production', LINE_SEND_ENABLED: 'true' });
  assert.equal(sendMode(), 'production');
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: `${OWNER}, invalid` });
  assert.deepEqual(await sendPermission(OWNER), { ok: true });
  assert.deepEqual(await sendPermission(OTHER), { ok: false, reason: 'skipped_not_test_user' });
});

test('testモード: テスト対象外ユーザーには返信・Cronとも送らない', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER });
  await completeSegmentation(OTHER);
  await shiftStart(OTHER, 1);
  await runEducation();
  assert.equal(calls.sends().length, 0);
  const u = await user(db, OTHER);
  assert.equal(u.education_step, 0);
  assert.equal((await logs(db, OTHER))[0].status, 'skipped_not_test_user');
});

// ---------- 教育Cron ----------

test('Cron認証: トークンなし・誤りは401', async () => {
  assert.equal((await cron(cronReq(null))).status, 401);
  assert.equal((await cron(cronReq('Bearer wrong'))).status, 401);
  process.env.CRON_SECRET = '';
  assert.equal((await cron(cronReq('Bearer '))).status, 401, '未設定なら常に拒否');
});

test('Cron: 経過日数に応じて1日1ステップ、二重送信しない', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER });
  await completeSegmentation(OWNER); // Day0送信済み, step=1
  const before = calls.sends().length;

  let r = await (await cron(cronReq())).json();
  assert.equal(r.results.not_due, 1, '当日はDay1対象外');

  await shiftStart(OWNER, 1);
  r = await (await cron(cronReq())).json();
  assert.equal(r.results.sent, 1);
  assert.match(calls.sends().at(-1).body.messages[0].text, /【2日目】/);
  assert.ok(calls.sends().at(-1).headers['x-line-retry-key'], 'pushにはretry keyを付与');

  r = await (await cron(cronReq())).json();
  assert.equal(r.results.not_due, 1, '同じ日に再実行してもDay2は送らない');

  // 大きく遅れていても1回1ステップ
  await shiftStart(OWNER, 10);
  await cron(cronReq());
  assert.equal(calls.sends().length, before + 2);
  assert.equal((await user(db, OWNER)).education_step, 3);
});

test('Cron: ステップが巻き戻っても送信済みログで二重送信を防ぐ', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER });
  await completeSegmentation(OWNER);
  await shiftStart(OWNER, 1);
  await runEducation();
  const n = calls.sends().length;
  await db.query('update parent_line_users set education_step = 1 where line_user_id = $1', [OWNER]);
  const r = await runEducation();
  assert.equal(r.results.already_sent, 1);
  assert.equal(calls.sends().length, n);
  assert.equal((await user(db, OWNER)).education_step, 2, 'ステップは修復される');
});

test('Cron: disabledでは対象抽出と送信予定ログのみ、ステップは進まない。dryRunはログも書かない', async () => {
  await completeSegmentation(OWNER);
  await shiftStart(OWNER, 3);
  let r = await (await cron(cronReq(undefined, '?dryRun=1'))).json();
  assert.equal(r.results.dry_run, 1);
  assert.equal((await logs(db, OWNER)).length, 1);

  r = await (await cron(cronReq())).json();
  assert.equal(r.mode, 'disabled');
  assert.equal(r.results.skipped_disabled, 1);
  assert.equal(calls.sends().length, 0);
  assert.equal((await user(db, OWNER)).education_step, 0);

  // その後testモードに切り替えると、skippedだったDay0から送られる
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER });
  r = await runEducation();
  assert.equal(r.results.sent, 1);
  assert.match(calls.sends()[0].body.messages[0].text, /【1日目】/);
});

test('Cron: 送信失敗はfailed記録、次回同じretry keyで再送', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER });
  await completeSegmentation(OWNER);
  await shiftStart(OWNER, 1);
  calls = stubLine({ status: () => 500 });
  let r = await runEducation();
  assert.equal(r.results.failed, 1);
  const key1 = calls.sends()[0].headers['x-line-retry-key'];
  assert.equal((await user(db, OWNER)).education_step, 1);

  calls = stubLine();
  r = await runEducation();
  assert.equal(r.results.sent, 1);
  assert.equal(calls.sends()[0].headers['x-line-retry-key'], key1);
});

test('ブロック中・未完了ユーザーはCron対象外', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: `${OWNER},${OTHER}` });
  await completeSegmentation(OWNER);
  await send(ev('unfollow', OWNER));
  await send(ev('follow', OTHER));
  await send(answer(OTHER, 'grade', 'grade_1'));
  const r = await runEducation({ now: new Date(Date.now() + 5 * DAY) });
  assert.equal(r.candidates, 0);
});

// ---------- CTA ----------

async function advanceTo(userId, step) {
  await db.query('update parent_line_users set education_step = $2 where line_user_id = $1', [userId, step]);
  await shiftStart(userId, 10);
}
const CTA_STEP = EDUCATION_STEPS.findIndex((s) => s.cta);

test('CTA: 診断ボタンはトークン付きリダイレクトURL（userIdを含まない）', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER });
  await completeSegmentation(OWNER);
  await advanceTo(OWNER, CTA_STEP);
  const r = await runEducation();
  assert.equal(r.results.sent, 1);
  const flex = calls.sends().at(-1).body.messages[1];
  const uri = flex.contents.footer.contents[0].action.uri;
  const u = await user(db, OWNER);
  assert.equal(uri, `https://example.test/api/line/cta?t=${u.cta_token}`);
  assert.ok(!uri.includes(OWNER));
  assert.equal(u.education_step, EDUCATION_STEPS.length);
});

test('CTA: 申込URL未設定なら送らず保留', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER, PARENT_DIAGNOSIS_URL: '' });
  await completeSegmentation(OWNER);
  await advanceTo(OWNER, CTA_STEP);
  const r = await runEducation();
  assert.equal(r.results.held_missing_cta_config, 1);
  assert.equal((await user(db, OWNER)).education_step, CTA_STEP);
});

test('CTA: 診断申込済みユーザーには送らない', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER });
  await completeSegmentation(OWNER);
  await advanceTo(OWNER, CTA_STEP);
  await db.query('update parent_line_users set diagnosis_applied_at = now() where line_user_id = $1', [OWNER]);
  const n = calls.sends().length;
  const r = await runEducation();
  assert.equal(r.results.skipped_already_applied, 1);
  assert.equal(calls.sends().length, n);
});

test('CTAクリック: 記録して申込URLへ302。不正トークンでも遷移のみ', async () => {
  await completeSegmentation(OWNER);
  const u = await user(db, OWNER);
  let res = await cta(new Request(`https://example.test/api/line/cta?t=${u.cta_token}`));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://forms.example.test/diagnosis');
  const clicked = (await user(db, OWNER)).diagnosis_cta_clicked_at;
  assert.ok(clicked);
  await cta(new Request(`https://example.test/api/line/cta?t=${u.cta_token}`));
  assert.equal((await user(db, OWNER)).diagnosis_cta_clicked_at.getTime(), clicked.getTime(), '初回クリック日時を保持');
  const { rows } = await db.query(`select count(*)::int as n from parent_line_events where event_type = 'cta_click'`);
  assert.equal(rows[0].n, 2, '全クリックは行動履歴に残る');

  res = await cta(new Request('https://example.test/api/line/cta?t=not-a-token'));
  assert.equal(res.status, 302);
});

// ---------- 管理API ----------

const adminReq = (path, init = {}, token = ADMIN_TOKEN) =>
  new Request(`https://example.test${path}`, { ...init, headers: { ...(init.headers || {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } });

test('管理API: 認証なしは401', async () => {
  assert.equal((await adminUsers(adminReq('/api/admin/line/users', {}, null))).status, 401);
  assert.equal((await adminApplied(adminReq('/api/admin/line/diagnosis-applied', { method: 'POST', body: '{}' }, 'x'))).status, 401);
});

test('管理API: セグメント抽出と申込済み登録', async () => {
  await completeSegmentation(OWNER); // grade_1 / planned
  await send(ev('follow', OTHER));
  await send(answer(OTHER, 'grade', 'grade_3'));

  const q = '/api/admin/line/users?grade=grade_1,grade_2&exam_intent=planned,considering_high&diagnosis_applied=false';
  let body = await (await adminUsers(adminReq(q))).json();
  assert.equal(body.count, 1);
  assert.equal(body.users[0].line_user_id, undefined, 'userIdは返さない');

  const res = await adminApplied(adminReq('/api/admin/line/diagnosis-applied', {
    method: 'POST', body: JSON.stringify({ id: body.users[0].id }),
  }));
  assert.equal(res.status, 200);
  body = await (await adminUsers(adminReq(q))).json();
  assert.equal(body.count, 0, '申込済みは除外');

  assert.equal((await adminUsers(adminReq('/api/admin/line/users?grade=bad'))).status, 400);
});

test('LINE送信APIはreply/pushのみ（broadcast/multicastを呼ばない）', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER });
  await completeSegmentation(OWNER);
  await shiftStart(OWNER, 1);
  await runEducation();
  for (const c of calls.sends()) assert.match(c.url, /\/message\/(reply|push)$/);
});

// ---------- LINEからのテスト用アカウント登録 ----------

const CODE = 'test-register-code-1234567890';
const text = (userId, t) => ev('message', userId, { message: { type: 'text', id: '1', text: t } });
const registered = async (userId) =>
  (await db.query('select 1 from parent_line_test_users where line_user_id = $1', [userId])).rows.length > 0;

test('テスト登録: 正しい合言葉で登録され、その人にだけ送れる', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_REGISTER_CODE: CODE });
  await send(text(OWNER, `テスト登録 ${CODE}`));
  assert.ok(await registered(OWNER));
  assert.match(calls.sends().at(-1).body.messages[0].text, /テスト用アカウントとして登録しました/);

  await send(text(OWNER, '3問に回答する'));
  assert.match(calls.sends().at(-1).body.messages[0].text, /^Q1\./);

  const n = calls.sends().length;
  await send(text(OTHER, '3問に回答する'));
  assert.equal(calls.sends().length, n, '未登録ユーザーには送らない');
});

test('テスト登録: 合言葉違い・未設定・短すぎは登録されず無反応', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_REGISTER_CODE: CODE });
  await send(text(OTHER, 'テスト登録 wrong-code'));
  await send(text(OTHER, 'テスト登録'));
  baseEnv({ LINE_SEND_MODE: 'test' });
  await send(text(OTHER, 'テスト登録 '));
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_REGISTER_CODE: 'short' });
  await send(text(OTHER, 'テスト登録 short'));
  assert.equal(await registered(OTHER), false);
  assert.equal(calls.sends().length, 0);
});

test('テスト登録: disabledでは登録だけされ、返信も送らない', async () => {
  baseEnv({ LINE_TEST_REGISTER_CODE: CODE });
  await send(text(OWNER, `テスト登録 ${CODE}`));
  assert.ok(await registered(OWNER));
  assert.equal(calls.sends().length, 0);
});

test('テスト解除: 解除の返信後、以降は送らない', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_REGISTER_CODE: CODE });
  await send(text(OWNER, `テスト登録 ${CODE}`));
  await send(text(OWNER, 'テスト解除'));
  assert.match(calls.sends().at(-1).body.messages[0].text, /解除しました/);
  assert.equal(await registered(OWNER), false);
  const n = calls.sends().length;
  await send(text(OWNER, '3問に回答する'));
  await send(text(OTHER, 'テスト解除'));
  assert.equal(calls.sends().length, n);
});
