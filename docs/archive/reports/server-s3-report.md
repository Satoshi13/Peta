# S3 友達の Market の実装報告

2026-10-13。依頼書 [codex-server-s3-prompt.md](../prompts/codex-server-s3-prompt.md) と設計書 [server-s3-market-plan.md](../../server-s3-market-plan.md) に沿って Step 1〜7 を完了しました。Step 1・2 は Codex、Step 3〜7 は Claude が実装しています(途中の引き継ぎは [server-s3-handoff.md](../../server-s3-handoff.md))。**dev にはデプロイ済みです。本番には何も操作していません。実機でしか確認できない項目は未完了です。**

## 作ったもの

| Step | 内容・主なファイル | コミット |
| --- | --- | --- |
| 1 | core `market.rs`: 内容鍵での封(ChaCha20-Poly1305、`PETAMKT1`)と HPKE の封筒、固定鍵の検証用データ `vectors-s3.json` | `5a5f8f5` |
| 2 | Worker `market.ts`・`0003_market.sql`: 暗号文の出品、相互の友達だけの一覧と取得、枠の claim と売上を1つの D1 batch で確定、精算と ack、close・退会、出品の通報 | `5e6ffc9` |
| 3 | core: DB V17、Scraps の `Pull` / `Payout`(通常の交換からは不可)、`Referee::purchase`、開封の共通化(`award_in`)、出品の準備・封筒・友達の一覧・カード・引く専用パック・引く・返金・精算 | `825aa71` |
| 4 | アプリ `friend_market.rs`: IPC 7つ、出品を一歩ずつ進める、同期(起動・60秒以上後のフォーカス・Market を開いたとき・友達の変更後)。`referee.rs` に `purchase`、長い時間の転送用の agent、クエリを署名しないパス | `e1b8721` |
| 5 | UI `market.js`・`packs.js`・`ceremony.js`・`boot.js`・`pages.css`: 友達ごとのレール、カードと1回の引く、空とオフラインの表示、My shelf の出品・一時停止・販売終了と入った Scraps。JS テスト `friend-market.test.mjs` | `53d74b4` |
| 6 | dev: `peta-market-dev` を作成、`0003` を `peta-dev` に適用、`peta-api-dev` をデプロイ。実 API の往復テスト(明示実行) | `351802e` |
| 7 | 本報告、decisions、運用手順、置き場所、プライバシー下書き、実機チェックリスト、README、設計書 §2.1 の修正 | 本コミット |

新しい crate は追加していません(ChaCha20-Poly1305 0.10.1・HPKE 0.12.0・rand_core 0.6.4・Ed25519・ureq 2.12.1 は既存)。アプリのスキーマ追加は V17、Worker は 0003 だけで、V1〜V16 と 0001・0002 は変更していません。

## 動きの要点

- **Scraps は端末のまま**。引くときに端末で 6 を減らし、引き待ち(`market_pulls` の pending: 出品・pull ID・枠・署名済みの claim)と**同じトランザクション**で保存してから送ります。サーバーは枠の claim・版の transfer・売上の1行を1つの batch で確定します。
- 応答がない・5xx・時計のずれは pending のまま残し、**次も同じ pull ID・同じ枠・同じ署名**で再送します(サーバーは同じ再送に同じ売上を返す)。`slot_taken` は同じ払いのまま別の枠へ移り、3回で返金します。`not_friend`・`listing_closed`・`price_changed`・`sold_out`・`own_pack`・`too_many_pulls`・`blocked`・`invalid`・404 は返金します(Worker は確定済みの正確な再送を友達の解除やブロック後も受け付けるので、これらは「売れていない」ことを意味する)。
- **HTTP の間は Library のロックを持ちません**(`market::Locked` を介して、ロックの中ではデータの読み書きだけ)。
- 売り手の取り分はサーバーの売上の記録(`cut_milli`)から計算し、端数を端末で持ち越します(6 を5回で 21)。端末で数えてから ack を送るので、ack が失われても同じ売上は `upto` で読み飛ばされます。
- 出品のカードには作者名を入れず、買い手の端末の友達の名前で表示します。取ってきたパックは、digest・カードの `packDigest`・外部ID・**署名者が売り手であること**を確かめてから、Packs の棚に出さない「引く専用」として入れます。無料開封・通常の開封は `market_pack` で拒否します。
- 出品したパックをファイルで開こうとすると Worker が `for_sale` を返し、S1 の枠の引き待ちを残さずに断ります。
- 友達がいない・自分の出品も引き待ちもない場合は Market の通信をしません。

