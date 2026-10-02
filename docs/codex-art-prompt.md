# Codex 向けアート制作プロンプト(Peta)

**使い方**
1. Codex に、この `docs/codex-art-prompt.md` の**全文**と、`docs/art-reference/` の画像4枚(下記)を渡す。
2. 作業は **Stage 順**(§7)。最初に Stage 0(スタイル確定)を出させて、人間が OK を出してから量産に入る。
3. ロジック(Rust / JS の契約)は触らせない。見た目と組み込みだけ。

> 以下が Codex へのプロンプト本文。日本語で指示、**画像生成に貼るプロンプトは英語**(画像モデルは英語の方が安定するため)。

---

# 1. あなたの役割とゴール

あなたは「Peta」の**アートディレクター兼イラストレーター兼フロント実装者**です。

Peta は macOS(のちに Windows)のデスクトップに、**毎日1枚だけステッカーを貼って残していく**アプリです。
機能・状態遷移・データの流れは実装済みで、見た目だけが**点線のプレースホルダー**(`.art-slot[data-art]`)になっています。

**ゴール:** 参考画像の「あたたかい文具・ステッカー文化」の雰囲気で、必要な画像素材をすべて制作し、既存のプレースホルダーを置き換える。
さらに、まだ画面が無い将来の演出(印刷・封筒の到着・裏面・ステッカー帳・Pack)の素材も、同じ世界観で**先行して納品**する。

やること:
- 画像素材の生成・整形・命名・`src/art/` への配置、`manifest.json` の作成
- `src/today.html` `src/creator.html` のプレースホルダーを素材に置き換える(§9)
- 素材を一覧で確認できる `src/art/preview.html` の作成

やらないこと:
- Rust・`*.js` のロジック変更、コマンド名・イベント名・DOM の `id` の変更(**契約は `docs/ui-handoff.md`**)
- デスクトップレイヤー側の演出(印刷・掴む・貼る・到着)の**実装**。素材だけ納品する。実装はこちらで行う

---

# 2. Peta とは(要約)

- コンセプト: **One sticker a day. 毎日、ひとつだけ。** デスクトップに残る、ステッカーのある暮らし。
- 体験: 封筒が届く → 開封 → 今日の素材(Matte / Kraft / Holographic …)を獲得 → 写真から自動でステッカーを作る(Cutting Mat)
  → 画面端から印刷される → 掴む → デスクトップに「ペタッ」と貼る → 裏面には ORIGINAL・作成者・日付・素材が残る
  → 友達へ封筒で贈る・Pack を開封・ステッカー帳(Collection)で月ごとに眺める。
- 思想: **PCアプリを操作している感覚を減らす。** 「保存」ではなく「Keep」、「通知」ではなく「届く」、ボタンよりオブジェクト。
- Peta は SNS でもゲームでもない。**物を作り、交換し、集める場所。**
- 目指す空気(仕様 §84): **Apple native + Indie Mac app + Stationery(文具)+ Sticker culture + ほんの少しのノスタルジー**

---

# 3. 参考画像と「雰囲気」の読み解き

`docs/art-reference/` の4枚。**雰囲気の参考**であり、そのままの再現ではありません。

| ファイル | 何がある | 取り入れる点 | 真似しない点 |
|---|---|---|---|
| `mood-1-hero-and-flow.jpg` | ヒーロー(ノートPC+壁紙+貼られたステッカー)と、1〜5の体験パネル、コレクション、マーケット、素材一覧(Matte / Holographic / Gold Foil / Transparent / Kraft / Riso / Vintage / Pixel) | **クリーム色の紙の地**に並ぶパネル構成、ホログラムのパック、クラフト紙の封筒、破れ縁のメモ(ORIGINAL / Created by)、素材見本の並べ方、**筆ペン風のロゴ "Peta"**、手書きの注釈 | 実写のノートPC・手・机・実写の包装・写真的なシーン。本文のテキスト(日本語キャプション)は画像に焼き込まない |
| `mood-2-full-journey.jpg` | 1〜9の全体験(封筒→選ぶ→作る→印刷→貼る→裏面→贈る→ステッカー帳→マーケット) | **クラフト封筒+赤い封蝋**、ステッカー帳(スパイラル綴じ・月のタブ)、裏面カード2種(ORIGINAL / 受け取り)、「?」のシルエットの未開封ステッカー、メニューバー/トレイの控えめなUI | **実写のプリンター・手・机・カッター**(仕様 NG 2)。印刷は「画面端の抽象的な印刷口」で表現する |
| `mood-3-ui-mockups.jpg` | **いちばん UI に近い**。Today の4択(+ / 封筒 / Pack / ステッカー帳)、Cutting Mat(元画像→切り抜き→素材プレビュー、きりぬき調整スライダー)、裏面カード、月ごとのステッカー帳、マーケット | **フラットで静かな画面**、オブジェクトで選ぶ4択、素材のカード、白〜クリームの面+影の弱さ、角丸 | Photoshop 的・ダッシュボード的な密度。UI の細部は既に実装済みなので描き直さない |
| `holographic-sticker-sample.png` | オーナーが作った**ホログラムのステッカー**(透過PNG)。**白いリング+外側がパステルのレインボー膜+ラメ** | Holographic の質感の基準。素材見本・カード・Pack のホログラム表現はこれに揃える | – |

