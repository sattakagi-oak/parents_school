-- 運営（美穂先生など）への通知先LINEユーザー。友だちの操作（チェック数回答・申込報告・無料講座申込・自由メッセージ）を
-- このユーザーに push で知らせる。userId はリポジトリに書かず、DBに直接登録する。
create table if not exists parent_line_notify_targets (
  line_user_id  text primary key,
  created_at    timestamptz not null default now()
);

alter table parent_line_notify_targets enable row level security;
