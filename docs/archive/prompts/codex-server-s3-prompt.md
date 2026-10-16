# Codex への依頼: サーバー S3(友達の Market)

**使い方**: この文書の全文を Codex に渡す。**実装の指示**(TypeScript・Rust・JS/CSS)。作業は **Step 順**。各 Step の終わりに `cargo test --manifest-path src-tauri/Cargo.toml --workspace`(既定と `--features developer`)、`npm test`、`cloudflare/peta-api/` の `npm test` と `npm run check` を通し、**Step ごとにコミット**する(Worker・core・アプリ・UI は別コミット)。

> 日本語で指示。コード中のコメントと UI の文言は、既存に合わせて**英語**。説明文書は日本語。

**読む順**: [`docs/server-s3-market-plan.md`](../../server-s3-market-plan.md)(**仕様の本体。必ず最初に全部読む**。§9 は 2026-10-13 にすべて推奨どおりに決定済み)→ [`docs/server-plan.md`](../../server-plan.md)(S1・S2 の全体)→ [`docs/archive/reports/server-s1-report.md`](../reports/server-s1-report.md)・[`docs/archive/reports/server-s2-report.md`](../reports/server-s2-report.md)・[`docs/server-howto.md`](../../server-howto.md)(作ったもの)→ [`docs/archive/reports/local-market-report.md`](../reports/local-market-report.md)(この Mac の出品)→ `docs/decisions.md`(サーバー・唯一性・Pack の版・Scraps の経済の行)。食い違ったら**本書と現行コード**を優先し、報告に書く。

**前提**: S1(審判役)と S2(友達・受信箱)は実装済みで dev にデプロイ済み。本番は未デプロイ。最新のアプリ DB は V16、Worker の migration は 0002。

---

# 0. 範囲

## やること

1. **検証用データ**(Rust): 出品・引く・封筒・暗号文を固定鍵で作り、Worker のテストが読む。
2. **Worker**: 出品(R2 に暗号文)・封筒・友達だけの一覧・引く(枠の claim と売上を1つの batch)・精算・退会の拡張・出品したパックの無料開封の拒否・通報の種類。開発用へデプロイ。
3. **アプリの DB V17** と Scraps の支払い・受け取り(core)。
4. **アプリの通信**(`server` feature): 出品のアップロード、封筒の付け外し、一覧の同期、引く、精算。
5. **UI**: Market の友達のレール・カード・引く・空とオフラインの表示、My shelf の出品・一時停止・販売終了・入った Scraps。
6. ドキュメント: 報告 `docs/archive/reports/server-s3-report.md`、運用手順・プライバシーポリシー下書き・decisions・チェックリストの追記。

## やらないこと

- **Scraps のサーバー管理**(残高は端末のまま。設計書 §1 の案B)。
- **公開カタログ・全体の検索・人気順**。友達以外に出品を見せる API。
- まとめて引く(10連)、Drop / First day、売り手が値段を選ぶこと、見本3枚を売り手が選ぶこと。
- 未開封の「引く権利」を買って取っておくこと(買う = その場で1枠を引く)。
- 課金・広告・換金。
- **本番(`--env prod`)の R2 作成・migration・deploy**(オーナーが行う)。配布版で `server` を有効にすること。
- 公開前確認で見つかった S3 と関係のない課題(公式鍵の差し替え、CSP、鍵の復元の途中失敗、OS のユーザー名を初期の表示名に使うこと、など)。**別の依頼で扱う**ので、気づいたことは報告に書くだけにする。

---

# 1. 共通ルール

