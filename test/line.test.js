import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import {
  baseEnv, freshDb, stubLine, signedRequest, ev, postback, user, logs,
  OWNER, OTHER, ADMIN_TOKEN,
} from './helpers.js';
import { POST as webhook } from '../api/line/webhook.js';
import { GET as cta } from '../api/line/cta.js';
import { GET as adminUsers } from '../api/admin/line/users.js';
import { POST as adminApplied } from '../api/admin/line/diagnosis-applied.js';
import { sendMode, sendPermission } from '../api/_lib/config.js';
import { setManualFollowup } from '../api/_lib/users.js';
import { STAGES, SHEETS } from '../api/_lib/messages.js';
import * as line from '../api/_lib/line.js';

let db;
let calls;
beforeEach(async () => {
  baseEnv();
  db = await freshDb();
  calls = stubLine();
});

const send = (...events) => webhook(signedRequest({ destination: 'Uxxx', events }));
const testMode = (extra = {}) => baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER, ...extra });
const text = (userId, t) => ev('message', userId, { message: { type: 'text', id: '1', text: t } });
const stage = (userId, value, extra = '') => postback(userId, `action=stage&value=${value}${extra}`);
const count = (userId, n) => postback(userId, `action=check_count&value=${n}`);
const lastMessages = () => calls.sends().at(-1).body.messages;
/** 年代ボタンFlexからactionを取り出す */
const stageActions = (msg) => msg.contents.body.contents.filter((c) => c.type === 'box').map((b) => b.action);

async function fullFlow(userId, stageValue = 'elementary_lower', n = 6) {
  await send(ev('follow', userId));
  await send(stage(userId, stageValue));
  await send(count(userId, n));
}

// ---------- 署名検証 ----------

test('Webhook検証（events空・正しい署名）は200', async () => {
  assert.equal((await send()).status, 200);
});

test('不正署名は401で拒否され、DBに何も書かれない', async () => {
  assert.equal((await webhook(signedRequest({ events: [ev('follow', OWNER)] }, { secret: 'wrong' }))).status, 401);
  assert.equal((await webhook(signedRequest({ events: [ev('follow', OWNER)] }, { signature: '' }))).status, 401);
  assert.equal(await user(db, OWNER), undefined);
});

test('巨大なbodyは413', async () => {
  const req = new Request('https://example.test/api/line/webhook', {
    method: 'POST', headers: { 'x-line-signature': 'x' }, body: 'a'.repeat(300 * 1024),
  });
  assert.equal((await webhook(req)).status, 413);
});

// ---------- 友だち追加 → 挨拶 ----------

test('follow: 新しい挨拶＋5つの学年ボタン（reply）。旧「個別相談希望 30分」案内は含まない', async () => {
  testMode();
  await send(ev('follow', OWNER));
  const u = await user(db, OWNER);
  assert.ok(u.followed_at);
  assert.equal(u.display_name, 'テスト保護者');
  assert.equal(u.manual_followup_status, null, '友だち追加だけでは対応待ちにしない');

  const last = calls.sends().at(-1);
  assert.match(last.url, /\/message\/reply$/);
  const [greeting, stages] = last.body.messages;
  assert.match(greeting.text, /^はじめまして、みほ先生です♪/);
  assert.match(greeting.text, /＼わが子をみずから伸びる子にする／\n「親の習慣」チェックリスト/);
  assert.match(greeting.text, /みほ先生が直接確認します😊$/);
  for (const ng of ['個別相談希望', '30分', '1,000円']) assert.ok(!greeting.text.includes(ng), ng);

  const actions = stageActions(stages);
  assert.deepEqual(actions.map((a) => a.data), [
    'action=stage&value=preschool', 'action=stage&value=elementary_lower', 'action=stage&value=elementary_middle',
    'action=stage&value=elementary_upper', 'action=stage&value=junior_high_plus',
  ]);
  assert.deepEqual(actions.map((a) => a.displayText), [
    '【学年】幼稚園・保育園', '【学年】小学校低学年', '【学年】小学校中学年', '【学年】小学校高学年', '【学年】中学生以上',
  ]);
  const flexText = JSON.stringify(stages);
  for (const sub of ['（小1〜2）', '（小3〜4）', '（小5〜6）']) assert.ok(flexText.includes(sub), sub);
});

