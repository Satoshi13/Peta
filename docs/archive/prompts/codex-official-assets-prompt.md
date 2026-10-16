# Codex に送るメッセージ(公式ステッカー・新素材の画像)

**使い方**: この文書の全文を Codex に渡す。あわせて、次の既存画像を**参考として添付**する(画風と質感の基準)。

- `docs/art-reference/style-target-stickers.jpg`(ステッカーの画風の目標。上段)
- `src/art/samples/` の 12 枚(特に v2 採用分: `cat-skateboard` `fried-egg` `coffee-cup` `peta-bubble` `film-camera` `retro-computer` `potted-plant` `cassette-tape`)
- `src/art/today/material-card-gold.png` / `material-card-riso.png` / `material-card-vintage.png` / `material-card-holographic.png`(素材カードの基準)
- `src/art/back/back-gold.jpg` / `back-riso.jpg` / `back-vintage.jpg`(裏紙の基準)
- `src/art/materials/swatch-kraft.png`(見本チップの基準)

**作業は Phase 順**。各 Phase の最初に**候補グリッドを人間が確認**してから次へ進む(量産前に画風のずれを止めるため)。

> 日本語で指示、**画像生成に貼るプロンプトは英語**。

---

# 0. 依頼の全体像

Peta(毎日ひとつ、ステッカーを貼るデスクトップアプリ)の**公式コンテンツの画像**を作ってください。

| Phase | 内容 | 枚数 |
|---|---|---|
| **1** | 公式ステッカー **Desk Pack**(机の上の文房具) | 12 |
| **2** | 新素材 4 種(Clear / Pixel / Washi / Sakura)× 3 点(カード・裏紙・見本チップ) | 12 |
| **2b** | 既存素材 3 種(Gold / Riso / Vintage)の不足分(見本チップ) | 3 |
| **3** | 公式ステッカー **Time of Day Pack**(1日の時間帯) | 8 |
| **4** | 公式ステッカー **Monthly Pack**(12 か月)+ **Edition Zero**(記念 1 枚) | 13 |
| **5** | **Scraps(切れ端)と瓶**:素材を分解して貯める通貨の絵(瓶 4 点+切れ端 5〜9 種) | 約 13 |

やらないこと: Rust・JS・CSS・DOM などアプリのコードの変更(プレビューの HTML も触らない)。素材カタログ(`materials.rs`)やパックの登録は**こちらで行う**。あなたは画像・`pack.json`・manifest・preview だけ。

---

# 1. 世界観(絶対に守る)

- Peta は **One sticker a day. 毎日、ひとつだけ。** 紙・クラフト・ホログラム・手作りの文具の世界。**ゲームでも SNS でもない。**
- 空気: **Apple native + Indie Mac app + Stationery + Sticker culture + ほんの少しのノスタルジー**。90〜00 年代の日本の文房具店・雑貨店。かわいいが大人っぽく、静かで抑制がある。
- 色: クリーム `#F5F0E6` / クラフト `#C9A878` / グラファイト `#2B2A28` / ソフトホワイト `#FBF9F4` / ホログラムのパステル(pink `#F6C6E3` lavender `#C9C3F5` sky `#BFE3F7` mint `#C8F2DC` lemon `#F7F0BE`)/ 銀 `#D8DCE2→#9AA1AB` / アクセントの赤 `#D8453A`(**1 か所だけ**)。**ネオン・蛍光・強い黒は使わない。**
- 光は左上から。影は右下に薄く短く。

**NG(絶対に入れない)**
1. ゲーム UI 化(XP・レベル・ミッション・強さ)。**ガチャを主役にした絵**(ガチャ機、ルーレット、確率表示)
2. フォトリアル、3D レンダー、エナメルのツヤ、縁の光(rim light)
3. 実在のロゴ・ブランド・キャラクター・人物の顔
4. **意味のない文字**(崩れた偽テキスト)。文字は、プロンプトに**引用符つきで指定した文字列だけ**
5. 白いダイカットのフチ・接地影・背景・台紙(**ステッカーのフチと影はアプリが素材ごとに付ける**。絵にはつけない)

---

# 2. 共通ブロック(プロンプトの先頭に貼る)