- 作業前に、上の「読む順」の文書と、`src-tauri/crates/core/src/{scraps.rs,edition_pack.rs,ownership.rs,server.rs,identity.rs,friends.rs,db.rs,pack.rs}`、`src-tauri/src/{referee.rs,referee_access.rs,inbox.rs,packs.rs,lib.rs,store.rs}`、`cloudflare/peta-api/{src/index.ts,src/inbox.ts,src/proofs.ts,migrations/0001_ledger.sql,migrations/0002_inbox.sql,wrangler.jsonc}`、`src/app/js/{market.js,packs.js,library-pages.js,settings.js,shell.js,bridge.js}` を読む。
- **アプリのスキーマ変更は V17 だけ**(V1〜V16 の SQL は変えない。V16 → V17 のマイグレーションテスト)。Worker は `migrations/0003_market.sql` だけ(0001・0002 は変えない)。
- **暗号は自作しない**。S2 で入れた crate を使う: 内容鍵での封は `chacha20poly1305`、封筒は `identity::seal` / `identity::open`(HPKE)。新しい crate を足すなら版と理由を報告に書く。
- **サーバーは中身を読めない**: カードとパックは端末で封じてから送る。内容鍵をサーバーへ送らない。Worker・ログに内容・内容鍵・IP を出さない。
- 既存の決まりは変えない: PETAPACK v2 の署名と検証、版の作成証明・release/claim、`pack_slot_pending` の「応答がなければ同じ枠・同じ署名で再送」、`slot_taken` の自動引き直し(3回)、自分のパックは開けない、Gift v3、S1・S2 の API と応答。**出品していないパックのファイルでの無料開封は今のまま**。
- 通信はすべて `server` feature の中(配布版にはコードも依存も入れない)。配布版の Market・Packs・Scraps の動きは今までどおり。
- S1 の署名つきリクエスト(`X-Peta-Key` など、データを変えるリクエストだけ nonce を記録)をそのまま使う。JSON は camelCase。
- 数字は Rust と Worker の両方で定数にする(どちらも**仮の初期値**。Worker は `vars` で上書きできるように): 値段 `6`、取り分 `700`‰、1人1日に引ける回数 `20`、売り手1人の出品 `10`、カード `1 MiB`、パックは既存の `24 MiB`。
- 変更したルールは `README.md` と `docs/decisions.md`(作業日)に追記。実機確認が要る項目は `docs/port-spec/macos-checklist.md` に追記。

---

# 2. Step 1: 検証用データ(Rust)

S1 の `vectors.json`・S2 の `vectors-s2.json` と同じやり方で、固定鍵から `cloudflare/peta-api/test/vectors-s3.json` を作る Rust のテストを足す。

- 出品の登録本文(`listingId, packId, price, cardDigest, cardSize, packDigest, packSize`)と、その署名つきリクエストのバイト列。
- 引く本文(`slot, claim, price`)。`claim` は版の枠と景品の枠(`null`)の両方。
- 封筒: 固定の内容鍵を、固定の X25519 公開鍵へ `identity::seal` で封じたもの(context は `peta.market.key.v1` + `listingId`)。Worker は開けないので、**Worker のテストは形と大きさだけ**を見る。復号できることは Rust のテストで確かめる。
- 暗号文: カードとパックを内容鍵で封じた形式(下の §3.2)。SHA-256 と大きさが登録本文と一致すること。

---

# 3. Step 2: Worker

## 3.1 D1(`migrations/0003_market.sql`)

設計書 §6.1 のとおり: `market_listings`・`market_envelopes`・`market_sales`・`market_payout_marks`。

- `market_listings.pack_id` は UNIQUE で、`packs(pack_id)` を参照。`state` は `draft` / `open` / `paused` / `closed`。`closed` でも行を消さない。
- `market_sales` は `UNIQUE(pack_id, slot_no)` と `UNIQUE(pull_id)`。索引は(`seller_key`, `sale_id`)と(`buyer_hash`, `at`)。
- `market_envelopes` の索引は `recipient_hash`。
- `assertions` のトリガーに `for_sale`・`not_friend`・`listing_closed`・`price_changed`・`pull_used`・`too_many_pulls`・`sold_out`・`own_pack` を足す(0001 のトリガーは変えられないので、**0003 でトリガーを作り直す**: `DROP TRIGGER assert_ledger` → 全コードを含めて `CREATE`)。

