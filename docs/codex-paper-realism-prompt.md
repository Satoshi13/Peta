# Codex に送るメッセージ(付箋・メモ・ノートの質感:「システムっぽさ」を消す)

そのまま貼り付けて送る。`docs/codex-ui-parts-prompt.md` の続きで、同じ約束(STYLE LOCK・影・ハロー・文字は焼き込まない・コードは触らない)を引き継ぐ。

---

触れるプロトタイプ(`docs/ui-proposals/peta-prototype.html` をブラウザで開く。A / B / C を切り替えて見る)で全体の動きが固まりました。残っている最大の問題は**「紙ものなのに、見た目がシステム(UI部品)に寄っている」**ことです。オーナーの指摘は次の2つです。

1. **付箋(右端の見出しタブ・メモ)が現実味に欠ける**。いまは CSS の角丸長方形に既存の紙テクスチャを薄く重ねただけで、「紙を貼った物」に見えない。
2. **ノートの質感がシステムに寄りすぎている**。ページは均一なクリームのグラデーション+等間隔の点、表紙は一枚の茶色い面。紙の繊維・厚み・小口・綴じの陰影・表紙の傷みがない。

どちらも「写真」にはしない(仕様 NG 2)。STYLE LOCK の**セミフラットなイラスト**のまま、**素材の物理(厚み・半透明・繊維・エッジの傷み・接着)が信じられる**ところまで引き上げてください。参考にする質感は、Peta の既存素材のうち**いちばん良い出来のもの**(`today/material-card-holographic.png`、`pack/pack-pouch-closed.png`、`today/envelope-*.png`、`gift/wax-seal.png`)です。**あれと並べて浮かないこと**が合格ラインです。

## 0. 追加ルール(STYLE LOCK に足す)

```
REALISM BOOST — tactile illustration, not a photograph and not flat vector.
Show believable material physics: paper thickness at the cut edge, fibres catching the light, translucent film that shows what is behind it, a faint glue edge, a micro-shadow where one paper sits on another, tiny hand-cut irregularities (no two edges perfectly straight, no perfectly round corners).
Keep contrast LOW inside the paper areas: UI text will be laid on top, so texture must never fight with 14 px type.
Avoid the "AI gloss": no plastic sheen, no overly clean gradients, no repeated identical blemishes, no symmetric wear.
```

- 影は既存の `shadowPolicy`(`#2B2B2B`・最大 alpha 30・6px 以内・右下 2px)。
- 紙の面は不透明(alpha 255)。**半透明にしてよいのはフィルム付箋の色の部分、マステ、グラシンだけ**。
- ハロー(白/黒の縁)を出さない。ライト/ダークの背景に置いて確認。

## 1. P0 — 付箋(見出しタブ)`src/art/tabs/`

ノートの**右端から飛び出す見出し**です。左側はページの下に隠れるので、**左端は真っ直ぐに切れていてよい(貼り付け部分。接着の薄い影だけ)**。右端は**紙を切った角丸**。ラベル面は**空白**(文字はコード)。表示は高さ約 46 px(= 2.5x で **高さ 128 px**)。

| ファイル | サイズ | 内容 |
|---|---|---|
| `tab-paper-{cream,pink,kraft,sky,mint,lemon,grey}.png` | 各 320 × 128 | **厚紙の見出しタブ**(7色)。紙の繊維、切り口の薄い白い断面、右端の角丸のわずかな不揃い、下に落ちる薄い影、左端はページに差し込まれる部分の暗い陰。色は既存パレット(`#F1EBDC` `#F6C6E3` `#C9A878` `#BFE3F7` `#C8F2DC` `#F7F0BE` `#DDD8CE`)。**7枚で切り口の揺れを変える** |
| `tab-film-{pink,sky,mint,lemon,orange,lilac}.png` | 各 320 × 128 | **半透明のフィルム付箋**(ポストイットのインデックスのような)。先端は半透明の色フィルム、根元に不透明な白い書き込み帯(ここにラベルを置く)。フィルムは**後ろのページが透けて見える**(alpha 55〜70% の色)。縁にわずかな光、折れ曲がりのしわは出さない |
| `tab-washi-{stripe,dot,plain}.png` | 各 360 × 128 | **ページの縁に折り返して貼ったマステの旗**。紙の右端をまたぐ半透明のテープ、貼った側にテープの重なり、旗の先端はV字かまっすぐ。既存の `creator/tape-1..4.png` と**同じ質感・同じ色** |
| `tab-shadow-strip.png` | 64 × 1000 | 付箋が差し込まれるページ縁の**影の帯**(縦に継ぎ目なし)。紙の縁の下に落ちる影と、付箋の根元の盛り上がり |

- 7色の**紙の付箋**を第一候補にし、フィルムとマステは**2案目・3案目**(オーナーが選べるように)。
- 「選択中」は**コードが付箋を引き出す**(位置を動かす)。画像は1枚でよい。選択中の影だけ別に欲しい場合は `tab-paper-*-lifted.png`(影が深いもの)を cream だけ作る。

