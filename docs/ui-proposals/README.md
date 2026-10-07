# UI 提案プロトタイプ(1ウィンドウ版)

| ファイル | 何か |
|---|---|
| [`peta-prototype.html`](peta-prototype.html) | **触れるプロトタイプ(1ファイル)**。ブラウザで開くだけ(`file://` でOK。画像・CSS・JS は全部埋め込み済み、約1.1MB) |
| [`app/`](app) | そのソース(素材は `src/art/` をそのまま参照)。ビルド: `node docs/ui-proposals/app/build.mjs`(要 ImageMagick) |
| [`design-quality-preview.html`](design-quality-preview.html) | **デザイン品質レビュー**。実機スクリーンショット(Before)と実素材を使った提案(After)を左右ワイプで比較。文字の役割・コントラスト・Today/Book/Create/Market/Packs・Sidebar・Night Desk・部品の状態表・動き・着手順。**1ファイル完結**(画像・フォント埋め込み、約1.6MB)。ソースは `design-quality-preview.src.html`、再生成は `python3 scripts/build-design-quality-preview.py` |
| [`aaa-preview.html`](aaa-preview.html) | **AAA級レビュー**。現状の実機スクリーンショット(いま)と実素材で作った提案(提案)を切り替えて比較。Today の主役化・Create の切り抜き演出・Materials の棚・Collection のポスター・Mac への入口(メニューバー/ウィジェット/共有)・面と階層・動きの数値化・着手順。**`file://` では光の表現(mask)が効かない**ので `python3 -m http.server 8765` で配信して `http://localhost:8765/docs/ui-proposals/aaa-preview.html` を開く |
| [`aaa2-preview.html`](aaa2-preview.html) | **AAA級レビュー 第2弾**。実機を全ページ撮り直し、まだ「箱・枠」に閉じ込められているモノを紙の上に置き直す4案(Today=台紙から抜く / Collection=紙に直接+絞り込み / Gifts=手紙トレイ+Sent / Materials=見本帳)と、共通文法(寄る・紙に置く・手書きで示す)、レア度の梯子、進める順番。「いま / 提案」を切り替えられ、Collection と Gifts は「寄る」まで触れる。現状の撮影は `aaa2/`。`aaa2-preview.html` は画像を埋め込んだ単体ファイル(約6MB。どのビューアでも画像が出る)で、ソースは `aaa2-preview.src.html`、再生成は `python3 docs/ui-proposals/aaa2/build.py` |
| [`packs-shelf-preview.html`](packs-shelf-preview.html) | **Packsを「棚」に見せる3案**(A 棚に立てる / B クリップで吊るす / C コルクボードに留める)。実アプリの現状スクショと切り替えて比較。袋・棚板・タグ・画鋲は `src/art/` の実アート。`python3 -m http.server` で配信して開く |
| [`sticker-shop-preview.html`](sticker-shop-preview.html) | **ステッカーのお店の見せ方+「寄る」詳細**。袋を押すとカメラがその袋に寄り、そこで初めて詳細と Get / Exchange / Open が出る(Esc・✕・背景クリックで引く)。Market(買う)/ Packs(持っている)と、店先の棚(日よけ・看板・値札)/ 吊るす壁を切り替え。袋の名前は袋の白い札に印字。`python3 -m http.server` で配信して開く |
| [`sticker-shop-v2-preview.html`](sticker-shop-v2-preview.html) | **ステッカーのお店 v2(背景は紙の面のまま、モノだけ写実)**。左上1灯の光(接地影・環境遮蔽・紙に落ちる影)、壁付けの棚(金具・天面・値札レール)/ 金属レールに吊るす案(ユーロ穴ヘッダー・フック・値付けシール)、在庫の厚み、寄って詳細(傾き・ホロ)。Market / Packs 切替。`python3 -m http.server` で配信して開く |
| [`sticker-shop-v3-preview.html`](sticker-shop-v3-preview.html) | **Market=レール(先頭にピックアップ)/ Packs=棚**。ページに入るとレールの袋が2Dで順に揺れる(3Dの傾きは全廃)。影はアート規約(薄く短く右下2px)に合わせた。下に「依頼する部品」の見本。部品の依頼文は [`../codex-shop-parts-prompt.md`](../codex-shop-parts-prompt.md) |
| [`index.html`](index.html) | 最初の静的な比較(素材ピッカー3案・全体3方向)。プロトタイプの前段 |

