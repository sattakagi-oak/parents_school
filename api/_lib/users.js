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

export async function getUser(lineUserId) {
  const { rows } = await getDb().query('select * from parent_line_users where line_user_id = $1', [lineUserId]);
  return rows[0] || null;
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

/**
 * 3問完了の記録（初回のみ）。完了日時を入れ、美穂先生の個別対応待ち（pending）にする。
 * 既に完了済みなら null（再回答では状態を変えない）。
 */
export async function completeSegmentation(lineUserId) {
  const { rows } = await getDb().query(
    `update parent_line_users
        set segmentation_completed_at = now(),
            manual_followup_status = coalesce(manual_followup_status, 'pending'),
            updated_at = now()
      where line_user_id = $1 and segmentation_completed_at is null
        and grade is not null and exam_intent is not null and interest is not null
      returning *`,
    [lineUserId],
  );
  return rows[0] || null;
}

const FOLLOWUP_STATUSES = new Set(['pending', 'completed', 'not_needed']);

/** 美穂先生の個別対応状況を更新（管理スクリプト用）。completed のとき完了日時も記録。 */
export async function setManualFollowup(id, status) {
  if (!FOLLOWUP_STATUSES.has(status)) throw new Error('invalid manual_followup_status');
  const { rowCount } = await getDb().query(
    `update parent_line_users
        set manual_followup_status = $2,
            manual_followup_completed_at = case when $2 = 'completed' then now() else null end,
            updated_at = now()
      where id = $1`,
    [id, status],
  );
  return rowCount > 0;
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

/** テスト用: 回答・完了・対応状況・CTAクリック・完了メッセージの送信記録を消して、未回答の状態に戻す */
export async function resetTestUserProgress(lineUserId) {
  await getDb().query(
    `update parent_line_users
        set grade = null, exam_intent = null, interest = null,
            segmentation_completed_at = null, manual_followup_status = null, manual_followup_completed_at = null,
            diagnosis_cta_clicked_at = null, updated_at = now()
      where line_user_id = $1`,
    [lineUserId],
  );
  await getDb().query('delete from parent_line_message_logs where line_user_id = $1', [lineUserId]);
}
