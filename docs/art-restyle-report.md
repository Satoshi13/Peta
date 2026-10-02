# 見本ステッカーのリスタイル報告

2026-10-02 / `claude/hopeful-ride-n1i6ms`。`art-restyle-spec.md` を優先し、参考画像上段のラップトップステッカーと比較して制作した。見本12枚と関連5素材、合計17素材を差し替えた。

## 差し替えた素材の一覧

見本はすべて `src/art/samples/`。長辺1024px、周囲8px以上の透明余白、sRGB・RGB24＋8bit alpha。白フチ・接地影・背景は焼き込んでいない。KBは1000 bytes。

| ファイル | 容量KB | HSV彩度99%点 |
|---|---:|---:|
| `cat-skateboard.png` | 826.9 | 0.587 |
| `fried-egg.png` | 854.7 | 0.749 |
| `good-day.png` | 818.7 | 0.898 |
| `blue-flower.png` | 852.2 | 0.607 |
| `polaroid-mountain.png` | 879.3 | 0.550 |
| `retro-computer.png` | 821.6 | 0.374 |
| `coffee-cup.png` | 817.6 | 0.783 |
| `peta-bubble.png` | 680.9 | 0.714 |
| `purple-scribble.png` | 409.4 | 0.480 |
| `film-camera.png` | 838.7 | 0.717 |
| `potted-plant.png` | 839.2 | 0.696 |
| `cassette-tape.png` | 840.8 | 0.518 |

| 関連素材（`src/art/`からの相対パス） | 差し替え内容 |
|---|---|
| `onboarding/hero.png` | 猫・目玉焼き・花・GOOD DAY・ポラロイドの5枚。左右に重なりのある組を作り、傾き−7〜＋8°。紙端に薄い無彩色の影と小さな破れ縁。 |
| `book/cover-kraft.png` | 既存の表紙・リング・罫線の構図で花だけを新しい見本へ差し替え。 |
| `today/choice-collection.png` | 上記表紙から384×384の縮小画像を再書き出し。 |
| `back/paper-cream.jpg` | 繊維・微粒子・雲ムラ。JPEG復号後の明度標準偏差4.494、134.9KB。 |
| `back/paper-kraft.jpg` | 同じ質感設計。明度標準偏差4.510、134.8KB。arrival-materialと並べて比較。 |

`manifest.json` の見本名と制作プロンプトを検索し、hero・表紙・選択用縮小画像が依存素材であることを確認した。`sampleSources` / `usedBy` も更新。封筒の猫の落書き、アプリアイコン、カット線のシルエットは見本画像のコピーではないため、差し替え対象に含めていない。

## 制作・確認用の出力

各題材4候補から選択。GOOD DAYは白い背面が付いた初回を、紫の線は文字に見えた初回を、目玉焼きは彩度が強かった初回を、それぞれ4候補で再生成した。12枚を並べて筆致・陰影・色調を確認してから確定した。

- [参考画像上段との比較](art-restyle/reference-comparison.jpg)
- 素材そのものの12枚一覧：[クリーム](art-restyle/samples-light.jpg) / [暗い面](art-restyle/samples-dark.jpg) / [壁紙色](art-restyle/samples-wallpaper.jpg)
- 白フチ合成の12枚一覧：[クリーム](art-restyle/border-light.jpg) / [暗い面](art-restyle/border-dark.jpg) / [壁紙色](art-restyle/border-wallpaper.jpg)
- [紙の継ぎ目・封筒との比較](art-restyle/paper-comparison.jpg)
- `docs/art-stage2/*.jpg` の既存10ボードを再撮影し、`samples-wallpaper.jpg` を追加。
- `src/art/manifest.json` / `src/art/preview.html` を更新。見本に旧STYLE-lite・4色指定を適用しない。

原本・4候補グリッド・再生成履歴は `assets-src/art/restyle/` に保存した。既存の `.gitignore` で除外し、Gitへ追加していない。ここに記載した一覧画像は選定済みの納品素材の確認用で、原本候補グリッドではない。

## 仕様書 §8 の自己点検

- [x] 参考画像上段と12枚を横に並べて比較。細かな筆致とやわらかい陰影があり、平らな4色ベクターの見本を残していない。
- [x] 12枚の筆致・彩度・陰影を確認。目玉焼きを再生成して強い黄〜橙を抑えた。
- [x] 明るい面・暗い面・壁紙色で確認。素材には白フチ・背景・接地影を含めず、不要な透明画素RGBと縁の色汚れを除去。
- [x] GOOD DAY / Petaの綴りと字形を目視。他の文字・数字・ブランド・ロゴなし。
- [x] レトロPCはロゴなし、雲の画面、幅広の丸いCRTケースと別のキーボード。
- [x] 長辺3.5%の白フチ＋10%の薄い無彩色影を合成し、12枚すべて連結成分1・穴0・画面端の欠け0。輪郭のギザギザ・かけら・ハローも3背景の一覧で目視確認。
- [x] heroは5枚。各枚の重なり率0.77〜8.92%で15%以下。`labelRect=[470,200,455,470]` 全体が不透明・単色の余白。紙2枚は標準偏差3〜6、平均RGBは指定色との差2未満、境界の平均差2未満で継ぎ目検査に合格。
- [x] cover-kraftの花を更新。
- [x] manifest検索で洗い出した依存素材と縮小画像を更新。
- [x] `art-check.py` / `npm test` / `git diff --check` に合格。manifest・preview・一覧ボードを更新。
- [x] 原本・候補グリッドはGit外。`git ls-files assets-src/art` は空、`git check-ignore` でも除外を確認。
- [x] 本報告書に差し替え一覧と未対応点を記載。

## 検証と再制作

検査は旧4色制限を除き、彩度99%点≤0.90・内部alpha255・縁AA・900KB・余白・フチ合成に更新した。フチは既存Rustの `cutout::silhouette` と同じ距離拡張・橋渡し・縮小・穴埋め・3回のbox blur・再コントラストで検査用に再現。アプリのRustは変更していない。

`python scripts/art-check.py`：全91素材、15,328,350 bytes（25MB以下）。内部alpha、無彩色の短い影、封筒と封蝋のレイヤー一致、スプライト、紙の継ぎ目、フチ合成が合格。

`python scripts/art-browser-check-stage2.py`：91画像の復号、P1の44素材、背景・優先度切替、既存Today / Creatorのライト・ダーク表示が合格。ネイティブIPCのみfixtureで代替したブラウザースモークテスト。

`npm test`：1件成功。`git diff --check`：成功。

再制作は既存スクリプトの `--restyle` モードで行う：`scripts/art-build-stage1.py` → `scripts/art-build-stage2.py`。確認一覧は `scripts/art-review-restyle.py`。制作専用のPython依存はPillow・numpy・scipy・cairosvg・vtracer。原本はGit外なので再書き出しにはローカルの `assets-src/art/restyle/` が必要。

## 直せなかった点

今回の差し替え範囲に未対応素材はない。macOSネイティブ実機での最終表示はこのLinux環境では確認していない。フチは既存処理を再現した検査画像で確認した。Stage 3の素材制作・アプリへの新たな接続は今回の範囲外。

アプリのRust / JS / HTML / CSSは変更していない。HTMLの変更は指示された素材一覧用 `src/art/preview.html` のみ。
