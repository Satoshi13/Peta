# Codex への依頼: Boards の裏側(保存・切り替え・画面の記憶・Auto・購入・メニューバー)

**使い方**: この文書の全文を Codex に渡す。**実装の指示**(Rust・JS)。作業は **Step 順**。各 Step の終わりに `cargo test --manifest-path src-tauri/Cargo.toml --workspace`(既定と `--features developer`)と `npm test` を通し、**Step ごとにコミット**する(core のルール・アプリ・UI は別コミット)。

> 日本語で指示。コード中のコメントと UI の文言は、既存に合わせて**英語**。説明文書は日本語。

**仕様の本体は [`docs/boards-plan.md`](../../boards-plan.md)**(最初に全部読む)。決定の記録は `docs/decisions.md` の「Boards」「Scraps の経済」の行(2026-10-12〜13)。食い違ったら**本書と現行コード**を優先し、報告に書く。

**いまの状態**: 画面は `src/app/js/boards.js` / `src/app/css/boards.css` にできている(開発者版だけ、サイドバーの Boards)。中身は `BD` の**見本のデータ**で、保存も貼り付けもしていない。Market の Tools の `Board ×1` も見本の動き(Scraps を減らさない)。**この依頼で、見本を本物のデータと処理に置き換える。見た目は変えない**(必要な最小限の変更だけ。変えたら報告に書く)。

---

# 0. 範囲

## やること

1. DB **V15**: Board と Auto のきまり、台紙の所持数。
2. core: Board の保存・上書き・名前変更・削除、画面への貼り付け(切り替え)と Undo、取り込み(外した画面のステッカーを今の画面へ)。
3. core: Scraps の道具に **Board ×1(12 Scraps)** を足す。
4. アプリ: **画面の記憶 = 今の `placements` そのもの**。つながっていない画面のステッカーは、メインの画面に寄せずに**しまう**(描かない)。つなぎ直すと戻る。
5. アプリ: Auto(時間帯・場所)の判定と実行。場所は Wi‑Fi の名前(位置情報の許可が要る)。
6. アプリ: メニューバーの `Boards ▸`。
7. UI: `boards.js` の見本を本物のコマンドにつなぐ。Market の `Board ×1` を本物の購入にする。
8. 仕上げ: 開発者版だけの制限を外し、**配布版にも出す**(サーバー不要のローカル機能のため)。
9. ドキュメントと報告 `docs/archive/reports/boards-report.md`。

## やらないこと

- Board の共有・友達への公開。Board ごとの壁紙。カレンダー連動。
- サーバー・Scraps のサーバー管理。
- 見た目の作り直し(デザインは決定済み)。

---

# 1. 共通ルール

- 作業前に `README.md`、`docs/boards-plan.md`、`docs/decisions.md`、`src-tauri/crates/core/src/{db.rs,scraps.rs,link_tag.rs,models.rs,library.rs}`、`src-tauri/src/{layers.rs,lib.rs,store.rs,tray.rs,today.rs,collection.rs}`、`src/placement.js`、`src/app/js/{boards.js,market.js,shell.js,catalog.js,bridge.js}` を読む。
- **スキーマ変更は V15 だけ**。`SCHEMA_VERSION` を 15 にし、**V14 → V15 のマイグレーションのテスト**(既存データの保持)を書く。V1〜V14 の SQL は変えない。
- 配置の意味は今のまま: `relative_x/y` は画面に対する中心の割合、`relative_scale` は**ステッカーの幅 ÷ 画面の幅**、`rotation`、`z`(`src/placement.js` の説明どおり)。Board も同じ値で覚える。
- **1枚のステッカーは同時に1か所にしか貼れない**(`placements` の主キーが `sticker_id` のまま)。
- 貼り付けは **Print → Grab → Paste を通さない**。**今日の1枚(`daily`)に数えない。Scraps も動かない**(購入を除く)。印刷待ちの列は触らない。リンクタグは付いたまま。
- まとめて変える処理は **1つのトランザクション**。途中で失敗したら全部元のまま。
- 変更したルールは `README.md` と `docs/decisions.md`(日付は作業日)に追記。実機確認が要る項目は `docs/port-spec/macos-checklist.md` に追記。

---

# 2. Step 1: DB V15 と core のルール

## 2.1 表

