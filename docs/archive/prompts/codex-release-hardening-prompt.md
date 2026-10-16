# Codex への依頼: 公開前の修正と友達限定ベータのビルド

**使い方**: この文書の全文を Codex に渡す。**実装の指示**(Rust・TypeScript・JS/CSS・シェル)。作業は **Step 順**。各 Step の終わりに `CARGO_INCREMENTAL=0 cargo test --manifest-path src-tauri/Cargo.toml --workspace`(既定と `--features developer`)、`npm test`、`cloudflare/peta-api/` の `npm test` と `npm run check` を通し、**Step ごとにコミット**する。

> 日本語で指示。コード中のコメントと UI の文言は、既存に合わせて**英語**。説明文書は日本語。

**読む順**: [`docs/release-readiness-plan.md`](../../release-readiness-plan.md)(対応計画。本書の C1〜C10 はその §2)→ [`docs/archive/reports/release-readiness-audit-2026-10-13.md`](../reports/release-readiness-audit-2026-10-13.md)(根拠)→ [`docs/server-plan.md`](../../server-plan.md)・[`docs/server-howto.md`](../../server-howto.md)・[`docs/archive/reports/server-s3-report.md`](../reports/server-s3-report.md)(サーバーの今)→ [`docs/distribution-howto.md`](../../distribution-howto.md)。食い違ったら**本書と現行コード**を優先し、報告に書く。

**前提**: S1〜S3(審判役・友達と受信箱・友達の Market)は実装済みで dev にデプロイ済み。どれも開発者版(`developer` feature)だけで有効。本番(prod)は未デプロイ。オーナーは **App Store には出さない**(Developer ID で署名・公証した .app を直接配る)。

---

# 0. 範囲

## やること

1. **C1〜C10**(公開前の修正)。
2. **B1 友達限定ベータのビルド**: 通常版の設定(bundle ID・データフォルダ)のまま `server` を有効にし、**本番の API** につなぐビルドを1つのコマンドで作れるようにする。
3. **B2 署名と公証のスクリプト**: Developer ID の証明書と公証の資格情報があれば、1つのコマンドで署名・公証・確認まで進む。
4. **B3 利用規約の下書き**(日本語と英語)と、プライバシーポリシー下書きの空欄の整理。
5. **B4 Gift の宛先を選択式にする**(Studio の UI)。
6. 報告 `docs/archive/reports/release-hardening-report.md` と関連文書の更新。

## やらないこと(オーナーが行う、またはオーナーが決める)

- **本番(`--env prod`)の R2 作成・migration・deploy・secret の設定**。prod の照会もしない。
- Apple Developer の登録、証明書の作成、公証の資格情報の登録、実際の公証の実行(スクリプトを用意するだけ)。
- 公式イベント用の**本物の秘密鍵を作ること**(手順を書くだけ。鍵はオーナーの手元だけ)。
- 独自ドメインの取得と Worker へのルート。
- 自動更新(Tauri Updater)。配信先と更新用の鍵の扱いをオーナーが決めてから別の依頼にする。
- 法的な判断(下書きは「専門家と確認する下書き」と冒頭に書く)。
- 既存の署名形式(Creation / Transfer / Gift v3 / PETAPACK v1・v2 / PETAEVNT / 友達コード)の変更。

---

# 1. 共通ルール

