-- 導線変更: 「親の習慣」チェックリスト（プレゼント）→ チェック数 → 個別分析CTA → 美穂先生の手動コメント。
-- 年代区分は厳密な学年ではないため、既存の grade とは別の意味が明確なカラムとして追加する（追加のみ・既存データに影響なし）。
-- grade / exam_intent / interest / segmentation_completed_at は旧アンケート用。今後の処理では使わない（残置）。

alter table parent_line_users add column if not exists education_stage text
  check (education_stage in ('preschool', 'elementary_lower', 'elementary_middle', 'elementary_upper', 'junior_high_plus'));
alter table parent_line_users add column if not exists parenting_check_sheet text
  check (parenting_check_sheet in ('present_1', 'present_2'));
-- シートをどの操作で受け取ったか: stage_button（新導線の年代ボタン）/ legacy_text（旧「①/②/1/2」入力）
alter table parent_line_users add column if not exists parenting_check_sheet_source text
  check (parenting_check_sheet_source in ('stage_button', 'legacy_text'));
alter table parent_line_users add column if not exists parenting_check_sheet_sent_at timestamptz;
alter table parent_line_users add column if not exists parenting_check_count integer
  check (parenting_check_count between 0 and 10);
alter table parent_line_users add column if not exists parenting_check_answered_at timestamptz;

create index if not exists parent_line_users_check_answered_idx
  on parent_line_users (manual_followup_status, parenting_check_answered_at desc);

-- 美穂先生の対応待ち一覧: チェック数を回答済み・pending の人を新しい順
drop view if exists parent_line_pending_followups;
create view parent_line_pending_followups as
select id, display_name, education_stage, parenting_check_sheet, parenting_check_sheet_source,
       parenting_check_count, parenting_check_answered_at,
       diagnosis_cta_clicked_at, diagnosis_applied_at, manual_followup_status
  from parent_line_users
 where parenting_check_answered_at is not null
   and manual_followup_status = 'pending'
   and blocked_at is null
 order by parenting_check_answered_at desc;
