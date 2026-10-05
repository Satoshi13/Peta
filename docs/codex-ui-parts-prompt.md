# Codex に送るメッセージ(UI パーツ追加:素材カード周り・ノート・文具小物)

そのまま貼り付けて送る。必要なら `docs/art-reference/` の4枚と、下の「見て合わせる既存素材」も一緒に渡す。

---

Today 画面の UI を「紙の机」の方向に作り替えました(素材カードのトレイ、スパイラルのノート型 Material Book、レアリティのシール、日付のゴム印)。今は**既存の素材を流用した仮の見た目**なので、同じ世界観で**専用のパーツ画像**を作って差し替えてください。

**いちばん大事なのは「今の雰囲気を壊さないこと」です。** 新しい絵を足すのではなく、すでにあるものの隣に置いて**違和感が出ない**ものだけを納品します。

## 0. 守ること

- 絵柄・パレット・光・影は `docs/codex-art-prompt.md` の **§5 STYLE LOCK / NEGATIVE / 描き方のルール**と、`src/art/manifest.json` の `shadowPolicy`(影は `#2B2B2B`・最大 alpha 30・6px 以内・右下 2px)に従う。
- 不透明な面は alpha 255、縁のアンチエイリアス以外に半透明は使わない(マステ・グラシン・影マスクは例外)。**ハロー(白/黒の縁)を出さない**。ライト/ダークの両方の背景に置いて確認する。
- 文字は**画像に焼き込まない**(ラベル面は空白。文字はコードが重ねる)。偽テキスト・ロゴ禁止。
- 実写のプリンター・手・机・はさみは描かない。**写真ではなくイラスト**(`docs/art-reference/mood-3-ui-mockups.jpg` の質感)。
- アプリのコード(`*.js` / `*.rs` / DOM の id)は触らない。差し替えるのは**画像ファイルと、下の「差し替え先」に書いた CSS の `url(...)` だけ**。
- 手書き風フォントは使わない前提(Klee / Noteworthy はコードが載せる)。

## 1. 見て合わせる既存素材(これの隣に置いて浮かないこと)

| 見る | 何を合わせるか |
|---|---|
| `src/art/today/material-card-{matte,kraft,holographic}.png` | 紙の厚み・角丸・ラベル面の白さ・影の弱さ。**素材カードが主役** |
| `src/art/pack/pack-pouch-closed.png` | ホログラム/銀箔の質感。Pack の描き込み量(オーナーのお気に入り。**これより描き込まない**) |
| `src/art/today/choice-*.png`, `today/envelope-*.png` | 線の細さ・彩度・傾き |
| `src/art/back/paper-cream.jpg` / `paper-kraft.jpg`, `creator/tape-1..4.png` | 紙の繊維・マステの半透明と縁のギザギザ |
| `src/art/book/*`, `today/choice-collection.png` | **ノート類(今回いちばん直したい)** |
| `docs/ui-proposals/index.html`(ブラウザで開く) | 完成イメージ。案A(Material Cards)と方向1(Paper Desk)が採用済み |

## 2. P0 — ノート類を作り直す(スプリングが雑なので)

### 今の問題
`book/spiral-rings.png`(96×1000)は、**平らな「C」の形を縦に並べただけ**です。ページに穴が無く、輪がページを貫通している感じ・金属の厚み・ページへの影がなく、`choice-collection.png` の小さなノートでも線が細くて雑に見えます。

### 作るもの(`src/art/book/`)
**3枚の周期と位相を必ず揃える**(輪の中心は y = 25 + 50·k px。1000px タイルに**ちょうど20個**、縦に**継ぎ目なし**)。

