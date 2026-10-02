# Stage 1（P0）自己点検

Stage 0 の承認済みスタイルと4件の修正指示を適用し、P0 のブランド、Today、Cutting Mat 素材を実装しました。Stage 2 以降には進んでいません。

実行用素材は `src/art/` の51ファイル、合計3,867,865 bytes。最大は `brand/app-icon-1024.png` の580,589 bytesで、すべて600KB以下です。各素材の寸法、用途、プロンプト、容量は [manifest](../src/art/manifest.json) に記録しています。[素材確認ページ](../src/art/preview.html) は白・暗色・壁紙背景を切り替えられます。

## 指示への対応

- 不透明な内部を alpha 255 に補正。輪郭のアンチエイリアスは維持。和紙テープとカット線の薄い下絵のみ、仕様どおり意図的な半透明です。
- 接地影は無彩色、alpha 最大30/255（11.76%）、輪郭から6px以内。旧素材の外側の影を除去して再構成しました。
- 猫・目玉焼き・青い花を各4色のフラットな塗りに統一。銀のパウチは細かいしわを弱め、空白ラベルをなじませました。表紙の花も同じ絵柄です。
- インク色・白の Peta ロゴをPNGとパスによるSVGで用意。SVGに画像やフォントは埋め込んでいません。
- 原本・候補画像はローカルの `assets-src/art/` に保存し、Git管理から除外。既存のStage 0原本も追跡解除しました。過去のコミットに含まれる原本は履歴を改変せず残しています。
- 既存Rust・JSロジックは変更していません。表示専用の `src/art/art.js`、CSS、HTMLを追加・更新し、既存IDと `data-art` を維持しています。

## §10 チェックリスト

- [x] 参考画像とStage 0を基準に、色・線・セミフラットな質感・手作り感を確認。
- [x] 左上の光、薄い右下の影、共通パレットを適用。
- [x] 暗い背景で透過エッジを確認。茶色いにじみと不要なハローを除去。仕様上のステッカー白縁は保持。
- [x] 偽テキストなし。Petaの承認済み字形を保持し、可変ラベルはHTMLで表示。
- [x] 実写の道具、手、人物、外部ブランドなし。
- [x] 封筒の閉じた画像とレイヤー合成はピクセル一致。foilの共有境界も同一画像から分割。Pack開封レイヤーはStage 2以降のため対象外。
- [x] P0の命名・寸法・容量を確認し、manifestに全51素材を収録。
- [x] TodayとCutting Matをブラウザで開き、ライト／ダーク、画像読込、プレースホルダー除去を確認。
- [x] `npm test` 成功。既存ID・`data-art`の維持を自動検査。
- [x] 未達と確認範囲を下記に記録。

## 検証結果と確認範囲

`python scripts/art-check.py` は容量、PNG形式とsRGB、内部alpha、影の濃度・範囲、レイヤー一致、スプライト一致、見本4色と8px余白、原本のGit除外を検査し成功しました。`npm test`、`git diff --check`、表示用JSの構文検査も成功しました。

`scripts/art-browser-check.py` はTauriブリッジをテスト用に置き換え、既存Today／CreatorのHTML・JSをブラウザで実行しています。開封成功／失敗、3素材種、Pack切替、待機演出、待機終了、動きを減らす設定、プレビュー背景切替を確認しました。記録画像は [Todayライト](art-stage1/today-material-light.jpg)、[Todayダーク](art-stage1/today-material-dark.jpg)、[Creatorライト](art-stage1/creator-light.jpg)、[Creatorダーク](art-stage1/creator-dark.jpg)、[動きを減らす設定](art-stage1/creator-reduced-motion.jpg) にあります。

**未達のP0素材：なし。** macOS実機上のTauri動作・アイコン表示は、このLinux環境では未確認です。ブラウザ検証はネイティブ実機検証の代替ではありません。生成候補から指定寸法へリサイズした素材があり、書き出し寸法で視覚確認しています。

## 制作スクリプト

`scripts/art-build-stage1.py` はローカル原本から最適化コピーと派生レイヤーを生成し、`scripts/art-export.py` がalpha・影・容量を補正します。制作時のみ Pillow、numpy、scipy、cairosvg、vtracer を使用します。ブラウザ検証にはPlaywrightとChromium、ポート8765のHTTPサーバーを使用します。アプリの依存パッケージには追加していません。

原本をGitから除外しているため、新しいチェックアウトで再制作するにはローカル原本一式の受け渡しが必要です。アプリ表示と素材チェックには、コミット済みの `src/art/` だけで足ります。