test('disabledモード: follow・年代・個数はDBに保存されるが一切送信しない', async () => {
  await fullFlow(OWNER);
  const u = await user(db, OWNER);
  assert.equal(u.education_stage, 'elementary_lower');
  assert.equal(u.parenting_check_count, 6);
  assert.equal(u.manual_followup_status, 'pending');
  assert.equal(calls.sends().length, 0);
});

test('unfollow: blocked_atを記録、再followで解除。回答済みの人の再追加では挨拶を送り直さない', async () => {
  testMode();
  await fullFlow(OWNER);
  await send(ev('unfollow', OWNER));
  assert.ok((await user(db, OWNER)).blocked_at);
  const n = calls.sends().length;
  await send(ev('follow', OWNER));
  assert.equal((await user(db, OWNER)).blocked_at, null);
  assert.equal(calls.sends().length, n);
});

// ---------- 年代 → シート出し分け ----------

test('present_1 / present_2 の出し分け（5区分すべて）: 画像＋案内＋0〜10個ボタン', async () => {
  testMode();
  const expected = {
    preschool: 'present_1', elementary_lower: 'present_1',
    elementary_middle: 'present_2', elementary_upper: 'present_2', junior_high_plus: 'present_2',
  };
  for (const [value, sheet] of Object.entries(expected)) {
    await send(stage(OWNER, value));
    const u = await user(db, OWNER);
    assert.equal(u.education_stage, value);
    assert.equal(u.parenting_check_sheet, sheet, value);
    assert.equal(u.parenting_check_sheet_source, 'stage_button');

    const [image, guide] = lastMessages();
    const url = `https://example.test${SHEETS[sheet].path}`;
    assert.deepEqual(image, { type: 'image', originalContentUrl: url, previewImageUrl: url });
    assert.match(guide.text, /こちらのチェックリストを見ながら、\n10項目をチェックしてみてください。/);
    const items = guide.quickReply.items.map((i) => i.action);
    assert.equal(items.length, 11);
    assert.deepEqual(items.map((a) => a.label), ['0個', '1個', '2個', '3個', '4個', '5個', '6個', '7個', '8個', '9個', '10個']);
    assert.deepEqual(items.map((a) => a.data), Array.from({ length: 11 }, (_, n) => `action=check_count&value=${n}`));
    assert.equal(items[6].displayText, '【チェック数】6個');
  }
});

test('シート画像ファイルがリポジトリに存在する', async () => {
  for (const s of Object.values(SHEETS)) await access(new URL(`..${s.path}`, import.meta.url));
  assert.deepEqual(STAGES.map((s) => s.sheet), ['present_1', 'present_1', 'present_2', 'present_2', 'present_2']);
});

test('不正な年代・個数は保存しない', async () => {
  testMode();
  await send(ev('follow', OWNER));
  await send(stage(OWNER, 'grade_1'));
  await send(stage(OWNER, "preschool'; drop table x"));
  assert.equal((await user(db, OWNER)).education_stage, null);
  await send(stage(OWNER, 'preschool'));
  for (const bad of ['11', '-1', 'abc', '5.5', '']) await send(count(OWNER, bad));
  assert.equal((await user(db, OWNER)).parenting_check_count, null);
});

// ---------- チェック数 → お礼＋個別分析カード ----------

