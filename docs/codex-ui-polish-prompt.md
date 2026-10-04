# Codex に送るメッセージ(UI の仕上げ:「システムっぽい」残りの部品)

そのまま貼り付けて送る。`codex-ui-parts-prompt.md`(第1弾)、`codex-paper-realism-prompt.md`(第2弾)と同じ約束(STYLE LOCK + REALISM BOOST、影、ハロー、文字は焼き込まない、コードは触らない)。

---

第1弾・第2弾の素材を、触れるプロトタイプ(`docs/ui-proposals/peta-prototype.html`)に全部差し替えました。見違えました(付箋タブ・ラベルボタン・シール・トレイ・Pack 3種・紙と表紙)。
そのうえで、画面を一通り見て**まだ「システム(CSS)」が見える所**を拾いました。以下を同じ質感で作ってください。**既存の最良素材(ホログラムのカード、銀袋、封蝋、付箋タブ)の隣で浮かないこと**が合格ラインです。

オーナーが特に気にしている3か所(スクリーンショットで指摘あり)は **P0** です。

| 指摘 | 今の状態 |
|---|---|
| 月のタブ(Oct / Sep / Aug) | 付箋タブの絵を流用しているが、月のラベルに合った専用のものではない |
| Pack の棚の台 | 厚紙のテクスチャを敷いた CSS の帯。厚みも木口もない |
| 右上のしおり(閉じる) | CSS のグラデーションの赤い帯。布の織り・縫い目・折れがない |

## P0

### 1. しおりのリボン `ui/ribbon-bookmark.png`
- **96 × 320**・透過。縦長。上端はノートの上から出てくる所(ページに挟まれて**暗く、少し折れている**)、下端は**V字**。
- 布(サテン)のリボン。**織り目が見える**、左右の縁に**縫い目のような細い線**、光が当たる筋と影の筋、V字の切り口にほつれ。色は `#D8453A` を中心に少し暗く(アクセントの赤、ここだけ)。
- 使い方: ノートの右上から垂れ、**クリックで閉じる**。ホバーで少し揺れる(コードで回転)。

### 2. 棚の板 `ui/shelf-board.png`
- **1400 × 96**・透過・**横方向に伸ばせる(9スライス 左右 120px)**。
- **厚紙のチップボードか、軽い木の板**。上面(明るい、奥行きが少し見える)+ **前面の厚み(暗い)** + 左右の木口(積層した紙の断面でもよい)。**使い込まれたわずかな擦れ**。上に物を置くので、上面は静か。
- 別ファイル `ui/shelf-contact-shadow.png`(320 × 48、透過): 棚の上に置いた Pack の**接地影**(楕円、中央が濃い)。
- 使い方: Packs ページで Pack が乗る台。Pack の下の影は今 CSS(`.pack::after`)。

### 3. 月のタブ `tabs/month-flag-{cream,pink,sky,mint,lemon}.png`
- 各 **220 × 96**・透過。**ノートの上辺から立ち上がる紙の見出し**(今の右端タブを90°起こした向き)。下の端は**ページの中に差し込まれている**(影)、上の端は**角丸**。ラベル面は**空白**(月の名前はコード)。
- 選択中は**コードが引き上げる**ので1枚でよい。**厚紙・フィルム・マステ**のうち厚紙を第一候補(右端タブと揃える)。

### 4. 操作部品(Create の調整パネルなど)`ui/`
いまは白いカードとブラウザ標準のスライダー・スイッチです。

| ファイル | サイズ | 内容 |
|---|---|---|
| `panel-paper.png` | 900 × 500・透過・**9スライス(角 70px)** | **紙のカード**(右上に小さな穴)。縁の小口、わずかに浮いた影。Create の調整パネルが載る |
| `slider-track.png` | 600 × 40・透過・横に伸ばせる | **定規のような目盛りの溝**(細い溝+目盛り線、鉛筆でなぞったような濃淡) |
| `slider-knob.png` | 64 × 64・透過 | **つまみ**。真鍮の丸ピン、または紙のつまみ(どちらか。2案) |
| `switch-track-off.png` / `switch-track-on.png` | 各 120 × 64・透過 | **紙のスイッチの溝**(オン側は少しクラフト色) |
| `switch-knob.png` | 64 × 64・透過 | スイッチのつまみ(`slider-knob` と同じ素材感) |
| `seg-track.png` / `seg-chip.png` | 360 × 80 / 200 × 64・透過・9スライス | 2〜4択の切り替え(Erase / Restore など)。溝と、その上に乗る**紙のチップ** |

