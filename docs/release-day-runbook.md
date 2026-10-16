# 配る日の手順(v0.1.0 友達限定ベータ)

2026-10-16 作成。オーナーと Claude が**上から順に**実行するチェックリストです。各手順の詳しい説明は、リンク先の手順書にあります。点検の結果は [prerelease-audit-report.md](archive/reports/prerelease-audit-report.md)。

- コマンドはリポジトリのルートから。Cloudflare はオーナー自身の `npx wrangler login` で動きます。**秘密の値(鍵・パスワード・トークン)はチャットにもコマンドの引数にも書きません。**
- 本番(prod)の D1 は 2026-10-16 時点で **0007 まで**。今日 0008〜0010 を足します。
- 一番大事な順番: **自分の Mac に新しい版を入れる(3) → その後で本番を更新(4)、`peta-api` は最後**。`peta-api` を出した瞬間に、招待コードのない Mac は友達・Gift・Market・クーポン・更新につながらなくなるからです。

---

## 1. 前日まで

- [ ] **オーナーの作業がすべてコミット・push 済み**で、ビルドするブランチに入っている(`git status` が空)。Mac の手元にしかない変更が残っていないこと。
- [ ] **更新用の鍵**を作ってある(`bash scripts/updater-key.sh /Volumes/Peta-private/updater.key`。初回だけ)。表示された**公開鍵**が `src-tauri/tauri.beta.conf.json` の `plugins.updater.pubkey` に入っている(2026-10-16 時点では**空**。空のままだと beta はビルドが止まる)。`requireSignedVersion: true` はそのまま。→ [updater-howto.md](updater-howto.md)
  - 理由: この公開鍵の入った版を最初に配らないと、後からアプリ内アップデートで届けられない。
- [ ] **版を 0.1.0 にする**: `src-tauri/tauri.conf.json` の `version`(アプリと DMG の名前・更新の版はここから読む)。そろえて `src-tauri/Cargo.toml` と `package.json` の `version` も 0.1.0 に(2026-10-16 時点ではどれも 0.0.1)。
- [ ] **ディスクの空き**が 10GB 以上(ユニバーサル版は2つ分ビルドする。足りなければ `npm run clean:target`)。初回は `rustup target add x86_64-apple-darwin`。
- [ ] **Mac でテストを回す**(Claude が回す): `cargo test --manifest-path src-tauri/Cargo.toml --workspace --features server`、`cargo test --manifest-path src-tauri/Cargo.toml --workspace`、`python3 scripts/test-release-mac.py`、`npm test`、3つの Worker の `npm test && npx tsc --noEmit`。
- [ ] **依存の監査**をもう一度(結果は日々変わる): `cargo audit --file src-tauri/Cargo.lock`、ルートと3つの Worker で `npm audit`。rustls の扱いは点検報告の「依存の指摘」を参照。
- [ ] **規約・ポリシーの公開場所を決める**(6 で施行日を入れる)。アプリの About にリンクを出すなら、URL を `src-tauri/src/about.rs` の `SERVICE_LINKS` に入れて**ビルドの前に**コミットする(入れなければ About には出ない。リンクは Discord とダウンロードページで案内できる)。
- [ ] Cloudflare の秘密がそろっているかだけ確かめる(値は表示されない):

  ```bash
  cd cloudflare/peta-admin && npx wrangler secret list --env prod     # OWNER_EMAILS・CF_API_TOKEN・COUPON_SIGNING_KEY
  cd ../peta-api && npx wrangler secret list --env prod               # REPORT_WEBHOOK(通報を Discord に知らせるなら)
  npx wrangler r2 bucket list                                          # peta-downloads-prod・peta-gifts-prod・peta-reports-prod・peta-market-prod
  ```

  R2 のバケットが1つでも無いと `peta-api` / `peta-admin` の prod デプロイが失敗します(作り方は [server-howto.md](server-howto.md))。どれも r2.dev の公開アクセスは**オフ**のまま。

## 2. ビルド(Apple の登録をしていない間は `--unsigned`)

