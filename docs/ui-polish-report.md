# UI polish — 完了レポート

先行8点（しおり、棚板と影、月タブ5色）の確認用納品 `2e0c92d` に続き、オーナーの「続けて」を受けて**未制作だった47点を完了**しました。つまみは真鍮と紙の2案を比較できるよう、`slider-knob-paper.png` を1点追加しました。今回の追加は48点、UI polish依頼全体は56点、全カタログは227素材です。未制作項目は残っていません。

対象ブランチは `claude/relaxed-dijkstra-ocnjzu`。制作中に `8dea06a`、納品前に先行8点を適用したオーナー側更新 `519ef18` をfast-forwardで取り込み、保持しました。操作部品、6種の裏紙、3方向のウィンドウ上端、4種類の手作り✕と状態差分、P1・P2を、既存のカード・銀袋・封蝋・紙タブと同じ左上の光で揃えています。**プロトタイプとアプリのCSS・JS・HTML・Rust実装は変更していません。** 素材プレビューに比較模型と操作確認を追加しました。

## 納品した素材

| ファイル（src/art/ 以下） | サイズ | bytes | 採用候補 |
|---|---:|---:|---:|
| ui/ribbon-bookmark.png | 96 × 320 | 62,934 | 2 / 4 |
| ui/shelf-board.png | 1400 × 96 | 89,022 | 2 / 4 |
| tabs/month-flag-cream.png | 220 × 96 | 25,731 | 4 / 4 |
| tabs/month-flag-pink.png | 220 × 96 | 26,529 | 4 / 4 |
| tabs/month-flag-sky.png | 220 × 96 | 25,577 | 4 / 4 |
| tabs/month-flag-mint.png | 220 × 96 | 26,797 | 4 / 4 |
| tabs/month-flag-lemon.png | 220 × 96 | 27,150 | 4 / 4 |
| ui/shelf-contact-shadow.png | 320 × 48 | 2,332 | 3 / 4 |
| ui/panel-paper.png | 900 × 500 | 202,255 | 2 / 4 |
| ui/slider-track.png | 600 × 40 | 24,483 | 1 / 4 |
| ui/switch-track-off.png | 120 × 64 | 9,023 | 2 / 4 |
| ui/switch-track-on.png | 120 × 64 | 11,987 | 2 / 4 |
| ui/seg-track.png | 360 × 80 | 33,903 | 2 / 4 |
| ui/slider-knob.png | 64 × 64 | 6,080 | 1 / 4 |
| ui/slider-knob-paper.png | 64 × 64 | 4,950 | 2 / 4 |
| ui/seg-chip.png | 200 × 64 | 14,802 | 2 / 4 |
| ui/window-top-notebook.png | 1400 × 72 | 111,627 | 2 / 4 |
| ui/window-top-notebook-hover.png | 1400 × 72 | 111,589 | 2 / 4・状態差分 |
| ui/window-top-desk.png | 1400 × 72 | 85,371 | 2 / 4 |
| ui/window-top-desk-hover.png | 1400 × 72 | 85,390 | 2 / 4・状態差分 |
| ui/window-top-studio.png | 1400 × 72 | 86,026 | 2 / 4 |
| ui/window-top-studio-hover.png | 1400 × 72 | 85,821 | 2 / 4・状態差分 |
| ui/close-pencil-normal.png | 96 × 96 | 14,143 | 2 / 4 |
| ui/close-pencil-hover.png | 96 × 96 | 14,155 | 2 / 4・状態差分 |
| ui/close-pencil-pressed.png | 96 × 96 | 14,048 | 2 / 4・状態差分 |
| ui/close-stitch-normal.png | 96 × 96 | 15,015 | 2 / 4 |
| ui/close-stitch-hover.png | 96 × 96 | 15,035 | 2 / 4・状態差分 |
| ui/close-stitch-pressed.png | 96 × 96 | 14,900 | 2 / 4・状態差分 |
| ui/close-tape-normal.png | 96 × 96 | 11,906 | 2 / 4 |
| ui/close-tape-hover.png | 96 × 96 | 11,883 | 2 / 4・状態差分 |
| ui/close-tape-pressed.png | 96 × 96 | 11,863 | 2 / 4・状態差分 |
| ui/close-wax-normal.png | 96 × 96 | 15,337 | 2 / 4 |
| ui/close-wax-hover.png | 96 × 96 | 15,380 | 2 / 4・状態差分 |
| ui/close-wax-pressed.png | 96 × 96 | 15,256 | 2 / 4・状態差分 |
| ui/icon-market.png | 192 × 192 | 53,491 | 2 / 4 |
| ui/icon-settings.png | 192 × 192 | 51,242 | 2 / 4 |
| ui/resize-corner.png | 96 × 96 | 10,847 | 2 / 4 |
| today/material-card-gold.png | 560 × 380 | 289,353 | 2 / 4 |
| today/material-card-riso.png | 560 × 380 | 276,687 | 2 / 4 |
| today/material-card-vintage.png | 560 × 380 | 291,089 | 2 / 4 |
| ui/price-tag-free.png | 240 × 120 | 40,668 | 2 / 4 |
| ui/price-tag-paid.png | 240 × 120 | 41,521 | 2 / 4 |
| ui/stamp-owned.png | 300 × 120 | 8,627 | 2 / 4 |
| ui/ticket-stub.png | 360 × 120 | 62,257 | 2 / 4 |
| ui/pinboard.png | 1200 × 520 | 234,944 | 2 / 4 |
| ui/pin-red.png | 96 × 96 | 10,549 | 2 / 4 |
| empty/stuck-empty.png | 640 × 240 | 182,316 | 1 / 4 |
| empty/inbox-empty.png | 640 × 240 | 234,157 | 2 / 4 |
| ui/avatar-frame.png | 240 × 240 | 49,504 | 1 / 4 |
| back/back-matte.jpg | 1024 × 1280 | 178,979 | 1 / 4 |
| back/back-kraft.jpg | 1024 × 1280 | 247,661 | 4 / 4 |
| back/back-holographic.jpg | 1024 × 1280 | 226,482 | 3 / 4 |
| back/back-gold.jpg | 1024 × 1280 | 219,515 | 2 / 4 |
| back/back-riso.jpg | 1024 × 1280 | 224,686 | 3 / 4 |
| back/back-vintage.jpg | 1024 × 1280 | 216,921 | 1 / 4 |
| ui/switch-knob.png | 64 × 64 | 6,080 | 1 / 4・同材質再利用 |

