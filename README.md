# Peta — One sticker a day.

毎日、ひとつだけ。デスクトップに残る、ステッカーのある暮らし。

現在は **Phase 3: Sticker Creator + 裏面 + Collection のデータ側**(macOS のみ)。Desktop Layer(Phase 0)、SQLite のステッカーライブラリ(Phase 1)、
**1日1枚のルールと Today's Material**(Phase 2)の上に、**写真から自動でステッカーを作る Cutting Mat**
(背景除去 → フチ → Matte / Kraft / Holographic の質感)が載っています。Print/Paste の演出と Collection 画面はまだありません。
画像生成が必要な演出は未着手で、引き継ぎ資料は [docs/ui-handoff.md](docs/ui-handoff.md) にあります。

## ネイティブUIの設定

Settings の Sounds / Haptics / Reduce motion は `peta.preferences` に保存され、開いているデスクトップ層にも通知されます。Haptics は既定オン。Printの貼り付け成功・編集モードで動かして貼り直した成功時に LevelChange(2)、剥がし成功・Giftの封蝋を割った瞬間に Generic(0) を各1回。ドラッグ途中・ホバー・単なるボタン操作では鳴らしません。Sounds と Reduce motion とは独立し、対応トラックパッドのない環境では何も起きません。

## 動かし方(Mac)

必要なもの: Xcode Command Line Tools、Rust(`rustup`)、Node 20+

```sh
npm install
npm run dev        # = tauri dev
```

- Dockには出ません。メニューバーに Peta のアイコンが出ます。
- 初回起動で、メインディスプレイの右上寄りにサンプルの猫が貼られます。
- 保存先: `~/Library/Application Support/app.peta.desktop/`(`peta.db` と `assets/stickers/<ID>/`)。Phase 0 の `placements.json` は初回に自動で移行されます。

### メニュー

| 項目 | 動作 |
|---|---|
| **Today's Peta** | Today 画面を開く。今日の素材が未開封なら `●`、今日の1枚を貼り終えたら `✓` が付く |
| **Collection** | ステッカー帳(月ごとのページ・詳細・素材帳)を開く |
| Edit Stickers | 編集モードのON/OFF。Esc / 画面上部の Done でも終了 |
| Re-sync Displays | ディスプレイ構成を再読込(通常は2秒ごとに自動検知) |
| Quit Peta | 終了 |
| **Developer ▸**(デバッグビルドのみ) | 下の表 |

**Developer メニュー**(`npm run dev` のときだけ表示。リリースビルドには出ません)

| 項目 | 動作 |
|---|---|
| Cut Out Image… (ignores daily rule) | 画像を選んで Cutting Mat で作る。**1日1枚のルールを無視**する(今日の枠は使わない) |
| Add Sample Cat (ignores daily rule) | サンプルの猫をそのまま貼る(切り抜きなし) |
| Next Day (+1 day) | 時計を1日進める。日付変更・新しい素材の抽選・スロットのリセットを確かめる |
| Reset Today | 今日の記録を消す。封筒・抽選・スロットが最初からやり直しになる(貼ったステッカーは残る) |

### 1日1枚のルール

- 今日の素材は日付ごとに1つ抽選され、**初回だけは必ず Holographic**(仕様 §88 の体験)。以降は Common 60 / Uncommon 30 / Rare 10 の重み。
- **封筒を開ける**と素材が Material Book に入り、ずっと残ります(使い捨てではありません)。Matte は最初から使えます。
- 今日の新しい1枚を**確定できるのは1回だけ**。Today 画面から **Create**(画像を選ぶ → Cutting Mat で仕上げる)か **Collection**(デスクトップに無いものを貼る)。
  **編集モード中に画像ファイルをデスクトップへドロップするのも Create** です(Cutting Mat が開き、落とした場所に貼られます)。2回目は「See you tomorrow.」と断られます。
- **Cutting Mat で「Make this Peta」を押すまでは何も消費しません**。Cancel / ウィンドウを閉じる、で元のままです。
- 素材を眺める・Today 画面を開く・画像ダイアログをキャンセルする、では消費しません。移動・拡大縮小・回転・剥がす・貼り直しは何度でも。
- 日付はローカル時間の 0:00 で切り替わります(起動したままでも、30秒以内に検知)。

### Cutting Mat(写真 → ステッカー)

Today の **Create**、またはデスクトップへの画像ドロップで開きます。**Original → Cutout → 完成**の3ペインです。

| 操作 | 内容 |
|---|---|
| (自動) | 背景除去 → 小さなゴミを消す → 穴を埋める → 輪郭を滑らかに → 丸いフチ(はさみで切ったように、狭い隙間は橋渡しされる) |
| **Material** | 獲得済みの素材から選ぶ。Matte(白い紙)/ Kraft(茶色い紙・くすんだ印刷)/ Holographic(白いリング+レインボーの膜・ラメ) |
| **Cutout adjust** | Tight ↔ Loose。切り抜きの厳しさ(動かすと即座に更新) |
| **Fix** | 中央のペインに **Erase / Restore** のブラシで描いて直す(Photoshop 的な編集機能はこれだけ)。Reset で全部戻す |
| Make this Peta | フル解像度で仕上げて、デスクトップに貼り、今日の枠を使う |

