-- 親の学習塾 LINE自動化 Phase 1
-- 標準PostgreSQL（Neon）。npm run db:migrate で適用（適用済みは schema_migrations に記録）。
-- このサービス専用のNeonプロジェクトで実行すること（他サービスのDBと混在させない）。

create table if not exists parent_line_users (
  id                         uuid primary key default gen_random_uuid(),
  line_user_id               text not null unique,
  display_name               text,
  grade                      text check (grade in ('preschool','grade_1','grade_2','grade_3','grade_4_plus')),
  exam_intent                text check (exam_intent in ('planned','considering_high','considering','not_planned')),
  interest                   text check (interest in ('what_to_do_now','study_habits','parenting_communication','juku_timing','exam_decision')),
  followed_at                timestamptz,
  segmentation_completed_at  timestamptz,
  education_started_at       timestamptz,
  -- 次に送る教育ステップ番号（0 = Day0 未送信, 7 = 全ステップ完了）
  education_step             integer not null default 0,
  diagnosis_cta_clicked_at   timestamptz,
  diagnosis_applied_at       timestamptz,
  blocked_at                 timestamptz,
  -- CTAリダイレクト用の推測不能なトークン（URLにLINE userIdを載せないため）
  cta_token                  uuid not null unique default gen_random_uuid(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index if not exists parent_line_users_segment_idx
  on parent_line_users (grade, exam_intent, interest);
create index if not exists parent_line_users_education_idx
  on parent_line_users (education_step)
  where segmentation_completed_at is not null and blocked_at is null;

-- 送信ログ。(line_user_id, campaign_key) で一意 → 同じ教育メッセージの二重送信を防ぐ。
-- status: pending（送信中） / sent / failed / skipped_disabled / skipped_not_test_user
-- sent・pending は再送しない。skipped_* と failed は再度送信を試みられる（retry_keyでLINE側も冪等）。
create table if not exists parent_line_message_logs (
  id             uuid primary key default gen_random_uuid(),
  line_user_id   text not null,
  message_type   text not null,            -- reply / push
  campaign_key   text not null,            -- 例: edu:day0, segment:complete
  scheduled_for  timestamptz,
  sent_at        timestamptz,
  status         text not null,
  error_message  text,
  retry_key      uuid not null default gen_random_uuid(),
  attempts       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (line_user_id, campaign_key)
);

-- 行動履歴（Webhook bodyは保存せず、必要最小限の項目だけ）
create table if not exists parent_line_events (
  id            bigint generated always as identity primary key,
  line_user_id  text not null,
  event_type    text not null,             -- follow / unfollow / segment_answer / segment_completed / cta_click / diagnosis_applied
  detail        jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists parent_line_events_user_idx on parent_line_events (line_user_id, created_at);

-- 多層防御: RLSを有効化しポリシーは作らない。テーブル所有者（アプリの接続ロール）は影響を受けないが、
-- 将来 Neon Data API 等で別ロールから公開された場合でも読み書きできない。
alter table parent_line_users        enable row level security;
alter table parent_line_message_logs enable row level security;
alter table parent_line_events       enable row level security;
