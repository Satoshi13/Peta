# Codex への依頼: UI の不具合・改善 6 件(カードのホバー、パックのズーム、Featured、Redeem Code、Collection のヘッダー)

対象: ネイティブアプリ(`src/` のみ。Rust は原則触らない)。プロトタイプ(`docs/ui-proposals/app/`)は更新不要。
オーナーのスクリーンショットは [`docs/ui-proposals/feedback-2026-10-07/`](ui-proposals/feedback-2026-10-07/)(1 素材カード、2 パックのズーム、3 Featured バナー、4 Collection のヘッダー)。

6 件を **A → F の順に、1つずつ別コミット**で入れてください。各項目の終わりに `npm test` を通し、見た目の変更は Studio / Desk、1060×700 / 720×520 で確認する。

---

## 共通ルール

- **作業前に `git status` で、他のセッションの未コミットの変更(`book.js` `today.js` `shared.js` `market.js` `create.js` `shell.js` `native.css` など)があるか確認**する。**他の変更を巻き込んでコミットしない・消さない**(自分が触るファイルの該当箇所だけを差分に含める。衝突したら止めて報告)。
- 作業前に `README.md`、`docs/decisions.md`、`docs/port-spec/tokens.md`、`docs/port-spec/macos-checklist.md` を読む。**ルール・DB・Rust のコマンド契約は変えない**(見た目・操作・配置のみ)。
- 画像素材(`src/art/`)は追加・変更しない。文字列は英語、説明文書は日本語。
- **「Reduce motion」では動きを止める**(新しい遷移・演出は `html[data-motion="reduce"]` で省略)。常時アニメーション・常時ポーリングは入れない。
- コードは周囲のスタイルに合わせる。変更したルール・挙動は `README.md` と `docs/decisions.md`(決定表、日付 **2026-10-07**、1件1行)に追記する。実機でしか確認できない項目は `docs/port-spec/macos-checklist.md` に追記する。
- 最後に `docs/ui-fixes-oct07-report.md`(日本語)に、原因、直し方、確認結果(スクリーンショットの保存先 `docs/port-spec/compare/review-15/`)、確認できなかったことをまとめる。

---

## A. 素材カード: ホバーで水平になる挙動をやめる / ホバーの変化をなめらかに

**症状**(画像 1): Materials(と Market → Materials)の素材カード(`.mbook`、中のカード `.mcard`)は、通常は少し傾いている(`rotate(-2deg)`)のに、**マウスを乗せた間だけ水平になる**。また、カード全体のホバー(背景・影・持ち上がり)が**一瞬で切り替わり**、なめらかでない。

**原因の手がかり(未確定。再現して特定すること)**:
- `src/app/css/pages.css:203` `.mbook .mcard { transform: rotate(-2deg); will-change: transform; transition: transform .15s ease-out; }`
- `src/app/css/native.css:51` `.mbook:not(:disabled):hover { transform:none; }`(`pages.css:202` の持ち上がり `translateY(-3px)` を打ち消している)
- `src/app/css/native.css:484` **`[data-follow="true"] { transition:none!important; will-change:auto; }`**。`Stk.tilt()`(`src/app/js/sticker.js:92`)が対象に `data-follow="true"` を付けるため、`MatCard`(`shared.js`)の `.mcard` は**全ての transition が無効**になる。`reset()` が `target.style.transform = baseTransform`(`MatCard` は空文字)に戻す点も要確認。
- 傾き(`rotate(-2deg)`)を CSS で持ち、ホバーの追従を JS のインライン `transform` で上書きしている構造が、水平化の原因の可能性が高い。

