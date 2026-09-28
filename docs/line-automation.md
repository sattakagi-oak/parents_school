# 親の学習塾 LINE自動化（Phase 1）

LINE友だち追加 → 3問セグメント → 7日間教育配信 → 1,000円診断CTA → クリック・申込の記録。
LINE Messaging API + Neon（標準PostgreSQL、`pg` ドライバ）+ Vercel Functions / Cron。既存LP（`index.html`）には一切手を入れていない。

## 構成

| パス | 役割 |
|---|---|
| `api/line/webhook.js` | `POST /api/line/webhook` 署名検証・follow/unfollow/postback/message |
| `api/cron/parent-line-education.js` | `GET /api/cron/parent-line-education` 教育配信（Vercel Cron 毎日20:00 JST） |
| `api/line/cta.js` | `GET /api/line/cta?t=…` CTAクリック記録 → 申込ページへ302 |
| `api/admin/line/users.js` | `GET /api/admin/line/users` セグメント抽出（要ADMIN_API_TOKEN・送信なし） |
| `api/admin/line/diagnosis-applied.js` | `POST /api/admin/line/diagnosis-applied` 申込済み手動登録 |
| `api/_lib/messages.js` | **配信文面・選択肢はすべてここ** |
| `api/_lib/config.js` | 送信モード判定（唯一の送信可否判断） |
| `db/migrations/001_parent_line.sql` | テーブル定義 |
| `scripts/admin.mjs` | 管理スクリプト（抽出・申込登録・集計・Cronドライラン） |
| `vercel.json` | Cron設定のみ |

## 送信の安全装置

| `LINE_SEND_MODE` | 動作 |
|---|---|
| `disabled`（既定・未設定・typoも含む） | 誰にも送らない。DB保存・状態更新・送信予定ログ（`skipped_disabled`）のみ |
| `test` | `LINE_TEST_USER_IDS` のユーザーにだけ送る。他は `skipped_not_test_user` |
| `production` | 全員に送る。**`LINE_SEND_ENABLED=true` も同時に必要**（どちらか欠けたら disabled） |

- 送信関数（reply / push）の内部で毎回モードと宛先を再確認する。
- broadcast / multicast は**コード自体が存在しない**。
- スキップされた配信はステップを進めないので、後でモードを切り替えると続きから送られる。
- 同じ教育メッセージは `parent_line_message_logs (line_user_id, campaign_key)` の一意制約で1回だけ。push には `X-Line-Retry-Key` を付け、LINE側でも重複を防ぐ。
- ログには userId・トークン・本文を出さない（`api/_lib/log.js` の許可キーのみ）。

## データ

`parent_line_users`（1ユーザー1行、`line_user_id` unique）
- 回答: `grade` / `exam_intent` / `interest`（再回答は最新値で上書き、完了日時と教育開始日は変えない）
- `education_step`: 次に送るステップ（0=Day0未送信 … 7=完了）
- `diagnosis_cta_clicked_at`（初回クリック）/ `diagnosis_applied_at` / `blocked_at`
- `cta_token`: CTAリンク用のランダムID（URLにuserIdを載せないため）

`parent_line_message_logs` 送信履歴・二重送信防止 / `parent_line_events` 行動履歴（follow, 回答, CTAクリック等。Webhook bodyは保存しない）

全テーブルRLS有効・ポリシーなし（多層防御。アプリの接続ロール＝テーブル所有者には影響なし）。

マイグレーション: `db/migrations/*.sql` を `npm run db:migrate` で適用。適用済みファイルは `schema_migrations` に記録され、同じコマンドを開発・Preview・Production の各DBに対して実行すれば同じスキーマになる。

