# 管理ページ第2弾の実装報告

2026-10-16。`docs/archive/prompts/codex-admin-round2-prompt.md` の Step 1〜5 を実装しました(ブランチ `codex/ui-fixes-oct07`、Step ごとにコミット)。本番のデプロイ・秘密の登録はしていません。

作業は**クラウドのコンテナ(Linux)**で行いました。そのため (1) オーナーの Mac にある未コミットの変更はこの作業ツリーにはなく、触れていません(取り込みはオーナー側で調整)。(2) Cloudflare の認証がないので **dev へのマイグレーションとデプロイはできていません**(`wrangler deploy --dry-run` だけ確認)。(3) Rust のアプリ本体は macOS 専用なので、テストの実行に制限があります(下の「テスト」)。

## コミット

| Step | コミット | 内容 |
|---|---|---|
| 1 | `f675f98` | 通報(Reports タブ) |
| 2 | `3a79779` | 署名つき設定の種類を4つに + アプリ内のお知らせ(News タブ、Today の帯) |
| 3 | `1bcb116` | Market の Featured の決め方、Shop タブ、`shop_config` の値段の反映 |
| 4 | `7097b6c` | Market の状況(集計だけ) |
| 5 | (このコミット) | 手順書と報告 |

## やったこと

### Step 1: 通報(Reports)

- `peta-admin` に R2 `peta-reports-<env>` を `REPORTS` として bind(読むだけ。削除は従来どおり `peta-api` の日次 Cron)。
- 一覧(未対応が上): ID・受け取り日時・理由・種類(Gift / Market listing)・同じ送り手への通報数・対応済みの日時。送り手と通報者は鍵ハッシュの**先頭8文字**だけ。応答に完全なハッシュは含めない(テストで確認)。タブに未対応件数。
- 詳細: R2 の中身を Worker 側で読み、Gift(`PETAGIFT` v1〜3、公式の `PETAEVNT` Gift)とマーケットの出品(カードの JSON の peek、`PETAPACK` の各ステッカー)から **PNG の先頭を確かめた絵だけ**を取り出して base64 で返す。画面は `Blob(type: image/png)` → `blob:` URL の `<img>` で表示し、文字はすべて `textContent`。ダウンロードのボタンなし。CSP は `img-src` に `blob:` を足しただけ。中身が期限切れ・未アップロードの通報はその旨を表示。
- Resolve / Block sender(理由つき、同じ送り手の未対応をまとめて対応済みにするか選べる)/ Unblock。確認ダイアログつき、すべて `admin_log`。Unblock は先頭8文字で指定し、2件一致したら拒否(Wrangler で外す)。Discord の Webhook は変更なし。

### Step 2: 署名つき設定の種類 + お知らせ

- クーポン鍵で作れる種類を **`bundle`・`daily_table`・`announcement`・`shop_config`** に(`events::decode`)。それ以外の種類・添付・本体つきは拒否。既存テストを広げました。
- D1 `0010_signed_configs.sql`(新しい表 `signed_configs` だけ)。**指示書の「0009」は `0009_updates.sql` で使用済みだったため 0010** にしました。1年たった行は既存の `sweepRecords` で削除。
- `peta-api`: `GET /v1/config` = `{tables, announcements, shop}`(停止・終了していないもの、最大10件ずつ)。`/v1/daily-table` は残しました。
- 管理ページ News タブ: 本文(英語1行・140字)、種類、リンク(なし / ダウンロードページ / Discord 招待の2択)、期間(最長1年)、一覧・停止、同時に10件まで。
- アプリ(`server`): 6時間に1回の確認を `/v1/config` に(404 の古いサーバーなら `/v1/daily-table` に戻る)。署名を確かめてスナップショットを `meta` に保存し、Today の上に**開始が一番新しい1件**を閉じられる帯で表示。本文はプレーンテキスト、リンクはアプリに埋め込んだ URL だけ(`/usr/bin/open`)。閉じた ID は Mac ごとに記録。offline 版は帯なし(コマンドは常に `null`)。範囲外のお知らせは丸ごと無視。
- **Discord の招待 URL はリポジトリに見つからなかったので `None` + `TODO(owner)`**(`src-tauri/src/daily_supply.rs` の `link_url`)。入るまで Discord を選んだお知らせはリンクなしで出ます。

### Step 3: ショップのピックアップ