**3枚から読み取る共通の空気**(これを守る):
- **あたたかい**: クリーム/オフホワイトの紙、クラフトの茶、墨のようなグラファイト。蛍光色や強い黒は使わない
- **触れそう**: 紙の繊維、破れ縁、マスキングテープ、箔のきらめき。ただし**写真ではなくイラスト**として整理されている
- **少し手作り**: 手書きのメモ、小さな落書き、わずかな傾き。きれいすぎず、汚しすぎない
- **静か**: 余白が広く、影は弱く、色数は少ない。主役はステッカー(色を持つのはステッカーだけ)
- **ノスタルジー**: 90〜00年代の文房具店・雑貨店の空気。懐かしいが古臭くない

---

# 4. 守るべき仕様(デザイン原則・NG)

**原則**
- ボタンより**オブジェクト**(封筒そのもの・Pack そのもの)。モーダルより**レイヤー**(紙・トレー・ステッカー帳が重なる)
- アニメーションより**物理**(紙が滑る、封筒が開く、貼った瞬間に少し潰れる、ホログラムが光を反射する、裏返る)
- 通知ではなく**到着**。保存ではなく**Keep**
- 封筒は「平面・軽い影・小さな封・Peta ロゴ・Sender」程度。**過度なフォトリアルにしない**(仕様 §37)

**NG(絶対に入れない)**
1. **Dashboard 型 SaaS の見た目**(Card / Card / Graph / Button の羅列)
2. **過度なフォトリアル**。現実の**プリンター・手・机・カッター・はさみ・実写包装**を UI 素材として描かない。Peta はあくまでデジタル UI
3. **ゲーム UI 化**(XP・レベル・ミッション・バトルパス・強さ)
4. **ガチャを主役にしない**。主役は「毎日デスクトップに何かを残すこと」
5. 実在のロゴ・ブランド・キャラクター・人物(Apple ロゴ、ブランド名、実在の人物の顔)
6. 絵の中に**意味のない文字**(AI が作りがちな崩れた偽テキスト)を入れる

**フォント方針**(コード側で描く文字)
- System Layer: OS 標準フォント
- Peta Layer: 読みやすい Sans Serif。**手書き風は封筒・素材ラベル・小さなメモ・Pack 装飾だけ**(長文・重要操作には使わない)
- 手書き風の候補: 日本語 `Klee`(macOS 標準)、英語 `Bradley Hand` / `Noteworthy`(macOS 標準)。**ラベルの文字はコードで重ねる**ので、画像側はラベル面を**空白**にする

---

# 5. スタイルガイド(STYLE LOCK)

すべての画像生成プロンプトの**先頭に同じブロックを付ける**こと。一貫性が最重要です。

## 5.1 パレット

| 名前 | HEX | 用途 |
|---|---|---|
| Paper cream | `#F5F0E6` / `#EFE8DA` | 紙・面 |
| Soft white | `#FBF9F4` | 白い紙・ステッカーのフチ |
| Kraft | `#C9A878`(影 `#B08A5B` / ハイライト `#DDBF94`) | 封筒・タグ・ノート |
| Graphite ink | `#2B2A28` | 線・スタンプ・文字 |
| Holographic | pink `#F6C6E3` · lavender `#C9C3F5` · sky `#BFE3F7` · mint `#C8F2DC` · lemon `#F7F0BE` · peach `#F9D4C0` | ホログラム箔(**パステル。ネオンにしない**) |
| Silver foil | `#D8DCE2` → `#9AA1AB` | 銀のパウチ・箔の包み |
| Accent red | `#D8453A` | 封蝋・小さなバッジ(**1か所だけ**) |

## 5.2 STYLE LOCK(英語。全プロンプトの先頭に貼る)

```
STYLE LOCK — Peta app art.
Warm, tactile stationery illustration for a Mac desktop app about collecting stickers.
Semi-flat object illustration: clean cut-out shapes with believable paper grain, paper fibre, torn/deckled edges and foil sheen — NOT a photograph and NOT a glossy 3D render.
Soft natural light from the upper left; a very soft, low-opacity contact shadow falling slightly to the lower right.
Palette: warm cream paper (#F5F0E6), kraft brown (#C9A878), graphite ink (#2B2A28), soft white (#FBF9F4), pastel holographic rainbow (pink #F6C6E3, lavender #C9C3F5, sky #BFE3F7, mint #C8F2DC, lemon #F7F0BE), silver foil (#D8DCE2 to #9AA1AB), and at most one small accent red (#D8453A).
Slightly imperfect and hand-made: masking tape, tiny doodles, a hint of late-90s / early-2000s Japanese stationery-shop nostalgia — calm, restrained, premium, indie-Mac-app taste. Never grungy, never cutesy-kawaii overload.
A single isolated object, centred, generous clean margin, on a fully transparent background. No scene, no desk, no hands, no printer, no scissors or cutter, no people.
No text, letters or numbers anywhere unless an exact string is given in quotes. No logos, no brands.
```

## 5.3 NEGATIVE(画像モデルに negative が使える場合/文末に「Avoid:」として付ける)

```
Avoid: photograph, photorealistic scene, 3D render, plastic gloss, neon or saturated gradients, dashboard UI, game UI, emoji style, hands, desk, wooden table, printer, scissors, cutter, tape dispenser, watermark, signature, gibberish text, brand logos, people, harsh black outlines, heavy drop shadows, grunge, dirt.
```

## 5.4 描き方のルール
- **光**: 左上から。影は右下へ、薄く短く。接地影は別レイヤー(`*-shadow.png`)にせず、**素材に軽く含める**(コードで追加の影を付けるときに二重にならないよう、影は弱めに)
- **傾き**: 置いた物らしく**わずかに(−8°〜+8°)**傾けてよいが、レイヤー素材(封筒の部品など)は**傾けずに**正位置で作る(コードで回転させる)
- **質感の出し分け**: Matte = 無光沢の白い紙/Kraft = 繊維のある茶色い紙/Holographic = 白いリング+パステルのレインボー膜+細かいラメ
- **ステッカーのフチ**: 白い紙のダイカット(丸く滑らか)。Holographic のみ外側がレインボー膜
- **余白**: 被写体の周りに**十分な透明余白(8〜12%)**。影が切れないように

