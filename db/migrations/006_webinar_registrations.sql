-- 無料講座（Zoom）の申込とリマインド送信記録。
-- 1ユーザー1講座につき1行。日程変更は session_id を上書き。
-- *_sent_for には「リマインドを送った回の session_id」を入れる。日程変更すると値がずれ、新しい回のリマインドが送られる。
create table if not exists parent_webinar_registrations (
  id                      uuid primary key default gen_random_uuid(),
  line_user_id            text not null,
  webinar_key             text not null,
  session_id              text not null,
  registered_at           timestamptz not null default now(),
  session_changed_at      timestamptz,
  day_before_sent_for     text,
  morning_sent_for        text,
  hour_before_sent_for    text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (line_user_id, webinar_key)
);

create index if not exists parent_webinar_registrations_session_idx
  on parent_webinar_registrations (webinar_key, session_id);

alter table parent_webinar_registrations enable row level security;
