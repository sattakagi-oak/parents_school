-- テスト送信を許可するLINEユーザー（LINE_SEND_MODE=test のときだけ意味を持つ）。
-- LINEから「テスト登録 <LINE_TEST_REGISTER_CODE>」を送ると登録、「テスト解除」で削除。
create table if not exists parent_line_test_users (
  line_user_id  text primary key,
  created_at    timestamptz not null default now()
);

alter table parent_line_test_users enable row level security;
