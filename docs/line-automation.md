# 親の学習塾 LINE自動化（「親の習慣」チェックリスト導線）

既存の「親の習慣」チェックリスト（プレゼント）導線を残しつつ、文字入力をボタンに置き換えたもの。
新規ユーザーの操作は **友だち追加 → 学年を1タップ → チェック数を1タップ** の2操作で完了する。

```
友だち追加 → 挨拶＋学年ボタン(5区分)
  → [学年タップ] 学年・シートをDB保存 → チェックリスト画像＋案内＋0〜10個ボタン
  → [個数タップ] 個数・pending をDB保存 → お礼＋「わが子の強み・伸ばし方 個別分析」カード
  → 美穂先生が LINE Official Account Manager から本人として手動コメント
```

ステップ配信（3日・7日）・自動追客・AIによる個別コメントはない。価値は「30年以上、数百組の親子を見てきた美穂先生本人がコメントすること」。

LINE Messaging API + Neon（標準PostgreSQL、`pg` ドライバ）+ Vercel Functions。既存LP（`index.html`）は変更していない。Cronは使わない。

## 自動で送るもの（これ以外は送らない。すべて reply、push なし）

| きっかけ | 返信 |
|---|---|
| 友だち追加（follow） | 挨拶＋学年ボタン |
| 学年ボタン | チェックリスト画像＋案内＋0〜10個ボタン |
| 旧入力「①/②/1/2」（シート未取得の人のみ） | チェックリスト画像＋案内＋0〜10個ボタン |
| 個数ボタン（初回） | お礼＋個別分析カード（旧入力の人には任意の学年ボタンも） |
| 個数ボタン（選び直し） | 「チェック数を更新しました」 |

それ以外の自由入力・画像・CTAクリック・時間経過では何も送らない（美穂先生の手動コメントを邪魔しない）。

## 構成

| パス | 役割 |
|---|---|
| `api/line/webhook.js` | `POST /api/line/webhook` 署名検証・follow/unfollow/postback/message |
| `api/_lib/checklist.js` | 導線の本体（学年・旧入力・個数の処理） |
| `api/_lib/messages.js` | **挨拶・案内・カードの文面、学年区分、シート対応はすべてここ** |
| `api/line/cta.js` | `GET /api/line/cta?t=…` CTAクリック記録 → 申込ページ（`PARENT_DIAGNOSIS_URL`）へ302 |
| `api/admin/line/users.js` | `GET /api/admin/line/users` 抽出（要ADMIN_API_TOKEN・送信なし） |
| `api/admin/line/diagnosis-applied.js` | `POST /api/admin/line/diagnosis-applied` 申込済み手動登録 |
| `images/parent-check/present-1.png` / `present-2.png` | チェックリスト画像（静的ファイル） |
| `db/migrations/*.sql` | テーブル定義 |
| `scripts/admin.mjs` | 管理スクリプト（対応待ち一覧・対応状況更新・抽出・監査） |

## 学年区分とシート

| ボタン | 内部値 `education_stage` | シート `parenting_check_sheet` |
|---|---|---|
| 幼稚園・保育園 | `preschool` | `present_1` |
| 小学校低学年（小1〜2） | `elementary_lower` | `present_1` |
| 小学校中学年（小3〜4） | `elementary_middle` | `present_2` |
| 小学校高学年（小5〜6） | `elementary_upper` | `present_2` |
| 中学生以上 | `junior_high_plus` | `present_2` |

- `present_1` = 未就学〜小学校低学年まで（「先回り」チェック）→ `images/parent-check/present-1.png`
- `present_2` = 小学校中学年以降（「管理しすぎ」チェック）→ `images/parent-check/present-2.png`
- 画像は `PUBLIC_BASE_URL` + パスの HTTPS URL で送る（PNG 約145KB、LINE の上限内）。DBには識別値だけ保存。
- 元ファイル（`子育て相談/images`）はファイル名と中身が逆だったため、**中身で**割り当てている
  （`プレゼント② png.png` = 未就学〜低学年 → present-1、`プレゼント① .png` = 中学年以降 → present-2）。

### postback / displayText

- 学年: Flex の各ボタン = postback `action=stage&value=<education_stage>`、displayText `【学年】小学校低学年`
- 個数: Quick Reply 11個（0個〜10個）= postback `action=check_count&value=<0〜10>`、displayText `【チェック数】6個`
- DB保存は postback data を正とし、displayText はトーク画面に回答を残すためだけに使う（パースしない）。
  → 美穂先生は LINE Official Account Manager のトーク履歴だけで学年とチェック数が分かる。
- 学年ボタンは Flex なのでトーク上に残る。個数ボタン（Quick Reply）が消えた場合は、学年ボタンを押し直せばシートと個数ボタンが再表示される。

## DBに保存する項目（`parent_line_users`）

