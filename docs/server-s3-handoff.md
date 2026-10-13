# S3 友達のMarket — Claudeへの引き継ぎ

2026-10-13。Codex が Step 2 まで実装して Claude へ引き継ぎ、**Claude が Step 3 を実装・コミットして停止**(ユーザーの指示で、Step 4 以降は別のチャットへ引き継ぐ)。**S3 全体は未完了。Step 4 から再開する。** Step 3 の内容は下の「Step 3 の実装(Claude)」。

## 最初に読むもの

1. `docs/server-s3-market-plan.md` 全文（仕様本体）
2. `docs/codex-server-s3-prompt.md` 全文（Step順・各Stepで検証とコミット）
3. この引き継ぎと `docs/server-s3-report.md`
4. 依頼書の読む順にある既存S1/S2の文書とコード

ユーザーは**App Storeへ出さない**と決定している。配布方式に関する決定として扱う。S3と関係のない公開前確認の問題（公式鍵・CSP・identity復元の途中失敗・OS名の初期表示）は、依頼書どおり今回修正しない。添付依頼書はユーザーから実行を明示された。

## 現在地

| Step | 状態 | コミット |
| --- | --- | --- |
| 1 Rust検証データ | 完了 | `5a5f8f5` |
| 2 Worker | 完了、ローカル検証済み。dev未デプロイ | `5e6ffc9` |
| 3 core V17・支払い・精算・カード・購入経路 | **完了**。全系統のテスト済み | `825aa71` |
| 4 アプリ通信・IPC・同期 | 未着手 | — |
| 5 UI | 未着手 | — |
| 6 dev bucket・migration・deploy・実API往復 | 未着手 | — |
| 7 正式なS3文書更新 | 未完了。この引き継ぎと途中報告のみ | — |

ブランチは `codex/ui-fixes-oct07`。元HEADは `0db8d95`。アプリDBは **V17**(Step 3)。既定版・Developer版のアプリのS3 UI/通信はまだ存在しない。Workerの新migrationはローカルテストでのみ適用された。`wrangler whoami` もまだ実行していない。

## Step 1の実装

- 新規 `src-tauri/crates/core/src/market.rs` を `lib.rs` から公開。
- 値段6、取り分700‰、20 pulls/day、10 listings、card 1 MiB、pack 24 MiB、暗号化の追加36 bytesの定数。
- 出品ID/pull IDは16 bytes乱数のbase64url（22文字）。内容鍵は32 bytes OS乱数。
- `seal/open`: `PETAMKT1 | nonce(12) | ChaCha20-Poly1305 ciphertext`、AADは `peta.market.v1 + listingId + card/pack`。
- `envelope/open_envelope`: S2のHPKEで内容鍵を包む。contextは `peta.market.key.v1 + listingId`。
- `cloudflare/peta-api/test/vectors-s3.json` と `vectors-s3.test.ts`。Rustの登録・edition/prize pull本文、署名bytes、暗号文digest・size・HPKE envelopeを共有。
- HPKEは乱数を使うため、fixture内の封筒を通常テストで復号して検証。明示した `PETA_WRITE_VECTORS=1` でのみ再生成する。固定seed・nonceは**テスト専用**。
- カードの実際の作成・パック検証・DB処理はまだ `market.rs` にない。

## Step 2の実装と注意