### 5. ステッカーの裏面の紙(素材別)`back/`
**素材ごとに、裏面の紙そのものを変えます**。いまは CSS のグラデーションと点で代用しています。

| ファイル | サイズ | 内容 |
|---|---|---|
| `back-matte.jpg` | 1024 × 1280(4:5) | クリーム色の上質紙。繊維、ごく薄い罫のない無地。(`book/page-paper.jpg` と同系で、少し暖かく) |
| `back-kraft.jpg` | 1024 × 1280 | クラフト紙(繊維と黒い粒)。(`back/paper-kraft.jpg` の延長) |
| `back-holographic.jpg` | 1024 × 1280 | **銀のホログラム台紙**。細かい銀のラメ、パステルの回折の筋(ピンク・ラベンダー・スカイ・ミント・レモン)。ネオンにしない。**反射の帯(シーン)をコードが重ねる**ので、画像は静止した状態 |
| `back-gold.jpg` | 1024 × 1280 | **金箔の台紙**。箔押しのような細かいムラ、暖かい金(`#D9B24F` 周辺)。ギラつかせない |
| `back-riso.jpg` | 1024 × 1280 | **リソ印刷の紙**。薄いピンクの色ベタ+ハーフトーン、わずかな**版ズレ**、紙の繊維 |
| `back-vintage.jpg` | 1024 × 1280 | **古い紙**。黄ばみ、foxing(茶色い小さな斑点)、四隅が少し濃い |

- すべて**文字面は静か**(上に ORIGINAL の印、Created by、日付、素材名、No. が載る。コントラスト低め)。
- 縁は**直線のまま**(角丸と影はコード)。

### 6. ウィンドウの「上の部分」と手作りの ✕ `ui/`
オーナーの方針が決まりました。**Mac 標準の赤・黄・緑の丸は使わない**(世界観が壊れるため)。代わりに次の2つを**物として**用意します。実装は素材が届いてからこちらでやります。

**(a) ウィンドウの上端 = 「ここを掴めば動く」と直感でわかる帯**
タイトルバー(文字や丸ボタンの帯)ではなく、ノート・マット・紙の**上端そのものが、掴める物に見える**ことが目的です。方向(A/B/C)ごとに1枚。横に伸ばせる9スライス(左右 120px)、**中央に小さな「握る目印」**(浅い溝・縫い目・テープの重なりなど。**文字なし**)。

| ファイル | サイズ | 内容 |
|---|---|---|
| `window-top-notebook.png` | 1400 × 72・透過 | **ノートの表紙の上端**。厚紙が少し盛り上がった帯、表紙の縫い目(ステッチ)、中央に浅い横溝。既存の `cover-board.jpg` と同じ厚紙 |
| `window-top-desk.png` | 1400 × 72・透過 | **カッティングマットの上端**に貼った**マスキングテープ**(半透明、両端がギザギザ、中央に指で押さえたような薄い皺) |
| `window-top-studio.png` | 1400 × 72・透過 | **紙のヘッダー帯**(厚い紙の切れ端が窓の上に貼られている、小口が見える、中央にミシン目のような小さな点線) |
| `window-top-*-hover.png` | 同上 | 掴めるときの状態(ほんの少し明るく、影が深い) |

**(b) 手作りの ✕(閉じるボタン)** 上の**角**に置きます(左上か右上かはこちらで決める。**どちらでも使える**ように、左右対称に作る)。
**4案**を作ってください(オーナーが選びます)。各案に **normal / hover / pressed の3状態**、**96 × 96**・透過。

