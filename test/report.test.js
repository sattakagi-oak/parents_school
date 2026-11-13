import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { baseEnv, freshDb, ADMIN_TOKEN, OWNER } from './helpers.js';
import { GET as adminGet, POST as adminPost } from '../api/admin/report.js';
import { GET as viewReport } from '../api/report.js';
import { renderReport, SAMPLE_REPORT, rankTypes } from '../api/_lib/report.js';

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
  assert.equal(pre.auto.check.count, 7);
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

test('見本: LINE用は途中で切り、続きは鍵付き＋「個別診断」と送る案内', () => {
  const teaser = renderReport(SAMPLE_REPORT, { mode: 'teaser', sample: true });
  assert.match(teaser, /この続きは、個別診断を受けた方だけに/);
  assert.match(teaser, /個別診断<\/b>と送るだけ/);
  assert.ok(!teaser.includes('今日は何時から始める？'), '3つのことの中身は見せない');
  assert.equal(rankTypes(SAMPLE_REPORT.types)[0].name, '自由型');
});
