# Peta

macOS 専用のデスクトップステッカーアプリ（Tauri 2）。毎日1枚のステッカーを作ってデスクトップに貼る。

## 構成

- `src/` — WebView の画面（素の JS / CSS、ビルドなし）。`src/app/js/` がページごとのスクリプト、`src/app/css/base.css` の `:root` がデザイントークン。
- `src-tauri/src/` — Tauri のコマンドとネイティブの窓（macOS のみビルド可）。
- `src-tauri/crates/core/` — ルールと保存（SQLite、署名、画像処理）。UI なし。Apple Vision は `segment.rs` だけで、他は Linux でもビルド・テストできる。
- `src-tauri/crates/peta-pass/` — 公式の署名つき配布を作る CLI。
- `cloudflare/` — 友達・受信箱・Market・管理画面・ダウンロードの Workers（それぞれ独立した npm パッケージ）。
- `docs/decisions.md` — オーナーとの決定の記録。ルールを変えるときは必ずここを確認する。

## デザイン

画面・素材・演出を触る前に [docs/design-principles.md](docs/design-principles.md) を読み、末尾のチェックリストで確かめる。要点:

- 平らで静かな Mac 純正の土台の上に、描いた紙の小物がそっと置かれている。土台を飾らず、小物をフラットにしない。
- 待機中に動き続ける演出・煽る文言・ゲーム的な表現（レベル、ゲージ、派手な獲得演出）をしない。ガチャを主役にしない。
- 光は左上、影は右下に薄く短く（`--sh1`〜`--sh3` のトークンだけ）。色はトークンから、強い原色なし。
- 文字はシステム書体。札・小見出しは字間の広いタイプライター体の大文字、手書き体は物の上だけ。

## 確認のしかた

```sh
npm test                                        # 画面側のテスト（Node の node:test）
cargo test --manifest-path src-tauri/Cargo.toml -p peta-core   # ルールと保存（Linux でも可）
npm run test:harness                            # 実コードを偽の Tauri で動かす Rust ハーネス
npm run check:mac                               # アプリ全体（macOS のみ）
```

各 `cloudflare/*` は、そのディレクトリで `npm test` と `npm run check`。

## 約束

- DB スキーマを変えるときは `SCHEMA_VERSION` を上げ、`db.rs` の移行を追加し、古い版からの移行テストを足す。移行前の自動バックアップ（`peta.db.v<N>.bak`）が残ることを壊さない。
- 外から届くファイル（`.peta`、Gift、パック、Market の画像）は信頼しない。画像は `image_limits` の上限つきでデコードする。
- 文言は英語の UI、簡潔な平叙文。docs は日本語。