- `cloudflare/peta-api/migrations/0003_market.sql`: 4つのMarket表、assertion trigger拡張、reportsのkind/listing_id。0001/0002は変更していない。
- `src/market.ts`: 登録、暗号文upload、封筒add/remove、open/pause/close、友達限定一覧・download、purchase、payout/ack、leave。
- 一覧は `sellerHash` を返す。買い手は相互の許可・自分宛ての封筒・open/paused・売り手非blockedを満たす必要がある。
- `seller_hash` をD1出品行に追加した。サーバーが公開鍵から導出する。100件一覧の相互許可確認を1つのSQLにするための補助列で、クライアント申告は使わない。
- 最大200件の封筒更新を `json_each` のbulk SQLで処理し、件数に比例してD1 statementsを増やさない。
- `index.ts::slotClaimStatements` をS1とMarketで共有。Marketはassertions・slot update・edition transfer・saleを**同じD1 batch**で確定する。24時間の回数制限も同じbatch。
- 同じpull ID/買い手/slot/claim署名/priceは売上を増やさず200。他の内容はpull_used。戻るsaleIdは既存のもの、slotsLeftは現在の残数。
- **確定済みpurchaseの正確な再送は、close・友達解除・後の運営Blockがあっても復旧可能**。通常の認証からpull pathだけをblock検査の例外にして、Marketのbatchで「正確な再送、または買い手・売り手が非blocked」を検査する。新しい購入はblockedで拒否。
- 一度出品したpackはclosed後も無料claimを拒否。汎用sticker cancel・pack cancelにも同じfor_sale guardを追加し、別経路から版を取り出せないようにした。
- closeはD1をclosedにしてからR2を消す。uploadはput後にclosedを再確認し、遅れて届いたuploadの残骸を消す。
- payoutは売り手本人のsalesのみ。`MAX(after, acked_upto)` より後を200件、ackは後退不可かつ本人の最大saleIdを超えられない。
- listing reportは `{kind:"listing", listingId, senderHash, reason, card:base64, pack?:base64}`。S2 Gift reportも維持。真偽の自動検証は既存と同様なく、運営の確認が必要。
- 大きいpack/reportを扱うため、`proofs.ts::base64` をchunkで変換し、大配列のspreadによるスタック超過を防ぐ。
- wranglerのdev/prodにMARKET bindingと上限varsを追加しただけ。**どちらの実バケットもこの作業では作成していない。リモートmigration/deployもしていない。**
- **仕様の整合に注意**: planには「鍵だけ復元したら新しい内容鍵で出し直す」とある一方、pack_idはUNIQUE・closedも残す指定。現実装は1 packにつき1 listingを維持し、closedの別listingへの再登録をtakenで拒否する。一時停止→openは可能。Step 4の鍵だけ復元時の扱いは、この矛盾を報告して解決する必要がある。closedを無断で削除・再利用して販売制限を消さない。

## Step 3の推奨設計（Codexのメモ。実装済み。実際の形は次の節）

最重要は**Library mutexもSQLite transactionも持たずにHTTPを行う**こと。既存 `edition_pack::open_row` はネットワーク呼び出しを含むので、そのままMarket用Refereeへ置き換えない。

1. Library lock内でprepare。値段・実際のdebited額（Developerは0）・pull ID・slot・完全な署名済みTransfer・attempt countを保存し、Scraps debitとpendingを同じIMMEDIATE transactionでcommit。
2. unlockして `Referee::purchase(listing, pull_id, slot, claim, price)` を送る。
3. relockして、既存award mutationと `market_pulls=done` を同じtransactionでcommit。保存したaward JSONをreceiptとして繰り返しfinishでも同じ結果を返す。

推奨API: `prepare_market_pull` / `pending_market_pull` / `finish_market_pull` / `market_pull_slot_taken` / `refund_market_pull`。`PurchaseAttempt` と `PurchaseAck` を定義し、`NoReferee::purchase` はOffline。

