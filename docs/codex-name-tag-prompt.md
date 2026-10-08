# Codex に送るメッセージ(Create の名前入力:折れ角の付いた紙の札)

そのまま貼り付けて送る。一緒に渡すもの:

- **仕上がりの見本: `docs/art-reference/name-tag-mock.png`**(左が未入力、右が入力済み)と、置き場所が分かる `docs/art-reference/create-name-field-mock.png`
- 絵柄の基準: `docs/codex-shop-parts-prompt.md` の §0(守ること)
- 既存素材(隣に置いて浮かないこと): `src/art/ui/index-card-blank.png` `src/art/notes/note-memo-torn-cream.png` `src/art/book/page-paper.jpg`

---

Create の画面の左下に、ステッカーの名前を入れる欄を付けます。見本は「折れ角(ページカール)の付いた紙の札」です。**欄の背景になる紙の素材**を、1点ずつ、透明な PNG で描き直してください(見本は文字や矢印が入っていて、そのままは使えません)。文字・矢印・カーソルはコードが重ねるので、**素材には入れません**。

## 0. 共通のルール

- 背景は透明。縁はアンチエイリアスのみ(白や黒のハロー禁止)。透明で出せないときは、単色のマゼンタ `#FF00FF` の背景にして、素材の中にその色を使わない。
- 光は左上、影は右下に短く薄いものだけ素材に含める(コードは追加の影を付けない)。
- 紙は写真でも3Dでもなく、`index-card-blank.png` と同じ**セミフラットな文具イラスト**。繊維の質感はごく控えめに、**文字を載せても邪魔にならない**ように(コントラスト低め)。
- **書き込みは完全に空白**にする(罫線・文字・矢印・穴・テープも描かない)。
- 傾けない。正面・正位置。
- 納品先は `src/art/ui/` の新規ファイルだけ。既存のファイルとアプリのコードは変更しない。

## 1. 納品する素材

**まず ① だけ作って止まってください。** 見本の折れ角と並べて確認してから、残りに進みます。

| # | ファイル(`src/art/ui/`) | 内容 | 比率 | 納品(実px) |
|---|---|---|---|---|
| ① | `name-tag-paper.png` | 名前欄の紙。左側は無地で角丸、**右下の角だけが折れ上がっている**。左右に伸ばして使う(3スライス) | 20:3 | **2400×360** |
| ② | `name-tag-paper-lifted.png` | ①と同じ紙で、折れ角を**もう少し大きく持ち上げた**もの(入力中に差し替える)。キャンバス・位置・紙の面は①と**完全に同じ** | 20:3 | **2400×360** |
| 任意 | `name-tag-paper-flat.png` | ①と同じ紙で、**折れ角のない**角丸の紙(欄が使えないとき・狭い窓の代わり) | 20:3 | 2400×360 |

### 見た目の指定(①)

- 紙の色は温かいオフホワイト(`#FBF8F0` → `#F1EADB`)。ごく薄い繊維、縁はわずかに不揃い。
- 角丸は高さの約16%(左上・右上・左下)。
- **右下の角が折れ上がっている**: 折れた面は紙の裏側で、表より少し濃いクリーム(`#E8DDC4`)、柔らかいグラデーション。折れ目の下に短くて柔らかい影。大きさは**高さの約50%の正方形の範囲**に収める。見本のカールの形と向きを守る。
- **左端から 200px までと右端から 200px までに、固有の絵柄(角丸・折れ角)を置き、その間は一様な紙**にする(横に伸ばしても模様が崩れない)。
- 影は紙の下辺と右辺にだけ、薄く。

### プロンプト

共通ブロック(毎回、先頭に付ける):

```
Single isolated UI prop for a cozy desktop sticker app, drawn as a soft semi-flat stationery illustration (NOT a photo, NOT a glossy 3D render). Straight-on front view, orthographic, perfectly upright. Light from the top-left. Gentle painted shading, very subtle paper-fibre texture kept low-contrast so text can sit on it. A very soft, short shadow to the bottom-right only, baked into the image. Transparent background, clean anti-aliased edges, no white or black halo. No text, letters, numbers, arrows, icons, lines, holes or tape. No other objects.
```

①:

```
[共通ブロック] A wide, completely blank paper name tag for a text field, 20:3 aspect ratio. Warm off-white card paper (#FBF8F0 to #F1EADB), slightly irregular edges, rounded corners (radius about 16% of the height) on the top-left, top-right and bottom-left. The BOTTOM-RIGHT corner is peeled up and curled over like a page curl, showing the slightly darker, warmer underside of the paper (#E8DDC4) as a soft rounded triangle with a gentle gradient, and a soft short shadow under the fold; the curl fits inside a square about half the height of the tag. The area between the 200px at the left end and the 200px at the right end is perfectly uniform paper so it can be stretched horizontally.
```

②: ①のプロンプトの末尾に `The curl is lifted noticeably higher than in the previous image (about 70% of the height), same canvas, same paper, same position.`

任意: ①のプロンプトの `The BOTTOM-RIGHT corner is peeled up ...` の文を `All four corners are rounded the same way, no curl.` に置き換える。

## 2. 納品前に自分で確認する

- 見本の右下の折れ角と、形・向き・濃さ・影が近い。
- ①と②で、紙の面・縁・位置がずれていない(重ねて切り替えても動かない)。
- 横に3倍に伸ばしても、紙の模様と縁が崩れない(左右 200px を保ち、中央だけ伸ばす)。
- ライト・ダーク・壁紙風の背景に重ねて、ハローが出ない。
- 文字・矢印・カーソル・罫線が入っていない。

## 3. 組み立ての約束(コードが使う)

- 欄は `border-image`(3スライス: 左200・右200)で紙を張る。表示の高さは約56px、幅は窓に合わせて伸ばす。
- 文字は手書き風の `Kalam`(同梱済み)、右端に `↵` を SVG で描く(素材は要らない)。
- 入力中は ② を重ねて折れ角を持ち上げる(フォーカスで切り替え)。
