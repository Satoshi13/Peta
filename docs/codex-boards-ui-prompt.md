# Codex への依頼: Boards(台紙)の画面プレビュー

**使い方**: この文書の全文を Codex に渡す。今回作るのは**触れる画面プレビュー(HTML 1ファイル)**で、アプリのコード(`src/app/` `src-tauri/`)は**変更しない**。画面が決まったら、ロジックの依頼を別に書く。

> 日本語で指示。プレビューの UI の文言は**英語**(アプリの方針)。プレビュー内の説明(注釈)は日本語。

**仕様の本体は [`docs/boards-plan.md`](boards-plan.md)**(最初に全部読む)。食い違ったら仕様を優先し、報告に書く。

---

## 0. 何を作るか

`docs/ui-proposals/boards-preview.html` — Boards の画面を、**ダミーのデータで触って確かめられる**プレビュー。

- 1ファイルで開ける(`file://` で動く)。画像は `src/art/` の実アートを参照し、最後に埋め込んだ単体版 `boards-preview.standalone.html` も作る(既存の `gacha-aaa/build.py` と同じやり方でよい)。
- 外部の CDN・フォントは使わない。
- 上部に**状態の切り替え**(下の §3 の見本)と、**画面の数(1 / 2 / 3)**の切り替え、ライト / ダーク、Reduce motion の切り替えを置く。
- `docs/ui-proposals/README.md` の表に1行追加する。

## 1. 世界観(必ず守る)

- このアプリは、**平らで洗練された UI の上に、紙・テープ・クリップなどの小物が乗っている**ギャップが世界観。Market の Tools(破れ紙・マスキングテープ・クリップ)と Studio の見た目に合わせる。
- 使う実アート(新しい絵は描かない。足りなければ CSS で仮置きし、報告に「必要な部品」として書く):
  - 台紙: `src/art/ui/peek-paper.png`、テープ: `src/art/ui/peek-tape.png`、クリップ: `src/art/ui/paper-clip.png`、紙のパネル: `src/art/ui/panel-paper.png`、鍵のかかった枠: `src/art/ui/card-locked.png`、Scraps: `src/art/ui/scraps-icon.png`、メモ: `src/art/notes/note-memo-torn-cream.png`。
  - ステッカー: `src/art/samples/` の `blue-flower.png` `cassette-tape.png` `coffee-cup.png` `polaroid-mountain.png` `potted-plant.png` `cat-pack-sitting.png` `film-camera.png` `good-day.png` など。
- 影は `src/art/manifest.json` の `shadowPolicy`(薄く短く右下)。色・文字の役割は既存の `src/app/` の CSS に合わせる(読むだけ)。
- 台紙の名前は**手書き風**に見せる(ラフの印象)。ただし新しいフォントファイルは足さず、既存のフォントと CSS の工夫で。
- 3D の傾き・ギラつく光・常時動くアニメーションは入れない。台紙は ±1〜2° の傾きまで。

## 2. 画面(オーナーのラフの構成を土台にする)

ラフ(`docs/ui-proposals/boards-rough.webp` があれば見る。なければ `boards-plan.md` の説明で): クリーム色の紙の背景、左上に見出し、破れ縁の台紙カードが少し傾いて並び、使用中の台紙に緑の丸いチェック、その下に黒い丸ボタン、右に白いカードの Tools 欄(クリップで留めた白紙の台紙2枚の絵と交換ボタン)。

### 2.1 Boards のページ

- 見出し `Boards`、小さく `Blank boards: 2`(白紙の台紙の在庫)。
- **Screens(画面の記憶)**: つながっている画面を、macOS のディスプレイ配置のような小さな図で並べる。各画面にいまの飾りの縮小(ステッカーの小さな絵)と、その画面に出ている Board の名前か `Unsaved`。押すとその画面が「操作の対象」になる。画面が1つなら図は小さく1つだけ。外したモニター(しまっている)も薄く出し `Stored — comes back when connected`。
- **Boards(保存した台紙)**: 台紙カードの一覧。カードは台紙の上にステッカーの縮小・手書きの名前・使用中のチェック(対象の画面で使っているもの)・Auto の小さな札(例: `Weekdays 9–18`、`Home Wi‑Fi`)。
  - 主ボタン: `Put on <画面の名前>`(対象の画面に呼び出す)。
  - カードの「…」: `Rename`、`Update with this screen`(無料で上書き)、`Delete`。
