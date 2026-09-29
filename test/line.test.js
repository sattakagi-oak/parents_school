import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseEnv, freshDb, stubLine, signedRequest, ev, postback, answer, user, logs,
  OWNER, OTHER, ADMIN_TOKEN,
} from './helpers.js';
import { POST as webhook } from '../api/line/webhook.js';
import { GET as cta } from '../api/line/cta.js';
import { GET as adminUsers } from '../api/admin/line/users.js';
import { POST as adminApplied } from '../api/admin/line/diagnosis-applied.js';
import { sendMode, sendPermission } from '../api/_lib/config.js';
import { setManualFollowup } from '../api/_lib/users.js';
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

async function completeSegmentation(userId) {
  await send(ev('follow', userId));
  await send(answer(userId, 'grade', 'grade_1'));
  await send(answer(userId, 'exam_intent', 'junior_exam_considering'));
  await send(answer(userId, 'interest', 'independent_thinking'));
}

/** 質問Flexから選択肢ボックスのactionを取り出す */
const optionActions = (msg) => msg.contents.body.contents.filter((c) => c.type === 'box').map((b) => b.action);
const lastMessages = () => calls.sends().at(-1).body.messages;

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

// ---------- follow / unfollow ----------

test('follow: userIdとdisplayNameを保存。友だち追加だけでは対応待ちにしない。disabledでは返信しない', async () => {
  await send(ev('follow', OWNER));
  const u = await user(db, OWNER);
  assert.ok(u.followed_at);
  assert.equal(u.display_name, 'テスト保護者');
  assert.equal(u.manual_followup_status, null);
  assert.equal(calls.sends().length, 0);
});

test('unfollow: blocked_atを記録、再followで解除', async () => {
  await send(ev('follow', OWNER));
  await send(ev('unfollow', OWNER));
  assert.ok((await user(db, OWNER)).blocked_at);
  await send(ev('follow', OWNER));
  assert.equal((await user(db, OWNER)).blocked_at, null);
});

// ---------- 3問アンケート ----------

test('Q1→Q2(小1用)→Q3: postbackで保存、displayTextでトーク画面に回答が残る', async () => {
  testMode();
  await send(ev('follow', OWNER));
  let msgs = lastMessages();
  assert.match(msgs[0].text, /ご登録ありがとうございます/);
  assert.equal(msgs[1].altText, 'Q1. お子さんの学年を教えてください。');
  let actions = optionActions(msgs[1]);
  assert.equal(actions.length, 5);
  assert.deepEqual(actions[1], {
    type: 'postback', label: '小1',
    data: 'action=segment&question=grade&value=grade_1', displayText: '【学年】小1',
  });

  await send(answer(OWNER, 'grade', 'grade_1'));
  assert.equal((await user(db, OWNER)).grade, 'grade_1');
  msgs = lastMessages();
  assert.equal(msgs[0].altText, 'Q2. これからの進路について、今のお考えに一番近いものを教えてください。');
  assert.equal(optionActions(msgs[0])[1].displayText, '【進路】中学受験も含めて幅広く検討している');
  assert.equal(optionActions(msgs[0])[1].data, 'action=segment&question=exam_intent&value=junior_exam_considering');

  await send(answer(OWNER, 'exam_intent', 'junior_exam_considering'));
  assert.equal((await user(db, OWNER)).exam_intent, 'junior_exam_considering');
  msgs = lastMessages();
  assert.equal(msgs[0].altText, 'Q3. これから、お子さんについて一番伸ばしていきたいことはどれですか？');
  const body = msgs[0].contents.body.contents;
  assert.ok(body.some((c) => c.text === '今困っていることではなく、「これからこうなってほしい」というお気持ちに近いもので大丈夫です。'));
  actions = optionActions(msgs[0]);
  assert.deepEqual(actions.map((a) => a.data.split('value=')[1]), [
    'independent_thinking', 'learning_habits', 'develop_strengths', 'expand_future_options', 'parenting_fit', 'what_to_prioritize',
  ]);
  assert.equal(actions[0].displayText, '【伸ばしたいこと】自分から考えて学ぶ力を伸ばしたい');

  await send(answer(OWNER, 'interest', 'independent_thinking'));
  assert.equal((await user(db, OWNER)).interest, 'independent_thinking');
  for (const a of actions) assert.ok(a.label.length <= 20, 'postback labelは20文字以内');
});

