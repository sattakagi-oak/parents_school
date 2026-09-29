// 管理用スクリプト（.env.local の DATABASE_URL を使用。LINE送信は一切しない）
//
//   npm run admin -- pending                          美穂先生の個別対応待ち一覧（新しい順・回答は日本語表示）
//   npm run admin -- followup-done <id>               個別対応済みにする
//   npm run admin -- followup-not-needed <id>         対応不要にする
//   npm run admin -- followup-pending <id>            対応待ちに戻す
//   npm run admin -- segment --grade=grade_1,grade_2 --exam_intent=planned,considering_high --diagnosis_applied=false
//   npm run admin -- segment --interest=parenting_communication
//   npm run admin -- mark-applied <id> / unmark-applied <id>   診断申込済みの登録・取消
//   npm run admin -- stats                            件数集計
//   npm run admin -- audit                            送信監査（テストユーザー以外への送信が0件か）
import { getDb } from '../api/_lib/db.js';
import { buildSegmentQuery } from '../api/_lib/segments.js';
import { setManualFollowup } from '../api/_lib/users.js';
import { QUESTIONS } from '../api/_lib/messages.js';
import { testUserIds } from '../api/_lib/config.js';

const [cmd, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const args = rest.filter((a) => !a.startsWith('--'));
const db = getDb();

const LABELS = Object.fromEntries(QUESTIONS.map((q) => [q.key, Object.fromEntries(q.options.map((o) => [o.value, o.label]))]));
const label = (key, value) => (value ? LABELS[key][value] || value : '');
const date = (d) => (d ? new Date(d).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '');

try {
  if (cmd === 'pending') {
    const { rows } = await db.query('select * from parent_line_pending_followups');
    console.log(`対応待ち: ${rows.length}件（新しい順）`);
    for (const r of rows) {
      console.log([
        '────────────────────────',
        `名前: ${r.display_name || '(不明)'}    id: ${r.id}`,
        `【学年】${label('grade', r.grade)}`,
        `【中学受験】${label('exam_intent', r.exam_intent)}`,
        `【気になること】${label('interest', r.interest)}`,
        `回答日時: ${date(r.segmentation_completed_at)}`,
        `診断CTAクリック: ${date(r.diagnosis_cta_clicked_at) || 'なし'}    診断申込: ${date(r.diagnosis_applied_at) || 'なし'}`,
      ].join('\n'));
    }
  } else if (['followup-done', 'followup-not-needed', 'followup-pending'].includes(cmd)) {
    const status = { 'followup-done': 'completed', 'followup-not-needed': 'not_needed', 'followup-pending': 'pending' }[cmd];
    console.log((await setManualFollowup(args[0], status)) ? `updated: ${status}` : 'not found');
  } else if (cmd === 'segment') {
    const q = buildSegmentQuery(flags, { limit: flags.limit });
    const { rows: [c] } = await db.query(q.countSql, q.params);
    const { rows } = await db.query(q.listSql, q.params);
    console.log(`count: ${c.count}`);
    console.table(rows.map(({ id, display_name, grade, exam_intent, interest, manual_followup_status, diagnosis_applied_at }) =>
      ({ id, display_name, grade, exam_intent, interest, followup: manual_followup_status, applied: Boolean(diagnosis_applied_at) })));
  } else if (cmd === 'mark-applied' || cmd === 'unmark-applied') {
    const value = cmd === 'mark-applied' ? 'coalesce(diagnosis_applied_at, now())' : 'null';
    const { rowCount } = await db.query(
      `update parent_line_users set diagnosis_applied_at = ${value}, updated_at = now() where id = $1`, [args[0]]);
    console.log(rowCount ? 'updated' : 'not found');
  } else if (cmd === 'stats') {
    const { rows } = await db.query(`
      select count(*)::int as users,
             count(segmentation_completed_at)::int as segmented,
             count(*) filter (where manual_followup_status = 'pending')::int as followup_pending,
             count(*) filter (where manual_followup_status = 'completed')::int as followup_completed,
             count(diagnosis_cta_clicked_at)::int as cta_clicked,
             count(diagnosis_applied_at)::int as applied,
             count(blocked_at)::int as blocked
        from parent_line_users`);
    console.table(rows);
  } else if (cmd === 'audit') {
    // 実送信（message_sent）と許可外で止めた送信（send_blocked）を、宛先がテスト用ユーザーかどうかで集計
    const { rows } = await db.query(
      `select event_type, detail->>'message' as message, to_test_user, count(*)::int as n
         from (select e.*, (e.line_user_id = any($1) or exists (
                 select 1 from parent_line_test_users t where t.line_user_id = e.line_user_id)) as to_test_user
                 from parent_line_events e
                where e.event_type in ('message_sent', 'send_blocked')) x
        group by 1, 2, 3 order by 1, 2, 3`, [[...testUserIds()]]);
    console.table(rows);
    const bad = rows.filter((r) => r.event_type === 'message_sent' && !r.to_test_user).reduce((a, r) => a + r.n, 0);
    console.log(`テストユーザー以外への実送信: ${bad}件`);
  } else {
    console.log('commands: pending | followup-done <id> | followup-not-needed <id> | followup-pending <id> | segment | mark-applied <id> | unmark-applied <id> | stats | audit');
  }
} finally {
  await db.end();
}