- 作業前に上の文書と、`src-tauri/crates/core/src/{official_keys.rs,events.rs,sign.rs,identity.rs,db.rs,gift.rs,creator_pack.rs,library.rs}`、`src-tauri/src/{referee.rs,inbox.rs,friend_market.rs,lib.rs,store.rs}`、`src-tauri/{Cargo.toml,tauri.conf.json,tauri.developer.conf.json}`、`cloudflare/peta-api/{src/index.ts,src/inbox.ts,src/market.ts,wrangler.jsonc}`、`package.json`、`src/app.html`、`src/app/js/{bridge.js,settings.js,friends.js,studio.js}` を読む。
- アプリのスキーマ変更が要るなら **V18 だけ**(V1〜V17 は変えない)。Worker は **`0004_*.sql` だけ**(0001〜0003 は変えない)。
- **暗号は自作しない**。既存の crate(`chacha20poly1305`・`argon2`・`hpke`・`ed25519-dalek`)を使う。新しい crate を足すなら版と理由を報告に書く。
- **秘密をリポジトリに書かない**(秘密鍵・パスフレーズ・API トークン・Webhook URL・Apple の資格情報)。スクリプトは環境変数かキーチェーンのプロファイル名で受け取る。
- 作業ツリーにオーナーの未コミット変更がある(`src/app/js/market.js` の Tools の数行、`src/app/css/linktag.css`、`src/app/js/assets.js` など)。**自分の変更だけをコミット**する。`git add .`・`reset --hard`・`clean` は使わない。
- 変更したルールは `README.md` と `docs/decisions.md`(作業日)に追記。実機確認が要る項目は `docs/port-spec/macos-checklist.md` に追記。

---

# 2. Step 1: C1 仮の公式鍵(core)

`official_keys.rs` の `k1` は RFC 8032 のテスト1の公開鍵で、秘密鍵も RFC に載っている。**リリース版(`developer` でない core)では k1 を信用しない**。

- 鍵の**番号(配列の位置)は変えない**: コード(`PETA1-…`)は鍵の位置を1バイトで持つ(`events.rs` の `as_code` / `from_code_with`)。`KEYS` を「ID と、信用するなら公開鍵」の形にし、k1 は `cfg!(any(test, feature = "developer"))` のときだけ公開鍵を持つ。リリース版では k1 の位置は残したまま「この鍵は信用しない」で断る。
- 断るときの文言: `This Peta code was made for testing and can't be used here.`(ファイルのイベントとコードの両方)。
- 本物の鍵を足す手順を `docs/server-howto.md` か新しい `docs/official-key-howto.md` に書く: オフラインの Mac で生成、秘密鍵はパスワード付きでオーナーの手元だけ、公開鍵だけを `k2` として配列の**末尾**に足す、古い鍵を外さない。生成に使う既存のコマンド(Developer メニューや CLI にあるなら)を調べて書く。なければ小さな CLI のサブコマンドを足してよい(秘密鍵はファイルにだけ書き、標準出力に出さない)。
- テスト: リリース相当(feature なし)で k1 のファイル・コードが断られ、developer では今までどおり通る。位置のずれがないこと。

# 3. Step 2: C2 表示名の初期値と C3 個人情報の例示(core・文書)

- `db.rs` の表示名の初期値(`std::env::var("USER")` / `USERNAME` を使っている所、約325行)をやめる。名前が未設定なら空とし、表示は中立な初期値(`Someone` など、既存の UI に合わせる)。
- 名前が外へ出る所(友達コード `inbox.rs` の `me`、Gift `gift.rs`、作者パック `creator_pack.rs`、Market のカードは名前なし)で、**名前が未設定なら先に名前を決めてもらう**(既存の Settings の名前欄へ案内するシート。送る・作る操作は止める)。既存の利用者で、すでに OS のユーザー名が保存されている場合は、そのまま残す(勝手に変えない)が、Settings で変えられることを確認する。
- C3: ソース・テスト・文書から、オーナーのユーザー名とローカルの絶対パス(`/Users/<名前>/…`)の例示を消す。`grep -rn` で探し、テストの名前は `Maker` / `Nao` などの架空の名前に、パスは `~/…` か `<repo>/…` に置き換える。**意味が変わる置き換えはしない**。Git の履歴は書き換えない(報告に「履歴には残る」と書く)。

# 4. Step 3: C5 鍵の復元の途中失敗(core)

`identity.rs` の `restore` は `device.key` と `box.key` を1つずつ置き換えるので、2つ目で失敗すると新旧の鍵が混ざる。