test('個数: 保存・pending・お礼＋「わが子の強み・伸ばし方 個別分析」カード（同じreply内）', async () => {
  testMode();
  await fullFlow(OWNER, 'elementary_lower', 6);
  const u = await user(db, OWNER);
  assert.equal(u.education_stage, 'elementary_lower');
  assert.equal(u.parenting_check_sheet, 'present_1');
  assert.equal(u.parenting_check_count, 6);
  assert.ok(u.parenting_check_answered_at);
  assert.equal(u.manual_followup_status, 'pending');

  const last = calls.sends().at(-1);
  assert.match(last.url, /\/message\/reply$/);
  assert.equal(last.body.messages.length, 2, '学年回答済みなので年代の追加質問はなし');
  const [thanks, card] = last.body.messages;
  assert.match(thanks.text, /ご回答ありがとうございます😊/);
  assert.match(thanks.text, /みほ先生が直接確認して、\n個別にコメントをお返しします。/);
  const cardText = JSON.stringify(card.contents);
  for (const s of ['わが子の強み・伸ばし方 個別分析', '30分 1,000円（延長あり）', '今のお子さんについてお話を伺いながら、',
    '今どんな力が伸びているか', 'お子さんの強み・得意', '次に何を伸ばすとよいか', '今やること／まだ急がなくていいこと',
    'お子さんに合った親の関わり方', '今後6〜12か月の方向性', 'を一緒に整理します。']) {
    assert.ok(cardText.includes(s), s);
  }
  const button = card.contents.footer.contents[0].action;
  assert.equal(button.label, '強みと伸ばし方を整理する');
  assert.equal(button.uri, `https://example.test/api/line/cta?t=${u.cta_token}`);
  const all = JSON.stringify(last.body.messages);
  for (const ng of ['個別相談', 'お悩み相談', OWNER]) assert.ok(!all.includes(ng), `含まない: ${ng}`);
});

test('個数の選び直し: 最新値で上書き、カードは再送せず「更新しました」のみ。対応状況は変えない', async () => {
  testMode();
  await fullFlow(OWNER, 'elementary_upper', 3);
  const before = await user(db, OWNER);
  await setManualFollowup(before.id, 'completed');
  await send(count(OWNER, 8));
  assert.match(lastMessages()[0].text, /チェック数を更新しました/);
  assert.equal(lastMessages().length, 1);
  const after = await user(db, OWNER);
  assert.equal(after.parenting_check_count, 8);
  assert.equal(after.parenting_check_answered_at.getTime(), before.parenting_check_answered_at.getTime());
  assert.equal(after.manual_followup_status, 'completed');
  assert.equal((await logs(db, OWNER)).length, 1);
});

test('シート未取得で個数ボタンが押されたら保存せず年代ボタンを出す', async () => {
  testMode();
  await send(ev('follow', OWNER));
  await send(count(OWNER, 4));
  assert.equal((await user(db, OWNER)).parenting_check_count, null);
  assert.equal(lastMessages()[0].altText, 'お子さんの学年を選んでください');
});

test('申込URL未設定・申込済みの人にはカードを出さない（お礼のみ）', async () => {
  testMode({ PARENT_DIAGNOSIS_URL: '' });
  await fullFlow(OWNER);
  assert.equal(lastMessages().length, 1);

  testMode();
  await send(ev('follow', OTHER));
  await db.query('update parent_line_users set diagnosis_applied_at = now() where line_user_id = $1', [OTHER]);
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OTHER });
  await send(stage(OTHER, 'preschool'));
  await send(count(OTHER, 2));
  assert.equal(lastMessages().length, 1);
});

test('個数回答後は自由入力にも自動返信しない（美穂先生の手動コメントを邪魔しない）', async () => {
  testMode();
  await fullFlow(OWNER);
  const n = calls.sends().length;
  await send(text(OWNER, '6個でした。朝の準備が気になっています'));
  await send(text(OWNER, '1'));
  await send(ev('message', OWNER, { message: { type: 'image', id: '2' } }));
  assert.equal(calls.sends().length, n);
});

// ---------- 旧導線（①/②）互換 ----------

test('旧入力 ①/1/１ → present_1、②/2/２ → present_2（シート未取得の人のみ）', async () => {
  const cases = [['①', 'present_1'], ['1', 'present_1'], ['１', 'present_1'], ['②', 'present_2'], ['2', 'present_2'], ['２', 'present_2']];
  for (const [input, sheet] of cases) {
    baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER });
    await db.query('delete from parent_line_users');
    await send(text(OWNER, input));
    const u = await user(db, OWNER);
    assert.equal(u.parenting_check_sheet, sheet, input);
    assert.equal(u.parenting_check_sheet_source, 'legacy_text');
    assert.equal(u.education_stage, null);
    const [image, guide] = lastMessages();
    assert.equal(image.originalContentUrl, `https://example.test${SHEETS[sheet].path}`);
    assert.equal(guide.quickReply.items.length, 11);
  }
});