test('3問完了: pending・完了日時を記録し、Q3への返信で完了メッセージ＋診断CTA（1回のreplyのみ）', async () => {
  testMode();
  await completeSegmentation(OWNER);
  const u = await user(db, OWNER);
  assert.deepEqual([u.grade, u.exam_intent, u.interest], ['grade_1', 'junior_exam_considering', 'independent_thinking']);
  assert.ok(u.segmentation_completed_at);
  assert.equal(u.manual_followup_status, 'pending');
  assert.equal(u.manual_followup_completed_at, null);

  const last = calls.sends().at(-1);
  assert.match(last.url, /\/message\/reply$/, 'Q3への返信（reply）として送る');
  const [text, flex] = last.body.messages;
  assert.match(text.text, /いただいた内容は、美穂先生が直接確認します/);
  assert.match(text.text, /うちの子の場合、今どんなことを大切にするといい？/);
  assert.match(text.text, /このままLINEで一言送っていただいても大丈夫です/);
  const flexText = JSON.stringify(flex.contents);
  for (const s of ['わが子の伸ばし方 個別診断', '60分 1,000円', 'お子さんの強みや得意の伸ばし方',
    '今後6〜12か月の方向性', 'を一緒に整理します。', '個別診断の内容を見る']) {
    assert.ok(flexText.includes(s), s);
  }
  for (const ng of ['お悩み相談', '中学受験準備診断', '問題があります']) {
    assert.ok(!JSON.stringify(last.body.messages).includes(ng), `NG表現: ${ng}`);
  }
  assert.equal(flex.contents.footer.contents[0].action.uri, `https://example.test/api/line/cta?t=${u.cta_token}`);
  assert.ok(!flexText.includes(OWNER), 'URLにuserIdを載せない');

  assert.equal((await logs(db, OWNER)).find((l) => l.campaign_key === 'segment:complete').status, 'sent');
  assert.equal(calls.sends().length, 4, 'follow・Q1回答・Q2回答・Q3回答への返信だけ');
});

test('3問完了後は自動メッセージを一切送らない（自由入力も美穂先生の手動対応に任せる）', async () => {
  testMode();
  await completeSegmentation(OWNER);
  const n = calls.sends().length;
  await send(ev('message', OWNER, { message: { type: 'text', id: '1', text: '最近宿題でよく喧嘩になります' } }));
  await send(ev('message', OWNER, { message: { type: 'image', id: '2' } }));
  assert.equal(calls.sends().length, n);
  const { rows } = await db.query('select count(*)::int n from parent_line_message_logs');
  assert.equal(rows[0].n, 1, '送信ログは完了メッセージの1件のみ');
});

test('pushは存在しない: LINEクライアントに送信関数はreplyのみ', () => {
  assert.equal(line.pushMessage, undefined);
  assert.deepEqual(Object.keys(line).sort(), ['getDisplayName', 'replyMessage', 'verifySignature']);
});

test('申込URL未設定なら完了メッセージのみ（CTAなし）', async () => {
  testMode({ PARENT_DIAGNOSIS_URL: '' });
  await completeSegmentation(OWNER);
  const msgs = lastMessages();
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].text, /美穂先生が直接確認します/);
});

test('診断申込済みユーザーには診断CTAを出さない', async () => {
  testMode();
  await send(ev('follow', OWNER));
  await db.query('update parent_line_users set diagnosis_applied_at = now() where line_user_id = $1', [OWNER]);
  await send(answer(OWNER, 'grade', 'grade_1'));
  await send(answer(OWNER, 'exam_intent', 'junior_exam_planned'));
  await send(answer(OWNER, 'interest', 'learning_habits'));
  assert.equal(lastMessages().length, 1);
});

