# Codex への依頼: 切り抜きを Apple Vision の前景抽出に切り替える(Mac 専用化)

**使い方**: この文書の全文を Codex に渡す。**実装の指示**(Rust・必要なら小さな Swift/Objective-C)で、画像制作・見た目のデザインではない。作業は **Step 順**。各 Step の終わりに `cargo test --manifest-path src-tauri/Cargo.toml --workspace` と `npm test` を通す。

> 日本語で指示。コード中のコメントと UI の文言は、既存に合わせて**英語**。説明文書は日本語。

**背景(決定済み、`docs/decisions.md` 2026-10-11)**: Peta は **Mac 専用**にする。背景除去は、いまの同梱 U²-Net(`u2netp.onnx` を純Rust の `tract` で実行、`src-tauri/crates/core/src/segment.rs`)をやめて、macOS 標準の **Vision の前景抽出**(`VNGenerateForegroundInstanceMaskRequest`)に切り替える。速く、細部の精度が高い見込み。Windows / Linux は対象外。

---

# 0. 範囲

## やること

1. `segment.rs` の背景除去を Vision に置き換える(結果は、いまと同じ「0..255 の濃淡マスク」)。
2. **対応する macOS の下限を 14.0 にする**(`VNGenerateForegroundInstanceMaskRequest` が macOS 14 以降のため)。`tauri.conf.json` の `bundle.macOS.minimumSystemVersion` を `"14.0"` にする(開発者版の設定ファイルも同様)。
3. 使わなくなるものを消す: `tract-onnx` / `tract-linalg` の依存、`src-tauri/models/`(`u2netp.onnx` と README)、`include_bytes!`、`PETA_MODEL`、`KNOWN_MODELS`、モデルの選択まわり。
4. ドキュメント: `docs/decisions.md` の「背景除去」の2行(2026-10-02)を「置き換え済み」と注記して、新しい決定を1行足す。README の該当節を直す。報告 `docs/vision-cutout-report.md`。

## やらないこと

- 切り抜き後の仕上げ(輪郭のなめらかさ、Erase / Restore のブラシ、Cutout adjust、ダイカット風の白い縁)は**変えない**。`cutout.rs` と `creator.rs` のそれ以降の流れは、入力のマスクが同じ形であればそのまま動く。
- UI の見た目・文言は変えない(エラーの文言だけ §3.4)。
- Windows / Linux 向けのコードの削除は、**別コミット**(Step 4)でやる。Step 1〜3 では触らない。

---

# 1. 共通ルール

- 作業前に `README.md`、`docs/decisions.md`(特に「背景除去」「切り抜きの補正」「Cutting Mat」の行)、`src-tauri/crates/core/src/segment.rs`、`creator.rs`(`Session` と、`Segmenter` を呼んでいる箇所)、`cutout.rs`、`src-tauri/models/README.md` を読む。
- **既存のテストを壊さない**。特に `an_opaque_photo_without_a_model_is_a_clear_error`、`nothing_cut_out_is_reported` に当たる挙動(被写体が見つからないときの、分かりやすいエラー)は保つ。
- Vision の呼び出しは、**メインスレッドを塞がない**(重い処理は `spawn_blocking` など、いまの `Segmenter` の呼び出しと同じ位置)。
- コードは周囲のスタイルに合わせる。**ネイティブ呼び出しは、できるだけ小さい面積**(1つのモジュールに閉じ込める)にする。
- 秘密・個人情報を書かない。コードに実機の絶対パスを入れない。

---

# 2. Step 1: 方式の確認(スパイク)

Vision を Rust から呼ぶ方法を決める。次の2案を、小さく試して、**速さ・コード量・保守性**で比べ、結果を `docs/vision-cutout-report.md` に書いてから選ぶ。

- **案 A(第一候補)**: `objc2` 系の crate(`objc2-vision`、`objc2-foundation`、`objc2-core-video` など。`Cargo.toml` の `objc2 = "0.6"` に合わせる)で、Rust から直接呼ぶ。`VNImageRequestHandler` と `VNGenerateForegroundInstanceMaskRequest`、`VNInstanceMaskObservation` が使えること、必要な feature を確認する。
- **案 B**: 小さな Swift(または Objective-C)の薄い層を、`build.rs` でビルドして C ABI で呼ぶ。案 A で型が足りない・扱いにくい場合の逃げ道。

**決めたら、そのあとは1つの方式だけを実装する**(両方残さない)。

---

# 3. Step 2: Vision の実装

## 3.1 入力と出力

- 入力: いまの `Segmenter` と同じ `RgbaImage`(`decode_oriented` で向きを直したもの)。
- 出力: **元画像と同じ大きさ**の `GrayImage`(0..255)。いまのマスクの意味と同じ(255 = 被写体)。
- 関数の形は、既存の呼び出し側を最小限しか変えないようにする(例: `segment::foreground_mask(&RgbaImage) -> Result<GrayImage>`)。`Segmenter` の構造体は、モデルを持たない形に簡単にするか、なくす。

## 3.2 Vision の使い方

