# Codex への依頼: サーバー S1(審判役 = 持ち主と版の枠の台帳)

**使い方**: この文書の全文を Codex に渡す。**実装の指示**(TypeScript・Rust・最小限の JS)で、画像制作・見た目のデザインではない。作業は **Step 順**。各 Step の終わりに `cargo test --manifest-path src-tauri/Cargo.toml --workspace`、`npm test`、`npm test` in `cloudflare/peta-api/` を通し、**Step ごとにコミット**する(Worker・Rust のルール・UI は別コミット)。

> 日本語で指示。コード中のコメントと UI の文言は、既存に合わせて**英語**。説明文書は日本語。

**仕様の本体は [`docs/server-plan.md`](../../server-plan.md)**(必ず最初に全部読む)。本書は、その **S1 を実装する範囲と手順**を定める。食い違ったら**本書と現行コード**を優先し、報告に書く。置き場所(Cloudflare のアカウント・D1・R2)は作成済みで、ID は [`docs/server-resources.md`](../../server-resources.md)。

**背景(決定済み、`docs/decisions.md` 2026-10-11「ステッカーの唯一性」「Pack は版を刷る本物のガチャ」、2026-10-12「サーバーの統合設計」)**: 本物は Gift v3 の release/claim で持ち主が移り、Pack v2 は番号つきの版を刷る。アプリの受け口 `ownership::Referee` は全部通す `NoReferee` のままなので、**同じ Gift ファイルを複数人が受け取れ、同じパックを複数人が開くと同じ番号の版が複数できる**。S1 はこれを止める。

---

# 0. 範囲

## やること

1. Cloudflare Worker `cloudflare/peta-api/`(TypeScript)。台帳の D1 マイグレーション、署名つきリクエストの検証、台帳の API、回数制限、テスト。
2. Rust と Worker で**同じ署名バイト列**を使うための、検証用データ(test vectors)。
3. アプリ側の `HttpReferee`(`Referee` の実装)と、`Referee` の形の見直し。
4. DB **V14**: 登録待ち・取り消し待ち・枠の引き待ち・サーバー以前の印。
5. サーバー以前のものの移行、枠の同期、復旧。
6. 最小限の UI(確認済みの表示・失敗の文言・開発者向けの状態表示)。
7. 機能フラグ: Cargo feature **`server`**(app crate)。**`developer` が有効にする**(`developer = ["peta-core/developer", "server"]`)。**既定ビルド(配布版)では無効**で、通信のコードはコンパイルされず、今までどおり `NoReferee`。
8. ドキュメントと報告 `docs/archive/reports/server-s1-report.md`。

## やらないこと(S2 以降)

- 友達・Gift の受信箱(R2)・暗号化・Export/Import identity・通報・拒否リストへの追加の運用。**ただし**、`blocked_keys` の表と「拒否された鍵は `403 blocked`」の判定は S1 で入れてよい(空の表)。
- Scraps の扱い(当面は端末のまま。触らない)。友達の Market。
- **本番(`--env prod`)へのデプロイとマイグレーション**(オーナーが行う)。独自ドメイン。
- 見た目の仕上げ(別担当)。

---

# 1. 共通ルール

- 作業前に `README.md`、`docs/decisions.md`(上記の行)、`docs/server-plan.md`、`docs/server-resources.md`、`docs/archive/reports/uniqueness-report.md`、`docs/archive/reports/edition-pack-report.md`、`src-tauri/crates/core/src/{ownership.rs,gift.rs,edition_pack.rs,creator_pack.rs,db.rs,library.rs,device_key.rs,sign.rs,export.rs}`、`src-tauri/src/{gifts.rs,packs.rs,collection.rs,creator.rs,lib.rs}` を読む。
- **スキーマ変更は V14 だけ**。V1〜V13 の SQL の意味は変えない。`SCHEMA_VERSION` を 14 にし、**V13 → V14 のマイグレーションのテスト**(既存データの保持)を書く。
- 既存の署名形式(`PETAGIFT` v1〜v3、`PETAPACK` v1/v2、`Creation` / `Transfer` の署名バイト列)は**変えない**。サーバーはこれに合わせる。
- **暗号は自作しない**。Rust は既存の `ed25519-dalek` と `sign.rs`、Worker は WebCrypto の `Ed25519`。
- HTTP は app crate(`src-tauri/src/`)に置き、core は `Referee` トレイト越しにだけ使う(core に HTTP の依存を入れない)。クライアントは小さな同期クライアント(例: `ureq`、rustls)を **optional 依存**にし、`server` feature でだけ有効にする。**タイムアウト 10 秒**。メインスレッド(UI)を止めない。
- 変更したルールは `README.md` と `docs/decisions.md`(日付 **2026-10-12**)に追記する。実機確認が要る項目は `docs/port-spec/macos-checklist.md` に追記する。
- **秘密を書かない**: API トークン・Webhook の URL をリポジトリに入れない(S1 では不要のはず)。D1 の ID とアカウント ID は秘密ではないので `wrangler.jsonc` に書いてよい。

