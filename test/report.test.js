import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { baseEnv, freshDb, ADMIN_TOKEN, OWNER } from './helpers.js';
import { GET as adminGet, POST as adminPost } from '../api/admin/report.js';
import { GET as viewReport } from '../api/report.js';
import { renderReport, SAMPLE_REPORT } from '../api/_lib/report.js';

let db;
const req = (url, { token = ADMIN_TOKEN, body } = {}) => new Request(`https://example.test${url}`, {
  method: body ? 'POST' : 'GET',
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});

beforeEach(async () => {
  baseEnv();
  db = await freshDb();
  await db.query(`insert into parent_line_users (line_user_id, display_name, education_stage, parenting_check_sheet, parenting_check_count, parenting_check_answered_at, diagnosis_applied_at)
                  values ($1, 'テスト花子', 'elementary_middle', 'present_2', 7, now(), now())`, [OWNER]);
});

test('管理API: パスワードなしは拒否', async () => {
  assert.equal((await adminGet(req('/api/admin/report?action=candidates', { token: '' }))).status, 401);
  assert.equal((await adminPost(req('/api/admin/report', { token: 'x'.repeat(40), body: {} }))).status, 401);
});

test('候補一覧 → 自動入力（表示名・学年・チェック数・事前アンケート）。LINE userId は返さない', async () => {
  const list = await (await adminGet(req('/api/admin/report?action=candidates'))).json();
  assert.equal(list.users.length, 1);
  assert.ok(!JSON.stringify(list).includes(OWNER));
  const id = list.users[0].id;
  await db.query(`insert into parent_diagnosis_reports (line_user_id, survey) values ($1, $2)`, [OWNER, { worry: '宿題を始めない', child_name: 'ゆうくん' }]);
  const pre = await (await adminGet(req(`/api/admin/report?action=prefill&user=${id}`))).json();
  assert.equal(pre.auto.family_name, 'テスト花子');
  assert.equal(pre.auto.grade_label, '小学校中学年（小3〜4）');
  assert.equal(pre.auto.check_count, 7);
  assert.equal(pre.auto.worry, '宿題を始めない');
  assert.equal(pre.auto.child_name, 'ゆうくん');
});

test('下書き保存 → token付きURLで表示（エスケープ・下書き表示）。上書き保存できる', async () => {
  const { users: [u] } = await (await adminGet(req('/api/admin/report?action=candidates'))).json();
  const saved = await (await adminPost(req('/api/admin/report', { body: { user: u.id, data: { ...SAMPLE_REPORT, worry: '<script>x</script>' } } }))).json();
  assert.ok(saved.preview_url.includes('/api/report?t='));
  const again = await (await adminPost(req('/api/admin/report', { body: { user: u.id, report_id: saved.id, data: { ...SAMPLE_REPORT, family_name: '更新' } } }))).json();
  assert.equal(again.id, saved.id);
  const t = new URL(saved.preview_url, 'https://example.test').searchParams.get('t');
  const html = await (await viewReport(new Request(`https://example.test/api/report?t=${t}`))).text();
  assert.match(html, /更新 さま/);
  assert.match(html, /下書き（まだ送っていません）/);
  assert.equal((await viewReport(new Request('https://example.test/api/report?t=00000000-0000-0000-0000-000000000000'))).status, 404);
  const esc = renderReport({ ...SAMPLE_REPORT, worry: '<script>x</script>' });
  assert.ok(!esc.includes('<script>x'));
});

test('レポート: 親の関わり方の5項目（お悩み・タイプ・見立て・3つの関わり方・ひとこと）', () => {
  const html = renderReport(SAMPLE_REPORT);
  for (const k of ['今回のお悩み', '自由型', '好きなことには、2時間でも集中できる', 'このタイプに届きやすい関わり方', 'いまの関わり方の見立て', '「管理しすぎ」', '今日からできる3つの関わり方', '今日は何時から始める？', 'みほ先生から']) assert.ok(html.includes(k), k);
  for (const k of ['今伸びている力', '6〜12か月', 'まだ急がなくていいこと']) assert.ok(!html.includes(k), `出さない: ${k}`);
});