## 2. P0 — 付箋(メモ)`src/art/notes/`

Today の「See you tomorrow」やカードのメモ、Gift の手紙に使う、**貼って・剥がして・破れる**メモ類です。

| ファイル | サイズ | 内容 |
|---|---|---|
| `note-sticky-{yellow,pink,mint,sky}.png` | 各 640 × 640 | **ポストイット型の正方形付箋**。上辺に細い接着帯(わずかに艶)、下辺が**ごくわずかに反って**影が長い、四隅は丸くない(紙を断裁した角)。**面は空白** |
| `note-sticky-pad-{yellow,pink}.png` | 各 720 × 720 | 付箋の**束**(数十枚が重なった厚み)。一番上だけ少し剥がれかけ |
| `note-memo-torn-{cream,kraft,lined}.png` | 各 800 × 480 | **破れ縁のメモ**(今の `today/see-you-tomorrow.png` / `gift/note-blank.png` の質感を一段上げたもの)。破れ縁の**白い繊維の毛羽立ち**、裏の紙色が見える縁、上辺にマステ(半透明)。lined は薄い罫線。**面は空白**(右上に小さな月と星の落書きだけ、`cream` のみ) |
| `note-index-card-{blank,ruled,dot}.png` | 各 900 × 600 | 情報カード。角が**ほんの少し**丸い、右上に穴、縁の小口が白く見える |
| `paper-clip.png` `binder-clip.png` | 各 256 × 256 | 銀の紙クリップ / 黒に近いバインダークリップ。メモに留めて使う |

## 3. P0 — ノートの質感 `src/art/book/`

**今の問題**: ページは CSS のグラデーション+等間隔の点+薄い veil、表紙は紙テクスチャの一枚面。「ノート」ではなく「ノートの形をした面」に見える。

| ファイル | サイズ | 内容 |
|---|---|---|
| `cover-board.jpg` | 1024 × 1024・**継ぎ目なし** | **表紙の厚紙(クラフトのチップボード)**。長い繊維、細かい黒い粒、低周波のムラ、うっすらエンボスの格子。**コントラスト低め** |
| `cover-edge.png` | 640 × 640・透過・**9スライス(角 96px)** | 表紙の縁。角の丸み、芯の灰色い断面が欠けて見える摩耗(**非対称**)、縁の光、外側に薄い影。中央は透明(窓枠の外周に使う) |
| `page-paper.jpg` | 1024 × 1024・**継ぎ目なし** | **ページの紙**。細い繊維、ごくわずかな色ムラ(低周波の雲)、紙の歯。**白すぎず、`#FAF6EC` 前後**。UI の文字が読める低コントラスト |
| `page-dots.png` | 512 × 512・透過・継ぎ目なし | **印刷されたドット方眼**(22px 間隔、乗算で重ねる)。インクの濃さが**ほんの少しばらつく**、版ズレはしない |
| `page-edge-right.png` / `page-edge-bottom.png` | 64 × 1000 / 1000 × 64・透過 | **ページの束の小口**(40枚ほどの紙が重なって見える細い線、不揃い)。ページ右・下の縁に敷く |
| `page-gutter.png` | 160 × 1000・透過・縦に継ぎ目なし | **綴じ側のたわみの影**。紙が穴の側で曲がる陰影(`spiral-binding.png` と位相を合わせる必要はない) |
| `page-corner-curl.png` | 200 × 200・透過 | ページの**右下の角がほんの少し浮いた**装飾(影つき)。アクセント用 |

- いまのスプリング(`spiral-binding.png` ほか)は**良い出来なのでそのまま**。新しい紙・表紙・小口と並べて**同じ光(左上)**に揃えること。
- 既存の `book/cover-kraft.png` `page-right.jpg` `page-left.jpg` `notebook-page.png` は、上の素材ができたら**作り直しの要否を判断**して報告(置き換え or 残す、理由つき)。

## 4. P1 — 貼った瞬間の「Peta!」タグ(バリエーション)`src/art/fx/`

日本語の「ペタッ」は廃止し、**英語の "Peta!"** にしました(ロゴが Peta なので)。ステッカーを貼った瞬間に出る小さなタグを**6種**、のちに増やせるよう揃えてください。文字は**ロゴと同じ筆記体の "Peta!"**(このスペル以外の文字は入れない)。

| ファイル | サイズ | 形 |
|---|---|---|
| `peta-tag-torn.png` | 480 × 240 | 破れ縁のクリーム色のメモ(今の `peta-tag-en.png` の質感を上げたもの) |
| `peta-tag-round.png` | 360 × 360 | 白フチの丸いステッカー |
| `peta-tag-bubble.png` | 480 × 320 | 吹き出し(しっぽ付き、紙を切った縁) |
| `peta-tag-flag.png` | 480 × 200 | マステの旗(V字) |
| `peta-tag-stamp.png` | 480 × 220 | 赤みのゴム印(`#B8665B`、かすれ、二重枠) |
| `peta-tag-holo.png` | 480 × 200 | ホログラムの細いリボン(パステル) |