| ファイル | サイズ | 内容 |
|---|---|---|
| `spiral-binding.png` | 128 × 1000 | **完成形**。穴・輪・影が入った綴じ帯(下記の描き方)。通常はこれだけをタイルして使う |
| `spiral-coil.png` | 128 × 1000 | 輪だけのレイヤー(透過)。`spiral-binding` の輪と同一座標 |
| `spiral-holes.png` | 128 × 1000 | 紙の穴とその内側の影だけのレイヤー(透過)。同一座標 |
| `spiral-cap-top.png` / `spiral-cap-bottom.png` | 128 × 64 | 有限のノート(Material Book)の上端・下端。最初/最後の輪と紙の端がきれいに終わる。`spiral-binding` と継ぎ目なくつながる |
| `notebook-page.png` | 1200 × 900 | **9スライス用**のクリーム色のノートの1ページ。左に綴じ代(`spiral-binding` を重ねる幅 128px を空けておく)、右と下の縁に**重なった紙の小口**(薄い線が2〜3本)、ごく弱い外側の影。角 90px 以内に装飾を収め、中央は単色に近い紙(横縦に伸ばしても破綻しない) |
| `cover-kraft.png`(作り直し) | 1600 × 1100 | 今の構図のまま、**新しい綴じ(輪と穴)に差し替え**。小さな青い花のステッカー・クラフト表紙・エンボスの格子は維持 |
| `page-left.jpg` / `page-right.jpg`(作り直し) | 1400 × 1000 | 今の紙とドットグリッドのまま、**綴じ側の穴の位置を `spiral-holes` に合わせる**(穴の影を紙に描く) |
| `../today/choice-collection.png`(作り直し) | 384 × 384 | 今の構図(クラフト表紙のノート+青い花のステッカー、やや右下がり)のまま、**スプリングを太く・立体的に**。小さく表示(約112px)されても輪が1つずつ読めること |

### スプリングの描き方
- 小さく表示されても読める**ツイストループ(二重ワイヤー)**。ワイヤーは「紙の穴から手前に出て、紙の縁を越えて、次の穴へ入る」形で、**表(明るい)→穴の中(暗い)→裏(控えめ)**の3段階が見える。
- 金属は**銀(`#D8DCE2` → `#9AA1AB`)**。左上からの光で1か所だけハイライト。**ネオン・強い反射・ガラス/プラスチックのツヤは禁止**(NEGATIVE)。
- 輪が紙に落とす影は右に短く薄く(上の `shadowPolicy`)。穴は紙のクリーム色より少し暗い**内側の影**だけで、黒く塗りつぶさない。
- **別色の綴じ**も `spiral-binding-graphite.png`(黒に近いワイヤー、`#2B2A28` → `#55524D`)として1セット(`-coil` `-holes` は不要)。

### 差し替え先
- `src/today.css` の `.book::before { background: url("art/book/spiral-rings.png") … }` → `spiral-binding.png`(タイルの幅 `128px × 0.3125 = 40px` 前後で調整してよい)。
- `src/art/p1.css` の `.spiral`(Collection)も同じ。`src/art/preview.html` に、旧版と新版を**並べて**見られるカードを足す。
- `.book` の背景は今 `paper-cream.jpg` を CSS で敷いているので、`notebook-page.png` を `border-image` の 9スライスに使って置き換えてよい。

## 3. P0 — Today 画面の新しい部品

共通: すべて**文字面は空白**、右下に弱い接地影を素材に含める。ダークの背景でも浮かないこと。

