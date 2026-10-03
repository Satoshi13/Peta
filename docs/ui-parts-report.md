# UI parts — P0 notebook review

依頼の §5.1「まず P0 のノート類だけを作り、旧版と並べて出して止まる」の確認用納品です。
Today のその他の部品・P1 は未着手です。スプリングの造形はオーナーの確認待ちで、全 UI 部品の完了ではありません。

対象は `claude/relaxed-dijkstra-ocnjzu`。最初に選ばれた `claude/hopeful-ride-n1i6ms` には Paper Desk が無く、Paper Desk と UI proposals がある `ec255a4` を基点にしました。

## 作ったもの

| ファイル (`src/art/` 以下) | 実ピクセル | bytes |
|---|---:|---:|
| book/spiral-binding.png | 128 × 1000 | 12,729 |
| book/spiral-coil.png | 128 × 1000 | 10,893 |
| book/spiral-holes.png | 128 × 1000 | 6,231 |
| book/spiral-binding-graphite.png | 128 × 1000 | 12,412 |
| book/spiral-cap-top.png | 128 × 64 | 8,113 |
| book/spiral-cap-bottom.png | 128 × 64 | 8,315 |
| book/notebook-page.png | 1200 × 900 | 436,219 |
| book/cover-kraft.png | 1600 × 1100 | 232,360 |
| book/page-left.jpg | 1400 × 1000 | 56,146 |
| book/page-right.jpg | 1400 × 1000 | 56,050 |
| today/choice-collection.png | 384 × 384 | 18,120 |

銀・グラファイト・ページの各マスターを4候補ずつ生成。銀は1回、グラファイトは1回再生成して描き込みと反射を抑えました。銀候補1を採用し、表紙・小ノートにも4候補の綴じを合成して比較しました。元画像・候補・英語プロンプト・書き出し処理は `assets-src/art/ui-parts/` に保存し、Git 対象外です。納品素材には manifest の必須項目と実ファイルの bytes を登録しています。

表紙の紙・青い花・エンボス格子は既存の画素を維持し、旧綴じの部分だけを差し替えました。112px 表示の小ノートは、輪が潰れないよう10組の大きな綴じに簡略化しています。1000px の共通帯は、中心 y=25+50·k、20組です。

CSS は指定された Today `.book::before` と Collection `.spiral` の画像 URL だけを変更しました。JS・Rust・アプリ HTML・既存 DOM id・依存関係・ロックファイルは変更していません。

## 旧版との比較

- [比較プレビュー](../src/art/preview.html)：旧 C 字 / 新しい二重ワイヤー、112px サムネイル、2タイルの継ぎ目、既存カード・Pack の隣での質感を比較できます。背景の切り替えと素材一覧も維持しています。
- 静止画：[ライト](ui-parts/comparison-light.jpg) / [ダーク](ui-parts/comparison-dark.jpg) / [壁紙風](ui-parts/comparison-wallpaper.jpg)。
- [4候補の比較](ui-parts/candidate-thumbnails.jpg)。最終採用サムネイルの10組への簡略化は、上記の最終比較を参照してください。
- Today の実 HTML/CSS：[ライト](ui-parts/today-book-light.jpg) / [ダーク](ui-parts/today-book-dark.jpg)。ネイティブ IPC は検証用のモックです。

新版は奥のワイヤー・明るい手前のワイヤー・穴への入り口が区別できます。素材カードと Pack を主役にし、表紙の色や花を変えず、金属の描き込みを小さな面へ抑えました。ライト・ダーク・壁紙風で市松の焼き込みや外側の白黒ハローは見えませんでした。暗い紙上では穴の周囲のクリームが明るい点に見えるので、この造形でよいか確認が必要です。

## 検証

- `python scripts/art-check.py`：98素材、合計15,461,199 bytes、合格。sRGB、PNG RGBA、内側 alpha 255、無彩色の接地影 alpha≤30・6px以内、容量、manifest、既存レイヤーの合成一致、DOM hook、原画の Git 除外を検査。
- ノート固有の検査：`spiral-holes` → `spiral-coil` の合成が `spiral-binding` と全画素で一致。50px 周期が全行一致し、1000px に20組。最初と最後の透明行も一致。キャップは完成帯の最初・最後64pxと一致。
- `npm test`：13件成功、失敗・スキップ0件。
- Chromium：98素材の全画像を読み込み、一覧数・P0フィルター・112px表示・3背景・Today/Collection の参照 URL とライト/ダーク表示を確認。IPC をモックした見た目の検査で、macOS のネイティブ起動は検証していません。
- `git diff --check`：成功。

9スライスページは角90px、左の綴じ代128px。キャップは高さ50×N pxの帯の最初・最後64pxに重ねて使い、帯上端からの背景位相を維持します。キャップと9スライスページのアプリへの追加組み込みは確認後です。

## 直せなかった点・次の確認

**Collection の背景に描いた穴と、別レイヤーの綴じの縮尺が一致しません。** 元の `.page` は `background-size: cover`、`.spiral` は幅48pxの固定タイルです。検証時のページ832×631pxでは、背景の穴の周期31.55pxに対して綴じの周期18.75pxとなり、穴の列が綴じの右側にずれます。原寸のページ画像と穴レイヤーは同位相ですが、実画面での整列は未達です。[ライト](ui-parts/collection-page-light.jpg) / [ダーク](ui-parts/collection-page-dark.jpg)で残る問題を確認できます。

CSS の URL だけでは任意のウィンドウサイズで一致させられません。背景の紙と穴の描画を別にし、穴を綴じと同じ固定タイルで描く等の CSS 調整が必要です。今回は指定範囲を守り、追加の CSS プロパティ・JS・DOM は変更していません。この問題を含め、ノート類の組み込み完了とは扱っていません。

まずスプリングの造形と既存素材とのなじみを確認してください。確認後に Collection の整列方法を調整し、残りの Today 部品・P1 へ進む段階です。