| タイミング | 項目 |
|---|---|
| 学年タップ | `education_stage`, `parenting_check_sheet`, `parenting_check_sheet_source='stage_button'`, `parenting_check_sheet_sent_at` |
| 旧入力 ①/② | `parenting_check_sheet`, `parenting_check_sheet_source='legacy_text'`, `parenting_check_sheet_sent_at`（`education_stage` は空） |
| 個数タップ | `parenting_check_count`(0〜10), `parenting_check_answered_at`（初回日時）, `manual_followup_status='pending'`（初回のみ） |
| CTAクリック | `diagnosis_cta_clicked_at`（初回日時） |
| 申込確認後（手動） | `diagnosis_applied_at` |

- 年代区分は厳密な学年ではないため、旧 `grade` は流用せず新カラム `education_stage` を追加（マイグレーション005、追加のみ）。
- 旧アンケート用の `grade` / `exam_intent` / `interest` / `segmentation_completed_at`、旧7日配信用の `education_step` / `education_started_at` は未使用（残置）。

## 「わが子の強み・伸ばし方 個別分析」カード

```
わが子の強み・伸ばし方 個別分析
30分 1,000円（延長あり）

今のお子さんについてお話を伺いながら、
・今どんな力が伸びているか
・お子さんの強み・得意
・次に何を伸ばすとよいか
・今やること／まだ急がなくていいこと
・お子さんに合った親の関わり方
・今後6〜12か月の方向性
を一緒に整理します。

[ 強みと伸ばし方を整理する ]
```

- ボタンのリンク先: `PUBLIC_BASE_URL/api/line/cta?t=<ユーザーごとのランダムトークン>` → `diagnosis_cta_clicked_at` を記録 → `PARENT_DIAGNOSIS_URL` へ302。URLにLINE userIdは載せない。
- `PARENT_DIAGNOSIS_URL`（https）か `PUBLIC_BASE_URL` が未設定、または申込済みの人にはカードを出さない（お礼のみ）。
- カードは1人1回（`parent_line_message_logs` の `check:complete`）。

### 無料コメントと有料個別分析の役割分担（運用）

- 無料コメント（美穂先生が手動）: 今回のチェック結果から見える **1つの気づき・方向性** だけ返す。
- 1,000円個別分析: お子さんの強み、次に伸ばすこと、親の関わり方、今後6〜12か月の方向性まで整理する。
- 無料コメントで有料の中身をすべて提供しない。

## 旧導線（①/②）との互換

現行の挨拶を受け取った既存ユーザーが「①」「②」「1」「2」（全角「１」「２」も）と送った場合:

- `①/1/１` → `present_1`、`②/2/２` → `present_2` のシート画像＋0〜10個ボタンを返す。
- 対象は **シート未取得の人だけ**（取得済みの人の「1」「2」はチェック数の手入力などの可能性があるため無視し、美穂先生が対応）。
- 厳密な学年は分からないので、個数回答後のカードの後に「よろしければ学年も教えてください（任意）」の学年ボタンを付ける。押すと `education_stage` だけ保存（シートは再送しない）。

## 美穂先生の手動フォロー

`manual_followup_status`: `pending`（個数回答時） → `completed`（コメント済み。`manual_followup_completed_at` も記録）/ `not_needed`。友だち追加やシート受け取りだけでは null。
コメントは自動化しない。美穂先生がトーク履歴（`【学年】…` `【チェック数】…`）と過去のやり取りを見て本人が送る。

### 対応待ち一覧

Neon Console → SQL Editor:

```sql
select * from parent_line_pending_followups;
-- 列: display_name, education_stage, parenting_check_sheet, parenting_check_sheet_source,
--     parenting_check_count, parenting_check_answered_at, diagnosis_cta_clicked_at,
--     diagnosis_applied_at, manual_followup_status（新しい回答が上）
```

ローカルから（日本語表示）:

```bash
npm run admin -- pending
npm run admin -- followup-done <id>        # コメントしたら
npm run admin -- followup-not-needed <id>
```

### 抽出例（送信はしない）

```bash
npm run admin -- segment --education_stage=preschool,elementary_lower --count_min=5 --diagnosis_applied=false
npm run admin -- segment --parenting_check_sheet=present_2 --manual_followup_status=pending
npm run admin -- mark-applied <id>
npm run admin -- stats
```

## 送信の安全装置

| `LINE_SEND_MODE` | 動作 |
|---|---|
| `disabled`（既定・未設定・typoも含む） | 誰にも送らない。DB保存・状態更新のみ |
| `test` | テスト用ユーザー（`LINE_TEST_USER_IDS` または LINEから「テスト登録」した人）にだけ送る |
| `production` | 全員に送る。**`LINE_SEND_ENABLED=true` も同時に必要**（どちらか欠けたら disabled） |

- 送信関数は reply のみ。push / broadcast / multicast は**コード自体が存在しない**。
- reply のたびに送信直前でモードと宛先を再確認（挨拶・シート・お礼・カード・旧入力すべて）。
- 実際に送った返信は `parent_line_events` に `message_sent`、テスト対象外で止めた返信は `send_blocked` として記録。
  `npm run admin -- audit` で「テストユーザー以外への実送信: 0件」を確認できる。
- ログには userId・トークン・本文を出さない（`api/_lib/log.js` の許可キーのみ）。
- Cron なし（`vercel.json` なし）。時間で動く自動送信は存在しない。