## 候補選びと旧版との比較

各生成デザインに4候補を用意し、中央の文字面が静かで、既存素材の隣で浮かないものを選びました。操作パネルは全面無地の厚紙と右上の小穴、つまみは静かな真鍮の候補1・紙の候補2を採用しています。スイッチのつまみは選んだ真鍮つまみをバイト単位で再利用し、同じ4候補の比較記録を持ちます。

- 操作部品：旧版の白いカード、標準rangeとcheckboxに対し、新版は紙の小口と穴、鉛筆の目盛り、真鍮／紙のつまみ、紙のくぼんだ溝と乗せるチップを持ちます。文字と操作はプレビュー側で重ねています。つまみを20pxで比較できます。
- 裏面：旧版のCSSグラデーションや点に対し、matteの暖かい繊維、kraftの長い繊維と粒、holographicの静かな銀の回折、goldの箔ムラ、risoの網点と微かな色のずれ、vintageの黄ばみと斑点を持ちます。14px文字を6素材すべてに重ねました。反射のアニメーションや角丸・影は画像に焼き込んでいません。
- ウィンドウの上端：CSSの仮の取っ手に対し、ノートの厚紙とステッチ／中央の浅い溝、マット上の半透明テープと中央の折れ、厚い紙帯のミシン目を持ちます。normalとhoverは同じ構図・キャンバスで、hoverだけ1px持ち上げて微かに明るくしています。
- 閉じる✕：鉛筆、フェルトの赤糸、交差したマステ、凹んだ封蝋の4案です。各案の同じ原画から通常／ホバー／押下の4候補をそれぞれ書き出し、同じ候補番号を採用しました。図案を変えず、hoverは-1px・明るさ+5、pressedは+1px・明るさ-2、影を浅くして沈みを表しています。左右どちらの角にも置ける構図で、24pxでも✕が読めます。標準の赤黄緑ボタンや文字は入れていません。
- P1・P2：Marketの紙袋と真鍮の歯車、3種類の素材カード、値札・青い印の枠・半券・掲示板と押しピン、空の貼付台紙／封筒トレイ／アバターの丸い台紙を揃えました。素材カードのラベル、値札、印と半券は空白です。アバター台紙の中央と印の中央は透明です。

原画・候補・プロンプト・書き出し処理は `assets-src/art/ui-polish/` に保存し、Git対象外です。生成原画から切り出し、sRGB、RGBA、不透明な材質面、透明な穴、輪郭のフリンジ、影と容量を正規化しました。裏紙は周期化と低コントラストの処理を行い、小さな暗い繊維やfoxingの画素も文字を邪魔しない範囲に調整しています。manifestには候補番号、状態、伸縮のスライス、再利用元、テクスチャの測定値を記録しています。