## 3.2 R2 と暗号文の形式

- binding `MARKET`(dev: `peta-market-dev`、prod: `peta-market-prod`)。キーは `market/{listingId}/card` と `market/{listingId}/pack`。**Gift のバケット(7日で消える)には置かない**。
- 暗号文の形式: `"PETAMKT1"`(8バイト)+ nonce(12バイト)+ ChaCha20-Poly1305 の暗号文。追加データは `peta.market.v1` + `listingId` + `card` または `pack`。
- `listingId`・`pullId` は端末で作る16バイトの乱数の base64url。

## 3.3 API

設計書 §6.2 の表をそのまま実装する。補足:

- **相互の許可**: 売り手の受信箱(`mailboxId(sellerKey)`)の `mailbox_allow` に買い手の `keyHash`、買い手の受信箱の `mailbox_allow` に売り手の `keyHash` の両方があること。どちらかの受信箱がなければ `not_friend`。
- **一覧**(`GET /v1/market/listings`): 自分宛ての封筒があり、相互の許可があり、`open` か `paused` の出品だけ。`sellerHash` を返し、生の鍵は返さない。最大100件。`slotsLeft` は `slot_count` − 引かれた枠の数。
- **引く**(`POST /v1/market/listings/{id}/pulls/{pullId}`): 次をすべて**1つの D1 batch**で確かめて確定する。出品が `open`・相互の許可と封筒・買い手が売り手でない・`price` が出品の値段と一致・**過去24時間の自分の `market_sales` が上限未満**・枠が空いている(または同じ `pullId`・同じ枠・同じ claim 署名の再送)。確定するのは、S1 と同じ枠の claim と版の transfer、`market_sales` の1行。既存の `claimSlot` の中身を関数に分けて共有し、S1 の規則(`ref` は `{packId}:slot-{n}`、版の claim の検証、`slot_taken`)を変えない。
  - 同じ `pullId` で、別の枠・別の買い手・別の署名は `409 pull_used`。全部の枠が引かれていれば `409 sold_out`。
  - 応答は `{saleId, slotsLeft}`。
- **既存の枠の claim**(`POST /v1/packs/{id}/slots/{n}/claim`): `market_listings` に行があるパックは `403 for_sale`(`closed` でも)。
- **出品**: 登録は「この鍵で S1 に登録済みのパック」だけ(`packs.creator_key`)。`open` にするのは、R2 の2ファイルが揃っていて SHA-256 と大きさが一致するときだけ。
- **アップロード**: `PUT .../card` と `.../pack` は、`route()` の本文の上限をこの2つだけ広げる(カード 1 MiB、パック 24 MiB、それぞれ形式の頭の分を足す)。Worker の中で SHA-256 を計算して登録と照合し、合わなければ R2 から消して `400 digest_mismatch`。
- **封筒**: `to` は売り手の `mailbox_allow` にある鍵のハッシュだけ。1回200件まで。`sealed` は base64 で 512 バイトまで。
- **精算**: `GET /v1/market/payouts?after=` は認証した売り手の分だけで、`acked_upto` と `after` の大きい方より後を最大200件返す。`POST /v1/market/payouts/ack` は印を進めるだけ(戻さない)。
- **退会**(既存の `DELETE /v1/mailbox/{id}`): 自分の出品を `closed` にして R2 を消し、自分宛ての封筒を消す。売上の行は消さない。
- **通報**(既存の `POST /v1/report`): `kind: "listing"` と `listingId` を受け付ける。保存のしかたと Webhook は S2 と同じ。
- 運営の拒否(`blocked_keys`)の鍵は、出品・引く・一覧のすべてで `403 blocked`。

## 3.4 テスト(vitest)