1. `RgbaImage` から `CGImage`(または `CIImage`)を作る(`CGBitmapContext` / `CGDataProvider`)。色空間は sRGB。
2. `VNImageRequestHandler` を作り、`VNGenerateForegroundInstanceMaskRequest` を実行する。
3. `VNInstanceMaskObservation` の **`allInstances`**(見つかった前景の全部)を選び、`generateScaledMaskForImageForInstances:fromRequestHandler:error:` で、**入力画像の大きさに合わせたマスク**(`CVPixelBuffer`)を得る。
4. `CVPixelBuffer` を `GrayImage` に変換する(`kCVPixelFormatType_OneComponent8` と `OneComponent32Float` の両方を扱う。ロック・アンロックを忘れない)。
5. 前景が1つも見つからないとき(`allInstances` が空)は、**既存の「被写体が見つからない」エラー**を返す。

## 3.3 性能と品質

- 入力が大きい(長辺 4000px 超など)ときは、Vision に渡す前に、長辺 2048px 程度に縮小してよい。マスクは、元の大きさに戻す(滑らかに補間)。**最終の画質を落とさない**ため、元の画像そのものは、いまのとおりに保つ。
- 目安: 12MP の写真で、Mac の実機で **1 秒前後**(いまの u2netp は約1.4秒)。計測値を報告に書く。
- マスクの縁は、いまの仕上げ(`cutout.rs` の edge-snapping・outline)が、同じように効くことを、サンプル画像で見て確かめる。

## 3.4 エラーと対応 OS

- macOS 14 未満では、`tauri.conf.json` の `minimumSystemVersion` で、そもそも起動しない。念のため、実行時にも `NSProcessInfo` で版を確認し、足りなければ `Error::Model("Cutting out needs macOS 14 or later.")` を返す(UI にはそのまま出る)。
- Vision がエラーを返したとき(メモリ不足など)は、元のエラー文を含めた `Error::Model(...)` にする。**パニックしない**。

## 3.5 テスト(macOS 上でだけ動く)

- リポジトリにあるサンプル画像(`assets-src/` や `src/art/samples/` の写真・絵)を使い、次を確認する(`#[cfg(target_os = "macos")]`)。
  - 被写体が1つはっきりある画像: マスクの面積が、全体の 5%〜95% の間。端のほうが 255 でない(全面塗りでない)。
  - 真っ白・真っ黒の無地の画像: 「被写体が見つからない」エラー。
  - 向きのある画像(EXIF 回転): 回転後の向きでマスクが取れる。
  - 同じ画像を2回実行して、マスクが同じ(再現性)。
- 非 macOS で `cargo test` が落ちないよう、Vision のテストは `cfg` で囲む(Step 4 でこの `cfg` ごと整理する)。

---

# 4. Step 3: 後片付け

- `Cargo.toml` から `tract-onnx` / `tract-linalg` を消す。`cargo build` と `cargo test` が通ることを確認する。
- `src-tauri/models/` を削除(`u2netp.onnx`、`README.md`)。`include_bytes!` と `PETA_MODEL`、`KNOWN_MODELS`、`ModelSpec` を削除。`README.md` と `docs/` の、モデルを選ぶ説明を消す。
- バンドルのサイズが減ることを、`npm run build` 後の `.app` のサイズで確認して、報告に書く。
- `docs/decisions.md`: 2026-10-02 の「背景除去」「背景除去: 大きいモデル」の2行の末尾に「**2026-10-11 に Apple Vision へ置き換え**」と注記し、新しい行を1行足す(方式、macOS 14 以上、計測値)。

---

# 5. Step 4(別コミット): Mac 専用の整理

Step 1〜3 が通って、報告まで出したあとに、別のコミットとして行う。**挙動を変えない**ことを、テストで確認する。

- `platform/windows.rs`、Windows 向けの `cfg(target_os = "windows")` の分岐、Windows 向けの依存・設定を削除する。
- `cfg(not(target_os = "macos"))` の代替実装(たとえば `link_tags.rs` の「Mac only」エラー)を、Mac 前提の素直なコードにする。
- `README.md` と `docs/` の、Windows / Linux への言及を整理する(`docs/port-spec/` は歴史的な資料なので、冒頭に「Mac 専用になったため参考」と注記するだけにする)。
- `npm run check:mac` と `cargo test` が通ること。

---

# 6. 受け入れ条件

- [ ] 同梱モデルなしで、写真から切り抜けて、ステッカーが作れる(Create の一連の流れが、いまと同じに動く)。
- [ ] 前景が見つからない画像で、分かりやすいエラーが出る。
- [ ] 細い部分(ひげ・髪・腕)の切り抜きが、いまより悪くならない(サンプル画像の比較を、報告に画像で載せる)。
- [ ] `tract-onnx` と `u2netp.onnx` が、依存・リポジトリ・バンドルから消えている。
- [ ] 12MP の写真で、1 秒前後。計測を報告に書く。
- [ ] `minimumSystemVersion` が 14.0。実機(macOS 14 以降)での確認項目を `docs/port-spec/macos-checklist.md` に追記。
- [ ] `cargo test --workspace` と `npm test` が通る。`docs/decisions.md` と `README.md` が更新されている。

**実機でしか確認できないこと**(オーナーがやる): 実際の写真での切り抜きの見た目、macOS 14 以上での起動、Create の操作感。
