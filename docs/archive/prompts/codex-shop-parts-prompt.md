# Codex に送るメッセージ(ステッカーのお店の部品:レール・フック・ヘッダーカード・値札・棚金具)

そのまま貼り付けて送る。一緒に渡すもの:

- 構図の見本: `docs/ui-proposals/sticker-shop-v3-preview.html`(ブラウザで開く。下のほうに「依頼する部品」の一覧がある)
- 見て合わせる既存素材(§1)と `docs/art-reference/` の4枚

---

Market と Packs を「お店の陳列」に作り替えます。**Market は店頭のレール(袋を吊るす)、Packs は自分の棚(袋を立てる)**です。袋・棚板・コルクボード・メモ・紙クリップはすでにあります。足りないのは、**レールと金具とフック、袋に付けるヘッダーカード、値付けシール、棚の天面・ブラケット・値札レール**です。いまはCSS/SVGの仮の絵で構図を確認しています。これを、**既存のアートの隣に置いて違和感の出ない本物の部品**に差し替えたい。

**いちばん大事なのは「世界観を壊さないこと」です。** このアプリは、洗練された平らなUIの上に、**紙・箔・金属の小物が乗っている**ギャップが世界観です。小物は写真でも3Dレンダリングでもなく、既存の `pack-*.png` や `shelf-board.png` と同じ**セミフラットな文具イラスト**で描きます。金属も例外ではありません(クロームの反射・ガラスのツヤは禁止)。

## 0. 守ること

- 絵柄・パレット・光・影は `docs/archive/prompts/codex-art-prompt.md` の **§5 STYLE LOCK / NEGATIVE / 描き方のルール**と `src/art/manifest.json` の `shadowPolicy`(影は `#2B2B2B`・最大 alpha 30・6px 以内・右下 2px)に従う。**今回の部品は影を素材に軽く含める**(コードは追加の影を付けない前提)。
- **金属は「銀の箔」と同じ扱い**: `#D8DCE2` → `#9AA1AB` の2〜3段のトーンと、左上の細いハイライト1本だけ。環境の映り込み・グラデーションの派手なツヤ・ネオン・青白いクロームは禁止。
- 不透明な面は alpha 255、縁のアンチエイリアス以外に半透明は使わない(影は例外)。**ハロー(白/黒の縁)を出さない**。ライト・ダーク・壁紙風の3背景に重ねて確認する。
- **画像に文字・数字・ロゴを焼き込まない**(札・シール・ストリップは空白。文字はコードが重ねる)。
- 傾けない。**すべて正位置で作る**(コードが±1〜2°回転させる)。左右対称に見える部品も、光が左上なので**左右は別に描く**(反転で流用しない)。
- アプリのコード(`*.js` / `*.rs` / DOM の id)と、既存の `pack/*.png` `ui/shelf-board.png` `ui/pinboard.png` は**変更しない**。納品するのは `src/art/shop/` の新規ファイルだけ。
- 手書き風フォントは使わない前提。写実の手・机・工具は描かない。

## 1. 見て合わせる既存素材(これの隣に置いて浮かないこと)

| 見る | 何を合わせるか |
|---|---|
| `src/art/pack/pack-{holographic,kraft,matte}.png`(768×1024) | **袋が主役**。紙・箔の質感、描き込みの量(**これより描き込まない**)、縁のわずかなギザギザ |
| `src/art/ui/shelf-board.png`(1400×96) | 木のトーン(`#C9A878` 系のクラフト色)、前面の面の幅、角の丸み。**棚の天面・ブラケットはこの板の兄弟** |
| `src/art/ui/pinboard.png` `ui/paper-clip.png` `notes/note-memo-torn-cream.png` | Market の先頭のピックアップ(コルクに留めたメモ)。**金属のトーン(紙クリップの銀)をレールの金属に揃える** |
| `src/art/ui/binder-clip.png` | 黒に近いグラファイトの金属。レールの部品とは**別の素材として**区別する |
| `src/art/ui/price-tag-{paid,free}.png` `ui/ticket-stub.png` | 値札の紙の色・厚み・ギザギザ(値付けシールの色合いはこれと揃える) |
| `src/art/ui/shelf-contact-shadow.png` | 影の強さ・形の基準 |

## 2. 部品(P0 = レール一式。**まず P0 だけ作って止まる**)

表示サイズ(CSS px)と、納品サイズ(実ピクセル)の両方を書く。**納品は3倍(@3x)**: Market の「寄る」で最大2.2倍に拡大されるため。

### P0 — レール一式(Market 用)