| ファイル(`src/art/ui/`) | サイズ | 内容 | 差し替え先 |
|---|---|---|---|
| `seal-common.png` `seal-uncommon.png` `seal-rare.png` `seal-special.png` `seal-archive.png` | 各 320 × 112 | **レアリティのシール**(文字なし、ラベル面は空白)。common=無地の白い紙ラベル / uncommon=クラフトの紙ラベル / rare=**パステルのホログラム箔**(`holographic-sticker-sample.png` と同じ色)/ special=銀箔 / archive=古い紙+薄い消印の輪(文字なし)。角は少し丸く、わずかに左に傾く | `src/today.css` の `.seal[data-rarity]`(今は CSS の色)。画像にしたら `background: url(...) center / 100% 100%`、文字は `.seal` の `textContent` |
| `material-tray.png` | 1120 × 400 | 素材カードを並べる**浅いトレイ**(紙/厚紙、内側に影の凹み)。9スライス用に、角 80px 以内に装飾を収める | `.tray` |
| `card-locked.png` | 560 × 380 | **未獲得の素材カード**。`material-card-matte.png` と同じ形で、紙にエンボスだけ残ったような白い面+ラベル面は空白(「?」はコードで重ねる) | Collection の Materials タブの `.material[data-locked="true"]` |
| `button-label.png` / `button-label-pressed.png` | 各 720 × 200 | Open / Make this Peta 用の**ラベルシール風ボタン**の台(文字なし)。**左右 80px に装飾、中央は伸びる**(9スライス)。pressed は影が浅く1px 沈む | `button.primary`(今は黒いピル) |
| `date-stamp.png` | 480 × 160 | **ゴム印の枠**(文字なし)。インクは赤み(`#B8665B` 付近)、かすれ少し。`back/stamp-original-frame.png` の兄弟 | `#date` |
| `tape-5.png` … `tape-8.png` | 各 480 × 140 | マスキングテープ(`creator/tape-1..4.png` と同じ形式)。pink / mint / sky / kraft の4色、半透明、縁はギザギザ | 選択中カードの留めテープ(`.mcard[aria-checked="true"]::before`)をレアリティで色分けする用 |

## 4. P1 — Pack と文具小物

| ファイル | サイズ | 内容 |
|---|---|---|
| `pack/pack-kraft.png` `pack/pack-matte.png` `pack/pack-holographic.png` | 各 768 × 1024 | **素材別の Pack**。`pack-pouch-closed.png` と同じ形・同じ描き込み量・同じ影で、kraft=クラフト紙の小袋(折り返しの口)/ matte=クリーム色の紙の封筒/ holographic=今の銀+ホログラム。ラベル面は空白。**今の pouch(銀袋)の良さを損なわない** |
| `ui/tag.png` | 360 × 440 | **荷札**(穴と細い紐、上の角が斜め)。文字面は空白。クリーム/クラフトの2枚(`tag-cream.png` `tag-kraft.png`) |
| `ui/index-card-{blank,ruled,dot}.png` | 各 900 × 600 | **情報カード**。右上に小さな穴、ほんの少し角が丸い。ruled は薄い罫線、dot は薄いドット |
| `ui/memo-torn.png` | 640 × 400 | 破れ縁のメモ(今の `gift/note-blank.png` と兄弟)。上にマステの留め |
| `ui/paper-clip.png` `ui/binder-clip.png` | 各 256 × 256 | 紙クリップ(銀)/ バインダークリップ(黒に近いグラファイト)。小さく使う |
| `ui/pocket-front.png` `ui/pocket-back.png` | 各 1200 × 520 | **カードを差し込むクラフトのポケット**(前板と後板。重ねるとカードが挟まって見える。破線のステッチ入り)。Material Book の将来案用 |

## 5. 作業手順

1. **まず P0 のノート類だけ**を作り、`spiral-binding.png` を `preview.html` に旧版と並べて出して**止まる**。オーナーが「スプリングが直った」と確認してから残りに進む。
2. 生成は1つにつき**4候補**。「いちばんきれい」ではなく**既存素材の隣に置いて浮かない**ものを選ぶ。迷ったら描き込みの少ないほう。
3. 納品するたびに、`src/art/manifest.json` に `{ id, file, width, height, alpha, priority, usedBy, prompt, status }` を追記。元の高解像度は `assets-src/art/`(Git外)に保存。
4. `scripts/art-check.py`(あれば)・`npm test`・`git diff --check` を通す。

## 6. 完了条件(自己点検)