### セグメント抽出例

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
npm run admin -- education-dry-run
```

## 3問セグメントの流れ

- follow（新規・ブロック解除）→ 未回答ならあいさつ + Q1（Quick Reply、postback）
- postback `action=segment&question=<grade|exam_intent|interest>&value=<内部値>` → 値を許可リストで検証して保存 → 未回答の最初の質問を出す
- 3問そろった初回 → `segmentation_completed_at` / `education_started_at` 記録 → 完了メッセージ + Day0 を返信（返信は無料枠を消費しない）
- `action=segment&question=start` またはテキスト「3問に回答する」「診断スタート」→ Q1から（既存友だち用）

## 7日間教育配信

Cron（1日1回）で `segmentation_completed_at` あり・ブロックなし・未完了のユーザーを抽出し、
「3問回答日（日本時間）から `day` 日以上経過」したら次の1ステップだけ送る。

| step | day | 内容 |
|---|---|---|
| 0 | 0 | 中学受験は小4から突然始まるものではない（3問完了時に返信で送信） |
| 1 | 1 | 勉強を「やらされるもの」にしない |
| 2 | 2 | 今やること・まだやらなくていいこと |
| 3 | 3 | 子ども3人東大だけではない（講師紹介） |
| 4 | 4 | 小4・小5で多い相談 |
| 5 | 5 | セルフチェック |
| 6 | 6 | 1,000円診断CTA（申込済みはスキップ、`PARENT_DIAGNOSIS_URL`/`PUBLIC_BASE_URL` 未設定なら保留） |

---

## セットアップ手順（ユーザー作業）

### 1. Neon（DB）

このサービス専用の Neon プロジェクトを使う（他サービスと混在させない）。ブランチで環境を分ける:

| Neonブランチ | 用途 | 接続する場所 |
|---|---|---|
| `production` | 本番 | Vercel Production |
| `development`（productionから作成） | 開発・Preview | `.env.local`、Vercel Preview |

1. Neon Console → プロジェクト → **Branches** → **New branch** → 名前 `development`、親 `production`。
2. 各ブランチの **Connect** で接続文字列を取得（**Connection pooling ON** が `DATABASE_URL`、OFF が `DATABASE_URL_UNPOOLED`）。
3. マイグレーションを各ブランチへ適用:
   ```bash
   npm run db:migrate                                   # .env.local の接続先（development）
   DATABASE_URL_UNPOOLED='<productionの直結URL>' node scripts/migrate.mjs   # 本番（本番反映時のみ）
   ```
4. Neon CLI を使う場合: `neon link` / `neon checkout <branch>` で `.env.local` に接続情報が書き込まれる（`.neon` と `.env.local` は git 管理外）。

### 2. Vercel

1. https://vercel.com/new → GitHub の `sattakagi-oak/parents_school` を Import。
   - Framework Preset: **Other**、Build Command / Output Directory は空のまま。
2. **Settings → Environment Variables** に下表を追加（Production と Preview を分けられる。Preview＝ステージング扱い）。
3. **Settings → Git** で Production Branch が `main` であることを確認。作業ブランチ `feature/parent-line-automation` を push すると Preview URL で先に確認できる。
4. デプロイ後の URL（例 `https://parents-school.vercel.app`）を `PUBLIC_BASE_URL` に設定し再デプロイ。

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
| `CRON_SECRET` | 32文字以上のランダム文字列 | Vercel Cron が自動で送る |
| `ADMIN_API_TOKEN` | 32文字以上のランダム文字列 | 管理API用 |
| `PARENT_DIAGNOSIS_URL` | 申込ページURL | 未定なら空でOK（CTAは保留） |
| `PUBLIC_BASE_URL` | Vercel の公開URL | |

ランダム文字列の作り方: `openssl rand -hex 32`

> 注意: Vercel Hobby（無料）プランは商用利用不可の規約。Cronは Hobby でも1日1回なら動作する。
>
> Vercel Marketplace の Neon 連携（Storage → Neon）を使うと Preview デプロイごとにDBブランチを自動作成できるが、新しいNeonプロジェクトが作られる。既存の Neon プロジェクトを使うため、上表のとおり環境変数を手動設定する方式を採用。

### 3. LINE Developers

1. https://developers.line.biz/console/ → 対象プロバイダー → Messaging API チャネル。
2. **Basic settings** の一番下「Your user ID」（`U` から始まる33文字）＝運営者本人の userId。これを `LINE_TEST_USER_IDS` に入れる。
3. **Messaging API** タブ → **Webhook URL** に `https://<VercelのURL>/api/line/webhook` を入力 → **Update** → **Verify** →「Success」を確認。
4. 同じ画面の **Use webhook** を ON。
   - `LINE_SEND_MODE=disabled` なので、この時点では誰にもメッセージは飛ばない（友だち追加・回答はDBに記録される）。
