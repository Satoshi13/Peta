# Codex への依頼: 最初のベータ配布の前の総点検

**使い方**: この文書の全文を Codex に渡す(クラウド想定)。**読んで調べるのが中心**。見つけたものは報告にまとめ、§4 の範囲だけ直す。作業は **Step 順**、Step ごとにコミットして、最後にブランチ `codex/ui-fixes-oct07` へ push する。

> 日本語で指示。コード中のコメントは既存に合わせて英語。報告と手順書は日本語。

---

# 0. 背景

Peta(Mac 用のステッカーアプリ)の友達限定ベータを、もうすぐ初めて配る(v0.1.0)。ここ数日で次の機能が一気に入った。配る前に、まとめて点検したい。

- 招待制のダウンロードページ(`cloudflare/peta-download`、Cloudflare Access)と招待コード(`peta-api` の `invites`、アプリの `src-tauri/src/invite.rs`)
- クーポン(`bundle`、`peta-api` の `coupons`、`scripts/coupon.py`、アプリの `src-tauri/src/coupon.rs`)
- オーナーの管理ページ(`cloudflare/peta-admin`: Friends・Coupons・Release・Daily・Reports・News・Shop・Market)
- サーバーが持つクーポン鍵(c1/c2)で署名した設定: `bundle`・`daily_table`・`announcement`・`shop_config`(`crates/core/src/{events,official_keys,signed_config,daily_tables,materials,scraps}.rs`)
- アプリ内アップデート(beta だけ。`tauri-plugin-updater`、`peta-api` の更新の窓口、`scripts/{release-mac.sh,publish-release.sh,updater-key.sh,prune-releases.py}`)
- 署名なし配布(`release-mac.sh --unsigned`)、DMG(`scripts/make-dmg.sh`)
- 1年での記録の自動削除(`peta-api` の `sweepRecords`)

## 先に読む

`README.md`、`docs/decisions.md`、各報告(`docs/admin-page-report.md`・`docs/daily-table-report.md`・`docs/updater-report.md`・`docs/admin-round2-report.md`)、各手順書(`docs/download-page-howto.md`・`docs/coupon-howto.md`・`docs/admin-page-howto.md`・`docs/daily-table-howto.md`・`docs/updater-howto.md`・`docs/distribution-howto.md`・`docs/server-howto.md`・`docs/official-key-howto.md`・`docs/discord-server-plan.md`)、規約とプライバシーポリシーの下書き(`docs/terms-draft.md`・`docs/privacy-policy-draft.md`)。

## この環境の制約

- **Mac ではない**ので、アプリ本体(`src-tauri` の `peta` クレート、Vision を使う `peta-core` の一部)はビルド・テストできない。Worker と JS のテストは動かす。Rust は読んで点検し、直したら「Mac で未テスト」と報告に明記する。
- Cloudflare の認証はない。**デプロイ・D1 の操作・秘密の登録はしない。**
- **オーナーの未コミットの作業**が Mac の手元にある(GitHub にはない)。特に `src/app/js/` と CSS。大きな書き換えはぶつかるので避け、直すのは小さく局所的に。

---

# 1. 依存ライブラリ(Step 1)

- `cloudflare/peta-api`・`peta-download`・`peta-admin` とルートで `npm audit`。`src-tauri` で `cargo audit`(`cargo install cargo-audit` が必要なら入れてよい。`Cargo.lock` を見るだけなのでこの環境でも動く)。
- 指摘ごとに: 影響があるか(本番に入るか、開発用だけか、Peta の使い方で到達するか)、直し方、直したときの危険。
- **直すのは**: Worker の開発用依存と、本番に入る依存の**パッチ・マイナー版の更新で、テストが通るもの**だけ。Tauri・tauri-plugin-*・ed25519 系・hpke など**アプリ本体の依存は上げない**(Mac で確かめられないため)。提案として報告に書く。

# 2. セキュリティの見直し(Step 2)

次を、**コードを読んで**確かめる。問題があれば重さ(高・中・低)と、再現の筋道と、直し方を報告に書く。

