# 新素材の実アプリ確認（2026-10-05）

対象はネイティブの7素材だけ。原本のsrc/artとgolden、元のprototypeは変更していない。

- `materials-overview.jpg`: 実Rustのcreator_render（preview=true）による8種類の比較。Matteは基準、残り7つは新素材。元PNGのSHA-256・寸法・coverageは`renders.json`。透明ピクセルを保つlossless WebPに変換してプレビューへ掲載した。
- `{studio,desk}-{day,night}-{materials,market}-small.jpg`: 実Tauri／WebKitGTK、720×520、独立SQLite fixture。初期所持数は各2枚、Scraps 100。Clearの詳細と10種類のMarketを両シェル・両外観で確認。`layout.json`にページの実寸と所持数／価格を保存し、8状態すべて横方向のはみ出し0。
- `manufacturing.json`: 本物のcreator_begin_path → creator_finish → material_book／sticker_backを7種類で実行。各2→1枚、Collectionと裏面の素材IDが一致。Goldの再編集でIDと1枚の在庫を保持。
- `final-print.json`: 最終ビルドの本物のデスクトップ層で、Goldの印刷待ち1枚と、完成画像マスクで切り取った暖色の反射帯を確認。
- `extra-checks.json`: 7種類の剥がし裏紙がloaded、両シェルの最小Createで10個のピッカーが表示され横はみ出し0、Sakuraは通常交換不可、Gold交換確認のCancelで在庫／残高不変。

プレビュー: [new-materials-preview.html](../../../ui-proposals/new-materials-preview.html)。専用画像のない4素材は本体と同じmaterial-surfaces.cssを使用。比較用のステッカーはJSのフィルターではなく、実Rust製造結果。

Goldenには新素材の完成状態がないため、ピクセル一致とは判定しない。意図した差分は素材種類・対応する質感・交換価格・入手案内だけ。3つの従来製造レシピ・日次抽選・カード共通形状は保持している。LinuxのシステムフォントとmacOSの描画は異なり、Retina・透過・複数ディスプレイの最終確認はmacos-checklist §21。

実行環境: Xvfb／WebKitGTK。通常データには触れず `/tmp/peta-new-material-data` の独立fixtureを使用。Linux上のmacOS向け検査はC／ObjC依存のスタブを使う型検査で、macOSでのリンク・起動・配布ビルドではない。
