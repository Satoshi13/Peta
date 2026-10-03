# Paper realism — 完了レポート

紙タブ7色・紙テクスチャ2種の確認用納品（`7ca0a1e`）に続き、オーナーの「続けて」を受けて残り36点を納品しました。今回の依頼全体では45点（44追加・1差し替え）、全カタログは171素材です。対象ブランチは `claude/relaxed-dijkstra-ocnjzu`。納品前にオーナー側のプロトタイプ更新 `ff99d2a` を fast-forward で取り込みました。初期の紙素材などを適用したその更新を保持し、今回の素材追加はその上に重ねています。

紙の繊維・断面・接着帯・浮き、小口と表紙の摩耗を、既存 Holographic カード・銀袋・封筒・ワックスシールと同じ左上の光で揃えました。`src/art/preview.html` には旧版／新版のノート模型、46pxのタブ、メモと14px文字、6種の Peta!、縦横タイルと9スライス比較があります。プロトタイプの CSS・JS・HTML、アプリ実装は変更していません。

## 納品した素材

| ファイル（src/art/ 以下） | サイズ | bytes | 採用候補 |
|---|---:|---:|---:|
| book/page-paper.jpg | 1024 × 1024 | 149,172 | 3 / 4 |
| tabs/tab-paper-cream.png | 320 × 128 | 55,477 | 2 / 4 |
| tabs/tab-paper-pink.png | 320 × 128 | 57,371 | 2 / 4 |
| tabs/tab-paper-kraft.png | 320 × 128 | 71,065 | 1 / 4 |
| tabs/tab-paper-sky.png | 320 × 128 | 55,909 | 2 / 4 |
| tabs/tab-paper-mint.png | 320 × 128 | 53,736 | 2 / 4 |
| tabs/tab-paper-lemon.png | 320 × 128 | 55,024 | 4 / 4 |
| tabs/tab-paper-grey.png | 320 × 128 | 55,623 | 2 / 4 |
| book/cover-board.jpg | 1024 × 1024 | 172,085 | 2 / 4 |
| tabs/tab-film-pink.png | 320 × 128 | 51,832 | 1 / 4 |
| tabs/tab-film-sky.png | 320 × 128 | 51,434 | 1 / 4 |
| tabs/tab-film-mint.png | 320 × 128 | 51,406 | 1 / 4 |
| tabs/tab-film-lemon.png | 320 × 128 | 51,020 | 1 / 4 |
| tabs/tab-film-orange.png | 320 × 128 | 52,429 | 1 / 4 |
| tabs/tab-film-lilac.png | 320 × 128 | 51,599 | 1 / 4 |
| notes/note-sticky-yellow.png | 640 × 640 | 78,445 | 1 / 4 |
| notes/note-sticky-pink.png | 640 × 640 | 280,716 | 1 / 4 |
| notes/note-sticky-mint.png | 640 × 640 | 292,486 | 1 / 4 |
| notes/note-sticky-sky.png | 640 × 640 | 287,640 | 1 / 4 |
| tabs/tab-washi-stripe.png | 360 × 128 | 53,836 | 1 / 4 |
| tabs/tab-washi-dot.png | 360 × 128 | 48,573 | 1 / 4 |
| tabs/tab-washi-plain.png | 360 × 128 | 49,536 | 1 / 4 |
| notes/note-sticky-pad-yellow.png | 720 × 720 | 115,444 | 3 / 4 |
| notes/note-sticky-pad-pink.png | 720 × 720 | 80,593 | 3 / 4 |
| notes/note-index-card-blank.png | 900 × 600 | 66,778 | 2 / 4 |
| notes/note-index-card-ruled.png | 900 × 600 | 83,427 | 2 / 4 |
| notes/note-index-card-dot.png | 900 × 600 | 83,032 | 2 / 4 |
| notes/note-memo-torn-cream.png | 800 × 480 | 217,740 | 1 / 4 |
| notes/note-memo-torn-kraft.png | 800 × 480 | 125,827 | 1 / 4 |
| notes/note-memo-torn-lined.png | 800 × 480 | 211,872 | 1 / 4 |
| book/cover-edge.png | 640 × 640 | 242,450 | 1 / 4 |
| tabs/tab-shadow-strip.png | 64 × 1000 | 1,655 | 1 / 4 |
| book/page-gutter.png | 160 × 1000 | 2,325 | 1 / 4 |
| book/page-dots.png | 512 × 512 | 5,346 | 1 / 4 |
| book/page-corner-curl.png | 200 × 200 | 38,026 | 2 / 4 |
| fx/peta-tag-flag.png | 480 × 200 | 94,884 | 1 / 4 |
| fx/peta-tag-stamp.png | 480 × 220 | 54,342 | 1 / 4 |
| fx/peta-tag-holo.png | 480 × 200 | 116,451 | 1 / 4 |
| fx/peta-tag-torn.png | 480 × 240 | 120,716 | 1 / 4 |
| fx/peta-tag-round.png | 360 × 360 | 136,315 | 1 / 4 |
| fx/peta-tag-bubble.png | 480 × 320 | 151,100 | 1 / 4 |
| book/page-edge-bottom.png | 1000 × 64 | 72,918 | 1 / 4 |
| book/page-edge-right.png | 64 × 1000 | 76,953 | 1 / 4・派生 |
| notes/paper-clip.png | 256 × 256 | 33,140 | 1 / 4・既存版再利用 |
| notes/binder-clip.png | 256 × 256 | 47,563 | 1 / 4・既存版再利用 |