- 両方を一時ファイルに書いて fsync → **「復元中」の記録(どちらの鍵を何に置き換えるか)を先に残す** → 順に rename → 記録を消す。起動時(`Library::open` か鍵を読む前)に記録が残っていれば、**新しい鍵で最後までやり直す**(一時ファイルがそろっていれば)か、そろっていなければ元に戻す。
- 故障を入れたテスト: 1つ目の rename の後で失敗 → 次の起動で2つとも新しい鍵になる。一時ファイルが壊れている → 2つとも元の鍵のまま。
- 既存の `.petakey` の形式は変えない。

# 5. Step 4: C4 ビルドに残るパス

- リリースビルド(通常版・ベータ版)で `--remap-path-prefix` を使い、`$HOME` とリポジトリの絶対パスを置き換える(`RUSTFLAGS` を `package.json` のスクリプトで付けるか、`src-tauri/.cargo/config.toml` に**相対パスで書けないものは書かない**。ユーザーごとのパスをリポジトリに書かない)。
- `scripts/check-binary-paths.sh`(または `.py`)を足す: できた .app の実行ファイルに `strings` をかけ、`/Users/` を含む文字列が残っていれば一覧を出して失敗する。依存ライブラリのパスで消せないものがあれば、報告に種類と件数を書く。
- `docs/distribution-howto.md` に、ビルド → この確認 → 署名、の順を書く。

# 6. Step 5: C6 CSP

`tauri.conf.json` の `"csp": null` をやめる。

- 方針: スクリプトは自分のファイルだけ(`'self'`)、画像は `'self' data: blob:` と Tauri のアセット用スキーム、接続先は Tauri の IPC と(必要なら)API の住所だけ。インラインのスクリプトがあれば外へ出す。`style-src` は既存のインラインの style 属性が多いので `'unsafe-inline'` を許してよい(理由を報告に書く)。
- 開発者版の設定(`tauri.developer.conf.json`)も同じ方針で。
- **全画面を実機の WebView で開いて、コンソールに CSP の違反が出ないこと**を確かめる手順をチェックリストに書く(Codex の環境で確かめられた範囲は報告に書く)。`src/app.html`・`src/index.html`・`src/arrival.html` のすべて。

# 7. Step 6: C7 通報 API と C10 通報の自動削除(Worker)

`cloudflare/peta-api/src/inbox.ts` の `report` は、認証・形式・大きさだけを確かめている。

- C7(`0004_reports.sql` と `inbox.ts`):
  - 通報した人が、申告した送り手(`senderHash`)を**自分の受信箱の許可リストか拒否リストに入れている**ことを確かめる(友達だった、またはブロックした相手だけを通報できる)。Market の出品(`kind: "listing"`)は、その出品の封筒を通報した人が持っている(または持っていた)ことを確かめる(封筒を消した後でも通報できるよう、必要なら封筒の削除を「論理削除」にするか、通報の時点の判定でよい範囲を報告に書く)。
  - 同じ通報の重複を防ぐ: 通報した人・送り手・中身の SHA-256 が同じなら新しく保存せず、既存の ID を返す。
  - 通報専用の上限: 通報した人ごとに24時間で 5 件(`vars` の `REPORTS_PER_DAY`)、未対応の通報の総数の上限(`REPORTS_PENDING`、既定 500)を超えたら `429`。
  - Gift の署名をサーバーで確かめるのは任意(Gift v3 の形式を TypeScript で読むのが大きい場合は見送り、理由を報告に書く)。
- C10:
  - `reports` に `resolved_at` を足す。運営が対応を終えたら記録する方法(`wrangler d1 execute` の SQL)を `server-howto.md` に書く。
  - Cron Trigger(1日1回)で、`resolved_at` から30日たった通報の R2 の中身と D1 の行を消す。`wrangler.jsonc` の dev・prod 両方に `triggers.crons` を書く(**prod へのデプロイはしない**)。未対応の通報は消さない。
  - テスト: 30日前の対応済みだけが消え、未対応と29日目は残る。
