# Codex への依頼: Gift の受信箱 P1(Cloudflare Worker + 暗号 + 友達 + 送受信。開発者版のみ)

**使い方**: この文書の全文を Codex に渡す。**実装の指示**(Rust・TypeScript・JS/CSS)で、画像制作ではない。作業は **Step 順**。各 Step の終わりに `cargo test --manifest-path src-tauri/Cargo.toml --workspace`、`npm test`、(Worker は)`npm test` in `cloudflare/gift-inbox/` を通し、**Step ごとにコミット**する(Rust のルールと UI は別コミット)。

> 日本語で指示。コード中のコメントと UI の文言は、既存に合わせて**英語**。説明文書は日本語。

**仕様の本体は [`docs/gift-inbox-plan.md`](gift-inbox-plan.md)**(必ず最初に全部読む。API、友達と許可、通報、コスト、公開前チェックリスト)。本書は、その **P1 を実装する範囲と手順**を定める。食い違ったら**本書の「P1 の範囲」と、現行コード**を優先し、報告に書く。

---

# 0. P1 の範囲

## やること

1. 暗号と友達コード、署名つきリクエスト(core、Rust)。
2. Cloudflare Worker(`cloudflare/gift-inbox/`、TypeScript)とそのテスト。
3. DB **V9**(友達の状態、リクエスト、送信の状態)。
4. アプリ側の通信・友達・送信・受信(`src-tauri/src/inbox.rs`)。
5. UI: Settings の Friends、Gift の「To a friend」、Gifts のリクエスト欄とバッジ。
6. **機能フラグ**: Cargo feature **`gift-inbox`**。**`developer` が有効にする**(`developer = ["peta-core/developer", "gift-inbox", …]`)。**既定ビルド(配布版)では無効**で、通信のコードもコンパイルされない(`reqwest` 等は optional 依存)。UI も `inbox_enabled` が偽なら一切出さない。
7. ドキュメント: オーナー向けの手順 `docs/gift-inbox-howto.md`、README・decisions・macos-checklist の更新、報告 `docs/gift-inbox-p1-report.md`。

## やらないこと(P2 / P3。実装しない)

- Export / Import identity(鍵の書き出し・復元)、通報(`/v1/report`)と拒否リスト、「New friend code」、WAF レート制限の設定、利用規約・プライバシーポリシー、機能フラグを外すこと。
- **ただし P2 で足せるように**、Worker の API・DB・アプリのコマンドは、`plan` の記述どおりの形で作る(`/v1/report` のルートだけ `501` で予約してよい)。
- 複数端末の同時利用(**サポートしない**。決定済み)。ステッカー帳の同期。プッシュ通知。
- **本物のドメインへのデプロイ**(オーナーがやる)。Worker は `wrangler dev`(ローカル)と、オーナーが作る検証用の `*.workers.dev` で動けばよい。

---

# 1. 共通ルール

- 作業前に `README.md`、`docs/decisions.md`、`docs/gift-inbox-plan.md`、`docs/codex-signed-distribution-prompt.md`、`docs/signed-distribution-report.md`、`docs/distribution-howto.md`、`docs/port-spec/open-questions.md`、`docs/port-spec/macos-checklist.md` を読む。**未決(O1〜O5)は実装しない**。決定済みのルール(素材・日次・Welcome・Gift のコピー/エディション/8MB/PNG 検証/`gift_already_received`)は変えない。
- **変えてよいスキーマ変更は V9 だけ**。V1〜V8 の SQL の意味は変えない。**`SCHEMA_VERSION` を 9 にし、V8 → V9 のマイグレーションのテスト**(既存データの保持、旧 `friends` 行の扱い)を書く。
- **既存の Gift のファイル形式(`PETAGIFT` v1/v2)・署名・TOFU は変えない**。受信箱は**運び方が増えるだけ**で、中身は**今の Gift v2 のバイト列そのもの**(既存の `build_gift` が作るもの)。受信後は**既存の検証・受け取り(`gift::receive_gift`)を必ず通す**。
- 画像素材(`src/art/`)は追加・変更しない。CSS/JS は既存の部品(`dialog`、`Distribution.dialogStyle`、`.btn`、`.seg`、`.setcard` など)に合わせる。QR は Rust の `qrcode` crate(MIT/Apache)で SVG 文字列を作る(新しい画像ファイルは作らない)。
- 文字列は英語。**「Reduce motion」が有効なときは、動きを伴う演出を止める**。**常時の重い処理・常時のアニメーションを入れない**(通信は §4.3 の間隔だけ)。
- コードは周囲のスタイルに合わせる。**暗号は自作しない**(監査実績のある crate だけ)。
- Linux など macOS 以外で実行できない確認は `npm run check:mac` で型・ビルドのみ確認し、**実機確認が必要な項目は `docs/port-spec/macos-checklist.md` に追記**する。
- 変更したルール・挙動は `README.md` の該当節と `docs/decisions.md`(決定表に日付 **2026-10-06** で1行ずつ)に追記する。
- **秘密を書かない**: 鍵・トークン・本物のドメインをコードやテストに入れない(テストの鍵はテスト内で毎回生成)。`wrangler.toml` の ID はプレースホルダー(`REPLACE_ME`)にして、オーナーの手順書に書く。