## 2.1 STYLE-sample v2(ステッカー用。Phase 1・3・4)

`{MEDIUM}` は各題材の表から入れる。

```
STYLE-sample v2 — Peta official sticker illustration.
A single sticker-ready illustration as a human illustrator would draw it for a stationery brand: SIMPLE and CONFIDENT, with large clear shapes and only the details that matter. Medium: {MEDIUM}.
Shading in only 2–3 clear tone steps, not smooth airbrushed gradients. A little hand-made wobble in lines and edges; slightly asymmetric; nothing perfectly symmetrical or perfectly round. Matte finish.
Warm natural colours, slightly desaturated: cream, kraft brown, dusty blue, sage green, brick red, butter yellow, graphite. Light from the upper left, soft and low-contrast. Late-90s / early-2000s Japanese stationery-shop nostalgia: cute but grown-up, calm, restrained.
Reflections: at most ONE small simple highlight shape. No rim lighting, no sparkles, no glossy enamel look.
The subject is isolated on a fully transparent background, tightly cropped with an 8 px transparent margin, long edge 1024 px. The silhouette is clean and smooth (no fuzzy fringe, no frayed edges).
NO white die-cut border, NO ground shadow, NO background, NO sticker backing sheet.
```

## 2.2 NEGATIVE(ステッカー用)

```
Avoid: highly detailed, hyper-detailed, intricate, 8k, photorealistic, photograph, 3D render, cinematic lighting, rim light, glossy, enamel, plastic gloss, airbrushed gradient, smooth blended shading, individual hair strands, sparkles, bokeh, symmetrical perfection, flat vector with hard black outlines, neon colours, white die-cut border, background, drop shadow, real brands, logos, extra text, gibberish text, watermark.
```

## 2.3 STYLE LOCK(素材カード・裏紙・見本チップ用。Phase 2)

```
STYLE LOCK — Peta app art.
Warm, tactile stationery illustration for a Mac desktop app about collecting stickers.
Semi-flat object illustration: clean cut-out shapes with believable paper grain, paper fibre, torn/deckled edges and foil sheen — NOT a photograph and NOT a glossy 3D render.
Soft natural light from the upper left; a very soft, low-opacity contact shadow falling slightly to the lower right (shadow stays within 6 px of the edge).
Palette: warm cream paper (#F5F0E6), kraft brown (#C9A878), graphite ink (#2B2A28), soft white (#FBF9F4), pastel holographic rainbow (pink #F6C6E3, lavender #C9C3F5, sky #BFE3F7, mint #C8F2DC, lemon #F7F0BE), silver foil (#D8DCE2 to #9AA1AB), and at most one small accent red (#D8453A).
Slightly imperfect and hand-made. Calm, restrained, premium, indie-Mac-app taste. Never grungy, never cutesy-kawaii overload.
No text, letters or numbers anywhere. No logos, no brands. No scene, no desk, no hands, no people.
```

NEGATIVE(素材用):

```
Avoid: photograph, photorealistic scene, 3D render, plastic gloss, neon or saturated gradients, dashboard UI, game UI, emoji style, hands, desk, wooden table, watermark, signature, gibberish text, brand logos, people, harsh black outlines, heavy drop shadows, grunge, dirt, baked-in checkerboard transparency pattern.
```

---

# 3. Phase 1 — 公式ステッカー「Desk Pack」(12 枚)

**コンセプト**: 机の上の小さな文房具。Peta の世界(紙・スタンプ・封蝋・テープ)そのものを、ステッカーとして集められるようにする。
**パック**: `desk` / タイトル `Desk Pack` / 作者 `Peta` / 12 枚 / 外装 `kraft`(クラフト袋)

**画風のルール(v2 と同じ)**
- 4 候補を出し、**一番きれいなものではなく、一番情報量が少なく人が描いた感じのもの**を選ぶ。ツヤ・縁の光・完全な左右対称・ささくれは落とす。
- 画材は**題材ごとに変える**が、彩度・光・線の細さは揃え、**12 枚を 50% で並べて同じパックに見える**こと。
- **レア度は「絵の描き込み」ではなく「題材の特別さ」で表す**(Rare だけ派手に描かない。ツヤやキラキラは入れない)。
- 文字は、指定がある枚の**指定文字列だけ**。それ以外は文字なし。

