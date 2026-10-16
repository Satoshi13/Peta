# 報告: 公式パックを、アプリの更新なしで配る

2026-10-16。指示書 [codex-official-packs-prompt.md](codex-official-packs-prompt.md) の作業報告です。**クラウドの Linux 環境**で行いました（§9）。手順は [official-packs-howto.md](official-packs-howto.md)。

## まとめ

| Step | 状態 | コミット |
|---|---|---|
| 1. `shop_pack` の検証と保存・契約ファイル・`peta-pass shop-pack` | 完了 | `6bb1c80` |
| 2. アプリ（取得・保存・ショップ・買う・棚・期間切れ） | **未着手。Mac で行う**（§9） | — |
| 3. `peta-api`（`0011`・一覧・トークンつきファイル） | 完了。**dev へのデプロイは未実施** | `a02c4ee` |
| 4. 管理ページ Packs タブ（下書き・掲載）と `shop_config` の拡張 | 完了。**dev へのデプロイは未実施** | `42df1a0` |
| 5. `scripts/sign-pack.sh` | 完了 | `fcf75ad` |
| 6. dev の通し確認 | **未実施** | — |
| 7. 手順書・報告 | 完了 | この文書のコミット |

**Mac で未テスト**: アプリ本体（`src-tauri`）には手を入れていません。`peta-core`（ルールと保存）は Linux でもビルド・テストできるので、Step 1 の保存（DB v18）までここで実装・テストしました。macOS の型検査は GitHub Actions の macOS ジョブで行われます。

**デプロイしていない理由**: この環境には wrangler のログインがありません（`wrangler whoami` が未認証）。dev への D1 マイグレーションとデプロイ、Step 6 の通し確認は、オーナーの Mac で行ってください（手順は howto の §2）。

## 作ったもの

### Step 1（`peta-core` / `peta-pass`）

- `src-tauri/crates/core/src/shop_pack.rs`
  - `PETAEVNT` v1、`kind: "shop_pack"`。イベント ID は `shop-<packId>-v<version>`。
  - **公式の鍵（k*）だけ**を信頼する。クーポン鍵で署名されたものは、この検証でも、既存の `events::decode` でも拒否する（テストあり）。`apply_event` は受け取らない（「ショップに出るもので、Gift のようには受け取らない」と返す）。
  - 上限を外れたものは丸ごと拒否: 3〜12枚、4〜40 Scraps、重み1〜100、袋 kraft / matte / holo / glassine、色は matte と holo だけ、題名・作者40字、一行120字、ID は英数字と `-` `_` の40字まで（既存7パックの ID は不可）。
  - 絵: 透明な PNG（透過のある画素と描かれた画素の両方が要る）、長辺 1024px、1枚 1.5MB、合計 12MB。既存の `validate_png`（`image_limits` の上限つき）に加えて検査する。
  - `store()`: 検証してから、絵を `shop/<packId>/<version>/<key>.png` に、中身を新しい表 `shop_packs` に記録する（DB **v18**）。絵の書き込みと DB は同時に確定する（`AssetWrites`）。同じ版の同じファイルは何もしない。同じ版で中身が違うものは拒否する。
  - アプリの中のパック ID は `shop:<packId>`（既存・友達のパックと重ならない）。
- 契約ファイル `cloudflare/shared/shop-pack-contract.json`: 上限・袋と色・レア度と既定の重み・既存の ID。Rust のテストがこれと定数、`catalog.js` の `PACK_BAG_IDS`・`PACK_COLORS` との一致を確かめる。管理ページはこの JSON を直接読む。
- `peta-pass shop-pack --dir <folder> [--key <path>] [--key-id k2] [--out <file>] [--check] [--previous-version N] [--json]`
  - フォルダの `pack.json` と `<key>.png` を検査して署名し、書いたファイルを自分の鍵で検証し直す。
  - `--check` は鍵を読まず、何も書かず、各ステッカーの確率を返す。`--previous-version` はそれ以下の版を拒否する。
  - `verify` は `shop_pack` の上限も当てる。

### Step 3（`peta-api`）

- D1 `0011_shop_packs.sql`
  - `shop_pack_drafts`、`shop_packs`、`shop_pack_tokens`。
  - `shop_packs` には指示書の列に加えて `price`（Shop の値段の範囲の計算用）と `removed_at`（片付けた古い版の印）を足した。既存の表は変えていない。