---

# 2. 暗号・形式の取り決め(Rust と Worker で一致させる)

## 2.1 鍵

- **署名鍵**: 既存の Ed25519(`device_key.rs`、`device.key`)。**変更しない**。
- **暗号鍵**: **X25519 を別の鍵として新規に生成**し、`inbox.key`(0600、`device.key` と同じ流儀で、`core/src/inbox/keys.rs` に1モジュールで閉じる。将来 Keychain に移せる形)に保存。
- **結びつけ**: 署名鍵が `"peta-inbox-enc-v1" ‖ 暗号公開鍵` に署名した 64 バイト(以後 `bind`)。相手の友達コードを受け取ったら、**この署名を検証してから**暗号公開鍵を使う。

## 2.2 友達コード(`PETAF1-`)

- 形式: `PETAF1-` + Base32(Crockford、4文字ごとにハイフン、大文字小文字を区別せず `O/0`・`I/1` を許容して正規化 — 既存の `PETA1-` コードと同じ流儀・同じ実装を使う)。
- 中身: `version(1) · 署名公開鍵(32) · 暗号公開鍵(32) · bind(64) · 表示名(UTF-8、24 バイトまで、長さ1バイトつき) · チェックサム(4、SHA-256 の先頭)`。
- **リンク形式** `peta://friend/<base64url(同じバイト列)>` も出力・入力できる(アプリのリンク処理への登録は P2。P1 は「貼り付ければ受け付ける」まで)。
- **指紋**: 既存の `sign::fingerprint`(公開鍵の SHA-256 の先頭8文字)を使う。**友達の一覧と承認画面に必ず出す**。
- **受信箱 ID**: `Base32(SHA-256(署名公開鍵)の先頭 16 バイト)`(小文字・パディングなし。Worker と同じ関数)。**送り手の鍵ハッシュ**は `Base32(SHA-256(署名公開鍵) 全体)` 先頭 26 文字。

## 2.3 封をする(`seal`)

- **HPKE(RFC 9180)Base モード**、KEM = DHKEM(X25519, HKDF-SHA256)、KDF = HKDF-SHA256、AEAD = ChaCha20-Poly1305。監査実績のある crate(例: `hpke`)を使う。
- `info = "peta-inbox/v1"`。**AAD = `mailboxId ‖ messageId ‖ 送り手の鍵ハッシュ`**(別の受信箱・別のメッセージへの差し替えを検出する)。
- 出力: `version(1) · enc(32) · ciphertext`。**平文は Gift v2 のバイト列**(先頭が `PETAGIFT`。それ以外のマジックは受信時に拒否。友達リクエストは §2.4 の別の封)。
- 上限: 平文 ≤ **8MB**(既存の Gift の上限 `sign::MAX_FILE` に合わせる)、ciphertext ≤ 平文 + 100 バイト。

## 2.4 友達リクエスト

