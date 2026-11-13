// GET /api/report?t=<token> — 個別診断レポートを表示（本人用。推測できないtoken付きURL・検索に出さない）

import { getDb } from './_lib/db.js';
import { renderReport } from './_lib/report.js';
import { publicBaseUrl } from './_lib/config.js';

export async function GET(request) {
  const t = new URL(request.url).searchParams.get('t') || '';
  if (!/^[0-9a-f-]{36}$/i.test(t)) return new Response('not found', { status: 404 });
  const { rows } = await getDb().query('select report_no, data, status from parent_diagnosis_reports where token = $1', [t]);
  if (!rows[0]) return new Response('not found', { status: 404 });
  const { report_no, data, status } = rows[0];
  let html = renderReport({ ...data, report_no }, { base: publicBaseUrl() || '' });
  if (status === 'draft') html = html.replace('<div class="sheet">', '<div class="sheet"><div class="sample">下書き（まだ送っていません）</div>');
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
  });
}