- **Save as board**: 上部に `＋ Save this screen as a board`(台紙を1枚使うことを、ボタンの下に小さく `Uses 1 blank board`)。在庫が0なら押せず、理由と Tools への案内。
- ~~Tools のカード~~ → **2026-10-12 廃止(オーナー)**: 購入は Market の Tools だけ。Boards のページは右上に残り枚数と、0枚のとき `Get one in Market` の案内だけを出す。
- **Auto**(ページ下部か右の別パネル): きまりの一覧。1行 = 「いつ / どこで」+「どの画面」+「どの Board」+ オン/オフ。並べ替えのつまみ。`＋ Add a rule`。

### 2.2 ダイアログ

1. **保存**: 名前(24文字まで、既定 `Board 1`…)、縮小の絵、`Uses 1 blank board · 1 left after this`、`Save` / `Cancel`。
2. **削除の確認**: `The stickers stay in your Collection. The blank board is not returned.`
3. **Auto のきまり**: 種類(`Time` / `Place`)。Time は曜日のチップ(Mon–Sun)と開始・終了時刻。Place は Wi‑Fi のネットワーク名(いまつないでいるものを候補に)。画面と Board を選ぶ。
4. **位置情報の許可の説明**(最初に Place を選んだときだけ): `Peta uses your Wi‑Fi name to know where you are. It never leaves this Mac.` → `Continue`(このあと macOS の許可が出る想定)。

### 2.3 知らせ(トースト)

- `Put “Work day” on Studio Display` + `Undo`
- 自動: `It's 9:00 — put “Work day” on Studio Display` + `Undo`
- 飛ばした: `2 stickers were skipped (on another screen / no longer yours)`
- モニターを外した: `Studio Display's stickers are stored`、つないだ: `Studio Display's stickers are back`

### 2.4 メニューバー

`Boards ▸` のサブメニューの見本(画像でなく HTML でメニューを再現): 画面が2つ以上なら画面ごとの小見出し、その下に Board の名前(使用中にチェック)、区切り、`Undo`、`Save this screen as a board…`、`Open Boards…`。

## 3. 状態の見本(上部の切り替えで出せるようにする)

- Board が0枚(白紙の台紙は2枚ある): 空の状態の案内と、点線の空き台紙。
- 白紙の台紙が0枚: 保存ボタンが押せない、Tools が目立つ。
- 対象の画面が `Unsaved`(Board と違う飾り)/ Board と同じ(チェック)。
- 点線の影: `On another screen` と `No longer yours` を含む Board。
- 画面が 1 / 2 / 3 つ、外したモニターが1つある。
- Auto のきまりが0件 / 3件(1件オフ)。
- 呼び出し・保存・削除の動き(剥がれて貼られる、台紙が1枚減る)。Reduce motion では動きを省き、すぐ切り替える。

## 4. やらないこと

- アプリのコード・DB・Rust の変更。新しい画像素材の制作(必要な部品は報告に書くだけ)。
- 実際のモニター・Wi‑Fi・位置情報の取得(プレビューはダミーのデータ)。

## 5. 報告

`docs/ui-proposals/boards-preview-notes.md` に日本語で:
- 作った画面と状態の一覧、触り方。
- 仕様(`boards-plan.md`)から変えた点・迷った点と理由。
- **足りない絵の部品**(例: 白紙の台紙の束、Auto の札、外したモニターの絵)と、その大きさの目安。
- オーナーに決めてほしいこと(Board ×1 の見せ方、Auto をページのどこに置くか、など)。
