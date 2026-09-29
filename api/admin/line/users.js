// GET /api/admin/line/users — セグメント抽出（読み取り専用・送信はしない）
// 認証: Authorization: Bearer <ADMIN_API_TOKEN>
// 例: ?education_stage=preschool,elementary_lower&count_min=5&diagnosis_applied=false
//     ?parenting_check_sheet=present_2&manual_followup_status=pending
// レスポンスに LINE userId は含めない（内部IDのみ）。

import { checkBearer, json } from '../../_lib/auth.js';
import { getDb } from '../../_lib/db.js';
import { buildSegmentQuery } from '../../_lib/segments.js';

export async function GET(request) {
  if (!checkBearer(request, 'ADMIN_API_TOKEN')) return json({ error: 'unauthorized' }, 401);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  let q;
  try {
    q = buildSegmentQuery(params, { limit: params.limit });
  } catch (err) {
    return json({ error: err.message }, 400);
  }
  const db = getDb();
  const [{ rows: [c] }, { rows }] = await Promise.all([db.query(q.countSql, q.params), db.query(q.listSql, q.params)]);
  return json({ count: c.count, users: rows });
}