- dev へのデプロイ(`npx wrangler@4.149.0 deploy --env dev`、`0004` の dev 適用)はしてよい。

# 8. Step 7: C8 ライセンスと脆弱性の確認

- Rust の依存のライセンス一覧を作るスクリプト(`scripts/third-party-licenses.*`)。`cargo metadata` と、手元にすでにある crate のソース(`~/.cargo/registry/src/…`)のライセンスファイルから、名前・版・ライセンス・本文をまとめる。**新しいツールのダウンロードは不要な形を優先**する(`cargo about` を使うならその旨を報告に書き、オーナーの許可が要ることを書く)。
- フロントエンドの同梱物(フォントの OFL など、すでに NOTICE があるもの)と合わせ、アプリに同梱する `THIRD_PARTY_NOTICES`(テキスト)を生成して bundle の resources に入れ、Settings の About から開けるようにする。
- `docs/distribution-howto.md` に「配る前に `cargo audit` と `npm audit` を回す」手順を書く(ツールが無ければ導入はオーナーの判断)。

# 9. Step 8: C9 新しい Mac へ移る書き出し(core・アプリ・UI)

今の `.petakey` は鍵だけ。データフォルダ全体(DB・assets・鍵)を1つの暗号化ファイルにまとめる「Move to a new Mac」を足す。`.petakey` はそのまま残す。

- 書き出し: SQLite は `VACUUM INTO`(またはバックアップ API)で一貫した写しを作り、assets と2つの鍵と一緒に、パスフレーズ(12文字以上・2回入力、`.petakey` と同じ Argon2id)から作った鍵で**分割して暗号化**する(`chacha20poly1305` の STREAM、または一定の大きさごとの AEAD に通し番号と終わりの印を付ける)。大きいライブラリでもメモリに全部載せない。拡張子は `.petamove`(既存の拡張子と重ならない名前で)。
- 読み込み: **空のライブラリ(新しく入れた直後)にだけ**入れられる。ファイル全体の検証が済んでから、一時フォルダに展開 → まとめて置き換え → 再起動。途中の失敗では何も変えない。
- 書き出しの後、元の Mac で「この Mac ではもう使わないでください」(同じ鍵の2台同時利用は未対応)を案内する。
- サーバーには何も送らない(同期ではない)。
- テスト: 往復で DB の行・assets・鍵が一致、パスフレーズ違い・壊れた途中・切れた末尾の拒否、空でないライブラリへの読み込みの拒否、途中の失敗で元のまま。

# 10. Step 9: B1 友達限定ベータのビルド

- **接続先**(`src-tauri/src/referee.rs` の `API_URL`): 開発者版は今のまま dev(`https://peta-api-dev.peta-api.workers.dev`、`PETA_API_URL` で上書き可)。開発者版でない `server` ビルドは**本番**の定数(当面 `https://peta-api-prod.peta-api.workers.dev`。独自ドメインに移すときはこの1か所を変える)。上書きはできない。
- `package.json` に `build:beta`(通常版の設定 `tauri.conf.json` のまま `--features server`)を足す。bundle ID とデータフォルダは通常版と同じ(`app.peta.desktop`)。
- 既定の `npm run build` は**今までどおり通信なし**(`server` なし)。`cargo tree` で確認して報告に書く。
- ベータ版で、友達・受信箱・Market・審判役の UI が出ること、友達がいなければ通信しないこと、本番が未デプロイのときは「Peta could not check this…」などの既存の文言で止まり、何も壊れないことをテストかチェックリストで確かめる。
- `docs/server-plan.md` の作業表に「ベータ版のビルド」を書き、本番の準備(オーナー)が済むまで配らないことを明記する。

# 11. Step 10: B2 署名と公証のスクリプト

