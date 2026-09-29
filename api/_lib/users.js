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

/** 年代ボタン: 年代とシートを保存（新導線） */
export async function setStageAndSheet(lineUserId, stage, sheet) {
  const { rows } = await getDb().query(
    `insert into parent_line_users (line_user_id, education_stage, parenting_check_sheet,
                                    parenting_check_sheet_source, parenting_check_sheet_sent_at)
     values ($1, $2, $3, 'stage_button', now())
     on conflict (line_user_id) do update
       set education_stage = excluded.education_stage,
           parenting_check_sheet = excluded.parenting_check_sheet,
           parenting_check_sheet_source = 'stage_button',
           parenting_check_sheet_sent_at = now(),
           updated_at = now()
     returning *`,
    [lineUserId, stage, sheet],
  );
  return rows[0];
}

/** 旧入力の人が任意で年代だけ登録（シートは変えない） */
export async function setStageOnly(lineUserId, stage) {
  const { rows } = await getDb().query(
    `update parent_line_users set education_stage = $2, updated_at = now()
      where line_user_id = $1 returning *`,
    [lineUserId, stage],
  );
  return rows[0] || null;
}

/** 旧入力（①/②）: シートだけ保存。まだシート未取得の人のみ（既に取得済みなら null） */
export async function setLegacySheet(lineUserId, sheet) {
  const { rows } = await getDb().query(
    `insert into parent_line_users (line_user_id, parenting_check_sheet,
                                    parenting_check_sheet_source, parenting_check_sheet_sent_at)
     values ($1, $2, 'legacy_text', now())
     on conflict (line_user_id) do update
       set parenting_check_sheet = excluded.parenting_check_sheet,
           parenting_check_sheet_source = 'legacy_text',
           parenting_check_sheet_sent_at = now(),
           updated_at = now()
       where parent_line_users.parenting_check_sheet is null
     returning *`,
    [lineUserId, sheet],
  );
  return rows[0] || null;
}

/**
 * チェック数の保存（選び直しは最新値で上書き）。初回は回答日時を入れて美穂先生の対応待ち（pending）にする。
 * シート未取得のユーザーは更新しない（null を返す）。
 */
export async function setCheckCount(lineUserId, count) {
  const { rows } = await getDb().query(
    `update parent_line_users
        set parenting_check_count = $2,
            parenting_check_answered_at = coalesce(parenting_check_answered_at, now()),
            manual_followup_status = coalesce(manual_followup_status, 'pending'),
            updated_at = now()
      where line_user_id = $1 and parenting_check_sheet is not null
      returning *`,
    [lineUserId, count],
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

/** テスト用: 年代・シート・チェック数・対応状況・CTAクリック・1回限りの送信記録を消して、友だち追加直後の状態に戻す */
export async function resetTestUserProgress(lineUserId) {
  await getDb().query(
    `update parent_line_users
        set grade = null, exam_intent = null, interest = null, segmentation_completed_at = null,
            education_stage = null, parenting_check_sheet = null, parenting_check_sheet_source = null,
            parenting_check_sheet_sent_at = null, parenting_check_count = null, parenting_check_answered_at = null,
            manual_followup_status = null, manual_followup_completed_at = null,
            diagnosis_cta_clicked_at = null, updated_at = now()
      where line_user_id = $1`,
    [lineUserId],
  );
  await getDb().query('delete from parent_line_message_logs where line_user_id = $1', [lineUserId]);
}
