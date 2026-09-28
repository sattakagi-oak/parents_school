// セグメント抽出（管理API・管理スクリプト共通）。
// 条件はすべて許可リストで検証し、SQLはパラメータ化して組み立てる。

import { QUESTIONS } from './messages.js';

const ALLOWED = Object.fromEntries(QUESTIONS.map((q) => [q.key, new Set(q.options.map((o) => o.value))]));
const BOOL_FILTERS = {
  diagnosis_applied: 'diagnosis_applied_at',
  cta_clicked: 'diagnosis_cta_clicked_at',
  segmented: 'segmentation_completed_at',
  blocked: 'blocked_at',
};

/**
 * @param {Record<string,string>} filters 例:
 *   { grade: 'grade_1,grade_2', exam_intent: 'planned,considering_high', diagnosis_applied: 'false' }
 *   blocked を指定しない場合はブロック中ユーザーを除外する。
 */
export function buildSegmentQuery(filters = {}, { limit = 200 } = {}) {
  const where = [];
  const params = [];

  for (const [column, allowed] of Object.entries(ALLOWED)) {
    const raw = filters[column];
    if (raw == null || raw === '') continue;
    const values = String(raw).split(',').map((v) => v.trim()).filter(Boolean);
    const bad = values.filter((v) => !allowed.has(v));
    if (bad.length) throw new Error(`invalid ${column}: ${bad.join(',')}`);
    params.push(values);
    where.push(`${column} = any($${params.length})`);
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
    listSql: `select id, display_name, grade, exam_intent, interest, education_step,
                     followed_at, segmentation_completed_at, diagnosis_cta_clicked_at,
                     diagnosis_applied_at, blocked_at, created_at
                from parent_line_users ${cond}
               order by created_at desc limit ${safeLimit}`,
    params,
  };
}