test('disabledモード: 3問は保存・完了・pendingになるが一切送信しない', async () => {
  await completeSegmentation(OWNER);
  const u = await user(db, OWNER);
  assert.ok(u.segmentation_completed_at);
  assert.equal(u.manual_followup_status, 'pending');
  assert.equal((await logs(db, OWNER))[0].status, 'skipped_disabled');
  assert.equal(calls.sends().length, 0);
});

test('不正なpostback値・旧選択肢の値は無視され保存されない', async () => {
  await send(ev('follow', OWNER));
  await send(answer(OWNER, 'grade', 'grade_99'));
  await send(answer(OWNER, 'hacked_column', 'x'));
  await send(answer(OWNER, 'interest', 'juku_timing'));
  await send(postback(OWNER, 'action=segment&question=grade&value=grade_1;drop table x'));
  const u = await user(db, OWNER);
  assert.equal(u.grade, null);
  assert.equal(u.interest, null);
});

test('再回答: 最新値で上書き、完了日時・対応状況・完了メッセージは変えない', async () => {
  testMode();
  await completeSegmentation(OWNER);
  const before = await user(db, OWNER);
  await setManualFollowup(before.id, 'completed');
  await send(answer(OWNER, 'grade', 'grade_2'));
  assert.match(lastMessages()[0].altText, /^Q2\./, '途中の質問なら次を順に出す');
  await send(answer(OWNER, 'interest', 'develop_strengths'));
  assert.match(lastMessages()[0].text, /更新しました/);
  const after = await user(db, OWNER);
  assert.equal(after.grade, 'grade_2');
  assert.equal(after.interest, 'develop_strengths');
  assert.equal(after.segmentation_completed_at.getTime(), before.segmentation_completed_at.getTime());
  assert.equal(after.manual_followup_status, 'completed');
  assert.equal((await logs(db, OWNER)).length, 1, '完了メッセージは1回だけ');
});

test('既存友だち: キーワード「3問に回答する」またはstart postbackでQ1', async () => {
  testMode();
  await send(ev('message', OWNER, { message: { type: 'text', id: '1', text: '3問に回答する' } }));
  assert.match(lastMessages()[0].altText, /^Q1\./);
  await send(postback(OWNER, 'action=segment&question=start'));
  assert.match(lastMessages()[0].altText, /^Q1\./);
  await send(ev('message', OWNER, { message: { type: 'text', id: '2', text: 'こんにちは' } }));
  assert.equal(calls.sends().length, 2, '通常メッセージには反応しない');
});

// ---------- 送信モード・テストユーザー限定 ----------

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

test('testモード: テスト対象外ユーザーには follow・質問・完了・CTA を含め一切送らず、止めた記録を残す', async () => {
  testMode();
  await completeSegmentation(OTHER);
  await send(ev('message', OTHER, { message: { type: 'text', id: '1', text: '3問に回答する' } }));
  assert.equal(calls.sends().length, 0);
  const u = await user(db, OTHER);
  assert.equal(u.manual_followup_status, 'pending', '回答の保存はされる');
  assert.equal((await logs(db, OTHER))[0].status, 'skipped_not_test_user');
  const { rows } = await db.query(
    `select event_type, count(*)::int n from parent_line_events
      where line_user_id = $1 and event_type in ('message_sent','send_blocked') group by 1`, [OTHER]);
  assert.deepEqual(rows, [{ event_type: 'send_blocked', n: 5 }]);
});

test('送信の記録: 実送信はmessage_sentとして残る（監査用）', async () => {
  testMode();
  await completeSegmentation(OWNER);
  const { rows } = await db.query(
    `select detail->>'message' m from parent_line_events where event_type = 'message_sent' order by id`);
  assert.deepEqual(rows.map((r) => r.m), ['segment:q1', 'segment:exam_intent', 'segment:interest', 'segment:complete']);
});

// ---------- CTAクリック ----------

test('CTAクリック: 初回日時を記録して申込URLへ302。不正トークンでも遷移のみ', async () => {
  await completeSegmentation(OWNER);
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
  assert.equal(calls.sends().length, 0, 'クリックで自動メッセージは送らない');
});

// ---------- 美穂先生の対応待ち ----------

