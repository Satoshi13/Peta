# Port spec — プロトタイプ(1ウィンドウ版)を本物の Tauri アプリへ

この文書は **Codex(実装担当)に渡す作業指示書**。目的は「プロトタイプの見た目と動きを、本物のアプリで**そのまま**再現する」こと。
想像で補わない。迷ったら下の「正解の優先順位」に従い、それでも決まらなければ止めてオーナーに聞く。

## 0. 決まっていること

- **1ウィンドウ**。今の Today / Cutting Mat / Sticker Book / Arrival の4ウィンドウを、メニューバーから出入りする1つのウィンドウに統合する(デスクトップに貼るステッカーのレイヤー `layers.rs` は今のまま別物)。
- ウィンドウスタイルは **Desk と Studio の2つ**。**Settings の「Window style」で切り替える**(既定は Studio)。Notebook は廃止(Book ページの手帳素材だけ Desk で使う)。
  - **Studio**: 左サイドバー + 紙の質感の実物パーツ。上端に帯などは置かない。
  - **Desk**: 緑のカッティングマットが窓そのもの。左に素材アイコンのナビ、上端に帯などは置かない。**Create はマットの上に紙を敷かず、マットをそのまま使う**。**Book は手帳(表紙の厚紙・スパイラル・ドット罫のページ)をマットの上に置いた見た目**。他のページはマットの上に紙のページ。
- 閉じるボタンは手作りの ✕(Pencil / Stitch / Tape / Wax の4種)。**Settings の「Close button」で選べる**(既定 Stitch)。**上端の帯(テープ/紙)は廃止**。窓の右上の角に ✕ だけ(窓の角に半分はみ出して貼る)。窓の上端の細い領域(高さ約28px、不可視)をつかんで動かす。hover は拡大+少し傾くだけ(画像の差し替えはしない)。
- 書体は **Aa Std**(システムのサンセリフが土台 + タイプライター/手書きのアクセントを少し)。Mix / Hand / Type / Pen は比較用で、移植しない。
- ルール(下表)も確定。プロトタイプの挙動がそのまま仕様。

| 何 | ルール |
|---|---|
| 新しい素材 | 1日1個(Today の封筒)。Today に素材ピッカーは**ない**(素材を選ぶのは Create の中だけ) |
| ステッカーを作る/貼る | 何枚でも。Create は素材を1つ消費(Matte は無限) |
| Welcome Pack | 1日1回(0時にリセット)。素材は使わない |
| Market で入手した Pack | いつでも何度でも(中身がなくなるまで)。素材は使わない |
| Gift | 制限なし。素材は使わない |
| アウトライン | 太さ 4–64 のスライダー(既定 20) |
| Undo / Redo | 両方。⌘Z / ⇧⌘Z |
| 貼った瞬間の文字 | 英語の "Peta!" 系(複数バリエーション。`js/desktop.js` の `TAGS`) |
| ステッカーの裏紙 | 素材に追従(`.back-card[data-mat]`) |
| ウィンドウ | タイトルバーなし。上端の取っ手で移動、✕ / Esc / デスクトップクリックで閉じる(Settings でオフ可)、右下の角でリサイズ |

## 1. 正解の優先順位

1. **`docs/port-spec/golden/*.jpg`**(1440×900、Studio、Aa Std)— 見た目の正解。
2. **プロトタイプのコード** `docs/ui-proposals/app/`(CSS・JS)— 数値(余白・色・時間・イージング)の正解。写し取る。
3. この文書。
4. `docs/ui-proposals/README.md`(経緯とルールの説明)。

見た目の値は**プロトタイプの CSS をそのままコピー**してよい。再解釈しない。

## 2. プロトタイプの見方・動かし方

```sh
python3 -m http.server 8766 --directory <repo root> &
open http://localhost:8766/docs/ui-proposals/app/index.html         # ソース版(素材は src/art/ をそのまま参照)
open docs/ui-proposals/peta-prototype.html                          # 1ファイル版(file:// でOK)
node docs/ui-proposals/app/tools/shoot.mjs docs/port-spec/golden studio   # ゴールデン画像を撮り直す
node docs/ui-proposals/app/tools/audit.mjs /tmp/audit 1440 900 studio current   # 文字のはみ出し検査(0 が正解)
```

ツールバー(A/B/C、Mix/Aa Std…、Next day、Reset、Sound、Guide、Motion)・擬似メニューバー・壁紙・デスクトップの `#stage` は**プロトタイプ専用**。移植しない。
`?shell=studio&type=current` が既定。

## 3. 構成の対応表(プロトタイプ → 本物)

