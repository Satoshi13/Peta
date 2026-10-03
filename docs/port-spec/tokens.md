# Tokens & geometry(プロトタイプから抜き出した数値の正解)

値の出どころは `docs/ui-proposals/app/css/base.css`(`:root`)、`js/core.js`(`EASE`)、`css/shells.css` / `css/polish.css`。食い違ったらコードが正。

## 色・影・書体

```css
--ink: #2b2a28;  --ink2: #4a463f;  --muted: #7a7468;  --cream: #f5f0e6;  --paper: #faf6ec;  --soft: #fbf9f4;
--kraft: #c9a878;  --line: #ddd4c2;  --red: #d8453a;
--holo: linear-gradient(105deg, #f6c6e3, #c9c3f5, #bfe3f7, #c8f2dc, #f7f0be);
--sh1: 0 1px 1.5px rgba(60,45,20,.28), 0 4px 10px rgba(60,45,20,.08);
--sh2: 0 1px 2px rgba(60,45,20,.3), 0 10px 22px rgba(60,45,20,.14);
--sh3: 0 2px 4px rgba(60,45,20,.25), 0 24px 44px rgba(60,45,20,.24);
--sys:  -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Hiragino Sans", "Noto Sans JP", sans-serif;
--hand: "Klee One", "Noteworthy", "Bradley Hand", cursive;
--type: "Special Elite", "Courier Prime", "Courier New", monospace;      /* Aa Std のアクセント(eyebrow・クォータ・パック情報) */
```

- 本文 14px / 行間 1.5、`-webkit-font-smoothing: antialiased`。見出し `.ph h1` は Studio 38px / Desk 40px、weight 650–700、`letter-spacing: -.025em`。
- 重要ボタン `.btn` は**黒(`--ink`)背景に白文字の丸ピル**(`border-radius: 999px; padding: 10px 24px; font: 600 14px`)。控えめなボタン `.btn.paper` だけ紙のラベル画像(`btnLabel`)。

## イージング・時間

```js
out: cubic-bezier(.2,.8,.2,1)   inOut: cubic-bezier(.65,.05,.25,1)   spring: cubic-bezier(.34,1.56,.64,1)
paper: cubic-bezier(.5,.05,.2,1)   soft: cubic-bezier(.3,.7,.3,1)
```

| 動き | 時間 | 出どころ |
|---|---|---|
| 窓が開く(トレイから) | 560ms spring | `shell.js open()` |
| 窓が閉じる(トレイへ) | 380ms inOut | `shell.js close()` |
| ページ遷移 Desk(紙が重なる) | 640ms out / 旧ページ 560ms | `TRANS.desk` |
| ページ遷移 Studio(ズーム or スライド) | 560ms out / 旧 420ms | `TRANS.studio` |
| 緑ボタン(広げる↔戻す) | 360ms ease-out cubic | `shell.js tweenWin()` |
| 印刷シートの送り | 2400ms `steps(22)` | `desktop.js print()` |
| Reduce motion | 遷移なし・演出短縮(`data-motion="reduce"`) | `core.js reduced()` |

## 窓の寸法

| | 値 |
|---|---|
| 既定 | `--win-w: min(1060px, 100vw − 150px)` × `--win-h: min(700px, 100vh − 118px)` |
| 最小 | 720 × 520(リサイズの角) |
| 最大 | 画面 − (24, 28 + 80) |
| 位置 | 画面中央 + `--dx/--dy`(上端ドラッグで変更。ダブルクリックで中央へ) |
| ウィンドウ操作 | ピル 108×36 / 丸 24×24(left 10・42・74、top 6) |
| 上端のドラッグ領域 | 高さ 28px(不可視) |
| 余白 | `.page-in { padding: 38px 36px 36px }`(上端のピルの分、上が深い) |

### Studio
- 窓: 角丸 18px、背景 `#f3efe6`、`overflow: hidden`。サイドバー幅 204px(`padding: 94px 12px 14px`)、ナビ項目高さ 42px・角丸 11px、ロゴは `top: 54px; left: 22px; 64×28px`。
- ページ紙: `--studio-paper`(`paperCream` を 84% 白で薄めたもの)。

### Desk
- 窓: 角丸 20px、背景 `--a-mat`(cover)。ナビは左に幅 92px の縦並び(アイコン 36px、ラベルは手書き体 12px・白+影)、現在のページは紙のカードで右へ 6px・-1°。
- ページ(`.book` 矩形): `left 112 / right 16 / top 16 / bottom 16`。ページ紙 = `paperCream` を 60% 白で薄めたもの。
- **Create**: 紙なし。マットに直接(見出し・キャプションは明るい色+影)。
- **Book**: ページ自身の矩形 `inset: 14px 6px 14px 40px`。表紙(`coverBoard`、はみ出し -14 / -14 / -14 / -36)、スパイラル(`spiralCoil` + `spiralHoles`、幅 54px、left -33px)、ドット罫(22px 格子)。表紙とスパイラルは**ページの一部**として一緒にフェードする。

## 状態の持ち方(プロトタイプ → 本物)

| プロトタイプ `S` | 意味 | 本物 |
|---|---|---|
| `S.shell` | `desk` / `studio` | 設定(永続)。Settings の Window style |
| `S.page` | 現在のページ | ルータの状態。`body[data-page]` も付ける |
| `S.closeOutside` | デスクトップクリックで閉じる | 設定(永続)。既定オン |
| `S.motion` / `S.sound` | モーション低減 / サウンド | 設定(永続) |
| `S.packsOpened` / `PACK_DAILY` | Welcome Pack の本日の回数(1) | `daily.rs`(0時でリセット) |
| `S.stuckToday` など | 今日貼った枚数 | **上限なし**(表示のみ) |
