# UI 引き継ぎ(画像生成・アート・演出が必要な部分)

> **Codex に渡す制作指示書は [docs/codex-art-prompt.md](codex-art-prompt.md)**(雰囲気の参考画像は `docs/art-reference/`)。この文書はコードとの契約(コマンド・イベント・DOM)の説明。

Phase 2 時点。**機能・状態遷移・文言・データの流れは実装済み**で、見た目はプレースホルダーです。
アート担当(Codex など)は、下の「差し替えポイント」を埋めてください。ロジックは触らずに済む構造にしてあります。

## 守ること(仕様書より)

- 過度なフォトリアルにしない(NG 2)。現実のプリンター・手・机・実写包装は出さない。**あくまでデジタルUI**。
- 封筒は「平面・軽い影・小さな封・Petaロゴ・Sender」程度(§37)。
- Dashboard 型 SaaS の見た目(Card / Graph / Button の羅列)にしない(NG 1)。ゲームUI化(XP・レベル等)もしない(NG 3)。
- ガチャを主役にしない(NG 4)。**主役は「毎日デスクトップに何かを残すこと」**。
- Peta オブジェクトの色: Kraft / Paper / Holographic / Foil / Soft Pastel。UI 全体はカラフルにしすぎない(§85)。
- 手書き風フォントは Envelope / Material label / 小さなメモ / Pack 装飾のみ。長文・重要操作には使わない(§86)。
- サウンドは小さく・全OFF可能(§56)。

## 差し替えポイント(`src/today.html`)

プレースホルダーは `.art-slot[data-art]`(点線の枠)と `.art-inline[data-art]` で、**画面上でも見える**ようにしてあります。
`data-art-note` に意図を書いてあります。

| `data-art` | 表示される状態 | 欲しいもの |
|---|---|---|
| `envelope` | 今日の素材が届いていて、未開封 | 閉じた封筒 / スリーブ。クリック(= Open ボタン)で開く。**中身は開封まで見えない**(§36) |
| `material-reveal` | 開封後 | 素材が現れる演出(例: ホログラムが光を反射)。レアリティの気配(§15, §20) |
| `see-you-tomorrow` | 今日の1枚を貼り終えた | 締めの一瞬。今日の1枚が添えられる |
| `choice-create` / `choice-collection` / `choice-gift` / `choice-pack` | 今日の選択(4択) | 各選択肢のオブジェクト(§3.1: ボタンよりオブジェクト)。Gift / Pack は今は無効表示 |
| `icon-create` 等(`.art-inline`) | 同上 | 上のオブジェクトを置くまでの仮アイコン枠 |

素材のバッジ(`.badge[data-rarity]`)は CSS だけの仮表現です。`common / uncommon / rare / special / archive`。

## Cutting Mat(`src/creator.html`)

Phase 3 で**機能として実装済み**。見た目だけプレースホルダーです。

| `data-art` | どこ | 欲しいもの |
|---|---|---|
| `cutting-mat`(`#mat`) | 3ペインが載る作業台 | カッティングマット(グリッド、柔らかい緑のラバーマット等)。**実写の道具は描かない**(NG 2)。平面的なデジタルUIとして |
| `cutting-progress`(`#loading`) | 背景除去の待ち時間(1〜3秒) | 静かな待機の演出。「切っている」感じ |

- 3ペイン(Original / Cutout / Material preview)・素材チップ・スライダー・ブラシの**構造と ID は維持**してください(`creator.js` が参照)。
- ステッカーの**中身の絵**(切り抜き・フチ・素材の質感)は **Rust が生成**します(`peta-core` の `sticker.rs`)。アートで置き換えるものではありません。
  素材ごとの追加の見た目(紙の繊維、ホログラムの質感の調整)は、素材 recipe(`materials.rs`)のパラメータで変えられます。
- 「Make this Peta」の後の演出(**印刷 → 掴む → 貼る**)は Phase 4。今は押した瞬間にデスクトップへ貼られます。

### Cutting Mat のコマンド(UI が使うもの)

| コマンド | 説明 |
|---|---|
| `creator_info` | `{ phase: "loading"\|"ready"\|"failed", error?, width, height, hadAlpha, countsForToday, materials, defaultMaterial, defaultStrength }` |
| `creator_original` | 元画像(JPEG の生バイト) |
| `creator_render({ materialId, strength, smooth, preview })` | 生バイト。先頭4バイト(BE)= JSON長、JSON `{ stickerLen, cutoutLen, width, height, coverage }`、完成PNG、切り抜きPNG |
| `creator_stroke({ points, radius, restore })` | ブラシ。`points` は画像の幅・高さに対する 0..1、`radius` は幅に対する比 |
| `creator_clear_edits` / `creator_cancel` / `creator_finish({ materialId, strength, smooth })` | リセット / 取りやめ(何も消費しない)/ 確定 |
| イベント `creator-changed` | 状態が変わった(`creator_info` を取り直す) |