- 検証用データの全項目。
- 友達でない鍵・一方だけの許可・封筒のない鍵は、一覧にも出ず、カードもパックも取れず、引けない。
- 2人が同じ枠を同時に引く → 1人だけ。売上の行の数と引かれた枠の数が一致する。
- `pullId` の再送で二重に売上が入らない。`pull_used`・`sold_out`・`price_changed`・`own_pack`・`too_many_pulls`。
- 出品したパックへの既存の枠の claim が `for_sale`。出品していないパックは今までどおり。
- アップロードの digest の不一致、大きさの超過、2ファイルが揃う前の `open` の拒否。
- 精算: `after` と `ack` の組み合わせで、同じ売上が二度返らない。他人の売上は見えない。
- 退会で R2 と封筒が消え、売上の行は残る。

---

# 4. Step 3: アプリの DB V17 と Scraps(core)

## 4.1 DB V17

設計書 §7.1 のとおり: `market_my_listings`・`market_listings_seen`・`market_packs`・`market_pulls`、`meta` の `scraps.market.upto` と `scraps.market.remainder_milli`。

- V14 の `pack_market_listings`(この Mac での表示)は残す。友達への出品は `market_my_listings` に持ち、出品・一時停止・販売終了で両方を同じトランザクションで更新する。
- 内容鍵は `market_my_listings.content_key` に持つ(出品ごとの乱数)。

## 4.2 Scraps

- `scraps::Kind` に `Pull`(払う)と `Payout`(受け取る)を足す。今の `trade` と同じく、残高・記録・レシート(`scraps.tx.*`)を1つのトランザクションで確定する。
- **引く**: 残高から値段を引き、`market_pulls` に `pending`(`pullId`・出品・パック・枠・値段・claim の transfer)を入れる。これを1つのトランザクションで行う。残高が足りなければ何も変えずに断る。
- **返金**: `market_pulls` を `refunded` にし、残高を戻す。これも1つのトランザクション。`done` と `refunded` は二度と変わらない。
- **精算**: 受け取った売上の `cutMilli` を `remainder_milli` に足し、1000 ごとに 1 Scraps を残高へ入れる。`upto` を最後の `saleId` にする。すべて1つのトランザクション。端末の `upto` 以下の売上は足さない。
- 開発者版は今と同じく払わない(`market_pulls` は値段 0 で記録する)。受け取りは開発者版でも行う。

## 4.3 引く経路と審判役

- `ownership::Referee` に `purchase(listing_id, pull_id, slot, claim, price)` を足す。`NoReferee` は `Offline`。
- `edition_pack` に「Market で引く」関数を足し、`claim_slot` の代わりに `purchase` を呼ぶ。枠の選び方・`pack_slot_pending`・`slot_taken` の引き直し(3回)・Collection への追加は今の `open` / `open_row` を共有する。
- 拒否ごとの扱い(設計書 §3.2):
  - `slot_taken` → 払いはそのままで、同じ `pullId` で別の枠。3回だめなら返金。
  - `not_friend`・`listing_closed`・`price_changed`・`sold_out`・`own_pack`・`too_many_pulls`・`blocked` → 返金。
  - `Offline`・タイムアウト・5xx → `pending` のまま。次は同じ枠・同じ署名で再送する。
  - `200` の後に Collection への確定が失敗 → `pending` のまま。再送の `200` で確定し直す。
- **出品したパックのファイルでの開封**: `for_sale` が返ったら何も変えずに断る。
- **カード**: `market` モジュール(新規)で、自作パックからカードを作る。中身は、題名・説明・包み・表紙・飾り・デザインと景品の一覧(版の数)・見本の絵3枚・パックヘッダの SHA-256。**作者名は入れない**(買い手の端末が、友達一覧の名前で表示する)。見本は版の数の少ない順に並べ、**一番少ないもの(いちばんレア)を除いて**最大3枚選ぶ。デザインが3つ以下なら全部見せる(仮の規則。報告に書く)。
- **パックの受け取り**: 取ってきたパックは、今の PETAPACK v2 の検証を通したうえで、次の2つを確かめる。カードの SHA-256 とヘッダが一致すること。署名した作者の鍵が、出品の売り手(友達一覧の鍵)と一致すること。通ったものだけを `market_packs` に入れる。**Packs の棚には出さない**。

