# Peta — One sticker a day.

毎日、ひとつだけ。デスクトップに残る、ステッカーのある暮らし。

現在は **Phase 2: Daily**(macOS のみ)。Desktop Layer(Phase 0)と SQLite のステッカーライブラリ(Phase 1)の上に、
**1日1枚のルール**、Today's Material、素材のアンロックが載っています。背景除去・素材の見た目・Collection 画面はまだありません。
画像生成が必要な演出は未着手で、引き継ぎ資料は [docs/ui-handoff.md](docs/ui-handoff.md) にあります。

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
| Edit Stickers | 編集モードのON/OFF。Esc / 画面上部の Done でも終了 |
| Re-sync Displays | ディスプレイ構成を再読込(通常は2秒ごとに自動検知) |
| Quit Peta | 終了 |
| **Developer ▸**(デバッグビルドのみ) | 下の表 |

**Developer メニュー**(`npm run dev` のときだけ表示。リリースビルドには出ません)

| 項目 | 動作 |
|---|---|
| Add Image… (ignores daily rule) | 画像を選んで貼る。**1日1枚のルールを無視**する(Phase 1 の挙動) |
| Add Sample Cat (ignores daily rule) | サンプルの猫を貼る(同上) |
| Next Day (+1 day) | 時計を1日進める。日付変更・新しい素材の抽選・スロットのリセットを確かめる |
| Reset Today | 今日の記録を消す。封筒・抽選・スロットが最初からやり直しになる(貼ったステッカーは残る) |

### 1日1枚のルール

- 今日の素材は日付ごとに1つ抽選され、**初回だけは必ず Holographic**(仕様 §88 の体験)。以降は Common 60 / Uncommon 30 / Rare 10 の重み。
- **封筒を開ける**と素材が Material Book に入り、ずっと残ります(使い捨てではありません)。Matte は最初から使えます。
- 今日の新しい1枚を**確定できるのは1回だけ**。Today 画面から **Create**(画像を選ぶ)か **Collection**(デスクトップに無いものを貼る)。
  **編集モード中に画像ファイルをデスクトップへドロップするのも Create** です(その日の素材で作られます)。2回目は「See you tomorrow.」と断られます。
- 素材を眺める・Today 画面を開く・画像ダイアログをキャンセルする、では消費しません。移動・拡大縮小・回転・剥がす・貼り直しは何度でも。
- 日付はローカル時間の 0:00 で切り替わります(起動したままでも、30秒以内に検知)。

### 編集モードの操作

枠や取っ手はありません。ステッカー自体が反応します(透明な部分は掴めません)。

| 操作 | 動作 |
|---|---|
| 中心寄りをドラッグ | 移動(持ち上がり、離すと「ペタッ」と貼り直される) |
| **輪郭の外側寄りをドラッグ** | 角をつまんで引くように、**拡大縮小と回転が同時に**かかる(カーソルが回転マークに変わる) |
| トラックパッドのピンチ / ひねり | 拡大縮小 / 回転(同時可。WebKit のジェスチャーイベント) |
| **Option を押しながらドラッグして引き離す** | 掴んだ側がめくれる。十分に引いて離すと**剥がれて消える**。途中で離すと貼り直される |
| Delete / Backspace | ポインター下のステッカーを剥がす |

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
src-tauri/crates/core/ peta-core: OS・UIに依存しない中核(Linuxでも cargo test できる)
  db.rs                SQLite(stickers / provenance / placements)
  library.rs           DB + 画像ファイルの管理
  image_import.rs      画像の取り込み(余白トリミング・縮小・PNG化)
  daily.rs             Daily Slot(AVAILABLE→SELECTING→CONFIRMED→USED)
  materials.rs         素材カタログ(Matte / Kraft / Holographic)と抽選
src-tauri/crates/core/ の daily.rs / materials.rs: 1日1枚のルールと素材カタログ(時計を外から渡せるのでテスト可能)
src-tauri/src/
  today.rs             Today の状態・コマンド・ウィンドウ・日付変更の監視
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