## 依頼書・設計書と違う判断とその理由

1. **IPC の名前と返す形**: 依頼書の7つ(`market_friend_listings`・`market_card`・`market_pull`・`market_list_pack`・`market_pause_pack`・`market_close_pack`・`market_payouts_sync`)。`market_pull` は既存の `pack_open` と同じ `Opened` を返し、開封の演出(`Cer.openPack`)に `pull` を渡して共有します。
2. **`market-changed` の通知は裏の同期だけ**が出します。Market を開いたときの同期は自分で描き直すので、通知を出すと再取得の繰り返しになるためです。ユーザーの操作(出品・引く)の後は通知します。
3. **裏の同期は60秒に1回まで**。フォーカスのたびに一覧と精算を取りに行かないためです。Market を開いたときは毎回同期します。
4. **大きい転送は別の agent**(接続10秒・全体300秒)。既存の10秒では 24MiB のアップロードが間に合わないためです。JSON は従来どおり10秒。
5. **クエリ文字列は署名しない**: Worker が `pathname` だけで署名を確かめるため、`/v1/market/payouts?after=N` はパス部分だけを署名します(既存のパスは変わりません)。
6. **見本の3枚**: 版の数の少ない順で、一番少ないもの(いちばんレア)を除いて最大3枚。カードが 1MiB を超える絵は入れません(縮小はしていません)。
7. **鍵だけを復元した場合**(設計書 §2.1 を修正): 内容鍵はデータフォルダの DB にあるので、鍵だけ戻すと新しい友達に封筒を作れません。ただし既存の友達はそのまま引け、精算も鍵だけで受け取れます。Worker は closed の出品の再登録を拒否するので「出し直す」はできません。データフォルダごと移せば続けられます。
8. **一度 closed にした出品は戻せない**: 出品 → 販売終了 → 無料で配り直す、を防ぐため(設計書 §3.1 のとおり)。下書き(サーバーに登録していない)を閉じた場合は端末だけで閉じます。
9. **カードに作者名がない**一方、署名済みパックのヘッダには `author` が残ります(PETAPACK v2 の形式を変えないため)。サーバーはパックを復号できないので、運営には見えません。

## 検証結果

| 段階 | Rust 既定(app / core / original_management / CLI) | Rust developer | ルート JS | Worker |
| --- | --- | --- | --- | --- |
| Step 3 | 11 / 239 / 5 / 1 | 14 / 241 / 5 / 1 | 187 | 6ファイル・50 |
| Step 4 | 11 / 239 / 5 / 1 | 15 / 241 / 5 / 1 | 187 | 50 |
| Step 5 | 11 / 239 / 5 / 1 | 15 / 241 / 5 / 1 | **193** | 50 |
| Step 6 最終 | **11 / 239 / 5 / 1** | **15(2 ignored)/ 241 / 5 / 1** | **193** | **50** |

全件成功。`npm run check`(TypeScript)と `git diff --check` も成功。既定版の `cargo tree -p peta -e normal` に ureq / rustls / reqwest は**ありません**(developer にのみ ureq / rustls)。

```sh
CARGO_INCREMENTAL=0 cargo test --manifest-path src-tauri/Cargo.toml --workspace
CARGO_INCREMENTAL=0 cargo test --manifest-path src-tauri/Cargo.toml --workspace --features developer
npm test
# cloudflare/peta-api 内
npm test
npm run check
# dev への実 API の往復(明示実行)
CARGO_INCREMENTAL=0 cargo test --manifest-path src-tauri/Cargo.toml -p peta --features developer market_live -- --ignored
```