- 平文(JSON、2KB 以内): `{ "friendCode": "PETAF1-…", "note": "最大80文字(任意)", "sentAt": "ISO8601" }`。**受信者の暗号公開鍵で §2.3 と同じ方式で封をする**(`info = "peta-inbox-request/v1"`)。
- 受信側は復号したあと、**友達コードの結びつけ(`bind`)を検証**し、`note` は**テキストとしてだけ表示**(textContent。HTML として解釈しない。制御文字・BiDi 制御文字は除去)。

## 2.5 署名つきリクエスト

すべての Worker 呼び出しに付ける。**正規化した文字列**(改行区切り): `METHOD ‖ PATH(クエリを含む) ‖ X-Peta-Time ‖ X-Peta-Nonce ‖ hex(SHA-256(本文))`。これを署名鍵で Ed25519 署名。

| ヘッダー | 内容 |
|---|---|
| `X-Peta-Key` | 署名公開鍵(Base64url) |
| `X-Peta-Time` | UNIX 秒(Worker は **±300秒**以外を `401 clock_skew`、レスポンスの `Date` ヘッダーでアプリがずれを案内できるようにする) |
| `X-Peta-Nonce` | 16 バイト乱数(Base64url)。**10分間は再利用不可**(`401 replay`) |
| `X-Peta-Sig` | 署名(Base64url) |

- 署名の検証・正規化・ID 計算は **Rust(core)と Worker(TS)で完全に一致**させる。**共有のテストベクトル** `cloudflare/gift-inbox/test/vectors/inbox-v1.json`(固定の鍵・入力・期待される出力: 受信箱 ID、鍵ハッシュ、署名つきリクエストのヘッダー、友達コード、封の復号結果)を作り、**Rust のテストと Worker のテストの両方が同じファイルを読んで通る**ようにする(形式のずれを防ぐ)。ベクトルの秘密鍵は「テスト用」と明記した固定値でよい。

---

# 3. 実装の Step

## Step 1 — core: 鍵・友達コード・封・署名つきリクエスト

- `core/src/inbox/`(`mod.rs`・`keys.rs`・`friend_code.rs`・`seal.rs`・`auth.rs`)。cfg(feature = "gift-inbox")。依存は optional(`x25519-dalek`・`hpke` など。**必要な最小限**)。
- 純関数・trait で書く(通信を含めない): `Transport` trait(`request(method, path, headers, body) → Response`)を定義し、後続 Step で `reqwest` 実装と**テスト用の偽サーバー**(Worker と同じ契約を満たすメモリ上の実装)を作る。
- **テスト**: ベクトルの一致、改ざん(1バイト)・別の受信箱への差し替え(AAD)・別の鍵・短すぎる/長すぎる入力・結びつけの偽造・不正な友達コード(チェックサム・バージョン)の拒否、鍵ファイルの権限(0600)と再起動での保持、制御文字の除去。

## Step 2 — Worker(`cloudflare/gift-inbox/`)

- TypeScript、`wrangler.toml`、`package.json`(`vitest` と `@cloudflare/vitest-pool-workers`)、`src/index.ts`(ルーティング)、`src/auth.ts`、`src/db.ts`、`migrations/0001_init.sql`、`README.md`(オーナー向けの最小手順は `docs/gift-inbox-howto.md` に書き、ここはリンクだけ)。
- バインディング: **D1 `INBOX_DB`**、**R2 `INBOX_BUCKET`**。秘密(シークレット)は**無い**(Worker は検証だけ)。上限は `[vars]` の設定値にして、後から変えられる:
  `MAX_BODY_BYTES = 8_400_000`、`TTL_DAYS = 7`、`MAX_PENDING_PER_MAILBOX = 50`、`MAX_PER_SENDER_PER_DAY = 30`、`MAX_REQUESTS_PENDING = 20`、`MAX_REQUESTS_PER_SENDER_PENDING = 3`、`MAX_REQUESTS_PER_SENDER_PER_DAY = 10`、`MAILBOX_CREATE_PER_IP_PER_HOUR = 5`。