紙タブを第一候補、フィルムとマステを第二・第三候補として並べています。フィルムの左半分は不透明な白い書き込み帯、右半分は約60%の色フィルムです。マステは折り返しと重なり、メモは接着帯・束の厚み・破れの白い繊維を残しています。クリームメモだけに小さな月と二つの星があります。情報カードは右上の穴と淡い断面を持ちます。

各生成素材について4候補を比較し、中央の文字面が静かで、既存のカード・銀袋の隣で浮かない候補を選びました。付箋の束は繊維が強すぎない候補3、情報カードは静かな候補2を採用しています。紙クリップとバインダークリップは、前回の4候補比較で採用した `ui/*` をバイト単位で再利用しました。ページ右の小口は下の小口の90度回転、gutterは影帯と同じ陰影から派生し、光と密度を揃えています。

原画、各4候補、プロンプトと書き出し処理は `assets-src/art/paper-realism/` に保存し、Git対象外です。高解像度原画から切り出し、輪郭・不透明度・sRGB・容量・パレット・タイル周期を正規化して書き出しました。manifestには実寸・bytes・用途・プロンプト・採用候補・半透明領域・9スライス・ドット周期を記録しています。

## 旧版との比較

旧タブは均一な角丸とグラデーションが形を支配していました。新版は切り口の淡い断面、色ごとに違う小さな縁の揺れ、繊維、接着線があります。高さ46pxでも7色と短い接地影を確認できます。フィルムの色部分を通して背景の線が見え、根元の白い帯では線が隠れます。

旧ノートは均一なクリームの面と規則的な点、茶色い一枚面の表紙が中心でした。新版は細い繊維と微かな雲状のムラ、薄い印刷ドット、摩耗した灰色い芯材、白い小口、綴じ側のたわみと小さな右下の浮きを独立したレイヤーとして重ねています。既存スプリングはそのまま使用しています。

既存メモより破れ縁の白い繊維、接着テープと紙の不透明度、束の重なりを明確にしました。Peta! は既存タグに近い友好的な筆記体を維持し、破れ紙・丸・吹き出し・マステ旗・赤い二重枠のゴム印・ホログラムリボンを揃えました。ゴム印のインクは `#B8665B` を基準に濃淡を残しています。画像の文字はこの6種の正確な `Peta!` のみです。

## 比較資料