- `/v1/config` に `shopPacks` を足した。
  - 対象は販売中（開始済み・終了前・停止していない・片付けていない）のパックで、各パックについて販売中の最新版だけ。
  - 中身は `{packId, version, size, sha256, endsAt, url}`。`endsAt` は、オフラインの間も期間切れで隠せるように足した。
- ファイルの配信: `GET /v1/shop-pack/<token>/<packId>/<version>`。
  - トークンは 10 分で、その Mac 専用。保存するのはハッシュだけ。
  - 1回の `/v1/config` の答えに1つだけ作り、販売中のパックがなければ作らない。
  - そのときにも販売中で、保存してある大きさと一致するファイルだけを渡す。
  - 招待が必須の環境では、招待済みの Mac だけ（既存の認証の仕組みのまま）。
  - 期限切れのトークンは定期の掃除で消す。
  - 指示書の `/v1/shop-pack/<token>` にパック ID と版を足した形です（1つのトークンで複数のファイルを取れるようにするため）。

### Step 4（`peta-admin`）

- Packs タブ（`public/packs.js`、`src/packs.ts`）
  - **下書き**: 新しい ID、または署名済みパックの次の版（今の中身と絵から始める）。絵はブラウザで 1024px に縮小し、透過を確かめる。Worker でも PNG のヘッダー（大きさ・透過）と契約の上限を確かめる。プレビューには袋の簡易版、ステッカー、各ステッカー・各レア度の確率を出す。
  - **Ready to sign**: 下書きを凍結し、R2 の下書きのフォルダに `pack.json` を書き、Mac で打つコマンドを表示する（Copy command）。直すときは Duplicate、やめるときは Discard。
  - **署名済み**: 中身は署名済みファイルそのものから読み、文字はプレーンテキスト、絵は `blob:` で表示する。期間（終わりなしも可）、停止、同時に販売中・予定は24まで、確認つきの片付けがある。
  - R2 に書くのは `shop/drafts/` の下だけ。片付けで消すのは `shop/` の下だけ。**ページは署名せず、鍵ファイルを選ばせる UI もない**。
- `shop_config`
  - Featured・並び・値段に署名済みのパック（`shop:<packId>`）を選べる。値段はそのパックの値段の 50〜200%。
  - アプリ側（Rust の `validate_shop`）も `shop:<packId>` を受け付けるようにした（30パックまで、Featured は6まで）。
  - パックの値段はファイルが届くまで分からないので、設定の検査時は 2〜80 の範囲だけを見る。パック自身の 50〜200% は、ショップが値段を付けるとき（Step 2）に当てる。
  - 契約ベクトル（`config-vector.json`）を作り直した（上限の値だけが変わり、署名済みの例は同じ）。
- 新しい変数 `PETA_ENV`（dev / prod）。表示するコマンドの行き先に使う。

### Step 5（`scripts/sign-pack.sh`）

1. オーナーの wrangler ログインで、下書きの行・`pack.json`・絵を一時フォルダに取ってくる。ready でなければ止まる。
2. `peta-pass shop-pack --check --previous-version` で検査する。
3. 取ってきたファイルからプレビューの HTML を作って `open` で開く（外部の読み込みなし、CSP つき）。ターミナルにも要約を出し、`y/N` を聞く。
4. `y` のときだけ `peta-pass` が署名する（prod は k2、dev は k1、鍵は既定で `/Volumes/Peta-private/official.key`）。**鍵ファイルを読むのは `peta-pass` だけ**で、スクリプトはパスを渡すだけ。
5. 署名したファイルを `peta-pass verify` で確かめてから、R2 `shop/<packId>/<version>.peta` に置き、D1 に「署名済み（未掲載）」を記録する。
6. 一時フォルダを消す。

## テスト（このクラウド環境で実行）

