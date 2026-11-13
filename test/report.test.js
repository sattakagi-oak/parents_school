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
  for (const k of ['今回のお悩み', '自由型', 'このタイプに届きやすい関わり方', 'いまの関わり方の見立て', '「管理しすぎ」', '今日からできる3つの関わり方', '今日は何時から始める？', 'みほ先生から']) assert.ok(html.includes(k), k);
  for (const k of ['今伸びている力', '6〜12か月', 'まだ急がなくていいこと']) assert.ok(!html.includes(k), `出さない: ${k}`);
});