test('専用URL: その1人だけ開ける（一覧・他の人・期限切れ・改ざんは不可）', async () => {
  const { reportFormUrl } = await import('../api/_lib/report-link.js');
  const { users: [u] } = await (await adminGet(req('/api/admin/report?action=candidates'))).json();
  const url = new URL(reportFormUrl(u.id));
  const h = { 'x-report-user': u.id, 'x-report-exp': url.searchParams.get('exp'), 'x-report-key': url.searchParams.get('k') };
  const get = (q, headers) => adminGet(new Request(`https://example.test/api/admin/report?${q}`, { headers }));
  assert.equal((await get(`action=prefill&user=${u.id}`, h)).status, 200);
  assert.equal((await get('action=candidates', h)).status, 401, '一覧は見られない');
  assert.equal((await get('action=prefill&user=00000000-0000-0000-0000-000000000000', h)).status, 401, '他の人は見られない');
  assert.equal((await get(`action=prefill&user=${u.id}`, { ...h, 'x-report-key': 'f'.repeat(64) })).status, 401);
  const old = new URL(reportFormUrl(u.id, { now: Date.now() - 31 * 86400000 }));
  assert.equal((await get(`action=prefill&user=${u.id}`, { ...h, 'x-report-exp': old.searchParams.get('exp'), 'x-report-key': old.searchParams.get('k') })).status, 401, '期限切れ');
});

test('送信: 必須項目がないと送れない → 送ると1回だけ届き、送付済みは編集・再送できない', async () => {
  const { stubLine } = await import('./helpers.js');
  baseEnv({ LINE_SEND_MODE: 'test', LINE_TEST_USER_IDS: OWNER });
  const calls = stubLine();
  const { users: [u] } = await (await adminGet(req('/api/admin/report?action=candidates'))).json();
  const empty = await (await adminPost(req('/api/admin/report', { body: { user: u.id, data: { family_name: 'x' } } }))).json();
  assert.equal((await adminPost(req('/api/admin/report', { body: { action: 'send', user: u.id, report_id: empty.id } }))).status, 422);

  const saved = await (await adminPost(req('/api/admin/report', { body: { user: u.id, report_id: empty.id, data: SAMPLE_REPORT } }))).json();
  const res = await adminPost(req('/api/admin/report', { body: { action: 'send', user: u.id, report_id: saved.id } }));
  assert.equal(res.status, 200);
  const push = calls.sends().filter((c) => c.url.endsWith('/push'));
  assert.equal(push.length, 1);
  assert.equal(push[0].body.to, OWNER);
  assert.match(JSON.stringify(push[0].body.messages), /レポートを見る/);
  assert.equal((await adminPost(req('/api/admin/report', { body: { action: 'send', user: u.id, report_id: saved.id } }))).status, 409);
  assert.equal((await adminPost(req('/api/admin/report', { body: { user: u.id, report_id: saved.id, data: SAMPLE_REPORT } }))).status, 409);
  const t = new URL(saved.preview_url, 'https://example.test').searchParams.get('t');
  assert.doesNotMatch(await (await viewReport(new Request(`https://example.test/api/report?t=${t}`))).text(), /下書き/);
});

test('面談日時: 保存すると登録され、面談当日10時に1回・2日後にもう1回だけ記入リマインド（送付済みは対象外）', async () => {
  const { stubLine } = await import('./helpers.js');
  const { runReportReminders } = await import('../api/_lib/report-reminders.js');
  baseEnv({ LINE_SEND_MODE: 'production', LINE_SEND_ENABLED: 'true' });
  const calls = stubLine();
  const ADMIN = 'U' + 'a'.repeat(32);
  await db.query('insert into parent_line_notify_targets (line_user_id) values ($1)', [ADMIN]);
  const { users: [u] } = await (await adminGet(req('/api/admin/report?action=candidates'))).json();
  await adminPost(req('/api/admin/report', { body: { user: u.id, data: { interview_at: '2026-11-20T10:00' } } }));
  const { rows: [r] } = await db.query('select interview_at from parent_diagnosis_reports');
  assert.equal(r.interview_at.toISOString(), '2026-11-20T01:00:00.000Z');
  const pushes = () => calls.sends().filter((c) => c.url.endsWith('/push') && c.body.to === ADMIN).map((c) => c.body.messages[0].text);

  await runReportReminders({ now: new Date('2026-11-19T01:00:00Z') }); // 11/19 10:00 前日 → まだ
  assert.equal(pushes().length, 0);
  await runReportReminders({ now: new Date('2026-11-20T01:00:00Z') }); // 11/20 10:00 当日 → 1回目
  assert.equal(pushes().length, 1);
  await runReportReminders({ now: new Date('2026-11-21T01:00:00Z') }); // 11/21 まだ
  assert.equal(pushes().length, 1);
  await runReportReminders({ now: new Date('2026-11-22T01:00:00Z') }); // 11/22 2回目
  assert.equal(pushes().length, 2);
  await runReportReminders({ now: new Date('2026-11-24T01:00:00Z') }); // もう送らない
  const n = pushes();
  assert.equal(n.length, 2);
  assert.match(n[0], /本日10:00から個別診断です[\s\S]*\/admin\/report\/\?user=/);
  assert.match(n[1], /まだ未送付/);
});