- ルート(`plan` の API 表どおり。パスは `/v1/…`): `POST /v1/mailbox`、`PUT /v1/mailbox/{id}/allow`、`POST /v1/mailbox/{id}/requests`、`GET /v1/mailbox/{id}/requests`、`DELETE /v1/mailbox/{id}/requests/{rid}`、`POST /v1/mailbox/{id}/messages`、`GET /v1/mailbox/{id}/messages`、`GET /v1/mailbox/{id}/messages/{mid}`、`DELETE /v1/mailbox/{id}/messages/{mid}`、`POST /v1/report`(`501 not_implemented`)。
- **D1 のスキーマ**(例。Codex が確定してよい): `mailboxes(id, sign_pub, enc_pub, bind_sig, created_at)`、`allow(mailbox_id, sender_hash, added_at, PRIMARY KEY(mailbox_id, sender_hash))`、`blocked(mailbox_id, sender_hash, PRIMARY KEY …)`、`messages(mailbox_id, message_id, sender_hash, size, created_at, expires_at, PRIMARY KEY(mailbox_id, message_id))`、`requests(mailbox_id, request_id, sender_hash, size, created_at, expires_at, …)`、`nonces(nonce, expires_at)`、`counters(key, window, count)`。**R2 のキー**: `m/{mailboxId}/{messageId}`、`r/{mailboxId}/{requestId}`。
- 振る舞い:
  - **許可のチェック**: `POST …/messages` は、送り手の鍵ハッシュが `allow` にあり `blocked` に無いときだけ。無ければ `403 not_allowed`(本文は `{"error":"not_allowed"}`)。`POST …/requests` は許可リストに無くても可(拒否リストの鍵は `403`)。
  - **冪等**: 同じ `messageId`/`requestId` の再送は、保存済みなら `200`(重複を作らない)。
  - **サイズ**: `Content-Length` と実際のストリームの両方で上限を強制(超過は `413`、保存しない)。
  - **削除**: `DELETE` で R2 と D1 の行を**即削除**。**期限切れ**(`TTL_DAYS`)は、**Cron Trigger(毎時)**で D1 の行と R2 のオブジェクトを削除。R2 のライフサイクルルールは「保険」としてオーナーの手順書に書く。
  - **署名の検証**: WebCrypto の Ed25519。時刻・nonce・本文ハッシュ。**受信箱へのアクセス(`GET`/`DELETE`/`PUT`)は、そのアクセスの署名鍵が受信箱の `sign_pub` と一致するときだけ**。
  - **エラーの形**: 常に `{"error":"<code>"}` と適切な HTTP ステータス(`400 bad_request`、`401 bad_signature|clock_skew|replay`、`403 not_allowed|blocked`、`404 not_found`、`409 exists`、`413 too_large`、`429 rate_limited`)。エラー文に内部情報を入れない。
  - **CORS は付けない**(ブラウザからは使わない)。`Origin` ヘッダー付きのリクエストは `403`。
  - **ログ**: **IP・鍵・本文・ID を `console.log` に出さない**。保持するメタデータは「受信箱 ID・送り手の鍵ハッシュ・サイズ・時刻」だけ。
- **テスト**(vitest): 共有ベクトルの一致、署名の改ざん・時刻のずれ・nonce の再利用、許可なしの送信が `403`、承認(`PUT allow`)後に `200`、ブロック後に `403`、サイズ超過・件数上限・日次上限・リクエスト上限、冪等、削除と期限切れ(Cron)、別の署名鍵からの `GET`/`DELETE` が拒否、`Origin` 付きの拒否、`report` が `501`。

## Step 3 — DB V9 と友達のロジック(core)