| # | key | レア度 | `{MEDIUM}` | 題材プロンプト(STYLE-sample v2 の後に続ける) |
|---|---|---|---|---|
| 1 | `masking-tape` | Common | gouache, flat colour blocks | `A roll of pastel pink washi masking tape lying on its side, with a short torn strip peeling off and curling at the lower right. Simple round roll, a hole in the middle, a few faint stripes on the tape. No text.` |
| 2 | `pencil-stub` | Common | coloured pencil on cream paper, soft edges | `A short, well-used yellow-ochre pencil stub with a sharpened graphite tip and a pink eraser end in a thin silver band, tilted about 20 degrees. Flat colour, 2 tone steps. No text.` |
| 3 | `rubber-stamp` | Common | matte screen-print, flat colour | `A small wooden-handled rubber stamp with a round kraft-brown handle and a dark base, seen from the side, with a tiny faint ink smudge on the base. No text, no pattern on the stamp face.` |
| 4 | `paper-clips` | Common | gouache with thin pencil linework | `Three paper clips in silver-grey, dusty blue and brick red, loosely linked together. Simple smooth wire shapes, one soft highlight on the silver one only.` |
| 5 | `sticky-notes` | Common | flat gouache, matte paper look | `A small stack of butter-yellow sticky notes with the top one slightly curled at the lower right corner and a hand-drawn tiny wavy line on it. The notes are blank; no text.` |
| 6 | `index-card-box` | Common | matte printed illustration, flat colours | `A small kraft cardboard index-card box with the lid slightly open and cream cards poking up, one card tilted. A blank cream label on the front. No text.` |
| 7 | `eraser` | Common | gouache, soft flat shapes | `A white rectangular eraser half-wrapped in a dusty-blue paper sleeve, with one corner worn round and a small grey smudge. No text on the sleeve.` |
| 8 | `scissors` | Uncommon | gouache with thin pencil linework | `A pair of paper-craft scissors with brick-red rounded handles and plain silver blades, slightly open, seen from the front. Simple and chunky, toy-like. One small highlight on a blade.` |
| 9 | `ink-bottle` | Uncommon | watercolour wash with a coloured-pencil edge | `A small squat glass ink bottle with dark blue ink, a cork stopper and a blank cream label, a single drip of ink down one side. Glass is suggested by two flat tones, NOT shiny.` |
| 10 | `desk-lamp` | Uncommon | matte flat illustration, thin pencil linework | `A small retro desk lamp with a round sage-green metal shade and a bent arm on a round base, a soft butter-yellow glow shape under the shade (a flat pale yellow shape, not a gradient).` |
| 11 | `wax-seal` | Rare | gouache, thick flat paint | `A round red sealing-wax seal (brick red #D8453A) with an irregular blobby edge and a simple embossed capital letter "P" in the middle, with a small short wax drip. Matte, two tone steps, at most one small highlight. The only text is exactly: P.` |
| 12 | `fountain-pen` | Rare | matte flat illustration with thin pencil linework | `A fountain pen lying at a slight angle: a deep dusty-blue barrel with a thin cream band, a gold-toned nib drawn as flat butter-yellow and ochre shapes (NOT metallic shine). Simple and elegant. No text.` |

**レア度の根拠**: Common 7 / Uncommon 3 / Rare 2。開封の抽選で使う(パックの重みはこちらで決める)。

---

# 4. Phase 2 — 新素材 4 種(Clear / Pixel / Washi / Sakura)

素材 = ステッカーの**作り方(紙の種類)**。ステッカーそのものの質感はアプリが作るので、ここで作るのは**素材を見せるための 3 点セット**。

| 素材 ID | 名前 | レア度 | イメージ |
|---|---|---|---|
| `clear` | Clear | Rare | 透明なフィルムに白インキ。すりガラスのような、冷たく静かな質感 |
| `pixel` | Pixel | Uncommon | 小さなドット/ディザの印刷。90 年代のレトロ画面の柔らかい版 |
| `washi` | Washi | Uncommon | 繊維の見える和紙。手でちぎった縁、淡い色 |
| `sakura` | Sakura | Archive(春限定。抽選に出ない) | 薄桃色の紙に、押し花のような花びらの繊維 |

