# Codex への依頼: デザイン品質の底上げ(文字・コントラスト・Today・Book・Create・サイドバー・Night Desk)

対象: ネイティブアプリ(`src/` と `src-tauri/`)。プロトタイプ(`docs/ui-proposals/app/`)は更新不要。

見た目の参考(**参考のみ。DOM はそのまま移植せず、値と構造の意図を取り入れる**):
[`docs/ui-proposals/design-quality-preview.src.html`](ui-proposals/design-quality-preview.src.html)
(読むのは **`.src.html`**。`design-quality-preview.html` は画像を base64 で埋め込んだ配布用なので読まない。ブラウザで見るなら後者)。
Before(実機スクリーンショット)は [`docs/ui-proposals/design-quality/`](ui-proposals/design-quality/)。

> **注意**: プレビューの Before 画像は、Book の List/Calendar 切り替え(月タブ廃止)と Today の「次の封筒」札が入る**前**に撮ったものです。プレビューと現行コードが食い違う箇所は**現行コードを正**とし、プレビューの意図に沿って現行に合わせてください(下の各項目に書いてあります)。

## 対象(プレビューのセクション見出しの番号)

| プレビュー | 本依頼の項目 | やる/やらない |
|---|---|---|
| 01 TYPE | **A** 文字の役割 | やる |
| 02 CONTRAST | **B** コントラスト | やる |
| 03 TODAY | **D** Today | やる |
| 04 BOOK | **E** Book | やる |
| 05 CREATE | **F** Create | やる |
| 08 SIDEBAR | **C** サイドバー | やる |
| 09 NIGHT DESK | **G** Night Desk | やる |
| 06 MARKET / 07 PACKS / 10 PARTS / 11 MOTION / 12 ORDER | — | **やらない**(今回は触らない。ただし A・B のトークン変更は全画面に効く) |

7つの変更を **A+B → C → D → E → F → G の順に、1つずつ別コミット**で入れてください(A と B は同じコミットでよい)。
G(Night Desk)は全画面に触るので最後。**A+B のコミットで、後続が使う色・文字のセマンティックトークンを先に用意**し(昼の値のみ)、C〜F の新しい CSS は最初からそのトークンで書くこと(G が「上書き」中心で済むように)。
各変更の終わりに、下の「共通ルール」の確認を済ませてから次へ進むこと。

---

## 共通ルール

- 作業前に `README.md`、`docs/decisions.md`、`docs/port-spec/README.md`、`docs/port-spec/tokens.md`、`docs/port-spec/open-questions.md`、`docs/port-spec/macos-checklist.md` を読む。**未決事項(O1〜O5)は実装しない**。決定済みのルールは変えない(Matte 無制限、Welcome 1日1回、Market / Gift は回数制限なし、DB v7)。
- **DB・スキーマ・Rust のコマンド契約は変えない**(必要になったら止めて報告)。**ゲームルール・挙動も変えない**(見た目・構造・文言・設定の追加のみ)。
- 画像素材(`src/art/`)は**追加・変更しない**。ただし既存で `assets.js` に未登録の素材(例: `creator/cutting-mat-dark.jpg`)を `P` に登録して使うのは可。アイコンが要るときは**インライン SVG**(新しい画像ファイルは作らない)。
- 文字列は既存の UI に合わせて英語。説明文書は日本語。
- 設定は既存の仕組みに乗る: `localStorage['peta.preferences']`、`Bridge.savePreferences()`、`preferences-changed` イベント、`src/layer-port.js`、`src/app/js/settings.js`。**「Reduce motion」が有効なときは、動きを伴う演出を止める**(新しい動きは必ず従う)。
- 仕様 §57「高負荷にしない」: 常時アニメーション・常時ポーリングを入れない。
- **壊してはいけないもの**(各項目の「保持」も参照): ページ遷移(`Shell.go` / `TRANS`)、Today の開封演出(`Pages.today.openEnvelope` が `.tm-card .mcard` と `.choice` を対象にアニメーションする)、次の封筒の札(`EnvelopeTicket` と `Pages.today.resume/suspend`)、`Scraps.finish()` が使う `#nav [data-page="…"]` でのフォーカス復帰、Create のブラシ・Undo/Redo・⌘Z・拡大パン、Book の遅延読み込み(`lazySticker` / IntersectionObserver)と詳細パネル、デスクトップ層・到着の封筒窓・メニューバーには**触れない**。
- **ウィンドウは Studio / Desk の2種類**ある(`body[data-shell]`)。各項目の指示にある場合を除き、**両方で崩れないこと**。最小サイズ 720×520 と、`@media (max-width: 880px)` の下部バー表示(`shells.css` 末尾)も維持する。
- コードは周囲のスタイル(コメント量、命名、関数の粒度)に合わせる。ファイルの新規作成は必要なときだけ(テスト・レポートを除く)。
- Linux など macOS 以外で実行できない確認は `npm run check:mac` で型・ビルドのみ確認し、**実機確認が必要な項目は `docs/port-spec/macos-checklist.md` に追記**する。`npm test` も通す。
- 変更したルール・挙動は `README.md` の該当節と `docs/decisions.md`(決定表に日付 **2026-10-05** で1行ずつ)に追記する。
- **見た目の証跡**: 各コミットの後、既存の撮影手順(`scripts/port-capture.py` など)で 1060×700 と 720×520、Studio と Desk(G は昼と夜)のスクリーンショットを `docs/port-spec/compare/review-14/` に保存し、最後に `docs/design-quality-report.md`(日本語。何を変えたか、トークンの対応表、プレビューと違えた点とその理由、未確認事項)をまとめる。
- プレビューの数値(px・色)は**正**だが、現行コードの制約と衝突したら制約を優先し、**違えた点を report に書く**。