---

# 2. Step 1: 署名バイト列の検証用データ(Rust)

Worker が Rust と**1バイトも違わない**バイト列を組み立てられるよう、正解データを作る。

- core に `#[test]` を足し、固定の鍵(テスト用の決まった種)で次を作って `cloudflare/peta-api/test/vectors.json` と**比較**する(ファイルが無い・違う場合は、環境変数 `PETA_WRITE_VECTORS=1` のときだけ書き出し、それ以外は失敗)。
  - `Creation::bytes()`: 名前あり/なし、版の番号あり/なし、非 ASCII の名前(日本語・絵文字)、`"` と `\` を含む名前。
  - `Transfer::bytes()`: release と claim、`ref` が Gift ID とパックの枠(`slot_ref`、`{pack}:slot-{n}`)のもの。
  - それぞれの `creator_sig` / `sig`、公開鍵(`sign::public_key` の base64)。
  - §4.2 のリクエスト署名のバイト列の例。
- 必要なら `Creation::bytes` / `Transfer::bytes` を `pub(crate)` から外に出すだけにとどめ、**中身は変えない**。

---

# 3. Step 2: Worker の土台

- `cloudflare/peta-api/`: `package.json`(`wrangler@4.149.0` を devDependency に固定、`vitest`、`@cloudflare/vitest-pool-workers`)、`tsconfig.json`、`wrangler.jsonc`、`src/index.ts`、`migrations/0001_ledger.sql`、`test/`。
- `wrangler.jsonc`:
  - `name: "peta-api"`、`account_id` は `server-resources.md` の値、`compatibility_date` は作業日。
  - `env.dev`: D1 binding `DB` → `peta-dev`(ID は `server-resources.md`)。`env.prod`: `DB` → `peta-prod`。
  - **R2 は S1 では使わないので binding を入れない**(S2 で足す)。
  - 回数制限: Workers の Rate Limiting binding(`ratelimits`)が使えれば使う。使えない(無料プランで不可など)と分かったら、D1 のカウンタで代わりにし、報告に書く。
- ルーティングは小さく自前で(フレームワークを入れない)。応答は JSON、エラーは `{ "error": "<code>", "message": "<English>" }` と適切な HTTP ステータス。
- ログに鍵・IP・本文を出さない。

---

# 4. Step 3: 台帳と API(Worker)

## 4.1 D1(`migrations/0001_ledger.sql`)

`server-plan.md` §段階1 の表どおり: `stickers`、`transfers`、`packs`、`pack_slots`、`nonces`、`blocked_keys`。必要な索引(`nonces.expires_at` など)を付ける。期限切れの nonce は書き込みのついでに消す(Cron は使わない)。

## 4.2 リクエストの署名

`server-plan.md` §共通 のとおり。署名する内容は改行区切りの UTF-8 文字列 `"peta.req.v1\n{METHOD}\n{path}\n{time}\n{nonce_b64}\n{sha256_hex(body)}"`(**この形で確定してよい。変えるなら報告に書く**)。
- 時刻は ±300 秒。外れたら `401 clock_skew`。
- **データを変えるリクエスト(POST)だけ** nonce を `nonces` に記録し、再利用は `401 replay`。GET は記録しない。
- 署名が違えば `401 bad_signature`。`blocked_keys` にあれば `403 blocked`。

## 4.3 API

`server-plan.md` §段階1 の API 表を**すべて**実装する: `POST /v1/stickers`、`POST /v1/stickers/{id}/release`、`POST /v1/stickers/{id}/cancel`、`POST /v1/stickers/{id}/claim`、`GET /v1/stickers/{id}`、`POST /v1/packs`、`POST /v1/packs/{id}/cancel`、`POST /v1/packs/{id}/slots/{n}/claim`、`GET /v1/packs/{id}/slots`。それと `GET /v1/health`(署名なし、`{ok:true}`)。

規則(表に書いてあることに加えて):
- **署名の主は、操作する鍵と一致すること**(`POST /v1/stickers` は `creator_public_key`、release/cancel は今の `holder_key`、claim は transfer の `actor_key`、パックは `creator_key`)。違えば `403 not_yours`。
- `Creation` / `Transfer` の署名を、Step 1 と同じバイト列で検証する。`at` が未来(サーバー時刻 +300 秒より後)なら拒否。
- **同じ内容の再送はすべて OK(冪等)**。register は同じ `creator_sig`、release/claim は同じ `sig`、枠の claim は同じ claimer と同じ transfer、cancel はすでに `held` なら OK。
- 1つの操作は1つの D1 `batch`(トランザクション)。競合(2人同時の claim)では**片方だけ**が通ること(条件つき `UPDATE … WHERE state='released' AND release_ref=? AND seq=?` の変更行数で判定)。
- `POST /v1/packs`: 本文はパック(`pack_id`・`slot_count`(1〜200)・`header_digest`)と、版ごとの `{ creation, release }`、パックへ移す本物の `release` の一覧。版の `release.ref` は `{pack_id}:slot-{n}` で、`n` は `slot_count` 未満。全部を1つの batch で入れ、1つでも駄目なら全部なし。
- `POST /v1/packs/{id}/slots/{n}/claim`: `n < slot_count`。本文に版の `claim` があれば、その `ref` が `{pack_id}:slot-{n}` と一致すること。枠の記録と版の claim を1つの batch で。使用済みは `409 slot_taken`(同じ claimer・同じ transfer なら OK)。登録されていないパックは `404 unknown_pack`。
- `POST /v1/packs/{id}/cancel`: 1枠も引かれていないときだけ。パック・その時に登録した版(`stickers` と `transfers`)・移した本物の release を戻す。引かれていれば `409 already_opened`。
- `GET /v1/stickers/{id}`: 未登録は `404 unknown`(アプリはこれを「サーバー以前」と判断する。§6.3)。
- 回数制限(初期値、`wrangler.jsonc` の vars で変更可): 鍵ごとに 1分 60 リクエスト、`POST /v1/packs` は鍵ごとに 1時間 20 回。超えたら `429 slow_down`。

## 4.4 テスト(vitest、`@cloudflare/vitest-pool-workers`、ローカルの D1)

- `vectors.json` の全項目を Worker で組み立て、Rust と同じバイト列・署名の検証が通ること。
- 登録 → release → claim → 2人目の claim が `409 already_claimed` → 1人目の再送は OK。
- 他人の release(`not_yours`)、seq の不一致、ref の不一致、改ざんした署名、未来の時刻、nonce の再利用、時刻のずれ、`blocked`。
- cancel: claim 前なら戻る、claim 後は戻らない、二度目も OK。
- パック: 登録(全部か無しか、途中の1件が不正なら何も残らない)、枠の claim(同じ枠は1人だけ、同時に2人)、版の claim を伴う枠、`slot_taken` の再送の扱い、`GET …/slots`、cancel(引かれる前/後)。
- 回数制限の `429`。

---

# 5. Step 4: アプリの受け口(Rust、core)

## 5.1 `Referee` の形

今の `register(sticker_id, creator_sig)` / `release` / `claim` / `claim_slot(pack_id, slot, claimer_key)` を、サーバーに必要な情報が渡る形に変える(例):

- `register(&Creation)`、`release(&Transfer)`、`cancel_release(&Transfer)`、`claim(&Transfer)`。
- `register_pack(&PackRegistration)`(パック・版の `{creation, release}`・移す本物の release をまとめたもの)、`cancel_pack(pack_id)`。
- `claim_slot(pack_id, slot, Option<&Transfer>)`(版の claim を一緒に)、`claimed_slots(pack_id) -> Vec<u32>`。
- `status(sticker_id) -> Unknown | Held{holder} | Released`、`pack_known(pack_id) -> bool`。
- 失敗は理由の分かる型で返す: `Offline`(つながらない・タイムアウト・5xx)、`Rejected(code)`(`already_claimed`・`slot_taken`・`not_yours` など)、`Unknown`(404)。

`NoReferee` は今までどおり全部通す(`status` は `Unknown`、`claimed_slots` は空)。既存の呼び出し(`edition_pack::press` は版ごとに `register`+`release` を個別に呼んでいる)を、まとめて1回の `register_pack` に変える。

## 5.2 渡す・受け取る・刷る・開ける(決めたこと 1: つながらなければ失敗にして戻す)

- **Gift を送る**(`gift::transfer_gift`): ステッカーが**サーバー以前でなければ**、まず登録が済んでいること(登録待ちなら先に送る)。release が `Offline` / `Rejected` なら何も変えずにエラー。release が通ったあと端末の確定(`persist` や `commit`)に失敗したら、`cancel_release` を呼ぶ。届かなければ**取り消し待ち**に積み、取り消しが済むまでそのステッカーは渡せない(`pending_cancel` で拒否)。
- **Gift を受け取る**(`gift::receive_gift_with_referee`): `status` が `Unknown`(サーバー以前の本物、旧形式)なら claim せず「Not checked」として受け取る。登録済みなら `claim` が通ったときだけ確定。`already_claimed` は何も変えずにエラー。`Offline` は何も変えずにエラー(ファイルは残るので後でやり直せる)。
- **パックを刷る**(`edition_pack::press`): `register_pack` が通ったときだけ確定。確定に失敗したら `cancel_pack`、届かなければ取り消し待ち。
- **パックを開ける**(`edition_pack::open`):
  1. `pack_known` が偽(サーバー以前・登録されていないパック)なら、今までどおり `claim_slot` を呼ばずに開け、版は「Not checked」。
  2. 登録済みなら、`claimed_slots` で引かれた枠を端末の残りから除いてから抽選する。
  3. 選んだ枠を**枠の引き待ち**に記録してから `claim_slot`。`slot_taken` なら残りを合わせ直して引き直す(最大3回、利用者にはエラーを見せない)。`Offline` なら何も変えずにエラーだが、**枠の引き待ちは残し、次に開けるときは同じ枠で再送する**。通ったら確定し、引き待ちを消す。
- **ステッカーを作る**(`create_signed_sticker`、`library.rs` の2か所): **オフラインでも作れる**。`register` は**登録待ち**に積むだけにし、作成の処理では呼ばない(作成を止めない)。
- 渡す前の登録・取り消し待ち・登録待ちの送信は、つながったとき(起動時・窓にフォーカスが戻ったとき・操作の直前)にまとめて行う。**常時のポーリングはしない**。

## 5.3 DB V14

- 登録待ち(`referee_outbox`: 種類 `register` / `cancel_release` / `cancel_pack`、対象、本文の JSON、積んだ時刻、試行回数)。
- 枠の引き待ち(`pack_slot_pending`: `pack_id`、`slot_no`、transfer の JSON)。
- サーバー以前の印: ステッカー(`stickers` に `checked TEXT` = `pending` / `checked` / `pre_server`、複製は NULL)と、パック(`edition_pack_frames` などに `pre_server`)。列名・置き場所は既存に合わせて決めてよい。
- 移行(§6.3)が済んだかは `meta` の `server.migrated_at`。

---

# 6. Step 5: アプリの接続・移行・UI

## 6.1 `HttpReferee`(`src-tauri/src/referee.rs`、`#[cfg(feature = "server")]`)