開発中にソースの `app/index.html` を開くときは、ファイルを直接開かず `python3 -m http.server` などで配信する(canvas が `file://` の画像で汚染されるため)。

## 何を見せているか

**今のアプリは Today / Cutting Mat / Sticker Book / Arrival が別々のウィンドウ**。これを「メニューバーから出入りする **1つのウィンドウ**」にまとめ、画面遷移はそのウィンドウの中で行う。デスクトップのステッカー層(透明レイヤー)は今までどおり別。

| 今のウィンドウ | プロトタイプでは |
|---|---|
| `today.html`(封筒 → 素材 → 4択、Pack、Gift) | **Today / Packs / Gifts** のページ。封筒の開封・素材カードがトレイに収まる流れ、Pack のめくり開封、Gift の封蝋 |
| `creator.html`(Cutting Mat) | **Create** のページ(元画像 → 切り抜き → ステッカー、ブラシ、素材) |
| `collection.html`(ステッカー帳 + 素材帳) | **Book** と **Materials** のページ。裏返し・ギフト作成(封をする) |
| `arrival.html`(小さな封筒) | デスクトップ隅の封筒 → クリックでウィンドウが開いて Today へ |
| 印刷 → 掴む → 貼る | ウィンドウが閉じ、画面上端の印刷口からシートが出る → ステッカーをドラッグ → ペタッ |
| メニューバーの Peta | 各ページへ直接入る(Create… / Today / Gifts / Open a Pack / Sticker Book / Material Book) |

## ルールの変更(2026-10-03 の指摘を反映)

| 何 | 今のアプリ | プロトタイプ |
|---|---|---|
| 新しい素材 | 1日1個(封筒) | 同じ。1日1個 |
| ステッカーを作る/貼る | **1日1枚** | **何枚でも**。ただし Create は素材を1つ使う(Matte は無限) |
| Pack を開ける | Today の1枠を使う | **Welcome Pack は1日1回**(0時にリセット)。**Market で手に入れたパックは、いつでも何度でも**(中身がなくなるまで)。素材は使わない |
| Gift を開ける | Today の1枠を使う | **制限なし**。届いた分だけ、いつでも開けられる。素材は使わない |
| Today の素材ピッカー | あり | **なし**(素材を選ぶのは Create の中だけ) |

注意: Matte が無限なので、Matte だけなら実質的に枚数の上限はなくなる。上限を残したいなら「Matte も1日 N 枚」「Matte は1日1枚まで」などを決める必要がある(未決)。

## タイトルバーなしのウィンドウ

上端の帯をなくした。動かす・閉じるは次のとおり。

- **動かす**: ウィンドウ上端の細い領域(不可視、高さ 28px)をドラッグ。ダブルクリックで中央に戻る。
- **大きさ**: 右下の角(斜線)をドラッグ。ダブルクリックで元の大きさ。
- **閉じる/最小化/広げる**: 左上の紙のピルの赤 / 黄 / 緑。閉じるは `Esc` / デスクトップをクリック(Settings でオフにできる)でも。
- **戻す**: メニューバーの Peta アイコン。
- 初回だけ「Esc、デスクトップのクリック、リボン(タグ)で片づく」と案内する。

## 書体の比較(ツールバーの Aa / Hand / Type / Pen)

| | 本文 | 見出し | 手書きのラベル |
|---|---|---|---|
| Mix | Courier Prime | Cormorant Garamond(イタリック) | Homemade Apple |
| Aa Std | システム | システム太字 | Klee One |
| Hand | Zen Maru Gothic | Yomogi | Yomogi |
| Type | Courier Prime | Special Elite | Special Elite |
| Pen | Shippori Mincho | Cormorant Garamond(イタリック) | Homemade Apple |

## 今日の素材の開封

封筒から出てきたカードは、**その素材のパック**(Holographic=銀箔、Kraft=クラフト袋、Matte=紙袋)に入っている。上端を破いて、中のカードを引き出す。空になった袋は画面の隅に残り、ホログラムは光を反射し続ける。

## 書体

既定は **Aa Std**(システムのサンセリフが土台。eyebrow・クォータ・パック情報だけタイプライター、ステッカー裏は手書き)。ほかに Mix / Hand / Type / Pen。既定のシェルは **C Studio**(サイドバー＋紙の実物パーツの“ギャップ”が一番良いという判断)。

