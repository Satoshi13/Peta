# Codex への依頼: サーバー S2(友達・Gift の受信箱・鍵の書き出しと復元・通報)

**使い方**: この文書の全文を Codex に渡す。**実装の指示**(Rust・TypeScript・JS/CSS)。作業は **Step 順**。各 Step の終わりに `cargo test --manifest-path src-tauri/Cargo.toml --workspace`(既定と `--features developer`)、`npm test`、`npm test` in `cloudflare/peta-api/` を通し、**Step ごとにコミット**する(Worker・core・アプリ・UI は別コミット)。

> 日本語で指示。コード中のコメントと UI の文言は、既存に合わせて**英語**。説明文書は日本語。

**読む順**: [`docs/server-plan.md`](../../server-plan.md)(全体と段階2)→ [`docs/gift-inbox-plan.md`](../../gift-inbox-plan.md)(友達と許可・API・送受信・通報・公開前チェックリスト。**古い前提(Gift v2・DB V9・コピーの Gift)は server-plan と本書が優先**)→ [`docs/archive/reports/server-s1-report.md`](../reports/server-s1-report.md) と [`docs/server-howto.md`](../../server-howto.md)(S1 で作ったもの)→ `docs/decisions.md`(サーバー・唯一性・Gift v3・Scraps の行)。食い違ったら**本書と現行コード**を優先し、報告に書く。

---

# 0. 範囲

## やること

1. **鍵と暗号**(core): 暗号用の鍵(X25519)、友達コード、封をする暗号、鍵の書き出しと復元。
2. **Worker**: 受信箱・友達リクエスト・許可リスト・メッセージ(R2)・通報・退会、回数制限。開発用へデプロイ。
3. **アプリの DB V16** と友達の状態のルール(core)。
4. **アプリの通信**(`server` feature): 受信箱の登録、友達の申請・承認・辞退・ブロック、Gift の送受信、確認の間隔、通報、退会。
5. **UI**: Settings の Friends と鍵のバックアップ、Studio の Gift の宛先、Gifts のページのリクエストと届いた Gift、バッジ、通報。
6. **友達リンク**: `peta://friend/…`(開発者版は `peta-developer://friend/…`)を開くと、友達の追加ダイアログが出る。
7. **パックの売れ行きに「誰が引いたか」**: 作った人にだけ、引いた人の鍵を返し、友達の名前で出す。
8. ドキュメント: 運用手順の追記、プライバシーポリシーの下書き、報告 `docs/archive/reports/server-s2-report.md`。

## やらないこと

- **QR コード**(今回は友達コードのコピー&ペーストとリンクだけ)。
- 友達の Market(段階3)、Scraps のサーバー管理、プッシュ通知、複数端末の同時利用、ステッカー帳の同期。
- **本番(`--env prod`)へのマイグレーション・デプロイ**(オーナーが行う)。配布版で `server` を有効にすること(公開前チェックリストの後)。
- Web ページ経由の https の友達リンク(独自ドメインができてから)。

---

# 1. 共通ルール

