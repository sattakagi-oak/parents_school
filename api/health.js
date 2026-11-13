// GET /api/health — 確認用ブランチの設定チェック（値は返さない）。
// db: 接続先が未設定／つながらない／つながる。reports_table: 新しい表がある（=開発用DB）かどうか。
import { getDb } from './_lib/db.js';
import { secretEnv } from './_lib/config.js';

export async function GET() {
  const out = { database_url: Boolean(process.env.DATABASE_URL), admin_token_ok: secretEnv('ADMIN_API_TOKEN').length >= 32 };
  try {
    const { rows } = await getDb().query("select to_regclass('public.parent_diagnosis_reports') is not null as t");
    out.db = 'ok'; out.reports_table = rows[0].t;
  } catch { out.db = 'error'; }
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
