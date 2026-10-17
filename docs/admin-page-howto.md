# オーナー専用の管理ページ

> 配る日の本番反映(D1 0008〜0010・各 Worker の再デプロイ)の順番は [release-day-runbook.md](release-day-runbook.md) にまとめた。

2026-10-14。`cloudflare/peta-admin` の Friends / Coupons / Release を使い、友達のメール登録、招待停止・再開、クーポン発行・停止、配布状況の確認を1ページで行います。UI とコードのコメントは英語です。

初回の依存準備・D1 マイグレーション・認証設定が空の管理 Worker デプロイは、2026-10-15 にオーナーの依頼と既存の Wrangler ログインで実施しました（各手順に記録）。Access 設定・API トークンの作成・秘密鍵の登録は、引き続き**オーナーが手動で**行います。

## 最初の準備（この順番）

1. **ローカルの依存ライブラリを入れる**。

   ```bash
   cd cloudflare/peta-admin
   npm ci
   npx wrangler login
   ```

   **実施済み（2026-10-15、00:04 JST）**: `cloudflare/peta-admin` で `npm ci` 成功（99パッケージ）。既存のオーナー OAuth ログインを `wrangler whoami` で確認し、対象アカウントと `d1 (write)` 権限が一致したため、`wrangler login` のやり直しは不要でした。アカウント・権限は変更していません。インストール後の `npm test` は21件成功、`npm run check` は型エラーなし。依存バージョンは変更していません。`npm ci` の監査は開発用依存に7件（moderate 2 / high 5）を報告しており、このセットアップでは依存の自動修正を行っていません。

2. **D1 に追加の表を作る**。`0007_admin.sql` は `admin_log` と変更を直列化する `admin_locks` を追加します。既存の表や値を変えません。管理 Worker の migrations_dir は `../peta-api/migrations` です。

   ```bash
   npx wrangler d1 migrations apply peta-dev --env dev --remote
   npx wrangler d1 migrations apply peta-prod --env prod --remote
   ```

   **実施済み（2026-10-15、dev 00:02:57 / prod 00:03:23 JST に適用開始）**: `cloudflare/peta-api` から両環境の `migrations list ... --remote` を確認し、未適用の `0006_coupons.sql` と `0007_admin.sql` を dev → prod の順で適用しました。両環境とも成功し、適用後の `migrations list` は `No migrations to apply!`。**peta-api 本体の再デプロイはしていません**。

   同日 Claude の確認時に発生したエラー7403は、今回の dev/prod の一覧取得・適用・再確認では再現しませんでした。既存 OAuth ログインと同じアカウント `7ebfd4fac7f7545a9e34a963af32ae7c` で成功しているため、今回の作業にログインのやり直しは不要でした。以前の7403の直接原因は特定していません。