- **マイグレーション V8 → V9**(`db.rs`)。**`friends` の `observe()` は `INSERT OR IGNORE INTO friends VALUES (?1,?2,?3)` と位置指定なので、列を足す前に列名指定へ直す**(現行のまま列を足すと壊れる)。
  - `friends` に追加: `enc_public_key TEXT`、`status TEXT NOT NULL DEFAULT 'seen'`(**既存の行 = 署名つき Gift を過去に受け取った送り手(TOFU)= `seen`**)、`added_at TEXT`、`requested_at TEXT`。
  - 状態: `seen`(ファイルで見ただけ)/ `requested`(自分が申請中)/ `pending`(相手の申請を承認待ち)/ `friend`(承認済み・双方向)/ `blocked`。
  - 新しい表: `friend_requests(request_id TEXT PRIMARY KEY, public_key TEXT NOT NULL, enc_public_key TEXT NOT NULL, name TEXT NOT NULL, note TEXT, fingerprint TEXT NOT NULL, received_at TEXT NOT NULL, status TEXT NOT NULL)`(受信した申請を**復号して**保存。処理後に消す)。
  - `gifts_sent` に `state TEXT NOT NULL DEFAULT 'sent'`(`reserved` / `sent` / `failed`)と `via TEXT`(`file` / `inbox`)を追加。
  - **受信箱の登録状態**は既存の `meta`(キー: `inbox.registered_at`、`inbox.enabled`、`inbox.auto`(`auto|manual`)、`inbox.backoff_minutes`)。
- **友達の状態遷移を1か所の関数群にまとめ、テストする**: 申請を送る(`requested` + 自分の許可リストに相手を入れる)/ 申請を受ける(`friend_requests` に保存、`pending`)/ 承認(`friend` + サーバーの許可リストを更新)/ 辞退 / ブロック(`blocked`、以後の申請・Gift を無視)/ 友達から外す。**ブロックした鍵からの Gift は、サーバーが送ってきても受信側で破棄**(多重防御)。**状態が壊れた順序(二重承認、承認済みへの再申請、ブロック済みへの承認)の扱いを仕様化してテスト**。
- **名前の衝突**: 既存の TOFU の「同じ名前で別の鍵」警告(`friends::preview`)を、**友達コード・申請・承認の画面にも出す**。
- **テスト**: V8 → V9 の移行(既存の `friends` 行・`gifts_sent` の保持)、上記の遷移、`observe()` が列追加後も動く、`gifts_received`・`gift_signers` の既存挙動が不変。

## Step 4 — Tauri: 通信・コマンド・自動確認(`src-tauri/src/inbox.rs`、cfg(feature = "gift-inbox"))

### 4.1 通信

- `reqwest`(`default-features = false`、`rustls-tls`、optional)の `Transport` 実装。**HTTPS のみ**(開発者版は環境変数 `PETA_INBOX_URL` で `http://localhost:…` を許可。それ以外の `http` は拒否)。リダイレクトは**追わない**。接続・全体のタイムアウトを設定(例: 10秒 / 30秒)。レスポンスの本文サイズを**上限で打ち切る**(サーバーを信用しない)。`User-Agent: Peta/<version>`。
- **取得先 URL は定数 1か所**(`INBOX_BASE_URL`。既定はプレースホルダー `https://gift.example.invalid` — 本物はオーナーが決める。**`.invalid` のままなら「サーバーが設定されていません」を返し、通信しない**)。
- 開発・テスト用に、**データフォルダを上書きする環境変数 `PETA_DATA_DIR`**(`developer` ビルドのみ)を足す(1台で2つのインスタンスを動かして試すため。既存の `app_data_dir` の使い方に合わせ、`store.rs` の1か所で)。2つ目のインスタンスが多重起動で拒否される場合は、その回避策を `docs/gift-inbox-howto.md` に書く。

### 4.2 コマンド(すべて `inbox_enabled` が真のときだけ登録/有効)

`inbox_enabled`(→ bool)、`inbox_status`(登録済みか・友達数・未処理のリクエスト数・最後の確認時刻・エラー)、`inbox_enable`(受信箱を登録 `POST /v1/mailbox`、冪等)、`friend_code_get`(自分の友達コードとリンクと QR の SVG)、`friend_add(code)`(貼られたコードを検証 → 申請を送る → 状態 `requested`)、`friends_list`、`friend_requests`、`friend_approve(request_id)`、`friend_decline(request_id)`、`friend_block(public_key)`、`friend_remove(public_key)`、`gift_send_to_friend(sticker_id, friend_public_key, note)`、`inbox_check`(手動)、`inbox_set_auto(auto|manual)`。**エラーは人が読める英語**(`Nao hasn't accepted you yet.`、`Could not reach the Gift server.`、`Your Mac's clock looks off.` など)。

