// GET /api/cron/report-reminders — 個別診断レポートの記入リマインド（美穂先生あて・毎日10時）
// Vercel Cron から呼ばれる。認証: Authorization: Bearer <CRON_SECRET>。&now=<ISO日時> で現在時刻を指定できる（動作確認用）

import { checkBearer, json } from '../_lib/auth.js';
import { runReportReminders } from '../_lib/report-reminders.js';
import { log, errorSummary } from '../_lib/log.js';

export async function GET(request) {
  if (!checkBearer(request, 'CRON_SECRET')) return json({ error: 'unauthorized' }, 401);
  const nowParam = new URL(request.url).searchParams.get('now');
  const now = nowParam ? new Date(nowParam) : new Date();
  if (Number.isNaN(now.getTime())) return json({ error: 'invalid now' }, 400);
  try {
    const summary = await runReportReminders({ now });
    log.info('report reminders', { result: summary.results, count: summary.candidates });
    return json(summary);
  } catch (err) {
    log.error('report reminders 失敗', { error: errorSummary(err) });
    return json({ error: 'failed' }, 500);
  }
}