---

# 6. 技術仕様(全素材共通)

- **形式**: 透過が要るものは **PNG-24+アルファ**。透過不要のテクスチャ・背景は **JPEG(品質 88〜92)**。ロゴ・アイコン・単純図形は **SVG**(可能なら)
- **解像度**: **@2x(Retina)の実ピクセル**で納品。各素材の表で「px」は**実ピクセル**、CSS 上の表示サイズは約その半分
- **色空間**: sRGB
- **背景**: 透過素材は**完全な透明**。**市松模様を焼き込まない**。エッジに白/黒の縁(ハロー)を出さない
  - 透過が出せない場合は、純色(`#FF00FF` など被写体に無い色)の単色背景で生成 → クロマキー → エッジの汚れを除去。**明るい面と暗い面の両方に重ねて確認**する
- **サイズ予算**: 素材1枚あたり**原則 600 KB 以下**(テクスチャは 500 KB 以下)。PNG は可逆の最適化(`oxipng` 等)を掛ける。P0 全体で **約 25 MB 以下**
- **レイヤー素材**(封筒の部品など)は**同一キャンバス・同一座標**で作る(重ねればそのまま完成形になる)
- **命名**: 小文字・ハイフン区切り。`<group>/<name>[-variant].png`。例: `today/envelope-flap.png`
- **配置**: すべて `src/art/` 以下(§8 の一覧どおり)。**元の高解像度(生成直後)は `assets-src/art/` に保存**(アプリには含めない)
- **`src/art/manifest.json`**: 全素材について `{ id, file, width, height, alpha, priority, usedBy, prompt, seed?, status }` を記録(再現と差し替えのため)
- **`src/art/preview.html`**: 全素材を「ライト背景 / ダーク背景 / 壁紙風の背景」に並べて確認できる一覧ページ。**エッジのハロー確認用**に背景色の切り替えを付ける

---

# 7. 作業手順(Stage)

**Stage 0 — スタイル確定(量産前に必ず人間の確認を取る)**
参考画像を読み、STYLE LOCK で試作を作る。次の**6点だけ**を出力して止まる(`assets-src/art/stage0/`):
1. 封筒(クラフト、`TD-01` の完成形)
2. ホログラムのカード(`TD-03` の holographic)
3. 銀のパウチ Pack(`PK-02` の closed)
4. ステッカー帳の表紙(`BK-01`)
5. 見本ステッカー3点(`SM-01` から、猫+スケボー / 目玉焼き / ブルーの花)
6. ロゴ(`BR-01`)
→ 人間が「質感・色・線・影・手作り感」を確認して OK / 修正指示。**ここを通すまで Stage 1 に進まない。**

**Stage 1 — P0(今の画面に必要)**: ブランド・Today・素材見本・Cutting Mat。素材を作り、**§9 のとおり組み込み**、`preview.html` を作る。
**Stage 2 — P1(Phase 4〜5 の演出素材)**: 印刷・到着・裏面・ステッカー帳・見本ステッカー・空の状態。素材のみ納品(組み込み不要)。
**Stage 3 — P2(Pack・Gift・Marketplace・将来素材)**: 同上。
**Stage 4 — 仕上げ**: `manifest.json` と `preview.html` を最終化、サイズ予算の確認、§10 のチェックリストで自己点検。

各 Stage の終わりに**コミット**する(`art: stage N — …`)。生成のたびに**候補を4枚**出し、**Stage 0 の6点に最も近いもの**を選ぶ。迷ったら質感が静かな方を選ぶ。

---

# 8. アセット一覧と生成プロンプト

凡例: **P0** = 今すぐ(Stage 1)/ **P1** = Phase 4〜5 / **P2** = Pack・Gift・Market・将来。
`{STYLE}` は §5.2 の STYLE LOCK 全文、`{AVOID}` は §5.3 の NEGATIVE。**各プロンプトの先頭に {STYLE}、末尾に {AVOID} を付ける。**

## 8.1 ブランド(`src/art/brand/`)

### BR-01 ロゴ(ワードマーク) — **P0**
- ファイル: `brand/logo-wordmark-ink.png`(+ 可能なら `.svg`)/ `brand/logo-wordmark-white.png`(白版)
- サイズ: 1600 × 700 px(透過)。白版は黒を白に置換
- 用途: 初回起動画面・Today の見出し・ステッカーの裏面の透かし
```
The wordmark "Peta" in a casual brush-pen / marker script, thick friendly strokes with natural pressure variation, slightly slanted, the capital P with a confident curved bowl and a short swash, letters joined loosely as if signed quickly by hand. Graphite ink (#2B2A28) on transparent. Matches the hand-lettered "Peta" logo in the reference mood images. Exactly the four letters P-e-t-a, nothing else.
```
- 備考: 綴り **"Peta"** を厳守。崩れたら SVG パスで手描きし直す(フォントでの代用は不可。筆の味が要る)

### BR-02 アプリアイコン — **P0**
- ファイル: `brand/app-icon-1024.png`(1024 × 1024、macOS アイコン形状 = 内側 824 px の角丸スクワークル。外側は透明)
```
A macOS app icon: a rounded-square cream paper tile (#F5F0E6) with soft depth; on it a single white die-cut sticker (a simple friendly star-and-dot shape or a minimal cat-face silhouette) with a thin pastel holographic rim and a small peeled corner revealing a silver backing paper. Centred, calm, restrained. No text.
```

