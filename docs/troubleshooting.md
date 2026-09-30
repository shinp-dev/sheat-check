# Security / Realtime / Deployment Runbook

問い合わせ時は、画面または指定ログに表示されたエラーコード、発生時刻、Room ID、操作、HTTP statusを控えます。JWT、Authorization header、password、key、Cookieは収集しません。

## エラーコード対応表

| Error code | 意味 | 最初に見る場所 | 次に確認するもの |
| --- | --- | --- | --- |
| `RT-T-MAIN-01` | Teacher main Channel接続失敗 | TeacherブラウザConsole | Teacher Realtime JWT、RLS、Allow public access、Project設定 |
| `RT-T-INBOX-01` | Teacher回答Inbox接続失敗 | TeacherブラウザConsole | Teacher JWT、Inbox SELECT Policy、Channel topic |
| `RT-S-CHANNEL-01` | Student Channel接続失敗 | StudentブラウザConsole | Student JWT期限・roomId、RLS、Project設定 |
| `RT-RELAY-01` | Worker→Supabase回答relay失敗 | Cloudflare Worker logs | relay HTTP status、truncate済みSupabase response、Project稼働状態 |
| `CFG-SB-01` | WorkerのSupabase relay設定不足 | Cloudflare Worker logs | Worker `SUPABASE_URL`、service role key |
| `AUTH-T-01` | Teacher認証の代表的障害 | Browser + Worker logs | `JWT_SECRET`、Teacher account、Token期限、rate limit |
| `DEPLOY-01` | production deploy失敗（Runbook上の分類） | GitHub Actions | install/build/typecheck/test/D1/deployの失敗step |
| `KEEPALIVE-DB-01` | Supabase Keep Alive実クエリ失敗 | Cloudflare Worker logs | Worker `SUPABASE_URL`、service role key、Project pause、Auth Admin API応答 |

`DEPLOY-01` はworkflowが返すHTTPエラーコードではなく、運用上の検索・分類名です。`KEEPALIVE-DB-01` はWorker Cronの実行失敗を示すログコードです。

## Browser Console

対象: `RT-T-*`、`RT-S-*`。

1. 障害が出たTeacherまたはStudent画面を開いたままBrowser DevToolsを開く。
2. **Console** を選び、エラーコードでfilterする。
3. `status`、`roomId`、`channel`、安全に整形されたSupabase errorの `name` / `message` / `code` を確認する。
4. `CHANNEL_ERROR`、`TIMED_OUT`、`CLOSED` の順序と、10秒後の再接続結果を確認する。

Private Channel joinはブラウザからSupabaseへ直接行われ、Workerを通らない場合があります。その場合、Cloudflare Worker logsに何も出ないのは正常です。

TeacherのRealtime正常条件は、browser network online **かつ** main `SUBSCRIBED` **かつ** Inbox `SUBSCRIBED` です。mainだけ接続していても正常ではありません。StudentではChannel失敗時にHTTP fallback表示が有効になり、再接続後の `SUBSCRIBED` で解除されます。fallbackはRoom状態確認用であり、回答の自動再送ではありません。

JWT期限切れが疑われる場合、Teacherは再ログイン、Studentは画面を再読み込みして再チェックインします。古いJWT文字列をConsoleや問い合わせへ貼らないでください。

## Cloudflare Worker logs

対象: `RT-RELAY-*`、`CFG-*`、`AUTH-T-*`、`KEEPALIVE-DB-01`、その他Backend API内部障害。

リポジトリルートまたは `packages/backend` から、対象環境の設定を確認して実行します。

```bash
npx wrangler tail
```

Cloudflare Dashboardの **Workers & Pages → 対象Worker → Logs** からも確認できます。発生時刻とerror codeで絞り込みます。

`RT-RELAY-01` は `operation`、`roomId`、Supabase HTTP `status`、最大1000文字でCredential伏字済みの `response` を記録します。ネットワーク例外時は安全に整形したerror name/messageを記録します。ユーザーのHTTPレスポンスにはSupabase responseを返しません。

`CFG-SB-01` はProject URL自体やkeyを記録せず、処理名、Room ID、statusだけを記録します。relayの `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` の設定を確認しますが、値を出力しません。

## GitHub Actions

対象: CI、Deploy All。

1. GitHub Repositoryの **Actions** を開く。
2. 左側で対象Workflowを選ぶ。
3. 失敗Runを選ぶ。
4. 失敗Jobを開き、赤い失敗Stepを確認する。

### DEPLOY-01

`Deploy All` はNode 20で `npm ci` → build → typecheck → test → D1 migration → Worker deploy → Pages deployの順です。最初に失敗したStepを直します。D1 migration以降ならCloudflare credentials・binding・対象accountも確認します。ログを共有するときはtokenをマスクします。

### KEEPALIVE-DB-01

Cloudflare WorkerのCron Triggerは1日3回実行されます。Worker logsで `KEEPALIVE-DB-01` を検索し、`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` の設定、Projectの稼働状態、Auth Admin APIのHTTP statusを確認します。レスポンス本文やCredentialはログへ出しません。

## 症状別切り分け

### RT-T-MAIN-01

- Teacherが正しいRoomと単一Projectへ接続しているか。
- Teacher Realtime JWTが期限内か。期限切れなら再ログイン。
- `room:<roomId>` のSELECT/INSERT PolicyとAllow public access OFFを確認。
- retry後のsubscribe callbackにも同じcodeとstatusが出るか確認。

### RT-T-INBOX-01

- `room:<roomId>:teacher` へのTeacher SELECTが許可されるか。
- Student SELECT/INSERTが拒否されるか。
- mainだけ `SUBSCRIBED` の状態を正常と誤認しない。

### RT-S-CHANNEL-01

- Student JWTの `user_role=student` と `roomId` が対象Roomか。
- 別Room・Teacher Inboxのjoinが拒否されること自体は期待動作。
- fallback中も回答ボタンはWorker relayへ即時送信される。失敗時は別途 `RT-RELAY-01` / `CFG-SB-01` を確認。

### RT-RELAY-01

- Worker logのSupabase HTTP statusと安全なresponseを確認。
- Projectのpause・障害、REST Broadcast endpoint、service role keyの有効性を確認。
- user response本文にSupabase responseが露出していないことを確認。

### CFG-SB-01

- Workerの `SUPABASE_URL` が対象単一Projectか。
- relay時はservice role keyが設定済みか。URL・key実値をログへ出さない。

### AUTH-T-01

- Teacher accountの存在、password、login rate limitを確認。
- production `JWT_SECRET` と `SUPABASE_JWT_SECRET` が設定済みで開発既知値ではないか確認。
- ブラウザの期限切れリダイレクト後は再ログインする。

## ログ方針

原則ログ可能:

- error code、roomId、HTTP status、channel種別、処理名、timestamp
- 上限・伏字処理済みのSupabase error response
- Secretを含まないErrorのname/message/code、stack trace

ログ禁止:

- JWT本体、Authorization header、Cookie、認証Token
- Teacher password、`JWT_SECRET`、`SUPABASE_JWT_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`、anon key、publishable keyの本体
- その他Credential

Student氏名・Student IDはRealtime接続障害の診断に不要なので記録しません。独自ログDB、D1への障害ログ永続化、回答データの診断目的保存は行いません。
