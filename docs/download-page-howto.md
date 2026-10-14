# 友達限定ダウンロードページと招待コード(オーナー向け)

2026-10-14。Peta のベータを、招待した友達だけに配るための仕組みと手順です。

## しくみ

```
友達 ──(Cloudflare Access: 許可したメールに6桁のコード)──▶ peta-download Worker ──▶ 非公開の R2(peta-downloads-prod)
                                                                │ ページ・招待コード・DMG のどれも、Access を通った人にだけ返す
                                                                ▼
                                                    D1(peta-prod)の invites 表 ◀── peta-api(INVITE_REQUIRED=1)
                                                                                         ▲
                                                           アプリ: 最初の起動で招待コードを入れる
```

- **入口(ページとファイル)**: Cloudflare Access が許可リストのメールアドレスだけを通します。Worker も Access の署名(JWT)を毎回確かめ、チーム名と AUD が合わなければ誰にも何も返しません。設定が空のときも全員を断ります。DMG は公開URLのない R2 に置き、Worker を通してしか落とせません。
- **招待コード**: Access でログインした友達ごとに1つ、ページに表示します(`XXXXX-XXXXX`)。保存するのはメールアドレスのハッシュだけで、アドレスそのものは保存しません。
- **アプリ**: ベータ版(`build:beta`)は最初の起動でコードを聞き、`peta-api` で確かめます。本番の `peta-api` は、コードを入れていない Mac からの通信(友達、Gift、Market、ステッカーの登録)を `not_invited` で断ります。コードは **Mac 1台にだけ** 使えます。ページの「Get a new code」で新しいコードを出すと、前の Mac はつながらなくなります。
- **記録**: Access のログ(誰がいつログインしたか)と、D1 の `downloads` 表(誰のハッシュがどの版を落としたか)。

### 守れること・守れないこと

- 守れる: 許可していない人はページも DMG も見られない。DMG が外に渡っても、コードがなければ友達・Gift・Market につながらない。コードが漏れても、使えるのは同時に Mac 1台だけで、止めることもできる。
- 守れない: 渡ってしまった DMG で、**通信しない機能**(ステッカー作り、デスクトップに貼る)を使うこと。コード入力画面はアプリ内の案内で、改造すれば消せます。本当に止めているのはサーバー側です。
- 通信しない版(`build` / `release-mac.sh offline`)にはコード入力も確認もありません。**友達には配らないでください。**

## 最初に一度だけやること

コマンドは自分の Cloudflare ログイン(`npx wrangler login`)で動きます。鍵やトークンはリポジトリに書きません。

**2026-10-14 実施済み: 1〜3**(R2 の2つのバケットは r2.dev 公開なし、0005 を dev/prod の D1 に適用、`peta-download-prod` をデプロイ。Access 未設定のため全リクエストが 403 になることを確認)。残りは 4〜8。

1. **R2 バケットを作る**(非公開のまま。「公開アクセス」も「カスタムドメイン」も付けない)

   ```bash
   cd cloudflare/peta-download && npm ci
   npx wrangler r2 bucket create peta-downloads-prod
   npx wrangler r2 bucket create peta-downloads-dev
   ```

2. **D1 に招待の表を足す**(`peta-api/migrations/0005_invites.sql`)

   ```bash
   cd cloudflare/peta-api
   npx wrangler d1 migrations apply peta-dev --env dev --remote
   npx wrangler d1 migrations apply peta-prod --env prod --remote
   ```

3. **ダウンロードページを出す**。この時点では Access が未設定なので、誰が開いても「This page is for invited friends.」だけが出ます。

   ```bash
   cd cloudflare/peta-download && npm run deploy:prod
   ```

   アドレスは `https://peta-download-prod.peta-api.workers.dev`。

4. **Cloudflare Zero Trust を用意する**(無料プランで50人まで)。ダッシュボードの Zero Trust でチーム名を決めます(例: `peta-friends` → `https://peta-friends.cloudflareaccess.com`)。Settings → Authentication → Login methods に **One-time PIN** があることを確かめます(メールに6桁のコードが届く方式。Google アカウントは要りません)。