- 接続先は定数1か所。開発用の `workers.dev` の URL(デプロイ後に分かる。Step 6)。開発者版だけ、環境変数 `PETA_API_URL` で上書きできる。
- §4.2 の署名を端末の鍵(`device_key::load_or_create`)で付ける。
- `gifts.rs` / `packs.rs` / `creator.rs` などの `NoReferee` を、`server` feature のときだけ `HttpReferee` にする(配布版のコードは変えない)。

## 6.2 失敗の文言(英語)

- `offline`: 「Connect to the internet to do this. Nothing was changed.」
- `already_claimed`: 「Someone already received this gift.」
- `pending_cancel`: 「Peta is still taking back an earlier send. Try again when you're online.」
- `clock_skew`: 「Check your Mac's date and time, then try again.」
- その他の拒否は短い一般的な文言 + 開発者版だけコードを表示。

## 6.3 サーバー以前のもの(決めたこと 4)

`server` feature で初めて起動したとき(`server.migrated_at` が無いとき)に1回だけ:
- **この端末の鍵で作り、一度も手放していない原本**(`transfers` が空、`pressed` でない、`lineage='real'`、作成証明が検証済み)→ `pending`(登録待ちに積む)。
- それ以外の本物(受け取った本物、旧形式の Gift、`pressed` の原本、版)→ `pre_server`。
- この時点までに刷った・受け取ったパック → `pre_server`。
- 移行後に作ったものは `pending` → 登録が通ったら `checked`。