### 開発用コマンド（テスト用ユーザーのみ。production では全て無効）

| 送る文字 | 動作 |
|---|---|
| `テスト登録 <合言葉>` | そのアカウントをテスト用ユーザーに登録（`LINE_TEST_REGISTER_CODE`、16文字以上） |
| `テスト開始` | 友だち追加直後の挨拶＋学年ボタンを受け取る（既存の自動応答ONのまま新導線を試すため） |
| `テストリセット` | 学年・シート・個数・対応状況・CTAクリックを消して友だち追加直後に戻す |
| `テスト解除` | テスト用ユーザーの登録を解除 |

## データ・マイグレーション

`parent_line_users`（1ユーザー1行、`line_user_id` unique）/ `parent_line_message_logs` 1回限りの返信の記録 / `parent_line_events` 行動履歴（Webhook bodyは保存しない）/ `parent_line_test_users` テスト用ユーザー。
全テーブルRLS有効・ポリシーなし。

`db/migrations/*.sql` を `npm run db:migrate` で適用（適用済みは `schema_migrations` に記録。開発・Preview・Production で同じコマンド）。

---

## セットアップ（ユーザー作業）

### Neon

| Neonブランチ | 用途 | 接続する場所 |
|---|---|---|
| `production` | 本番 | Vercel Production |
| `development` | 開発・Preview | `.env.local`、Vercel Preview |

```bash
npm run db:migrate                                   # .env.local の接続先（development）
DATABASE_URL_UNPOOLED='<productionの直結URL>' node scripts/migrate.mjs   # 本番（本番反映時のみ）
```

### Vercel 環境変数

| 変数 | 値 | 備考 |
|---|---|---|
| `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers の値 | |
| `LINE_SEND_MODE` | `test`（テスト中）/ `disabled` | `production` は本番切替時のみ |
| `LINE_SEND_ENABLED` | `false` | 本番切替時のみ `true` |
| `LINE_TEST_USER_IDS` | 運営者の userId | 任意（LINEからの「テスト登録」でも可） |
| `LINE_TEST_REGISTER_CODE` | 16文字以上の合言葉 | テスト登録用。本番切替時に削除 |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | Neon 接続文字列 | Production=production / Preview=development |
| `ADMIN_API_TOKEN` | 32文字以上のランダム文字列 | 管理API用 |
| `PARENT_DIAGNOSIS_URL` | 個別分析の申込ページURL（https） | 未設定ならカードなし |
| `PUBLIC_BASE_URL` | 本番の公開URL | 画像URL・CTAリンク生成用（本番で未設定だと画像が送れない）。Preview では無視され、Vercel が自動設定するブランチURL（`VERCEL_BRANCH_URL`）を使う |

環境変数を変えたら、対象ブランチのデプロイを Redeploy。Deployment Protection の Vercel Authentication は OFF（ON だと Webhook が 401、画像も取得できない）。

### テスト手順（`LINE_SEND_MODE=test`、既存の自動応答はONのまま）

1. `テスト登録 <合言葉>`（登録済みなら不要）→ `テストリセット` → `テスト開始`
2. 挨拶＋5つの学年ボタン → 学年をタップ → 正しいシート画像＋0〜10個ボタン
3. 個数をタップ → お礼＋個別分析カード → 「強みと伸ばし方を整理する」→ 申込ページへ遷移
4. `select * from parent_line_pending_followups;` に表示、`npm run admin -- audit` で「テストユーザー以外への実送信: 0件」
5. 旧入力の確認: `テストリセット` → `①` または `②` → シート → 個数 → カード＋任意の学年ボタン

※ 既存の「応答メッセージ」がONの間は、テスト用ユーザーが送った「①」「テスト開始」等に既存の自動応答も返ることがある（新導線の動作とは無関係）。

### 本番切替（ユーザーが明示的に許可した後にのみ実施）

1. LINE Official Account Manager →「あいさつメッセージ」をOFF
2. LINE Official Account Manager →「応答メッセージ」をOFF
3. その他の自動応答（キーワード応答・AI応答等）が残っていないか確認
4. LINE Developers → Messaging API → Webhook の利用がONであることを確認
5. production DB へマイグレーション、`feature/parent-line-automation` を main へマージ
6. Vercel Production の環境変数を確認（`DATABASE_URL`=productionブランチ、`PUBLIC_BASE_URL`=本番URL、`PARENT_DIAGNOSIS_URL`、`LINE_TEST_REGISTER_CODE` 削除）し、LINE Developers の Webhook URL を本番URLに変更して Verify
7. `LINE_SEND_MODE=production` と `LINE_SEND_ENABLED=true` を設定して Production を Redeploy
8. 別のLINEアカウントで新規友だち追加し、挨拶 → 学年 → シート → 個数 → カードまで最終確認

既存の友だち約100人には、この切替だけでは何も送られない（送信は相手の操作への返信のみ）。

## テスト

```bash
npm install
npm test
```

PGlite（メモリ上のPostgres）で実際のマイグレーションSQLを流し、LINE APIは偽物に差し替えて実送信ゼロで検証する。