- [素材一覧・旧版／新版のノート模型](../src/art/preview.html)：冒頭に完成比較、続いてフィルム・マステ・メモ・Peta! と9スライス。背景を切り替えられます。
- ノート比較：[ライト](paper-realism/comparison-light.jpg) / [ダーク](paper-realism/comparison-dark.jpg) / [壁紙風](paper-realism/comparison-wallpaper.jpg)
- 残りの素材：[ライト](paper-realism/parts-light.jpg) / [ダーク](paper-realism/parts-dark.jpg) / [壁紙風](paper-realism/parts-wallpaper.jpg)
- 四候補比較：[最初の9点](paper-realism/candidates.jpg) / [残り34組・小口右とgutterは派生](paper-realism/rest-candidates.jpg)
- 制作前の実プロトタイプ：[A Notebook](paper-realism/prototype-before-notebook.jpg) / [B Desk](paper-realism/prototype-before-desk.jpg) / [C Studio](paper-realism/prototype-before-studio.jpg)
- [差し替え前の page-paper](paper-realism/page-paper-before.jpg)

## 検証

- `python scripts/art-check.py`：171素材、合計 24,240,445 bytes、合格。sRGB、RGBA、紙面alpha255、無彩色の影alpha≤30・6px以内、容量、manifest、既存hook、原画のGit除外を確認。
- 各画像600KB以下、テクスチャ500KB以下。今回の書き出しは各300KB以内で、全素材25MBの既存上限も満たしています。
- 半透明例外を別途画素確認：フィルムの白帯alpha255、色部分alpha153（指定55〜70%内）、メモの中央紙面alpha255・上辺の露出テープalpha≤160。影帯とgutterはRGB43の無彩色・最大alpha28・幅6px以内、上下の境界画素が一致。
- cover-edgeの中央448×448pxは完全透明。96px角を保つ9スライスを正方形と横長で確認。ページ右・下の小口は回転一致。スプリング一式と既存の完成ノート素材はバイト単位で維持。
- 印刷ドットは23×23点、最大alpha30以下、上下左右境界が一致。512px画像のままでは22が512を割り切れないため、ネイティブ間隔は512/23≒22.261pxです。**背景サイズを506×506pxにすると正確に22px間隔**になります。プレビューでこの設定を使用し、manifestにも記録しています。乗算での利用を想定しています。
- ページ紙の平均RGBは249.91 / 246.11 / 235.74、輝度標準偏差3.399。表紙は200.81 / 168.04 / 120.12、標準偏差6.024。JPEG読戻し後の縦横境界差は約1.12〜1.16 / 255。256px周期の縦横2タイルで境界を確認。
- 紙と文字色 `#2B2A28` の最小コントラストは8.26:1。ページと破れメモに14pxの英語・日本語を重ねて確認しました。
- Chromium：全171画像のデコード、P0/P1フィルター、紙タブ7色と代替タブ9点の高さ46px、14px文字、506pxドット周期、3背景、候補画像の読込みを確認。目視で白黒ハロー・市松の焼き込み・不要な文字を確認し、認めませんでした。
- `npm test`：13件成功、失敗・スキップ0件。
- `git diff --check`：成功。

## 既存ノート素材の扱い・統合時の注意

| 既存素材 | 判断 | 理由 |
|---|---|---|
| spiral-binding / coil / holes / caps / graphite | 維持 | オーナー指定どおり、綴じの周期・位相・光を保持 |
| cover-kraft.png | 維持 | 青い花と構図を持つ完成イラスト。既存のサムネイル用途を維持し、伸縮するノート表紙は新しいboard＋edgeを使用する方針 |
| page-right.jpg / page-left.jpg | 維持 | 既存の穴・ドットを含む見開き完成素材。新しい紙＋ドット＋小口とは別の完成構図として残し、二重のドット・縁を重ねない |
| notebook-page.png | 維持 | 従来の9スライス完成ページ。新版の独立レイヤー構成は比較模型に示し、既存利用先への一律差し替えは行わない |
| page-paper.jpg | 置き換え済み | 指定1024×1024の継ぎ目なし無地紙。旧版を比較資料に保存 |

画像の制作で残した未完了点はありません。アプリと触れるプロトタイプへのCSS・JS統合は依頼どおりオーナー実装です。既存Collectionの `art/p1.css .page` は同じ `page-paper.jpg` を参照するため無地の新紙になります。ドットを表示する場合は新しい `page-dots.png` を506px周期・乗算で重ねてください。表紙の縁は9スライスで中央をfillせず、新しいboardを背面に敷きます。フィルムのラベルは白い左半分に、選択中タブの引き出しは位置変更で実装できます。