## 6.4 最小限の UI(見た目の仕上げは別担当)

- Collection の詳細: 本物に `Checked by Peta` / `Not checked` / `Waiting to check`(登録待ち)を1行。
- 版の裏の「Edition numbers are not checked by a server yet」は、確認済みのパックでは出さない。
- Settings の開発者向け欄(開発者版だけ): 接続先、最後に通信できた時刻、登録待ち・取り消し待ち・枠の引き待ちの件数、「Sync now」。
- `tests/*.test.mjs`: 文言の対応表と、確認済み表示の分岐。

---

# 7. Step 6: 開発用へのデプロイ(できれば)

この Mac の Wrangler はオーナーがログイン済み(`npx wrangler@4.149.0 whoami` で確認)。**ログインできていない環境なら、この Step は飛ばし、コマンドを報告に書く**。

1. `npx wrangler d1 migrations apply peta-dev --remote --env dev`
2. `npx wrangler deploy --env dev`
3. 出てきた URL を §6.1 の定数に入れ、`GET /v1/health` を確かめる。
4. `docs/server-resources.md` に Worker の URL を追記する。

**`--env prod` には、マイグレーションもデプロイもしない。** オーナー向けの手順を `docs/server-howto.md` に書く(本番のマイグレーション・デプロイ・ログの見方・使用量の通知・D1 のバックアップ(Time Travel)・鍵の扱い)。