test('対応待ち一覧ビュー: 3問完了・pendingのみ、新しい順。対応済みにすると外れる', async () => {
  await completeSegmentation(OWNER);
  await completeSegmentation(OTHER);
  await send(ev('follow', 'U' + '2'.repeat(32))); // 友だち追加のみ → 一覧に出ない
  let { rows } = await db.query('select * from parent_line_pending_followups');
  assert.equal(rows.length, 2);
  assert.ok(rows[0].segmentation_completed_at >= rows[1].segmentation_completed_at);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'diagnosis_applied_at', 'diagnosis_cta_clicked_at', 'display_name', 'education_path_intent', 'grade',
    'growth_interest', 'id', 'manual_followup_status', 'segmentation_completed_at',
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

test('管理API: セグメント抽出・対応待ち絞り込み・申込済み登録', async () => {
  await completeSegmentation(OWNER); // grade_1 / junior_exam_considering
  await send(ev('follow', OTHER));
  await send(answer(OTHER, 'grade', 'grade_3'));

  const q = '/api/admin/line/users?grade=grade_1,grade_2&exam_intent=junior_exam_planned,junior_exam_considering&diagnosis_applied=false';
  let body = await (await adminUsers(adminReq(q))).json();
  assert.equal(body.count, 1);
  assert.equal(body.users[0].line_user_id, undefined, 'userIdは返さない');
  assert.equal(body.users[0].manual_followup_status, 'pending');

  body = await (await adminUsers(adminReq('/api/admin/line/users?manual_followup_status=pending'))).json();
  assert.equal(body.count, 1);
  assert.equal(body.users[0].education_path_intent, 'junior_exam_considering');
  assert.equal(body.users[0].growth_interest, 'independent_thinking');
  body = await (await adminUsers(adminReq('/api/admin/line/users?interest=independent_thinking'))).json();
  assert.equal(body.count, 1);

  const res = await adminApplied(adminReq('/api/admin/line/diagnosis-applied', {
    method: 'POST', body: JSON.stringify({ id: body.users[0].id }),
  }));
  assert.equal(res.status, 200);
  body = await (await adminUsers(adminReq(q))).json();
  assert.equal(body.count, 0, '申込済みは除外');

  assert.equal((await adminUsers(adminReq('/api/admin/line/users?grade=bad'))).status, 400);
  assert.equal((await adminUsers(adminReq('/api/admin/line/users?manual_followup_status=bad'))).status, 400);
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
  assert.match(lastMessages()[0].text, /テスト用アカウントとして登録しました/);
  await send(text(OWNER, '3問に回答する'));
  assert.match(lastMessages()[0].altText, /^Q1\./);
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

test('テスト解除: 解除の返信後、以降は送らない', async () => {
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_REGISTER_CODE: CODE });
  await send(text(OWNER, `テスト登録 ${CODE}`));
  await send(text(OWNER, 'テスト解除'));
  assert.match(lastMessages()[0].text, /解除しました/);
  assert.equal(await registered(OWNER), false);
  const n = calls.sends().length;
  await send(text(OWNER, '3問に回答する'));
  assert.equal(calls.sends().length, n);
});

test('LINE送信APIはreplyのみ（push/broadcast/multicastを呼ばない）', async () => {
  testMode();
  await completeSegmentation(OWNER);
  for (const c of calls.sends()) assert.match(c.url, /\/message\/reply$/);
});

test('テストリセット: テスト用ユーザーだけ未回答に戻せる（他人・productionでは無効）', async () => {
  testMode();
  await completeSegmentation(OWNER);
  await send(text(OWNER, 'テストリセット'));
  assert.match(lastMessages()[0].text, /リセットしました/);
  let u = await user(db, OWNER);
  assert.deepEqual([u.grade, u.segmentation_completed_at, u.manual_followup_status], [null, null, null]);
  assert.equal((await logs(db, OWNER)).length, 0);
  await completeSegmentation(OWNER);
  assert.match(lastMessages()[0].text, /美穂先生が直接確認します/, 'リセット後は完了メッセージをもう一度確認できる');

  await completeSegmentation(OTHER);
  await send(text(OTHER, 'テストリセット'));
  assert.equal((await user(db, OTHER)).manual_followup_status, 'pending', 'テスト対象外は無効');

  baseEnv({ LINE_SEND_MODE: 'production', LINE_SEND_ENABLED: 'true', LINE_TEST_USER_IDS: OWNER });
  const n = calls.sends().length;
  await send(text(OWNER, 'テストリセット'));
  u = await user(db, OWNER);
  assert.equal(u.manual_followup_status, 'pending', 'productionでは無効');
  assert.equal(calls.sends().length, n);
});

// ---------- 学年別Q2 ----------

test('Q2は学年ごとに出し分ける（質問文・選択肢・内部値）', async () => {
  testMode();
  const cases = {
    preschool: ['これからのお子さんの学びについて、一番近いものを教えてください。',
      ['expand_future_options', 'junior_exam_considering', 'build_learning_foundation', 'not_decided_yet']],
    grade_1: ['これからの進路について、今のお考えに一番近いものを教えてください。',
      ['junior_exam_planned', 'junior_exam_considering', 'expand_future_options', 'public_school_main', 'not_decided_yet']],
    grade_2: ['これからの進路について、今のお考えに一番近いものを教えてください。',
      ['junior_exam_planned', 'junior_exam_considering', 'expand_future_options', 'public_school_main', 'not_decided_yet']],
    grade_3: ['これからの進路について、今のお考えに一番近いものを教えてください。',
      ['junior_exam_planned', 'junior_exam_considering', 'junior_exam_undecided', 'public_school_main', 'not_decided_yet']],
    grade_4_plus: ['現在の進路について、一番近いものを教えてください。',
      ['junior_exam_in_progress', 'junior_exam_considering', 'high_school_exam', 'not_decided_yet', 'other']],
  };
  for (const [grade, [text, values]] of Object.entries(cases)) {
    await send(postback(OWNER, 'action=segment&question=start'));
    await db.query('update parent_line_users set grade = null, exam_intent = null where line_user_id = $1', [OWNER]);
    await send(answer(OWNER, 'grade', grade));
    const msg = lastMessages()[0];
    assert.equal(msg.altText, `Q2. ${text}`, grade);
    assert.deepEqual(optionActions(msg).map((a) => a.data.split('value=')[1]), values, grade);
    for (const a of optionActions(msg)) assert.match(a.displayText, /^【進路】/);
  }
  assert.equal(optionActions(lastMessages()[0])[2].displayText, '【進路】高校受験を見据えている');
});

test('Q2: 学年に合わない値（古いボタン等）は保存せず、今の学年のQ2を出し直す。学年未回答ならQ1', async () => {
  testMode();
  await send(ev('follow', OWNER));
  await send(answer(OWNER, 'exam_intent', 'junior_exam_planned'));
  assert.equal((await user(db, OWNER)).exam_intent, null);
  assert.match(lastMessages()[0].altText, /^Q1\./, '学年未回答ならQ1を出す');

  await send(answer(OWNER, 'grade', 'preschool'));
  await send(answer(OWNER, 'exam_intent', 'high_school_exam')); // 小4以上用の値
  assert.equal((await user(db, OWNER)).exam_intent, null);
  assert.equal(lastMessages()[0].altText, 'Q2. これからのお子さんの学びについて、一番近いものを教えてください。');
});

test('学年を変えて既存のQ2回答が合わなくなったら、Q2を聞き直す', async () => {
  testMode();
  await send(ev('follow', OWNER));
  await send(answer(OWNER, 'grade', 'preschool'));
  await send(answer(OWNER, 'exam_intent', 'build_learning_foundation'));
  await send(answer(OWNER, 'grade', 'grade_4_plus'));
  assert.equal((await user(db, OWNER)).exam_intent, null);
  assert.equal(lastMessages()[0].altText, 'Q2. 現在の進路について、一番近いものを教えてください。');

  // 新しい学年でも有効な値なら保持
  await send(answer(OWNER, 'exam_intent', 'not_decided_yet'));
  await send(answer(OWNER, 'grade', 'grade_3'));
  assert.equal((await user(db, OWNER)).exam_intent, 'not_decided_yet');
  assert.match(lastMessages()[0].altText, /^Q3\./);
});
