// 管理用スクリプト（.env.local の DATABASE_URL を使用。LINE送信は一切しない）
//
//   npm run admin -- segment --grade=grade_1,grade_2 --exam_intent=planned,considering_high --diagnosis_applied=false
//   npm run admin -- segment --interest=parenting_communication
//   npm run admin -- mark-applied <id>
//   npm run admin -- unmark-applied <id>
//   npm run admin -- stats
//   npm run admin -- education-dry-run     （Cronの対象抽出だけ確認。送信・ログ書き込みなし）
import { getDb } from '../api/_lib/db.js';
import { buildSegmentQuery } from '../api/_lib/segments.js';
import { runEducation } from '../api/_lib/education.js';

const [cmd, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const args = rest.filter((a) => !a.startsWith('--'));
const db = getDb();

try {
  if (cmd === 'segment') {
    const q = buildSegmentQuery(flags, { limit: flags.limit });
    const { rows: [c] } = await db.query(q.countSql, q.params);
    const { rows } = await db.query(q.listSql, q.params);
    console.log(`count: ${c.count}`);
    console.table(rows.map(({ id, display_name, grade, exam_intent, interest, education_step, diagnosis_applied_at }) =>
      ({ id, display_name, grade, exam_intent, interest, education_step, applied: Boolean(diagnosis_applied_at) })));
  } else if (cmd === 'mark-applied' || cmd === 'unmark-applied') {
    const value = cmd === 'mark-applied' ? 'coalesce(diagnosis_applied_at, now())' : 'null';
    const { rowCount } = await db.query(
      `update parent_line_users set diagnosis_applied_at = ${value}, updated_at = now() where id = $1`, [args[0]]);
    console.log(rowCount ? 'updated' : 'not found');
  } else if (cmd === 'stats') {
    const { rows } = await db.query(`
      select count(*)::int as users,
             count(segmentation_completed_at)::int as segmented,
             count(diagnosis_cta_clicked_at)::int as cta_clicked,
             count(diagnosis_applied_at)::int as applied,
             count(blocked_at)::int as blocked
        from parent_line_users`);
    console.table(rows);
    const { rows: steps } = await db.query(
      `select education_step, count(*)::int from parent_line_users where segmentation_completed_at is not null group by 1 order by 1`);
    console.table(steps);
  } else if (cmd === 'education-dry-run') {
    console.log(JSON.stringify(await runEducation({ dryRun: true }), null, 2));
  } else {
    console.log('commands: segment | mark-applied <id> | unmark-applied <id> | stats | education-dry-run');
  }
} finally {
  await db.end();
}