### 4.3 送信(二相)

1. **既存の `gift::build_gift` を分割**する(挙動は変えない): 署名つき Gift の生成(エディションの**予約**を含む)と、**送信の確定**(`gift_record_sent` と provenance `Gifted`)を分ける。**ファイルで保存する既存の経路は、今まで通り「保存に成功したら確定」のまま**にして、既存のテストが通ること。
2. 受信箱経由: 予約(`gifts_sent.state = 'reserved'`)→ 封をする → `POST`。**成功したら確定(`sent`)**。**失敗したら予約を解放**(その番号が最新のときはエディションの採番を戻す。他の送信が割り込んでいたら**欠番を許す**)。**再送しても重複しない**(`messageId` は予約時に決めて固定)。
3. `403 not_allowed` は「承認されていません」と返し、**エディションを消費しない**。
4. アップロード中に窓を閉じる・アプリを終了しても、予約が残ったまま `sent` にならない(次回起動時に `reserved` を `failed` にして番号を解放する整理)。

### 4.4 受信(確認 → 取り込み)

- **確認のタイミング**(§5 の確認ルール)で、`GET …/messages` と `GET …/requests` → 各項目を取得 → 復号 → 検証 → 取り込み → `DELETE`。
- **Gift の取り込み**: 復号した平文が `PETAGIFT` で始まることを確認 → **既存の `gift::receive_gift`(署名検証・TOFU・サイズ/PNG 検証・`gift_already_received`)** へ。**ブロック済みの送り手は破棄して `DELETE`**。`gift_already_received` は**成功扱いにして `DELETE`**(前回の確認応答が届かなかった場合の再配信に耐える)。
- **不正なもの**(復号失敗、署名不正、別のマジック、サイズ超過)は**破棄して `DELETE`**し、ユーザーには短く出す(件数だけ。**中身や送り手を勝手に表示しない**)。通信エラーは次の確認で再試行(`DELETE` していないので失われない)。
- **友達リクエストの取り込み**: §2.4 の検証 → `friend_requests` に保存 → 状態 `pending`。**拒否リスト・ブロック済みの鍵は破棄**。同じ送り手の重複は更新。
- 取り込み後は `today::announce(app)`(既存)で封蝋の封筒・バッジを更新し、`inbox-updated` イベントを JS へ送る。

### 4.5 自動確認(Rust のタイマー)

- 条件: `inbox.enabled` かつ 友達(`friend`/`requested`/`pending`)が1人以上 かつ `inbox.auto = auto` のときだけ**タイマーを動かす**。それ以外は**止まっている**(通信ゼロ)。
- 間隔: **既定 15 分**(定数・設定値)。**新着がなければ 15 → 30 → 60 分へバックオフ**(上限60分)し、**新着があれば 15 分に戻す**。通信エラーも同様に伸ばす。
- ほか: アプリ起動時に1回、Gifts ページを開いたとき、窓にフォーカスが戻ったとき(**前回から60秒以上**あけて)、「Check now」。**同時実行は1つだけ**(単一飛行のロック)。macOS がスリープ中は動かさない(タイマーの再開で追いつく)。
- **Reduce motion** は通信に関係しない(動きの設定)。**Sounds / Haptics** は新着の封筒の既存の挙動に従う。

### 4.6 テスト(Rust)

- 偽サーバー(Worker と同じ契約を満たすメモリ上の実装。**Step 2 のベクトルと同じ入出力**)で: 友達の申請 → 承認 → 送信 → 受信 → 開封までの全体(2つの `Library` を一時フォルダに作る)、承認前の送信が `403` でエディションが減らない、アップロード失敗でエディションが戻る/欠番、再送で重複しない、`DELETE` が届かず再配信されても二重取り込みしない、ブロック済みの破棄、不正な封・不正な署名・サイズ超過の破棄、`.invalid` の URL で通信しない、バックオフの計算(純関数)、タイマーの条件(友達0人・`manual` で止まる)。
- **フラグの検証**: `cargo build`(既定の機能のみ)で `gift-inbox` のコードも依存も含まれないこと(`cargo tree -e features` などで確認し、結果を報告に書く)。

