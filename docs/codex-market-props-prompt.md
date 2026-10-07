# Codex に送るメッセージ(Market の小物素材:コルクボード・クリップ・紙・吊り下げレール)

そのまま貼り付けて送る。一緒に渡すもの:

- **仕上がりの見本: `docs/art-reference/market-mock.webp`**(Market の画面。コルクボードにメモと紙クリップ、銀のレールに袋が吊られている)
- 絵柄の基準: `docs/codex-shop-parts-prompt.md` の §0(守ること)
- 既存素材(隣に置いて浮かないこと): `src/art/pack/pack-*.png` `src/art/ui/paper-clip.png` `ui/pinboard.png` `ui/memo-torn.png`

---

`docs/art-reference/market-mock.webp` は、Market の仕上がりの見本です。この画像から、下のパーツを**1点ずつ「描き直して」**ください。切り抜きではありません。**見本と同じ絵柄・同じ質感・同じ光(左上)のまま**、単体の素材として描き直します(見本は他のものが重なっていて、小さく、背景と影が焼き込まれているので、そのままでは使えません)。

## 0. 共通のルール

- 背景は**透明**(縁はアンチエイリアスのみ。白や黒のハロー禁止)。透明で出せないときは、単色のマゼンタ `#FF00FF` の背景にして、素材の中にその色を使わない。
- 他のものは何も載せない。**文字・数字・ロゴ・ピン・袋・重なった影を取り除く**。
- 正面・正位置・傾けない。影は右下に短く薄いものだけ、素材に含める。
- 金属は「銀の箔」(`#D8DCE2` → `#9AA1AB` の2〜3段と、左上の細いハイライト1本)。クロームの映り込み・ネオン・青白いツヤは禁止。
- 描き込みは `src/art/pack/pack-*.png` と同じ程度まで。**見本より描き込まない**(見本は既存より立体的で細かい)。
- 左右がある部品(レールの端)は、左右を別々に描く(反転で流用しない)。
- **1素材ずつ別に生成**する(まとめると光と質感がずれる)。
- 納品先は `src/art/market/` の新規ファイルだけ。既存の `src/art/ui/*` `src/art/pack/*` とアプリのコードは変更しない。
- 納品は表示サイズの3倍(Market は最大2.2倍に拡大する)。

## 1. 納品する素材

**まず ①②③ の3点だけ作って止まってください。** 絵柄を確認してから残りに進みます。

| # | ファイル(`src/art/market/`) | 描き直すもの | 比率 | 納品(実px) |
|---|---|---|---|---|
| ① | `cork-board.png` | 何も載っていないコルクボード。縁と四隅はそのまま、**中央は一様**(横に伸ばしても崩れない)。四隅 120px・縁 60px は固有の絵柄 | 3:1 | 2400×800 |
| ② | `paper-clip-silver.png` | 縦長の銀の紙クリップ1個 | 2:5 | 360×900 |
| ③ | `rail-bar.png` | 銀の丸い棒。**端を描かない**。左右にシームレスにつながる(2枚並べて継ぎ目が見えない) | 8:1 | 2400×300 |
| ④ | `rail-clip.png` | 袋の上部を挟み、リングを棒に通す吊り下げ金具1個。上にリング(中は空洞)、下に角のある挟み板とリベット2つ | 2:3 | 600×900 |
| ⑤ | `memo-card-blank.png` | 文字のない空白のクリーム色のカード(`#F6EEDC` → `#E9DDC2`)。紙の厚みが右・下にわずかに見える | 4:3 | 1600×1200 |
| ⑥ | `rail-end-left.png` / `rail-end-right.png` | レールの端の飾り玉と短い棒。棒の太さと縦の中心は `rail-bar.png` と一致。左用は棒が右へ、右用は棒が左へ抜ける | 3:2 | 900×600 各1 |
| ⑦ | `cork-tile.png` | 継ぎ目のないコルク地。影・縁・物なし。不透明 | 1:1 | 1024×1024 |
| 任意 | `memo-card-ruled.png` / `memo-card-torn.png` / `memo-tag.png` | ⑤の罫線入り / 上辺が破れた / 小さな札(3:2、900×600) | 4:3 | 1600×1200 |
| — | `anchors.json` | 棒の縦中心、クリップのリング中心、袋を挟む位置、端の棒の接続位置を納品px で | — | — |

## 2. 納品前に自分で確認する

- 既存の `pack-*.png` の隣に置いて、質感・描き込みの量が浮かない。
- 銀の金属が、`paper-clip-silver.png` と `rail-bar.png` と `rail-clip.png` と `rail-end-*` で同じトーンに見える。
- ライト・ダーク・壁紙風の3背景に重ねて、ハローが出ない。
- `rail-bar.png` を左右に2枚並べて、継ぎ目が見えない。
- `rail-end-*` の棒の太さと縦の中心が、`rail-bar.png` と一致する。
- `cork-board.png` の中央を横に伸ばしても、模様が崩れない。
- 画像に文字・数字が入っていない。

## 3. 組み立ての約束(コードが使う)

```
Market の先頭(Featured)
  z1  cork-board        … ボード(9スライス)
  z2  memo-card-*       … 説明の紙(文字はコードが重ねる)
  z3  paper-clip-silver … 紙の上辺に留める

Market のレール
  z1  rail-bar + rail-end-left/right … 棒(左右にタイル)と端
  z2  pack-*.png        … 袋
  z3  rail-clip         … 袋の上部を挟み、リングを棒に通す
```

## 4. 参考: 1素材ずつのプロンプト(うまく描き直せないときだけ)

見本を参照した上でも形がずれるときは、これを素材ごとに足す。**共通ブロック**を先頭に付ける。

```
Single isolated UI prop for a cozy desktop sticker app, drawn as a soft semi-flat stationery illustration (NOT a photo, NOT a glossy 3D render). Straight-on front view, orthographic, perfectly upright. Light from the top-left. Gentle painted shading, subtle texture. Metal is "silver foil" only: 2-3 tones from #D8DCE2 to #9AA1AB with one thin top-left highlight; no chrome, no reflections. Warm muted palette. Very soft short shadow to the bottom-right only. Transparent background, clean edges, no halo. No text, numbers, logos or other objects.
```

- ① `A wide rounded-rectangle cork bulletin board, 3:1, honey-brown cork with fine speckles, slim darker brown frame with a soft inner bevel. The center is evenly textured with no pins or objects so it can be stretched.`
- ② `One classic silver double-loop paper clip, vertical, 2:5, thin top-left highlight.`
- ③ `A slim horizontal round metal rod, 8:1, seamlessly tileable left-to-right, no end caps or screws, faint horizontal brushed grain.`
- ④ `A small flat metal hanging clip, 2:3: an open hollow ring at the top, a rectangular clamp plate below with two tiny rivets and a lipped bottom edge. Chunky, minimal detail.`
- ⑤ `A blank cream memo card, 4:3, faint paper fibers, slightly rounded corners, nothing printed on it.`
- ⑥ `The left end of a slim horizontal metal rail: a small round ball finial with a neck collar on a short rod stub that runs off the right edge, same thickness and vertical center as a plain rod.`(右用は左右を入れ替える)
- ⑦ `Seamless tileable square cork texture, low contrast, opaque, no shadows or edges.`