## 4.1 3 点セットの仕様

既存の `material-card-gold/riso/vintage` と `back-gold/riso/vintage` に**寸法・構成・余白を揃える**(参考として添付)。

| 点 | ファイル | 寸法 | 形式 | 内容 |
|---|---|---|---|---|
| カード | `src/art/today/material-card-{id}.png` | **560 × 380** | PNG-24 + alpha | 角丸の素材カード(角丸 ≒ 28px)。外側は完全に透明。カード全面にその素材の表面。下部に**空白のクリーム色の紙ラベル**(横幅 ≒ 70%、高さ ≒ 22%、縁はわずかにちぎれ)。ラベルは**完全に空白**(文字はコードで重ねる) |
| 裏紙 | `src/art/back/back-{id}.jpg` | **1024 × 1280** | JPEG 品質 88〜92 | 全面の素材テクスチャ。**静かで均一**(物・模様の主張なし)。中央は文字を重ねるので落ち着いた面。縁だけ少し暗く |
| 見本チップ | `src/art/materials/swatch-{id}.png` | **192 × 192** | PNG-24 + alpha | 角丸の正方形(角丸 ≒ 40px)。素材の表面を全面に。ソフトホワイトの縁(≒ 10px)で囲む(`swatch-kraft.png` と同じ作り) |

共通: 文字・数字・ロゴなし。市松模様を焼き込まない。カードの不透明部は alpha 255(透け素材のみ後述)。

## 4.2 プロンプト

STYLE LOCK(§2.3)を先頭に貼り、続けて次を使う。**カード**と**裏紙**と**見本チップ**は同じ素材表面から作り、3 点で色味・質感が一致すること。

### Clear(透明)

```
{STYLE LOCK}
MATERIAL: "Clear" — a sheet of frosted transparent sticker film with white ink.
Surface: pale cool grey-blue frosted acetate, very subtle fine frosting grain, a few tiny trapped air-bubble dots, and ONE soft diagonal glare band across the upper left (a flat soft pale shape, not shiny). It reads as translucent but is rendered as an opaque, calm, cool-toned surface (do NOT draw a checkerboard or see-through background).
Colours: pale blue-grey (#DCE6EC to #C5D3DB), soft white, a hint of lavender in the shadows.
```
- カード: 上の表面を角丸カードにして、下部に空白のクリーム紙ラベル。
- 裏紙: 同じ表面を全面に、ガラス感は控えめに。
- 見本チップ: 表面を全面に + ソフトホワイトの縁。

### Pixel

```
{STYLE LOCK}
MATERIAL: "Pixel" — a sticker sheet printed with a soft, pastel pixel-dither pattern.
Surface: warm cream paper printed with a very fine, regular dither/pixel-dot pattern in pastel dusty blue, pink and lemon, forming gentle diagonal gradients made of tiny square dots (about 6 px squares). Calm and low-contrast; reads as a soft 90s retro-screen print, NOT neon, NOT arcade.
Colours: cream (#F5F0E6) base with dusty blue (#BFD3E6), pink (#F6C6E3) and lemon (#F7F0BE) dots.
```

### Washi(和紙)

```
{STYLE LOCK}
MATERIAL: "Washi" — handmade Japanese paper.
Surface: warm off-white with a faint peach tint, long visible plant fibres running in many directions, soft mottled thickness variations, slightly translucent look in the thin spots (rendered as lighter patches, not see-through). The card edge is a gently hand-torn deckled edge.
Colours: #F3E9DC base, #E9D5C2 fibres, soft white highlights.
```

### Sakura(春限定)

```
{STYLE LOCK}
MATERIAL: "Sakura" — pale pink handmade paper with pressed cherry-blossom petals.
Surface: very pale pink paper (#F8E3E6) with soft cloudy fibres and a few (5–8) tiny pressed petal shapes and thin petal fragments embedded in the paper, each a flat 2-tone pink. Sparse and calm; most of the surface stays plain pale pink.
Colours: pale pink, soft white, a touch of dusty rose for petals (#E9B7C0).
```

## 4.3 Phase 2b — 既存素材の不足分

