// GET /api/admin/line/users — セグメント抽出（読み取り専用・送信はしない）
// 認証: Authorization: Bearer <ADMIN_API_TOKEN>
// 例: ?grade=grade_1,grade_2&exam_intent=junior_exam_planned,junior_exam_considering&diagnosis_applied=false
//     （exam_intent=進路・教育方針 / interest=伸ばしたいこと。レスポンスでは education_path_intent / growth_interest）
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
