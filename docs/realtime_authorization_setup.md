# Realtime Authorization・本番設定

このアプリは単一のWorker管理Supabase Projectを使用します。各Teacherが任意のProjectを持ち込む構成ではありません。コードのデプロイだけではPrivate Channel認可は完成しないため、以下の外部作業を本番merge前に行ってください。値の実物をGit、Markdown、Issue、ログへ記載しないでください。

## 1. Supabase Project

1. 対象となる単一Supabase Projectを用意する。
2. SQL Editorまたは管理されたmigration手段で [`supabase/migrations/202608300001_realtime_authorization.sql`](../supabase/migrations/202608300001_realtime_authorization.sql) を適用する。
3. `realtime.messages` に次のRLS Policyが存在し、有効であることを確認する。
   - Teacher: `room:%` のSELECT、`room:%` かつ `:teacher` で終わらないTopicへのINSERT
   - Student: JWT `roomId` と完全一致する `room:<roomId>` のSELECTのみ
   - StudentのBroadcast INSERTおよび `room:<roomId>:teacher` のSELECTは許可しない
4. Supabase Dashboardの **Realtime Settings** で **Allow public access** をOFFにする。
5. Project URL、legacy anon key、legacy service role key、legacy JWT secretを取得する。現行コードではこれらを使用する。