`gold` `riso` `vintage` は、カードと裏紙があるが**見本チップが無い**。既存のカード/裏紙と同じ表面で、`src/art/materials/swatch-gold.png` `swatch-riso.png` `swatch-vintage.png`(192 × 192、仕様は §4.1)を作る。新規の表面は作らない(カードから切り出して整えてよい)。

---

# 5. Phase 3 — 公式ステッカー「Time of Day Pack」(8 枚)

**コンセプト**: 1 日の時間帯の小さな風景・物。「毎日ひとつ」に合う。
**パック**: `timeofday` / タイトル `Time of Day` / 作者 `Peta` / 8 枚 / 外装 `matte`(白い紙袋)
**ルール**: §3 と同じ(4 候補→一番単純なものを選ぶ、画材は題材ごとに変える)。

| # | key | レア度 | `{MEDIUM}` | 題材プロンプト |
|---|---|---|---|---|
| 1 | `morning-toast` | Common | gouache, soft flat shapes | `A slice of golden-brown toast with a small square of butter melting on it, on nothing else (no plate). Crust in a darker tone, 3 tone steps.` |
| 2 | `open-window` | Common | loose watercolour wash | `A small square window with its two shutters open, a pale blue sky, one soft cloud, and a thin cream curtain lifted by the wind. Simple frame in kraft brown.` |
| 3 | `bento-box` | Common | matte printed illustration, flat colours | `A two-tier bento box seen from above with the lid off: a round rice area with a single red pickled plum, a rolled omelette, a green bean, a small orange carrot flower. Few big shapes.` |
| 4 | `teapot-and-cup` | Common | gouache with thin pencil linework | `A round cream teapot with a small sage-green lid knob and a matching small cup beside it, a faint pale steam curl NOT used (no steam). Simple chunky shapes.` |
| 5 | `sunset-sky` | Uncommon | watercolour wash, wet-on-wet look | `A small rounded-rectangle patch of evening sky in 3 flat bands (butter yellow, peach pink, dusty lavender) with two simple dark-blue cloud shapes and a tiny hill silhouette at the bottom.` |
| 6 | `crescent-moon` | Uncommon | matte screen-print, flat colour | `A butter-yellow crescent moon with a soft sleepy face (two closed-eye curves, a tiny smile) and one small star beside it. Flat, two tones. No text.` |
| 7 | `sleeping-cat` | Uncommon | gouache with soft chalky edges | `A tabby-and-cream cat curled up asleep on a small round dusty-blue cushion, tail wrapped around the body. Fur suggested with a few clumps, NOT hairs. Clean smooth silhouette.` |
| 8 | `shooting-star` | Rare | matte screen-print, flat colour | `A single plump butter-yellow five-point star with a swept tail of three thin pastel stripes (pink, lavender, sky) trailing to the lower left. Flat matte, NO sparkle, NO glow, no glossy highlight.` |

レア度: Common 4 / Uncommon 3 / Rare 1。

---

# 6. Phase 4 — 「Monthly Pack」(12 枚)と「Edition Zero」(1 枚)

## 6.1 Monthly Pack

**コンセプト**: その月の小さなモチーフ。**ランダムではなく、その月に開くとその月の 1 枚**(レア度なし)。
**パック**: `monthly` / タイトル `Monthly` / 作者 `Peta` / 12 枚 / 外装 `matte`
**ルール**: §3 と同じ。12 枚は**月ごとに季節の色が変わってよい**が、並べて同じパックに見えること。