| プロトタイプ | 役割 | 本物で |
|---|---|---|
| `index.html` の `#win`(`.win-frame` > `.nav` + `.book > .viewport`) | 1ウィンドウの骨格 | 新規 `src/index.html` 系とは別の、**メインウィンドウ用ページ**(例: `src/app.html`)。`tauri.conf.json` は windows が空(全部コードで生成)なので、`WebviewWindowBuilder` で1枚作る(透過・枠なし・影はCSS) |
| `css/base.css` `shells.css`(studio ブロック)`pages.css` `pack.css` `polish.css` | スタイル | そのまま `src/` へ。**`[data-shell="notebook"]` `[data-shell="desk"]` と `body[data-type=…]`(current 以外)は捨てる**。`body` に `data-shell="studio" data-type="current"` を固定 |
| `js/state.js` | 画面用の状態・ルール | **捨てる**。実データは Rust(`store.rs` `daily.rs` `packs.rs` …)。`MAT` `NAV` `PACK_KINDS` などの表だけ参照 |
| `js/shell.js` | ページルータ、開閉、移動・リサイズ、トレイ | ページ遷移(`go()`)と TRANS(studio は slide)を移植。移動/リサイズ/閉じるは Tauri のウィンドウ API(`startDragging` / 自前リサイズ)へ。トレイは既存 `tray.rs` を「メインウィンドウを開く/閉じる」に変更 |
| `js/pages-today.js` `pack.js` | Today(封筒→素材カード)、Pack 開封、Gift 開封 | 既存 `today.js` `arrival.js` を置換。演出(`Cer`)はコードを移植 |
| `js/pages-create.js` `sticker.js` | Cutting Mat | 既存 `creator.js` + Rust の `creator_*` コマンドをそのまま呼ぶ。プロトタイプの `sticker.js`(canvas)は**見た目の参考**。本物の切り抜きは Rust 側 |
| `js/pages-book.js` `pages-misc.js` | Book / Materials / Gifts / Settings | 既存 `collection.js` を置換。`book_page` `material_book` `sticker_back` `peel_sticker` `gift_send` `profile_*` を呼ぶ |
| `js/pages-packs.js` `pages-market.js` | Packs 棚 / Market | Packs は既存 Rust(`packs.rs`)。**Market は本物のバックエンドがまだない**ので、まずプロトタイプと同じ静的データ(`MARKET_PACKS`)で UI だけ |
| `js/desktop.js` | デスクトップ上の封筒・印刷→掴む→貼る | 既存 `print.js` `placement.js` `main.js`(レイヤー側)が担当。見た目と順序をプロトタイプに合わせる |
| `js/assets.js` | 素材パスの表(`--a-<key>` に注入) | `src/art/` の同じファイルを使う。パスは `src/art/**`(プロトタイプは `../../../src/art/` を指す) |
| `js/audio.js` | 合成サウンド | そのまま移植可(WebAudio、ファイル不要) |

## 4. Rust 側で変えるもの(UI と同時に)

- `daily.rs` のルールを上の表に合わせる(現状「1日1枚」)。Welcome Pack の日次回数、Market Pack の無制限、Gift の無制限、Create の素材消費(Matte 無限)。
- ウィンドウ:`today.rs` `collection.rs` `creator.rs` `arrival.rs` の別ウィンドウ生成を、メイン1枚+ページ切替に。コマンド名は極力維持(UI だけ差し替える)。
- トレイ(`tray.rs`)のメニュー項目 → 開くページを指定してメインウィンドウを出す(`Shell.open(page)` 相当)。

ルール変更は**別コミット**にして、UI の移植と混ぜない。

## 5. 素材(`src/art/`)

- 使うものは `docs/ui-proposals/app/js/assets.js` の `P` に全部ある。そこに無いパスは使わない。
- Codex 納品済みで**プロトタイプに適用済み**(`css/polish.css` 末尾の「Pass 3」): 手作り ✕(右上の角、hover は拡大+傾き)(4種×通常/hover/pressed)、リサイズの角、スライダー・スイッチ・セグメント・紙パネル、素材別の裏紙6種、素材カード gold/riso/vintage、値札・所有スタンプ、アイコン market/settings。
- 納品済みだが**採用しなかった**: 窓上端の帯 `window-top-*`、掲示板 `pinboard` と `pin-red`(オーナー判断で不採用。Market の目玉は従来の厚紙ボード+インデックスカード+クリップ)。
- 納品済みだが未使用: 空状態(`empty/*`)、半券、アバター台紙。
- まだ仮(CSS 製)のもの: 付箋、ノートの端/とじ目/角の一部、Peta! タグの追加バリエーション。**届いたら差し替え**。それまでは今の CSS をそのまま移植し、`data-art` フックを残す。
- **画像は加工しない**(拡大縮小は CSS のみ)。必要な新素材は作らず、`docs/codex-ui-polish-prompt.md` の該当節を見て依頼を出す。

## 6. 書体

- Aa Std = システムのサンセリフが土台(`--sys`)。アクセントだけ Special Elite(eyebrow・クォータ・パック情報)と Klee One / 手書き体(ステッカー裏・封筒のコピー)。
- プロトタイプは Google Fonts を読み込んでいる。**本物は同梱する**(オフラインで動くこと)。Special Elite / Klee One など SIL OFL のものだけ使い、ライセンス文を同梱。フォールバック列(`--type` `--hand` の font stack)はプロトタイプのままにする。