---

## A. 文字の役割を整理する(プレビュー 01 TYPE)

### 方針
いまは「システム太字」「Special Elite(タイプライター)」「Klee One(手書き)」が、見出しにも補足にも混ざっている。**役割で分ける**:

| 役割 | 書体 | サイズ/行間 | 太さ・字間 | 色 |
|---|---|---|---|---|
| Display | システム | 40/44(Studio。Desk は既存どおり) | 700 · −0.03em | `--ink` |
| Title | システム | 22/26 | 700 · −0.02em | `--ink` |
| Headline | システム | 15/20 | 650 | `--ink` |
| Body | システム | 14/21 | 400 | `--ink2` |
| **Meta** | システム | 12/16 | 500 · `font-variant-numeric: tabular-nums` | `--muted`(B で新値) |
| **Overline** | システム | 11/14 | 600 · +0.09em · 大文字 | `--muted` |
| Stamp | **Special Elite** | **13px 以上** | +0.04〜0.06em | `--ink` / `--red` |
| Hand | Klee One | — | — | — |

### 実装
- **`polish.css` の `body[data-type="current"] …` の規則(`.eyebrow, .quota small, .rule-cap, .pack small, .mmeta small` に Special Elite を当てている行)を撤去/置換**し、上表の Overline / Meta に。`.eyebrow` → Overline、`.pack small` `.mmeta small` `.tm-text .stock` `.choice small` `.book-count` ほか補足的な `small` → Meta。
- **Special Elite を残すのは「物に印字された文字」だけ**: 日付スタンプ(`.datestamp`)、次の封筒の札の数字(`.envelope-clock`)、Scraps の数字(`.scraps-count b` `.scrap-summary b`)、Book タイルの日付チップ(E)。**どれも 13px 以上**。`native.css` の `.calendar-multiple`(11px / `--type`)は Meta(システム)へ。
- **Klee One(`.hand`)は「手書きされた物」だけ**: ステッカー裏(`.back-card`)、ギフトのメモ・付箋、パックの値札に手書きされた名前。**UI の説明文には使わない**: `p.hand.empty-note`、`p.lead.hand`、`.addnote.hand` などは Body / Meta(システム)へ。**迷ったら grep で `--type` と `.hand` の全使用箇所を洗い出し、1つずつ「物か説明か」を判定して report に表で残す**。
- **`--type` と `--hand` の定義・フォント読み込みは残す**(Settings の書体切替ではなく、物の文字に使うため)。`data-type` のプリセット機構(プロトタイプ用の Mix/Hand/Type/Pen)がネイティブに残っていれば触らない。
- 数字が並ぶ箇所(在庫、Scraps、カウントダウン以外の残数、日付)は `tabular-nums`。

