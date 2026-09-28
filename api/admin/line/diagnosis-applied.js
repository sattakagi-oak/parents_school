// POST /api/admin/line/diagnosis-applied — 診断申込済みの手動登録
// 認証: Authorization: Bearer <ADMIN_API_TOKEN>
// body: { "id": "<parent_line_users.id>" }            → 申込済みにする
//       { "id": "<parent_line_users.id>", "undo": true } → 取り消し

import { checkBearer, json } from '../../_lib/auth.js';
import { getDb } from '../../_lib/db.js';
import { recordEvent } from '../../_lib/users.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request) {
  if (!checkBearer(request, 'ADMIN_API_TOKEN')) return json({ error: 'unauthorized' }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (!UUID_RE.test(body?.id || '')) return json({ error: 'id (uuid) is required' }, 400);

  const undo = body.undo === true;
  const { rows } = await getDb().query(
    `update parent_line_users
        set diagnosis_applied_at = ${undo ? 'null' : 'coalesce(diagnosis_applied_at, now())'}, updated_at = now()
      where id = $1
      returning id, line_user_id, diagnosis_applied_at`,
    [body.id],
  );
  if (!rows[0]) return json({ error: 'not found' }, 404);
  await recordEvent(rows[0].line_user_id, undo ? 'diagnosis_applied_undo' : 'diagnosis_applied');
  return json({ id: rows[0].id, diagnosis_applied_at: rows[0].diagnosis_applied_at });
}
