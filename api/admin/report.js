// 個別診断レポートの管理（みほ先生の入力画面から呼ぶ）。認証: Authorization: Bearer <ADMIN_API_TOKEN>
//   GET  ?action=candidates        入力候補の一覧（個別診断に申込済み・チェック回答済みの人）。LINE userId は返さない
//   GET  ?action=prefill&user=<id>  その人の自動入力（表示名・学年・チェック数・事前アンケート・下書き）
//   POST {user, report_id?, data}   下書き保存。プレビューURL（token付き）を返す
// LINEへの送信はまだ実装しない（本番公開の許可後に追加する）。

import { checkBearer, json } from '../_lib/auth.js';
import { getDb } from '../_lib/db.js';
import { stageLabel } from '../_lib/messages.js';
import { publicBaseUrl } from '../_lib/config.js';

const UUID = /^[0-9a-f-]{36}$/i;

async function userById(id) {
  if (!UUID.test(id || '')) return null;
  const { rows } = await getDb().query('select * from parent_line_users where id = $1', [id]);
  return rows[0] || null;
}

const previewUrl = (token) => `${publicBaseUrl() || ''}/api/report?t=${token}`;

export async function GET(request) {
  if (!checkBearer(request, 'ADMIN_API_TOKEN')) return json({ error: 'unauthorized' }, 401);
  const p = new URL(request.url).searchParams;
  const db = getDb();

  if (p.get('action') === 'candidates') {
    const { rows } = await db.query(
      `select u.id, u.display_name, u.education_stage, u.parenting_check_count,
              u.diagnosis_applied_at, u.parenting_check_answered_at,
              (select status from parent_diagnosis_reports r where r.line_user_id = u.line_user_id order by created_at desc limit 1) as report_status
         from parent_line_users u
        where u.blocked_at is null and (u.diagnosis_applied_at is not null or u.parenting_check_answered_at is not null)
        order by u.diagnosis_applied_at desc nulls last, u.parenting_check_answered_at desc
        limit 300`);
    return json({ users: rows.map((r) => ({ ...r, stage_label: r.education_stage ? stageLabel(r.education_stage) : null })) });
  }

  if (p.get('action') === 'prefill') {
    const u = await userById(p.get('user'));
    if (!u) return json({ error: 'not_found' }, 404);
    const { rows } = await db.query(
      'select id, report_no, token, survey, data, status from parent_diagnosis_reports where line_user_id = $1 order by created_at desc limit 1',
      [u.line_user_id]);
    const r = rows[0];
    const survey = r?.survey || {};
    const auto = {
      family_name: u.display_name || '',
      grade_label: u.education_stage ? stageLabel(u.education_stage) : '',
      child_name: survey.child_name || '',
      worry: survey.worry || '',
      check: { count: u.parenting_check_count ?? '' },
    };
    return json({
      auto, survey,
      report: r ? { id: r.id, report_no: r.report_no, status: r.status, data: r.data, preview_url: previewUrl(r.token) } : null,
    });
  }
  return json({ error: 'bad_request' }, 400);
}

export async function POST(request) {
  if (!checkBearer(request, 'ADMIN_API_TOKEN')) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const u = await userById(body.user);
  if (!u) return json({ error: 'not_found' }, 404);
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  if (JSON.stringify(data).length > 20000) return json({ error: 'too_large' }, 413);
  const db = getDb();
  let row;
  if (UUID.test(body.report_id || '')) {
    ({ rows: [row] } = await db.query(
      `update parent_diagnosis_reports set data = $3, updated_at = now()
        where id = $1 and line_user_id = $2 and status = 'draft' returning id, report_no, token, status`,
      [body.report_id, u.line_user_id, data]));
    if (!row) return json({ error: 'not_editable' }, 409);
  } else {
    ({ rows: [row] } = await db.query(
      'insert into parent_diagnosis_reports (line_user_id, data) values ($1, $2) returning id, report_no, token, status',
      [u.line_user_id, data]));
  }
  return json({ id: row.id, report_no: row.report_no, status: row.status, preview_url: previewUrl(row.token) });
}