**直し方(原則)**:
1. **静止時の傾き(-2deg)はホバー中も保つ**。ホバーで水平にしない(傾きを `baseTransform` として `Stk.tilt` に渡す、または CSS 変数 `--r` に寄せて追従の変換と合成する。どちらでも「ホバーの前後で回転角が変わらない」こと)。
2. **ホバーの状態変化はすべて transition でなめらかに**(入る/出るの両方向): 背景色・影・持ち上がり・傾きの追従の開始/終了。目安は **180〜260ms、`cubic-bezier(.2,.7,.3,1)`**(既存の `native.css:492` の値に合わせる)。`[data-follow]` の一括 `transition:none!important` は、**ポインタ追従で動かすプロパティ(`transform`)だけ**に限定し、背景・影・`filter` の transition は残す。追従の始まり/終わりは `onPointerFollow`(`core.js:87`)の `amount` が既に補間しているので、**CSS の transition と二重に補間してラグを作らない**。
3. **他のカード/タイルも同じ症状がないか監査する**(`.mbook` `.mk-mat` `.mk-tile` `.choice` `.tile`(Collection)`.sample` `.pack` `.cr-card` `.stuck-t`)。**一瞬で切り替わるホバー**があれば同じ基準で直す(新しい共通のイージング用 CSS 変数を `base.css` に1つ作って使ってよい)。動きの種類は変えず(浮く・傾く)、**変化の仕方をなめらかにするだけ**。
4. `html[data-motion="reduce"]` では、ホバーの移動・傾きを出さない(色・影の変化は残してよい)。既存の `native.css:55` `:51` の reduce 用の指定と整合させる。

**受け入れ条件**: カードにカーソルを入れる/出すとき、**回転角が変化しない**。背景・影・持ち上がりが**なめらかに**入り、なめらかに戻る。ホロ(`holographic`)カードの反射の追従は従来どおり。ホバーで当たり判定(クリックできる範囲)が動かない(既存の「Keep hit areas still」の方針を維持)。

---

## B. パックのズーム: 拡大すると袋と文字が荒れる

**症状**(画像 2): Packs / Market でパックの袋を押して拡大(`PackZoom`、`src/app/js/packs.js`)すると、**拡大した袋の絵・文字(「Pixel Dream」「BY RYO」)がぼやけて/ギザギザ**に見える。

**原因(確認済みの構造)**: `PackZoom.open` は、棚の袋(約168px)を複製(`clone`)し、**`transform: scale(k)` で拡大**する(`packs.js` の `move()` が `translate(...) scale(k)` をアニメーションし、`animCommit` で最終状態を残す)。WebKit は**小さいサイズでラスタライズした層を引き伸ばす**ため、拡大後の袋と、`.pk-label`(`native.css:687-693`、`cqw` 単位の文字)が**元の解像度のまま拡大されて荒れる**。

**直し方**:
1. **袋の複製(`clone`)は、最終サイズで レイアウトして描画**する(`left/top/width/height` を最終の位置・大きさにし、**アニメーションは `scale(1/k) → none` へ縮小から等倍へ戻す**形にする)。これで静止状態は**等倍の変換なし**で、画像・ラベル文字(`cqw`)・ホロの反射マスクが**最終サイズで再ラスタライズ**される。アニメーション中の見た目(棚の袋が手前に寄ってくる動き)と所要時間(約680ms)、イージングは変えない。閉じるときも逆方向で、`dispose()` までの整合を保つ。
2. 背景の「世界」(`world`、棚やページ)は、スクリムで隠れるので**今の `scale` のまま**でよい。ただし、最終状態でぼやけた世界が**ズーム中に見えて気になる**場合は、既存のぼかし(`filter`/scrim)の調整で足りるか確認する。
3. `.pk-img` の背景画像は `center / 100% 100%`(`pages.css:182`)。袋のアート(`pack-holographic.png` ほか、768×1024)を表示するサイズが **デバイスピクセル等倍を大きく超えていないか**確認し、超える場合は**無理に拡大せず**、拡大の上限(`target()` の `height` の上限)を調整するか、報告に「アートの解像度が不足」と書く(**新しい画像は作らない**)。
4. ホロの `.sheen`(`mix-blend-mode`・`mask`)がズーム後も袋の形にぴったり合っていること。

**受け入れ条件**: ズームした袋の輪郭(ギザギザの封の縁)とラベル文字が**くっきり**している(DPR 2 のスクリーンショットで確認)。ズームの動き・長さが従来と同じ。Reduce motion でも最終状態が同じ。

---

## C. パックのズーム: 拡大中に矢印キーなどで動かせてしまう

**症状**: ズームした状態で、矢印キーなどで**後ろのページ(棚)が動いて見える/操作できてしまう**。