### BR-03 メニューバー/トレイ用アイコン — **P0**
- ファイル: `brand/tray-template.svg`(+ `tray-template@2x.png` 44 × 44、**黒のみ・透過**、macOS の template image 用)
- 内容: 角の剥がれた四角いステッカーのシルエット。単色。**SVG を手で書いてよい**(画像生成は不要)

## 8.2 Today 画面(`src/art/today/`)

Today ウィンドウは幅 560 px。ここでの表示サイズは約 360 × 240 css px(= 720 × 480 px)。

### TD-01 今日の素材の封筒(レイヤー分割) — **P0**
- 差し替え先: `data-art="envelope"`(`#stage-envelope`)
- ファイル(**すべて 720 × 480 px・同一キャンバス・透過・傾けない**):
  - `today/envelope-back.png`(封筒の内側の奥の面)
  - `today/envelope-card.png`(中から出てくる素材カードの白紙。後述の TD-03 とは別の「入っているカード」。カード面は**空白**)
  - `today/envelope-pocket.png`(手前の身頃=ポケット面。上辺は V 字の折り目まで)
  - `today/envelope-flap.png`(フラップ。**上辺を回転軸に開く**ので、上辺が閉じ位置で身頃の上辺に一致する形で)
  - `today/envelope-closed.png`(上の4枚を重ねた完成形。アニメを使わない場合の静止画)
- 開封アニメの構成: `back → card → pocket → flap` の順に重ねる。flap を上辺中心に `rotateX` で開き、card が上へ滑り出す
```
A handmade kraft-paper envelope seen straight on, slightly fibrous recycled paper, deckled torn-edge flap with a V fold, a small cream paper label patch on the front (leave the label completely blank), a tiny hand-drawn cat-face doodle stamped lower-left in graphite ink, and a small "Peta" brush mark lower-right (only if it can be rendered correctly, otherwise leave it blank). Soft top-left light, very soft shadow. The envelope is closed. Flat, restrained, tactile.
```
- 備考: 5枚が**ピクセル単位で重なる**こと。ラベルの位置(矩形)を `manifest.json` の `labelRect` に記録(コードがそこへ手書き文字 "Today's Material" を重ねる)

### TD-02 銀箔の包み(開封の演出) — **P0**
- 差し替え先: `data-art="material-reveal"`(`#stage-material`)
- ファイル(720 × 480 px、同一キャンバス): `today/foil-back.png`(包みの後ろ半分)/ `today/foil-front.png`(破れた前半分。上が裂けて開いている)
```
A small crinkled silver foil packet, torn open along the top edge with a ragged tear, seen straight on. Soft crinkle highlights, pastel holographic glints along the torn edge, silver (#D8DCE2 to #9AA1AB). The inside is empty so a card can slide out. Two layers on the same canvas: the back half and the torn front half.
```

### TD-03 素材カード(3種) — **P0**
- 差し替え先: `data-art="material-reveal"`(開封後に foil から出てくるカード)
- ファイル(560 × 380 px、わずかに傾けて可): `today/material-card-matte.png` / `-kraft.png` / `-holographic.png`
- **ラベル面(名前とレア度)は空白**。名前・レア度はコードが重ねる
```
(matte)         A rectangular card of uncoated warm white paper with a soft paper grain, thin cream border, a large blank label area in the lower third, slightly rounded corners.
(kraft)         A rectangular card of brown kraft paper with visible fibres and flecks, thin darker edge, a large blank label area in the lower third, slightly rounded corners.
(holographic)   A rectangular card of holographic film: white inner rim, pastel rainbow film (pink, lavender, sky, mint, lemon) with fine glitter, soft prismatic diagonal sheen, a large blank white label area in the lower third, slightly rounded corners.
```

### TD-04 きらめき(レア演出用) — **P0**
- ファイル: `today/sparkles-sheet.png`(スプライトシート 1024 × 256、4 コマ 256 × 256。パステルの小さな4点星/ダイヤ。加算合成向け=黒背景ではなく**透過**)

### TD-05 今日の4択のオブジェクト — **P0**
- 差し替え先: `data-art="choice-create"` / `choice-collection` / `choice-gift` / `choice-pack`(`.choice` ボタン内。表示は約 96 css px)
- ファイル(**すべて 384 × 384 px・透過**):
  - `today/choice-create.png` — **白い紙のカード(インスタントフィルムのような余白)の中央に大きな「+」**。「+」は手描きの墨の線
  - `today/choice-collection.png` — **スパイラル綴じのクラフト表紙のノート**。表紙に小さな青い花のステッカー
  - `today/choice-gift.png` — **クラフトの封筒+赤い封蝋**(赤は唯一のアクセント。バッジの「2」は**描かない**=コードで付ける)
  - `today/choice-pack-pouch.png` — **銀の小さな密封パウチ**(上端がギザギザにシールされている。ラベル面は空白)
  - `today/choice-pack-box.png` — **薄い紙箱/スリーブ型のカードパック**(ラベル面は空白)
- **Pack は A/B 両案を作る**(仕様 §39 は未決。実物を並べて比較して決める)
```
(create)      A white instant-film style paper card with a thick bottom margin, a large hand-drawn "+" in graphite ink centred on the picture area (no picture, just soft off-white), slightly tilted.
(collection)  A small spiral-bound notebook seen from the front, kraft-paper cover with a subtle embossed grid, metal spiral rings along the left edge, one tiny blue cornflower sticker with a white border on the cover.
(gift)        A small kraft-paper envelope, flap closed, a round red wax seal (#D8453A) with a simple embossed "P" at the flap point, slightly tilted. No label text.
(pack-pouch)  A small flat silver foil pouch, crimped zig-zag seal along the top and bottom, soft crinkle highlights, a blank cream paper label patch on the front, pastel holographic glint along the seal.
(pack-box)    A thin paper-sleeve card pack, soft off-white matte paper, a small tear strip near the top, a blank label window in the middle, subtle rounded corners.
```