- `scripts/release-mac.sh`(名前は任意): 引数か環境変数で、`APPLE_SIGNING_IDENTITY`(`Developer ID Application: …`)、公証の資格情報のキーチェーンのプロファイル名(`xcrun notarytool store-credentials` で作ったもの)を受け取る。
  1. `npm run build:beta`(または指定のビルド)
  2. Step 4 のパスの確認
  3. Tauri の署名設定(`bundle.macOS.signingIdentity` を環境変数で渡す)か `codesign --deep --options runtime --timestamp` で署名(entitlements が要れば `src-tauri/` に置く。private API の扱いを確認)
  4. `ditto` で zip → `xcrun notarytool submit --wait` → `xcrun stapler staple`
  5. `codesign --verify --deep --strict` と `spctl -a -vv` を実行し、結果を出す
- 資格情報がなければ、何をすればよいかを表示して止まる(勝手に Apple に接続しない)。
- `docs/distribution-howto.md` に、オーナーが一度だけやること(Developer Program の登録、証明書、`notarytool store-credentials`)と、毎回のコマンドを書く。**個人登録だと証明書に法的氏名が入る**ことも書く。

# 12. Step 11: B3 利用規約の下書きとプライバシーポリシーの空欄

- `docs/terms-draft.md`(日本語と英語): 冒頭に「法的な判断はオーナーが専門家と行う下書き」。内容: サービスの内容(無料、Scraps は換金できず円で買えない)、アカウントと鍵(鍵をなくすと復旧できない)、ユーザーが作った画像の権利(作った人のもの、Peta は運ぶだけ、他人の権利を侵さない)、禁止事項、通報と削除・運営の拒否、友達の Market(版は唯一、引いた結果は取り消せない、取り分)、サービスの変更・終了、免責、準拠法と管轄(空欄)、連絡先(空欄)。
- `docs/privacy-policy-draft.md` の空欄(運営者・連絡先・施行日)を `【オーナーが記入】` の印でそろえ、残りの空欄の一覧を冒頭に置く。
- アプリの Settings の About から、規約とポリシーの URL を開ける場所だけ作る(URL は定数1か所、未設定なら表示しない)。

# 13. Step 12: B4 Gift の宛先を選択式にする(UI)

**いまの問題**(オーナーの指摘、2026-10-14): Studio の Gift の2つ目の画面「Dress the gift」の `To (required)` は、封筒に書く**名前の文字**(`g.to`、`gift_dress.to_name`)を打つ欄で、宛先の指定ではない。ここで名前を打たないと先へ進めない。友達を選ぶ欄は3つ目の「Ready to seal」で `Send` を `To a friend` にしたときだけ出て(`Friends.picker`)、選ぶと `g.to` が友達の名前で上書きされる。名前で相手を指定しているように見えて、実際は何も指定していない。友達の一覧は `S.inbox.enabled`(server ビルド)のときだけ。

**直し方**(`src/app/js/studio.js` の `giftDress` と `giftSeal`。触るのは Gift の画面だけ):

- 2つ目の画面の宛先を**選択式**にする。見出しは `To (required)` のまま、中身を次の選択肢にする。
  - 承認済みの友達(`Friends.groups().friends`、既存の `fr-pill` の見た目)を並べ、1人を選ぶ。選ぶと `g.dest = "friend"`、`g.friend = 公開鍵`、`g.to = 友達の名前`(封筒の名前も自動で入る)。
  - 最後に `Someone else — save a file` を置く。これを選んだときだけ、封筒に書く名前の欄(既存の `field`、14文字)を出す。`g.dest = "file"`。
  - 友達がまだいないときは `No friends yet. Add one in Settings → Friends.`(Settings の Friends を開くリンク)と、`Someone else — save a file` だけを出す。
  - 友達の機能が入っていないビルド(`S.inbox.enabled` が false)では、選択肢を出さずに今までどおり名前の欄だけを出し、見出しを `Name on the envelope` にする(宛先ではなく表書きだと分かるように)。
