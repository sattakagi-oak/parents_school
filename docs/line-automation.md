# 親の学習塾 LINE自動化

LINE友だち追加 → Q1 学年 → Q2 進路・教育方針（学年別に出し分け）→ Q3 これから伸ばしたいこと → 短い自動返信＋1,000円個別診断CTA
→ **美穂先生が回答を確認し、LINE公式アカウントから個別に手動返信** → 必要な方を1,000円個別診断へ → 4か月講座へ。

ターゲットは「問題があって困っている親」ではなく、**わが子をもっと伸ばしたい・可能性を広げたい**教育意識の高い親。
中学受験は重要な選択肢の一つだが、中学受験家庭だけに限定しない。アンケート・メッセージは悩み相談や問題解決に寄せない。

価値は「30年以上、数百組の親子を見てきた美穂先生本人が回答を見てくれること」。
システムの役割は、美穂先生がその人に合わせて返信するための情報を集め、見やすくするところまで。

LINE Messaging API + Neon（標準PostgreSQL、`pg` ドライバ）+ Vercel Functions。既存LP（`index.html`）には一切手を入れていない。Cronは使わない。

## 自動で送るもの（これ以外は送らない）

| きっかけ | 自動返信（すべて reply。push は使わない） |
|---|---|
| 友だち追加（follow）／「3問に回答する」 | あいさつ＋Q1 |
| Q1回答 | 学年に応じたQ2 |
| Q2回答 | Q3 |
| Q3回答（3問そろった初回） | 完了メッセージ＋個別診断CTA（1回だけ） |

その後の自由入力・CTAクリック・時間経過では何も自動送信しない。翌日配信・3日間/7日間教育・CTA未クリック者への追客・自動クロージング・AI自動返信は実装しない。

## 構成

| パス | 役割 |
|---|---|
| `api/line/webhook.js` | `POST /api/line/webhook` 署名検証・follow/unfollow/postback/message |
| `api/line/cta.js` | `GET /api/line/cta?t=…` CTAクリック記録 → 申込ページ（`PARENT_DIAGNOSIS_URL`）へ302 |
| `api/admin/line/users.js` | `GET /api/admin/line/users` セグメント抽出（要ADMIN_API_TOKEN・送信なし） |
| `api/admin/line/diagnosis-applied.js` | `POST /api/admin/line/diagnosis-applied` 申込済み手動登録 |
| `api/_lib/messages.js` | **自動返信の文面・3問の選択肢はすべてここ** |
| `api/_lib/config.js` | 送信モード判定（唯一の送信可否判断） |
| `db/migrations/*.sql` | テーブル定義 |
| `scripts/admin.mjs` | 管理スクリプト（対応待ち一覧・対応状況更新・抽出・監査） |

## 3問アンケート

DBカラムは流用し、意味を変えている: `exam_intent` = **進路・教育方針（education_path_intent）**、`interest` = **子どもについて伸ばしたいこと（growth_interest）**。

### Q1 学年（`grade`）— 表示 `【学年】小1`

お子さんの学年を教えてください。
年長以下 `preschool` / 小1 `grade_1` / 小2 `grade_2` / 小3 `grade_3` / 小4以上 `grade_4_plus`

### Q2 進路・教育方針（`exam_intent`）— 表示 `【進路】…`。Q1の学年で出し分け

| 学年 | 質問 | 選択肢（内部値） |
|---|---|---|
| 年長以下 | これからのお子さんの学びについて、一番近いものを教えてください。 | 将来の選択肢をできるだけ広げたい `expand_future_options` / 中学受験も視野に入れている `junior_exam_considering` / まずは学ぶことを楽しめる土台をつくりたい `build_learning_foundation` / まだ具体的な進路は考えていない `not_decided_yet` |
| 小1・小2 | これからの進路について、今のお考えに一番近いものを教えてください。 | 中学受験を考えている `junior_exam_planned` / 中学受験も含めて幅広く検討している `junior_exam_considering` / まだ決めていないが、将来の選択肢を広げたい `expand_future_options` / 公立中心で考えている `public_school_main` / まだ特に決めていない `not_decided_yet` |
| 小3 | これからの進路について、今のお考えに一番近いものを教えてください。 | 中学受験をする予定 `junior_exam_planned` / 中学受験を前向きに検討している `junior_exam_considering` / 中学受験をするかまだ迷っている `junior_exam_undecided` / 公立中への進学を中心に考えている `public_school_main` / まだ決めていない `not_decided_yet` |
| 小4以上 | 現在の進路について、一番近いものを教えてください。 | 中学受験に向けて準備している `junior_exam_in_progress` / 中学受験を検討している `junior_exam_considering` / 高校受験を見据えている `high_school_exam` / まだ進路は決めていない `not_decided_yet` / その他の進路を考えている `other` |