## ステッカーの裏面

裏の紙が**素材に合わせて変わる**(Matte=上質紙、Kraft=クラフト、Holographic=銀のホログラム台紙、Gold=金箔、Riso=ピンクのハーフトーン、Vintage=古紙)。ホログラムと金は、ポインターに合わせて反射が動く。紙そのものは今は CSS の代用で、本物の素材は [codex-ui-polish-prompt.md](../codex-ui-polish-prompt.md)。

## アウトライン

Create の Outline は 4〜64(前は〜30)。選んだ太さは、印刷・デスクトップ・Book にも引き継がれる(以前は Create の中だけだった)。

## Market

Packs / Materials / Creators の3タブ。Pack は詳細で中身をのぞける(3枚だけ見えて残りは「?」)。Get すると Packs の棚に並ぶ(いつでも何度でも開けられる)。Materials は購入すると素材が3枚ぶん手持ちに入り、Create で使える。Creators は Follow のみ。値段は実際には何も請求しない仮表示。

## 3つの方向(同じアプリ、動き方が違う)

- **A · Notebook** — アプリ全体が1冊のスパイラルノート。ページは綴じ目を軸にめくれる。セクションは右端の見出しタブ。
- **B · Desk** — ウィンドウは緑のカッティングマット。ページは机の上に重ねる紙(「モーダルよりレイヤー」)。セクションは左のトレイに並ぶ文具。
- **C · Studio** — 静かでモダン。左サイドバーに小さなオブジェクト、触れたものからページがズームして開く。

## Pack の開封(作り直し)

0. Welcome Pack だけ1日1回(破いた時点で1回ぶんを使う)。Market のパックは制限なし。
1. **破る**: 上端の点線に沿ってドラッグ。破れた部分が右端を軸に持ち上がり、中の暗い銀が見える。途中で離すとバネで戻る(破るまでは何も消費しない)。Enter / ダブルクリックでも破れる。
2. **引き出す**: 袋からグラシンの包みを上へ引く。
3. **開く**: 包みがくしゃっとなって開き、ステッカーが現れる。素材のレアリティで光と粒の量が変わる(Holographic は虹の光と放射)。
4. **触る**: ポインターに合わせてステッカーが傾き、ホログラムが光を反射する。

音は Web Audio で合成(紙・破る・ペタッ)。ツールバーとSettingsでオフにできる。

## このプロトタイプが「作り物」の部分

- 切り抜きは自動ではなくサンプル(すでに切り抜き済み)を使う。自分の画像を入れると中央の楕円から始まり、Erase / Restore で整える。
- ファイルは書き出さない(ギフトの `.peta` も演出だけ)。
- ダークモードは未対応(アプリ本体にはある)。
- 付箋(見出しタブ)・メモ・ノートの紙は「システムっぽい」仮の見た目。実物らしい素材は [codex-paper-realism-prompt.md](../codex-paper-realism-prompt.md) で発注する。
- 手書き風フォントは Klee One(Google Fonts)。オフラインだと Noteworthy などに落ちる。

## 本体に取り込むときの目安

- ウィンドウを1つ(例 `book`)にして、`index`(ページ)をURLハッシュ/コマンドで切り替える。`today.html` `creator.html` `collection.html` は同じ DOM 部品に分解する(今回のプロトタイプの `Pages.*` がそのまま下書き)。
- 既存の契約(`daily_*` `creator_*` `book_*` `pack_*` `gift_*` のコマンド・イベント)は変えずに呼べる。`today.js` の状態遷移(arrived / opened / done)もそのまま。
- 新しいアート(スプリング・シール・トレイ・ラベル)は [codex-ui-parts-prompt.md](../codex-ui-parts-prompt.md) で発注済み。


## ウィンドウスタイル(2026-10-03)

Notebook を廃止し、**Desk / Studio** を Settings で切り替える(ツールバーにも同じスイッチ)。窓の上端に帯は置かない(試したが不採用)。手作りの ✕ も廃止し、Codex 納品の**紙のピル(赤・黄・緑)を左上**に置く。赤=閉じる、黄=最小化、緑=画面いっぱい↔元に戻す。窓の中のスクロールバーは出さない。Desk の Create はマットを窓いっぱいに使い、Book は手帳素材(表紙・スパイラル・ドット罫)をページ自身の一部としてマットの上に置く。