## ステッカーの裏面(`src/back-card.js` / `back-card.css`)

**機能として実装済み**。デスクトップ(ダブルクリックで裏返す)と Collection の詳細で共通のカードです。紙は CSS で作った**仮の質感**。

| フック | 場所 | 欲しいもの |
|---|---|---|
| `data-art="backing-sheet"`(Collection 詳細の表面。`.backing`) | `#detail-front` | **台紙の表面**。裏面(`.back-card`)と**同じ4:5のカード**で、ステッカーが貼ってある。紙は `--back-paper` / `--back-paper-image` を共有するので、裏と同じ紙に見える。画像にするなら裏面と同寸・同じ角丸で |
| `data-art="back-paper"` + CSS 変数 `--back-paper` / `--back-paper-image` | `.back-card`(`data-kind="original"` / `"received"` で色を分けている) | 紙のテクスチャ(`back/paper-cream.jpg`、受け取り用に `paper-kraft.jpg`)。`--back-paper-image: url(...)` を差し替えるだけでよい |
| `data-art="stamp-frame"` | `.stamp`(ORIGINAL の二重枠。original のみ) | ゴム印風の枠(文字なし。"ORIGINAL" はコードが重ねる) |
| `data-art="peta-mark"` | `.peta-mark`(右下の "Peta") | 筆記ロゴの画像(今は文字) |

- カードの**比率は 4:5**。文字は `cqw`(カード幅の%)なので、カードのサイズが変わっても崩れません。
- **文字(ORIGINAL / Created by / 日付 / Material / No. / Edition)は Rust が文字列で返し、JS が重ねる**。画像には焼き込まない。
- 裏返しの動き(ステッカーが真横を向く→カードが現れる、各 170〜220 ms)は `main.js` の `flip()`。差し替える場合も、裏面中に**移動と裏返しだけ**できる、という動作は維持してください。

### `sticker_back(stickerId)` → `StickerBack`

```jsonc
{
  "stickerId": "PETA-A6F4-8Q21", "idCode": "PETA-A6F4-8Q21",
  "kind": "original",            // "original" | "received"
  "originalNumber": "0001",      // original のみ。"No. 0001"
  "editionNumber": null,         // "0042" → "Edition #0042"
  "createdBy": "Satoshi", "createdOn": "Oct 3, 2026",
  "material": { "id": "holographic", "name": "Holographic", "rarity": "rare" },
  "receivedFrom": null, "receivedOn": null,   // received のみ
  "history": [ { "type": "created", "by": "Satoshi", "on": "Oct 3, 2026" } ]
}
```

## Collection(`src/collection.html`)

**機能として実装済み**。見た目だけプレースホルダーです(`data-art` のフック)。

| `data-art` | どこ | 欲しいもの |
|---|---|---|
| `book-page` | `#page`(その月のページ。今は CSS のドットグリッド) | `book/page-left.jpg` / `page-right.jpg` |
| `book-spiral` | `.spiral`(綴じ側の帯) | `book/spiral-rings.png`(縦にタイル) |
| `book-tabs` / `book-tab` | `#index` / `.month-tab`(月のタブ) | 紙のタブ(`book/tab-blank-*.png`)。月名はコードが重ねる |
| `swatch-<id>` | 素材帳の `.swatch` | `materials/swatch-*.png` |
| (表紙) | まだ画面なし。表紙 → ページへの導入は Phase 5 の演出 | `book/cover-kraft.png` |

### コマンド

| コマンド | 説明 |
|---|---|
| `book_index` | `[{ year, month, count }]`(新しい月が先) |
| `book_page({ year, month })` | `[{ date, stickerId, originalNumber, materialId, sourceType, aspect, onDesktop }]`(古い順) |
| `material_book` | `[{ material, unlocked }]`(カタログ全部。未獲得は `unlocked: false`) |
| `profile_get` / `profile_set({ displayName })` | 裏面に印字する名前 |
| `peel_sticker({ stickerId })` | デスクトップから剥がす(ライブラリには残る)。`placements-changed` が飛ぶ |
| `daily_stick_from_collection({ stickerId })` | 今日の1枚として貼る(既存) |

## デスクトップ上のステッカー(素材の見た目)

- `.sticker[data-material="holographic"]` に、ステッカーの形で切り抜かれた反射の帯(`::after`、`mask-image`)が重なる。
  帯の位置は CSS 変数 `--sx / --sy / --sa`(位置と角度から計算)。**静止中はアニメーションなし**(負荷を抑えるため)。
  アートで反射をリッチにする場合も、**常時アニメーションは避ける**(§57)。

## 組み込み済みの P1 素材(`src/art/p1.css`)