### 受け入れ条件
- 画面上の **12px 未満の本文・補足が残っていない**(装飾の数字バッジなど例外は report に列挙)。素材カードの焼き込みラベル(art)は対象外だが、**コードで重ねる文字**は 11px 以上。
- タイプライター体の文字は、すべて「物の上」にあり 13px 以上。
- 日本語を含む文字列(名前入力など)で折り返し・行間が崩れない。

---

## B. 補助テキストのコントラスト(プレビュー 02 CONTRAST)

### 変更
- `base.css` `:root` の **`--muted: #7a7468` を `#655e51` に**。`pages.css` `native.css` `base.css` に**直書きされた `#7a7468`** も同じトークンへ(`grep -rn "7a7468" src`)。値の目安(WCAG 2.x、実測): `#655e51` は紙 `#faf6ec` 5.94 / サイドバー `#f3efe6` 5.59 / 濃い紙 `#efe8d8` 5.26(旧 `#7a7468` は 4.30 / 4.04 / 3.80 で AA 未達)。
- 赤スタンプ `#b94a3e`(4.73:1)は合格なので変更しない。フォーカスリングは現行のまま(G/将来の「部品の状態表」で二重リング化するが今回の対象外)。
- **セマンティックトークンを導入**(昼の値で。G が夜の値を足す。既存の名前は残し、新規はエイリアスでよい):
  `--w-win`(窓の面)、`--w-side`(サイドバー)、`--w-surface`(カード面 `#fffdf8`)、`--w-surface2`(`#f8f3e7`)、`--w-sunken`(凹み `#efe8d7`)、`--w-line`(`#e3dac7`)、`--w-line2`(`#ece5d4`)、`--w-btn` / `--w-btnfg`(主ボタンの面と文字)、`--w-ok`(`#4f7a4a`。**AA を満たさなければ濃くする**)。`--ink --ink2 --muted` は既存を使用。
- **テスト**: `tests/contrast.test.mjs` を追加。WCAG の相対輝度から比を計算する純関数を書き、`base.css` の `:root` から `--muted --ink --ink2 --w-*` を正規表現で読み、**本文・補足の組み合わせがすべて ≥ 4.5**(ink / ink2 / muted を surface・surface2・win・side・sunken の上)であることを検証する。G で夜の値も同じテストに足す。

### 受け入れ条件
- テストが通る。目視で、Today / Book / Materials / Settings の補助文字が紙の質感を保ったまま読める(色味が冷たくならない)。

---

## C. サイドバー(プレビュー 08 SIDEBAR)

> **ユーザー指定(必ず守る)**: **Today の上の Peta ロゴはそのまま残す**(Studio の `.nav::before`、`top:16px; left:22px`。窓操作ピル `.wctl` との位置関係も変えない)。**Settings とアカウントは下側に貼り付ける**(スクロール・項目数に関係なく下端に固定)。

### Studio(フル仕様)
`src/app/js/catalog.js` の `NAV` と `shell.js` の `renderNav` / `markNav`、`shells.css` の Studio ブロック。
- **グルーピング**(ラベルは Overline: 10.5px・大文字・+0.09em・`--muted`、項目間に余白):
  先頭 `Today`(ラベルなし)/ **Make**: Create / **Collect**: Book, Packs, Gifts, Materials / **Discover**: Market。
  `NAV` に `group` を足し、**配列の順を表示順に合わせる**(`today, create, book, packs, gifts, materials, market, settings`)。ページ送りの向きは `NAV` の添字で決まる(`shell.js` の `oldIdx/newIdx`)ので、表示順と一致させる。