- 作業前に上の「読む順」の文書と、`src-tauri/crates/core/src/{device_key.rs,sign.rs,friends.rs,gift.rs,ownership.rs,server.rs,db.rs}`、`src-tauri/src/{gifts.rs,referee.rs,referee_access.rs,lib.rs,store.rs,packs.rs}`、`cloudflare/peta-api/{src/index.ts,src/proofs.ts,migrations/0001_ledger.sql,wrangler.jsonc}`、`src/app/js/{library-pages.js,studio.js,settings.js,packs.js,shell.js,bridge.js,boot.js}` を読む。
- **アプリのスキーマ変更は V16 だけ**(V1〜V15 の SQL は変えない。V15 → V16 のマイグレーションテスト)。Worker は `migrations/0002_*.sql`(0001 は変えない)。
- **暗号は自作しない**。監査実績のある crate だけを使う(例: HPKE は `hpke`、鍵の書き出しは `argon2` + `chacha20poly1305`、X25519 は `x25519-dalek`)。選んだ crate と版を報告に書く。
- **サーバーは中身を読めない**: Gift もリクエストも、端末で受信者の暗号鍵に封をしてから送る。Worker・ログに内容・鍵・IP を出さない。
- 既存の Gift の決まりは変えない: Gift v3 の譲渡(release/claim)、署名、`gift_already_received`、8MB 上限、PNG の検証、元の写真は入れない。**受信箱は運び方が1つ増えるだけ**で、受け取りは今のファイルの受け取りと同じ検証と審判役の claim を通る。ファイルでの Gift はそのまま残す。
- 通信はすべて `server` feature の中(配布版にはコードも依存も入れない。S1 と同じ)。**友達が1人もいなければ、一切通信しない**(受信箱の登録も、最初の友達の追加まで待つ)。
- S1 の署名つきリクエスト(`X-Peta-Key` など、データを変えるリクエストだけ nonce を記録)をそのまま使う。
- 変更したルールは `README.md` と `docs/decisions.md`(作業日)に追記。実機確認が要る項目は `docs/port-spec/macos-checklist.md` に追記。

---

# 2. Step 1: 鍵と暗号(core)

- **暗号用の鍵**: X25519 を新しく作り、署名鍵(`device_key`)と同じ場所に 0600 で保存。読み書きは1つのモジュールに閉じる。**署名鍵が暗号公開鍵に署名して結びつける**。
- **友達コード**: `PETAF1-` + Crockford Base32(4文字ごとにハイフン)。中身は `版 · 署名公開鍵 · 暗号公開鍵 · 結びつけの署名 · 表示名(24バイトまで)`。読み取りは空白・大文字小文字・`I/L/O` の取り違え・ハイフンの有無を許して正規化し、署名を検証する。**貼り付けの欄にはリンク(§7)を貼っても読めるようにする**。
- **封**: HPKE(RFC 9180、Base モード、DHKEM(X25519, HKDF-SHA256)、HKDF-SHA256、ChaCha20-Poly1305)。`info` に用途(`peta.gift.v1` / `peta.request.v1`)を入れて取り違えを防ぐ。
- **鍵の書き出し**: 署名鍵と暗号鍵を、パスフレーズ(12文字以上)から Argon2id で作った鍵で ChaCha20-Poly1305 に封をした1ファイル(`.petakey`)。**復元**は引っ越し用: 今の鍵を置き換える前に確認を出し、置き換えたら受信箱を作り直さずに続けられる(同じ鍵なので同じ受信箱)。**複数の Mac で同時に使うことはサポートしない**(説明に書く)。
- テスト: 友達コードの往復・正規化・改ざん検出、封の往復と取り違えの拒否、書き出し→復元の往復、パスフレーズ違いの拒否、壊れたファイルの拒否。Worker のテストが読む検証用データ(友達コードと結びつけの署名)を S1 と同じやり方で出す。

---

# 3. Step 2: Worker(受信箱)

`gift-inbox-plan.md` の「API(Worker)」の表を実装する。要点と変更:

- `migrations/0002_inbox.sql`: 受信箱(受信箱 ID = 署名公開鍵の SHA-256 の先頭16バイトの Base32、署名公開鍵、暗号公開鍵、結びつけの署名)、許可リスト、リクエスト、メッセージの索引、受信箱ごとの拒否、回数のカウンタ。
- `wrangler.jsonc`: R2 の binding `GIFTS`(dev は `peta-gifts-dev`、prod は `peta-gifts-prod`。どちらも作成済みで7日の自動削除つき)と `REPORTS`(`peta-reports-dev` / `peta-reports-prod`。**dev はこの作業で作ってよい、prod はオーナーが作る**。非公開。対応後30日で消す運用は howto に書く)。
- API(すべて S1 の署名つき):
  - `POST /v1/mailbox`(作る。冪等)、`DELETE /v1/mailbox/{id}`(**退会**: 受信箱・許可リスト・リクエスト・メッセージと R2 の中身を消す。審判役の台帳は消さない)。
  - `PUT /v1/mailbox/{id}/allow`(受信者だけ。送り手の鍵ハッシュの追加/削除)。
  - `POST /v1/mailbox/{id}/requests`(誰でも。**許可リストに無くてよい**。封をした 2KB 以下。上限: 受信箱ごとに未処理20、同じ送り手から未処理3、送り手ごとに1日10。拒否された鍵は `403 blocked`)、`GET …/requests`、`DELETE …/requests/{rid}`(受信者だけ)。
  - `POST /v1/mailbox/{id}/messages`(**送り手が許可リストに無ければ `403 not_allowed`**。封をした Gift、8MB + 暗号の余白まで。`messageId` で冪等。未受け取り50通まで、送り手ごとに1日30通)、`GET …/messages`(一覧: messageId・サイズ・時刻・送り手の鍵ハッシュ)、`GET …/messages/{mid}`、`DELETE …/messages/{mid}`(受信者は受け取り後に、**送り手は受け取られる前の取り消しに**使える)。
  - `POST /v1/report`(受信者が同意したときだけ。復号済みの Gift と送り手の鍵ハッシュを `REPORTS` に置く)。**オーナーへの知らせ**: secret `REPORT_WEBHOOK` があれば、件数と ID だけを POST する(Discord の Webhook 形式で動けばよい)。画像・内容・鍵は送らない。
  - 運営の拒否: S1 の `blocked_keys` に入った鍵は、リクエスト・メッセージも `403 blocked`。
- 未受け取りのリクエストとメッセージは7日で期限切れ(R2 は自動削除、索引は書き込みのついでに掃除)。
- テスト(vitest): 受信箱の作成と冪等、許可前の送信が `not_allowed`、申請→承認→送信→一覧→取得→削除、送り手の取り消し、上限・期限・拒否、退会で全部消える、通報の保存と Webhook(中身なし)、署名・nonce・時刻の検証が S1 と同じに効くこと。
- 開発用へマイグレーションとデプロイ(S1 と同じ手順。ログインできない環境ならコマンドを報告に書く)。

---

# 4. Step 3: アプリの DB V16 と友達のルール(core)

- 既存の `friends(public_key, name, first_seen_at)`(ファイルの Gift の TOFU)を拡張: `enc_public_key`、`status`(`requested` = 自分が申請中 / `pending` = 相手からの申請を承認待ち / `friend` / `blocked`)、`allowed`(受信を許可)、`added_at`、`note`(申請の一言、80文字まで)。既存の行は `status` なし(ファイルで出会っただけ)として残す。
- 送受信の途中の状態: 送信の二段階(§5)の記録、受信済みのメッセージ ID(同じものを二度取り込まない)、受信箱の登録状況は `meta`。
- 友達のルール(状態の遷移)を core に置いてテスト: 申請 → 相手の承認で `friend`、辞退は通知しない、ブロックは以後の申請と Gift を拒否、友達から外すと許可を外す(受け取り済みの Gift は消さない)。

---

# 5. Step 4: アプリの通信(`server` feature)