- 同じ意味の選択肢は学年をまたいで同じ内部値（例: 中学受験の検討 = `junior_exam_considering`）。セグメント抽出で学年横断に絞り込める。
- その学年の選択肢に無い値（古いボタン等）は保存せず、今の学年のQ2を出し直す。学年を変えて既存のQ2回答が合わなくなった場合もQ2を聞き直す。

### Q3 これから伸ばしたいこと（`interest`）— 表示 `【伸ばしたいこと】…`。全学年共通

これから、お子さんについて一番伸ばしていきたいことはどれですか？
（今困っていることではなく、「これからこうなってほしい」というお気持ちに近いもので大丈夫です。）

自分から考えて学ぶ力を伸ばしたい `independent_thinking` / 勉強を楽しめる習慣をつくりたい `learning_habits` / 得意なこと・好きなことをもっと伸ばしたい `develop_strengths` / 将来の選択肢を広げられる力をつけたい `expand_future_options` / 子どものタイプに合った関わり方を知りたい `parenting_fit` / 今の年齢で何を優先すればいいか知りたい `what_to_prioritize`

### postback / displayText

- 質問は Flex Message。各選択肢は折り返し表示されるボタン（長い選択肢も全文表示）。
- タップ = postback action。`data=action=segment&question=<grade|exam_intent|interest>&value=<内部値>` を**DB保存の正**とし、
  `displayText`（`【学年】小1` / `【進路】…` / `【伸ばしたいこと】…`）はトーク画面に回答を残すためだけに使う（パースしない）。
  → 美穂先生は LINE Official Account Manager のトーク履歴だけで回答が分かる。
- 値は許可リストで検証。再回答は最新値で上書き（完了日時・対応状況・完了メッセージは変えない）。
- 「3問に回答する」「診断スタート」のテキスト、または postback `action=segment&question=start` で最初から回答できる（既存友だち用）。

## 3問完了後

DB: `grade` / `exam_intent`（進路）/ `interest`（伸ばしたいこと）/ `segmentation_completed_at = now()` / `manual_followup_status = 'pending'`

自動返信（Q3への reply 1回）: 完了メッセージ（年齢や伸ばしたいことによって大切にしたいことは一人ひとり違う／美穂先生が直接確認します／個別診断のご案内／気になることがあれば一言どうぞ）＋個別診断CTA（Flex）。

### 1,000円個別診断CTA

- 名称「わが子の伸ばし方 個別診断」／60分 1,000円（中学受験専用には見せない）
- 「60分で、・今の年齢で大切にしたいこと・お子さんの強みや得意の伸ばし方・今はまだ急がなくていいこと・将来の選択肢を広げるための準備・お子さんに合った親の関わり方・今後6〜12か月の方向性 を一緒に整理します。」
- ボタン「個別診断の内容を見る」（申込ページ直結なら `messages.js` の `DIAGNOSIS.buttonLabel` を「1,000円個別診断を申し込む」に）
- ボタンのリンク先は `PUBLIC_BASE_URL/api/line/cta?t=<ユーザーごとのランダムトークン>`。クリック時に `diagnosis_cta_clicked_at`（初回のみ）を記録して `PARENT_DIAGNOSIS_URL` へ転送。URLにLINE userIdは載せない。
- `PARENT_DIAGNOSIS_URL`（https）か `PUBLIC_BASE_URL` が未設定、または診断申込済みのユーザーには、CTAなしで完了メッセージのみ。
- 申込が確認できたら `diagnosis_applied_at` を記録（`npm run admin -- mark-applied <id>` または管理API）。

## 美穂先生の個別対応

`manual_followup_status`: `pending`（3問完了時） → `completed`（個別返信済み。`manual_followup_completed_at` も記録）/ `not_needed`。友だち追加だけでは null。
返信文は美穂先生が回答に触れて本人が書く（Messaging APIから自動送信しない）。