---

# 8. テスト(Rust)

- V13 → V14 のマイグレーション(既存データの保持)。サーバー以前の移行の分類(§6.3 の各ケース)。
- 偽の `Referee`(状態を持つメモリ上の審判)で:
  - 同じ Gift ファイルを2つのデータフォルダで受け取る → 1つ目だけ成功、2つ目は `already_claimed` で何も変わらない。
  - 送る: release の拒否・`Offline` で何も変わらない。release 後の保存失敗で `cancel_release` が呼ばれ、ステッカーは手元に残る。取り消しが届かなければ取り消し待ちに積まれ、そのステッカーは渡せない。
  - 刷る: `register_pack` の拒否で何も変わらない。確定失敗で `cancel_pack`。
  - 開ける: 引かれた枠を除いて抽選する、`slot_taken` で引き直す(3回で止まる)、`Offline` で何も変わらず枠の引き待ちが残る、次は同じ枠で再送する。
  - 作る: `Offline` でも作れ、登録待ちに積まれる。送信で `checked` になる。
  - サーバー以前の Gift(`status=Unknown`)は claim せずに「Not checked」で受け取れる。
- `HttpReferee` の署名: Step 1 の検証用データと一致すること(HTTP 自体はモックで)。

---

# 9. 受け入れ条件

- [ ] `cloudflare/peta-api/` の `npm test` が通る(検証用データの全項目を含む)。
- [ ] `cargo test --workspace`(既定と `--features developer` の両方)と `npm test` が通る。**既定ビルドに HTTP の依存が入っていない**(`cargo tree` で確認して報告に書く)。
- [ ] 開発者版の2つのデータフォルダで: A が作る → 登録される → A が Gift を保存 → B と C が同じファイルを受け取る → **B だけ**が受け取れる。
- [ ] 同じパックのファイルを B と C が開ける → 同じ枠は1人だけ、版の番号は全体で重複しない。
- [ ] オフラインでは送る・受け取る・刷る・開けるが失敗し、端末は元のまま。作るのはオフラインでもでき、つながると `Checked by Peta` になる。
- [ ] サーバー以前の Gift・パックは「Not checked」のまま扱える。
- [ ] 配布版(既定ビルド)の動きは今までどおり。
- [ ] `README.md`、`docs/decisions.md`(2026-10-12)、`docs/server-howto.md`、`docs/server-resources.md` が更新されている。
- [ ] 報告 `docs/archive/reports/server-s1-report.md` に、**作ったもの・本書と違う判断とその理由・守れないこと(改造したアプリが自分の台帳を偽ること、など)・オーナーがやること(本番のマイグレーションとデプロイ)・実機で確認する項目**を日本語で書く。

**実機でしか確認できないこと**(オーナーがやる): 2台の Mac での受け取りの取り合い、Wi‑Fi を切ったときの文言と元に戻ること、本番へのデプロイ。