- 3つ目の画面は**確認と封だけ**にする。`Send` の切り替え(`Save a file` / `To a friend`)と `Friends.picker` をなくし、要約に `For <名前> · to their Peta` / `For <名前> · saved as a file` を出す。ボタンは今までどおり `Seal and send` / `Seal and save…`。
- 次へ進める条件: 友達を選んだ、または `Someone else` で名前を書いた。文言は `Choose who it is for to continue.`。
- 保存済みの途中の状態(`stSave` の `ST.gift`)との互換: 前の版で `dest` と `friend` が無い・名前だけある状態は `Someone else` として開く。選んでいた友達が Remove / Block されていたら選択を外し、選び直してもらう。
- C2 との関係: 自分の表示名が未設定のまま友達に送ろうとしたら、Step 2 で作る「名前を決めてもらう」案内を先に出す(封の前)。
- 既存の送る処理(`gift_send_friend`、ファイルの保存、取り消しの補償)は変えない。
- JS のテスト(`tests/` に既存の Studio のテストがあればそこへ、なければ新しく): 友達を選ぶと宛先と名前が入る、`Someone else` でだけ名前の欄が出る、友達なしの表示、server なしのビルドの表示、3つ目に切り替えがない、古い保存状態の読み込み、外された友達の選択が消える。

# 14. Step 13: ドキュメント

- 報告 `docs/archive/reports/release-hardening-report.md`: Step ごとのコミット、選んだ crate と版、本書と違う判断とその理由、守れないこと、**オーナーの作業**(本物の公式鍵の生成、Apple Developer と公証の準備、本番の準備、独自ドメイン、法律の確認、Updater を入れるかの判断)、実機で確かめる項目。
- `docs/release-readiness-plan.md` の C1〜C10 に、終わったものを印つきで更新。
- `README.md`、`docs/decisions.md`、`docs/server-howto.md`、`docs/distribution-howto.md`、`docs/port-spec/macos-checklist.md`。

---

# 15. 受け入れ条件

- [ ] すべてのテスト(Rust 既定と developer、JS、Worker と `npm run check`)が通る。既定の `npm run build` に HTTP の依存が入っていない(`cargo tree`)。
- [ ] リリース相当の core で、k1 で署名した公式ファイル・コードが断られ、鍵の位置は変わっていない。developer では今までどおり。
- [ ] OS のユーザー名が、名前を選ぶ前に友達コード・Gift・パックへ出ない。ソース・テスト・文書にユーザー名とローカルの絶対パスの例示がない。
- [ ] 鍵の復元を途中で止めても、次の起動で鍵が混ざらない。
- [ ] リリースビルドの実行ファイルに `/Users/` が残らない(残るものは報告に種類と件数)。
- [ ] CSP が有効で、自動テストと確認できた画面で違反が出ない。
- [ ] 通報は、許可・拒否リストにない相手について断られ、重複は1件になり、上限を超えると `429`。対応済みから30日の通報だけが Cron で消える(dev で確認)。
- [ ] ライセンス一覧が生成され、アプリから開ける。
- [ ] `.petamove` の往復でデータフォルダが一致し、壊れたファイル・違うパスフレーズ・空でないライブラリを断る。
- [ ] `npm run build:beta` が本番の API につなぐ通常版を作る。開発者版は dev のまま。
- [ ] 署名と公証のスクリプトが、資格情報がないときに止まって手順を表示する。
- [ ] 利用規約とプライバシーポリシーの下書きがあり、空欄の一覧がある。
- [ ] Gift の宛先が2つ目の画面で選択式になっている(友達を選ぶ / `Someone else — save a file`)。3つ目の画面に送り先の切り替えがない。友達の機能がないビルドでは `Name on the envelope` の欄だけ。
- [ ] 報告と関連文書が更新されている。**prod には何も操作していない**。

**実機でしか確認できないこと**(オーナーがやる): 署名・公証した .app を別の Mac で開く(Gatekeeper)、CSP の全画面確認、`.petamove` で実際に新しい Mac へ移る、Gift の宛先の選択(友達あり・なし・ベータ版と通常版)、ベータ版と本番サーバーでの友達・Gift・Market の往復(本番の準備の後)。