| コマンド | 結果 |
|---|---|
| `cargo test -p peta-core -p peta-pass` | 286 + 2 + 6 + 2 件成功（Vision の3件は Linux では対象外）。clippy の警告なし |
| `cargo test -p peta-core --features developer --test official_trust` | 2 件成功 |
| `cd cloudflare/peta-api && npm test && npx tsc --noEmit` | 77 件成功、型検査成功 |
| `cd cloudflare/peta-admin && npm test && npx tsc --noEmit` | 53 件成功（Packs 9 件を含む）、型検査成功 |
| `cd cloudflare/peta-download && npm test && npx tsc --noEmit` | 11 件成功、型検査成功 |
| `npm test` | 250 件成功 |
| `python3 scripts/test-harness.py` | 全ハーネス成功 |
| `python3 scripts/test-sign-pack.py`（新規） | 成功: ready でない下書きは止まる、プレビューは取ってきたファイルから作られる、`n` なら何もアップロードしない、`y` で署名・検証・アップロード・記録、同じ版は拒否、鍵の中身は出力・ログ・プレビュー・アップロードのどこにも出ない |
| `node scripts/check-admin-packs.mjs`（新規） | 成功: 下書き、透明でない絵の拒否、確率、Ready to sign、署名済みの中身（プレーンテキストと `blob:`）、期間、Shop の Featured、**375px** で横スクロールなし |
| `node scripts/check-admin-round2.mjs` | 成功（既存の管理ページに影響なし） |

**実行していないもの**:
- `cargo test --workspace --features server` と `cargo test --workspace`。アプリ本体は Linux でビルドできない。GitHub Actions の macOS ジョブが型検査とアプリの単体テストを行う。
- `python3 scripts/test-release-mac.py`。macOS 専用。

CI（`.github/workflows/ci.yml`）に `test-sign-pack.py` と `check-admin-packs.mjs` を足しました。

空き容量（クラウド環境）は 252 GB 中 19 GB でした。Mac のディスクの話ではありません。

## Mac に残る作業（Step 2・6）

1. **取得**（`server` feature）
   - 設定を取得するときに `shopPacks` を受け取り、手元にない `{packId, version}` だけ `url` から落とす。
   - `peta_core::shop_pack::store` で検証・保存する（実装済み）。失敗したら捨てる。
   - `endsAt` を過ぎたものと、一覧から消えたものはショップに出さない（棚の分は消さない）。
2. **ショップ**（`market.js`）: 既存の6パックと並べる。絵は保存した PNG を使う。`shop_config` の Featured・並び・売る売らない・値段がそのまま効く。
3. **買う**（`scraps::pack_offer` / `trade` の `Kind::Pack`）
   - `shop:<packId>` のとき、基準値段は `shop_packs.price`、調整はそのパックの 50〜200%。外れた値段はそのパックについては使わない。
   - 1セットは `pack_items`・`signed_pack_items`（保存した PNG のパス、`material_id` は matte、`finished` は 0）・`pack_item_weights` で入れる。
   - 袋と色は、`pack_distributions` の `pouch` と `pack.color.<id>`。
4. **重みで引く**: `creator_pack::pick` は今、端末の鍵で署名されたパックでだけ重みを使う（公式の `grant_pack` は均等）。ショップのパックで重みを効かせるには、`pack_item_weights` があれば重みで引くように変える必要がある。
5. **k2**: 公開鍵を `KEYS` の末尾に入れた版を配ってから、本番のパックを出す（howto §1）。
6. **dev の通し確認**（Step 6）: dev の管理ページで下書き → `sign-pack.sh <draftId> dev` → 期間を設定 → Peta Developer のショップに並ぶ → 買う → 開ける → 期間を終わらせる → ショップから消え、棚の分は開ける。

## 判断したこと・気をつけること

- **古いアプリと Shop の設定**: アプリはショップの設定を上限の外なら丸ごと無視する。これまでのアプリは `shop:<packId>` を知らないので、新しいパックを名指しした設定を受け取ると内蔵のショップに戻る（壊れはしない）。友達のアプリが Step 2 の入った版に更新されてから、新しいパックを Featured にしてください。howto と管理ページの手順に書いた。
- **透過の確認**: 管理ページの Worker は PNG のヘッダーまでしか見ない（透過できる形式か）。画素まで見るのはブラウザ（下書き時）と `peta-pass`（署名時）とアプリ（受け取り時）。
- **プレビューの袋**: 管理ページはアプリの袋の絵を持たないので、色つきの紙の簡易版。正確な見え方は署名の前に Mac のプレビューと、dev のアプリで確かめる。
- **同じ版の下書きが2つ**: Duplicate した下書きは同じ版のまま。先に署名したほうが通り、もう一方は `--previous-version` で止まる。