| 案 | 内容 |
|---|---|
| `close-pencil-*.png` | **クラフトの小さな丸いシール**に、**鉛筆で手書きした ✕**(線に筆圧のむら、少しはみ出す) |
| `close-stitch-*.png` | **フェルトの丸いパッチ**に**赤い糸のクロスステッチ ✕**(糸のほつれが1か所) |
| `close-tape-*.png` | **マスキングテープを2本交差**させた ✕(半透明の重なり、端がギザギザ) |
| `close-wax-*.png` | **赤い封蝋**に**凹んだ ✕**(`gift/wax-seal.png` と兄弟。押した瞬間の凹み) |

- hover は「少し持ち上がる/色が明るくなる」、pressed は「沈む/影が浅くなる」。
- **✕ の印そのものを画像に描く**(文字ではなく図案なので OK)。それ以外の文字は入れない。
- 実寸の 24 px まで縮めても ✕ が読めること。

## P1

| ファイル | サイズ | 内容 |
|---|---|---|
| `ui/resize-corner.png` | 96 × 96・透過 | ウィンドウ右下の**折れた角(ドッグイヤー)**。ページを少し折った影つき。ドラッグでサイズ変更(いまは斜線の仮) |
| `ui/icon-market.png` / `ui/icon-settings.png` | 各 192 × 192・透過 | 見出しタブや Peta メニューのアイコン。**既存の `today/choice-*.png` と同じ筆致**で、Market は**クラフトの紙袋(小さな赤い値札)**、Settings は**真鍮の歯車(ペン立てに挿した工具のような)** |
| `today/material-card-gold.png` `-riso.png` `-vintage.png` | 各 560 × 380・透過 | **新しい素材のカード**(`material-card-holographic.png` と同じ寸法・同じ紙の厚み・同じ空白のラベル面)。gold=金箔、riso=2色刷りのピンクと青のずれ、vintage=古紙。いまは既存カードに色フィルタをかけた代用 |
| `ui/price-tag-free.png` `price-tag-paid.png` | 各 240 × 120・透過 | Market の**値札**(小さな荷札型か、丸いシール型)。文字はコード。free は緑がかった台紙、paid はクリーム |
| `ui/stamp-owned.png` | 300 × 120・透過 | 「持っている」を示す**ゴム印の枠**(青インク、かすれ、傾き)。文字はコード |
| `ui/ticket-stub.png` | 360 × 120・透過 | 「今日開けた Pack: 0 / 1」を載せる**ちぎれる半券**(ミシン目あり)。文字はコード |
| `ui/pinboard.png` | 1200 × 520・透過・9スライス | Market の特集の**コルク/厚紙の掲示板**(縁の木枠、画鋲の穴)。`ui/pin-red.png`(96 × 96・透過)の押しピン付き。いまは表紙の厚紙+クリップで代用 |

## P2

- `empty/stuck-empty.png`(640 × 240): 「今日はまだ何も貼っていない」。台紙の上に**点線のステッカーの輪郭**。
- `empty/inbox-empty.png`(640 × 240): ギフトがまだ届いていない。**空の封筒トレイ**。
- `ui/avatar-frame.png`(240 × 240): Market の作者のアバター用。**丸いダイカットの台紙**(中は空、ステッカーを載せる)。

## 英語プロンプト(先頭に STYLE LOCK + REALISM BOOST、末尾に NEGATIVE)