- [ ] 暗号化ディスクをマウントし、更新用の鍵の**パス**だけを指定する(パスワードは対話で、または安全な手元のセッションで `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。終わったら `unset`)。

  ```bash
  export TAURI_SIGNING_PRIVATE_KEY_PATH=/Volumes/Peta-private/updater.key
  bash scripts/release-mac.sh beta --unsigned
  ```

- [ ] できたもの(`src-tauri/target/release/distribution/`)を確かめる:
  - `Peta-0.1.0.dmg`、`Peta-0.1.0.app.tar.gz`、`Peta-0.1.0.app.tar.gz.sig` の3つが並んでいる(`.sig` が空でない)。
  - `hdiutil verify src-tauri/target/release/distribution/Peta-0.1.0.dmg`
  - DMG を開いて、中の `Peta.app` の版: `/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Volumes/Peta/Peta.app/Contents/Info.plist` が `0.1.0`。
  - 対応 CPU: `lipo -archs /Volumes/Peta/Peta.app/Contents/MacOS/*` に `x86_64 arm64`(見終わったら DMG を取り出す)。
  - ビルドの途中で `check-binary-paths.py` が PASS と出ている(個人のパスが入っていない)。
- [ ] 鍵のディスクを取り出す。

## 3. オーナーの Mac に入れる

- [ ] 古い Peta を終了し、DMG から `Peta.app` を「アプリケーション」へ上書きでドラッグ(データは `~/Library/Application Support/app.peta.desktop/` に残る)。
- [ ] 開く。「開発元を検証できません」が出たら **完了** → システム設定 → プライバシーとセキュリティ → **このまま開く**。(自分でビルドした DMG は検疫の印が付かないので、ここでは聞かれないこともある。友達と同じ経路の確認は 5 で行う。)
- [ ] 招待コードを聞かれたら、ダウンロードページ(`https://peta-download-prod.peta-api.workers.dev`)に自分のメールでログインして、出ているコードを入れる。
  - 本番の `peta-api` がまだ招待の窓口を持たない古い版なら、**ここでは聞かれずに起動する**(正常)。その場合は 4 の最後で聞かれる。
- [ ] ステッカー・友達・Scraps が前と同じに見えること。

## 4. 本番を更新する(この順番で)

> 公式パックをアプリの更新なしで出すときは、先に公式の鍵 k2 を入れた版を配ること。手順と順番は [official-packs-howto.md](official-packs-howto.md)。

- [ ] **D1 の控え**を取る(リポジトリの外へ。中身はメールのハッシュ等の個人データなので扱いに注意):

  ```bash
  cd cloudflare/peta-api
  npx wrangler d1 migrations list peta-prod --env prod --remote          # 未適用が 0008・0009・0010 の3つだけであること
  npx wrangler d1 time-travel info peta-prod --env prod                  # 表示された bookmark をメモ(戻すときに使う)
  npx wrangler d1 export peta-prod --env prod --remote --output ~/peta-prod-before-0.1.0.sql
  ```

- [ ] **マイグレーション**(0008 毎日の素材表・0009 更新トークン・0010 署名つき設定。どれも表を足すだけ):

  ```bash
  npx wrangler d1 migrations apply peta-prod --env prod --remote
  npx wrangler d1 migrations list peta-prod --env prod --remote          # No migrations to apply
  ```

  理由: 新しい `peta-admin` と `peta-api` はこれらの表を読むので、デプロイより先。

- [ ] **`peta-admin` を再デプロイ**して、管理ページに入れる・タブが全部出る・Friends の一覧が読めることを確かめる。

  ```bash
  cd ../peta-admin && npm ci && npm test && npm run deploy:prod
  ```

- [ ] **`peta-download` を再デプロイ**して、ページ・招待コードが出ることを確かめる(まだ新しい版は出ない)。

  ```bash
  cd ../peta-download && npm ci && npm test && npm run deploy:prod
  ```

- [ ] **R2 の確認**: `npx wrangler r2 object get peta-downloads-prod/releases/latest.json --remote --file ~/latest-before-0.1.0.json`(前の版があれば控える。初回は「無い」と出て正常)。ダッシュボードで `peta-downloads-prod` の公開アクセスがオフのまま。
- [ ] **最後に `peta-api` を再デプロイ**(prod の `INVITE_REQUIRED: "1"` がここで効く):

  ```bash
  cd ../peta-api && npm ci && npm test && npx wrangler deploy --env prod
  npx wrangler deployments list --env prod      # 新しい版 ID と、1つ前の版 ID をメモ(9 で使う)
  ```

  理由: 3 で自分の Mac に招待コードの入る版を入れた後でないと、自分も締め出される。

- [ ] 自分の Mac の Peta を**終了して開き直す**。招待コードを聞かれたら入れる(3 で入れていれば聞かれない)。Today の帯・Market・友達・Gift が動くこと。Settings → About Peta → **Check for updates** が「新しい版はない」になること。

## 5. 公開する

- [ ] DMG と更新ファイルを置く(DMG → 更新 tar.gz → 署名 → `latest.json` の順に書かれる。`latest.json` が最後なので、途中で止まってもページは前のまま):

  ```bash
  bash scripts/publish-release.sh src-tauri/target/release/distribution/Peta-0.1.0.dmg prod --unsigned --notes "First friends beta."
  ```

  表示された内容(版 0.1.0・`"notarized": false`・`update` に署名)を見て `y`。
- [ ] **別のブラウザ**(普段使っていない方。シークレットウィンドウでもよい)でダウンロードページに自分のメールでログイン → 「Download for Mac」→ 落とした DMG を開いて **このまま開く** まで進めるか確かめる。可能ならもう1台の Mac(Intel があれば Intel)でも。
- [ ] 管理ページの **Release** に v0.1.0 と、今のダウンロード1件が出ること。

## 6. 規約とプライバシーポリシー

- [ ] `docs/terms-draft.md` と `docs/privacy-policy-draft.md` の「案」を確定し、**施行日に今日の日付**を入れる(Claude が記入)。
- [ ] 1 で決めた場所に公開し、リンクを Discord の `#ようこそ` とダウンロードページの案内に載せる。

## 7. 友達を招く

- [ ] 管理ページの **Friends** で友達のメールを登録(1行1件、200件まで。Zero Trust の無料枠は50人)。**Copy invitation** の文を DM で送る。
- [ ] Discord の文面は [discord-server-plan.md](discord-server-plan.md) の §5(`#ようこそ`・`#ダウンロード`・`#はじめかた`)。`【】` を埋めて貼る。`#お知らせ` に §5.2 のひな形で v0.1.0 の公開を書く。
- [ ] 最初の1人で、招待 → ダウンロード → このまま開く → 招待コード → 友達になる、まで一緒に確かめてから、残りの人を招く。

## 8. 配った後に見るもの

- [ ] 管理ページの **Release**: 版ごとの人数(ダウンロード)と、アプリ内更新の台数。**Friends**: 招待が「in use」になったか。
- [ ] **Reports**: 赤い数字(未対応の通報)。Discord の `#通報通知` にも届く。
- [ ] Cloudflare のダッシュボード: Workers & Pages の要求数(無料枠は1日10万)、D1 と R2 の使用量(R2 は月10GBまで無料。`publish-release.sh` は古い版を3つまで残す)、Zero Trust の人数(50人まで)。Notifications で使用量の通知を設定しておく。
- [ ] Discord の `#ヘルプ`・`#バグ報告`。

## 9. うまくいかないとき

| 困りごと | 戻し方 |
|---|---|
| 新しい DMG に問題がある | 控えた `latest.json` を戻す: `npx wrangler r2 object put peta-downloads-prod/releases/latest.json --file ~/latest-before-0.1.0.json --content-type application/json --remote`(`cloudflare/peta-download` で)。初回で控えが無いなら `npx wrangler r2 object delete peta-downloads-prod/releases/latest.json --remote`(ページは「まだ版が無い」表示、アプリ内更新も止まる)。 |
| アプリ内更新だけ止めたい | `latest.json` を取ってきて `update` の項目を消し、同じ `object put` で戻す([updater-howto.md](updater-howto.md))。 |
| `peta-api` の新しい版がおかしい | `cd cloudflare/peta-api && npx wrangler deployments list --env prod` で1つ前の版 ID を見て `npx wrangler rollback <版ID> --env prod -m "reason"`。D1 の表は足しただけなので古い版でもそのまま動く(古い版には `/v1/config` や更新の窓口が無く、アプリは固定の素材表・更新なしになる)。 |
| `peta-admin` / `peta-download` がおかしい | 同じく各ディレクトリで `npx wrangler deployments list --env prod` → `npx wrangler rollback <版ID> --env prod`。 |
| 招待の必須化を一時的に外したい(友達が入れない等) | `cd cloudflare/peta-api && npx wrangler deploy --env prod --var INVITE_REQUIRED:0`。アプリはコードを聞かなくなる。**次にふつうに `npx wrangler deploy --env prod` すると `"1"` に戻る**ので、直ったらそれで戻す。 |
| 1人の友達だけ止めたい | 管理ページの Friends → **Pause invite**(戻すときは Resume)。 |
| クーポン・お知らせ・ショップ設定を止めたい | 管理ページの各タブの **Stop**(クーポンは **Stop all** も)。 |
| D1 を戻したい(最後の手段) | 4 でメモした bookmark で `npx wrangler d1 time-travel restore peta-prod --bookmark <bookmark> --env prod`。その後に入った記録(招待の結び付け・ダウンロード・通報など)も消えるので、オーナーが判断する。 |

戻したら、何が起きて何をしたかを `docs/` に短く残す。
