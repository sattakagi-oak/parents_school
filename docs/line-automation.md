# 親の学習塾 LINE自動化

LINE友だち追加 → 3問アンケート → 短い自動返信＋1,000円診断CTA → **美穂先生が回答を確認し、LINE公式アカウントから個別に手動返信**。

大量の自動教育メッセージは送らない。価値は「30年以上、数百組の親子を見てきた美穂先生本人が回答を見てくれること」。
システムの役割は、美穂先生がその人に合わせて返信するための情報を集め、見やすくするところまで。

LINE Messaging API + Neon（標準PostgreSQL、`pg` ドライバ）+ Vercel Functions。既存LP（`index.html`）には一切手を入れていない。Cronは使わない。

## 自動で送るもの（これ以外は送らない）

| きっかけ | 自動返信（すべて reply。push は使わない） |
|---|---|
| 友だち追加（follow）／「3問に回答する」 | あいさつ＋Q1 |
| Q1回答 | Q2 |
| Q2回答 | Q3 |
| Q3回答（3問そろった初回） | 完了メッセージ＋診断CTA（1回だけ） |

その後の自由入力・CTAクリック・時間経過では何も自動送信しない。AI自動返信、Q3ごとの営業メッセージ、数時間後・翌日の追客も実装しない。

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

| | 質問 | 選択肢（内部値） | トーク画面の表示 |
|---|---|---|---|
| Q1 `grade` | お子さんの学年を教えてください。 | 年長以下 `preschool` / 小1 `grade_1` / 小2 `grade_2` / 小3 `grade_3` / 小4以上 `grade_4_plus` | `【学年】小1` |
| Q2 `exam_intent` | 中学受験について、今のお考えに一番近いものを教えてください。 | 受験する予定 `planned` / かなり前向きに検討中 `considering_high` / まだ迷っている `considering` / 今のところ予定なし `not_planned` | `【中学受験】かなり前向きに検討中` |
| Q3 `interest`（＝現在の悩み、またはこれから知りたいこと） | 今、一番近いものはどれですか？（今困っていることでも、これから知りたいことでも大丈夫です。） | 今の年齢で何を優先すればいいか知りたい `what_to_prioritize` / 学習習慣をどう作ればいいか気になる `study_habits` / 親の声かけ・関わり方に迷うことがある `parenting_communication` / 子どもの得意・不得意に合う伸ばし方を知りたい `child_strengths` / 入塾時期や塾選びが気になる `juku_timing` / 今は特に困っていないが、今後の準備を知りたい `future_preparation` | `【気になること】今の年齢で何を優先すればいいか知りたい` |

- 質問は Flex Message。各選択肢は折り返し表示されるボタン（Q3の長い選択肢も全文表示）。
- タップ = postback action。`data=action=segment&question=<key>&value=<内部値>` を**DB保存の正**とし、`displayText`（`【学年】小1` 等）はトーク画面に回答を残すためだけに使う（パースしない）。
  → 美穂先生は LINE Official Account Manager のトーク履歴だけで回答が分かる。
- 値は許可リストで検証。再回答は最新値で上書き（完了日時・対応状況・完了メッセージは変えない）。
- 「3問に回答する」「診断スタート」のテキスト、または postback `action=segment&question=start` で最初から回答できる（既存友だち用）。

## 3問完了後

DB: `grade` / `exam_intent` / `interest` / `segmentation_completed_at = now()` / `manual_followup_status = 'pending'`

自動返信（Q3への reply）: 完了メッセージ（美穂先生が直接確認します／60分の個別診断／気になることがあれば一言どうぞ）＋診断CTA（Flex）。

### 診断CTA

- 名称「わが家の中学受験準備診断」／60分 1,000円／「60分で、・今やるべきこと …を整理します。」
- ボタン「診断の内容を見る」（申込ページ直結なら `messages.js` の `DIAGNOSIS.buttonLabel` を「1,000円診断を申し込む」に）
- ボタンのリンク先は `PUBLIC_BASE_URL/api/line/cta?t=<ユーザーごとのランダムトークン>`。クリック時に `diagnosis_cta_clicked_at`（初回のみ）を記録して `PARENT_DIAGNOSIS_URL` へ転送。URLにLINE userIdは載せない。
- `PARENT_DIAGNOSIS_URL`（https）か `PUBLIC_BASE_URL` が未設定、または診断申込済みのユーザーには、CTAなしで完了メッセージのみ。

## 美穂先生の個別対応

`manual_followup_status`: `pending`（3問完了時） → `completed`（個別返信済み。`manual_followup_completed_at` も記録）/ `not_needed`。友だち追加だけでは null。

### 対応待ち一覧

Neon Console → SQL Editor（または Tables のビュー `parent_line_pending_followups`）:

```sql
select * from parent_line_pending_followups;
-- = segmentation_completed_at is not null and manual_followup_status = 'pending'（ブロック中を除く）を新しい順
```

ローカルから（回答を日本語で表示）:

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
   and exam_intent in ('planned','considering_high')
   and diagnosis_applied_at is null
   and blocked_at is null;
```

```bash
npm run admin -- segment --grade=grade_1,grade_2 --exam_intent=planned,considering_high --diagnosis_applied=false
npm run admin -- segment --interest=parenting_communication
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
- 回答: `grade` / `exam_intent` / `interest`
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
3. `3問に回答する` → Q1〜Q3 をタップ（トーク画面に `【学年】…` 等が残る）→ 完了メッセージ＋診断CTA。
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
2. **一斉メッセージ（Official Account Manager から人間が手動）**: 「3つの質問に答えると、美穂先生がお子さんの状況を確認します」＋ボタン（テキスト `3問に回答する`）。

## テスト

```bash
npm install
npm test
```

PGlite（メモリ上のPostgres）で実際のマイグレーションSQLを流し、LINE APIは偽物に差し替えて実送信ゼロで検証する。