```
(ribbon) A satin bookmark ribbon hanging straight down, seen from the front: visible weave, a thin stitched line along each edge, a bright streak and a shadow streak running down the length, the top end folded and darkened where it comes out of a book, the bottom end cut in a V with a few loose threads. Deep red (#D8453A, slightly darker), no text.
(shelf) A shelf board seen from slightly above and in front, made of kraft chipboard: a lighter top face with a little depth, a darker front face showing the thickness, laminated paper layers visible at both ends, faint wear on the front edge. Empty, quiet top face.
(month flag) A small coloured paper index tab sticking UP from the top edge of a notebook page: the lower end tucks under the page with a soft shadow, the top end has rounded corners that are slightly uneven, a pale cut edge shows thickness, fine fibres. Blank face. Colour: <cream / pink / sky / mint / lemon>.
(panel) A card of heavy cream paper with a small punched hole in the upper right, visible stacked edge, soft contact shadow. Blank. Stretchable in the middle.
(slider) A ruler-like groove with fine tick marks and graphite shading, plus a round brass pin knob with a soft highlight (or a folded paper pull-tab).
(switch) A paper slide switch: a recessed groove (off: plain cream, on: kraft-tinted) and a round knob matching the slider knob.
(back-matte) Seamless cream paper, fine fibres, blank. (back-kraft) Seamless kraft paper with dark flecks. (back-holographic) A silver holographic foil backing sheet: fine silver glitter, faint pastel diffraction streaks (pink, lavender, sky, mint, lemon), still, low contrast. (back-gold) Warm gold foil with subtle foil-stamp mottling, not glaring. (back-riso) Pale pink risograph print on paper with halftone dots and a slight misregistration. (back-vintage) Aged yellowed paper with brown foxing spots and darker corners.
(window top) A thin horizontal band for the top edge of an app window that reads as "grab here" without any text: <a kraft notebook cover edge with stitching and a shallow grip groove / a strip of translucent washi tape with a small pressed crease in the middle / a thick paper header strip with a faint perforation line>. Stretchable left and right; all detail in the middle.
(close x) A hand-made close button, 96 px, symmetrical so it works in either top corner: <a small kraft round sticker with a pencil-drawn X, uneven pressure / a felt patch with a red cross-stitched X, one loose thread / two crossed strips of masking tape / a red wax seal with a pressed X>. Three states: normal, hover (slightly lifted, a bit brighter), pressed (sunk, shallower shadow). The X is a drawn mark, no letters.
(resize corner) A page corner folded over (a dog-ear), with a soft shadow, seen straight on.
(icons) Same brush and palette as the existing choice icons: a kraft paper shopping bag with a tiny red price tag; a small brass gear.
(price tag) A small hang tag or round price sticker, blank.
(stamp) A rubber-stamp rounded rectangle frame in blue ink, uneven, dry-ink speckle, tilted a few degrees, no text.
(ticket) A torn ticket stub with a perforated edge, blank.
(pinboard) A kraft cork board in a thin wooden frame with pin holes, stretchable in the middle; and a red push pin on its own.
```

## 作業手順と完了条件

1. **P0 の 1・2・3(しおり・棚・月のタブ)だけ先に作る**。`src/art/preview.html` に旧版と並べて出して**止まる**。オーナーが確認してから 4・5・6 に進む。
2. 生成は1つにつき4候補。**既存の最良素材の隣で浮かない**ものを選ぶ。
3. 納品ごとに `manifest.json` へ追記。原本は `assets-src/art/`(Git外)。
4. 自己点検:
   - [ ] 実寸(しおり幅 24px・月タブ高さ 38px・つまみ 20px)に縮めても、**厚み・影・素材**が読める。
   - [ ] ライト・ダーク・壁紙風の背景でハロー・黒ずみが出ない。
   - [ ] 継ぎ目なしの紙(`back-*.jpg`)を縦横にタイルして継ぎ目が出ない。
   - [ ] 9スライス素材は、横・縦に引き伸ばしても装飾が破綻しない。
   - [ ] 画像に文字が焼き込まれていない。
   - [ ] 1枚 600KB 以下(テクスチャは 500KB 以下)。
5. 完了したら `docs/ui-polish-report.md` に、作ったもの・旧版との比較・直せなかった点を書き、`art: ui polish — ribbon, shelf, month flags, controls, backs` で指定ブランチに push。

## 差し替え先(プロトタイプの CSS。実装はこちらでやる)

| 素材 | 場所 |
|---|---|
| ribbon | `docs/ui-proposals/app/css/polish.css` の `[data-shell="notebook"] .ribbon` |
| shelf | 同 `.ledge`、`.pack::after`(接地影) |
| month flag | 同 `.month` |
| panel / slider / switch / seg | `css/pages.css` の `.cr-controls` `input[type=range]` `.switch` `.seg`、`css/polish.css` の同名 |
| back-* | `css/polish.css` の `.back-card[data-mat=…]` `.backing[data-mat=…]` |
| window-top / close | `css/polish.css` の `.grabber` `.drag-strip`、`index.html` の `#g-close`(いまは仮の取っ手+✕) |
| icons | `js/state.js` の `A.shop` `A.gear`(インライン SVG の代用) |
| material cards | `css/base.css` の `.mcard[data-m="gold|riso|vintage"]`(色フィルタの代用) |
