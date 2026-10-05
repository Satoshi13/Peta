# 新素材の実装報告（2026-10-05）

対象はGold Foil／Riso／Vintage／Clear／Pixel／Washi／Sakuraの7種類だけ。アカウント・モデレーター・新Pack・画像制作のPhaseは進めていない。src/artの追加・変更なし、元のprototypeとgoldenは保持。DB v8の既存スキーマを使用。

## 製造と入手

- 実Rustレシピで金箔、2色の版ずれ、古紙、半透明フィルムと白インク、淡いピクセル印刷、植物繊維、薄桃紙と押し花を描画。新規作成は各1枚消費、再編集は同じIDと素材を保持し消費しない。
- Gold 交換12／分解6、Riso・Pixel・Washi 2／1、Vintage 8／4、Clear 6／3 Scraps。レア度別の既存比率を基準にした初期値で、再交換と分解でScrapsを増やせない。取引は既存のトランザクションとリクエストIDで二重付与を防ぐ。
- SakuraはArchive・春限定の指定を維持。通常交換価格はnullでRust側も交換を拒否し、署名付き配布からの受取・製造・4 Scrapsへの分解を提供。配布期間・回数は未決で、open-questionsのP6へ選択肢と推奨を記載。
- 既存のToday抽選50／32／18と初回Holographicは維持。公式コードの素材番号は既存5種類を保持して新しい4種類を末尾に追加。画像なしの素材付与は既存の署名検証・一度きりの受領で行う。正式な秘密鍵は生成していない。
- Developerは新素材を含む全10種類を使用可能。有限在庫／取得ルールは通常版だけ。署名検証や所有権検証は解除しない。

## 表示と操作

Gold／Riso／Vintageの既存カード・裏紙画像を採用。専用画像が未納品のClear／Pixel／Washi／Sakuraは共有の静的CSS／Canvasでカード・見本・裏紙を表示し、共通形状を保持した。Clearの表示に市松模様は焼き込んでいない。

Goldのデスクトップと印刷時の反射はHolographicと同じREFLECTIVE_MATERIALS定数に接続。帯だけを変え、ステッカー本体の変形・影・拡大を追加しない。Reduce motion、反射対象0枚、補間収束で既存の停止処理を利用する。新しい常時タイマー／常時アニメーションなし。

Materials・Market・CreateとCollectionの詳細／裏返し／剥がしを接続。未取得素材の案内は入手可能なMarketまたは公式配布へ向ける。交換確認のキャンセルは在庫／Scrapsを変えない。

[比較プレビュー](ui-proposals/new-materials-preview.html)と[実アプリ比較・確認記録](port-spec/compare/review-18/README.md)を掲載。比較画像は既存猫素材から本物のcreator_renderが出力した結果で、JSによる代替フィルターではない。

## 確認

- npm test: 44件成功。
- cargo test --workspace: 通常版125件、Developer版126件成功。
- core単体: 通常版117件、Developer版118件成功。新素材の製造／透過／縦横比／決定性、Scrapsの原子性・再送・逆交換、署名付き素材コードとファイルでの一度きりの受領、有限在庫と全素材のDeveloper使用を検査。
- npm run check:mac／check:mac:developer: 成功。Linux上でC／ObjC依存生成をスタブ化したaarch64-apple-darwinの型検査であり、macOSのリンク・起動・release bundle確認ではない。
- 実Tauri／WebKitGTK: 全7種類の作成で在庫2→1、Collectionと裏面の素材が一致。Gold再編集はIDと1枚の在庫を保持。7種類の剥がし裏紙はloaded。最終ビルドの印刷層でもGold1枚だけが表示され、絵柄のマスクと暖色の帯が適用されることを確認。最小720×520のMaterials／Marketは両シェル・昼夜の8状態で横はみ出し0、Createも両シェルで全10種類を表示して横はみ出し0。
- macOS実機は未確認。反射・透過・Retina・複数画面と実操作をmacos-checklist §21へ追記済み。初回の全体ビルドは作業環境の容量不足で停止したが、Petaのビルド生成物を整理し、再実行後は成功。

## コミット

1. `ef42e7c` — Add seven native material recipes and finite Scraps acquisition: README／decisions／open-questionsとcoreのmaterials・sticker・creator・scraps・events・db。
2. `Integrate new material cards, backing and Gold reflection`（本報告を含むコミット）: card／picker／Market／Materials、共有素材CSS、両HTMLエントリ、反射／print／peel、反射テスト、比較・プレビュー・報告・アート棚卸し・実機チェックリスト。

両コミットはclaude/relaxed-dijkstra-ocnjzuへpush。未コミットのofficial-assets-report.mdは候補確認待ちの別作業として保持。

## 残ること

Sakuraの配布期間／回数、未納品4素材の専用画像と既存3素材の専用チップは公式素材制作の別Phaseで決める。今の代替表示は実装済みだが、手描きの納品画像が完成したという意味ではない。macOS実機検証と正式な公式公開鍵の差替えはオーナー環境の作業として残す。