### TD-06 「See you tomorrow.」 — **P0**
- 差し替え先: `data-art="see-you-tomorrow"`(`#stage-done`)
- ファイル: `today/see-you-tomorrow.png`(640 × 360 px)
```
A small cream paper note with torn edges taped to the top with a strip of semi-transparent washi tape, a tiny hand-drawn crescent moon and two small stars in graphite ink in a corner, the rest of the note left blank for handwriting. Slightly tilted.
```
- 備考: 文字 "See you tomorrow." はコードが手書き風フォントで重ねる

### MT-01 素材の見本チップ — **P0**(3種)/ **P2**(将来素材)
- 用途: Material チップ・Material Book・ステッカー帳の素材アイコン。**192 × 192 px・透過**。角丸の小さな見本片(ステッカー片のように白いフチ)
- ファイル(P0): `materials/swatch-matte.png` / `swatch-kraft.png` / `swatch-holographic.png`
- ファイル(P2): `swatch-glossy` / `swatch-transparent`(透け感・市松は焼き込まない)/ `swatch-gold-foil` / `swatch-silver-foil` / `swatch-riso`(2色刷りの粒子感)/ `swatch-thermal`(感熱紙の灰紫)/ `swatch-glitter` / `swatch-vintage`(黄ばみ・ハーフトーン)/ `swatch-pixel`(ドット絵のグリッド)/ `swatch-iridescent`
```
A small rounded-square material swatch cut like a sticker, with a thin soft-white die-cut rim, showing only the material surface: (matte) uncoated warm white paper grain; (kraft) brown kraft fibres; (holographic) pastel rainbow film with fine glitter and a white inner rim. No objects, no text.
```

## 8.3 Cutting Mat(`src/art/creator/`)

### CR-01 カッティングマット — **P0**
- 差し替え先: `data-art="cutting-mat"`(`main#mat` の背景。3つのペインが載る作業台。表示領域は約 1070 × 430 css px)
- ファイル: `creator/cutting-mat.jpg`(**2400 × 1200 px、JPEG**、継ぎ目なし推奨)/ 任意で `creator/cutting-mat-dark.jpg`
```
A top-down flat view of a soft teal-green self-healing cutting mat: fine light grid lines every 1 cm, slightly heavier lines every 5 cm, small tick marks along the edges (no numbers), a subtle rubbery matte texture, very gentle vignette. Flat, calm, like the green mat in the reference mockup. Nothing on the mat — no objects, no tools, no hands, no text.
```
- 備考: 実写の道具は置かない。**テクスチャのみ**。ペイン(白い紙面)が載ったとき、緑が主張しすぎないよう彩度を抑える

### CR-02 「切っている」待機の演出 — **P0**
- 差し替え先: `data-art="cutting-progress"`(`#loading`。約 280 × 150 css px)
- ファイル: **12コマの連番** `creator/cut-line-00.png … cut-line-11.png`(各 560 × 300 px・透過)と、横一列のスプライト `creator/cut-line-sheet.png`(6720 × 300 px)
```
A dotted dashed cut-line (graphite ink, small round dashes) tracing around a simple friendly cat-shaped sticker silhouette, drawn progressively: frame 0 shows the first few dashes, frame 11 shows the closed outline with two tiny sparkles. Abstract and calm. NO scissors, NO blade, NO hand — only the dashed line and the silhouette (pale cream fill at 30% opacity).
```
- 備考: 12コマは**1.2 秒ループ**を想定。`prefers-reduced-motion` では最終コマのみ

### CR-03 マスキングテープ(装飾) — **P0**
- ファイル(**各 480 × 140 px・透過・半透明・両端がギザギザ**): `creator/tape-1.png` … `tape-4.png`(パステルのレインボー / 無地クリーム / ストライプ / ドット)
- 用途: ペインの角、素材カードの固定。**使いすぎない**(コード側で1〜3か所)
```
A strip of semi-transparent washi masking tape, slightly crumpled, torn zig-zag ends, subtle paper fibre visible through it. (1) pastel holographic rainbow (2) plain warm cream (3) thin diagonal graphite stripes (4) tiny graphite polka dots.
```

## 8.4 印刷・貼る・到着(Phase 4。**素材のみ納品**、実装はこちらで行う)

### PR-01 画面端の「印刷口」 — **P1**
- ファイル: `print/print-slot.png`(**2400 × 48 px**・透過・横長)/ `print/print-slot-glow.png`(2400 × 160 px・加算合成向けのやわらかい光)
```
A very thin horizontal slit, like an abstract paper-output slot: a slim dark rounded bar with a soft inner warm-white glow along its lower edge and a faint paper-edge highlight. No printer body, no buttons, no hands. Just the slot, 2400 px wide.
```

### PR-02 台紙(ステッカーが乗って出てくる紙) — **P1**
- ファイル: `print/backing-sheet.png`(**1000 × 1500 px**・透過・縦長。上下は直線、左右は無地のまま)
```
A tall strip of glassine / silicone sticker backing paper, pale cream with a very faint repeating pattern of tiny "Peta" brush marks and small registration crosses at the corners, subtle paper translucency, clean straight top and bottom edges.
```

