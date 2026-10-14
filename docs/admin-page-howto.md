# オーナー専用の管理ページ

2026-10-14。`cloudflare/peta-admin` の Friends / Coupons / Release を使い、友達のメール登録、招待停止・再開、クーポン発行・停止、配布状況の確認を1ページで行います。UI とコードのコメントは英語です。

本番のデプロイ、Access 設定、API トークンの作成、秘密鍵の登録は、以下を読んだ**オーナーが手動で**行います。この実装作業では実行していません。

## 最初の準備（この順番）

1. **ローカルの依存ライブラリを入れる**。

   ```bash
   cd cloudflare/peta-admin
   npm ci
   npx wrangler login
   ```

2. **D1 に追加の表を作る**。`0007_admin.sql` は `admin_log` と変更を直列化する `admin_locks` を追加します。既存の表や値を変えません。管理 Worker の migrations_dir は `../peta-api/migrations` です。

   ```bash
   npx wrangler d1 migrations apply peta-dev --env dev --remote
   npx wrangler d1 migrations apply peta-prod --env prod --remote
   ```

3. **設定が空のまま初回デプロイ**して Worker を作ります。`secret list` に Worker が必要なため、この順番です。最初は全要求が403になります。dev から試してください。

   ```bash
   npm run deploy:dev
   npm run deploy:prod
   ```

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

    自分のメールで PIN ログインして3タブが表示されること、別の友達のメールでは入れないことを確認します。新しいメール追加 → ダウンロードページ → 招待コード → Mac 接続 → 停止／再開をテストします。クーポンは dev で発行し、Peta Developer で内容・期限・1台1回を確認してから prod に進みます。

## 日々の操作

- **Friends**: 1件、改行、またはカンマ区切りで追加します。200件まで。Copy invitation の文を Discord / LINE の DM へ手動で送ります。追加しただけでは招待コードは作られず、友達がページを初めて開くと作られます。既に止めた招待を再追加した場合は、必要なら Resume invite も押してください。
- **Remove friend**: 確認後、まず D1 の招待を止め、それから Access のメールを外します。一度もページを開いていない人にも停止済みの招待行を作り、古いログインから有効な招待を作れないようにします。Cloudflare 更新失敗時は **招待の停止は保持**され、画面に部分成功を表示します。Refresh して Remove を再試行してください。自分のメールは削除できません。
- **Pause / Resume invite**: メール一覧は変えず、オンライン機能と DMG の利用を止める／戻します。Mac との結び付けは保持します。新しい Mac のコード交換は今までどおり友達のダウンロードページで行います。
- **Coupons**: 名前は自動で大文字、再利用不可。最大10種類・同じ物は1行。各上限は Rust と契約テストで一致を確認しています。時刻は端末の時間帯で表示し、D1 と署名イベントは UTC・秒単位で保存します。終了日はその日の終わりまで（翌日0時が排他的な終了時刻）。既定14日後。人数は Mac の台数です。確認画面の Issue coupon で発行し、Copy Discord message の文を手動で投稿します。`coupon.py` で作ったものも同じ一覧に出て、Stop / Stop all の対象です。
- **Release**: 最新版、サイズ、公開日、版ごとのユニークなメールハッシュ数（人数）とダウンロード回数を表示します。DMG アップロードは `publish-release.sh` のままです。

監査は D1 の `admin_log` です。操作するオーナーと対象メールは既存と同じ SHA-256 ハッシュ、他はクーポン名・上限・状態・Cloudflare の HTTP 状態と数値エラーコードだけです。メール本文・API トークン・JWT・署名 seed・Cloudflare の生のエラー文は保存しません。GET は監査表へも書き込みません。ハッシュは既知メールを照合できる仮名データで、匿名化ではありません。

## 受け入れ済みのリスクと緊急停止

クーポン秘密鍵を置いた Worker が乗っ取られると、**上限内の bundle を勝手に発行される可能性**があります。Scraps・封筒・素材・リンクタグ・ボード・ショップのパックが対象です。上限は1イベントごとで、総発行数を制限するものではありません。クーポン鍵は画像付きパック・ステッカー・revoke・bundle 以外のイベントを信用しません。公式の `k*` は手元で管理し続けます。クーポン鍵による特典発行の権限は画像・お金・個人情報には及びません。

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

検証結果と未確認項目は [admin-page-report.md](admin-page-report.md)。既存の手元署名は [coupon-howto.md](coupon-howto.md)、配布は [download-page-howto.md](download-page-howto.md) を参照してください。