## 比較資料

- [全素材・完成比較プレビュー](../src/art/preview.html)：先行8点の旧新版比較、続いて操作部品・24pxの✕・20pxのつまみ・裏紙と14px文字・タイル・P1/P2・9スライス。
- 先行8点：[ライト](ui-polish/comparison-light.jpg) / [ダーク](ui-polish/comparison-dark.jpg) / [壁紙風](ui-polish/comparison-wallpaper.jpg)
- 残りの完成素材：[ライト](ui-polish/rest-light.jpg) / [ダーク](ui-polish/rest-dark.jpg) / [壁紙風](ui-polish/rest-wallpaper.jpg)
- 4候補比較：[先行8点](ui-polish/candidates.jpg) / [残り37デザイン・状態差分は同候補から派生](ui-polish/rest-candidates.jpg)

## 検証

- `python scripts/art-check.py`：227素材、合計 28,726,321 bytes、合格。sRGB、RGBA、材質内側alpha255、無彩色の接地影alpha≤30・輪郭から6px以内、manifest、既存hook、原画のGit除外を確認。
- PNGは今回各300KB以内（先行8点は90KB以内）、裏紙は各500KB以内。依頼の原則600KB／テクスチャ500KBを満たしています。
- P0合計 11,434,065 bytesで、元仕様の「P0全体で約25MB以下」を満たします。制作チェックは従来P1/P2まで合算していたため、`scripts/art-check.py`の合計対象を仕様どおりP0に修正しました。25MBの値と画像ごとの上限は変更していません。アプリ実装には影響しません。
- 6枚の裏紙を1024×1280・縦横2タイルで確認。JPEG読戻し後の境界差は下表の値です。文字色 `#2B2A28` との最小画素コントラストはいずれも4.5:1以上です。

| 裏紙 | 最小コントラスト | 左右境界の平均差 /255 | 上下境界の平均差 /255 |
|---|---:|---:|---:|
| matte | 6.99:1 | 1.091 | 1.257 |
| kraft | 4.99:1 | 1.476 | 1.674 |
| holographic | 7.94:1 | 1.414 | 1.506 |
| gold | 4.94:1 | 1.223 | 1.344 |
| riso | 7.09:1 | 1.589 | 1.725 |
| vintage | 5.0:1 | 1.569 | 1.68 |

- 画素検証：✕の状態差分の材質輪郭が正確に-1／+1pxで一致、96pxの共通キャンバス。真鍮slider／switchつまみはバイト一致。印・アバターの中央透明、既存179素材と実装はバイト単位で維持。
- Chromium：全227画像の読込み、P0/P1フィルター、✕12状態の24px表示、ライブhover／pressedの画像切り替え、つまみ20px、裏紙14px文字、6枚の2×2タイル、紙パネル70px角・掲示板160px角の縦横伸縮、3背景、37組×4候補の読込みを確認。
- ライト・ダーク・壁紙風でハロー、黒ずみ、不要な文字を目視確認し、認めませんでした。画像の文字はなく、✕と目盛り・点線は図案、ラベルはHTMLです。
- `npm test`：13件成功、失敗・スキップ0件。
- `git diff --check`：成功。

## 差し替え時の情報

| 素材 | 使い方 |
|---|---|
| 棚板・ウィンドウ上端 | 左右120px・上下0pxで中央をfill、横へ伸縮。上端は通常とhoverを切り替える |
| panel-paper | 70px角の9スライス。小穴は右上に保持 |
| seg-track／seg-chip | 36px角／20px角の9スライス。溝と紙チップを別レイヤーにする |
| slider-track | 左右18pxを残して横へ伸ばす。つまみは真鍮を標準とし、紙は選択案 |
| switch | off／onの溝と共通の真鍮つまみを重ね、位置はコードで動かす |
| back-*.jpg | 縦横に繰り返し可能。文字・角丸・影・ホログラムの動く反射はコードで重ねる |
| close-*.png | 各96pxの通常／hover／pressedを置換。表示24pxの確認模型あり |
| pinboard | 160px角の9スライス。木枠と角の穴を保ち、押しピンは別画像で重ねる |

素材の未納品や未修正の画像不具合はありません。触れるプロトタイプとネイティブアプリへの統合は依頼どおりオーナー実装です。先行8点も再制作せず維持しています。