## 4.4 テスト(状態を持つ偽の審判)

設計書 §8 の受け入れ条件の「偽の審判で」の項目をすべて。加えて、V16 → V17 のマイグレーション。カードの作成と封・開封の往復(別の内容鍵では開けない)。パックの作者と売り手の不一致の拒否。

---

# 5. Step 4: アプリの通信(`server` feature)

- `referee.rs` の HTTP クライアントに、設計書 §6.2 の Market の API を足す。HTTP 中は Library の mutex を持たない(S1・S2 と同じ)。同期の IPC は Tauri の async で実行する。
- IPC: `market_friend_listings`、`market_card`、`market_pull`、`market_list_pack`、`market_pause_pack`、`market_close_pack`、`market_payouts_sync`。
- **出品**: 内容鍵を作る → カードとパックを封じる → 登録(`draft`)→ 2つをアップロード → 封筒を付ける → `open`。途中で失敗したら `draft` のまま残し、次の同期で続きから進める。同じ出品の再送は冪等にする。
- **封筒の付け外し**: `status=friend` で `enc_public_key` がある友達全員に付け、それ以外から外す。契機は、起動・フォーカス復帰・Market を開いたとき・友達の承認/Remove/Block の後。
- **一覧**: `market_friend_listings` は、サーバーの一覧を `market_listings_seen` に保存してから返す。オフラインのときは保存済みの一覧に `offline: true` を付けて返す。カードは `cardDigest` が変わったときだけ取り直す。
- **精算**: 一覧と同じ契機で `GET payouts` → 端末で確定 → `ack`。入った Scraps があれば、今の Scraps の知らせと同じ扱いで知らせる。
- 常時ポーリングはしない。

---

# 6. Step 5: UI

設計書 §2.3 と §7.3 のとおり。