- `edition_pack.rs` の現在の `open_row` のaward mutation（sticker/material/tag、provenance、イベント、queue、残数）をprivate helperへ抽出し、通常開封とMarket確定で共用する。既存S1開封規則を変えない。
- V17は追記のみ。`market_pulls` には仕様の列に加えてquoted_price/debited/attempt/sale_id/slots_left/award_json/failure_codeを持たせると復旧が可能。1 packにつきpendingを1件にするpartial unique indexを推奨。
- `slot_taken` は同じpull ID・同じ払いのまま別slotへ。attemptを永続化し、3回でpendingの消去と返金を同時commit。
- Offline/timeout/5xxはexact pendingを保持。確定的な未購入拒否は返金。200後のローカルcommit失敗でもpendingを保持し、次に同じ署名で再送する。
- **既存pendingの再送では、購入前の一覧取得等がblock/解除で拒否されても先にpurchaseを再送する**。Workerの200再送例外を使わずにblocked/not_friendで返金すると、リモート確定済みの版を失う。
- Pull/Payoutを通常の `scraps::trade` から任意に呼べるようにしない。Marketの検証済み処理だけが残高を変更する。
- payoutはreceiptとuptoと端数を同時commitしてからHTTP ack。5×4200 milliで21 Scraps。upto・receiptで二重計上を止める。
- `market_packs` はhidden packのcapability marker。検証済みPETAPACK v2のinstallとmarkerを同じtransactionにする。`Database::packs()` (`db.rs`約940行) に除外条件を追加し、通常/free開封も拒否する。既存の同IDの未marked shelf packは無断で隠さず衝突を拒否。
- カードはprompt優先で**作者名なし**。header digestとsigned pack/seller keyを照合。planの作者名入り記述よりpromptを優先。見本の選び方はpromptの「枚数が少ない順・最少を除く・3デザイン以下なら全部」を使う。

必須テスト: V16→V17既存データ保持、debit/pendingの故障注入rollback、連打debit一回、再起動exact retry、3衝突で払い一回/返金一回、200後commit失敗からの復旧、done再確定一回、prizeとedition、payout二重計上/端数、作者不一致と改変カード拒否、hidden packの通常/free開封拒否。

## Step 3 の実装(Claude、`825aa71`)

変更は core だけ(`db.rs`・`scraps.rs`・`edition_pack.rs`・`ownership.rs`・`market.rs`)。アプリ(`src-tauri/src`)・UI・Worker は触っていない。

- **DB V17**(`db.rs`): `market_my_listings`(内容鍵・状態・登録/アップロードの進み具合)、`market_envelopes_sent`、`market_earned`(外部パックIDごとの取り分)、`market_listings_seen`(友達の出品・内容鍵・カードのファイル)、`market_packs`(引く専用のパックの印)、`market_pulls`(+ pending は1パック1件の部分一意索引)。`Database::packs()` は `market_packs` を除外。V16→V17 のテストあり。
- **Scraps**(`scraps.rs`): `Kind::Pull` / `Kind::Payout` を追加。**通常の `trade` からは拒否**し、`market_move`(呼び出し側のトランザクション内、レシートは `scraps.tx.pull-* / refund-* / payout-*`)だけが動かす。
- **審判役**(`ownership.rs`): `PurchaseAck {saleId, slotsLeft}` と `Referee::purchase(listing, pull, slot, claim, price)`(既定は Offline)。Market のエラー文言を `RefereeError` の表示に追加。
- **開封の共通化**(`edition_pack.rs`): `open_row` の中身を入れる処理を `award_in` に切り出し、S1 の開封と Market の確定で共有(既存の動きは不変)。`install_with` で印を同じトランザクションに入れる。`ensure_can_open` は引く専用パックを `market_pack` で拒否。出品済みパックの `for_sale` では S1 の `pack_slot_pending` を消して返す。`Award` に Deserialize。
- **`market.rs` の公開 API**(Step 4 で使う):
  - 売り手: `prepare_listing(lib, pack_id)`(自作の完成パック・サーバー以前でない・取り消し待ちでない。カードとパックを封じて `<root>/market/outbox/` に保存。再実行で同じ draft を返す。closed は再出品不可)、`Listing::registration()`(登録本文)、`upload_bytes(lib, listing, "card"|"pack")`、`record(lib, listing, Progress::{Registered,CardUploaded,PackUploaded,Open,Paused,Closed})`(Open/Closed で outbox を消す。Open/Paused/Closed は V14 の `pack_market_listings` にも反映)、`envelope_changes(lib, listing)`(`status=friend` で暗号鍵のある友達に付け、それ以外から外す。200件まで。`.body()` が Worker の本文)→ 成功後 `envelopes_sent`、`listing` / `listings`。
  - 買い手: `store_seen(lib, &[RemoteListing])`(承認済みの友達の出品で封筒が開けるものだけ保存。カードを取り直すべき出品IDを返す)、`store_card(lib, listing, sealed)`、`seen(lib)`(UI 用。友達の名前つき)、`install_pack(lib, listing, sealed)`(digest・カードの packDigest・ヘッダの外部ID・**署名者 = 売り手**を確認して引く専用で入れる)、`market_pack`、`is_market_pack`、`card_taken(card, claimed)`。
  - 引く: `pull(store: &impl Locked, referee, pack_id, unrestricted, date, queue)`。`Locked::with` の間だけ Library を触り、**HTTP はその外**。内部は `exclude_slots` → `prepare_pull`(残高を減らす + pending を1トランザクション、pending があればそれを再開)→ `send`(`slot_taken` は同じ払いで別の枠・3回で返金、`not_friend` / `listing_closed` / `price_changed` / `sold_out` / `own_pack` / `too_many_pulls` / `blocked` / `invalid` / 404 は返金、それ以外は pending のまま)→ `finish_pull`(二度目は保存した Award を返す)。同期で再送するには `pending_pulls(db)` を `send(..., queue=false)` に渡す。
  - 精算: `payout_cursor(db)`(次の `after`)、`apply_payouts(db, &[Sale])`(取り分・端数・upto・`market_earned` を1トランザクション)。**ack の HTTP は呼び出し側**が `apply_payouts` の後に送る。