`index.html`(デスクトップ層)と `collection.html` が読む。印刷口(`print/print-slot.png` と glow)、Print の台紙(`print/backing-sheet.png`、2:3)、裏面と台紙の紙(`back/paper-cream.jpg` / `paper-kraft.jpg`)、空のステッカー帳(`empty/collection-empty.png`)。ステッカー帳の本体(ページ `book/page-right.jpg`、スパイラル `spiral-rings.png`、月のタブ `tab-blank-1..6.png` を6色で循環)も組み込み済み。未組み込み: ステッカー帳の表紙・ページめくりの影、封筒の到着、ギフト、ペタッのタグ、ヒーロー(初回起動画面が未実装)。

## まだ存在しない演出(Phase 4 以降)

画像生成・アニメーションが必要で、**意図的に未着手**です。

- **デスクトップに封筒が届く**(§35-36, §3.4)。今は「メニューバーの ● 表示」で代用している。
  → デスクトップレイヤー上に小さな封筒を出す案。クリックで Today を開く、など。
- **Print → Grab → Paste は動く(CSS と WebAudio の仮表現)**: `src/print.js` / `style.css` 末尾。差し替え位置は
  `data-art="print-slot"`(印刷口)/ `print-slot-glow` / `backing-sheet`(台紙。Collection と共通)。
  「ペタッ」は `print.js` の `pata()`(合成音)。音ファイルにするならここを差し替える。
  素材は Codex の Stage 2(`print/print-slot.png` 等)。出てくる動き(`.print-sheet` のアニメーション)は実装側。
- **Holographic の本格的な GPU 反射**(カーソル・角度・仮想光源で変わる)(§57)。今は CSS の帯による簡易表現。
- 封筒の開封・Pack 開封・Peel(剥がす)の音(§56)
- 剥がす動作の本物の「めくれ」(今は平面が辺を軸に持ち上がる近似。曲面の描画が要る)

## データ・イベントの契約(UI はこれだけ知っていればよい)

Tauri の `invoke(コマンド名, 引数)` と `listen(イベント名)`。`withGlobalTauri` 有効なので `window.__TAURI__` から使える。

### `daily_status` → `DailyStatus`

```jsonc
{
  "date": "2026-10-01",            // ローカル日付。0:00 で切り替わる
  "materialOpened": false,          // false の間は material が null(中身はサプライズ)
  "material": null,                 // 開封後: Material
  "slot": "available",              // "available" | "selecting" | "confirmed" | "used"
  "canCreate": true,                // 今日の新しい1枚をまだ選べるか
  "stickerId": null,                // 確定後: 今日の1枚
  "unlocked": [ /* Material[] */ ]  // 見つけた素材(Material Book)。count/unlimited つき。作れるのは unlimited か count>=1
}
```

`Material` は `{ id, name, rarity, recipe, unlockedAt, count, unlimited }`。`count` は在庫(使うと減る)、`unlimited` は Matte のみ true。`recipe` は仕様 §61 の MaterialRecipe(camelCase)。

### コマンド

| コマンド | 引数 | 説明 |
|---|---|---|
| `daily_open_material` | – | 封筒を開ける。素材が Material Book に入る |
| `daily_create` | `{ materialId? }` | 画像を選んで(OS のダイアログ)今日の1枚にする。キャンセルは何も消費しない |
| `collection_unused` | – | デスクトップに無いステッカー一覧(`[{ id, originalNumber, createdAt, materialId, aspect }]`) |
| `daily_stick_from_collection` | `{ stickerId }` | コレクションから今日の1枚を貼る |
| `sticker_asset` | `{ stickerId }` | 貼り付け用 PNG の生バイト(`ArrayBuffer`)。`Blob` → `URL.createObjectURL` で表示 |

失敗は文字列で返る。**`"already_used_today"`** は「今日の1枚は確定済み」の意味(UI は丁寧に断る。例: "See you tomorrow.")。

### イベント

| イベント | いつ | UI がすること |
|---|---|---|
| `daily-changed` | 開封・確定・日付変更・開発用リセット | `daily_status` を取り直して再描画 |
| `placements-changed` | デスクトップ上のステッカーが増減した | (デスクトップレイヤーが自動で再同期) |

### 状態遷移(§12)

```
AVAILABLE -> SELECTING -> CONFIRMED -> USED
```

- **SELECTING** = Today 画面が開いている間(保存されない UI 状態)。
- **CONFIRMED** が取り返しのつかない点。確認・選択・プレビューでは消費しない。
- Print → Grab → Paste(Phase 4)が入ったので、CONFIRMED と USED の間に時間がある(印刷口で待っている間)。`print_pending` が待っているステッカー、`print_paste` が貼って USED にする。

## ステッカー本体の見た目(デスクトップレイヤー、`src/style.css`)

- 持ち上げ(`.lifted`)→ 離すと沈む(WAAPI の `scale 1.04 → 0.98 → 1.0`、240ms)= 仕様 §29。
- 剥がし(`.peeling` / `.peel-ready`)。**Option+ドラッグの調整は別途まとめて直す予定**。
- 編集バー(`#edit-hint`)は仮の見た目。