### 対応待ち一覧

Neon Console → SQL Editor（または Tables のビュー `parent_line_pending_followups`）:

```sql
select * from parent_line_pending_followups;
-- 列: display_name, grade, education_path_intent, growth_interest, segmentation_completed_at,
--     diagnosis_cta_clicked_at, diagnosis_applied_at, manual_followup_status（新しい回答者が上）
```

ローカルから（回答を「【学年】小1」の形で日本語表示）:

```bash
npm run admin -- pending
npm run admin -- followup-done <id>        # 個別返信したら
npm run admin -- followup-not-needed <id>
```

SQLで直接更新する場合:

```sql
update parent_line_users set manual_followup_status = 'completed', manual_followup_completed_at = now() where id = '<id>';
```

### セグメント抽出例（将来の絞り込み用・送信はしない）

```sql
select id, display_name from parent_line_users
 where grade in ('grade_1','grade_2')
   and exam_intent in ('junior_exam_planned','junior_exam_considering')   -- 進路
   and diagnosis_applied_at is null
   and blocked_at is null;

select id, display_name from parent_line_users where interest = 'independent_thinking';  -- 伸ばしたいこと
```

```bash
npm run admin -- segment --grade=grade_1,grade_2 --exam_intent=junior_exam_planned,junior_exam_considering --diagnosis_applied=false
npm run admin -- segment --interest=independent_thinking
npm run admin -- mark-applied <id>
npm run admin -- stats
```

## 送信の安全装置

| `LINE_SEND_MODE` | 動作 |
|---|---|
| `disabled`（既定・未設定・typoも含む） | 誰にも送らない。回答保存・状態更新のみ |
| `test` | テスト用ユーザー（`LINE_TEST_USER_IDS` または LINEから「テスト登録」した人）にだけ送る |
| `production` | 全員に送る。**`LINE_SEND_ENABLED=true` も同時に必要**（どちらか欠けたら disabled） |

- 送信関数は reply のみ。push / broadcast / multicast は**コード自体が存在しない**。
- reply のたびに送信直前でモードと宛先を再確認（follow時・質問・完了・CTAすべて）。
- 実際に送った返信は `parent_line_events` に `message_sent`、テスト対象外で止めた返信は `send_blocked` として記録。
  `npm run admin -- audit` で「テストユーザー以外への実送信: 0件」を確認できる。
- 完了メッセージは `parent_line_message_logs (line_user_id, campaign_key='segment:complete')` の一意制約で1回だけ。
- ログには userId・トークン・本文を出さない（`api/_lib/log.js` の許可キーのみ）。

## データ

`parent_line_users`（1ユーザー1行、`line_user_id` unique）
- 回答: `grade` / `exam_intent`（進路・教育方針）/ `interest`（伸ばしたいこと）
- `segmentation_completed_at` / `manual_followup_status` / `manual_followup_completed_at`
- `diagnosis_cta_clicked_at`（初回クリック）/ `diagnosis_applied_at` / `followed_at` / `blocked_at`
- `cta_token`: CTAリンク用のランダムID
- `education_started_at` / `education_step`: 旧7日間配信用。**未使用**（削除のMigrationリスクを避けて残置）

`parent_line_message_logs` 1回限りの返信の記録 / `parent_line_events` 行動履歴（follow・回答・CTAクリック・送信記録。Webhook bodyは保存しない）/ `parent_line_test_users` テスト用ユーザー

全テーブルRLS有効・ポリシーなし（多層防御。アプリの接続ロール＝テーブル所有者には影響なし）。

マイグレーション: `db/migrations/*.sql` を `npm run db:migrate` で適用。適用済みファイルは `schema_migrations` に記録され、同じコマンドを開発・Preview・Production の各DBに対して実行すれば同じスキーマになる。

---

## セットアップ手順（ユーザー作業）

### 1. Neon（DB）

このサービス専用の Neon プロジェクトを使う（他サービスと混在させない）。ブランチで環境を分ける:

| Neonブランチ | 用途 | 接続する場所 |
|---|---|---|
| `production` | 本番 | Vercel Production |
| `development`（productionから作成） | 開発・Preview | `.env.local`、Vercel Preview |

マイグレーション:
```bash
npm run db:migrate                                   # .env.local の接続先（development）
DATABASE_URL_UNPOOLED='<productionの直結URL>' node scripts/migrate.mjs   # 本番（本番反映時のみ）
```

