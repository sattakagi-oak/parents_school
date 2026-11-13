// 個別診断レポートの記入リマインド（美穂先生あて）。毎日10時（日本時間）に動く。
//   面談の当日10時: 「本日〇時から〇〇さんの個別診断です。終わったらレポートの記入をお願いします」
//   それでも未送付なら2日後の10時にもう一度（最大2回）
// 面談日時を登録していないレポートは対象外。

import { getDb } from './db.js';
import { notifyAdmins } from './notify.js';
import { reportFormUrl } from './report-link.js';

const H = 3600e3;
const jstTime = (d) => new Date(d.getTime() + 9 * H).toISOString().slice(11, 16);

export async function runReportReminders({ now = new Date() } = {}) {
  // 日本時間の翌日0時（＝今日までに面談がある人が対象）
  const tomorrow = new Date((Math.floor((now.getTime() + 9 * H) / 86400e3) + 1) * 86400e3 - 9 * H);
  const { rows } = await getDb().query(
    `select r.id, r.line_user_id, r.reminder_count, r.interview_at, u.id as user_id
       from parent_diagnosis_reports r join parent_line_users u using (line_user_id)
      where r.status = 'draft' and r.interview_at is not null and r.interview_at < $1
        and (r.reminder_count = 0 or (r.reminder_count = 1 and r.last_reminded_at < $2))`,
    [tomorrow, new Date(now.getTime() - 47 * H)]);
  const results = [];
  for (const r of rows) {
    const { rowCount } = await getDb().query(
      `update parent_diagnosis_reports set reminder_count = reminder_count + 1, last_reminded_at = $2
        where id = $1 and reminder_count = $3`, [r.id, now, r.reminder_count]);
    if (!rowCount) continue;
    const url = reportFormUrl(r.user_id, { now: now.getTime() });
    const today = new Date(r.interview_at) >= new Date(tomorrow.getTime() - 86400e3);
    const lead = r.reminder_count > 0
      ? 'レポートがまだ未送付です。お手すきのときに記入をお願いします📝'
      : today
        ? `本日${jstTime(new Date(r.interview_at))}から個別診断です。終わったらレポートの記入をお願いします📝`
        : 'レポートの記入をお願いします📝';
    results.push(await notifyAdmins(r.line_user_id, 'report_reminder', `${lead}${url ? `\n▶ ${url}` : ''}`));
  }
  return { candidates: rows.length, results };
}