5. LINE Official Account Manager 側の「あいさつメッセージ」「応答メッセージ」は従来どおり動く。3問フローを本番化する際に、あいさつメッセージと重複しないか見直す。

### 4. 運営者本人でのテスト（`LINE_SEND_MODE=test`）

1. Vercel で `LINE_SEND_MODE=test`、`LINE_TEST_REGISTER_CODE=<16文字以上の合言葉>` にして Redeploy。
2. 本人のLINEから公式アカウントへ `テスト登録 <合言葉>` と送る →「テスト用アカウントとして登録しました」が届く（DBの `parent_line_test_users` に登録）。
   - 合言葉が違う場合は無反応。`LINE_TEST_USER_IDS` にuserIdを直接書く方法も併用可。
   - 解除は `テスト解除`。
3. `3問に回答する` と送る（またはブロック → ブロック解除）→ Q1 が届く。
4. Q1→Q2→Q3 をタップ → 完了メッセージ + Day0 が届く。
5. Neon Console **Tables** → `parent_line_users` で回答・`segmentation_completed_at`・`education_step=1` を確認。
6. 翌日以降の確認を早めたい場合は Neon Console の **SQL Editor** で
   `update parent_line_users set education_started_at = education_started_at - interval '1 day' where line_user_id = '<本人>';`
   → Vercel **Settings → Cron Jobs** の **Run** で手動実行 → Day1 が届く。
7. `education_step` を 6 にして同様に実行 → CTA が届く → ボタンを押す → `diagnosis_cta_clicked_at` が入り申込ページへ遷移。
8. もう一度 Cron を実行しても同じメッセージが届かないこと（`parent_line_message_logs` が `sent`）。
9. 他の友だちには何も届いていないこと（`parent_line_message_logs` の `skipped_not_test_user`）。
10. テスト後は `LINE_SEND_MODE=disabled` に戻しておく。

### 5. 本番配信の開始（明示的な許可が出てから）

`LINE_SEND_MODE=production` と `LINE_SEND_ENABLED=true` の**両方**を設定して Redeploy。
この時点から、新規友だち追加者に3問が届き、回答済みユーザーに教育配信が始まる。

## 既存の友だち（約100人）を3問に誘導する方法（案・未実施）

followイベントは新規追加時にしか来ないため、既存友だちは次のいずれかで3問を開始してもらう。
回答した人から順にDBに登録される。**本番配信許可が出るまで実施しない。**

1. **リッチメニュー**（推奨・送信数ゼロ）: Official Account Manager でリッチメニューにボタンを追加し、アクションを「テキスト」＝`3問に回答する` に設定。タップした人だけにQ1が返信される（返信は無料）。
2. **一斉メッセージ（Official Account Manager から手動）**: 「3問に回答すると、お子さんの学年に合った情報をお届けします」＋ボタン（テキスト `3問に回答する`）。送信は管理画面から人間が行う。
3. 既存友だちが何か発言した時点でDBに行が作られる（回答は未入力のまま）ので、未回答者の把握にも使える。

## 管理者セグメント配信（次フェーズ・未実装の設計）

- `POST /api/admin/line/send` 認証: `ADMIN_API_TOKEN` + 別途 `ADMIN_SEND_CONFIRM` の二重確認。
- body: `{ filters, campaignKey, messages, dryRun: true }`。既定は dryRun で対象件数のみ返す。
- 送信は `sendTracked`（push・1人ずつ）を使い、campaignKey 単位で二重送信防止・送信モード制御をそのまま適用。
- 上限件数（例: 1回200件）と、LINE月間メッセージ上限の残数チェックを入れる。

## テスト

```bash
npm install
npm test
```

PGlite（メモリ上のPostgres）で実際のマイグレーションSQLを流し、LINE APIは偽物に差し替えて実送信ゼロで検証する。