### 2. Vercel 環境変数

| 変数 | 値 | 備考 |
|---|---|---|
| `LINE_CHANNEL_SECRET` | LINE Developers の Channel secret | |
| `LINE_CHANNEL_ACCESS_TOKEN` | 長期チャネルアクセストークン | |
| `LINE_SEND_MODE` | `disabled` | テスト時のみ `test` |
| `LINE_SEND_ENABLED` | `false` | 本番配信許可が出るまで false |
| `LINE_TEST_USER_IDS` | 運営者の userId | 任意（LINEからの「テスト登録」でも可） |
| `LINE_TEST_REGISTER_CODE` | 16文字以上の合言葉 | テスト登録用。テスト後は削除推奨 |
| `DATABASE_URL` | Neon pooled 接続文字列 | Production=productionブランチ / Preview=developmentブランチ |
| `DATABASE_URL_UNPOOLED` | Neon 直結接続文字列 | 任意（マイグレーション用） |
| `ADMIN_API_TOKEN` | 32文字以上のランダム文字列 | 管理API用 |
| `PARENT_DIAGNOSIS_URL` | 診断の申込ページURL（https） | 未設定ならCTAなし |
| `PUBLIC_BASE_URL` | このサイトの公開URL | CTAリンク生成用 |

環境変数を変えたら、対象ブランチのデプロイを Redeploy（Preview は Branch が `feature/parent-line-automation` のもの）。
Settings → Deployment Protection の Vercel Authentication は OFF（ON だと LINE の Webhook が 401 になる）。

> 注意: Vercel Hobby（無料）プランは商用利用不可の規約。

### 3. LINE Developers

- **Messaging API** タブ → **Webhook URL** に `https://<VercelのURL>/api/line/webhook` → **Update** → **Verify** →「成功」→ **Use webhook** ON。
- LINE Official Account Manager 側の「あいさつメッセージ」「応答メッセージ」は従来どおり動く。本番化の際に、3問フローと重複しないか見直す。

### 4. 運営者本人でのテスト（`LINE_SEND_MODE=test`）

1. Preview に `LINE_SEND_MODE=test`、`LINE_TEST_REGISTER_CODE=<合言葉>`、`PARENT_DIAGNOSIS_URL`、`PUBLIC_BASE_URL` を設定して Redeploy。
2. 本人のLINEから `テスト登録 <合言葉>` →「テスト用アカウントとして登録しました」。解除は `テスト解除`。
   - `テストリセット`: テスト用ユーザー本人の回答・完了・対応状況・CTAクリックを消して未回答に戻す（何度でもテスト可。production では無効）。
3. `3問に回答する` → Q1〜Q3 をタップ（学年に応じたQ2が出る。トーク画面に `【学年】…` 等が残る）→ 完了メッセージ＋個別診断CTA。
4. CTAボタンを押す → 申込ページへ遷移、`diagnosis_cta_clicked_at` が入る。
5. `select * from parent_line_pending_followups;` に表示されること。
6. その後、何を送っても自動メッセージが来ないこと。
7. `npm run admin -- audit` で「テストユーザー以外への実送信: 0件」。
8. テスト後は `LINE_SEND_MODE=disabled` に戻す。

### 5. 本番配信の開始（明示的な許可が出てから）

production ブランチへマイグレーション → main へマージ → Production の環境変数に `LINE_SEND_MODE=production` と `LINE_SEND_ENABLED=true` の**両方**を設定して Redeploy。
この時点から、新規友だち追加者に3問が届く（既存友だちには何も届かない）。

## 既存の友だち（約100人）への案内（案・未実施）

**「既存ユーザーにも配信してください」と明示的な指示が出るまで実施しない。**

1. **リッチメニュー**（推奨・送信数ゼロ）: Official Account Manager でリッチメニューにボタンを追加し、アクション「テキスト」＝`3問に回答する`。タップした人だけにQ1が返信される。
2. **一斉メッセージ（Official Account Manager から人間が手動）**: 「3つの質問に答えると、美穂先生がお子さんのことを確認します」＋ボタン（テキスト `3問に回答する`）。

## テスト

```bash
npm install
npm test
```

PGlite（メモリ上のPostgres）で実際のマイグレーションSQLを流し、LINE APIは偽物に差し替えて実送信ゼロで検証する。