test('旧入力の人: 個数回答後のカードの後に、任意で学年ボタン（シートは再送しない）', async () => {
  testMode();
  await send(text(OWNER, '②'));
  await send(count(OWNER, 5));
  const msgs = lastMessages();
  assert.equal(msgs.length, 3);
  assert.equal(msgs[2].altText, 'よろしければ、お子さんの学年も教えてください（任意）');
  const a = stageActions(msgs[2]);
  assert.equal(a[3].data, 'action=stage&value=elementary_upper&supplement=1');

  await send(stage(OWNER, 'elementary_upper', '&supplement=1'));
  const u = await user(db, OWNER);
  assert.equal(u.education_stage, 'elementary_upper');
  assert.equal(u.parenting_check_sheet, 'present_2');
  assert.equal(u.parenting_check_sheet_source, 'legacy_text');
  assert.match(lastMessages()[0].text, /学年を登録しました/);
  assert.equal(lastMessages().length, 1);
});

test('旧入力: シート取得済みの人の「1」「2」は無視（チェック数の手入力等は美穂先生が対応）', async () => {
  testMode();
  await send(ev('follow', OWNER));
  await send(stage(OWNER, 'elementary_middle'));
  const n = calls.sends().length;
  await send(text(OWNER, '1'));
  assert.equal(calls.sends().length, n);
  assert.equal((await user(db, OWNER)).parenting_check_sheet, 'present_2');
});

// ---------- 開発用トリガー ----------

test('「テスト開始」: テスト用ユーザーには挨拶＋学年ボタン。他人・productionでは無反応', async () => {
  testMode();
  await send(text(OWNER, 'テスト開始'));
  assert.match(lastMessages()[0].text, /^はじめまして、みほ先生です♪/);
  const n = calls.sends().length;
  await send(text(OTHER, 'テスト開始'));
  assert.equal(calls.sends().length, n);

  baseEnv({ LINE_SEND_MODE: 'production', LINE_SEND_ENABLED: 'true', LINE_TEST_USER_IDS: OWNER });
  await send(text(OWNER, 'テスト開始'));
  await send(text(OWNER, 'テストリセット'));
  assert.equal(calls.sends().length, n, 'productionでは開発トリガー無効');
});

test('「テストリセット」: テスト用ユーザーを友だち追加直後の状態に戻せる', async () => {
  testMode();
  await fullFlow(OWNER);
  await send(text(OWNER, 'テストリセット'));
  assert.match(lastMessages()[0].text, /リセットしました/);
  const u = await user(db, OWNER);
  for (const k of ['education_stage', 'parenting_check_sheet', 'parenting_check_count', 'parenting_check_answered_at', 'manual_followup_status', 'diagnosis_cta_clicked_at']) {
    assert.equal(u[k], null, k);
  }
  assert.equal((await logs(db, OWNER)).length, 0);
  await send(text(OWNER, 'テスト開始'));
  await send(stage(OWNER, 'preschool'));
  await send(count(OWNER, 1));
  assert.equal(lastMessages()[1].contents.body.contents[0].text, 'わが子の強み・伸ばし方 個別分析', 'リセット後はカードをもう一度確認できる');
});

const CODE = 'test-register-code-1234567890';
const registered = async (userId) =>
  (await db.query('select 1 from parent_line_test_users where line_user_id = $1', [userId])).rows.length > 0;

test('テスト登録: 正しい合言葉で登録。合言葉違い・未設定・短すぎは無反応', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_REGISTER_CODE: CODE });
  await send(text(OWNER, `テスト登録 ${CODE}`));
  assert.ok(await registered(OWNER));
  assert.match(lastMessages()[0].text, /テスト用アカウントとして登録しました/);
  const n = calls.sends().length;
  await send(text(OTHER, 'テスト登録 wrong-code'));
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_REGISTER_CODE: 'short' });
  await send(text(OTHER, 'テスト登録 short'));
  assert.equal(await registered(OTHER), false);
  assert.equal(calls.sends().length, n);
});