- **下端固定**: `Settings` の項目と**アカウントの札**を、サイドバー下端に `margin-top: auto` で置く(上に 1px の区切り線 `--w-line`)。ロゴとグループは上から。窓が低くてもロゴ・上の項目は押し出されず、全体がはみ出す場合のみサイドバー内スクロール(スクロールバーは出さない)。
- **アカウントの札**(30px の丸アイコン + 名前 + 補足): アイコンは既存の `CreatorIcon.image()`、名前は `S.name`(未設定なら "You")、補足は `${S.lib.length} sticker(s)`(Meta)。**ボタンとして Settings ページへ移動**(`go("settings")`)。`aria-label="Account: {name}. Open Settings"`。アカウント・認証の新機能ではない(**ローカルのプロフィール表示のみ**。`profile_*` コマンドは変えない)。
- **アイコンを同じ大きさのタイルに**: 30px の淡い台座(`rgba(255,255,255,.62)`、角丸 9px、内側 1px の縁)に 22px のアートを置く。アートは触らない。
- **現在地**は今の白い紙片(`--w-surface` + 影)を維持。
- **バッジの文法を分ける**(Studio・Desk 共通。`.ni-badge`):
  - **数字**(Gifts = 未開封の数): インク地(`--w-btn`)に白文字のピル、最小幅 19px、`tabular-nums`。
  - **点**(Today = `S.dayState==='arrived'` の新しい封筒): クラフト色(`#c9a878`)の点 + 薄いリング。`aria-label="New envelope"`。
  - **赤(`--red`)はエラー・要対応専用**に取っておく(サイドバーでは使わない)。
  - 各項目の `aria-label` にバッジの意味を含める(例: "Gifts, 2 unopened")。
- **ショートカット**: `⌘1`〜`⌘7` = Today, Create, Book, Packs, Gifts, Materials, Market、`⌘,` = Settings。項目の右端に hover で表示(現在地の行は薄く常時)。実装は app ウィンドウの `keydown`(ウィンドウにフォーカスがあるとき)。**入力欄・`dialog` 表示中(`Bridge.dialogOpen`)・演出中(`Bridge.busy` / `.cer`)は無効**、Create の ⌘Z/⇧⌘Z と衝突させない。**ネイティブメニューの既存アクセラレータ(`src-tauri/src/tray.rs` ほか)と重複しないか確認**し、重複があれば JS 側を外すか Rust のメニューに合わせる。キー→ページの対応は**純関数**(例: `PetaMath.navShortcut(event)`)にして `tests/nav-shortcuts.test.mjs` を追加。
- **サイドバー幅**: プレビューは 216px(現行 204px)。本文が窮屈にならなければ 216、720×520 や `tests/material-layout.test.mjs` に影響が出る場合は 204 のままにして report に書く。
- フォーカス: 全項目に `:focus-visible` のリング(現行の `#5b7be8` 系でよい)。キーボードで巡回できる。

### Desk
アイコン+手書きラベルの縦並び(92px 幅)は**そのまま**。変えるのは次の3点だけ: ①バッジの文法(上記)②**Settings を列の下端に固定**(アカウントの札・グループラベル・タイルは出さない)③`NAV` 順の更新。

### 狭い画面(≤ 880px の下部バー)
グループラベル・アカウントの札・ショートカット表示は**出さない**。Settings は他の項目と同じ列に並ぶ(下部バーの末尾)。既存の見た目を維持。

### 保持
- `.nav-item[data-page]` の `<button>`、`aria-current="page"`、`Scraps.finish()` の `#nav [data-page]` フォーカス復帰。`Shell.renderNav()` が走るたびにバッジが更新される(`Bridge.changed()`)こと。
- 画面遷移の向き(添字順)、ホバーのアイコン傾き。

### 受け入れ条件
- ロゴが現行と同じ位置・同じサイズで Today の上にある(スクリーンショットで確認)。
- Settings とアカウントの札が、窓の高さを 520 にしても下端に貼り付いている(Studio)。Desk は Settings が下端。
- Gifts に未開封があると数字のピル、Today に未開封の封筒があると点。赤丸は出ない。
- `⌘1〜⌘7`・`⌘,` で移動でき、入力欄・ダイアログ中は動かない。

---

## D. Today(プレビュー 03 TODAY)

対象: `shared.js`(`Choices` / `CHOICES` / `StuckStrip` / `PageHead`)、`today.js`(`openedBlock`)、`pages.css`。**開封前(`arrived`)の画面は、トークン以外は変えない**(プレビューが扱っていない)。以下は**開封後(`opened`)**。

