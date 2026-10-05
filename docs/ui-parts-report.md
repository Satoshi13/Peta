# UI parts — notebook binding, seals, tray, labels

ノートの確認段階を経て、P0 の Today 部品と P1 の Pack・文具小物まで納品しました。前段の11点に今回29点を追加し、計40点を制作・更新しています。素材一覧は全127点です。

対象ブランチは `claude/relaxed-dijkstra-ocnjzu`。Paper Desk のあるブランチで継続し、作業中の上流更新を `184f135` まで取り込みました。下記の変更は画像・指定された CSS art hook・manifest・比較プレビュー・このレポートです。アプリの JS / Rust / HTML / DOM id・依存関係・ロックファイルは変更していません。上流のプロトタイプ更新は保持しています。

## 作ったもの

| ファイル（src/art/ 以下） | サイズ | bytes |
|---|---:|---:|
| book/cover-kraft.png | 1600 × 1100 | 232,360 |
| today/choice-collection.png | 384 × 384 | 18,120 |
| book/page-left.jpg | 1400 × 1000 | 56,146 |
| book/page-right.jpg | 1400 × 1000 | 56,050 |
| book/spiral-holes.png | 128 × 1000 | 6,231 |
| book/spiral-coil.png | 128 × 1000 | 10,893 |
| book/spiral-binding.png | 128 × 1000 | 12,729 |
| book/spiral-binding-graphite.png | 128 × 1000 | 12,412 |
| book/spiral-cap-top.png | 128 × 64 | 8,113 |
| book/spiral-cap-bottom.png | 128 × 64 | 8,315 |
| book/notebook-page.png | 1200 × 900 | 436,219 |
| ui/seal-common.png | 320 × 112 | 21,848 |
| ui/seal-uncommon.png | 320 × 112 | 30,608 |
| ui/seal-rare.png | 320 × 112 | 30,927 |
| ui/seal-special.png | 320 × 112 | 37,800 |
| ui/seal-archive.png | 320 × 112 | 27,787 |
| ui/material-tray.png | 1120 × 400 | 420,080 |
| ui/button-label.png | 720 × 200 | 142,269 |
| ui/button-label-pressed.png | 720 × 200 | 141,807 |
| ui/card-locked.png | 560 × 380 | 148,244 |
| ui/date-stamp.png | 480 × 160 | 20,395 |
| ui/tape-5.png | 480 × 140 | 48,873 |
| ui/tape-6.png | 480 × 140 | 50,384 |
| ui/tape-7.png | 480 × 140 | 47,677 |
| ui/tape-8.png | 480 × 140 | 53,208 |
| pack/pack-kraft.png | 768 × 1024 | 331,802 |
| pack/pack-matte.png | 768 × 1024 | 566,416 |
| pack/pack-holographic.png | 768 × 1024 | 509,741 |
| ui/tag-cream.png | 360 × 440 | 87,299 |
| ui/tag-kraft.png | 360 × 440 | 113,767 |
| ui/index-card-blank.png | 900 × 600 | 355,659 |
| ui/index-card-ruled.png | 900 × 600 | 305,830 |
| ui/index-card-dot.png | 900 × 600 | 314,036 |
| ui/memo-torn.png | 640 × 400 | 220,767 |
| ui/paper-clip.png | 256 × 256 | 33,140 |
| ui/binder-clip.png | 256 × 256 | 47,563 |
| ui/pocket-back.png | 1200 × 520 | 153,320 |
| ui/pocket-front.png | 1200 × 520 | 125,389 |
| book/page-paper.jpg | 1400 × 1000 | 44,490 |
| ui/tag.png | 360 × 440 | 87,299 |

各新規原画は4候補を生成し、既存素材の隣で描き込みの少ない案を選びました。薄いラベル、無地トレイ、白い未獲得カードは候補1。Rare は最も静かな候補4、Matte Pack は候補2を採用しました。押下ボタンは同じ4候補の通常ラベルから1px沈めた状態を派生し、影を浅くしています。荷札の汎用 `tag.png` は cream 版と同一ファイルです。

Holographic Pack は4候補も比較しましたが、既存のお気に入り `pack-pouch-closed.png` を採用して `pack-holographic.png` として納品しました。両者はバイト単位で一致します。銀袋の輪郭、箔の彩度、描き込み量を保っています。

高解像度の原画・候補・生成プロンプト・書き出し処理は `assets-src/art/ui-parts/` 以下に保存し、Git 対象外です。manifest に必須項目、実寸、bytes、採用候補、9スライス幅、用途、透過例外、ポケットのレイヤー座標を登録しています。

## 適用先と所見