- `boards(id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
- `board_items(board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, sticker_id TEXT NOT NULL REFERENCES stickers(id) ON DELETE CASCADE, relative_x REAL, relative_y REAL, relative_scale REAL, rotation REAL, z INTEGER, PRIMARY KEY(board_id, sticker_id))`
- `board_rules(id TEXT PRIMARY KEY, sort INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('time','place')), days INTEGER NOT NULL DEFAULT 0, start_min INTEGER, end_min INTEGER, wifi TEXT, display_id TEXT NOT NULL, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, enabled INTEGER NOT NULL DEFAULT 1)`(`days` は月〜日のビット。`start_min`/`end_min` は 0〜1439)
- `meta`: `boards.owned`(持っている台紙の数。**V15 で 2 を入れる**)、`boards.undo`(直前の配置。§2.3)。
- 列名・制約は既存の流儀に合わせて調整してよい(報告に書く)。

## 2.2 台紙の数

- **白紙 = 持っている数 − Board の数**。保存すると1枚使い、**Board を消すと自動で戻る**(数え方で戻るので、戻す処理は要らない)。
- 持っている数の**上限は 12**。
- Scraps の道具に `board`(**12 Scraps**)を足す(`scraps.rs` の `TOOLS`)。買うと `boards.owned` が1増える。上限を超える購入は拒否し、Scraps も動かない。既存の `trade` と同じく受領書つきで、再送しても二重に買わない。開発者版の `unrestricted`(無料)は今のリンクタグと同じ扱い。

## 2.3 操作(`Database` のメソッドとして。名前は流儀に合わせてよい)

- `board_save(display_id, name) -> Board`: その画面に**今貼ってある**ステッカー(`is_on_desktop=1` かつ `display_id` が一致)を写す。0枚なら拒否(`nothing_to_save`)。白紙が0なら拒否(`no_blank_board`)。名前は `clean_title` 相当で 1〜24 文字。
- `board_update(id, display_id)`: その画面の今の配置で上書き(**無料**)。
- `board_rename(id, name)`、`board_delete(id)`(その Board の Auto のきまりも消える。台紙は数え方で戻る)。
- `board_put(id, display_id, connected: &[display_id]) -> PutResult`:
  1. その画面の今の配置を `boards.undo` に保存(画面ID・配置の一覧・時刻。**1つだけ**、前の Undo は上書き)。
  2. その画面に貼ってあるステッカーを全部はがす(`peel` と同じ。ステッカーは Collection に残る)。
  3. Board の各ステッカーを貼る。**飛ばすもの**: 手元にない(`state` が `held` でない)、**ほかの画面に貼ってある**(つながっている画面でも、しまってある画面でも。動かさない)。
  4. 返り値: 貼った数、飛ばした数とその理由(`not_yours` / `on_another_screen`)。
  5. 全部を1つのトランザクションで。
- `board_undo() -> Option<...>`: `boards.undo` の画面を、保存した配置に戻す(その時点で手元にないもの・ほかの画面にあるものは飛ばす)。戻したら `boards.undo` を消す。
- `board_bring_here(from_display, to_display)`: しまってある画面のステッカーを、今の画面に同じ割合の位置で移す(画面IDが変わってステッカーが戻らないときの逃げ道)。
- `boards_status(connected, primary)`: 画面の一覧(つながっている画面と、ステッカーが残っている画面。しまってあるかどうか、今の配置、**今の配置と一致する Board**)、Board の一覧(名前・配置・各ステッカーの `held`/`gone`・ほかの画面にあるか)、きまりの一覧、台紙の数(`owned`・`available`・上限)、Undo できるか(画面名つき)。
- きまり: `board_rule_save(rule)`(新規/更新。検証: 曜日が1つ以上、開始と終了が別、Wi‑Fi 名は 1〜64 文字、画面と Board が実在)、`board_rule_delete(id)`、`board_rule_move(id, up|down)`、`board_rule_toggle(id)`。

## 2.4 一致の判定

画面の配置と Board が「同じ」とは、ステッカーの集合が同じで、各ステッカーの位置・大きさ・角度の差が小さい(例: 位置 ±0.5%、大きさ ±1%、角度 ±1°)こと。重なり順は見ない。

## 2.5 テスト(core)

V14 → V15(既存データ・`boards.owned=2`)。保存で白紙が減る、0枚・白紙0・名前不正の拒否。削除で白紙が戻る、きまりも消える。購入で `owned` +1、上限 12、Scraps 不足・上限超えで何も変わらない、再送で二重に買わない。貼り付け: 全部はがして貼る、手元にない・ほかの画面にあるものを飛ばす、Undo で戻る、途中失敗で元のまま。ステッカーを削除すると Board から消える(`gone` は残る)。一致の判定の許容。`bring_here`。

---

# 3. Step 2: 画面の記憶(しまう・戻す)

- `layers.rs` の `placements_for` は今、**つながっていない画面のステッカーをメインの画面に寄せて描いている**(`display_id` は書き換えない)。これを**寄せずに描かない**(しまう)に変える。`display_id` は今までどおり書き換えないので、つなぎ直すと元の画面に戻る。
- 新しく貼るステッカー(印刷から貼る、開発者ツール)は今までどおり今の画面に入る。
- **逃げ道**: 画面の名前が変わって(OS の更新・同じ機種の入れ替え)ステッカーが戻らない場合のために、Boards のページのしまってある画面に `Bring them here`(§2.3 の `board_bring_here`)を出す。
- 画面のつなぎ外しで、`layers` の作り直しとあわせて `boards-changed` を送る(Boards のページとメニューバーを更新するため)。
- 既知の弱点(画面IDが名前ベース。`assign_display_ids` の `TODO(phase 1)`)は今回直さなくてよい。報告に書く。

---

# 4. Step 3: アプリのコマンドと UI をつなぐ

- `src-tauri/src/boards.rs`(新規)に Tauri コマンド: `boards_status`、`boards_save`、`boards_update`、`boards_rename`、`boards_delete`、`boards_put`、`boards_undo`、`boards_bring_here`、`board_rule_save`、`board_rule_delete`、`board_rule_move`、`board_rule_toggle`。つながっている画面・メインの画面は `layers` から渡す。画面の種類(`laptop` / `display`。内蔵ディスプレイの名前で判定してよい)と縦横比も返す。変更のあとは既存の `placements-changed` と、新しい `boards-changed` を送る。
- `boards.js`: `BD` の見本を、`boards_status` の結果に置き換える。
  - 画面とBoardの絵: いまは `A[k]`(見本の絵)を使っている `BoardLook` を、**ステッカーの縮小画像**(`Bridge.thumb(stickerId)`)で描くように変える。幅は `relative_scale`(画面の幅に対する割合)、位置は `relative_x/y`、角度は `rotation`、重なりは `z`。
  - 手元にないステッカー・ほかの画面にあるステッカーは、今の点線の影のまま(`No longer yours` / `On another screen`)。
  - 「Preview · sample stickers…」の注記を消す。
  - Undo の知らせ、保存・名前変更・削除・きまりのダイアログは今の見た目のまま、本物のコマンドを呼ぶ。エラーは英語の短い文言で。
- `market.js` の `Board ×1`: 本物の購入(`scrap_trade` の `tool`/`board`)。値段は `scrap_status` の `tools` から読む(JS に 12 を書かない)。上限に達していたら `You have all 12 boards.`、足りなければ `Not enough Scraps`。`Blank boards` の数は本物。
- `tests/*.test.mjs`: 状態から画面を作る部分(一致のチェック、点線の影、0枚の案内、上限)をテストする。

---

# 5. Step 4: Auto(時間帯・場所)

## 5.1 判定のきまり(**純粋な関数として core に置き、テストする**)

- **時間帯**: その日の曜日がきまりの曜日に入っていて、今が開始〜終了の間(終了が開始より前なら日をまたぐ)のとき、**その日にまだ実行していなければ1回だけ**貼る。Mac がスリープしていて 9:00 を逃しても、9:30 に起きた時点で窓の中なら貼る。窓の外になったら何もしない(元に戻さない)。
- **場所**: Wi‑Fi の名前が、そのきまりの名前に**変わったとき**(アプリ起動時にすでにその名前なら、それも「変わった」に数える)に1回貼る。別の名前か切断になったら、次につないだときにまた貼れる。
- **同じ画面に2つ以上が同時に当てはまったら、一覧で上のきまりが勝つ**。
- **手で変えたら、次の「始まり」まではそのまま**(上のきまりで自然にそうなる。実行済みの記録は `meta` に日付つきで残し、再起動しても二重に貼らない)。
- 画面がつながっていない、Board が消えた、きまりがオフ → 何もしない。
- 実行は §2.3 の `board_put` と同じ(Undo も効く)。

## 5.2 実行の仕組み(アプリ)

- **有効なきまりが1つ以上あるときだけ**、1分ごとに確認する(なければタイマーを動かさない)。起動時・スリープ復帰時・画面のつなぎ外しの時にも1回確認する。
- 貼ったら知らせを出す: `It's 9:00 — put “Work day” on Studio Display` / `Home Wi‑Fi — put “Autumn” on MacBook Pro`(窓が出ていなければ、既存の `Scraps.note` と同じく次に窓が前に出たとき)。

## 5.3 Wi‑Fi の名前と許可

- Wi‑Fi の名前は CoreWLAN(`CWWiFiClient`)で読む(既存の `objc2` の流儀で)。**macOS 14 以降は位置情報の許可がないと名前が読めない**ので、`CLLocationManager` で許可を求める。
- **許可を求めるのは、場所のきまりを初めて作るときだけ**(Boards のダイアログの説明 → `Continue` のあと)。それ以外では求めない。拒否されたら、場所のきまりは保存できるが動かない旨をダイアログと一覧に出す(`Location is off for Peta`)。
- Info.plist に `NSLocationWhenInUseUsageDescription`(例: `Peta uses your Wi‑Fi name to switch boards where you choose. It never leaves this Mac.`)を足す(Tauri v2 の Info.plist の足し方で)。
- Wi‑Fi の名前・位置は**保存しない・外に出さない**(きまりに書いた名前だけを DB に持つ)。
- 確認は1分ごと(場所のきまりがあるときだけ)。通知の仕組みに置き換えられるなら、それでもよい。

---

# 6. Step 5: メニューバー

`tray.rs` に `Boards ▸`:
- 画面が2つ以上なら画面ごとの小見出し(押せない項目)、その下に Board の名前(その画面で一致しているものにチェック)。押すとその画面に貼る。
- 区切り、`Undo`(Undo できるときだけ有効)、`Save this screen as a board…`(窓を開いて Boards の保存ダイアログを出す。画面はメインの画面)、`Open Boards…`。
- Board・画面・Undo が変わったら作り直す(`boards-changed`)。

---

# 7. Step 6: 仕上げ

- `catalog.js` の Boards の `dev: true`、`market.js` の `Board ×1` の開発者版だけの条件、`boards.js` の見本(`BD.seed`)を外す。**配布版にも出す**。
- `README.md`、`docs/decisions.md`、`docs/boards-plan.md`(実装済みの印)、`docs/port-spec/macos-checklist.md` を更新。
- 報告 `docs/archive/reports/boards-report.md`(日本語): 作ったもの、本書と違う判断とその理由、守れないこと(画面IDの弱点など)、オーナーが実機で確かめる項目。

---

# 8. 受け入れ条件

- [ ] `cargo test --workspace`(既定と `--features developer`)と `npm test` が通る。
- [ ] 画面に貼ったステッカーを Board に保存でき、白紙が1枚減る。消すと戻る。上書きは無料。
- [ ] Board を別の画面・同じ画面に貼れる。ほかの画面にあるもの・手元にないものは飛ばされ、点線の影と知らせが出る。Undo で戻る。今日の1枚と Scraps は動かない。
- [ ] モニターを外すとその画面のステッカーが消え(メインに寄らない)、つなぎ直すと戻る。`Bring them here` で今の画面に移せる。
- [ ] Market で `Board ×1` を 12 Scraps で買え、上限 12 で止まる。
- [ ] 時間帯のきまりが、窓に入った最初の確認で1回だけ動く。手で変えたら次の始まりまでそのまま。再起動しても二重に動かない。
- [ ] 場所のきまりは、許可したあとに Wi‑Fi が変わったとき1回動く。許可しなければ動かず、そう表示される。
- [ ] メニューバーの `Boards ▸` から貼れて、チェックが合っている。
- [ ] 配布版でも Boards と `Board ×1` が出る。

**実機でしか確認できないこと**(オーナーがやる): 2台の画面でのつなぎ外し、スリープ復帰での時間帯のきまり、Wi‑Fi の切り替えと位置情報の許可のダイアログ、メニューバー。