- 仮に決めたこと: 見本は版の数の少ない順で一番少ないものを除き最大3枚。カードが 1MiB を超える見本の絵は入れない(縮小はしていない)。カードに作者名は入れない(ただし署名済みパックのヘッダには `author` がある)。
- テスト(core 239 / developer 241): 友達だけに封筒、カードとパックの改ざん・作者の不一致の拒否、引く専用パックが棚に出ず無料開封できない、1回だけ払う、応答なし→同じ pull の再送、再起動後の再送、`slot_taken` で同じ払いのまま移る・3回で返金、最終拒否の返金と clock_skew の保留、debit と pending の故障注入、`done` 更新の故障注入からの復旧、景品の枠、精算の二重計上なし・端数、`trade` から Pull/Payout を拒否。
- 全系統: Rust 既定(app 11 / core 239 / original_management 5 / CLI 1)、developer(app 14・1 ignored / core 241 / 5 / 1)、JS 187、Worker 50、`npm run check`、`git diff --check` 成功。既定版の `cargo tree -e normal` に ureq / rustls / reqwest なし。

### Step 4 で最初にやること

1. `src-tauri/src/referee.rs` の `HttpReferee` に `purchase` を実装(`POST /v1/market/listings/{L}/pulls/{pullId}`、本文 `{slot, claim, price}`、応答 `{saleId, slotsLeft}`)。Market 用の GET/PUT/POST/DELETE(一覧・カード・パックの取得、出品・アップロード・封筒・open/pause・close、payouts と ack)も `exchange` で足す(パックの PUT/GET は 24MiB+36、カードは 1MiB+36 まで)。
2. `store::Store` に `market::Locked` を実装し、IPC 7つ(依頼書 §5)を `spawn_blocking` で。
3. 同期(起動・フォーカス・Market を開いたとき・友達の承認/Remove/Block の後): 自分の出品を続きから進める → 封筒の付け外し → 一覧(`store_seen`)→ カードの取得 → `pending_pulls` の再送 → 精算と ack。
4. **仕様の整合(未解決)**: 鍵だけを新しい Mac に戻した場合、内容鍵(DB)がないので新しい友達に封筒を作れない。ただし既存の友達は封筒のまま引け、精算は鍵だけで受け取れる。Worker は closed の再出品を拒否するので、「出し直す」は不可。**設計書 §2.1 の「出品を取り下げて出し直す」を、この挙動に合わせて Step 7 で直す**のが推奨。
5. 既存の S1 開封(`packs.rs::open`)は Library のロックを持ったまま HTTP をしている(以前からの挙動)。Market の経路はロックの外で行う。

