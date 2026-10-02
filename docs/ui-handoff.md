# UI 引き継ぎ(画像生成・アート・演出が必要な部分)

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
| `creator_render({ materialId, strength, preview })` | 生バイト。先頭4バイト(BE)= JSON長、JSON `{ stickerLen, cutoutLen, width, height, coverage }`、完成PNG、切り抜きPNG |
| `creator_stroke({ points, radius, restore })` | ブラシ。`points` は画像の幅・高さに対する 0..1、`radius` は幅に対する比 |
| `creator_clear_edits` / `creator_cancel` / `creator_finish({ materialId, strength })` | リセット / 取りやめ(何も消費しない)/ 確定 |
| イベント `creator-changed` | 状態が変わった(`creator_info` を取り直す) |

## デスクトップ上のステッカー(素材の見た目)

- `.sticker[data-material="holographic"]` に、ステッカーの形で切り抜かれた反射の帯(`::after`、`mask-image`)が重なる。
  帯の位置は CSS 変数 `--sx / --sy / --sa`(位置と角度から計算)。**静止中はアニメーションなし**(負荷を抑えるため)。
  アートで反射をリッチにする場合も、**常時アニメーションは避ける**(§57)。

## まだ存在しない演出(Phase 4 以降)

画像生成・アニメーションが必要で、**意図的に未着手**です。

- **デスクトップに封筒が届く**(§35-36, §3.4)。今は「メニューバーの ● 表示」で代用している。
  → デスクトップレイヤー上に小さな封筒を出す案。クリックで Today を開く、など。
- **画面端から印刷される Print アニメーション**(§27)。実在するプリンターは描かない。抽象的な「印刷口」。
- **Grab → Drag → Paste の「ペタッ」**(§28-29)。※ 掴んで貼る基本操作は実装済み。印刷から貼るまでの導線は未。
- **ステッカーの裏面**(ORIGINAL / Received の来歴表示)(§30)と**裏返す動き**
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
  "unlocked": [ /* Material[] */ ]  // 獲得済み素材(Material Book)
}
```

`Material` は `{ id, name, rarity, recipe, unlockedAt }`。`recipe` は仕様 §61 の MaterialRecipe(camelCase)。

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
- Phase 4 で Print → Grab → Paste が入ると、CONFIRMED と USED の間に時間が生まれる(今は一瞬で両方通る)。

## ステッカー本体の見た目(デスクトップレイヤー、`src/style.css`)

- 持ち上げ(`.lifted`)→ 離すと沈む(WAAPI の `scale 1.04 → 0.98 → 1.0`、240ms)= 仕様 §29。
- 剥がし(`.peeling` / `.peel-ready`)。**Option+ドラッグの調整は別途まとめて直す予定**。
- 編集バー(`#edit-hint`)は仮の見た目。
