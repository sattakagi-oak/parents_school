// GET /api/cron/parent-line-education — Vercel Cron から1日1回呼ばれる。
// 認証: Authorization: Bearer <CRON_SECRET>（Vercel Cron が自動付与）
// ?dryRun=1 で対象抽出のみ（ログも書かない・送信しない）

import { checkBearer, json } from '../_lib/auth.js';
import { runEducation } from '../_lib/education.js';
import { log, errorSummary } from '../_lib/log.js';

export async function GET(request) {
  if (!checkBearer(request, 'CRON_SECRET')) return json({ error: 'unauthorized' }, 401);
  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
  const started = Date.now();
  try {
    const summary = await runEducation({ dryRun });
    log.info('education cron', { mode: summary.mode, count: summary.candidates, result: summary.results, durationMs: Date.now() - started });
    return json(summary);
  } catch (err) {
    log.error('education cron 失敗', { error: errorSummary(err) });
    return json({ error: 'failed' }, 500);
  }
}