| # | key | 月 | 題材(`{SUBJECT}`) | `{MEDIUM}` |
|---|---|---|---|---|
| 1 | `m01-sunrise` | 1 | `a first sunrise: a half butter-yellow sun rising behind a small simple hill, three thin rays` | gouache, flat shapes |
| 2 | `m02-plum` | 2 | `a plum blossom branch with five round pink blossoms and two buds` | watercolour with pencil edge |
| 3 | `m03-peach` | 3 | `a peach blossom sprig with a few leaves, soft pink` | watercolour wash |
| 4 | `m04-sakura` | 4 | `a cherry-blossom branch with a handful of five-petal blossoms and a few falling petals` | watercolour wash |
| 5 | `m05-carp` | 5 | `a single carp streamer (koinobori) in dusty blue and brick red with a round eye, flying to the right` | gouache, flat shapes |
| 6 | `m06-umbrella` | 6 | `a small closed-top round umbrella in dusty blue with a tiny snail beside it` | gouache with thin pencil linework |
| 7 | `m07-tanabata` | 7 | `a bamboo twig hung with three coloured paper strips and one paper star, strips left blank` | matte printed illustration |
| 8 | `m08-watermelon` | 8 | `a wedge of watermelon with seeds next to a round paper fan (uchiwa), fan blank` | gouache, flat shapes |
| 9 | `m09-dango` | 9 | `three moon-viewing dumplings on a short wooden stick beside a few pampas-grass stalks` | gouache with soft chalky edges |
| 10 | `m10-leaves` | 10 | `a ginkgo leaf and a maple leaf overlapping, butter yellow and brick red` | watercolour wash |
| 11 | `m11-persimmon` | 11 | `two orange persimmons with a green leaf-cap on one short branch` | gouache, flat shapes |
| 12 | `m12-mitten` | 12 | `a single chunky knitted mitten in cream with a dusty-blue stripe and a tiny red pom-pom` | matte flat illustration |

プロンプト: STYLE-sample v2 の後に `{SUBJECT}. Few big shapes, 2–3 tone steps. No text.` を続ける。

## 6.2 Edition Zero(記念 1 枚)

**パック**: なし(単体)。レア度 `special`(抽選には出ない、配布用)。
`{MEDIUM}`: matte screen-print, flat colour

```
{STYLE-sample v2}
A round cream badge sticker shape (a hand-drawn circle, slightly imperfect) containing a large brush-lettered capital "P" in graphite ink (#2B2A28), and one small brick-red (#D8453A) wax-seal dot at the lower right of the circle. Matte, flat, two tone steps. The only text is exactly: P.
```

---

# 7. Phase 5 — Scraps(切れ端)と瓶

**コンセプト**: 毎日届く素材(Kraft / Holographic など)を切り刻んで**共通通貨「Scraps」**にし、**ガラス瓶**に貯める。貯まった量は瓶の中身で見せる(数字の HUD は主役にしない)。Market では、この瓶からパックへ切れ端が飛んでいく。
プレビュー: `docs/ui-proposals/scrap-market-preview.html`(仮の CSS/SVG の瓶。**この見た目とサイズ感に合わせて、絵に差し替える**)。
**方針(オーナー指示)**: 切れ端は「紙を細かく切り刻んだ様子」を描かない。**デフォルメした、ぽってりした小さな紙片**にする。瓶は**小さめ**(アプリ内で 画面の幅の 約 20%)で、**描き込みを少なく**、形を大きく単純に。値札(ラベル)は今のままの雰囲気で良い。

**NG(ここは特に注意)**: ガチャ機・コイン・お金・ゲームの宝箱に見えるもの。瓶は**文房具店・雑貨店にある普通のガラス瓶**(ジャム瓶・ビー玉の瓶のイメージ)。フォトリアルにしない(半フラットのイラスト)。

## 7.1 瓶(4 点・同一キャンバス、重ねればそのまま完成)

| ファイル | 寸法 | 内容 |
|---|---|---|
| `src/art/scraps/jar-back.png` | 520 × 720 | 瓶の奥側のガラス。ごく薄い青みのある透明(alpha 20〜35%)。口は**開いている**(蓋なし)。底の厚いガラス。**ずんぐりした小さめの瓶**(縦横比 ≒ 3:4) |
| `src/art/scraps/jar-front.png` | 520 × 720 | 瓶の手前側。縁の線、左に縦長の白いハイライト帯(細い帯と太い帯の 2 本)、右に薄いハイライト、底の厚み。**中身を隠さない**(ほぼ透明) |
| `src/art/scraps/jar-lid.png` | 312 × 144 | 瓶の蓋。クラフト色のコルク風または紙巻きの金属蓋。**横に倒して置いた状態**(瓶から外れている)。わずかに傾き(約 14°) |
| `src/art/scraps/jar-tag.png` | 420 × 200 | 瓶に貼る**空白のクラフトの値札**(左に紐穴、右が少し丸い)。**文字は入れない**(数字はコードで重ねる) |

