// GET /api/line/cta?t=<cta_token>
// 診断CTAボタンのクリックを記録してから申込ページ（PARENT_DIAGNOSIS_URL）へリダイレクト。
// URLにLINE userIdは載せず、ユーザーごとのランダムなトークンで識別する。

import { getDb } from '../_lib/db.js';
import { diagnosisUrl } from '../_lib/config.js';
import { recordEvent } from '../_lib/users.js';
import { log, errorSummary } from '../_lib/log.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request) {
  const token = new URL(request.url).searchParams.get('t') || '';

  if (UUID_RE.test(token)) {
    try {
      const { rows } = await getDb().query(
        `update parent_line_users
            set diagnosis_cta_clicked_at = coalesce(diagnosis_cta_clicked_at, now()), updated_at = now()
          where cta_token = $1
          returning line_user_id`,
        [token],
      );
      if (rows[0]) await recordEvent(rows[0].line_user_id, 'cta_click', { cta: 'diagnosis' });
    } catch (err) {
      // 記録に失敗しても申込ページへの遷移は止めない
      log.error('CTAクリック記録失敗', { error: errorSummary(err) });
    }
  }

  const target = diagnosisUrl();
  const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
  if (!/^https:\/\//.test(target)) {
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>準備中</title><p style="font-family:sans-serif;padding:24px">お申し込みページは準備中です。恐れ入りますが、しばらくしてから再度お試しください。</p>',
      { status: 200, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } },
    );
  }
  return new Response(null, { status: 302, headers: { ...headers, location: target } });
}