### FX-01 「ペタッ」の手書きタグ — **P1**
- ファイル: `fx/peta-tag-ja.png`(480 × 240)/ `fx/peta-tag-en.png`(480 × 240)
```
(ja) A small yellow-cream paper tag, slightly tilted, with the katakana "ペタッ" hand-lettered in thick brush-marker graphite ink, exactly these three glyphs: ペ タ ッ.
(en) The same tag with the word "Peta!" hand-lettered.
```
- 備考: **カタカナの字形が崩れたら画像で作らず**、タグ(空白)だけ作り、文字は手書きフォントで重ねる

### AR-01 デスクトップに届く封筒 — **P1**
- ファイル(**各 480 × 340 px・透過・影はごく薄く**): `arrival/arrival-material.png`(クラフトの封筒、今日の素材が届いた)/ `arrival/arrival-gift.png`(**クリーム色の封筒+赤い封蝋+小さな差出人ラベル面(空白)**)
- 用途: 仕様 §35-36「デスクトップの隅に小さな封筒が届く」。通知の代わり

### GF-01 封蝋 — **P1**
- ファイル: `gift/wax-seal.png`(240 × 240・透過。**割れて開く用に**、`wax-seal-left.png` / `wax-seal-right.png` の2分割も)
```
A round red wax seal (#D8453A) with an irregular hand-pressed edge and a simple embossed "P" mark, a soft highlight on the upper left, flat and tactile. Plus the same seal split cleanly in two halves along a jagged crack.
```

### GF-02 開けるまでわからないステッカー — **P1**
- ファイル: `gift/mystery-sticker.png`(600 × 600・透過): **半透明のグラシン紙に包まれたステッカー**。中身は**濃いグレーのシルエット+白い「?」**
```
A sticker wrapped in translucent glassine paper, the contents hidden: a soft dark-grey blobby silhouette with a white question mark "?" printed on it, seen faintly through crinkled translucent paper, tiny pastel glints. Slightly tilted.
```

### GF-03 受け取りメモ — **P1**
- ファイル: `gift/note-blank.png`(640 × 400): 破れ縁のクラフトのメモ。上部に小さな顔の落書きスペース、**文字面は空白**(コードが `FROM <名前>` を手書き風で重ねる)

## 8.5 ステッカーの裏面(`src/art/back/`)— **P1**

裏面は「紙の質感の面+押印+小さな文字」で、**文字(ORIGINAL / Created by / 日付 / Material / No. / Edition)はすべてコードが重ねる**。

- `back/paper-cream.jpg` / `back/paper-kraft.jpg`(各 **1024 × 1024 px・継ぎ目なしテクスチャ**・繊維と微細なムラ)
- `back/stamp-original-frame.png`(480 × 200・透過): **ゴム印風の二重枠+角のティック**(文字なし)
- `back/peta-mark-small.png`(320 × 120・透過・墨): 小さな "Peta" 筆記ロゴ(BR-01 の縮小版でよい)
- `back/edition-ribbon.png`(320 × 160・透過): 小さなリボン/シールの台(文字なし)
- `back/torn-edge-mask.png`(1024 × 128・透過): 破れた紙縁(下辺用)。裏面カードの下に敷く
```
(paper) A seamless tileable texture of warm uncoated paper with fine fibres and very subtle mottling, even lighting, no text, no objects. (cream) #F5F0E6 base. (kraft) #C9A878 base with darker flecks.
(stamp) A rubber-stamp style double-line rectangular frame in graphite ink with small corner ticks, slightly uneven ink, no text inside.
```

## 8.6 ステッカー帳(Collection、Phase 5。`src/art/book/`)— **P1**

仕様 §44-45: 年 → 月ごとのページ。月のタブ(Oct / Sep …)。**過去を眺める体験**。

- `book/cover-kraft.png`(1600 × 1100・透過): スパイラル綴じのクラフトの表紙、小さな青い花のステッカー
- `book/page-left.jpg` / `book/page-right.jpg`(各 1400 × 1000・透過不要): クリーム色の紙に**ごく薄いドットグリッド**。綴じ側にリング穴の影
- `book/spiral-rings.png`(**96 × 1000・縦方向に継ぎ目なし**・透過): 金属のスパイラル(縦にタイル)
- `book/tab-blank-{1..6}.png`(各 240 × 120・透過): 紙のタブ(右端に出る)。6色(クリーム / クラフト / パステルピンク / ミント / スカイ / レモン)。**文字なし**(月名はコード)
- `book/page-curl-shadow.png`(1400 × 1000・透過): ページをめくるときの影(中央が濃い→外が透明)
```
(cover) A spiral-bound notebook cover seen straight on, kraft paper with a fine embossed grid, metal spiral rings along the left edge, a slightly worn corner, one small blue cornflower sticker with a thick white die-cut border near the lower right. No text.
(page) A cream notebook page with a very faint dot grid, a gentle shadow gutter along the spiral edge, with evenly spaced ring holes. No text, no stickers.
(tab) A small rounded paper index tab in pastel colour with a slight paper texture. No text.
```

## 8.7 見本ステッカー(Welcome Pack。`src/art/samples/`)— **P1**

**初回起動・ヒーロー・空のコレクションを埋める、Peta 自身の12枚**(参考画像のデスクトップに貼られているものがモデル)。
**フチ(白い縁)は付けない**=アプリ側が素材のフチを付けるため。**絵だけを透過PNGで、被写体にぴったり切り抜く**(周囲 8 px の余白)。長辺 **1024 px**。

共通の絵柄: **フラットなベクター風のステッカー絵**。輪郭は太すぎない墨線(または線なしの面)、色は**パステル寄り+少量の濃い色**、**1枚に使う色は4色まで**、影なし(アプリが付ける)、手書きの揺らぎをほんの少し。

