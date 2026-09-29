-- 配信方針の変更: 7日間自動教育配信を廃止し、3問回答後は美穂先生の個別対応（手動返信）へ。
-- education_started_at / education_step は削除せず未使用として残す（既存データ・Migrationへの影響回避）。

-- Q3「現在の悩み、またはこれから知りたいこと」の選択肢変更（カラム名 interest は流用）
alter table parent_line_users drop constraint if exists parent_line_users_interest_check;
update parent_line_users set interest = case interest
    when 'what_to_do_now' then 'what_to_prioritize'
    when 'exam_decision'  then null   -- 新選択肢に対応なし → 再回答を待つ
    else interest
  end
 where interest in ('what_to_do_now', 'exam_decision');
alter table parent_line_users add constraint parent_line_users_interest_check
  check (interest in ('what_to_prioritize','study_habits','parenting_communication','child_strengths','juku_timing','future_preparation'));

-- 美穂先生の個別対応状況。3問完了時に pending。友だち追加だけでは null のまま。
alter table parent_line_users add column if not exists manual_followup_status text
  check (manual_followup_status in ('pending','completed','not_needed'));
alter table parent_line_users add column if not exists manual_followup_completed_at timestamptz;

-- 既に3問完了しているユーザーは対応待ちにする
update parent_line_users set manual_followup_status = 'pending'
 where segmentation_completed_at is not null and manual_followup_status is null;

create index if not exists parent_line_users_followup_idx
  on parent_line_users (manual_followup_status, segmentation_completed_at desc);

-- 美穂先生の対応待ち一覧（Neon Console の Tables / SQL Editor でそのまま見られる）
create or replace view parent_line_pending_followups as
select id, display_name, grade, exam_intent, interest,
       segmentation_completed_at, diagnosis_cta_clicked_at, diagnosis_applied_at,
       manual_followup_status
  from parent_line_users
 where segmentation_completed_at is not null
   and manual_followup_status = 'pending'
   and blocked_at is null
 order by segmentation_completed_at desc;