## Step 5 — UI(`src/app/js/*`、CSS)

> `window.__TAURI__` 経由で `inbox_enabled` を呼び、偽なら**以下を一切描画しない**。

### 5.1 Settings → Friends(`settings.js`)

`.setcard` の下に **「Friends」カード**:
- **受信箱の有効化**: 未登録なら「Turn on Gift inbox」(説明: 「Friends can send you gifts without a file. Gifts are encrypted; Peta’s server can’t read them.」)。有効後は以下。
- **Your friend code**: 先頭を短縮したコード(コピー可)、「Copy code」「Copy link」、QR(`friend_code_get` の SVG を `<img>` ではなく**インライン SVG を安全に**差し込む。Rust が生成した固定の SVG のみ)。指紋(例 `ABCD-EFGH`)を併記し、「Compare this with your friend’s screen」。
- **Add a friend**: 入力欄(`PETAF1-…` かリンク)+「Send request」。結果: 「Request sent to Nao」。名前の衝突は警告表示。
- **一覧**(名前・指紋・状態チップ: `Friend` / `Request sent` / `Wants to be friends` / `Blocked`)。各行に「Remove」「Block」。
- **Requests**: `Approve` / `Decline` / `Block`(承認待ちの申請。一言(note)があれば表示)。
- **Check for gifts**: `Automatically`(既定)/ `Only when I open Peta`、「Check now」、最後の確認時刻、エラー表示。
- **鍵を失ったときの案内**は P2(Export/Import)。ここには「P2 で」と書かず、何も表示しない。

### 5.2 Gift を送る(`book.js` の `giftForm` と `ceremony.js` の `sealGift`)

- Book の詳細の「Gift…」フォームに**送り先の選択**を足す: **「To a friend」(承認済みの友達のリスト)/「Save a file」(今の動作)**。友達がいなければ「Save a file」だけ(今の見た目)。
- 友達に送る場合は `gift_send_to_friend`。成功したら**既存の封蝋の演出**(`sealGift`)を再利用し、ヒントを `Sealed. Sent to {name}.`、トーストを `Sent to {name} — your own sticker stays in the Collection.` に。失敗時は演出に入らず、フォームにエラーを出し、**エディションが消費されていない**ことを確認できる(フォームの再送で同じ番号)。
- 「Save a file」の経路は**挙動・文言ともに変えない**。

### 5.3 Gifts ページとバッジ(`library-pages.js`、`shell.js`、`bridge.js`)

- Gifts の上部に**友達リクエスト**の帯(Approve / Decline / Block。note と指紋つき)。「Check now」ボタン。
- **サイドバーの Gifts のバッジ**は「未開封の Gift 数 + 未処理のリクエスト数」(数字ピル。`aria-label` に内訳: `Gifts, 2 unopened, 1 friend request`)。
- `S` に `friends`・`requests`・`inbox` を足し、`reload()` で取得。`inbox-updated` で `Bridge.changed()`。

### 5.4 共通

- キーボードだけで操作でき、フォーカスが見える。ダイアログは既存の `dialog` 流儀(`Bridge.dialogOpen`)。**テキストは必ず textContent**(名前・note は他人の入力)。
- Studio / Desk の両方で崩れない(Desk は既存の紙の見た目に合わせる)。**最小 720×520** と下部バー(≤ 880px)で重ならない。
- 夜モード(別依頼で入る)に備え、色は**共通トークン**(`--ink` `--muted` `--w-*` など)で書く。

## Step 6 — ドキュメント

