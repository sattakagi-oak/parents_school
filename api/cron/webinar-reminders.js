// GET /api/cron/webinar-reminders?kind=day_before|morning|hour_before — 無料講座のリマインド送信
// Vercel Cron から呼ばれる。認証: Authorization: Bearer <CRON_SECRET>（Vercel Cron が自動付与）
// &now=<ISO日時> で現在時刻を指定できる（動作確認用。CRON_SECRET を知っている人だけが使える）
// WEBINAR_ENABLED=true にするまでは、テスト用ユーザーにしか送らない。
// kind=morning では、個別診断レポートの記入リマインド（美穂先生あて）も一緒に送る。

import { checkBearer, json } from '../_lib/auth.js';
import { runWebinarReminders, REMINDER_KINDS } from '../_lib/webinar.js';
import { log, errorSummary } from '../_lib/log.js';
import { runReportReminders } from '../_lib/report-reminders.js';

export async function GET(request) {
  if (!checkBearer(request, 'CRON_SECRET')) return json({ error: 'unauthorized' }, 401);
  const params = new URL(request.url).searchParams;
  const kind = params.get('kind');
  if (!REMINDER_KINDS.includes(kind)) return json({ error: 'invalid kind' }, 400);
  const nowParam = params.get('now');
  const now = nowParam ? new Date(nowParam) : new Date();
  if (Number.isNaN(now.getTime())) return json({ error: 'invalid now' }, 400);
  try {
    const summary = await runWebinarReminders(kind, { now });
    log.info('webinar reminders', { event: kind, result: summary.results, count: summary.candidates });
    // 朝の回では、個別診断レポートの記入リマインド（美穂先生あて）も送る。失敗しても無料講座側には影響させない
    if (kind === 'morning') {
      try { summary.report_reminders = await runReportReminders({ now }); } catch (err) { log.error('report reminders 失敗', { error: errorSummary(err) }); }
    }
    return json(summary);
  } catch (err) {
    log.error('webinar reminders 失敗', { event: kind, error: errorSummary(err) });
    return json({ error: 'failed' }, 500);
  }
}