公式資料: [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)、[Realtime Settings](https://supabase.com/docs/guides/realtime/settings)、[API keys](https://supabase.com/docs/guides/getting-started/api-keys)。Realtime AuthorizationはChannel join時にPolicyを評価・キャッシュするため、Policyやclaim変更後はChannelを再接続して検証します。

`service_role` keyとJWT secretはブラウザ用設定ではありません。Roomへ保存するのはProject URLと公開anon keyだけです。

## 2. Cloudflare Worker

`packages/backend` から `npx wrangler secret put <NAME>` 等でproductionへ設定します。Project URLやOriginは秘密情報ではありませんが、環境別設定としてDashboardまたはWranglerで管理し、実値を資料へ直書きしない運用を推奨します。

| Name | 必要時期 | 用途・注意 |
| --- | --- | --- |
| `JWT_SECRET` | 常時必須 | アプリ用Teacher JWT署名。十分長いランダム値。開発既知値は禁止 |
| `SUPABASE_JWT_SECRET` | 常時必須 | 現行legacy Supabase JWT署名。Supabase Projectと一致させる |
| `SUPABASE_URL` | 常時必須 | 単一Project URL。Room POST/PUTとrelayがfail closedで照合 |
| `SUPABASE_SERVICE_ROLE_KEY` | 常時必須 | WorkerからREST Broadcastするためだけに使用。ブラウザ・D1・Gitへ置かない |
| `ALLOWED_ORIGINS` | 常時必須 | 正式なPages Originのみ。複数時はカンマ区切り。末尾 `/` を付けない |
| `INITIAL_TEACHER_USERNAME` | 初回bootstrapのみ | Teacherが0件のときだけ使用。初期作成確認後は削除可 |
| `INITIAL_TEACHER_PASSWORD` | 初回bootstrapのみ | 強い一時値。`admin123` はproductionで拒否。初期作成後は削除可 |

`ENVIRONMENT=production` は `wrangler.toml` に設定済みです。明示的な `development` / `test` 以外はfail-closed modeなので、bindingが欠落・未知値でも開発fallbackへ倒れません。`JWT_SECRET` / `SUPABASE_JWT_SECRET` が未設定または開発既知値ならToken発行を拒否します。`SUPABASE_URL` が未設定ならRoom保存を503で拒否し、異なるProject URLなら400で拒否します。比較は前後空白と任意個の末尾 `/` を除去します。

## 3. Room設定

Teacher画面で、上記の単一Projectと同じProject URLおよびその公開anon keyをRoomへ保存します。production APIがProject一致を強制します。`service_role` keyを入力してはいけません。

## 4. Supabase Keep Alive

Supabase Free Projectは低アクティビティ時にpauseされる可能性があります。production WorkerではCloudflare Cron Triggerを使い、1日3回（UTC 00:17 / 08:17 / 16:17）、Supabaseへ小さな実データベースアクセスを発生させます。

Keep AliveはWorker内だけにある \`SUPABASE_SERVICE_ROLE_KEY\` を使い、Supabase Auth Admin APIのユーザー一覧を \`page=1&per_page=1\` で取得します。レスポンス本文は解析・保存・ログ出力せず、成功可否だけを確認します。ブラウザやGitHub Actionsへservice role keyを渡しません。

Cron Triggerは \`packages/backend/wrangler.toml\` の \`[triggers]\` で管理します。失敗時はCloudflare Worker logsで \`KEEPALIVE-DB-01\` を確認し、Workerの \`SUPABASE_URL\` / \`SUPABASE_SERVICE_ROLE_KEY\`、Project稼働状態、Supabase Auth API応答を確認してください。詳細は[Runbook](./troubleshooting.md#keepalive-db-01)を参照してください。

旧GitHub Actionsの \`Supabase Keep Alive\` workflowは使用しません。Frontend build用のRepository Secrets \`SUPABASE_URL\` / \`SUPABASE_ANON_KEY\` は引き続き必要です。

Keep AliveはCloudflare Workers FreeのCron Trigger枠内で実行でき、追加課金を要求しません。Supabase公式では、Free Projectは過去7日間のユーザーデータベース活動が少ない場合にpause対象となり、通常は1日数回のユーザーDBリクエストでpause回避に十分とされています。ただしpause回避を保証する仕組みではありません。
## 無料構成とkey移行

現行機能は [Supabase Free](https://supabase.com/pricing) と [Cloudflare Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) の範囲で構成でき、Private Channel / Realtime Authorization自体のためにPro契約を必須化していません。本リポジトリは有料機能、課金設定、自動Plan移行、クレジットカード登録を要求しません。最新limitsは各公式ページを確認してください。

Supabaseの新しいpublishable/secret keyとSigning Keysへの移行は将来対応候補です。現行のlegacy anon/service role/JWT secretから今回切り替える必要はありません。

## デプロイ前チェックリスト

### Supabase

- [ ] `202608300001_realtime_authorization.sql` 適用済み
- [ ] `realtime.messages` のRLS Policyを確認済み
- [ ] Realtime Settingsの **Allow public access** がOFF
- [ ] Worker `SUPABASE_URL` とRoomで使うProjectが一致
- [ ] service role keyとJWT secretはWorker Secretだけに存在
- [ ] Student JWTで別Roomへjoinできない
- [ ] Student JWTでTeacher Inboxへjoinできない
- [ ] Student JWTでTeacher制御Broadcastを直接送信できない

### Cloudflare

- [ ] production `JWT_SECRET` 設定済み
- [ ] production `SUPABASE_JWT_SECRET` 設定済み
- [ ] `SUPABASE_URL` 設定済み
- [ ] `SUPABASE_SERVICE_ROLE_KEY` 設定済み
- [ ] Cloudflare Cron Triggerが1日3回設定済み
- [ ] `ALLOWED_ORIGINS` は正式Originだけ
- [ ] 開発既知Secretと `admin123` をproductionで使用していない
- [ ] 初期Teacher作成後のbootstrap credentialsを見直した

### 動作確認

- [ ] Teacher login、Room作成・更新・受付ON/OFF
- [ ] Student check-in、回答送信、Teacher回答受信
- [ ] Teacher reset、seat lock、Student eviction、Room layout update
- [ ] Realtime切断後の再接続
- [ ] Student fallbackが有効になり、再接続後に解除される
- [ ] 無効・期限切れJWTを拒否
- [ ] Browser Console / Worker logsにCredentialが出ない
- [ ] [`docs/troubleshooting.md`](./troubleshooting.md) に従い各ログへ到達できる

このチェックリスト完了後にのみ `main` へmergeしてください。