**原因の手がかり**: `PackZoom` の `root` は `role="dialog" aria-modal="true"` の**普通の `div`**(`packs.js`)で、フォーカスを閉じ込めていない。`cur.onKey`(capture)は **Escape しか扱わない**。ページの `overflowY` は `hidden` にしているが、**後ろの要素(`world`)にフォーカスが移ると、フォーカスによるスクロール・矢印キー(ラジオ群・ボタン)・Tab が効く**。

**直し方**:
1. ズーム中は後ろ(`world` の各要素、サイドバー `#nav`、窓の操作は除く)を **`inert`** にする(`open` で付け、`dispose` で必ず外す。例外経路でも外れること)。これでキー・フォーカス・クリックが後ろに届かない。
2. **フォーカスをカード内に閉じ込める**: Tab / Shift+Tab は `.mkz-act`・`.mkz-back`・`.mkz-x` の間で循環。
3. ズーム中の `keydown`(capture)で、**入力欄・フォーム部品が必要としない矢印キー / PageUp / PageDown / Home / End / Space を `preventDefault`**(ページや後ろのリストが動かないように)。**Escape で閉じる、Enter / Space でボタンを押す、は従来どおり**(ボタンにフォーカスがあるときの Space / Enter は通す)。
4. `page.scrollTop` が変わらないことを保証する(`scroll` イベントで元の位置に戻す保険は不要なら入れない)。
5. **`⌘1〜⌘7` などのサイドバーのショートカット(別依頼で入る)や、他のグローバルなキー操作が、ズーム中に効かない**ことを確認する(`PackZoom.active` を判定に使う)。

**受け入れ条件**: ズーム中、矢印キー・Tab・PageUp/Down で後ろが動かない。Esc で閉じ、閉じたあとは**元のパックにフォーカスが戻る**(従来どおり)。スクリーンリーダー向けに `aria-modal` と矛盾しない。

---

## D. Featured のバナー: 画像を引き伸ばしていて乱れる

**症状**(画像 3): Market の Packs の **Featured バナー**で、右の説明カード(索引カードの紙の絵)の**縁や角が引き伸ばされて乱れて見える**。

**原因(確認済み)**:
- `src/app/css/polish.css:81` `.mk-hero-text { background: var(--a-indexCard) center / 100% 100% no-repeat; … }` — 索引カードの絵(`src/art/notes/note-index-card-blank.png` 系)を、カードの**縦横比を無視して `100% 100%` に引き伸ばしている**。
- さらに `src/app/css/native.css:89` `.mk-hero-text { background-size: 120% 140%; … }` が**さらに拡大**している(窓の幅でカードの縦横比が大きく変わるため、横長に伸びる)。

**直し方**:
1. **縦横比を変えない描画**にする。既存の紙パネルと同じ **9-slice(`border-image`)**: `.cr-controls { border-image: var(--a-panelPaper) 70 fill / 24px 26px / 0 stretch; … }`(`polish.css:185`)の方式を参考に、索引カードの絵を**角・縁は固定、中央だけ伸ばす**形にする。スライスの幅は絵の端(破れ・影)を壊さない値を画像で確認して決める。**どんな窓幅(720〜1400px)でも縁の歪みがない**こと。
2. `native.css:89` の `background-size: 120% 140%` を撤去。紙クリップ(`::before`)・回転(`rotate(.6deg)`)・影(`drop-shadow`)の見た目は維持。
3. 左の袋とステッカーの扇(`.mk-hero-art`)の配置は変えない。ただし、**画像を拡大して表示している箇所が他にないか**確認する(扇のステッカーは `Stk.make(max:300)` で作った実寸、袋は `--pk` の背景画像。**`transform: scale` で拡大していれば、実寸のレイアウトに置き換える**)。幅が広い窓で左が空きすぎる場合は、**実際の大きさ(width/height)を窓幅に応じて変える**(拡大の `scale` は使わない)。
4. 同じ索引カードの絵を `100% 100%` で伸ばしている他の箇所があれば列挙し、**同様に直すか、直さない理由を報告**に書く。

**受け入れ条件**: Featured の説明カードの縁・角が、窓の幅を変えても**歪まない**。ほかの Market の表示は変わらない。