test('テスト解除: 解除の返信後、以降は送らない', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_REGISTER_CODE: CODE });
  await send(text(OWNER, `テスト登録 ${CODE}`));
  await send(text(OWNER, 'テスト解除'));
  assert.match(lastMessages()[0].text, /解除しました/);
  assert.equal(await registered(OWNER), false);
  const n = calls.sends().length;
  await send(text(OWNER, 'テスト開始'));
  assert.equal(calls.sends().length, n);
});

// ---------- 送信の安全制御 ----------

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

test('testモード: テスト対象外には follow返信・シート・個数お礼・カード・旧入力を含め一切送らず、止めた記録を残す', async () => {
  testMode();
  await fullFlow(OTHER);
  await send(text('U' + '3'.repeat(32), '①'));
  assert.equal(calls.sends().length, 0);
  assert.equal((await user(db, OTHER)).manual_followup_status, 'pending', 'DB保存はされる');
  const { rows } = await db.query(
    `select detail->>'message' m from parent_line_events where event_type = 'send_blocked' order by id`);
  assert.deepEqual(rows.map((r) => r.m), ['greeting', 'sheet:present_1', 'check:complete', 'sheet:present_1']);
  const sent = await db.query(`select count(*)::int n from parent_line_events where event_type = 'message_sent'`);
  assert.equal(sent.rows[0].n, 0);
});

test('送信はreplyのみ（push/broadcast/multicastの関数は存在しない）', async () => {
  assert.deepEqual(Object.keys(line).sort(), ['getDisplayName', 'replyMessage', 'verifySignature']);
  testMode();
  await fullFlow(OWNER);
  await send(text(OWNER, 'テスト開始'));
  for (const c of calls.sends()) assert.match(c.url, /\/message\/reply$/);
  const { rows } = await db.query(
    `select detail->>'message' m from parent_line_events where event_type = 'message_sent' order by id`);
  assert.deepEqual(rows.map((r) => r.m), ['greeting', 'sheet:present_1', 'check:complete', 'greeting']);
});

// ---------- CTAクリック ----------

test('CTAクリック: 初回日時を記録して申込URLへ302。URLにuserIdなし。クリックで自動送信しない', async () => {
  await fullFlow(OWNER);
  const u = await user(db, OWNER);
  let res = await cta(new Request(`https://example.test/api/line/cta?t=${u.cta_token}`));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://forms.example.test/diagnosis');
  const clicked = (await user(db, OWNER)).diagnosis_cta_clicked_at;
  assert.ok(clicked);
  await cta(new Request(`https://example.test/api/line/cta?t=${u.cta_token}`));
  assert.equal((await user(db, OWNER)).diagnosis_cta_clicked_at.getTime(), clicked.getTime(), '初回クリック日時を保持');
  res = await cta(new Request('https://example.test/api/line/cta?t=not-a-token'));
  assert.equal(res.status, 302);
  assert.equal(calls.sends().length, 0);
});

// ---------- 美穂先生の対応待ち ----------

test('対応待ち一覧ビュー: 個数回答済み・pendingのみ、新しい順。対応済みにすると外れる', async () => {
  await fullFlow(OWNER, 'preschool', 2);
  await fullFlow(OTHER, 'junior_high_plus', 9);
  await send(ev('follow', 'U' + '2'.repeat(32)));
  await send(stage('U' + '2'.repeat(32), 'elementary_lower')); // シートだけ → 一覧に出ない
  let { rows } = await db.query('select * from parent_line_pending_followups');
  assert.equal(rows.length, 2);
  assert.ok(rows[0].parenting_check_answered_at >= rows[1].parenting_check_answered_at);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'diagnosis_applied_at', 'diagnosis_cta_clicked_at', 'display_name', 'education_stage', 'id',
    'manual_followup_status', 'parenting_check_answered_at', 'parenting_check_count',
    'parenting_check_sheet', 'parenting_check_sheet_source',
  ]);
  const owner = await user(db, OWNER);
  await setManualFollowup(owner.id, 'completed');
  assert.ok((await user(db, OWNER)).manual_followup_completed_at);
  ({ rows } = await db.query('select * from parent_line_pending_followups'));
  assert.equal(rows.length, 1);
  await assert.rejects(setManualFollowup(owner.id, 'done'));
});