- **受信箱の登録**: 最初の友達の追加(申請を送る、または相手のコードを貼る)のときに `POST /v1/mailbox`。
- **申請**: 相手のコード(またはリンク)を貼る → 自分のコード・表示名・一言を相手の暗号鍵で封をして相手の受信箱へ → 自分の許可リストに相手を入れる → `requested`。
- **承認**: 届いた申請を開く → Approve で相手を許可リストに入れて `friend`。Decline は消すだけ。Block は消して拒否。相手側は、許可リストの変化(送信が通るようになる)で `friend` に進める。7日応答がなければ `No response`。
- **送る**(Studio の Gift で「To a friend」): Gift v3 を作る(release は S1 の審判役)→ 相手の暗号鍵で封 → `POST …/messages` → **両方が通ってから端末で確定**。アップロードに失敗したら、S1 の `cancel_release` で取り消す。確定に失敗したら、送ったメッセージを送り手として `DELETE` し、release を取り消す。取り消しが届かなければ S1 の取り消し待ちに積む。`not_allowed` は「Nao hasn't accepted you yet.」。
- **受け取る**: 一覧 → 新着を取得 → 復号 → **今のファイルの受け取りと同じ処理**(署名・Gift v3 の claim・PNG とサイズの検証・`gift_already_received`)→ 成功したら `DELETE`。復号できない・署名が不正・すでに受け取り済み・ブロック中の送り手のものは `DELETE` して捨て、短く知らせる。通信エラーは次の確認で再試行。
- **確認の間隔**: 起動時、Gifts のページを開いたとき、窓にフォーカスが戻ったとき(前回から60秒以上)、「Check now」、起動中は15分ごと(友達が1人以上いて、設定が Automatically のとき)。新着がない間は間隔を延ばしてよい(最長60分)。常時の重い処理やアニメーションは入れない。
- 新着の知らせは既存の仕組み(デスクトップの隅の封蝋の封筒、メニューバー、サイドバーのバッジ)を使う。
- **通報**: 受け取った Gift の詳細の「Report…」 → 理由と同意 → `POST /v1/report`。送った人は自動でブロックしない(選べるようにする)。
- **退会**(Settings の Danger zone 的な場所。文言は控えめに): 受信箱と友達のデータをサーバーから消す。台帳(持ち主の記録)は消えないことを説明に書く。

---

# 6. Step 5: UI

見た目は既存の部品に合わせる(Settings の紙のカード、Gifts のページの手紙の世界観)。凝らない。

- **Settings → Friends**(紙のカード):
  - 自分の友達コード(`Copy code` と `Copy link`。§7)。
  - `Add a friend…`(コードかリンクを貼る欄、一言(任意)、送る)。
  - 友達の一覧: 名前・指紋(8文字)・状態(Friend / Request sent / Wants to be friends / No response)、Remove / Block。
  - 承認待ちの申請: 名前・指紋・一言、Approve / Decline / Block。
  - `Check for gifts`(Automatically / Only when I open Peta)、`Check now`、最後に確認した時刻。
- **Settings → Your Peta key**(紙のカード): `Back up key…`(パスフレーズを2回、保存先)、`Restore from backup…`(確認つき)。「鍵をなくすと、持っている本物を二度と渡せません」と、複数の Mac で同時に使えないことを短く書く。**友達を1人追加した時点で、まだバックアップしていなければ一度だけ勧める**。
- **Studio の Gift の封の工程**: 保存先に `To a friend`(友達を選ぶ)と、今の `Save a file` を並べる。友達がいなければ `Add a friend in Settings` へ案内。
- **Gifts のページ**: 上に承認待ちの申請(Approve / Decline / Block)。受信箱から届いた Gift は今の Gift と同じように並ぶ(送り手の名前つき)。詳細に `Report…`。
- **サイドバーの Gifts のバッジ** = 未開封の Gift + 承認待ちの申請(`aria-label` に内訳)。
- `tests/*.test.mjs`: 状態の表示、バッジの数、友達がいないときの案内、通信しない条件。

---

# 7. Step 6: 友達リンク

- **形式**: `peta://friend/<友達コードの中身を base64url>`。**開発者版は `peta-developer://friend/…`**(開発者版と配布版がリンクを取り合わないように。データフォルダも別なので)。
- Tauri v2 の deep-link プラグイン(`tauri-plugin-deep-link`)で、配布版は `peta`、開発者版は `peta-developer` のスキームを登録する(Info.plist の `CFBundleURLTypes`)。アプリが起動していないときも、起動中のときも受け取れること。
- **リンクを開いても、勝手に友達にしない**: 窓を前に出し、Settings の `Add a friend…` のダイアログを、コードを入れた状態で開くだけ。送るのは本人が押したとき。壊れたリンク・自分自身のコード・ブロック中の相手は、ダイアログに短い理由を出す。
- `Copy link` で、そのビルドのスキームのリンクをコピーする。メッセージのアプリによってはカスタムのリンクが押せないことがあるので、`Copy code` も並べておく(コードの欄にはリンクも貼れる)。
- テスト: リンクとコードの相互変換、スキーム違い(配布版で開発者版のリンク、その逆)の扱い、ダイアログが送信まで進まないこと。