5. **workers.dev に Access をかける**。Workers & Pages → `peta-download-prod` → Settings → Domains & Routes → `workers.dev` の「Cloudflare Access」を有効にします。できた Access アプリケーションの Policy を次のようにします。
   - Action: **Allow**
   - Include: **Emails** に友達のメールアドレス(自分のも)
   - それ以外の Include(Everyone など)は付けない

   同じアプリケーションの Overview から **Application Audience (AUD) Tag**(64文字)を控えます。UI の名前が変わっていたら、Worker の Domains & Routes で「Access」を探してください。

6. **Worker に Access の値を入れる**。`cloudflare/peta-download/wrangler.jsonc` の `prod.vars` に入れて、もう一度デプロイします。どちらも秘密の値ではありません。

   ```jsonc
   "vars": { "ACCESS_TEAM_DOMAIN": "https://peta-friends.cloudflareaccess.com", "ACCESS_AUD": "<AUD タグ>" }
   ```

   ```bash
   npm run deploy:prod
   ```

7. **確かめる**。シークレットウィンドウでページを開き、自分のメールアドレスで PIN が届いてページが見えること、許可していないアドレスでは入れないことを確認します。ページに自分の招待コードが出ます。

8. **`peta-api` に招待を必須にする**。`wrangler.jsonc` の prod に `INVITE_REQUIRED: "1"` が入っています。デプロイすると、コードを入れていない Mac は友達・Gift・Market につながらなくなります。**先に7で自分のコードを手に入れておいてください。**(dev は招待なしのままです。Peta Developer は dev につながるので聞かれません。)

   ```bash
   cd cloudflare/peta-api && npx wrangler deploy --env prod
   ```

## 版を出すたびに

```bash
bash scripts/release-mac.sh beta        # 署名・公証済みの .app → 背景つき DMG → DMG も署名・公証・staple
bash scripts/publish-release.sh src-tauri/target/release/distribution/Peta-<版>.dmg prod
```

- `release-mac.sh` は Developer ID の準備が要ります(docs/distribution-howto.md の B2)。DMG の見た目は `scripts/make-dmg.sh` と `assets-src/dmg/`(背景は `source/installer.html?export` を 768×512 と 2倍で書き出したもの)。
- `publish-release.sh` は、本番では署名・公証・staple を確かめてから、DMG の中のアプリから **版・最低 macOS・対応 CPU** を読み、サイズと SHA-256 を計算して表示し、`y` で R2 に DMG → `releases/latest.json` の順に置きます。ページはこの JSON を読むので、手で何かを書き換える必要はありません。
- DMG のファイル名には版を入れます(`Peta-0.1.0.dmg`)。同じ名前は上書きされます。
- いまのビルドは Apple シリコン(arm64)だけです。Intel の Mac の友達がいるなら、ユニバーサルでビルドしてください(`--target universal-apple-darwin`)。ページの「Apple silicon and Intel」は実際の中身から出ます。

## 友達を足す・止める

- **足す**: Access の Policy の Emails にアドレスを足し、Discord の `#ダウンロード` のリンクを案内します。招待コードはその人が最初にページを開いたときに作られます。
- **止める**: Access の Policy から外し(ページに入れなくなる)、次で招待も止めます(その Mac がつながらなくなり、ページにも DMG が出なくなる)。

  ```bash
  bash scripts/beta-invites.sh pause friend@example.com
  bash scripts/beta-invites.sh resume friend@example.com   # 戻す
  bash scripts/beta-invites.sh status friend@example.com   # コード・使っている Mac・落とした版
  bash scripts/beta-invites.sh summary                     # 全体の数だけ
  ```

## 費用

R2(月10GBまで無料、外への転送は無料)、Workers(1日10万リクエストまで無料)、Zero Trust(50人まで無料)の範囲に収まります。かかるのは Apple Developer Program の年会費だけです。

## メモ

- DMG の窓は、Finder の表示設定で「タブバー」「パスバー」を出している Mac ではその分だけ狭く見えます(背景の上のほうと下のほうが少し隠れる)。初期設定の Finder では 768×512 の背景がぴったり収まります。
- ページの文言は英語(Codex の見本のまま)。`cloudflare/peta-download/public/` を直してデプロイします。
- テスト: `cd cloudflare/peta-download && npm test`(Access の署名確認・コード・DMG の配信)、`cd cloudflare/peta-api && npm test`(招待の確認)、`python3 scripts/test-release-mac.py`(署名・公証・DMG の順序。偽のツールだけ)。