---

## E. Redeem Code を、目立ちすぎない1か所にまとめる

**現状**: `Redeem Code…` が複数の場所にある。
- Today(`src/app/js/today.js:34`): 末尾のリンク。
- Gifts(`src/app/js/library-pages.js:12`): 「Open Peta file…」の隣のリンク。
- メニューバー(`src-tauri/src/tray.rs:25` の項目 `redeem` → `src/app/js/boot.js:8, 22` で Today を開いてダイアログ)。
- ダイアログ本体は `Distribution.redeem()`(`library-pages.js`)。

**決めたこと**:
1. **Settings に1つだけ**置く: `.setcard` の**最後の行**に、「**Redeem a code**」(説明: 「Enter a code from Peta or a friend.」)と、**控えめな副ボタン**「Redeem…」(`.btn.paper.small` 相当。主ボタンにしない)。
2. **Today と Gifts のリンクは削除**する。Gifts の「Open Peta file…」(ファイル)は残す。
3. **メニューバーの `Redeem Code…` は残す**(場所を問わず呼べる入口。変更しない)。メニューから呼ばれたときは、**今開いているページのまま**(窓が閉じていれば直前のページ、無ければ Today)でダイアログを出し、`Shell.go` で別ページへ移動させない(`boot.js` の `app-page` ハンドラの `redeem` 分岐を整理)。
4. ダイアログの文言・動作・結果表示(`redeem_code` コマンド、トースト)は**変えない**。成功後は `Bridge.reload()` と `Shell.refresh()`(従来どおり。追加の封筒が届けば Today に反映される)。
5. Redeem の入口が Today から消えるため、Today の**末尾の余白・レイアウト**が崩れないこと(開封前 / 開封後の両方)。

**受け入れ条件**: アプリ内の入口は **Settings の1か所**と、**メニューバー**だけ。Today・Gifts のどこにも `Redeem` の文字がない。キーボードで Settings のボタンに到達でき、ダイアログが従来どおり動く。

---

## F. Collection のヘッダー: List / Calendar の切り替えで選択ボタンの位置が動く

**症状**(画像 4): ヘッダー右の **List / Calendar** の切り替えが、**Calendar のときだけ出る「Save poster…」**と **「Make a Pack…」** の有無・順序のせいで、切り替えるたびに**位置が左右に動く**。

**原因**: `src/app/js/book.js` の `PageHead("Collection", …, view, …buttons)`(`build()` 内の `root.replaceChildren(PageHead(...))`)が、`view`(List/Calendar)を先頭に置き、その右に可変個のボタンを並べている。右寄せの flex なので、**ボタンが増減すると `view` の位置がずれる**。

**直し方**:
1. **`view`(List / Calendar)を `.ph-extra` の右端に固定**する(`order` か、DOM の順序を変える)。**List ⇄ Calendar を切り替えても、`view` の位置・幅が1ピクセルも変わらない**こと。
2. ボタンは `view` の**左側**に並べる: 左から「Save poster…」(Calendar のときだけ)、「Make a Pack…」。**「Make a Pack…」の位置も両ビューで同じ**にする(「Save poster…」はさらに左に出入りする)。
3. 窓幅が狭いとき(720px、下部バー表示 ≤ 880px)は、ボタンが折り返しても `view` が動かない(折り返す場合は、ボタン群が1行下にまとまり、`view` は固定のまま)。
4. 他の動作(ボタンの有効/無効、`PackMaker.open`、ポスターの保存、`S.bookView` の保存)は**変えない**。

**受け入れ条件**: List と Calendar を交互に切り替えたとき、`view` と「Make a Pack…」の**画面上の座標が同じ**(スクリーンショットの重ね合わせか、`getBoundingClientRect` の値を report に書く)。1060×700 と 720×520、Studio と Desk で確認する。

---

## 最後に

- `npm test` を通し、`docs/ui-fixes-oct07-report.md` をまとめる。
- 実機(macOS)でしか確認できないこと(トラックパッドのホバーのなめらかさ、DPR 2 でのパックの文字のくっきりさ、ズーム中のキー操作)を `docs/port-spec/macos-checklist.md` に追記する。
