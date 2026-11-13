-- 個別診断レポート。みほ先生が管理画面で入力し、token 付きURLで本人に見せる。
-- survey: 事前アンケートの回答（LINEで集める。まだ未実装）。data: レポート本文の入力。
create table if not exists parent_diagnosis_reports (
  id            uuid primary key default gen_random_uuid(),
  report_no     serial,
  token         uuid not null unique default gen_random_uuid(),
  line_user_id  text not null,
  survey        jsonb,
  data          jsonb not null default '{}'::jsonb,
  status        text not null default 'draft' check (status in ('draft', 'sent')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  sent_at       timestamptz
);
create index if not exists parent_diagnosis_reports_user_idx on parent_diagnosis_reports (line_user_id, created_at desc);
alter table parent_diagnosis_reports enable row level security;