| ファイル(`src/art/shop/`) | 表示 | 納品 | 内容 |
|---|---|---|---|
| `rail-bar.png` | 256×32 | **768×96** | **細い銀の丸棒**を正面から見たもの。**左右にシームレスにタイルできる**(左端と右端の模様が一致)。棒の太さは表示14px(納品42px)、縦の中心は表示16px(納品48px)。上辺に細い明るい線、下辺に少し暗い線。ごく薄い横方向のヘアライン。下に**短く薄い影**(右下2px、alpha 30以下)。**ネジ・留め具・端部を描かない**(それは別パーツ) |
| `rail-mount-left.png` / `rail-mount-right.png` | 36×44 | **108×132** 各1 | レールの端を壁に留める**角丸の小さな金属プレート**。上下に小さなネジ2本(十字の溝は細く、**黒く潰さない**)。左右で光が違う(左上から)。**レールの棒が刺さる穴は描かない**(棒の端はコードがプレートの手前に重ねる)。プレートの中心が、レールの縦の中心と一致する位置に来る向きで描く |
| `hook-back.png` / `hook-front.png` | 22×50 | **66×150** | **S字フック**。**同一キャンバス・同一座標**で2枚(奥と手前に分けて重ねる)。上の曲がりがレールの棒を**またぐ**、下の曲がりがヘッダーカードの穴を**くぐる**。針金の太さは表示2.5px(納品7〜8px)。奥(back)=レールの向こう側・カードの穴の向こう側を通る部分(控えめ、暗め)、手前(front)=手前を通る部分(明るい)。**back + front を重ねると完成形**。アンカー(必須): レールの中心が通る点 = 納品 (33, 24)、カードの穴の中心が通る点 = 納品 (33, 108) |
| `pack-header-card.png` | **袋と同一**(132×176) | **768×1024** | 袋の上部に**折って留めた厚紙のヘッダーカード**(ユーロ穴付き)。**`pack-*.png` と同一キャンバス・同一座標**で、カード以外は完全な透明。位置: x 140〜628、y 56〜196(納品px)。紙は `#F3EAD6` → `#E3D6B9` の淡いクラフト寄りのクリーム、縁はごく薄いギザギザ、ステープル(ホッチキス)2か所(y≈170、x≈190 と 578)、中央にユーロ穴(横長の角丸、**アルファ0で完全に透明**。穴の中心 = (384, 100)、大きさ 96×28)。穴の内側の縁に薄い影(紙の厚み)。文字・柄なし。**3種の袋(holographic / kraft / matte)のどれに重ねても、上辺がはみ出さず自然に見える**こと |
| `price-dot-paid.png` / `price-dot-free.png` / `price-dot-own.png` | 36×36 | **144×144** 各1 | **丸い値付けシール**(店で値段を貼る小さなシール)。文字なし。paid = クリーム `#F2EAC8`、free = ミント `#CFE9C8`、own = 白 `#ECE8DE`。縁にほんの少しの紙の縁取り、紙の繊維、右下に弱い影。**正円**(傾けない) |
| `anchors.json` | — | — | 上の**アンカー座標**(フックのレール点・穴点、ヘッダーカードの穴の中心と大きさ、レールの縦中心、各部品の納品サイズ)を機械可読で。コードはこの値で位置合わせする |

### P1 — 棚一式(Packs 用)

| ファイル | 表示 | 納品 | 内容 |
|---|---|---|---|
| `shelf-top.png` | 784×15 | **1400×48** | 棚板の**天面**(少し上から見た台形)。`shelf-board.png` の木目・色と**連続して見える**。上辺は少し狭く(左右に約1.6%ずつ内側)。袋が乗る面なので、**木目は穏やかで、袋の足元の影が読める明るさ** |
| `shelf-bracket-left.png` / `shelf-bracket-right.png` | 38×34 | **128×120** 各1 | 棚板の下で支える**L字の金属ブラケット**。ネジ2本。銀の箔のトーン(§0)。左右別に描く |
| `shelf-label-strip.png` | 148×24(横に伸縮) | **480×80**(9スライス) | 棚の前面に付ける**値札レール**(スーパーの棚札のホルダー)。白い紙の面+上辺の細い透明な縁。**左右の端 40px に装飾、中央は伸びる**。文字面は空白(コードが名前と価格を重ねる)。弱い影 |

### P2 — あれば(任意)

| ファイル | 内容 |
|---|---|
| `rail-sign.png`(360×200 納品) | レールの左端に下げる**小さな荷札風の看板**(穴と細い紐、文字面は空白)。「Pick up」などをコードが重ねる |

## 3. 組み立ての約束(コードが使う。**この通りに重ねると完成形になること**)

```
Market のレール(上から下へ)
  z1  hook-back        … 奥
  z2  rail-bar         … レール
  z2  pack-*.png + pack-header-card.png … 袋とヘッダーカード
  z3  hook-front       … 手前(カードの穴・レールをまたぐ針金)
  z4  price-dot-*      … 袋の右下に貼る

Packs の棚(奥から手前へ)
  z1  shelf-top
  z2  pack-*.png(残数で2〜3枚が重なる)
  z4  shelf-board.png(既存)
  z5  shelf-label-strip
  z3  shelf-bracket-left / right(板の下)
```

- 袋は表示 132×176。**ヘッダーカードの穴の中心** = 袋の (384, 100)(納品px)。フックの「穴の中心を通る点」= (33, 108)。**この2点を重ねる**と、フックが穴を通って見える。
- レールの縦中心とフックの「レールを通る点」(33, 24)を重ねる。
- 影はどの部品も**右下2px・薄く**。重ねたときに影が二重に濃くならないこと。