**共通**: 4 点とも同じ 520 × 720 の座標で瓶を描く(`jar-lid` と `jar-tag` は別キャンバス)。瓶の内側の幅は 画像の 約 74%(プレビューの 192/260)。口は上部中央。
STYLE LOCK(§2.3)を先頭に貼り、続けて:

```
{STYLE LOCK}
OBJECT: an empty clear glass storage jar, wide round body with a short neck and an open mouth (no lid), like a stationery-shop or sweet-shop jar. Semi-flat illustration: the glass is drawn with very pale blue-grey translucent fill, a thin darker blue-grey outline, a thick glass base, one tall soft white highlight band on the left and a thin one on the right. Not photorealistic, not shiny chrome. Light from the upper left.
Deliver as two transparent layers on the same canvas: BACK layer (rear glass wall and base only) and FRONT layer (outline, highlights and front rim only), so that scraps can be drawn between them.
```

## 7.2 切れ端(素材ごとの紙片シート)

素材ごとに 1 枚、**8 種類の紙片が 4 × 2 に並んだスプライト**。1 マス 128 × 96、シート 512 × 192、背景は完全な透明。

| ファイル | 素材 | 紙片の見た目 |
|---|---|---|
| `src/art/scraps/pieces-kraft.png` | Kraft | 茶色い繊維紙の切れ端。片側が白っぽい裏紙 |
| `src/art/scraps/pieces-riso.png` | Riso | ピンクと水色の 2 色刷りの雲模様の切れ端 |
| `src/art/scraps/pieces-vintage.png` | Vintage | 黄ばんだ紙。シミのある切れ端 |
| `src/art/scraps/pieces-gold.png` | Gold Foil | 金箔の切れ端(**ツヤは小さなハイライト 1 か所まで**) |
| `src/art/scraps/pieces-holographic.png` | Holographic | パステルのレインボーの膜の切れ端(ネオンにしない) |
| `src/art/scraps/pieces-{clear,pixel,washi,sakura}.png` | 新素材 4 種 | §4 の素材の質感の切れ端(Phase 2 の後で) |

**紙片の形(デフォルメ)**: ぽってりと丸みのある、**紙吹雪・ちぎり絵のかけら**のような形。丸みのある四角、丸みのある三角、ふくらんだ豆形、角の取れた小さな短冊など。縁は**角を丸く**する(ハサミで切った鋭い辺にしない)。大きさは 1 マスの 50〜80%。**完全に似たものを作らず、8 種を別々の形にする**。縁に細い濃い色の輪郭線(素材色より少し濃い)を付けてよい。白いフチ・影は付けない(コードが軽い影を付ける)。**コイン・星・ハートに見える形は避ける**。素材カード(`material-card-*.png`)と**同じ表面**のかけらに見えること。

```
{STYLE LOCK}
OBJECT: a sprite sheet of 8 different small paper scraps cut from {MATERIAL SURFACE}, arranged in a 4 x 2 grid on a fully transparent background, each scrap centred in its own 128 x 96 cell with margin. The scraps are chunky, soft, simplified paper confetti bits with rounded corners: rounded squares, rounded triangles, plump bean shapes and small rounded strips, each a different shape, slightly irregular, with a thin slightly darker outline. NOT scissor-cut, no sharp corners, no coin, star or heart shapes. No white border, no shadow. The surface of every scrap matches the {MATERIAL SURFACE} of the Peta material card exactly (same colours, same texture).
```

(`{MATERIAL SURFACE}` には、各素材カードの質感の説明を入れる。参考画像として該当の `material-card-*.png` を添付する。)

## 7.3 受け入れ

- 瓶の内側に切れ端を重ねて**プレビューと同じ**に見える(プレビューは `src/art/scraps/` の画像に差し替えて確認する。コードの変更はこちらで行う)。瓶が大きすぎず、描き込みが少ない。
- 瓶がコインやお金の入れ物に見えない。切れ端の絵は紙・箔だけで、コインに見える丸や星の形がない。

---

# 8. 納品の仕様

## 7.1 ステッカー(Phase 1・3・4)

