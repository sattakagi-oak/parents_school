// 個別診断レポートの記入リマインド（美穂先生あて）。毎朝8時（無料講座の朝リマインドと同じ cron）に動く。
//   面談日の翌朝: 「昨日面談した〇〇さんのレポート記入をお願いします」
//   それでも未送付なら2日後にもう一度（最大2回）
// 面談日時を登録していないレポートは対象外。

import { getDb } from './db.js';
import { notifyAdmins } from './notify.js';
import { reportFormUrl } from './report-link.js';

export async function runReportReminders({ now = new Date() } = {}) {
  // 日本時間の今日0時
  const jstMidnight = new Date(Math.floor((now.getTime() + 9 * 3600e3) / 86400e3) * 86400e3 - 9 * 3600e3);
  const { rows } = await getDb().query(
    `select r.id, r.line_user_id, r.reminder_count, u.id as user_id
       from parent_diagnosis_reports r join parent_line_users u using (line_user_id)
      where r.status = 'draft' and r.interview_at is not null and r.interview_at < $1
        and (r.reminder_count = 0 or (r.reminder_count = 1 and r.last_reminded_at < $2))`,
    [jstMidnight, new Date(now.getTime() - 47 * 3600e3)]);
  const results = [];
  for (const r of rows) {
    const { rowCount } = await getDb().query(
      `update parent_diagnosis_reports set reminder_count = reminder_count + 1, last_reminded_at = $2
        where id = $1 and reminder_count = $3`, [r.id, now, r.reminder_count]);
    if (!rowCount) continue;
    const url = reportFormUrl(r.user_id, { now: now.getTime() });
    const lead = r.reminder_count === 0 ? '面談おつかれさまでした。レポートの記入をお願いします📝' : 'レポートがまだ未送付です。お手すきのときに記入をお願いします📝';
    results.push(await notifyAdmins(r.line_user_id, 'report_reminder', `${lead}${url ? `\n▶ ${url}` : ''}`));
  }
  return { candidates: rows.length, results };
}