3. **設定が空のまま初回デプロイ**して Worker を作ります。`secret list` に Worker が必要なため、この順番です。最初は全要求が403になります。dev から試してください。

   ```bash
   npm run deploy:dev
   npm run deploy:prod
   ```

   **実施済み（2026-10-15、dev 00:05:28 / prod 00:06:40 JST にデプロイ開始）**: dev を先にデプロイして403を検証後、prod をデプロイしました。`ACCESS_TEAM_DOMAIN`・`ACCESS_AUD`・`OWNER_EMAILS` は両環境とも空、`assets.run_worker_first=true`、`preview_urls=false` のままです。Access の設定、`CF_API_TOKEN`・`COUPON_SIGNING_KEY` の登録はしていません。

   | 環境 | 公開 URL | バージョン ID | curl 確認（JST） |
   |---|---|---|---|
   | dev | [peta-admin-dev](https://peta-admin-dev.peta-api.workers.dev) | `a7fef90e-f611-4daf-b02c-664c5a4b9a1d` | 2026-10-15 00:06:24、全9件403 |
   | prod | [peta-admin-prod](https://peta-admin-prod.peta-api.workers.dev) | `a04dc4c2-91cb-42a3-90b7-a3595560b9d4` | 2026-10-15 00:07:01、全9件403 |

   確認先は `/`、`/api/release`、静的ファイル全7件（`/index.html`、`/admin.js`、`/friends.js`、`/coupons.js`、`/release.js`、`/style.css`、`/ui.js`）。すべて HTTP 403 と管理 Worker の `forbidden` 応答を確認しました。次は以下の **手順4（管理専用 Access）**からオーナーが設定します。

4. **管理 Worker の workers.dev に、別の Access アプリケーションを作る**。Workers & Pages → `peta-admin-prod`（dev は `peta-admin-dev`）→ Settings → Domains & Routes → workers.dev の Cloudflare Access を「すべての Traffic」に有効化します。Zero Trust のチームは既存の `peta-friends` を使えます。Settings → Authentication → Login methods の **One-time PIN** を有効にします。

   管理アプリケーションには新しい **Peta owner** ポリシー（Allow / Include Emails = 自分のメールだけ）を付けます。Everyone、友達用の Peta friends、Cloudflare account members などの追加 Allow は付けません。管理用アプリケーションの **Application Audience (AUD) Tag** を控えます。ダウンロード用の AUD とは別です。dev にも別の管理アプリケーションと AUD を設定します。

5. **友達用ポリシーの ID を調べる**。Zero Trust → Access → Policies の再利用可能ポリシー **Peta friends** を開き、ID を控えます。見つからなければ既存のダウンロード用ポリシーを再利用可能ポリシーに変換し、そのポリシーがダウンロード用 Access アプリケーションに付いていることを確認します。管理 Worker はアカウント単位の `/accounts/{account_id}/access/policies/{policy_id}` を使います。アプリケーション専用ポリシーの ID は使えません。

   `Peta friends` は Allow、Include はメールで、オーナー自身のメールも1件残してください。他の規則・除外・Require・セッション設定は実装が保持しますが、Everyone などの広い Include や別の友達用 Allow があるとメール削除だけでは締め出せません。Cloudflare ダッシュボードと管理ページを同時に編集しないでください。管理ページ同士はロックと一覧の版で衝突を検出しますが、Cloudflare API に条件付き更新の契約はありません。

6. **API トークンを作る**。Cloudflare → My Profile → API Tokens → Create Custom Token。権限は対象アカウントの **Access: Apps and Policies → Edit** だけ（API 文書では `Access: Apps and Policies Write`）。Resources はこのアカウントだけに限定します。Global API Key や Workers / R2 / D1 の権限は不要です。値はリポジトリやチャットに貼らず、対話式で登録します。

   ```bash
   npx wrangler secret put CF_API_TOKEN --env prod
   # dev も必要なら、同じ対象アカウントに限定したトークンを登録
   npx wrangler secret put CF_API_TOKEN --env dev
   ```

7. **vars を設定する**。`wrangler.jsonc` のそれぞれの env.vars に次を入れます。秘密鍵・トークンはここには入れません。

   | var | 値 |
   |---|---|
   | ACCESS_TEAM_DOMAIN | `https://peta-friends.cloudflareaccess.com` |
   | ACCESS_AUD | その管理用 Access アプリケーションの64文字の AUD |
   | OWNER_EMAILS | 自分のメール。複数ならカンマ区切り。すべて削除保護対象 |
   | CF_ACCOUNT_ID | 対象アカウントの32桁の ID（既存設定と同じ） |
   | ACCESS_FRIENDS_POLICY_ID | 再利用可能 Peta friends ポリシーの UUID |
   | COUPON_KEY_ID | prod は `c2`、dev は `c1` |
   | COUPON_PUBLIC_KEY | スクリプトが表示する公開鍵（秘密ではない）。dev は RFC テスト公開鍵が設定済み |
   | DOWNLOAD_PAGE_URL | 既存のダウンロードページ。prod/dev の既定値は設定済み |

   **prod では `OWNER_EMAILS` は var ではなく secret**です(オーナーのメールをリポジトリに残さないため。`wrangler.jsonc` の prod.vars から外してあり、同じ名前の var と secret は両立しません)。変えるときは `printf '%s' 'a@example.com' | npx wrangler secret put OWNER_EMAILS --env prod`。

   ACCESS_TEAM_DOMAIN / ACCESS_AUD / OWNER_EMAILS のどれかが空・不正なら全員403です。OWNER_EMAILS に入れるだけでは Access のポリシーは変わりません。両方を同じオーナーにしてください。vars は env 間で自動継承しません。

8. **クーポン専用の秘密鍵を作成・登録する**。リポジトリのルートで、オーナーが手動実行します。

   ```bash
   bash scripts/coupon-key.sh dev
   bash scripts/coupon-key.sh prod
   ```

   prod は新しい Ed25519 鍵を作り、32バイト seed の base64 をパイプ相当の標準入力から `npx wrangler secret put COUPON_SIGNING_KEY --env prod` に渡します。秘密部分は画面、引数、環境変数、ファイルへ出しません。Wrangler のファイルログを無効にし、ログの伏せ字も有効に固定しています。**公開鍵だけ**が表示されます。既存の secret がある場合は端末で `REPLACE` を入力しない限り上書きしません。初回 Worker がない場合や secret 一覧が読めない場合は、鍵を作らず停止します。

   dev は**公開済み RFC 8032 テスト鍵 c1**を登録します。誰でも署名できる公開のテストデータなので、本番では使いません。このスクリプトは秘密鍵の手元バックアップを作りません。新しい鍵 ID によるローテーションを前提にしてください。

9. **本物の公開鍵をアプリへ入れる**。`src-tauri/crates/core/src/official_keys.rs` の **COUPON_KEYS の末尾**に `("c2", Some("表示された公開鍵"))` を追加します。同じ公開鍵を prod の `COUPON_PUBLIC_KEY` にも入れます。Worker は発行前にその公開鍵で自己検証し、秘密鍵との不一致を拒否します。`KEYS` は触りません。公式の `k2` の秘密鍵は今までどおり手元の暗号化ディスクにだけ置きます。

   更新したベータ版アプリを配ってから、prod のクーポンを発行してください。**c2 が入っていない通常版・ベータ版は管理ページのクーポンを受け取れません。** c1 はテスト・Peta Developer だけが信用します。dev 管理ページで発行して Peta Developer の Redeem Code… で試せます。

10. **設定を反映して確認する**。

    ```bash
    cd cloudflare/peta-admin
    npm test
    npx tsc --noEmit
    npm run deploy:dev
    npm run deploy:prod
    ```

    自分のメールでログインしてタブ(Friends・Coupons・Daily・Shop・News・Reports・Market・Release)が表示されること、別の友達のメールでは入れないことを確認します。新しいメール追加 → ダウンロードページ → 招待コード → Mac 接続 → 停止／再開をテストします。クーポンは dev で発行し、Peta Developer で内容・期限・1台1回を確認してから prod に進みます。

## 日々の操作

- **Friends**: 1件、改行、またはカンマ区切りで追加します。200件まで。Copy invitation の文を Discord / LINE の DM へ手動で送ります。追加しただけでは招待コードは作られず、友達がページを初めて開くと作られます。既に止めた招待を再追加した場合は、必要なら Resume invite も押してください。
- **Remove friend**: 確認後、まず D1 の招待を止め、それから Access のメールを外します。一度もページを開いていない人にも停止済みの招待行を作り、古いログインから有効な招待を作れないようにします。Cloudflare 更新失敗時は **招待の停止は保持**され、画面に部分成功を表示します。Refresh して Remove を再試行してください。自分のメールは削除できません。
- **Pause / Resume invite**: メール一覧は変えず、オンライン機能と DMG の利用を止める／戻します。Mac との結び付けは保持します。新しい Mac のコード交換は今までどおり友達のダウンロードページで行います。
- **Coupons**: 名前は自動で大文字、再利用不可。最大10種類・同じ物は1行。各上限は Rust と契約テストで一致を確認しています。時刻は端末の時間帯で表示し、D1 と署名イベントは UTC・秒単位で保存します。終了日はその日の終わりまで（翌日0時が排他的な終了時刻）。既定14日後。人数は Mac の台数です。確認画面の Issue coupon で発行し、Copy Discord message の文を手動で投稿します。`coupon.py` で作ったものも同じ一覧に出て、Stop / Stop all の対象です。
- **Release**: 最新版、サイズ、公開日、版ごとのユニークなメールハッシュ数（人数）とダウンロード回数を表示します。DMG アップロードは `publish-release.sh` のままです。

監査は D1 の `admin_log` です。操作するオーナーと対象メールは既存と同じ SHA-256 ハッシュ、他はクーポン名・上限・状態・Cloudflare の HTTP 状態と数値エラーコードだけです。メール本文・API トークン・JWT・署名 seed・Cloudflare の生のエラー文は保存しません。GET は監査表へも書き込みません。ハッシュは既知メールを照合できる仮名データで、匿名化ではありません。

## 受け入れ済みのリスクと緊急停止

クーポン秘密鍵を置いた Worker が乗っ取られると、**上限内の bundle を勝手に発行される可能性**があります。Scraps・封筒・素材・リンクタグ・ボード・ショップのパックが対象です。上限は1イベントごとで、総発行数を制限するものではありません。アプリはクーポン鍵で署名されたものを `bundle`・`daily_table`・`announcement`・`shop_config` だけに限り、画像付きパック・ステッカー・revoke などは信用しません(それぞれの上限もアプリ側で検査)。公式の `k*` は手元で管理し続けます。クーポン鍵による特典発行の権限は画像・お金・個人情報には及びません。

1. 管理ページの **Stop all** を確認して全クーポンを停止する（手元署名のクーポンも対象）。管理 Worker に入れなければオーナーの Wrangler で D1 を操作します。

   ```bash
   cd cloudflare/peta-api
   npx wrangler d1 execute peta-prod --env prod --remote --command "UPDATE coupons SET stopped_at=unixepoch() WHERE stopped_at IS NULL"
   ```

2. 侵害された管理 Worker の Access / デプロイを停止し、API トークンを失効・再発行する。安全なコード・設定へ戻してから秘密鍵を交換する。
3. アプリの COUPON_KEYS から問題の鍵を外すか公開鍵を `None` にし、信用しない版を配る。新しい鍵は **c3**（以降 c4…）として追加する。古い ID のまま別の鍵に交換しない。`coupon-key.sh prod` の上書きは確認して実行し、表示された公開鍵を新しい ID で追加して `COUPON_KEY_ID` も同じ ID にし、`COUPON_PUBLIC_KEY` も新しい公開鍵にする。
4. 新しいアプリが行き渡るまでクーポン発行を再開しない。既に適用済みの特典を取り戻すことはできず、古いアプリや取得済みイベントへの信用はアプリ更新まで残る。

既存動作を変えないため、次の制限があります。Access のメール削除後も、**既に発行された Access セッションは期限までページの外枠を表示できる場合**があります。停止した招待は DMG とアプリの新しい通信を拒否します。即時に外枠も閉じる必要があるときはオーナーが Cloudflare のセッション失効も行います。また既存の `peta-api` の受け取り処理は変更していないため、停止直前に始まった受け取りが完了する可能性があります。

## API 文書とローカル検証

確認した Cloudflare の公式契約（2026-10-14）:

- [Get an Access reusable policy](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/policies/methods/get/)
- [Update an Access reusable policy](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/policies/methods/update/): GET / PUT `/accounts/{account_id}/access/policies/{policy_id}`、Include のメールは `{"email":{"email":"..."}}`。更新可能な他の項目は保持し、ID・作成日時などの読み取り専用項目は送らない。
- [Access policy management](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/policy-management/)
- [Access session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)

署名の契約ファイルは `cloudflare/peta-admin/test/coupon-vector.json`。公開テスト鍵・固定日時・base64 イベント・期待 items・全上限を含み、Worker テストが再生成結果と照合し、Rust の `include_str!` テストが decode → apply_event とバイト一致・上限一致を確認します。更新が必要なときだけ `cd cloudflare/peta-admin && node scripts/coupon-vector.mjs` を実行し、差分をレビューしてください。通常のテストは契約ファイルを書き換えません。

検証結果と未確認項目は [admin-page-report.md](archive/reports/admin-page-report.md)。既存の手元署名は [coupon-howto.md](coupon-howto.md)、配布は [download-page-howto.md](download-page-howto.md) を参照してください。

## 2026-10-15 の本番セットアップ(実施済み)

- Access: `peta-admin-prod` の workers.dev に「すべての Traffic」で Access を有効化。ポリシーは手順4の `Peta owner` の代わりに、**既定の `Cloudflare account members`**(このアカウントのメンバー=オーナーだけ)を使用。ログインは「Cloudflare でログイン」。AUD は `wrangler.jsonc` の prod に記入。
- `ACCESS_FRIENDS_POLICY_ID`: 再利用可能ポリシー `Peta friends` の ID を記入。
- `CF_API_TOKEN`: オーナーが作成・登録(権限は Access: Policies の編集のみ、対象はこのアカウントだけ、期限なし)。権限不足のエラーが出たら Access: Apps の読み取りを足す。
- `COUPON_SIGNING_KEY`: `coupon-key.sh prod` で登録。公開鍵 `bnSW7bDoApbt1Gb5AgowuBXL441K0oqN/iOJea+Xy4I=` を `COUPON_PUBLIC_KEY` と、アプリの `COUPON_KEYS` の `c2` に記入。**c2 入りのアプリを配るまで、本番のクーポンは友達のアプリで受け取れない。**
- `OWNER_EMAILS`: secret で登録。
- 再デプロイ後、未ログインの要求は Access のログインへ転送されることを確認。オーナーのログインと友達一覧の読み込みはオーナーがブラウザで確認する。

## Daily

素材の通常表と期間限定イベントは[毎日の素材の使い方](daily-table-howto.md)を参照してください。素材の新規実装は[新しい素材を追加する手順](new-material-howto.md)。クーポン鍵の権限はbundle・daily_table・announcement・shop_configだけです(それ以外は拒否)。

## 第2弾: Reports / News / Shop / Market(2026-10-16)

指示書は [codex-admin-round2-prompt.md](archive/prompts/codex-admin-round2-prompt.md)、実装の報告は [admin-round2-report.md](archive/reports/admin-round2-report.md)。

### 反映の準備(オーナー)

1. D1 に `0010_signed_configs.sql` を適用する(`signed_configs` 表を足すだけ。既存の表は変えない。指示書の「0009」は更新用に使用済みだったため 0010)。

   ```bash
   cd cloudflare/peta-api
   npx wrangler d1 migrations apply peta-dev --env dev --remote
   npx wrangler d1 migrations apply peta-prod --env prod --remote
   ```

2. `peta-admin` を再デプロイする(`npm run deploy:dev` → 確認 → `npm run deploy:prod`)。`wrangler.jsonc` に R2 `peta-reports-<env>` を `REPORTS` として足してある(管理ページは読むだけ。消すのは `peta-api` の日次 Cron)。
3. `peta-api` は dev だけ再デプロイしてよい。**prod は配布の日にまとめて**。prod が古いままでも、アプリは `/v1/config` が 404 なら従来の `/v1/daily-table` を読む(お知らせとショップ設定はその間届かない)。
4. お知らせの Discord リンクは `src-tauri/src/daily_supply.rs` の `link_url` に招待 URL が入っている(2026-10-16 時点で設定済み)。招待 URL を変えたら、その版のアプリを配るまで古い URL が開く。ダウンロードページのリンクは版ごとに埋め込み済み(Developer は dev、それ以外は prod)。

### Reports(通報)

- タブの赤い数字は未対応の件数。一覧は未対応が上、次に新しい順。送り手・通報者は**鍵ハッシュの先頭8文字**だけ(サーバーに名前はない)。「Sender … · N reports」は同じ送り手への通報の合計。
- **View contents** で R2 の `reports/<ID>.json` を読み、Gift の絵とメモ(またはマーケットの出品のカードの絵とパックの絵・文)を出す。絵は PNG だけを `blob:` の画像として表示し、文字はすべてプレーンテキスト。ダウンロードのボタンはない。中身が消えている(対応後30日の削除)・アップロードが途中で終わった通報は、その旨を表示する。
- 操作はすべて確認つきで `admin_log` に残る(`report.resolved` / `report.sender_blocked` / `report.sender_unblocked`。送り手は64桁の鍵ハッシュで記録)。

**対応の流れ**

1. Discord の Webhook で「新しい通報(ID)」を知る(件数と ID だけ。今までどおり)。
2. 管理ページの Reports で該当 ID を開き、View contents で中身と理由を見る。通報は本人の同意で送られたもので、内容の真偽はサーバーでは確かめていない。通報だけで処分を決めない。
3. 問題がなければ **Resolve**。日次 Cron が30日後に中身と行を消す。
4. 送り手を止めるときは **Block sender**。理由を書き、「この送り手の未対応の通報もまとめて対応済みにする」を選べる。止めた鍵は `peta-api` の認証後の API 全般で `403 blocked` になる(配達済みの物は戻らない。新しい鍵での再参加は止められない)。
5. 誤りなら Blocked senders の **Unblock**。先頭8文字が同じ鍵が2つあるときは画面からは外せないので、[server-howto.md](server-howto.md) の Wrangler の手順で外す。
6. 出品そのものを閉じる必要があるときは、従来どおり [server-howto.md](server-howto.md) の「出品を止める」の手順。

### News(アプリ内のお知らせ)

- 本文(英語、1行、140字まで)、種類(Info / Event / Maintenance)、リンク(なし / ダウンロードページ / Discord の招待。自由な URL は入れられない)、開始・終了(端末の時間帯で入力、最長1年)。「How it looks」は友達のアプリと同じくプレーンテキストで表示する。
- 保存するとクーポン鍵で `announcement` に署名して `signed_configs` に入れる。同時に有効・予定にできるのは10件まで。**Stop** で止める。
- アプリ(server 入りの版)は6時間に1回 `/v1/config` を読み、期間中で閉じていないもののうち**開始が一番新しい1件**を Today の上に帯で出す。友達が×で閉じると、その Mac では同じお知らせは二度と出ない。止めたお知らせは次の確認で消える。offline 版にはない。
- アプリ側にも同じ上限(種類・リンクの2択・140字・1行・期間)があり、外れたお知らせは丸ごと無視する。

### Shop(Market の Featured と公式パック)

- Market の Featured は**各 Mac の中だけで**決まる: 見られる友達の出品(自分のでない・売り切れでない・知っている友達・カードが開けた・オンライン)があればランダムに1つ、なければここで選んだ公式パック(複数ならランダム、何も選ばなければ Tokyo Pack)、売っていない・袋がいっぱいのものは除き、どちらもなければ Featured の枠ごと出ない。Market を開くたびに選び直し、開いている間は変わらない。友達の出品の情報は管理ページにもサーバーにも来ない。
- **Official first** を付けると、期間中は公式パックが友達の出品より先になる(新しい公式パックを出した週など)。
- **New and popular の並び**(↑↓)、各パックの **On sale**、**値段**(Scraps)、**Market の一行**(英語、120字まで)。値段は組み込みの値段の **50%〜200%**(例: Pixel Dream 12 → 6〜24)。**無料のパック(Tokyo / Coffee / Houseplants)には値段を付けられない**。On sale を外すと、そのパックの交換も無料の Get もできなくなり、New and popular からも消える(持っている人の Packs の棚はそのまま)。
- **Standing setting** は今の設定を置き換える(内部では400日の期限で署名。400日たつと組み込みのショップに戻るので、それまでに一度保存し直す)。**For a period** は期間中だけ Standing より優先する。
- アプリは同じ上限を検査し、外れた設定は丸ごと無視する(部分的に直して使わない)。表示される値段と実際に引かれる Scraps は同じ関数から出る(`scraps::pack_offer`)。

### Packs(公式パックの下書きと掲載)

- 公式パックの下書き(絵・名前・レア度・値段)を作り、オーナーの Mac で `bash scripts/sign-pack.sh <draftId> prod` を打って署名し、ここで期間を決める。**このページは署名しない・鍵を選ばせない**。手順は [official-packs-howto.md](official-packs-howto.md)。
- 署名済みのパックは Shop タブの Featured・並び・値段にも出る(`shop:<packId>`)。

### Market(見るだけ)

- 公開中の出品数、出品している友達の数、30日の引かれた回数と使われた Scraps、売り手に入った取り分(全期間と30日)。日ごとの棒グラフ2つ(回数 / Scraps)と表。日付は UTC。
- 集計だけを返す。誰が・何を・いくつ、鍵ハッシュ、出品 ID は出さない。公式ショップの交換は各 Mac の中だけなので出ない。

## 2026-10-16 の本番更新(実施済み)

- prod D1 `peta-prod` に 0008(確率表)・0009(アプリ内更新)・0010(お知らせ・ショップ設定)を適用。いずれも表の追加だけ。
- `peta-admin-prod`(Version `50dc3369-b25b-4478-92cd-a077291ae4d5`)と `peta-download-prod`(Version `aad5e72f-26c0-44b4-970c-73de597db6de`)を再デプロイ。Daily・Reports・News・Shop・Market のタブが本番でも使える。秘密(`CF_API_TOKEN`・`COUPON_SIGNING_KEY`・`OWNER_EMAILS`)はそのまま。
- **`peta-api-prod` は未更新**(招待の必須化を含むため、配る日にオーナーの Mac で招待コードを入れた後)。それまで管理ページで作ったクーポン・確率表・お知らせ・ショップ設定は、友達のアプリには届かない(まだ配っていないので影響なし)。

## 2026-10-17 の本番更新(実施済み)

- prod D1 `peta-prod` に 0011(公式パックの下書きと掲載)を適用。表の追加だけ。
- `peta-admin-prod`(Version `c7d5c58f-2423-411e-ba6d-925958a2f888`)を再デプロイ。Packs タブが本番でも使える(下書き → `sign-pack.sh <draftId> prod` → 期間を決めて掲載)。秘密 3 つはそのまま。
- **`peta-api-prod` は未更新**。掲載したパックが友達のショップに並ぶのは、配る日に `peta-api` を更新し、k2 入りの版のアプリが届いてから。

