# S1 / S2 / S3 サーバーの運用手順

2026-10-14 更新。審判役の台帳（S1）と友達・Gift の受信箱・通報（S2）、友達のMarket（S3）、公開前修正を扱います。実装・デプロイは dev のみ。本番の準備は下記のオーナー用手順です。

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

`wrangler` は package.json の 4.149.0 に固定しています。URL は `server-resources.md` と `src-tauri/src/referee.rs` の `API_URL` を揃えます。開発者版だけ `PETA_API_URL` で HTTPS または localhost の HTTP に上書きできます。既定の通信なし通常版では上書きもHTTP clientもコンパイルしません。通常設定＋serverのベータ版は非Developerの本番API定数を使い、上書きできません。

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

この実装作業では本番への migration / deploy を行いません。S1 / S2 は開発者版限定です。鍵の復元と友達・受信箱は実装済みですが、独自ドメインと公開条件の確認は別工程です。

```sh
cd cloudflare/peta-api
npx wrangler whoami
npx wrangler d1 migrations list peta-prod --remote --env prod
npx wrangler d1 export peta-prod --remote --env prod --output /安全な保存先/peta-prod-before-s2.sql
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

端末の `device.key` は既存どおり 0600 の秘密鍵です。Worker に秘密鍵・API トークンは置きません。D1 / account ID は公開情報です。S2 の Settings → Your Peta key から `.petakey` に書き出し／復元できます。端末データと鍵を失うと台帳の持ち主へアクセスできません。OS のバックアップ対象には DB・assets と鍵を揃え、鍵をログやリポジトリへ貼らないでください。

## API の JSON

既存 Rust の serde と合わせて camelCase を使います。Creation / Transfer の署名形式・Gift v1〜v3・Pack v1/v2 は変えていません。パック登録は `packId, creatorKey, slotCount, headerDigest, editions[{creation,release}], movedReleases, sourceIds`。`sourceIds` は端末の取り消し待ち用で、Worker は版の署名と台帳で判断します。cancel は登録と同じ `PackRegistration` 全体を送り、登録本文の SHA-256 を照合します。取り消した release の署名と pack 登録の digest を台帳に残し、遅れて届いた元の操作を拒否します。単なる再送と、成功した cancel の後に同じ操作を復活させることは区別します。枠の claim は `{claim: Transfer | null}`。応答 `{slots:[n,…]}` は全端末共通の使用済み枠です。S2 では署名したパック作者に限り `drawers:[{slot,keyHash},…]` が追加されます。作者以外は従来どおり番号だけで、生の鍵は返しません。友達の名前への対応は端末内だけで行います。

## 保存と受け取りが競合した場合

Gift / Pack ファイルの公開と SQLite の COMMIT は同じトランザクションにできません。公開直後に別端末で受け取られ、その後のローカル保存が失敗すると、サーバーは取消を拒否します。このときは相手の持ち主を守り、Gift 原本を gone、パックの移動原本を gone・刷った原本を pressed にして `referee_reconciliations` に記録します。既に受け取られた操作は「Nothing was changed」ではなく専用文言で表示します。パックの材料・Tag 在庫も取消 intent の記録から控除します（復旧時に不足する在庫は0で止め、遠隔台帳を取り消して埋め合わせることはしません）。ローカルの完成パック記録は自動で復元しないので、復旧件数がある場合はデータを保全して調査します。

接続不能なら取消 intent を保持し、該当原本を再送・再 press できません。404 を取消成功と見なして intent を消すこともしません。


## S2 の dev と受信箱

`0002_inbox.sql`、`peta-reports-dev`、dev の GIFTS / REPORTS binding は Step 2 で適用済みです。Step 7 の更新は `npx wrangler@4.149.0 deploy --env dev` で再デプロイします。通常版に `server` は含めず、Developer の dev URL を本番へ流用しません。

コード／リンクをコピーしたとき、または友達の追加で受信箱を登録します。未登録で友達0人なら受信箱 API は呼びません。登録後は友達0人でも申請を受け取るため確認します。起動時・Gifts・Check now・60秒以上後のフォーカス、Automatically で15分ごとに確認します。S1 台帳の同期と受信箱の確認は別です。

申請と Gift は HPKE で封をしたまま保存されます。未処理は7日で期限切れ、受信箱 API の掃除でD1のメッセージ索引と友達申請を削除し、GIFTS のオブジェクトは7日のライフサイクルでも消します。厳密な7日後の物理削除やクラウド側バックアップからの即時消去を保証するものではありません。現行コードは一覧・取得を含む受信箱 API で掃除します。通常の受取後／送り手の取消／退会でもGiftのR2と索引を消します。R2のライフサイクルは非同期です。[Cloudflare object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) を参照してください。

## S2 の本番準備（オーナーのみ・この作業では実行しない）

前掲の本番 D1 export / migrations / deploy の**前に**、同じアカウントで通報用の非公開バケットを準備します。`peta-gifts-prod` は作成済みですが、7日の削除ルールをDashboardで確認します。

```sh
cd cloudflare/peta-api
npx wrangler@4.149.0 r2 bucket create peta-reports-prod --env prod
npx wrangler@4.149.0 secret put REPORT_WEBHOOK --env prod
# secret put の対話欄に運営専用のDiscord Webhook URLを入力（コマンドやGitには書かない）
npx wrangler@4.149.0 d1 migrations list peta-prod --remote --env prod
npx wrangler@4.149.0 d1 export peta-prod --remote --env prod --output /安全な保存先/peta-prod-before-s2.sql
npx wrangler@4.149.0 d1 migrations apply peta-prod --remote --env prod
npx wrangler@4.149.0 deploy --env prod
```

R2 → `peta-reports-prod` の Public access で r2.dev と公開カスタムドメインを有効にしません。REPORTS は「対応後30日」のため、作成後30日の一律ライフサイクルを設定しません（未対応分を消してしまうため）。`wrangler.jsonc` の対象D1・2つのバケット・secretを照合し、最新migrationが `0002_inbox.sql` まで適用されることを確認します。S1から未適用なら0001も適用されます。重複作成が不要な既存バケットは作り直しません。参考: [R2 Wrangler commands](https://developers.cloudflare.com/r2/reference/wrangler-commands/)。

devで通報運用を試すときは、上のバケット名・DB名・`--env` をすべて dev に揃えます。Webhookは任意ですが、未設定だと知らせは来ないので定期的に通報索引を確認する必要があります。Webhookの送信失敗は保存成功を取り消さず、通知の自動再送もありません。

## 通報を見る・対応する・30日後に消す

Webhookに届くのは件数と通報IDだけです。件数は**保存中の全通報数**で、未対応件数とは限りません。理由・画像・本文・公開鍵／鍵ハッシュをWebhookへ送りません。D1 の `reports` はID・通報者と送り手のハッシュ・理由・時刻、R2 の `reports/<ID>.json` はそれに `gift`（base64の復号済み元Gift）を持ちます。

```sh
npx wrangler@4.149.0 d1 execute peta-prod --remote --env prod --command "SELECT id,reporter_hash,sender_hash,reason,created_at FROM reports ORDER BY created_at DESC LIMIT 50;"
npx wrangler@4.149.0 r2 object get peta-reports-prod/reports/確認したID.json --remote --env prod --file /安全な保存先/report.json
```

Cloudflareアカウントと保存先は運営だけに制限し、通報ファイル・画像・理由をGitやチャット、Webhookへ転送しません。取り出したJSONの `gift` をbase64復号すると Giftの `.peta` ファイルです。受領経路・Giftの署名・内容を確認し、通報者が指定した sender_hash だけで処分を決めません（APIは通報内容の真偽を検証しません）。必要な対応・対応日・削除予定日をアクセスを絞った運営記録に残します。0004でresolved_atと保存状態・重複索引を追加済みです。通報の真偽は運営が原本で確認し、対応済みIDの時刻を記録します。

対応を終えた通報は、下の「通報の上限と対応後の削除」のSQLでresolved_atを記録します。日次Cronが30日以上経ったR2本文とD1行を削除し、失敗時は再試行します。未対応は消しません。手元に取得したファイルと運営の内容コピーは、同じ期限で担当者が別途削除します。

保持の例外の法的判断、Cloudflareのbackup・削除依頼・開示への扱いはオーナーと専門家が決めます。自動削除を避ける必要のある記録を、通常の対応済みと同じように無断で扱わないでください。担当者は解決時刻の記録と日次Cronの失敗を確認します。

## 運営の拒否（blocked_keys）

対象は公開鍵そのものではなく、公開鍵32バイトをSHA-256した**64桁の小文字hex**です（base64文字列を直接ハッシュしない）。`reports.sender_hash` と同じ形。署名と事実を確認した鍵だけを登録します。SQLの例のハッシュと理由を確認した値に置き換え、理由に引用符があればSQL文字列として正しくエスケープします。

```sh
npx wrangler@4.149.0 d1 execute peta-prod --remote --env prod --command "INSERT INTO blocked_keys(key_hash,reason,at) VALUES('確認した64桁hash','confirmed abuse',unixepoch()) ON CONFLICT(key_hash) DO UPDATE SET reason=excluded.reason,at=excluded.at;"
# 誤登録の解除
npx wrangler@4.149.0 d1 execute peta-prod --remote --env prod --command "DELETE FROM blocked_keys WHERE key_hash='確認した64桁hash';"
```

認証後のAPI全般に `403 blocked` が効き、既存台帳・R2のデータを消す処理ではありません。既存の配達済み／保存済みGiftの回収や、新しい鍵での再参加は止められません。利用者のBlockは自分の受信箱の拒否リストであり、運営全体の拒否とは別です。

## 退会と鍵の引っ越し

Settings の Leave は本人が署名して `DELETE /v1/mailbox/{id}` を呼び、**自分の受信箱**、許可／拒否リスト、そこにある申請・未受取GiftとR2の中身を消します。ローカル友達はサーバーの状態を外してファイルGiftのTOFU行として残り、登録・確認設定をリセットします。受取済みGift・ステッカー・台帳（持ち主／移動／枠）・通報・運営の拒否は消えません。相手の受信箱へ送った未受取分は相手の受取／期限切れまで残り得ます。台帳を消すと持ち主の保証が壊れるため、削除依頼は種類を分けて確認します。運営の拒否に入った鍵は本人の退会APIも拒否されるため、必要な受信箱削除は運営が別途対応します。

`.petakey` は `device.key` と `box.key` のバックアップだけです。12文字以上のパスフレーズを2回入力して封をし、パスフレーズを失うと復元できません。Collection・友達・配置・受取済みGift・画像は含みません。新Macへはアプリを止め、移行アシスタント／Time Machine で通常版 `~/Library/Application Support/app.peta.desktop/`、Developer `~/Library/Application Support/app.peta.developer/` のデータフォルダ**全体**を移します。必要な場合だけ移したフォルダで鍵を復元し、鍵・DB・assets の組合せを保ちます。同じ鍵なら受信箱IDは継続しますが、空のDBへ鍵だけ復元しても友達と手元の本物は戻りません。旧Macは同じ鍵で起動しません。同期や2台同時利用は未対応です。

## S3 友達の Market の dev

`0003_market.sql`、R2 `peta-market-dev`、dev の MARKET binding は 2026-10-13 に適用・作成済みです。Worker を変えたら `npx wrangler@4.149.0 deploy --env dev` で再デプロイします。実 API の往復は `CARGO_INCREMENTAL=0 cargo test --manifest-path src-tauri/Cargo.toml -p peta --features developer market_live -- --ignored`(終わると出品を閉じて3人とも退会します。台帳・売上の小さな記録は dev に残ります)。

上限は `wrangler.jsonc` の `vars` で変えます: `MARKET_LISTINGS`(売り手1人の出品、既定 10)、`MARKET_PULLS_PER_DAY`(買い手1人の24時間、既定 20)、`MARKET_CARD_MAX`(カードの大きさ、既定 1 MiB)。値段 6 と取り分 700‰ は Rust と Worker の定数です(変えるときは両方と検証用データを直す)。

## S3 の本番準備(オーナーのみ・この作業では実行しない)

S2 の本番準備の後に行います。`peta-market-prod` は**非公開**にし、r2.dev と公開カスタムドメインを有効にしません。出品をやめると Worker が暗号文を消すので、一律のライフサイクルは設定しません。

```sh
cd cloudflare/peta-api
npx wrangler@4.149.0 r2 bucket create peta-market-prod
npx wrangler@4.149.0 d1 export peta-prod --remote --env prod --output /安全な保存先/peta-prod-before-s3.sql
npx wrangler@4.149.0 d1 migrations apply peta-prod --remote --env prod
npx wrangler@4.149.0 deploy --env prod
```

Cloudflare の使用量の通知に R2(保存量)を足します。1人あたり出品 3つ・平均 10MB で 1,000人なら約 30GB(無料枠 10GB を超えた分は月 0.015ドル/GB)。

## 出品を止める・通報を見る(運営)

出品の通報は S2 と同じ `REPORTS` に `kind: "listing"` と `listingId` で保存されます。中身(復号済みのカードとパック)は通報した人の同意で送られたものです。運営が出品を止めるときは、D1 で `UPDATE market_listings SET state='closed' WHERE listing_id='…'` を実行し、R2 `market/{listingId}/card` と `/pack` を消します(`npx wrangler@4.149.0 r2 object delete peta-market-prod/market/{listingId}/card --remote` など)。売上の行と `for_sale` の判定は残します(消すと、出品したパックを無料で開けるようになるため)。鍵ごと止めるときは S2 の `blocked_keys` を使います。

## 2026-10-14: 通報の上限と対応後の削除

Worker `0004_reports.sql` は通報の内容ハッシュ・対応時刻と保存状態を追加します。同じ通報者・送り手・内容は既存IDを返します。通報者の受信箱の許可/拒否リストにある送り手のみ通報できます。出品は本人宛ての封筒があった証拠も必要で、封筒の削除後も出品ID・受取人/送り手のハッシュだけを保持します（封筒や内容鍵は保持しません）。

`REPORTS_PER_DAY=5` は直近24時間の新規件数、`REPORTS_PENDING=500` は未対応の全件数です。SQLiteの1つのINSERTで上限を確かめて予約し、並行処理でも超えません。R2への保存に失敗した予約も上限に数えます。同じ内容を再送するとその予約を修復します。予約だけ残った通報も運営が内容の有無を確認して対応済みにできます。Gift本文の署名は運営の確認対象で、サーバーのこのAPIだけでは真偽を決めません。通報だけで自動制裁しないでください。

対応を終えたIDだけ、以下で時刻を記録します。これは**オーナー用の運用例**です。IDは実際に確認したものに置き換えます。

```sh
cd cloudflare/peta-api
npx wrangler@4.149.0 d1 execute peta-dev --remote --env dev --command "UPDATE reports SET resolved_at=unixepoch() WHERE id='<report-id>' AND resolved_at IS NULL"
```

1日1回03:15 UTC（12:15 JST）のCronが、対応済みから30日以上のR2本文を消し、その後D1の行を消します。未対応・29日目は残ります。R2削除で失敗した行は次回やり直します。日次処理なので期限の時刻ぴったりの物理削除ではありません。本番の設定も定義していますが、本番への反映はオーナーだけが行います。

## 2026-10-14: 新しいMacへの全体移行

Settings → Move to a new Mac → Make a move file… でDB・assets・2つの鍵・その他の永続ファイルを `.petamove` に書き出します。12文字以上のパスフレーズを2回入力します。SQLiteはVACUUM INTOで一貫した写しを作り、ファイルは256KiBずつArgon2id＋ChaCha20-Poly1305で暗号化します。全体をメモリに載せず、順番・長さ・末尾まで認証します。キャッシュ、SQLiteの付随ファイル、途中の出版journalは移しません。

新しいMacで、初回起動の準備が済んだ後、まだ何も変更していない間にSettings → Restore a move file…を使います。自動の見本ステッカーとWelcome Packだけがある初期状態を含め、初回のDB変更数とファイル/DBの指紋を固定します。名前変更・作成・受領・配置変更等があると読み込めません。この実装は**同じ初回起動の間だけ**復元を許可し、既に使用済みのライブラリへの合流や再起動後の上書きは行いません。読み込みの前に全レコードを検証し、非公開の一時フォルダへ展開・DB/鍵/参照画像を検証してからデータフォルダをまとめて交換し、Petaを再起動します。失敗は以前のフォルダを保持し、途中停止は次の起動で復旧します。

復元後、古いMacのPetaはもう使わないでください。同じ鍵の2台同時利用・同期は未対応です。これはサーバーへの同期ではなく、サーバーへ何も送信しません。以前の `.petakey` の鍵だけの書き出し・復元は別の機能として残します。移行journalが残っている途中で古い版へ戻さず、この版で一度復旧を完了してください。

## 2026-10-14: 友達限定ベータのビルド

`npm run build:beta` は通常設定と同じ識別子・保存先でserverを含み、referee.rsの非Developer API_URLの固定値を使う。DeveloperはdevでPETA_API_URLの上書きを許す。既定のbuildはserverを含まない。正式署名・公証の前にパス検査を行う。通常版とベータを同じライブラリに同時起動しない。本番が未準備の間は配布しない。

## 2026-10-14: 規約・ポリシーの公開準備

terms-draft.mdとprivacy-policy-draft.mdの【オーナーが記入】を専門家と確定し、Cloudflareの契約・処理国・IP保持・問い合わせ運用を実際の本番設定と照合する。正式文書をHTTPSで公開してから、src-tauri/src/about.rsのSERVICE_LINKSのNoneだけをURLへ置換して再ビルドする。下書きのままサービスURLを設定しない。

GiftはStudioのDressで承認済み友達を選び、Sealで確認して送る。Someone elseは名前を書いたファイル保存。古いdraftはfileとして読め、削除/ブロックした相手は選び直す。既存のgift_send_friendとファイル保存の補償処理は維持する。

## 2026-10-14: 検証の範囲と配布前の残り

公開前修正の全自動テストと隔離ブラウザの確認はrelease-hardening-report.mdを参照してください。devに0004とWorkerを反映し日次Cronを登録しました。期限の分岐は隔離したWorkerテストで検証済みですが、実際のdev通報を作ってクラウドのCronで削除する確認は行っていません。運営は対応時刻を記録し、Cron/R2/D1の失敗を監視してください。0004以前の通報はcontent_hashがNULLのまま残るため、旧分への重複検出は遡及しません（対応後の削除は可能）。

本番R2/D1/deploy/secret/通知はオーナーだけが準備する。本作業はprodの照会も変更も行っていない。正式署名・公証、実Mac間移行、ネイティブWebView、友達Gift/Marketの実往復、規約確定、配布直前の依存監査が残る。