1. **管理ページ**: Access の JWT の検証(チーム・AUD・期限・署名鍵の取得)、`OWNER_EMAILS` が空・不正なら全員拒否、すべてのルート(静的ファイルを含む)が認証の後、POST の CSRF 対策(Origin と Content-Type)、`admin_log` に秘密が入らないこと、Cloudflare API トークンの扱い、通報の画像の表示(HTML として解釈されないこと)。
2. **ダウンロードページ**: 同じく Access の検証、R2 の DMG を認証の後だけ渡すこと、招待コードの発行・付け替えの競合、メールのハッシュ化。
3. **peta-api**: 招待の必須化(`INVITE_REQUIRED`)がすべての署名つきルートに効くこと(クーポン・更新・設定の取得を含む)、更新ファイルのトークン(10分・端末と版に結びつく・ハッシュで保存)、クーポンの先着の数え方の競合、名前の総当たりの制限、記録の自動削除が消してはいけないもの(使用中の招待、有効なクーポン)を消さないこと。
4. **クーポン鍵の範囲**: アプリが、クーポン鍵で署名されたものを `bundle`・`daily_table`・`announcement`・`shop_config` だけに限り、それぞれの上限(`grant_cap`、確率表の Matte 20%・特別素材 5%、ショップの値段 50〜200%、お知らせ 140 字・リンクは2択)を**アプリ側で**検査していること。範囲外が丸ごと無視されること。本番ビルドがテスト鍵 c1 を信用しないこと。
5. **アプリ内アップデート**: 更新の公開鍵が空なら beta のビルドが止まること、署名と版番号の検証、取得先の固定(リダイレクト拒否)、未検証のファイルを使わないこと、offline と Developer に updater が入らないこと。
6. **秘密がリポジトリにないこと**: 履歴を含めて、秘密鍵・API トークン・Webhook の URL・パスワードを探す(`git log -p` を対象を絞って。見つけても**値を報告に書かない**。場所とコミットだけ)。
7. **アプリが外に出すもの**: offline ビルドに通信のコードが入らないこと、ログに鍵・メール・本文が出ないこと、`check-binary-paths.py` が見る個人のパス。

# 3. 手順書の整理と配る日の手順(Step 3)

- 手順書どうしの**食い違い**(古い手順、ファイル名、コマンドの引数、順番)を洗い出して直す。
- 新しく **`docs/release-day-runbook.md`** を1本作る。配る日にオーナーと Claude が上から順に実行する、チェックリスト形式の手順。少なくとも次を含める(順番が大事なところは理由も一言):
  1. 前日まで: 更新用の鍵(`updater-key.sh`)と公開鍵が `tauri.beta.conf.json` に入っていること、`tauri.conf.json` の版、ディスクの空き、オーナーの作業がコミット済み。
  2. ビルド: `release-mac.sh beta --unsigned`(Apple の登録をしていない間)。できたもの(DMG・`.app.tar.gz`・`.sig`)の確かめ方。
  3. オーナーの Mac に入れる → 「このまま開く」→ 招待コードを入れる。
  4. **その後で**本番を更新: D1 のマイグレーション(prod は今 0007 まで。0008〜0010)、`peta-admin` と `peta-download` の再デプロイ、R2 の確認、**最後に `peta-api` の再デプロイ**(招待の必須化が有効になるため、3 の後)。
  5. `publish-release.sh <DMG> prod --unsigned --notes "…"`。別のブラウザでダウンロードページから落として開けるかの確認。
  6. 規約・ポリシーの施行日を記入し、公開の場所(リンク)を決める。
  7. 友達のメールの登録(管理ページの Friends)、Discord の文面(`discord-server-plan.md`)。
  8. 配った後に見るもの: 管理ページの Release の台数、Reports、Cloudflare の使用量の通知。
  9. うまくいかないとき: 戻し方(`latest.json` を前に戻す、`peta-api` を前の版に戻す `wrangler rollback`、招待の必須化を一時的に外す方法)。

# 4. 直してよい範囲

- §2 で見つけた問題のうち、**小さく局所的で、Worker か JS ならテストを足して確かめられるもの**。Rust は、明らかな誤りで小さいものだけ(「Mac で未テスト」と書く)。
- 設計を変える・大きく書き換える・依存の大きな更新・データの形式や D1 の既存の表の意味を変えるものは**直さずに報告**する。
- 直したら、関係するテストを足す。

# 5. テスト(各 Step の終わりに、動くものは全部)

```bash
cd cloudflare/peta-api && npm test && npx tsc --noEmit
cd cloudflare/peta-download && npm test && npx tsc --noEmit
cd cloudflare/peta-admin && npm test && npx tsc --noEmit
npm test
```

Rust(Mac が必要): `cargo test --manifest-path src-tauri/Cargo.toml --workspace --features server`、`cargo test --manifest-path src-tauri/Cargo.toml --workspace`、`python3 scripts/test-release-mac.py` は、オーナーの Mac で Claude が回す。報告に「Mac で回すもの」として並べる。

# 6. 報告(`docs/prerelease-audit-report.md`)

- **配る前に必ず直すもの / 配った後でよいもの / 問題なし** の3つに分けた一覧(重さ・場所・理由・直したかどうか)。
- 依存の指摘の表(§1)。
- 直したもののコミットと、足したテスト。
- Mac で確かめてほしいこと(Rust のテスト、実機の確認)。
- `release-day-runbook.md` へのリンク。

最後に `codex/ui-fixes-oct07` へ push し、要点だけ返事する。