- 元から**透明な背景の PNG**は、モデルを使わずにそのまま使います(フチと素材だけ付きます)。
- スマホ写真の**向き(EXIF)**は自動で直します。
- 背景除去は**同梱の u2netp(4.5MB)**を純Rust(tract)で実行します。**初回の解析に 1〜3 秒**かかります(Mac の方が速いはずです)。
  大きいモデル(silueta など)は `PETA_MODEL=silueta` で切り替えられます。細い部分に強いですが数倍遅いです → [src-tauri/models/README.md](src-tauri/models/README.md)。
- **Holographic の光沢**はmacOSのグローバルカーソルに追従します。帯の位置・角度だけが変わり、ステッカーの傾き・影・大きさは変えません。カーソルが未移動／層の外なら従来の位置・回転による反射へ戻ります。補間は収束で停止し、ホロ0枚／Reduce motionでは33msのカーソル取得も停止します。Goldは未実装のまま、反射対象は `REFLECTIVE_MATERIALS` に集約。`reflection_status` の activeLayers / timerRunning / cursorReads とdebugログで停止を確認できます。Windows／Linuxのグローバル取得は未提供です。

### ステッカーの裏面(裏返す)

編集モード中に、ステッカーを**ダブルクリック**(または、ポインターを重ねて **F** キー)すると、ステッカーが真横を向いて**裏面のカード**に入れ替わります。もう一度ダブルクリックで表に戻ります。

- 自分で作ったもの: `ORIGINAL` のスタンプ / Created by(名前と日付)/ Material / `No. 0001` / Peta。
- 受け取ったもの(Gift・Pack、Phase 6〜7 以降): Created by / Received from(誰から・いつ)/ `Edition #0042`。データ側(来歴の記録と表示)は実装済みです。
- 裏返している間は**移動と裏返しだけ**できます(拡大縮小・回転・剥がすは表のときだけ)。編集モードを終えると、全部表に戻ります。
- 名前は Collection ウィンドウの「Your name on stickers」で変えられます(以降に作るステッカーから。既定は OS のユーザー名)。

### Collection(ステッカー帳)

メニューの **Collection** から開きます。

- **Book**: 左の目次(年 → 月)と、その月のページ。ステッカーは**今日の1枚として貼った日**のページに載ります(後日コレクションから貼り直した月のページにも載ります。一度も今日の1枚になっていないもの=サンプル等は作った月)。
- ステッカーをクリックすると詳細: 大きな表示、**Turn over**(裏面)、素材・作成日・作成者、**履歴**、そして「**Stick as today's Peta**」(今日の枠が空いていて、デスクトップに無いとき)/「**Peel off the desktop**」(デスクトップにあるとき)。Gift は後日。
- **Materials**: 素材帳。獲得済みは名前とレア度、未獲得は `?`。

### 編集モードの操作

枠や取っ手はありません。ステッカー自体が反応します(透明な部分は掴めません)。

| 操作 | 動作 |
|---|---|
| 中心寄りをドラッグ | 移動(持ち上がり、離すと「ペタッ」と貼り直される) |
| **輪郭の外側寄りをドラッグ** | 角をつまんで引くように、**拡大縮小と回転が同時に**かかる(カーソルが回転マークに変わる) |
| トラックパッドのピンチ / ひねり | 拡大縮小 / 回転(同時可。WebKit のジェスチャーイベント) |
| **Option を押しながらドラッグして引き離す** | 掴んだ側がめくれる。十分に引いて離すと**剥がれて消える**。途中で離すと貼り直される |
| Delete / Backspace | ポインター下のステッカーを剥がす |
| **ダブルクリック / F** | **裏返す**(もう一度で表へ) |

| **画像ファイルをデスクトップへドロップ**(編集モード中) | 落とした場所に貼る。**今日の Create として扱われる**(1日1枚) |

操作を離した時点で自動保存されます。触ったステッカーは最前面に来ます。
剥がしたステッカーは**デスクトップから外れるだけでライブラリには残ります**(Collection は Phase 5 で見られるようになります)。再起動しても戻りません。
**透過PNGがおすすめです。** 背景除去は Phase 3 なので、JPEG などは四角いまま貼られます。
編集バーには、直近のドラッグの描画性能(fps / 最悪フレーム時間)が出ます。カクつき調査用です。

## 検証チェックリスト(仕様 §87 の Spike 順)

実機で確認して ✅ を付けてください。**自動検証できたのは「Rustコードが macOS 向けに型検査を通ること」と
座標計算の単体テストだけです。以下はすべて Mac での実機確認が必要です。**