- 場所(原本): `assets-src/art/official/{pack}/{key}.png`(Git に入れない)。ランタイム用: `src/art/packs/{pack}/{key}.png`
- 形式: PNG-24 + alpha、**長辺 1024px**、**透明な余白 8px**、**900 KB 以下**、白フチ・影・背景を付けない。
- パックごとに `src/art/packs/{pack}/pack.json` を作る(スキーマは下)。**コードは変更しない**。
- パックごとの一覧画像(`docs/official-assets/{pack}-board.jpg`、50% サイズで 1 列)を作り、見本 12 枚(`src/art/samples/`)と**並べて**違和感がないか自己点検する。

`pack.json`:

```json
{
  "id": "desk",
  "title": "Desk Pack",
  "author": "Peta",
  "pouch": "kraft",
  "items": [
    { "key": "masking-tape", "name": "Masking Tape", "rarity": "common" },
    { "key": "wax-seal", "name": "Wax Seal", "rarity": "rare" }
  ]
}
```

(`name` は英語の短い名前。`rarity` は §3・§5 の表のとおり。Monthly は `rarity` を省略し、代わりに `"month": 1` を入れる。Edition Zero は `"rarity": "special"`。)

## 7.2 素材(Phase 2・2b)

- 配置: §4.1 の表のとおり。**既存ファイルは上書きしない**(新しい id のみ追加)。
- 容量: カード 400 KB 以下・裏紙 500 KB 以下・見本 80 KB 以下。PNG は可逆最適化。
- 3 点(カード・裏紙・見本)を**暗い面・明るい面の両方に重ねて**、縁にハロー(白/黒の縁)が出ないことを確認。

## 7.3 検査と報告

- 従来の検査: `art-check.py` / `npm test` / `git diff --check`。alpha(内部 255、透けを許す素材は報告に明記)・8px 余白・容量・彩度。
- `manifest.json` に追加分を登録し、`src/art/preview.html` に一覧を足す(既存の様式のまま)。
- **自己点検(目視で報告に書く)**
  - [ ] 各パックを 50% で並べ、参考画像より**描き込みすぎ**の枚が無い。
  - [ ] ツヤ・縁の光・エナメル感が無い。Rare の枚も同じ画風(派手にしていない)。
  - [ ] 文字が指定どおり(`wax-seal` と `edition-zero` の "P" のみ。他は文字なし)。
  - [ ] 12 / 8 / 12 枚が**同じパック**に見える。見本 12 枚(Welcome Pack)とも並べて極端に浮かない。
  - [ ] 素材 4 種のカード・裏紙・見本が**3 点で色味と質感が一致**。Clear に市松模様が焼き込まれていない。
  - [ ] ゲーム UI・ガチャの絵・実在ブランド・白フチ・影が無い。
- 報告: `docs/official-assets-report.md` に、パック・素材ごとの「採用した候補とその理由」「直せなかった点」を書く。
- コミット: Phase ごとに分ける(`art: official Desk Pack stickers` / `art: new materials clear pixel washi sakura` など)。指定ブランチに push。

---

# 9. こちら側の作業(Codex は触らない・参考)

素材の追加は、画像のほかに Rust 側のレシピが必要です(`materials.rs` の `MaterialRecipe`)。**案**:

| id | substrate | border | 主な値 | 追加で要る処理 |
|---|---|---|---|---|
| `clear` | `clear_film` | 白インキ・フチなし | `transparency` 0.7、`reflection` なし | 透明地への白インキ合成(新規) |
| `pixel` | `paper` | 白 0.03 | `color_treatment: dither`、`noise` 0.1 | ディザ処理(新規) |
| `washi` | `washi` | ちぎれ風 0.03 | `texture: washi_fibre`、`transparency` 0.2 | 繊維テクスチャ(新規) |
| `sakura` | `paper` | 白 0.03 | `texture: petal_fibre`、`rarity: archive` | 期間限定の入手経路 |

- 抽選の重みは、`materials.rs`(50/32/18)と README・決定事項(60/30/10)が**食い違っている**ので、素材を足す前に正を決める。素材を増やすと同じレア度の中で確率が等分される。
- パック: `pack.json` の `rarity` を使って、開封の抽選に**レア度の重み**を入れる。画像の置き場は今の `art/samples/` 固定なので、`packs/{id}/` に一般化する(`pack.rs` / `pack_install`)。
