-- アンケートを「悩み」ではなく「これから伸ばしたいこと」中心に変更。
-- カラム名は流用（Migrationリスク回避）し、意味だけ変える:
--   exam_intent → 進路・教育方針（education_path_intent）。Q1の学年ごとにQ2の選択肢を出し分け
--   interest    → 子どもについて伸ばしたいこと（growth_interest）

-- Q2: 進路・教育方針（全学年の選択肢の和集合）
alter table parent_line_users drop constraint if exists parent_line_users_exam_intent_check;
update parent_line_users set exam_intent = case exam_intent
    when 'planned'          then 'junior_exam_planned'
    when 'considering_high' then 'junior_exam_considering'
    when 'considering'      then 'junior_exam_undecided'
    when 'not_planned'      then 'not_decided_yet'
    else exam_intent
  end
 where exam_intent in ('planned', 'considering_high', 'considering', 'not_planned');
alter table parent_line_users add constraint parent_line_users_exam_intent_check
  check (exam_intent in (
    'expand_future_options', 'build_learning_foundation', 'not_decided_yet',
    'junior_exam_planned', 'junior_exam_considering', 'junior_exam_undecided', 'junior_exam_in_progress',
    'public_school_main', 'high_school_exam', 'other'));

-- Q3: これから伸ばしたいこと
alter table parent_line_users drop constraint if exists parent_line_users_interest_check;
update parent_line_users set interest = case interest
    when 'study_habits'            then 'learning_habits'
    when 'parenting_communication' then 'parenting_fit'
    when 'child_strengths'         then 'develop_strengths'
    when 'future_preparation'      then 'expand_future_options'
    when 'juku_timing'             then null   -- 新選択肢に対応なし → 再回答を待つ
    else interest
  end
 where interest in ('study_habits', 'parenting_communication', 'child_strengths', 'future_preparation', 'juku_timing');
alter table parent_line_users add constraint parent_line_users_interest_check
  check (interest in (
    'independent_thinking', 'learning_habits', 'develop_strengths',
    'expand_future_options', 'parenting_fit', 'what_to_prioritize'));

comment on column parent_line_users.exam_intent is '進路・教育方針（education_path_intent）。Q2。学年ごとに選択肢が異なる';
comment on column parent_line_users.interest is '子どもについて伸ばしたいこと（growth_interest）。Q3';

-- 美穂先生の対応待ち一覧（列名を意味どおりに）
drop view if exists parent_line_pending_followups;
create view parent_line_pending_followups as
select id, display_name, grade,
       exam_intent as education_path_intent,
       interest    as growth_interest,
       segmentation_completed_at, diagnosis_cta_clicked_at, diagnosis_applied_at,
       manual_followup_status
  from parent_line_users
 where segmentation_completed_at is not null
   and manual_followup_status = 'pending'
   and blocked_at is null
 order by segmentation_completed_at desc;