- core(偽の審判): 友達だけに封筒、カードとパックの改ざん・作者の不一致の拒否、引く専用パックが棚に出ず無料開封できない、1回だけ払う、応答なしの再送・再起動後の再送、`slot_taken` で同じ払いのまま移る・3回で返金、最終拒否の返金と時計のずれの保留、debit と pending の故障注入、確定の故障注入からの復旧、景品の枠、精算の二重計上なし・端数、`trade` から Pull/Payout を拒否、V16→V17。
- アプリ: モックの HTTP で `purchase` の本文と応答、クエリなしの署名。
- JS: 配布版で友達の欄が出ない、友達なし・出品なし・オフラインの文言、友達ごとのレールと残り・Back soon・Sold out、カードの残りの表示と1回の引く、払えないときは押せない(一時停止・売り切れ・残高不足、開発者版は払わない)、My shelf の出品・一時停止・販売終了(確認で断ると何も送らない)。疑似 DOM の `replaceChildren` を本物と同じく配列を展開しない形にし、ボタンの文字が崩れる不具合を見つけて直しました。
- ブラウザ: 本物の CSS と JS で Market のページを描き(scratchpad の確認用ページ、リポジトリには入れていない)、友達のレール・拡大カード・空とオフラインの表示を画像で確認しました。拡大のアニメーション(PackZoom)は確認用ページでは動かしていません。

## dev のデプロイ

- R2 `peta-market-dev` を作成(場所のヒントは未指定)。D1 `peta-dev` に `0003_market.sql` を適用。
- `npx wrangler@4.149.0 deploy --env dev` 成功。Worker `peta-api-dev`、URL `https://peta-api-dev.peta-api.workers.dev`、Version ID `74ca284d-78f6-49ec-ad05-0546790a1b0b`。binding: `peta-dev` / `peta-gifts-dev` / `peta-reports-dev` / `peta-market-dev`。`/v1/health` は 200。
- 実 API の往復(`market_live_round_trip`): 3つのデータフォルダで、売り手が出品 → **知らない人には一覧に出ず、出品 ID を知っていてもカードを取れない** → 友達がカードとパックを取り、1回引く(20 → 14)→ 売り手に 4 入る(端数は持ち越し)→ ack 後は同じ売上が返らない → 販売終了で一覧から消える → 3人とも退会。dev にはパック・版・枠・売上の小さな台帳の記録が残ります。

## 守れないこと・残る制約

- **改造したアプリは払わずに引けます**(Scraps は端末のまま)。被害は友達の版の買い占めで、1人1日 20 回の上限・友達だけ・作者が誰が引いたかを見て Remove/Block できること、で抑えます。端末の残高の書き換えも防げません。
- 友達が取ってきた**復号済みのパックを他の人へ渡すこと**は防げません。ただし出品したパックの開封は Worker が `for_sale` で断ります。
- 出品の通報(`kind: "listing"`)の真偽は自動では確かめません。運営が中身を見て判断します。
- 鍵だけの復元では、新しい友達に封筒を作れません(上の 7)。
- 見本の絵が大きいとカードから外れます(縮小は未実装)。
- 強制終了・通信断・スリープを含む実機での耐久性(特に 24MB 近いアップロードの途中終了)は自動テストの範囲外です。アップロードは端末に封じたファイルを残し、次の同期で続きから進めますが、実機で確かめる必要があります。
- 既存の S1 の開封(`packs.rs`)は以前から Library のロックを持ったまま HTTP をしています。今回は変えていません。

## オーナーの作業・実機で確かめること

1. **本番**(この作業では照会も変更もしていない): `peta-market-prod` を非公開で作成 → D1 を export → `0003` まで migration → prod へ deploy。R2 の使用量の通知を設定。手順は [server-howto.md](../../server-howto.md)。S2 の本番準備(`peta-reports-prod` など)がまだなら先に行う。
2. 2〜3台の Mac(異なる鍵)で: 出品 → 友達にだけ見える → 引く → 売れ行きに名前と `Earned N Scraps` → 精算の知らせ。Remove/Block の後に一覧から消え、引けない。すでに引いた版は手元に残り、Gift で渡せる。
3. Wi‑Fi を切ったときの文言と、残高が戻る/戻らない(応答がなかった場合は引き待ちとして残り、つながると確定する)。
4. 24MB 近いパックのアップロードとダウンロードの時間、途中で終了したときの再開。
5. 友達が同時に同じ出品を引いたとき、版の番号が重複しない。
6. 通常版(既定ビルド)の Market・Packs・Scraps が今までどおり。
7. 公開前: 届出の要否を総合通信局に確認(設計書 §9 の 17)、プライバシーポリシーの S3 の追記を専門家と確認。