## 4. 作業手順

1. **まず P0 だけ**を作り、`src/art/preview.html` に「**組み立て済みの Market レール**(3種の袋を3本のフックで吊るしたもの)」を、旧版(CSS/SVGの仮)と**並べて**出して**止まる**。オーナーが「質感が合っている」と確認してから P1 に進む。
2. 生成は1部品につき**4候補**。「いちばんきれい」ではなく**既存素材の隣に置いて浮かない**ものを選ぶ。迷ったら描き込みの少ないほう。
3. 納品するたびに `src/art/manifest.json` に `{ id, file, width, height, alpha, priority, usedBy, prompt, status }` を追記。元の高解像度は `assets-src/art/shop/`(Git外)。
4. `scripts/art-check.py`(あれば)・`npm test`・`git diff --check` を通す。

## 5. 完了条件(自己点検)

- [ ] `rail-bar.png` を横にタイルして**継ぎ目が見えない**。
- [ ] `hook-back + hook-front` を重ねて、レールをまたぎ、ヘッダーカードの穴をくぐって見える。アンカー座標が `anchors.json` と一致する。
- [ ] `pack-header-card.png` を3種の袋に重ねて、上辺・ステープル・穴が自然。穴のアルファが0。
- [ ] 新部品を `pack-*.png` / `shelf-board.png` / `paper-clip.png` の隣に置いて、**線・彩度・影の強さが揃っている**。金属が写真っぽく浮かない。
- [ ] ライト・ダーク・壁紙風の背景でハロー・黒ずみ・市松が出ない。
- [ ] 画像に文字が焼き込まれていない。
- [ ] 1枚あたり 600KB 以下(`rail-bar` `shelf-top` は 300KB 以下)。
- [ ] JS・Rust・DOM の id・既存画像を変更していない。

## 6. プロンプト(英語。先頭に STYLE LOCK、末尾に NEGATIVE を付ける)

`{STYLE}` は `docs/archive/prompts/codex-art-prompt.md` §5.2、`{AVOID}` は §5.3。**各プロンプトの先頭に {STYLE}、末尾に {AVOID} を付ける。**

```
(rail-bar) A thin horizontal round rail bar seen straight on, brushed silver in the same restrained semi-flat foil treatment as the silver pouch (#D8DCE2 to #9AA1AB, two or three flat tones), one thin highlight line along the upper edge and a slightly darker line along the lower edge, faint horizontal hairline texture, a very soft low shadow to the lower right. Perfectly tileable left to right, no end caps, no screws. Transparent background. No chrome reflections, no environment mapping.
(rail-mount-left / right) A small rounded-rectangle metal wall plate seen straight on, silver foil tone, two tiny screws with fine slots, light from the upper left (draw the left and right plates separately), a hair of shadow to the lower right. No hole for the rail. Transparent background.
(hook-back / hook-front) A simple S-shaped wire hook seen straight on, thin silver wire, the upper bend wrapping over a horizontal rail and the lower bend passing through a small slot; draw it as two layers on the same canvas — the back layer (parts passing behind) slightly darker, the front layer (parts passing in front) lighter — so that stacking them gives the complete hook. Semi-flat, one thin highlight. Transparent background.
(pack-header-card) A folded cardboard header card clipped over the top of a small sealed pouch, pale cream paperboard (#F3EAD6 to #E3D6B9) with a deckled edge, two small staples, and a euro-slot hang hole in the middle (a horizontal rounded slot that is fully transparent, with a thin shadow along its inner edge). Everything else on the canvas is transparent so it can be stacked on the three existing pouch images. No text.
(price-dot) A small round price sticker, perfectly circular, slightly textured paper, a faint paper-edge outline and a hair of shadow to the lower right; three colours: cream (#F2EAC8), mint (#CFE9C8), white (#ECE8DE). Blank face. Transparent background.
(shelf-top) The top surface of a wooden shelf plank seen slightly from above, a shallow trapezoid, calm wood grain in the same kraft-wood tone as the existing plank front (#C9A878, shadow #B08A5B, highlight #DDBF94), light enough that a soft contact shadow reads on it. Transparent background.
(shelf-bracket) A small L-shaped metal shelf bracket seen straight on, silver foil tone, two tiny screws, light from the upper left, left and right versions drawn separately, a hair of shadow. Transparent background.
(label-strip) A shelf-edge price-label holder: a blank white paper strip with a thin clear lip along the top edge, a hair of shadow, both ends decorated (40 px) and the middle plain so it can stretch horizontally. No text.
(rail-sign) A small hang-tag sign on a thin string with a punched eyelet, cream or kraft paper, blank face. Transparent background.
```

## 7. 終わったら

`docs/shop-parts-report.md` に「作ったもの・旧版と並べた所見・直せなかった点」を書き、`art: shop parts — rail, hook, header card, price dots` で指定ブランチに push。
