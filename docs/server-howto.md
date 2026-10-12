# S1 サーバーの運用手順

2026-10-12。審判役の台帳だけを扱います。Gift の画像・本文・受信箱・友達・R2 は S2 以降です。

## 開発用

```sh
cd cloudflare/peta-api
npm ci
npm test
npm run check
npx wrangler whoami
npx wrangler d1 migrations apply peta-dev --remote --env dev
npx wrangler deploy --env dev
```

`wrangler` は package.json の 4.149.0 に固定しています。URL は `server-resources.md` と `src-tauri/src/referee.rs` の `API_URL` を揃えます。開発者版だけ `PETA_API_URL` で HTTPS または localhost の HTTP に上書きできます。通常版では上書きも HTTP クライアントもコンパイルしません。

```sh
npm run dev:developer
# ローカル Worker を使う場合
cd cloudflare/peta-api
npx wrangler dev --env dev
# 別の端末でリポジトリのルートから
PETA_API_URL=http://127.0.0.1:8787 npm run dev:developer
```

Settings → Peta checks に接続先・最後に応答を受けた UNIX 時刻・登録待ち・取り消し待ち・枠の引き待ち・保存中に他端末へ渡った操作の復旧件数が出ます。Sync now は登録と取り消しを送ります。引き待ちは次の Open で同じ署名・同じ枠を再送します。起動・窓のフォーカス復帰・操作前・作成後にも送信します。常時ポーリングはありません。自動の復旧は1回4件、Sync now は最大60件。HTTP 中は自動送信の Library mutex を解放し、オフラインではその回を止めます。拒否された1件が他の登録を止めることはありません。

## 本番（オーナーだけが行う）

この実装作業では本番への migration / deploy を行いません。S1 は開発者版限定です。独自ドメイン、鍵の復元、友達・受信箱、公開条件は後工程です。

```sh
cd cloudflare/peta-api
npx wrangler whoami
npx wrangler d1 migrations list peta-prod --remote --env prod
npx wrangler d1 export peta-prod --remote --env prod --output /安全な保存先/peta-prod-before-s1.sql
npx wrangler d1 migrations apply peta-prod --remote --env prod
npx wrangler deploy --env prod
```

デプロイ前にこのファイルと `wrangler.jsonc` の対象・D1 ID を照合します。`API_URL` の本番切替と配布版 feature の公開は別途決定します。開発用 URL のままで配布版の `server` を有効にしないでください。

## ログ・使用量

コードは公開鍵・IP・本文をログへ出しません。永続 Workers Logs は設定していません。必要なときだけ開発用で `npx wrangler tail --env dev` を使い、リクエストヘッダーや診断ダンプを共有しないでください。Dashboard の Workers & Pages / D1 の Metrics でリクエスト数・失敗・読み書き行数を確認します。

Workers の Rate Limiting binding は拠点ごとの近似制限で、period は 10/60 秒だけです。1分60回の補助制限に加え、D1 の鍵ハッシュ別カウンタで vars の `REQUESTS_PER_MINUTE` / `PACKS_PER_HOUR` を適用します。時間の窓は固定窓で、失敗した認証済みリクエストも数えます。nonce と古いカウンタは書き込み時に掃除します。GET は nonce を書きませんが、正確な回数制限用のカウンタを書きます。

利用プランで提供される通知を Dashboard → Notifications / Billing → Billable Usage でオーナーが設定します。Pay-as-you-go では使用量通知と予算通知を利用できます。通知は停止機能ではありません。無料枠は Dashboard で確認します。

参考: [Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)、[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)、[使用量通知](https://developers.cloudflare.com/billing/understand/usage-based-billing/)、[予算通知](https://developers.cloudflare.com/billing/manage/budget-alerts/)。

## D1 のバックアップと復元

D1 の Time Travel はサービス側の継続バックアップです。保持期間は契約プランによって異なるので Dashboard の利用可能期間を確認します。

```sh
npx wrangler d1 time-travel info peta-prod --env prod
# 復元はオーナーが対象時点・影響を確認してから行う
npx wrangler d1 time-travel restore peta-prod --bookmark 確認したbookmark --env prod
```

台帳を過去へ戻すと受取済みの Gift や枠が復活するため、通常のコード更新の巻き戻しには使いません。サービスを止め、復元後の端末との照合手順を決めてから使います。手動 export はアクセスを絞った保存先へ置き、Git に入れません。参考: [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)。

## 鍵

端末の `device.key` は既存どおり 0600 の秘密鍵です。Worker に秘密鍵・API トークンは置きません。D1 / account ID は公開情報です。鍵の Export / Import identity は S2 で、S1 の間は端末データと鍵を失うと台帳の持ち主へアクセスできません。OS のバックアップ対象には DB・assets と鍵を揃え、鍵をログやリポジトリへ貼らないでください。

## API の JSON

既存 Rust の serde と合わせて camelCase を使います。Creation / Transfer の署名形式・Gift v1〜v3・Pack v1/v2 は変えていません。パック登録は `packId, creatorKey, slotCount, headerDigest, editions[{creation,release}], movedReleases, sourceIds`。`sourceIds` は端末の取り消し待ち用で、Worker は版の署名と台帳で判断します。cancel は登録と同じ `PackRegistration` 全体を送り、登録本文の SHA-256 を照合します。取り消した release の署名と pack 登録の digest を台帳に残し、遅れて届いた元の操作を拒否します。単なる再送と、成功した cancel の後に同じ操作を復活させることは区別します。枠の claim は `{claim: Transfer | null}`。応答 `{slots:[n,…]}` は全端末共通の使用済み枠です。

## 保存と受け取りが競合した場合

Gift / Pack ファイルの公開と SQLite の COMMIT は同じトランザクションにできません。公開直後に別端末で受け取られ、その後のローカル保存が失敗すると、サーバーは取消を拒否します。このときは相手の持ち主を守り、Gift 原本を gone、パックの移動原本を gone・刷った原本を pressed にして `referee_reconciliations` に記録します。既に受け取られた操作は「Nothing was changed」ではなく専用文言で表示します。パックの材料・Tag 在庫も取消 intent の記録から控除します（復旧時に不足する在庫は0で止め、遠隔台帳を取り消して埋め合わせることはしません）。ローカルの完成パック記録は自動で復元しないので、復旧件数がある場合はデータを保全して調査します。

接続不能なら取消 intent を保持し、該当原本を再送・再 press できません。404 を取消成功と見なして intent を消すこともしません。