- **見出し周り**: 右上は今の「次の封筒」札(`EnvelopeTicket`)のまま。eyebrow の日付も現行どおり。プレビューの「日付の重複解消」は現行で解消済みなので何もしない。見出しの下は **1行のリード**に: 「A new material arrives every day. Matte never runs out.」(14/21、`--ink2`、最大 46ch。いまの2文の説明は短縮)。その下にセクション名(Overline)「Make a Peta」。`h2`「What will you stick today?」は廃止。
- **選択肢(`Choices`、開封後のみ)**:
  - **Create をヒーロー**に: 他の幅の約 1.6 倍(`grid-template-columns: 1.62fr 1fr 1fr 1fr`)、`--w-ink` の 1.5px 枠 + `--w-surface` → `--w-surface2` の薄いグラデ。左に文字(Headline 20/24 700「Create」、Meta「Turn any image into a sticker, cut out on the mat.」、**主ボタン「Choose image」**(`Shell.go("create")`、カード全体のクリックも同じ))、右に既存アート `chCreate`(約 104px、5° 傾け)。
  - **他の3つ**(Collection / Gift / Pack)は**カード**(`--w-surface`、1px `--w-line`、角丸 18px、影 1)。アート上、見出し(15/20 650)、補足(**12/16・1行・折り返さない・省略記号**)。文言: Collection「Stick one you own」、Gift「N waiting」/ 0 件は既存文言、Pack は既存の `sub()` の結果をそのまま。Gift に未開封があれば右上にインク地の数字ピル。
  - 高さは 178px 程度で**4枚とも同じ**。hover の浮き・傾き(`.choice-obj`)は現行を踏襲。`Choices({compact:true})`(他画面で使用)は**変えない**。
  - **保持**: `<button.choice data-id>`、`disabled`(Pack が開けないとき)、`Shell.go(..., {origin, via:"object"})`、`S.pickMode`、開封演出が `$$(".choice")` に当てるアニメーション。
- **下段(`.t-bottom`)を同じ高さの2枚のカードに**(`grid-template-columns: 1.25fr 1fr`、`align-items: stretch`、高さは内容に応じて 196px 目安):
  - **左: 今日の素材カード**: 左に**トレイ**(`--w-sunken` の凹み面、角丸 12px、内側影。`MatCard` は既存の `.tm-card` のまま中に置く)、右に: Overline「Today's material」+ 素材名(Title 22/26)+ `.seal`(rarity)、**特徴のチップ**(`m.recipe` を ` · ` で分割し、先頭を大文字にした `.chip.fill`。例 "Foil" "Rainbow reflection" "Glitter edge")、最下段に**在庫のピル**(`usableMats()` の各素材を「スウォッチ 22px + 名前 + `∞` または `×N`」。スウォッチは `A.swMatte / swKraft / swHolo` があれば使い、無い素材(gold/riso/vintage)は素材カード art の一部を 22px に切り出す。**新しい画像は作らない**)。上に細い区切り線。「Added to your Material Book」は Meta として eyebrow の右に小さく(手書き体にしない)。
  - **右: Stuck today**: ヘッダ(「Stuck today」Headline 14 650 + 右に Meta「N on your desktop」)。中身は既存の `StuckStrip()`(サムネは今のサイズ)。**空のとき**は破線(1.5px、`#cfc4ac`)の囲みに、既存の `A.emptyStuck` アート(約 92px)、「Nothing stuck yet」(13/600)、Meta「Your desktop is waiting.」、**副ボタン「Make a Peta」**(`Shell.go("create")`)。
  - ≤ 1000px では既存どおり1列に積む。**保持**: 開封演出の着地先 `.tm-card .mcard`(カードがトレイに収まる)。`README` の「素材カードの最終位置・縮尺はステージ内のヒントと情報欄の実寸から計算」と `tests/material-layout.test.mjs` が通ること(トレイの寸法が計算に影響する場合は計算側を合わせる)。
- 「Redeem Code…」リンクはそのまま末尾。

### 受け入れ条件
- 1060×700 で、下段2枚の上端と高さが揃い、素材の説明が3つのチップになり、折り返しで高さがばらつかない。720×520 でも重ならない。
- 開封演出(封筒→箔→カード→トレイに着地)が従来どおり動き、Reduce motion で省略される。
- 次の封筒の札、Redeem Code、各選択肢の遷移が従来どおり。

---

## E. Book(プレビュー 04 BOOK)

対象: `book.js` の `Pages.book.tile` / `build`、`pages.css` の Book 節。**List 表示のみ**変える。**Calendar は構造そのまま**(トークンの反映のみ)。

> プレビューの「月タブ → 月の送り」「日別ストリップ」は、**現行の Book にはすでに月タブが無く(List は全期間)、Calendar が月送りと日別を持つ**ため**実装しない**。意図(「毎日ひとつ」が見える)は Calendar が担っている。

