// GET /api/cron/webinar-reminders?kind=day_before|morning|hour_before — 無料講座のリマインド送信
// Vercel Cron から呼ばれる。認証: Authorization: Bearer <CRON_SECRET>（Vercel Cron が自動付与）
// &now=<ISO日時> で現在時刻を指定できる（動作確認用。CRON_SECRET を知っている人だけが使える）
// WEBINAR_ENABLED=true にするまでは、テスト用ユーザーにしか送らない。

import { checkBearer, json } from '../_lib/auth.js';
import { runWebinarReminders, REMINDER_KINDS } from '../_lib/webinar.js';
import { log, errorSummary } from '../_lib/log.js';

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
    return json(summary);
  } catch (err) {
    log.error('webinar reminders 失敗', { event: kind, error: errorSummary(err) });
    return json({ error: 'failed' }, 500);
  }
}