| # | 項目 | 見るポイント | 状態 |
|---|---|---|---|
| 01 | macOSでDesktop Layerを表示 | 壁紙の上に猫が出る。窓の枠・影・背景色がない | ☐ |
| 02 | Windows | 今回はスコープ外(`platform/windows.rs` はスタブ) | — |
| 03 | PNGを1枚表示 | 白フチの猫がきれいに(透過で)表示される | ☐ |
| 04 | click-through | 猫の上でも Finder / デスクトップアイコンを普通に操作できる | ☐ |
| 05 | Edit Mode | メニューで ON → 猫を掴める。OFF → また透過に戻る | ☐ |
| 06 | Sticker drag | 猫を動かせる | ☐ |
| 07 | Sticker resize | 輪郭の外側を掴んで拡大縮小 | ☐ |
| 08 | Sticker rotate | 輪郭の外側を掴んで拡大縮小+回転が同時にできる | ☐ |
| 08b | Peel Off | Option+引き離しでめくれ、離すと剥がれる / 貼り直される | ☐ |
| 09 | Placement保存 | 動かすと `~/Library/Application Support/app.peta.desktop/placements.json` が更新される | ☐ |
| 10 | 再起動後Restore | 終了 → 再起動で同じ位置・大きさ・角度 | ☐ |
| 11 | 解像度変更 | 解像度を変えても相対位置が保たれる | ☐ |
| 12 | 外部ディスプレイ | 接続で各画面にレイヤーが出る。外すとメイン画面へ退避し、再接続で元の画面へ戻る | ☐ |

### 特に注意して見てほしい点(未検証のリスク)

1. **重なり順**: 通常時、猫は壁紙の上・デスクトップアイコンの**下**に入るか。編集モードではアイコンの**上**に出るか。
   (`platform/macos.rs` のウィンドウレベル。期待通りでなければここを調整します)
2. **Spaces / フルスクリーン**: 別のデスクトップ(Space)に切り替えても猫が残るか。フルスクリーンアプリの上に出ていないか。
3. **異なるスケールのマルチディスプレイ**(Retina + 外部モニター等): 位置・サイズがずれないか。Tauri 側の座標変換が怪しい領域です。
4. **編集モードで最初のクリックが効くか**: アプリが非アクティブな状態でも掴めるか。
5. **メニューバーのアイコン**: ライト / ダークで見えるか。

## 構成

```
src/                 フロントエンド(ビルド不要の素のJS)
  placement.js         座標計算(純粋関数。tests/ で単体テスト)
  main.js / style.css  レイヤー描画と編集モード
  today.html/js/css    Today 画面(機能するプレースホルダー)
  creator.html/js/css  Cutting Mat(機能するプレースホルダー)
  collection.html/js/css  Sticker Book(機能するプレースホルダー)
  back-card.js/css     ステッカーの裏面カード(デスクトップと Collection で共有)
src-tauri/crates/core/ peta-core: OS・UIに依存しない中核(Linuxでも cargo test できる)
  db.rs                SQLite(stickers / provenance / placements)
  library.rs           DB + 画像ファイルの管理
  image_import.rs      画像の取り込み(EXIF向き・余白トリミング・縮小・PNG化)
  segment.rs           背景除去(ONNX モデルを tract で実行)
  cutout.rs            マスクの道具(エッジ吸着・ゴミ取り・穴埋め・距離場・ダイカット輪郭)
  sticker.rs           素材の描画(Matte / Kraft / Holographic)
  creator.rs           Cutting Mat のパイプラインとセッション(ブラシ補正・半解像度プレビュー)
  back.rs              ステッカーの裏面の中身(ORIGINAL / Received・来歴・日付の整形)
  book.rs              ステッカー帳(どの月のページに載るか・目次)
  daily.rs             Daily Slot(AVAILABLE→SELECTING→CONFIRMED→USED)
  materials.rs         素材カタログ(Matte / Kraft / Holographic)と抽選
src-tauri/crates/core/ の daily.rs / materials.rs: 1日1枚のルールと素材カタログ(時計を外から渡せるのでテスト可能)
src-tauri/src/
  today.rs             Today の状態・コマンド・ウィンドウ・日付変更の監視
  collection.rs        Collection ウィンドウと、裏面・ステッカー帳・素材帳・名前のコマンド
  creator.rs           Cutting Mat のウィンドウとコマンド(確定すると保存・貼り付け・今日の枠を消費)
  layers.rs            ディスプレイごとの透明レイヤー生成・再同期
  store.rs             ライブラリの所有、初回起動、旧JSONの移行、取り込み
  tray.rs              メニューバー
  platform/macos.rs    ウィンドウレベル / Space挙動(OS依存部)
  platform/windows.rs  スタブ
```

## 開発コマンド

```sh
npm test             # 座標計算の単体テスト(JS)
cargo test -p peta-core --manifest-path src-tauri/Cargo.toml   # ライブラリ層の単体テスト(Rust)
npm run check:mac    # Linux等から macOS 向けRustの型検査(要 rustup target add aarch64-apple-darwin。ObjC依存のため CC のダミー指定が必要)
```
