# Codex への依頼: 毎日の封筒の素材の確率を、オーナーの管理ページから変える

**使い方**: この文書の全文を Codex に渡す。**実装の指示**(Rust、TypeScript の Worker、管理ページの HTML/CSS/JS)。作業は **Step 順**。各 Step の終わりに §7 のテストをすべて通し、**Step ごとにコミット**する。

> 日本語で指示。コード中のコメントと UI の文言は、既存に合わせて**英語**。説明文書は日本語。

---

# 0. 目的

今、毎日の封筒(Today's Material)から出る素材は、アプリに固定で書かれている(`crates/core/src/materials.rs` の `draw`: Matte・Kraft・Holographic の3種類だけ、レア度の重み 60/30/10、初日は必ず Holographic)。

これを、**オーナーが管理ページ(`cloudflare/peta-admin`)から変えられる**ようにする。

1. **通常の確率表**: どの素材を封筒に入れるか(アプリに入っている素材から選ぶ。入れる・外すが「追加・削除」)と、それぞれの重み。
2. **期間限定の確率表(イベント)**: 開始・終了の日時つき。期間中は通常の表の代わりに使い、終われば通常に戻る。重なったら開始が遅いほうを優先。
3. 通信できないとき、通信しない版(offline)、まだ表を受け取っていないときは、**今の固定の表(60/30/10)**のまま。

**「まったく新しい素材」(新しい紙・絵・質感)は対象外**。素材ごとにアプリ側の描画コード(`sticker.rs` の `Substrate`、`src/app/js/sticker.js`)、カードやスウォッチの絵、Scraps のレートがあるため、アプリの更新が必要。代わりに、新しい素材をアプリに足す手順書(§6)を書き、**アプリに足された素材は管理ページの選択肢に自動で出る**ようにする(§3.3 の契約ファイル)。

## 必ず最初に読む

`docs/codex-admin-page-prompt.md` と `docs/admin-page-report.md`(管理ページとクーポン鍵の設計)、`docs/coupon-howto.md`、`crates/core/src/{materials,daily,events,official_keys,scraps}.rs`、`src-tauri/src/{coupon,invite,referee_access}.rs`、`cloudflare/peta-api/src/{index,coupons}.ts`、`cloudflare/peta-admin/src/{index,coupons,bundle}.ts` と `test/coupon-vector.json`。

## 守ること

- 既存の表・形式(`PETAEVNT`、`PETA1`、`KEYS` の並び、D1 の既存の表の意味)は変えない。D1 は新しいマイグレーション `0008_daily_tables.sql` だけ。
- **その日の素材は、その日に最初に決まったものから変えない**(`daily_records` に書いた後は不変)。表の変更は「まだ決まっていない日」から効く。
- **初日は必ず Holographic**(`FIRST_DRAW_MATERIAL`)は変えない。
- 本番のデプロイ・秘密の登録はしない(オーナーが手順書で行う)。dev への D1 マイグレーションとデプロイはしてよい。**`peta-api` の prod は再デプロイしない**(招待の必須化が有効になるため。オーナーの指示を待つ)。

---

# 1. 確率表の形と、アプリ側の上限

```json
{ "tableId": "daily-20261020-halloween", "items": [ { "id": "matte", "weight": 50 }, { "id": "kraft", "weight": 25 }, { "id": "holographic", "weight": 15 }, { "id": "riso", "weight": 10 } ] }
```

- `id` はアプリの `materials::catalog()` にある素材だけ。`weight` は 1〜1000 の整数。1〜20 種類、重複なし。確率は重みの比。
- **アプリ側の上限**(`materials.rs` に定数で置き、Rust のテストで固定する。オーナーが後でアプリの更新で変えられる):
  - Matte の割合は **20% 以上**(封筒を開けても何も作れない日を作らない)。
  - レア度 `Special`・`Archive` の素材(Gold・Vintage・Sakura)は、**それぞれ 5% 以下**。
  - 範囲外の表は**丸ごと無視**して固定の表を使う(部分的に直して使わない)。理由をログではなく `meta` に1行残し、Developer の画面で見られるとよい。

# 2. 配り方(署名つき)

- 新しいイベントの種類 **`daily_table`** を `PETAEVNT` に足す。ヘッダーは既存の `events::Event` と同じ(`notBefore`/`notAfter` に期間。通常の表は `notBefore` = 公開時刻、`notAfter` = 公開から 400 日)。`payload` が §1 の JSON。添付なし。
- 署名は**クーポン鍵**(prod `c2`、dev `c1`)。`events::decode` の「クーポン鍵は bundle だけ」を「**bundle と daily_table だけ**」に広げる。公式の鍵 `k*` でも受け付けてよい(手元の `peta-pass` でも作れるように、`--kind daily_table --item matte=50 …` を足す)。
- **`daily_table` は `apply_event` で受け取る物ではない**(受け取り記録・once per Mac・受信箱に出さない)。専用の `daily::accept_table(db, verified, now)` で検証して保存するだけ。

## 2.1 サーバー(`cloudflare/peta-api`)

- D1 `0008_daily_tables.sql`: `daily_tables(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('default','event')), starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, event TEXT NOT NULL, created_at INTEGER NOT NULL, stopped_at INTEGER)`。
- `GET /v1/daily-table`(既存の署名つきリクエスト。招待が必須の環境では招待済みの Mac だけ): **今有効な表と、これから始まるイベント**(最大 10 件、開始順)を `{ "tables": [base64 の event, …] }` で返す。有効な通常の表(`kind='default'` の最新で停止していないもの)を必ず含める。なければ空。
- 1年での自動削除(`sweepRecords`)に、`ends_at` か `stopped_at` から1年たった行を足す。テスト。

## 2.2 アプリ(`server` feature)

- 起動時とアプリのウィンドウが前に来たとき(`referee_access::kickoff` と同じきっかけ。ただし友達がいなくても行う)、**6時間に1回まで** `/v1/daily-table` を取りに行き、受け取った表を検証して `meta` に保存(通常の表1つ + イベント最大10件)。通信の失敗は黙って前の保存分を使う。
- `materials::draw(roll, first_ever)` を `draw(roll, first_ever, table: Option<&DailyTable>)` に。`ensure_today` / `ensure_today_in` は、**その日の素材を決める瞬間の時刻**で有効な表(イベント優先、なければ通常、なければ固定)を選ぶ。どの表を使ったかを `daily_records` に残す必要はない(残すなら新しい列で、既存の意味は変えない)。
- offline 版はこの通信のコードを含めない(既存の `server` feature の流儀)。

# 3. 管理ページ(`cloudflare/peta-admin`)

## 3.1 Daily タブ

- **通常の表**: アプリの素材の一覧(§3.3)を、名前・レア度・スウォッチの色つきで並べ、「封筒に入れる」チェックと重みの入力。右に**確率(%)**を即時表示。§1 の上限を超えたら赤で理由を出し、保存できない。
- **イベント**: 名前、開始・終了(端末の時間帯で入力、保存は UTC)、同じ表の編集部品。一覧に状態(予定 / 開催中 / 終了 / 停止)と「停止」ボタン。
- **見込み**: 表ごとに「1人が1週間で受け取る素材の内訳の期待値」と「それを全部 Scraps に分解したときの期待値」(`scraps.rs` の dismantle レートを契約ファイルから)を表示。経済への影響が分かるように。
- 保存すると、Worker がクーポン鍵で `daily_table` に署名して `daily_tables` に入れる(クーポンと同じ `signBundle` の流儀。共通化してよい)。`admin_log` に記録。
- 「今のアプリが使っている表」(固定の 60/30/10)も見せ、「通常の表を消して固定に戻す」もできる(`stopped_at`)。

## 3.2 反映の説明

画面に「Changes apply from each friend's next new day, after Peta checks in (within about 6 hours). Today's material doesn't change.」の一文。

## 3.3 素材の契約ファイル

- Rust のテストが `materials::catalog()`・レア度・§1 の上限・`scraps.rs` の dismantle レートを `cloudflare/peta-admin/test/materials-vector.json` と照合する(クーポンの `coupon-vector.json` と同じやり方。ずれたらテストが落ち、ファイルを更新する手順をエラーに出す)。
- 管理ページはこのファイル(ビルド時に取り込む)から選択肢と上限を作る。**アプリに素材を足したら、このファイルを更新して管理ページを再デプロイすれば、選択肢に出る**。

# 4. Step

1. Rust: `daily_table` の検証・上限・保存・`draw` の切り替え・期間の選択(テスト: 上限の内外、Matte 20%、Special/Archive 5%、未知の素材、重複、期間の境界、イベント優先と重なり、初日の Holographic、その日の素材が変わらないこと、表がないときの固定)。`peta-pass` の `--kind daily_table`。
2. Rust ↔ Worker の契約ファイル(§3.3)と、Worker での `daily_table` の署名(既存の `coupon-vector.json` に `daily_table` の例を足すか、別のベクトル)。
3. `peta-api`: `0008`、`GET /v1/daily-table`、自動削除(テスト: 有効な表とこれからのイベントだけが返る、停止・終了は返らない、招待必須のとき未招待は 403)。
4. アプリの取得(`server` feature。偽のサーバーでテスト: 取得・6時間の間隔・失敗時は前の保存分・壊れた表は無視)。
5. 管理ページの Daily タブ(§3.1、§3.2)。375px のスマホ幅も確認。
6. 手順書: `docs/daily-table-howto.md`(使い方、上限、反映のタイミング、経済の見方、dev での試し方)と **`docs/new-material-howto.md`(§6)**。`docs/admin-page-howto.md` からリンク。dev へ D1 マイグレーションとデプロイ(`peta-api` dev と `peta-admin` dev)。報告 `docs/daily-table-report.md`(オーナーがやること: prod の D1 マイグレーション、`peta-admin` prod の再デプロイ、`peta-api` prod はオーナーの指示で配布の日にまとめて)。

# 5. やらないこと

- まったく新しい素材の追加(絵・描画)。素材ごとの Scraps のレート変更(今回は表示に使うだけ)。封筒の数(1日1通・追加の封筒)の変更。

# 6. `docs/new-material-howto.md` に書くこと(チェックリスト)

新しい素材をアプリに足すときに触る場所をすべて、コードを読んで洗い出して書く。少なくとも: `materials.rs` の `catalog()`(id・名前・レア度・recipe)、描画(`sticker.rs` の `Substrate` と処理、`creator.rs`)、画面(`src/app/js/catalog.js`・`sticker.js`・`assets.js`)、絵(`src/art/` のカード・裏面・スウォッチ。Codex の画像生成の流れ)、Scraps のレート(`scraps.rs` の `MATERIALS`)、クーポンの上限(`grant_cap` と `coupon-vector.json`)、`PETA1` の `CODE_MATERIALS`(**末尾に追加だけ。並べ替え禁止**)、素材の契約ファイル(§3.3)、テスト。最後に「アプリの更新を配ってから、管理ページで封筒に入れる」順番。

# 7. テスト(各 Step の終わりに全部)

```bash
cd cloudflare/peta-admin && npm test && npx tsc --noEmit
cd cloudflare/peta-download && npm test && npx tsc --noEmit
cd cloudflare/peta-api && npm test && npx tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml --workspace --features server
cargo test --manifest-path src-tauri/Cargo.toml --workspace
cargo test --manifest-path src-tauri/crates/core/Cargo.toml --features developer --test official_trust
npm test
python3 scripts/test-release-mac.py
```

# 8. 受け入れ条件

- 管理ページで保存した通常の表・イベントが、dev の Peta Developer の**次の日**の封筒に反映される(Developer の「次の日にする」で確かめる。手で確かめられなければ、偽のサーバーのテストと契約テストで代え、報告に書く)。
- 上限を超えた表は、管理ページで保存できず、仮に署名済みで届いてもアプリは使わない。
- その日に決まった素材は、表を変えても変わらない。初日は Holographic のまま。
- offline 版と通信できないときは、固定の 60/30/10。
- クーポン鍵で作れるのは `bundle` と `daily_table` だけ。
