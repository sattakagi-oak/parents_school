import { getDb } from './db.js';

const SEGMENT_COLUMNS = new Set(['grade', 'exam_intent', 'interest']);

export async function upsertUser(lineUserId) {
  const { rows } = await getDb().query(
    `insert into parent_line_users (line_user_id) values ($1)
     on conflict (line_user_id) do update set updated_at = now()
     returning *`,
    [lineUserId],
  );
  return rows[0];
}

export async function markFollowed(lineUserId, displayName) {
  const { rows } = await getDb().query(
    `insert into parent_line_users (line_user_id, display_name, followed_at) values ($1, $2, now())
     on conflict (line_user_id) do update
       set followed_at = now(), blocked_at = null,
           display_name = coalesce(excluded.display_name, parent_line_users.display_name),
           updated_at = now()
     returning *`,
    [lineUserId, displayName],
  );
  return rows[0];
}

export async function markBlocked(lineUserId) {
  await getDb().query(
    `insert into parent_line_users (line_user_id, blocked_at) values ($1, now())
     on conflict (line_user_id) do update set blocked_at = now(), updated_at = now()`,
    [lineUserId],
  );
}

export async function setAnswer(lineUserId, column, value) {
  if (!SEGMENT_COLUMNS.has(column)) throw new Error('invalid segment column');
  const { rows } = await getDb().query(
    `insert into parent_line_users (line_user_id, ${column}) values ($1, $2)
     on conflict (line_user_id) do update set ${column} = excluded.${column}, updated_at = now()
     returning *`,
    [lineUserId, value],
  );
  return rows[0];
}

/** 初回完了時のみ completed_at / education_started_at を記録。初回なら true。 */
export async function completeSegmentation(lineUserId) {
  const { rows } = await getDb().query(
    `update parent_line_users
        set segmentation_completed_at = now(),
            education_started_at = coalesce(education_started_at, now()),
            updated_at = now()
      where line_user_id = $1 and segmentation_completed_at is null
        and grade is not null and exam_intent is not null and interest is not null
      returning *`,
    [lineUserId],
  );
  return rows[0] || null;
}

/** 教育ステップを from → to に進める（他の処理が先に進めていたら何もしない） */
export async function advanceEducationStep(id, from, to) {
  await getDb().query(
    `update parent_line_users set education_step = $3, updated_at = now()
      where id = $1 and education_step = $2`,
    [id, from, to],
  );
}

export async function recordEvent(lineUserId, eventType, detail = null) {
  await getDb().query(
    `insert into parent_line_events (line_user_id, event_type, detail) values ($1, $2, $3)`,
    [lineUserId, eventType, detail ? JSON.stringify(detail) : null],
  );
}

export async function addTestUser(lineUserId) {
  await getDb().query(
    `insert into parent_line_test_users (line_user_id) values ($1) on conflict do nothing`, [lineUserId]);
}

/** @returns {Promise<boolean>} 削除したら true */
export async function removeTestUser(lineUserId) {
  const { rowCount } = await getDb().query(
    'delete from parent_line_test_users where line_user_id = $1', [lineUserId]);
  return rowCount > 0;
}

export async function isRegisteredTestUser(lineUserId) {
  const { rows } = await getDb().query(
    'select 1 from parent_line_test_users where line_user_id = $1', [lineUserId]);
  return rows.length > 0;
}