- **タイルを台紙に載せたカード**に(`.tile`): `--w-surface`・1px `--w-line`・角丸 18px・影 1、高さ 242px 目安。上は**ドット罫の台紙**(`A.pageDots` を 256px で `--w-surface2` の上に敷く。夜は無地)で、ステッカー(既存の `lazySticker`、128px)を中央に。下はフッタ(`--w-line2` の区切り)。
- **日付チップ**(左上): `fmtDate(e.date, short)` を Special Elite 13px、`rgba(255,255,255,.7)` の小さなチップ(角丸 6px、内側 1px の縁)。
- **キャプション**: 1行目 = `titleOf(e)`(13.5/650、省略記号)、2行目 = Meta「`{素材名} · No. {pad4(e.no)}`」(Original)/「`{素材名} · Received`」(`e.kind==='received'`)。現在の「`fmtDate · titleOf`」(日付を含む1行)は廃止。
- **状態**(`i.on-desk`): 黒いピルをやめ、**右上に緑の点 + 「On desktop」(11/600、`--w-ok`)**。`i.recv`(gift)も同じ控えめなチップに。
- **今日のスロット**: List の**先頭**に、`S.stuckToday.length===0` かつ `!S.pickMode` かつ Book が空でないとき、**破線の空きタイル**(中央に丸い「+」、「Today's slot」(13.5/650)、Meta「still open」)。クリックで Today へ(`Shell.go("today")`)。
- **選択中**(`aria-pressed="true"`): 内側 2px のインクのリング(色だけに頼らない)。
- 空の Book の文言(`p.hand.empty-note`)は A に従い手書き体をやめる。
- **保持**: `data-sticker`、`aria-pressed`、`--i` の入場アニメ、IntersectionObserver の遅延読み込み、詳細パネル(Flip / Peel / Gift / Stick / 削除)、`S.pickMode` のバナー、`Make a Pack…`。**hover のクイックアクション(Flip / Peel / Gift)はプレビューにあるが今回は入れない**(詳細パネルと重複するため)。

### 受け入れ条件
- List のタイルが同じ高さ・同じ構造で並び、キャプションに名前・素材・番号が出る。黒い「on desktop」ピルが無い。
- 先頭の空きスロットが、今日まだ貼っていない日だけ出る。
- 大量の Original があってもスクロールが重くならない(遅延読み込みが従来どおり)。

---

## F. Create の操作盤(プレビュー 05 CREATE)

対象: `create.js`(`build` の `panes` / `cr-controls`、`MaterialTray`(`shared.js`)、`slider()`)、`pages.css` / `polish.css` の Create 節。**ブラシ・Undo/Redo・キー操作・拡大パン・編集モード(`CR.editing`)の挙動は変えない**。

- **段階を ①②③ にして上へ**: 各 `figure.pane` の `figcaption`(「Original」「Cutout — paint to fix」「Sticker」)を**ペインの上**に移し(`figure` 内で `order` を使ってよい)、左に 20px の丸いバッジ(1/2/3、紙色の地)+ ラベル(12/600、`#f4f0e4`、影)。下の薄い灰色のキャプションは廃止(コントラスト不足)。矢印(→)はペインの高さの中央に揃える。
- **3枚を同じ見え方に**: Original の**上下の白い余白**をなくす。画像は**切り取らず**(実画像のアスペクトは保つ)、余白部分を同じ画像の暗めのぼかし(cover)で埋める。**Original の再描画はブラシ操作のたびには行わない**(読み込み時と変更時のみ。パフォーマンスを落とさない)。
- **操作盤を共通の格子に**(Studio は `--w-surface` の面、Desk は既存の `panel-paper` の紙を維持しつつ**同じ格子・同じ行高**):
  - 3カラム(Material / Look / Brush)。見出し(`.lbl`)は**同じスタイル**(Overline)。
  - スライダーの行は **「ラベル 62px | つまみ・トラック(1fr)| 値 34px」、行の高さ 34px**。`slider()` が作る `output` を**必ず見える位置に**(いまは Outline / Smooth の値が見えていない)。値の範囲・単位は変えない(Outline 4–64、Smooth 0–12、Size 1–60)。
  - つまみの真鍮の見た目は維持(`sliderKnob` art)。
  - **スクリーンショット(`docs/port-spec/compare/slice-04-studio-07-create-cutting-mat-actual.png`)で Erase の下に出ている迷子の「4」**: 何が描画しているか調べて直し、**値は必ず自分のスライダー行の中**に収める。
  - **Undo / Redo はアイコンボタン**(34×30、インライン SVG の ↶ ↷、`aria-label` と既存の `title`「Undo (⌘Z)」「Redo (⇧⌘Z)」を維持)。`undoBtn` / `redoBtn` の変数名・`syncUndo()` のロジックは保つ。無効時は不透明度 .55。
- **素材トレイ**(`MaterialTray`。シグネチャ `({w,onPick,interactive,selected})`、`role="radiogroup"`/`radio`、キーボード操作、`S.chosen`、`onPick` は**保持**):
  - 3〜6枚が**同じ大きさ**で並ぶ平らな「皿」(`--w-sunken`、角丸 12px、内側 1px)。皿に素材のスウォッチ(D と同じ規則。`A.swMatte/swKraft/swHolo`、無ければカード art の切り出し)、**名前(12/600)と残数(Meta「∞」「N left」)はコードで皿の下に**重ねる(いまの 8.5px / 6.5px の焼き込み文字は使わない)。
  - **選択中 = 2px のインクのリング + 右上の ✓ バッジ**(色だけに頼らない)。
  - 編集モードの `.edit-material` も同じ見た目の皿 1 枚に。
  - 他画面で `MaterialTray` を使っていれば挙動が変わらないこと(使用箇所を grep で確認)。
- **コストの文言**(`usesText()` の結果、`.uses` 要素): 画面上部から**決定ボタンの左**へ移し、Meta で「Uses **1 Holographic** · 1 left」(強調は素材名だけ)。`$(".uses")` を更新する既存コード(`MaterialTray` の `onPick` 内)を壊さない(クラス名 `.uses` を維持)。Matte など無制限のときの文言も既存の `usesText()` に従う。
- 「Cancel」は Quiet(面なし)、「Make this Peta」(編集中は「Save changes」)は主ボタンのまま。⌘↵ のショートカットは**今回は追加しない**。

### 受け入れ条件
- 1060×700 と 720×520 で、スライダーの値が3本とも見え、重なり・欠けがない。素材名・残数が 11px 以上で読める。迷子の数字が無い。
- 編集モード(Book から開く)でも崩れない。ブラシ・Undo/Redo・⌘Z・拡大パンが従来どおり。

---

## G. Night Desk(プレビュー 09 NIGHT DESK)

**コンセプト: 物は紙のまま、部屋だけ夜にする。** アートは暗くせず、**窓・サイドバー・文字・平らな面だけ**を暗い部屋にする。

### 設定
- **Settings に「Appearance」(Day / Night / Auto)**を追加(`settings.js` の `segRow`、Window style の下)。説明: 「Auto follows macOS」。**既定は Day**(既存ユーザーの見た目を変えない)。保存は `peta.preferences.appearance`(`"day" | "night" | "auto"`)、`Bridge.savePreferences()` と `preferences-changed` に乗る。**既定値の最終判断はオーナーに残す**(report に「Auto を既定にする案」として書く)。
- 解決ロジックは**純関数**(例: `PetaMath.resolveTheme(pref, systemDark)`)にして `tests/theme.test.mjs` を追加。`auto` のときだけ `matchMedia('(prefers-color-scheme: dark)')` の `change` を購読し、`day`/`night` のときは購読しない(常時ポーリングなし)。結果は `<html data-theme="day|night">` に反映。**切り替えは即時**(アニメーションなし)。

### トークン(`base.css`)
`[data-theme="night"]` で上書き(`B` のセマンティックトークンの夜の値):

| トークン | Day | Night |
|---|---|---|
| `--w-win` | `#f6f1e6` | `#1d1a16` |
| `--w-side` | `#efe9dc` | `#171410` |
| `--w-surface` | `#fffdf8` | `#2d2923` |
| `--w-surface2` | `#f8f3e7` | `#262219` |
| `--w-sunken` | `#efe8d7` | `#1a1713` |
| `--ink` | `#2b2a28` | `#f1ead9` |
| `--ink2` | `#4a463f` | `#d9cfba` |
| `--muted` | `#655e51` | `#b8ad97` |
| `--w-line` / `--w-line2` | `#e3dac7` / `#ece5d4` | `#3d372e` / `#332e26` |
| `--w-btn` / `--w-btnfg` | `#2b2a28` / `#fff` | `#f1ead9` / `#1d1a16` |
| `--w-ok` | (B で決めた値) | `#8fc088` |
| `--red` | `#d8453a` | `#ef8274` |

純黒を使わない(茶味のある暗色)。**`tests/contrast.test.mjs` に夜の組み合わせを追加**(`--ink/--ink2/--muted` を夜の各面の上で ≥ 4.5、主ボタンの文字 ≥ 4.5)。

### 適用範囲(「物は紙のまま」)
- **夜にする**: 窓の面(`.win-frame` の面)、サイドバー(ロゴは白版 `logoWhite`)、Studio のページ面(`--studio-paper` を暗い面 + ごく弱い放射グラデに)、**art を使わない平らな面**(Settings の入力・スイッチ周り以外の `.setcard` の面、`dialog`(`Distribution.dialogStyle` ほか)、`.seg`、`.chip`、入力欄、`.scraps-count`、Material Book/Market の平らなカード、Create の操作盤(Studio)など)、区切り線、文字色、主ボタン(反転)。影は強め(`rgba(0,0,0,.5)` 系)。
- **夜にしない(紙のまま)**: ステッカー、封筒・パック・素材カード・ギフトなどの**アート**、紙ラベルのボタン(`.btn.paper` の art)、付箋・メモ・日付スタンプ、ステッカー裏のカード、`panel-paper` / `button-label` などの art 面。**art の上に載る文字は、art が明るいので夜でも暗い文字のまま**にする(art 面ごとに `--ink` をその面のスコープで昼の値に戻す。例: `.btn.paper`、`.cr-controls`(Desk の紙)、`.mcard .lab`)。
- 開封演出などの `.cer`(元から暗い背景)は**現行のまま**。トークンの上書きで読めなくならないことだけ確認する。
- **Desk(ウィンドウ)**: 窓の**マットだけ**を `creator/cutting-mat-dark.jpg`(`assets.js` の `P` に `matDark` として登録)に差し替える。**ページは紙のまま**(Desk のページは「机の上の紙」なので、`[data-shell="desk"] .page` と中身は昼のトークンに戻す)。Desk の窓の外周の影・丸い外周クリップ(README「ネイティブUIの設定」)を壊さない。
- **対象外**: デスクトップ層(貼ったステッカー)、到着の封筒窓、メニューバー、ネイティブウィンドウの装飾。

### 受け入れ条件
- Settings の Appearance で Day / Night / Auto を切り替えられ、再起動後も保持される。Auto は macOS の外観変更に追従する(Day/Night のときは追従しない)。
- Night で Today / Book / Create / Packs / Market / Materials / Settings / ギフトの `dialog` を巡回し、**読めない文字・白く浮く面・暗い文字が暗い面に載る箇所が無い**(スクリーンショットを `review-14/` に Studio と Desk で保存)。
- ステッカー・封筒・パックなどの物は昼と同じ色で、暗い机の上に載って見える。
- 窓の丸い外周とネイティブの影が夜でも尖らない。Reduce motion・触覚・音の設定に影響しない。

### macos-checklist に追記する項目
- システムの外観(ライト/ダーク)を切り替えると、Appearance = Auto のとき窓が追従し、Day/Night のときは動かない。
- Night で窓の四隅・影が尖らない(実機)。
- `⌘1〜⌘7` / `⌘,` が macOS の既存ショートカット・メニューのアクセラレータと衝突しない。
- ホロの反射(カーソル追従)が夜でも見える(コントラストが落ちない)。

---

## 最後に

- `docs/design-quality-report.md` に、変更の要約、トークン対応表(旧→新)、A の判定表(`--type` / `.hand` の全使用箇所と判定)、プレビューと違えた点、`macos-checklist` に足した項目、**オーナー判断が要る点**(Appearance の既定、サイドバー幅 204/216、ショートカットの採否、hover クイックアクションを見送ったこと)をまとめる。
- `npm test` と `npm run check:mac` を通す。
