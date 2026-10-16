# Peta — One sticker a day.

毎日、ひとつだけ。デスクトップに残る、ステッカーのある暮らし。

Peta は macOS 14 以上専用のデスクトップアプリです。写真から切り抜いたステッカーを毎日1枚作り、デスクトップに貼ります。貼ったステッカーは翌日もそこにあり、ステッカー帳（Collection）に記録が残ります。

> 静かなシステムの画面に、手触りのある小物がそっと置かれている。人のいない、少し懐かしい場所。

デザインの考え方は [docs/design-principles.md](docs/design-principles.md) にあります。画面や演出を触る前に読んでください。

## できること

| 場所 | 内容 |
|---|---|
| Today | 毎日の封筒を開けて、今日の素材を受け取る。次の封筒までの時間 |
| Create（Cutting Mat） | 写真を Apple Vision で切り抜き、素材（Matte / Kraft / Holographic / Gold Foil など）で仕上げる。Print → Grab → Paste でデスクトップへ |
| Collection | 貼った記録の List / Calendar、検索と絞り込み、月のポスター書き出し |
| Studio | 自分のステッカーで Pack（版つき）と Gift を作り、署名して封をする |
| Packs / Market | 公式と友達のパックを Scraps で手に入れて開ける |
| Gifts | `.peta` ファイルや友達の受信箱でステッカーを譲る（本物は持ち主が移る） |
| Boards | ディスプレイごとの貼り方を保存して切り替える |
| Materials / Settings | 素材の在庫と分解、外観（Day / Night / Auto）、音・触覚・Reduce motion、鍵のバックアップ、新しい Mac への引っ越し |

ルールの決定は [docs/decisions.md](docs/decisions.md)、画面ごとの詳しい記録は [docs/features.md](docs/features.md) にあります。

## 動かし方（Mac）

必要なもの: Xcode Command Line Tools、Rust（`rustup`）、Node 20 以上

```sh
npm install
npm run dev                # 通常版
npm run dev:developer      # 開発者版（素材・回数の制限なし、別の保存先）
```

- Dock には出ません。メニューバーに Peta のアイコンが出ます。
- 保存先: `~/Library/Application Support/app.peta.desktop/`（開発者版は `app.peta.developer`）。`peta.db` と画像、署名鍵が入ります。
- スキーマを上げる更新の前には、`backups/peta.db.v<N>.bak` に元の DB が自動で残ります（新しい3世代）。

配布用のビルドと署名・公証は [docs/distribution-howto.md](docs/distribution-howto.md) を参照してください。

## 確認のしかた

```sh
npm test               # 画面側（node:test）
npm run test:core      # ルールと保存（peta-core / peta-pass。Linux でも動く）
npm run test:harness   # 実コードを偽の Tauri で動かす Rust ハーネス
npm run check:mac      # アプリ全体の型検査（macOS のみ）
```

画面を実際に描画して確かめるチェック（CSP・幅ごとの崩れ・Boards など）は `scripts/check-*.mjs` にあり、Playwright で動きます。Workers は各 `cloudflare/*` で `npm test` と `npm run check`。すべて GitHub Actions（`.github/workflows/ci.yml`）で push ごとに実行されます。

macOS 固有の動き（窓のレベル、Retina、VoiceOver など）は [docs/port-spec/macos-checklist.md](docs/port-spec/macos-checklist.md) で実機確認します。

## 構成

```
src/                      画面（ビルドなしの素の JS / CSS）
  app.html, app/js/       メインの窓。ページごとのスクリプト（today, create, book, studio, packs, market …）
  app/css/base.css        デザイントークン（色・影・書体）。Day / Night
  index.html, main.js     デスクトップに貼る透明レイヤー
  arrival.*               デスクトップに届く封筒の通知
  art/, fonts/            描いた素材と同梱フォント
src-tauri/
  src/                    Tauri のコマンド、窓、メニューバー、更新（macOS）
  crates/core/            ルールと保存。SQLite、署名、版つきパック、Gift、素材の描画、Apple Vision（segment.rs）
  crates/peta-pass/       公式の署名つき配布を作る CLI
cloudflare/               友達・受信箱・Market の審判役（peta-api）、管理画面（peta-admin）、ダウンロード（peta-download）
tests/                    画面側のテストと Rust ハーネス
scripts/                  ビルド・配布・検証の道具（scripts/README.md）
docs/                     決定・設計・手順（docs/README.md）
```