- Market の Packs: 同梱の公式パックの棚はそのまま。その下に**友達ごとのレール**(`From {name}`)を出し、レールと吊りクリップは今の部品を使う。袋の下は `6 Scraps` と `12 of 30 left`(売り切れは `Sold out`)。一時停止中は `Back soon`。
- ズームしたカード: 友達の名前・題名・説明・見本3枚(今の「A peek inside」の部品)・デザインと景品ごとの残り・`Costs 6 / Scraps after N`・`Pull one — 6 Scraps`。
- 引いた後は、今の1枚開封の演出と「Stick it」/「Keep in Collection」をそのまま使う。
- 空の状態とオフラインの文言、失敗の文言は設計書 §2.3・§7.3 のとおり。
- My shelf の自作パック: `Show to friends in Market`(アップロード中は進み具合)・`Take down`(一時停止)・`Stop selling`(販売終了。確認のシートで「Friends can't pull from it anymore. Stickers already pulled stay with them.」)。売れ行きに `Earned N Scraps` を足す。
- 配布版(`server` なし)では友達のレールを出さない。今の「On this Mac」の出品はそのまま。
- 文字列は既存の安全な描画(`h()`)だけを使い、カードの題名・説明を HTML として扱わない。
- JS のテスト: 空・オフライン・売り切れ・一時停止・引く途中の連打・返金の表示・`for_sale` の文言・配布版で友達のレールが出ないこと。

---

# 7. Step 6: 開発用へのデプロイ(できれば)

この Mac の Wrangler はオーナーがログイン済み(`npx wrangler@4.149.0 whoami` で確認)。**ログインできていない環境なら、この Step は飛ばしてコマンドを報告に書く**。

```sh
cd cloudflare/peta-api
npx wrangler@4.149.0 r2 bucket create peta-market-dev
# wrangler.jsonc の dev と prod に MARKET の binding を足す(prod のバケットはオーナーが作る)
npx wrangler@4.149.0 d1 migrations apply peta-dev --env dev --remote
npx wrangler@4.149.0 deploy --env dev
```

デプロイ後に `/v1/health` が 200 を返すことを確かめる。テスト用の鍵で、出品 → 封筒 → 一覧 → 引く → 精算の往復を dev で1回行う。終わったらテストの出品を `DELETE` して R2 を空にする。**prod には触らない**。

---

# 8. Step 7: ドキュメント

- `docs/server-howto.md`: `peta-market-prod` の作り方、`0003` の適用、R2 の使用量通知、`vars` の上限の変え方、出品の通報の見方、運営が出品を止める方法(`wrangler d1 execute` で `state='closed'` と R2 の削除)。
- `docs/server-resources.md`: R2 バケットの追加。
- `docs/privacy-policy-draft.md`(日本語と英語): S3 で増える取得情報(売上の行の鍵のハッシュ・時刻・値段、封筒の宛先の鍵のハッシュ)、受け取らないもの(出品の中身・内容鍵)、保存期間(出品をやめたら R2 と封筒はすぐ消す、売上の行は台帳として残る)。**法的な判断はオーナーが専門家と行う下書き**であることは冒頭のまま。
- `docs/server-plan.md`: 作業表の「S3 公開」を「S4」に直し、段階3の節を設計書へのリンクにする(**オーナーが先に直していればそのまま**)。
- `docs/decisions.md`、`README.md`、`docs/port-spec/macos-checklist.md`。
- 報告 `docs/archive/reports/server-s3-report.md`: 作ったもの(Step ごとのコミット)、選んだ crate と版、本書と違う判断とその理由、守れないこと(**改造したアプリが払わずに引くこと**、端末の残高の書き換え、友達が取ってきたパックのファイルを他の人へ渡すこと(開封は `for_sale` で止まる)、など)、オーナーの作業(本番の R2 作成・migration・deploy)、実機で確かめる項目、公開前確認の課題で気づいたこと。

---

# 9. 受け入れ条件

- [ ] すべてのテスト(Rust 既定と developer、JS、Worker と `npm run check`)が通る。**配布版に通信の依存が入っていない**(`cargo tree` で確認して報告に書く)。
- [ ] V16 → V17 のマイグレーションで既存のデータ(この Mac の出品を含む)が保たれる。
- [ ] 偽の審判で、設計書 §8 の「引く」「精算」「自分の出品」「ファイルからの開封」の項目がすべて通る。
- [ ] 開発者版の3つのデータフォルダ(A・B・C)で: A と B は友達、C は A の友達でない。A が出品 → **B にだけ見え、C には見えない**(C が出品 ID を知っていても、取得も引くことも断られる)。B が引く → B の残高が 6 減り、版が Collection に入る → A の売れ行きに B の名前が出て、精算で Scraps が入る(5回で 21)。A が B を Remove → B の一覧から消え、引けない。B がすでに引いた版は手元に残り、Gift で渡せる。
- [ ] 同じ出品を B と D(A の友達)が同時に引く → 同じ枠は1人だけで、版の番号は全体で重複しない。売上の行と引かれた枠の数が一致する。
- [ ] オフラインでは引く・出品が失敗し、端末は元のまま(残高も)。`pending` の再送で二重に払わない。返金で残高が元に戻る。
- [ ] R2 のカードとパックが暗号文で、D1 に内容鍵がない。
- [ ] 出品したパックのファイルを開くと `for_sale` で何も変わらない。出品していないパックのファイルは今までどおり開ける。
- [ ] 配布版(既定ビルド)の Market・Packs・Scraps の動きは今までどおり。
- [ ] 報告 `docs/archive/reports/server-s3-report.md` と、運用手順・プライバシーポリシー下書き・decisions・チェックリストの追記がある。

**実機でしか確認できないこと**(オーナーがやる): 2〜3台の Mac での出品 → 引く → 精算、Wi‑Fi を切ったときの文言と返金、24MB 近いパックのアップロードとダウンロードの時間、友達の Remove/Block の後の見え方、本番へのデプロイ。