## 7. 受け入れ条件

各スライスで、次を満たしたら完了。

1. **画面**: `docs/port-spec/golden/` の該当画像と**並べて**目視で一致(余白・文字サイズ・紙パーツの位置・影)。差異は PR に画像で貼る。
2. **はみ出し**: `tools/audit.mjs` を本物の画面に流用して 0(または既知の false positive のみ)。最小ウィンドウ(720×520)でも。
3. **動き**: 次の流れが全部通る。
   - Today: 封筒 `Open` → 素材のパウチ → 引き裂く(横ドラッグ)→ カードを引き抜く → `Keep it` → Today のトレイに収まる
   - Create: 画像ドロップ/サンプル → 切り抜き(Erase/Restore ブラシ、Undo/Redo、アウトライン)→ `Make this Peta` → 印刷口から出る → ドラッグ → 貼る(Peta! の文字)
   - Packs: Welcome は1日1回で `Open one` が無効化 / Market 入手分は何度でも / 引き裂く → スリーブを引く → ステッカー → `Stick it` / `Later`(ウィンドウが閉じ、印刷口で待つ)
   - Book: 月タブ、詳細(裏返し、素材別の裏紙)、Peel、Gift…
   - Gifts: 封蝋を割る。回数制限なし
   - ウィンドウ: 取っ手で移動、右下でリサイズ(最小 720×520)、✕ / Esc / 外クリックで閉じる、メニューバーのトレイで戻る
4. **既存機能を壊さない**: デスクトップへの貼り付け・ドラッグ・Peel・Gift ファイルの読み書き・`cargo test`。
5. **Reduce motion** と **Sound オフ**が効く。

## 8. 進め方

小さなスライスで、1スライス = 1コミット(+ ゴールデンとの比較画像)。

1. メインウィンドウの骨格 + ナビ + Settings(いちばん単純)
2. Today(封筒 → 素材 → トレイ)
3. Book / Materials / Gifts
4. Create
5. Packs + 開封演出
6. Market(静的データ)
7. 印刷→貼る の見た目合わせ
8. ルール変更(Rust)

各スライスの最後に `shoot.mjs` と同じ手順で本物の画面を撮り、ゴールデンと並べる。

## 8.5 すでに直したレイアウト上の落とし穴(本物でも踏む)

- `position: sticky` の詳細カードが行より高いと、下端までスクロールできない → 行に `min-height` を与える(`.bk, .mk { min-height: 620px }`)。
- グリッドの `1fr` は中身の min-content で押し広げられる → `minmax(0, 1fr)` を使う(`.cr-controls`)。
- Desk の Create/Book の見た目は `.page[data-page=…]` に付ける(`body[data-page]` ではない)。手帳(表紙・スパイラル・ドット罫)は**ページ自身の一部**にして、フェードで丸ごと出入りさせる(窓側に置くと「手帳が固定でページだけ入ってくる」ように見える)。
- 擬似要素 `z-index:-1` は、同じ要素の `background` より**上**に描かれる(`isolation` した要素の中では)。背景は子要素(`.page-in`)に持たせる。
- `.g-close:hover` で `background` ショートハンドを使うと背景画像が消える(✕が消える原因だった)。
- ウィンドウ幅に応じた切替は `@media` ではなく **コンテナクエリ**(`.page-in { container-type: size }`)。窓幅はビューポートと無関係。
- 上端の取っ手(高さ約30px)にページ見出しが潜らないよう `.page-in { padding-top: 38px }`。
- 素材カードの文字は `white-space: nowrap` + `--w` 比のフォントサイズ(`Holographic` が収まる 0.08)。

## 9. 触らない/聞くこと

- 見た目の**再解釈**はしない(「こうした方が良さそう」は提案として別に書く)。
- 素材が足りない/プロトタイプで曖昧な所は、**仮実装して `TODO(art)` / `TODO(owner)` を残し**、作業は止めない。重要な曖昧(ルール、データ移行)だけオーナーに質問。
- Matte の1日上限、Market の課金、クリエイター機能は**未決**。UI の枠だけ作り、挙動は入れない。

## 10. Codex に貼る依頼文(コピペ用)

```
ブランチ claude/relaxed-dijkstra-ocnjzu の docs/port-spec/README.md を最初から最後まで読み、その指示どおりに作業してください。
目的は、docs/ui-proposals/app/ のプロトタイプ(Studio シェル + Aa Std 書体)を、本物の Tauri アプリ(src/ と src-tauri/)へ見た目も動きもそのまま移植することです。
見た目の正解は docs/port-spec/golden/*.jpg、数値の正解はプロトタイプの CSS/JS です。再解釈せず、写してください。
README の「8. 進め方」のスライス1から順に、1スライス1コミットで進め、各スライスの最後に本物の画面を golden と並べた比較画像を docs/port-spec/compare/ に置いてください。
素材が足りない所は仮実装して TODO(art) を残し、作業は止めないでください。ルール(Rust 側)の変更は UI とは別コミットにしてください。
```