// ---------- 管理API ----------

const adminReq = (path, init = {}, token = ADMIN_TOKEN) =>
  new Request(`https://example.test${path}`, { ...init, headers: { ...(init.headers || {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } });

test('管理API: 認証なしは401', async () => {
  assert.equal((await adminUsers(adminReq('/api/admin/line/users', {}, null))).status, 401);
  assert.equal((await adminApplied(adminReq('/api/admin/line/diagnosis-applied', { method: 'POST', body: '{}' }, 'x'))).status, 401);
});

test('管理API: 年代・シート・個数・対応状況で抽出、申込済み登録で除外', async () => {
  await fullFlow(OWNER, 'elementary_lower', 7);
  await fullFlow(OTHER, 'elementary_upper', 2);

  const q = '/api/admin/line/users?education_stage=preschool,elementary_lower&count_min=5&diagnosis_applied=false';
  let body = await (await adminUsers(adminReq(q))).json();
  assert.equal(body.count, 1);
  assert.equal(body.users[0].line_user_id, undefined, 'userIdは返さない');
  assert.equal(body.users[0].parenting_check_count, 7);

  body = await (await adminUsers(adminReq('/api/admin/line/users?parenting_check_sheet=present_2&manual_followup_status=pending'))).json();
  assert.equal(body.count, 1);
  body = await (await adminUsers(adminReq('/api/admin/line/users?count_max=3'))).json();
  assert.equal(body.count, 1);

  body = await (await adminUsers(adminReq(q))).json();
  const res = await adminApplied(adminReq('/api/admin/line/diagnosis-applied', {
    method: 'POST', body: JSON.stringify({ id: body.users[0].id }),
  }));
  assert.equal(res.status, 200);
  assert.equal((await (await adminUsers(adminReq(q))).json()).count, 0);

  for (const bad of ['education_stage=grade_1', 'count_min=11', 'parenting_check_sheet=present_3', 'manual_followup_status=bad']) {
    assert.equal((await adminUsers(adminReq(`/api/admin/line/users?${bad}`))).status, 400, bad);
  }
});

test('Previewでは画像・CTAリンクにブランチ自身のURLを使う（PUBLIC_BASE_URLが本番URLでも）', async () => {
  testMode({
    PUBLIC_BASE_URL: 'https://parents-school.vercel.app',
    VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'parents-school-git-feature-x.vercel.app',
  });
  await send(ev('follow', OWNER));
  await send(stage(OWNER, 'preschool'));
  assert.equal(lastMessages()[0].originalContentUrl,
    'https://parents-school-git-feature-x.vercel.app/images/parent-check/present-1.png');
  await send(count(OWNER, 3));
  const u = await user(db, OWNER);
  assert.equal(lastMessages()[1].contents.footer.contents[0].action.uri,
    `https://parents-school-git-feature-x.vercel.app/api/line/cta?t=${u.cta_token}`);

  // production では Vercel の本番ドメインを使う（PUBLIC_BASE_URL が未設定・誤っていても）
  for (const pub of ['', 'https://wrong.example.com']) {
    testMode({ PUBLIC_BASE_URL: pub, VERCEL_ENV: 'production', VERCEL_BRANCH_URL: 'x.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'parents-school.vercel.app' });
    await send(stage(OWNER, 'junior_high_plus'));
    assert.equal(lastMessages()[0].originalContentUrl, 'https://parents-school.vercel.app/images/parent-check/present-2.png');
  }
  // Vercel 以外では PUBLIC_BASE_URL（スキーム省略・末尾スラッシュも補正）
  testMode({ PUBLIC_BASE_URL: 'parents-school.vercel.app/' });
  await send(stage(OWNER, 'preschool'));
  assert.equal(lastMessages()[0].originalContentUrl, 'https://parents-school.vercel.app/images/parent-check/present-1.png');
});