| ファイル | 内容 |
|---|---|
| `samples/cat-skateboard.png` | **三毛猫か茶トラがスケートボードに乗っている**。にっこり、少しとぼけた表情 |
| `samples/fried-egg.png` | 目玉焼き(黄身にツヤのハイライト) |
| `samples/good-day.png` | レトロなコミック調の赤と白の文字 **"GOOD DAY"**(斜め配置。**この文字列は正確に**) |
| `samples/blue-flower.png` | コーンフラワー/ベルフラワー風の青い花(茎と葉つき) |
| `samples/polaroid-mountain.png` | 山の風景のインスタント写真(白い枠。写真部分は単純化したイラスト) |
| `samples/retro-computer.png` | 90年代風のベージュの一体型パソコン(**ロゴなし**、ブラウン管の画面に小さな笑顔) |
| `samples/coffee-cup.png` | ソーサー付きのカプチーノ(湯気は描かない) |
| `samples/peta-bubble.png` | ふっくらした青と黄色の**バブル文字 "Peta"**(ステッカー文字。**綴りを正確に**) |
| `samples/purple-scribble.png` | 紫の一筆書きのうねり線(太いマーカー) |
| `samples/film-camera.png` | レトロなフィルムカメラ(**ブランド名なし**) |
| `samples/potted-plant.png` | 鉢植え(モンステラかポトス) |
| `samples/cassette-tape.png` | カセットテープ(ラベルは空白) |
```
{STYLE-lite: flat vector-like sticker artwork, pastel-leaning palette with a little deep colour, at most 4 colours, soft hand-drawn wobble, NO outline border, NO white die-cut border, NO shadow, NO background — artwork only, tightly cropped with an 8 px transparent margin, long edge 1024 px.}
Subject: <row from the table>.
```
- 備考: これらは**そのままアプリのライブラリに入れる**(Phase 6 の Pack「Welcome Pack by Peta」)。生成後、明るい面・暗い面に重ねて**縁の汚れがない**ことを確認

## 8.8 空の状態・初回起動(`src/art/empty/`、`src/art/onboarding/`)— **P1**

- `empty/collection-empty.png`(640 × 400・透過): **空のステッカーシート**(点線で抜かれた形だけが並ぶ台紙)。文字なし
- `empty/nothing-to-peel.png`(640 × 400・透過): 台紙に**角だけ剥がれた跡**がある1枚。文字なし
- `onboarding/hero.png`(1400 × 900・透過): **クリーム色の紙の上に、見本ステッカー3〜5枚が散らばって貼られている**構図(猫スケボー・目玉焼き・青い花・GOOD DAY など)。中央に余白(ロゴ "Peta" と "One sticker a day." と [ Begin ] をコードで重ねる)
  - 仕様 §54: 初回起動のみ中央画面「Peta / One sticker a day. / [ Begin ]」

## 8.9 Pack・Marketplace(Phase 6 / 8。`src/art/pack/`、`src/art/market/`)— **P2**

仕様 §38-41: Pack は Creator が作るステッカーセット。Today の選択から「📦 Pack」で**1枚ずつランダムに開封**する。

- `pack/pack-pouch-closed.png`(768 × 1024・透過)/ `pack/pack-pouch-torn.png`(破れた上端のピース)/ `pack/pack-pouch-inner.png`(中の奥の面)
- `pack/pack-box-closed.png`(768 × 1024)/ `pack/pack-box-torn.png`(切り取り線から開いた上のピース)/ `pack/pack-box-inner.png`
  - どちらも**ラベル面(タイトル "Tokyo Pack" 等と枚数)は空白**。ラベル面の矩形を `manifest.json` の `labelRect` に記録
  - **A案(紙箱)と B案(銀のパウチ)を両方**作る(未決。実物を並べて決める)
- `pack/pack-label-mask.png`(512 × 512): **各 Creator の表紙絵を流し込む枠**のマスク
- `pack/sticker-sleeve.png`(600 × 800・透過): パウチから出てくる**1枚入りの小さなグラシン袋**
- `market/shelf-strip.png`(2400 × 260・透過): **フラットなイラストの木目の棚板**(横長。実写の棚ではない。雑貨店の空気)
- `market/tag-new.png` / `tag-limited.png` / `tag-popular.png`(各 280 × 160・透過): 紙のタグ。**文字なし**(コードが手書き風で載せる)
```
(pouch)  A tall small silver foil pouch standing straight, crimped zig-zag seal at the top and bottom, soft crinkle highlights, pastel holographic glints, a blank cream paper label patch in the middle.
(box)    A tall thin paper-sleeve card pack, off-white matte paper, a perforated tear strip near the top, a blank label window in the middle.
(shelf)  A flat illustrated light-wood shelf plank seen straight on from the front, subtle grain, tiny wear, soft shadow underneath, nothing on it.
```

---

# 9. 組み込み(コード側)

## 9.1 差し替え対象(現状のプレースホルダー)

| `data-art` | ファイル(`src/…`) | 置き換える素材 |
|---|---|---|
| `envelope` | `today.html` `#stage-envelope` | TD-01(レイヤー合成+開封アニメ) |
| `material-reveal` | `today.html` `#stage-material` | TD-02 + TD-03 + TD-04 |
| `see-you-tomorrow` | `today.html` `#stage-done` | TD-06 |
| `choice-create` / `choice-collection` / `choice-gift` / `choice-pack` | `today.html` `.choice` | TD-05(`.choice-icon` の枠を素材に置換。**Pack は A/B をクエリで切替可能に**: `?pack=pouch` / `?pack=box`、既定は pouch) |
| `icon-*`(`.art-inline`) | `today.html` | TD-05 に置き換えたので**削除してよい** |
| `cutting-mat` | `creator.html` `main#mat` | CR-01(`background`)+ CR-03(テープを角に1〜3枚) |
| `cutting-progress` | `creator.html` `#loading .art-slot` | CR-02(12コマ) |
| `back-paper` / `stamp-frame` / `peta-mark`(+ CSS 変数 `--back-paper-image`) | `back-card.js` / `back-card.css`(デスクトップの裏返しと Collection で共通) | 裏面一式(§8.5)。**CSS 変数を差し替えるだけ**で紙が変わる |
| `book-page` / `book-spiral` / `book-tabs` / `book-tab` / `swatch-<id>` | `collection.html` / `collection.css` | ステッカー帳一式(§8.6)と素材の見本チップ(MT-01) |