---

# 8. Step 7: パックの売れ行きに「誰が引いたか」

- Worker: `GET /v1/packs/{id}/slots` は今、引かれた枠の番号だけを返す。**リクエストの署名がそのパックの作者の鍵なら**、各枠の引いた人の鍵ハッシュも返す(作者以外には今のまま番号だけ)。
- アプリ: `pack_sales`(`src-tauri/src/packs.rs`)の結果に、デザインごとの「引いた人」を足す。友達なら名前、知らない鍵なら `Someone`。
- UI: Packs の拡大の売れ行き(`PackSales.panel`)で、各デザインの行に引いた人の名前を小さく並べる(多ければ `+3`)。
- テスト: 作者だけが鍵ハッシュを受け取ること、名前の対応。

---

# 9. Step 8: ドキュメント

- `docs/server-howto.md` に追記: R2 `peta-reports-prod` の作り方、`REPORT_WEBHOOK` の入れ方(`wrangler secret put`)、通報の見方と対応(30日で消す)、鍵を運営の拒否に入れる方法(`wrangler d1 execute`)、退会の扱い。
- `docs/privacy-policy-draft.md`(日本語と英語): サーバーが受け取るもの(受信箱 ID・鍵ハッシュ・サイズ・時刻・IP(Cloudflare 側))、受け取らないもの(Gift の中身)、保存期間(7日、通報は対応後30日)、Cloudflare(海外)への委託、通報の扱い、退会。**法的な判断はオーナーが専門家と行う下書き**であることを冒頭に書く。
- 報告 `docs/archive/reports/server-s2-report.md`: 作ったもの、選んだ crate と版、本書と違う判断とその理由、守れないこと、オーナーの作業(prod の R2・マイグレーション・デプロイ・Webhook)、実機で確かめる項目。

---

# 10. 受け入れ条件

- [ ] すべてのテスト(Rust 既定と developer、JS、Worker)が通る。**配布版に通信の依存が入っていない**(`cargo tree` で確認)。
- [ ] 開発者版の2つのデータフォルダで: A のコードを B が貼る → A に申請が届く → Approve → **双方向に Gift を送れる** → 封蝋の封筒で届く → 開封できる → サーバーから消える → 送った本物は A の手元から消え、B が持ち主になる(S1 の台帳でも)。
- [ ] 承認前の送信は `not_allowed`。Decline・Block・期限切れ・上限超えの扱い。ブロックした相手の申請と Gift は届かない。
- [ ] アップロードや確定の失敗で、送った本物が宙に浮かない(取り消しで手元に戻る)。同じ Gift を二重に受け取らない。
- [ ] 友達がいなければ通信しない。
- [ ] 鍵の書き出し → 別のデータフォルダで復元 → 同じ友達・同じ受信箱で受け取れる。パスフレーズ違いは拒否。
- [ ] `Copy link` のリンクを開くと、追加のダイアログがコード入りで開く(送信はしない)。開発者版と配布版でスキームが分かれている。
- [ ] 通報が `REPORTS` に保存され、Webhook には件数と ID だけが届く。退会で受信箱のデータが消える。
- [ ] 作ったパックの売れ行きに、引いた友達の名前が出る。
- [ ] 報告 `docs/archive/reports/server-s2-report.md` と運用手順・プライバシーポリシーの下書きがある。

**実機でしか確認できないこと**(オーナーがやる): 2台の Mac での友達の追加と Gift の送受信、リンクをメッセージ・メモ・メールから開く、起動していないときのリンク、鍵の引っ越し、15分ごとの確認とスリープ明け。