## 5. 英語プロンプト(先頭に STYLE LOCK + REALISM BOOST、末尾に NEGATIVE)

```
(tab-paper) An index tab cut from coloured card stock, seen straight on, sticking out to the right: the left end is a clean straight cut that disappears under a page (a soft contact shadow there), the right end has gently rounded corners that are slightly uneven because they were cut by hand. A thin pale cut edge shows the paper's thickness along the top and bottom. Fine fibres, very low contrast. Blank label area. Colour: <cream / pink / kraft / sky / mint / lemon / grey>.
(tab-film) A translucent coloured plastic index flag: the tip is a see-through colour film (the page behind shows through at about 60%), the base has an opaque white writing strip, a faint highlight along one edge, no wrinkles. Blank.
(tab-washi) A strip of washi tape folded over the edge of a page like a flag, semi-transparent, with a small overlap where it sticks down, deckled ends, <diagonal stripes / dots / plain>.
(note-sticky) A square sticky note seen straight on, with a thin glue band along the top that has a faint sheen, the bottom edge curling very slightly off the surface so it casts a longer soft shadow, corners sharp (cut paper, not rounded). Blank face. Colour: <yellow / pink / mint / sky>.
(note-memo) A torn paper memo with a ragged, fibrous edge that shows a paler layer of paper where it tore, a piece of semi-transparent masking tape on the top edge. Blank face; cream version has a tiny crescent moon and two stars doodled at the top right.
(cover-board) A seamless texture of kraft chipboard: long pale fibres, tiny dark flecks, soft low-frequency mottling, a very faint embossed grid. Low contrast. No object, no text.
(cover-edge) The rim of a kraft notebook cover seen straight on with the centre transparent: rounded corners worn unevenly to show the grey core board at one corner, a thin light edge highlight, a soft outer shadow. 9-slice friendly: all detail within 96 px of the border.
(page-paper) A seamless texture of uncoated cream notebook paper (#FAF6EC): fine fibres, a very gentle cloudy tone variation, a faint tooth. Low contrast. No lines, no dots.
(page-dots) A seamless transparent tile of a printed dot grid, 22 px pitch, ink density varying very slightly from dot to dot, graphite at low opacity, for multiply blending.
(page-edge) The cut edge of a block of about forty notebook pages seen from the side: many fine pale lines slightly out of register, soft shading, transparent outside.
(peta-tag) A small paper tag with the exact word "Peta!" in a casual brush-pen script matching the Peta logo (thick friendly strokes, slightly slanted). Shape: <torn memo / round white-bordered sticker / speech bubble with a tail / washi-tape flag / faded red rubber stamp / pastel holographic ribbon>. Soft low shadow.
```

## 6. 作業手順と完了条件

1. **まず付箋(`tab-paper-*` の7色)とページの紙(`page-paper.jpg`・`cover-board.jpg`)だけ**を作る。`src/art/preview.html` に、**今の見た目と新しい見た目を並べて**出して**止まる**。オーナーが「現実味が出た」と確認してから残りに進む。
2. 生成は1つにつき**4候補**。「いちばんきれい」ではなく、**既存の `material-card-holographic.png` `pack-pouch-closed.png` の隣に置いて浮かない**ものを選ぶ。
3. 納品ごとに `src/art/manifest.json` に追記。原本は `assets-src/art/`(Git外)。
4. 自己点検:
   - [ ] 付箋を実寸(高さ46px)に縮めても、**紙の厚み・影・色の違い**が読める。
   - [ ] ページの紙の上に **14px の文字**を置いて読める(コントラストが低い)。
   - [ ] 継ぎ目なしのテクスチャを**縦横にタイル**して継ぎ目・繰り返しの模様が見えない。
   - [ ] 新素材を `spiral-binding.png` と並べて**光の向きが揃っている**。
   - [ ] ライト・ダーク・壁紙風の背景でハロー・黒ずみが出ない。
   - [ ] 画像に文字が焼き込まれていない(`peta-tag-*` の "Peta!" だけ例外)。
   - [ ] 1枚 600KB 以下(テクスチャは 500KB 以下)。
5. 完了したら `docs/paper-realism-report.md` に、作ったもの・旧版との比較・直せなかった点を書き、`art: paper realism — tabs, notes, notebook` で指定ブランチに push。

## 7. 差し替え先(プロトタイプの CSS。実装はこちらでやる)

| 素材 | プロトタイプ内の場所 |
|---|---|
| `tabs/*` | `docs/ui-proposals/app/css/shells.css` の `[data-shell="notebook"] .nav-item`(いまは CSS のグラデーション) |
| `notes/note-memo-torn-*` | `css/pages.css` の `.note`(未使用になった旧 Today の「See you tomorrow」)、`.ev-note`(Gift の手紙) |
| `book/*` | `css/shells.css` の `body[data-shell="notebook"] { --paper-img … }` と `.win-frame` / `.book` |
| `fx/peta-tag-*` | `js/desktop.js` の `Desktop.TAGS`(関数を足すだけでバリエーションが増える) |