## Step 4以降の入口

- appの `referee_access.rs::sync_pass` は collect-under-lock → unlock HTTP → reconcile-under-lock の既存パターン。
- launch/focusは `lib.rs` の既存kickoffに接続。Market openと友達approve/remove/block後も同期。常時Marketポーリングは追加しない。
- IPCは依頼書の7つ。`market_pull` は既存 `packs.rs::Opened` と互換の結果を返し、`ceremony.js` の1枚開封を再利用する。
- 出品uploadはdraftのintent・暗号文を永続化し、途中失敗の続きから再開する。内容鍵をサーバーへ送らない。
- 引くためのpackは最初のpull時だけ取得し、card/header digest・seller署名を検証。Packsの棚に出さない。
- 既定版ではIPCの空/機能未提供応答を用意し、友達レールは出さない。HTTP依存を既定版へ追加しない。

## 検証済み結果

Step 1・Step 2の区切りで全系統を実行した。Step 2最終結果:

| 系統 | 結果 |
| --- | --- |
| Rust既定workspace | app 11 / core 229 / original_management 5 / CLI 1、成功 |
| Rust developer workspace | app 14（live 1 ignored）/ core 231 / original_management 5 / CLI 1、成功 |
| ルートJS | 187件成功 |
| Worker | 6 files / 50件成功 |
| Worker TypeScript | 成功 |
| git diff --check | 成功 |

このMacの制約: sandbox内ではWorker localhost待受とWranglerログ、Apple VisionのANEモデルが失敗する。必要な権限でテストを実行すると成功した。権限由来の失敗をテスト成功と数えず、`--skip`は使っていない。Rustは `CARGO_INCREMENTAL=0` を揃える。

```sh
CARGO_INCREMENTAL=0 cargo test --manifest-path src-tauri/Cargo.toml --workspace
CARGO_INCREMENTAL=0 cargo test --manifest-path src-tauri/Cargo.toml --workspace --features developer
npm test
# cloudflare/peta-api 内
npm test
npm run check
```

ログは `/tmp/peta-s3-step2-{rust,rust-developer,js,worker}.log`。永続の成果物ではない。Step 1の対応ログも `/tmp/peta-s3-step1-*` にある。最終の `cargo tree` によるHTTP依存チェック、dev実API往復、Mac実機GUIは未実施。

## 既存変更の保護

開始時から `docs/decisions.md`・`docs/server-plan.md`・`docs/ui-proposals/README.md`・`src/app/css/linktag.css`・`src/app/js/assets.js`・`src/app/js/market.js` にオーナーの未コミット変更があり、今回のコミットへ含めていない。S3 prompt/plan(`docs/codex-server-s3-prompt.md`・`docs/server-s3-market-plan.md`、未追跡)や `.claude/`、多数のUI試作、`docs/.codex-server-s3-prompt.md.swp` もある。**git add . / reset --hard / cleanを使わない。**

Step 4以降も既存の編集を保持し、Step 5のmarket.js、Step 7のdecisions/server-planは自分の変更だけをコミットする。補助コピーは `/tmp/peta-s3-owner-changes.patch`、`/tmp/peta-s3-market-before.js`、`/tmp/peta-s3-decisions-before.md`。これらは全未追跡ファイルのバックアップではない。

`docs/release-readiness-audit-2026-10-13.md` は前の確認依頼でCodexが作った未追跡レポート。S3には含めていない。公開前問題を勝手にS3へ混ぜない。

**本番のbucket/migration/deployは実行禁止。devはStep 6でログイン状況を確認してから、依頼書どおりに行ってよい。**