- `market.js`: Featured を `Featured.pick()` で決定。友達の出品(自分のでない・`open`・残りあり・名前の分かる友達・カードあり)→ ランダム、なければ `shop_config` の候補(なければ `MARKET_PACKS[0]`)から売っていて袋に入るもの → ランダム、どちらもなければ hero を出さない。Official first で順番を入れ替え。Market を開くたびに選び直し(`build()` でリセット)、開いている間は維持。友達の hero は「From a friend」+ 名前 + カードの peek の絵 + 友達のレールと同じ `PackZoom`。New and popular は設定の並び順、紹介文の差し替え、売っていないパックは外す。
- 既存の `market.js` には「上に足す」形で変更(既存の関数はそのまま、`packs()` の hero 部分を `hero()` に切り出し)。**オーナーの未コミットの `market.js` の変更とは、マージ時に `packs()` の hero 付近がぶつかる可能性があります。**
- 判断したこと: **オフライン時の友達の出品は hero にしない**(引けないため)。**無料パック(Tokyo / Coffee / Houseplants)には値段を付けられない**(付けた設定は丸ごと無視)。**On sale を外すと交換も無料の Get も止まる**。
- Rust: `signed_config` に `ShopConfig`(上限: 公式パックだけ・重複なし・値段は既定の50%〜200%・紹介文120字1行・期間400日まで)、`scraps::pack_offer` を `status`(表示)と `trade`(引く額)の両方が使うので**表示と実際の Scraps が必ず一致**。期間つき(event)が standing より優先。
- 管理ページ Shop タブ: Standing / For a period、Featured の候補、Official first、並び順(↑↓)、パックごとの On sale・値段(範囲を表示、無料は入力不可)・紹介文。Standing は新しいもので置き換え(400日の期限で署名)。
- Rust ↔ Worker の契約: `cloudflare/peta-admin/test/config-vector.json`(お知らせと shop の署名済みの例、パック一覧と上限)。Worker はバイト単位で一致、Rust は decode → 再エンコード一致 → 適用、パック一覧・既定の値段・上限の一致を確認。

### Step 4: マーケットの状況

- `GET /api/market`: 公開中の出品数、出品している人数、全期間と日ごと(30日、UTC)の引かれた回数・使われた Scraps・売り手の取り分。**個人・出品 ID・鍵ハッシュは返さない**(テストで確認)。公式ショップは端末の中だけなので出ない旨を画面に一行。
- 画面: 数字のタイル、外部ライブラリなしの SVG の棒グラフ2つ(回数 / Scraps。二軸にしない)、日ごとのツールチップ、表。CSP は変更なし。

## テスト

最終の実行結果(このコンテナ、Linux):

| 検証 | 結果 |
|---|---|
| peta-admin `npm test` / `tsc --noEmit` | 11ファイル 45件 成功 / 型エラーなし |
| peta-download `npm test` / `tsc` | 9件 成功 / なし |
| peta-api `npm test` / `tsc` | 74件 成功 / なし |
| ルート `npm test` | 216件 成功、失敗なし |
| `scripts/check-admin-round2.mjs`(Playwright、4タブ、375px で横スクロールなし、コンソールエラーなし) | 成功 |
| `wrangler deploy --dry-run`(peta-admin / peta-api の dev・prod) | 成功 |
| Rust `peta-core`(Linux 用の写し、Vision を stub) | 264件 成功。失敗9件は作業前と同じ Vision・サムネイル・export の macOS 依存のテスト |
| Rust `peta-core --features developer --test official_trust` | 2件 成功 |
| Rust アプリ本体(`--features developer` / `server` / なし、`--all-targets`) | aarch64-apple-darwin 向けに **cargo check(型検査)だけ**成功。リンク・実行はしていない |
| `python3 scripts/test-release-mac.py` | Linux では作業前から失敗(macOS のツールの偽物の前提。今回このスクリプト・配布スクリプトは変更なし) |

**未確認(Mac で確かめてほしいこと)**: §8 の `cargo test`(workspace の server / default)を Mac で一度実行してください。特にアプリ側のテスト `daily_supply` の `unverifiable_announcements_keep_the_last_snapshot` と、`market_live` 等の既存テストは型検査しかしていません。Peta Developer で Today の帯・閉じる・リンク、Market の hero と値段の表示は、実機の目視確認をしていません(JS の単体テストと Rust のテストで代替)。

## オーナーがやること(順番)

1. **dev**: `cd cloudflare/peta-api && npx wrangler d1 migrations apply peta-dev --env dev --remote`(0010)→ `npx wrangler deploy --env dev`(peta-api dev)→ `cd ../peta-admin && npm run deploy:dev`。
2. dev の管理ページでお知らせ・ショップ設定を作り、Peta Developer(`npm run dev:developer`)で Today の帯と Market の表示を確認。
3. 必要なら Discord の招待 URL を `daily_supply.rs` の `link_url` に入れる。
4. **prod の D1 マイグレーション**: `npx wrangler d1 migrations apply peta-prod --env prod --remote`(0010。0008 / 0009 が未適用ならそれも)。
5. **`peta-admin` prod の再デプロイ**: `npm run deploy:prod`(REPORTS の bind と新しいタブ)。
6. **`peta-api` prod は配布の日にまとめて**(今回は再デプロイしていません)。それまでアプリは `/v1/daily-table` に戻るので、お知らせとショップ設定は prod の友達には届きません。
7. Standing のショップ設定は400日で切れるので、それまでに一度保存し直す。

## ディスク

このコンテナで Rust の作業用ビルド(約4.7GB)を削除。`npm run clean:target` は対象0件。作業後の空き: 27GB(コンテナのディスク。オーナーの Mac の空きではありません)。