- [ ] `spiral-binding.png` を縦にタイルして**継ぎ目が見えない**。`spiral-coil` と `spiral-holes` を重ねた結果が `spiral-binding` と**一致**する。
- [ ] 20pt 前後に縮小しても輪が1つずつ読める(`choice-collection.png` を112pxで見て確認)。
- [ ] 新素材を既存の `material-card-*.png` / `pack-pouch-closed.png` の隣に置いて、**線・彩度・影の強さが揃っている**。
- [ ] ライト・ダーク・壁紙風の背景でハロー・黒ずみ・市松が出ない。
- [ ] 画像に文字が焼き込まれていない。
- [ ] `src/art/preview.html` で全部の新素材を確認できる。
- [ ] 1枚あたり 600KB 以下(テクスチャは 500KB 以下)。
- [ ] JS・Rust・DOM の id を変更していない。

## 7. プロンプト(英語。先頭に STYLE LOCK、末尾に NEGATIVE を付ける)

`{STYLE}` は `docs/codex-art-prompt.md` §5.2、`{AVOID}` は §5.3。

```
(spiral-binding) A vertical strip of notebook spiral binding seen straight on, tileable top to bottom with exactly 20 identical rings (ring centres every 50 px). Twin-loop silver wire (#D8DCE2 to #9AA1AB): each loop comes out of a punched hole in the cream paper at the right, arcs over the paper edge toward the viewer and re-enters the next hole, so the wire is bright on top, dark inside the hole and quiet behind. One small soft highlight per ring from the upper left, a very short soft shadow of each ring falling on the paper to the right. Punched holes are slightly darker than the paper with a soft inner shadow, never black. Metal like brushed aluminium, NOT chrome, NOT glass, NOT plastic. Flat-ish stationery illustration, no text.
(page, 9-slice) A single cream notebook page block seen straight on with a binding margin on the left, a few fine paper-edge lines along the right and bottom edges suggesting stacked pages, very soft outer shadow, an almost uniform paper centre that can stretch. No text.
(seal) A small rectangular sticker label with slightly rounded corners, tilted a few degrees, blank face: (common) plain white paper / (uncommon) kraft paper / (rare) pastel holographic foil in pink, lavender, sky, mint, lemon / (special) silver foil / (archive) aged paper with a faint round postmark ring, no letters. Soft low contact shadow.
(tray) A shallow card-stock tray seen from above and slightly in front, cream paper, soft inner shadow suggesting the recess, empty. No objects.
(button) A paper label-sticker used as a button base, rounded ends with a small deckled edge, blank face, a hair of shadow; second version pressed down 1 px with a shallower shadow.
(stamp) A rubber-stamp rectangular double-line frame in faded red-brown ink (#B8665B), slightly uneven, a little dry-ink speckle, small corner ticks, no text inside.
(tape) A strip of washi tape with deckled ends, semi-transparent, soft colour (pink / mint / sky / kraft), a faint paper texture, centred on transparent.
(pack) A flat sealed pack of the same shape and level of detail as the reference pouch: (kraft) a folded kraft-paper pouch, (matte) a cream paper envelope pack, (holographic) the existing silver pouch with holographic sheen; blank label area. No text.
(tag) A hang tag with a punched hole and a thin string loop, top corners cut diagonally, blank face, cream or kraft paper.
(index card) A blank index card with a small hole in the upper right and slightly rounded corners; (ruled) faint ruled lines; (dot) faint dot grid.
(clips) A small silver paper clip / a graphite binder clip, seen straight on, soft low shadow.
(pocket) A kraft-paper pocket for holding cards, front panel and back panel as separate layers, dashed stitching along the top edge, empty.
```

## 8. 終わったら

`docs/ui-parts-report.md` に「作ったもの・旧版と並べた所見・直せなかった点」を書き、`art: ui parts — notebook binding, seals, tray, labels` で指定ブランチに push。