- **`docs/gift-inbox-howto.md`**(オーナー向け): Cloudflare のアカウント準備、D1 と R2 の作り方、`wrangler.toml` の ID 差し替え、`wrangler dev`(ローカル)での動かし方、検証用の `*.workers.dev` へのデプロイ、R2 のライフサイクルルール(7日)、Cron の確認、カスタムドメイン `gift.<domain>` の割り当て、**アプリに取得先 URL を設定する方法**(`INBOX_BASE_URL`)、**1台で2インスタンスを動かして試す手順**(`PETA_DATA_DIR`)、ログに何も出ていないことの確認方法、**撤退手順**(機能フラグを外す・データの削除)。
- `README.md` に「Giftの受信箱(開発者版のみ)」の節。`docs/decisions.md` に決定を 2026-10-06 で追記(P1 の範囲、機能フラグ `gift-inbox`、V9、暗号の取り決め)。`docs/port-spec/macos-checklist.md` に実機確認項目(下)。
- **`docs/gift-inbox-p1-report.md`**: 何を作ったか、**Step ごとのコミット ID と実行したテストの結果**、プレビュー/仕様と違えた点とその理由、`cargo tree` での機能フラグの確認結果、**オーナー判断が要る点**(取得先 URL、Worker の上限値、15分の間隔)、**P2 への申し送り**。

---

# 4. 受け入れ条件(P1)

1. `developer` ビルドで、2つのインスタンス(別のデータフォルダ)の間で: Bob が Alice の友達コードを貼る → Alice に「friend request」が届く(バッジ)→ Alice が Approve → 互いに送れる → Bob が Book から「To a friend」で Gift を送る → Alice に**封蝋の封筒**が届く → 開封できる(既存の演出)→ **サーバーのデータが消えている**。
2. **承認前の送信は `403 not_allowed`** で、エディション番号が減らない。Block した相手の申請・Gift は無視される。
3. アップロード失敗(サーバー停止)で**エディションが戻る/欠番**になり、再送で**重複しない**。取り込み後に `DELETE` が失敗しても**二重取り込みしない**。
4. 署名の改ざん・nonce の再利用・時刻のずれ・サイズ超過・件数上限・別の鍵からの受信箱アクセス・`Origin` 付きは、Worker が拒否する。Rust と Worker が**同じテストベクトル**で通る。
5. **配布版のビルド(`developer` なし)に、通信のコードも依存も含まれない**。UI にも一切出ない。
6. 友達が0人・`Only when I open Peta` のとき、**通信が一切起きない**(テストとログで確認)。
7. 既存のファイル/コードの Gift・公式イベント・作者パックが**従来どおり動く**(既存テストが全部通る)。
8. `cargo test --workspace`、`npm test`、Worker の `npm test`、`npm run check:mac` がすべて通る。

## `macos-checklist` に追記する項目

- 2つのインスタンス(`PETA_DATA_DIR`)で友達の申請〜承認〜送信〜受信が通る(実機)。
- 新着の封筒が窓を閉じている間も出る(15分の確認・フォーカス復帰時の確認)。
- Mac のスリープ復帰後に確認が再開する。
- Wi‑Fi を切って送ると、エラーが出てエディションが戻る/欠番。再接続後の再送で重複しない。
- ネットワークが無い・サーバーが落ちていても、ファイル/コードの Gift が従来どおり使える。
- 友達コードの QR とコピーが、AirDrop・メッセージ経由でも壊れない(改行・空白の混入)。

---

# 5. セキュリティの要点(レビューで確認する)

- サーバーは**信用しない**: レスポンスの大きさ・ID の文字種・件数を検証し、不正なら破棄。
- **暗号の取り扱い**: 鍵の比較は定数時間、鍵のメモリは使い終わったらゼロ化(`zeroize`)、乱数は OS から。AAD の取り違えがないこと。
- **ログ**: アプリ・Worker のどちらも、鍵・本文・IP・友達コードを出さない。
- **入力**: 友達コード・note・名前は他人の入力(長さ・文字種・制御文字・BiDi を制限。HTML として扱わない)。
- **DoS**: 受信箱の件数・サイズ・リクエストの上限(Worker)と、アプリ側の取得サイズ上限・並行数1。
- **権限**: Worker に秘密を持たせない。D1/R2 のバインディングは最小権限(ダッシュボード側の設定はオーナーの手順書に)。