## 9.2 組み込みの方法(ルール)
- 素材は `src/art/art.css` に**まとめて**書く(`today.css` / `creator.css` から `@import`)。`.art-slot[data-art="…"]` に背景画像を当て、プレースホルダーの `::before` / `::after` と点線の枠を**消す**(`border: 0`)
- **`id`・`data-art`・`data-art-note` は消さない**(JS とドキュメントが参照する)
- 画像は `<img>` か CSS `background`。`alt` は空(装飾)。ボタンの意味は既存の `<strong>` `<small>` のテキストが担う
- ダーク/ライトの両方で破綻しない(`prefers-color-scheme`)。素材は透過なので、**面の色は既存の CSS 変数**に任せる
- **`prefers-reduced-motion: reduce` ではアニメーションを止める**(静止画 `*-closed.png` / 最終コマを表示)
- 追加の JS は**最小限**(クラスの付け外しのみ)。`invoke` の呼び出し・イベントの扱いは変えない

## 9.3 アニメーションの仕様(Today / Cutting Mat のみ)

| 演出 | 仕様 |
|---|---|
| **封筒を開ける**(`#open-material` クリック) | ① 0–120 ms 封筒が `scale(1.03)` に浮く ② 0–450 ms flap が上辺を軸に `rotateX(0→-170deg)`(`perspective: 900px`、`ease-out`)③ 200–650 ms card が 40% 上へ滑り出す ④ 650–800 ms 全体が `scale(1)` に戻る。`invoke("daily_open_material")` の完了と同期(失敗したら閉じ位置に戻す) |
| **素材カードが現れる** | foil-front が下へフェード → card-xxx が `translateY(24px→0)` + `rotate(-4deg→-2deg)` で 350 ms。**Rare 以上**は TD-04 のきらめきを 600 ms だけ重ねる(**ループしない**) |
| **4択のホバー** | 物体が `translateY(-3px) rotate(±1.5deg)` に 120 ms で持ち上がる。押している間は `scale(0.98)` |
| **完了(See you tomorrow.)** | note が `translateY(12px→0)` + フェードイン 300 ms。手書き文字は 400 ms 遅れて |
| **Cutting Mat の待機** | CR-02 の12コマを 1.2 s でループ。完了したら 150 ms でフェードアウト |
| **常時アニメーション禁止** | アイドル中に動き続けるものは作らない(負荷を抑える。仕様 §57) |

---

# 10. 受け入れチェックリスト(自己点検してから報告する)

- [ ] 参考画像と並べて、**質感・色・線・影・手作り感**が同じ世界に見える(Stage 0 で確認済みの基準から外れていない)
- [ ] 全素材が**同じ光(左上)・同じ影(右下、薄い)・同じパレット**
- [ ] 透過素材の**エッジにハロー・市松模様・白縁がない**(`preview.html` の暗い背景で確認)
- [ ] **絵の中に偽テキストがない**。例外は `GOOD DAY` / `Peta` / `ペタッ` / `Peta!` のみで、**綴り・字形が正確**
- [ ] **実写のプリンター・手・机・カッター・はさみが無い**。人物・ブランド・ロゴが無い
- [ ] レイヤー素材(封筒・foil・Pack)が**ピクセル単位で重なる**
- [ ] すべてのファイルが §6 の命名・サイズ・サイズ予算に収まる。`manifest.json` が全素材を網羅
- [ ] Today / Cutting Mat を実際に開いて、**プレースホルダーが残っていない**。ライト/ダークの両方で崩れない
- [ ] `npm test` が通る(JS のロジックを壊していない)。`id` と `data-art` が残っている
- [ ] 最後に**未達の素材と理由**を一覧で報告する(作れなかったもの・質感に不満が残るもの)

---

# 11. 禁止事項(再掲)

実写プリンター/手/机/カッター/はさみ・Dashboard 調・ゲーム UI・ガチャ演出・実在のロゴとブランドと人物・意味のない偽テキスト・ネオンの強い彩度・常時アニメーション・Rust/JS のロジック変更・DOM の `id` の変更。

---

# 付録 A. 画像の文字列(コードが重ねる)

手書き風フォントで重ねる文字列。画像側は**空白**にしておくこと。
`Today's Material` / `FROM` / `ORIGINAL` / `Created by` / `Received from` / `Edition` / `Material` / `No.` / `See you tomorrow.` / 月名(`Oct` `Sep` …)/ Pack のタイトルと枚数

# 付録 B. 優先順位の早見表

| 優先 | 内容 | 件数の目安 |
|---|---|---|
| **P0** | BR-01〜03、TD-01〜06、MT-01(3種)、CR-01〜03 | 約 35 ファイル |
| **P1** | PR-01〜02、FX-01、AR-01、GF-01〜03、裏面一式、ステッカー帳一式、見本ステッカー12枚、空の状態、初回起動のヒーロー | 約 45 ファイル |
| **P2** | Pack(A/B)、Marketplace、将来素材の見本 | 約 25 ファイル |