- Today：レアリティ5種のシール、80px 9スライスの浅いトレイ、日付のゴム印枠、レアリティ別の留めテープを指定 hook へ適用しました。文字は引き続きコードが重ねます。
- Open / Make this Peta：共有 `art/art.css` の `button.primary` へ通常・押下のラベルを適用しました。80px 9スライスで中央だけが伸びます。画像内の1px沈みを使うため、押下時の CSS 移動と大きな影を取り除きました。
- Today Material Book：40px 幅の完成綴じ、ライト背景の90px 9スライスページを適用。ダークの紙色は既存の暗い背景を維持しています。
- Collection：未獲得カードの既存 `.material[data-locked="true"] .swatch` へ専用の白いカードを適用。「?」は既存コードの文字です。
- P1：素材別 Pack、荷札、情報カード、メモ、クリップ、ポケットを納品し、プレビューで比較。将来案のためアプリの機能・DOM は追加していません。

旧 C 字の綴じに対して、新版は手前の明るい二重ワイヤー、奥のワイヤー、穴の入口を区別できます。表紙の紙・青い花・格子は既存の画素を維持しています。小ノートは112px表示で輪を読めるよう10組に簡略化しました。共通帯は原寸50px周期、中心 y=25+50·k、1000px に20組です。

前段で残っていた **Collection の二重の穴の列を解消しました**。`background-size: cover` のページに穴を焼き込むと、固定幅の綴じと倍率がずれます。今回は既存の紙・ドットを保つ穴なしの `page-paper.jpg` へ背景 URL を変更し、完成綴じの穴だけを描画します。720 / 1000 / 1280px の画面幅で参照と表示を確認しました。納品の `page-left/right.jpg` は原寸で穴を合わせた版のままです。

新しい文具の紙とラベルは低彩度に抑え、素材カードを主役にしています。ライト・ダーク・壁紙風で市松の焼き込みや外周の白黒ハローは見えませんでした。ポケットは同じ原画を前板の上端 y=248 で分割し、後板 → カード → 前板の順で重ねると、破線ステッチの下へカードが挟まります。

## 比較プレビュー

- [全素材・旧版との比較・3背景切り替え](../src/art/preview.html)
- ノート：[ライト](ui-parts/comparison-light.jpg) / [ダーク](ui-parts/comparison-dark.jpg) / [壁紙風](ui-parts/comparison-wallpaper.jpg)
- 専用パーツ：[ライト](ui-parts/parts-light.jpg) / [ダーク](ui-parts/parts-dark.jpg) / [壁紙風](ui-parts/parts-wallpaper.jpg)
- [全4候補の縮小比較](ui-parts/parts-candidates.jpg) / [ノート4候補](ui-parts/candidate-thumbnails.jpg)
- Today 実画面：[ライト](ui-parts/today-parts-light.jpg) / [ダーク](ui-parts/today-parts-dark.jpg)
- 押下ボタン：[ライト](ui-parts/today-pressed-light.jpg) / [ダーク](ui-parts/today-pressed-dark.jpg)
- Collection の紙と綴じ：[ライト](ui-parts/collection-page-light.jpg) / [ダーク](ui-parts/collection-page-dark.jpg)
- 未獲得カード：[ライト](ui-parts/locked-cards-light.jpg) / [ダーク](ui-parts/locked-cards-dark.jpg)
- Creator：[ライト](ui-parts/creator-label-light.jpg) / [ダーク](ui-parts/creator-label-dark.jpg)

## 検証と実装上の扱い

- `python scripts/art-check.py`：127素材、合計19,979,624 bytes、合格。sRGB、RGBA、内側 alpha 255、無彩色の影 alpha≤30・6px以内、容量、manifest、既存 hook、原画の Git 除外を検査。各画像600KB以下、テクスチャ500KB以下。
- ノート固有の確認：holes → coil の合成が binding と全画素一致。50px 周期が全行一致し、キャップも完成帯の最初・最後64pxと一致。
- ポケット：前板・後板の合成が同じ書き出しマスターと全画素一致。共通1200×520キャンバスで位置と影を共有。
- `npm test`：13件成功、失敗・スキップ0件。
- Chromium：127素材の読み込み、P0/P1 フィルター、3背景、全候補、Today の日付・トレイ・シール・レアリティ別テープ・通常／押下ボタン、Collection の3画面幅と未獲得カード、Creator のボタンをライト／ダークで確認。
- `git diff --check`：成功。

ネイティブ IPC はブラウザ検証用のモックです。macOS / Windows のネイティブ起動は未検証です。綴じキャップは納品のみで、既存 DOM に新レイヤーを追加していません。有限帯へ組み込む場合は高さ50×N pxの最初・最後64pxに重ね、上端からの位相を維持してください。P1 の新パーツも将来の配置用素材としての納品です。画像内に文字・ロゴは焼き込んでいません。
