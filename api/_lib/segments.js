// セグメント抽出（管理API・管理スクリプト共通）。送信はしない。
// 条件はすべて許可リストで検証し、SQLはパラメータ化して組み立てる。

import { STAGES, SHEETS, CHECK_COUNT_MAX } from './messages.js';

const LIST_FILTERS = {
  education_stage: new Set(STAGES.map((s) => s.value)),
  parenting_check_sheet: new Set(Object.keys(SHEETS)),
  manual_followup_status: new Set(['pending', 'completed', 'not_needed']),
};
const BOOL_FILTERS = {
  check_answered: 'parenting_check_answered_at',
  diagnosis_applied: 'diagnosis_applied_at',
  cta_clicked: 'diagnosis_cta_clicked_at',
  blocked: 'blocked_at',
};

/**
 * @param {Record<string,string>} filters 例:
 *   { education_stage: 'preschool,elementary_lower', count_min: '5', diagnosis_applied: 'false' }
 *   { parenting_check_sheet: 'present_2', manual_followup_status: 'pending' }
 *   blocked を指定しない場合はブロック中ユーザーを除外する。
 */
export function buildSegmentQuery(filters = {}, { limit = 200 } = {}) {
  const where = [];
  const params = [];

  for (const [column, allowed] of Object.entries(LIST_FILTERS)) {
    const raw = filters[column];
    if (raw == null || raw === '') continue;
    const values = String(raw).split(',').map((v) => v.trim()).filter(Boolean);
    const bad = values.filter((v) => !allowed.has(v));
    if (bad.length) throw new Error(`invalid ${column}: ${bad.join(',')}`);
    params.push(values);
    where.push(`${column} = any($${params.length})`);
  }

  for (const [name, op] of [['count_min', '>='], ['count_max', '<=']]) {
    const raw = filters[name];
    if (raw == null || raw === '') continue;
    if (!/^\d{1,2}$/.test(String(raw)) || Number(raw) > CHECK_COUNT_MAX) throw new Error(`invalid ${name}: 0-${CHECK_COUNT_MAX}`);
    params.push(Number(raw));
    where.push(`parenting_check_count ${op} $${params.length}`);
  }

  for (const [name, column] of Object.entries(BOOL_FILTERS)) {
    const raw = filters[name] ?? (name === 'blocked' ? 'false' : undefined);
    if (raw == null || raw === '') continue;
    if (raw !== 'true' && raw !== 'false') throw new Error(`invalid ${name}: use true/false`);
    where.push(`${column} is ${raw === 'true' ? 'not null' : 'null'}`);
  }

  const cond = where.length ? `where ${where.join(' and ')}` : '';
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  return {
    countSql: `select count(*)::int as count from parent_line_users ${cond}`,
    listSql: `select id, display_name, education_stage, parenting_check_sheet, parenting_check_sheet_source,
                     parenting_check_count, parenting_check_answered_at,
                     diagnosis_cta_clicked_at, diagnosis_applied_at,
                     manual_followup_status, manual_followup_completed_at,
                     followed_at, blocked_at, created_at
                from parent_line_users ${cond}
               order by parenting_check_answered_at desc nulls last, created_at desc limit ${safeLimit}`,
    params,
  };
}
