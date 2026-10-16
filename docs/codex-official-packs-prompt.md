# Codex への依頼: 公式パックを、アプリの更新なしで配る

**使い方**: この文書の全文を Codex に渡す。作業は **Step 順**、Step ごとにコミット。**アプリ本体(`src-tauri`)に大きく手が入るので、Mac の上で作業する**(クラウドなら §9 の分け方で)。

> 日本語で指示。コード中のコメントと UI の文言は既存に合わせて英語。説明文書は日本語。

---

# 0. 目的

今、ショップの公式パック(6種類)は、中身がアプリに固定で書かれている(`crates/core/src/pack.rs` の `market_pack`、`src/app/js/market.js` の `MARKET_PACKS`、絵は `src/art/samples/`)。中身を変える・新しいパックを足すには、アプリの更新が要る。

これを、**オーナーが新しい公式パック(絵・名前・レア度・値段・紹介文・袋の色)を作り、期間を決めて、アプリの更新なしでショップに並べられる**ようにする。

- 既存の6パックはそのまま残す(アプリに入ったまま。`shop_config` で売る・売らない・並び順は今まで通り)。
- 新しいパックは、**買うたびに同じ中身の新しい1セット**(今のショップのパックと同じ扱い。数量限定の版ではない)。
- 期間が終わったらショップから消えるが、**もう買って棚にある分は、いつでも開けられる**。

## 必ず最初に読む

`README.md`、`docs/decisions.md`、`docs/official-key-howto.md`、`docs/distribution-howto.md`(公式パック `grant-pack` の作り方)、`docs/admin-page-howto.md`、`docs/codex-admin-round2-prompt.md` と `docs/admin-round2-report.md`(`shop_config`・Featured・署名つき設定の配り方)、`docs/updater-report.md`(短命トークンでファイルを渡すやり方)、`crates/core/src/{pack,scraps,events,sign,official_keys,signed_config,db}.rs`(特に `grant_pack`、`signed_pack_items`、`pack_item_weights`、`pack_dress`、`scraps::trade` の `Kind::Pack`)、`src/app/js/{market,packs,ceremony,catalog}.js`、`crates/peta-pass`。

## 守ること

- **絵が入るものは、サーバーにある鍵(クーポン鍵 c1/c2)では署名しない**。サーバーが乗っ取られても、勝手な絵が全員のショップに並ばないように、**公式の鍵(`KEYS` の k*)で、オーナーの Mac の上だけで**署名する。**秘密鍵を Web ページ(管理ページを含む)に読ませない**(管理ページの JS が差し替えられたら盗まれるため)。
- 既存の形式・表の意味(`PETAEVNT`、`PETA1`、`KEYS` の並び、D1 の既存の表)は変えない。DB は新しいマイグレーション、D1 は `0011_…` から。
- 本番のデプロイ・秘密の登録・本物の鍵の作成はしない。dev への D1 マイグレーションとデプロイはしてよい。**`peta-api` の prod は再デプロイしない**。
- オーナーの未コミットの作業が手元にあるかもしれない(`git status` で確認)。**自分が変えたファイルだけを `git add` する**。`git stash` を戻したあとは、必ず `git diff --cached` で「コミット待ち」に余計なものがないか確かめる。

---

# 1. 全体の流れ

```
オーナーの Mac
  ① Pack Studio(ローカルの作成ツール。サーバーからではなく、リポジトリのファイルを localhost で開く)
     絵をドラッグ → 名前・レア度・重み・値段・紹介文・袋と色 → プレビュー
  ② 「Sign & upload」: peta-pass が暗号化ディスクの公式の鍵(k2)で署名 → 署名済みファイル(.peta)
     → オーナーの wrangler ログインで R2(peta-downloads-<env>/shop/…)と D1 に置く(publish-release.sh と同じ流儀)
管理ページ(Packs タブ)
  ③ 一覧・期間(開始/終了)・停止・Featured 候補への追加。期間と停止は署名し直さずに変えられる
peta-api
  ④ 今ショップに出ているパックの一覧(id・版・期間・ファイルの大きさ)を、設定の取得と一緒に返す
  ⑤ 招待済みの Mac に、署名済みファイルを短命トークンで渡す
アプリ
  ⑥ 新しいパック・版を見つけたら、ファイルを落として**公式の鍵で検証**し、絵を手元に保存
  ⑦ ショップに並べ、Scraps で買うと、棚に封をした1セットが入る。開ける・はがす・Stick it は既存のまま
```

**なぜ期間は署名しないか**: 中身(絵・名前・レア度・値段)は改ざんされると困るので公式の鍵で守る。期間と停止は「いつ並べるか」だけで、サーバーが乗っ取られても、最悪「オーナーが作った本物のパックが、決めた期間の外に並ぶ・隠れる」だけ。その代わり、オーナーは管理ページから気軽に延長・停止できる。

# 2. 署名つきファイル: 新しい種類 `shop_pack`

- `PETAEVNT` v1、`kind: "shop_pack"`、**公式の鍵(k*)だけ**で受け付ける(クーポン鍵で `shop_pack` が来たら拒否。`events::decode` のテストに足す)。`apply_event` では受け取らない(受け取り記録・受信箱に出さない)。専用の検証・保存の関数を作る。
- `payload`:
  ```json
  { "packId": "autumn-walk", "version": 1, "title": "Autumn Walk", "by": "Peta", "blurb": "…",
    "pouch": "kraft", "color": "rust", "price": 12,
    "items": [ { "key": "maple", "name": "Maple Leaf", "rarity": "common", "weight": 4 }, … ] }
  ```
  - `packId`: `safe_id`、既存の6つの id と重ならない。`version`: 1 以上の整数(同じ `packId` で中身を変えたら上げる)。`title`・`by`: 40 字、`blurb`: 120 字。`pouch`・`color`: 既存の袋と色の一覧から(`catalog.js` の `BAGS`・`PACK_COLORS` と Rust 側で同じ一覧を持つ。契約テストで一致を確かめる)。
  - `price`: Scraps の整数、**4〜40**(アプリ側の上限。既存パックの値段の幅に合わせる)。`shop_config` の 50〜200% の調整は、この値を基準に効く。無料パックは今回は作れない。
  - `items`: **3〜12 個**。`rarity` は既存の common / uncommon / rare。`weight` は 1〜100(なければ既存の等級の重み)。
- 添付: 各 `item` に PNG 1枚(`key` が添付の `key`)。**透過 PNG、縁取りなし**(フチと影はアプリが素材ごとに付ける)、長辺 1024px 以下、1枚 1.5MB 以下、合計 12MB 以下。既存の `validate_png` に加えて、この上限をアプリ側で検査する。
- 範囲外は丸ごと拒否(部分的に直して使わない)。

# 3. Pack Studio(オーナーの Mac で使う作成ツール)

- `npm run pack-studio` で起動する**ローカルだけ**の小さな Web ツール(Node の標準ライブラリか既存の依存で、`127.0.0.1` だけで待ち受け。外部の CDN・フォントは使わない)。見た目は管理ページ・アプリの紙のデザインに合わせる。
- できること:
  - 絵をドラッグ(複数)。透過していない・大きすぎる絵は、その場で理由を出す(長辺 1024px への縮小はツールがやってよい。透過の有無は直さず警告)。
  - 名前・レア度・重み・並び順、パックの題名・作者・紹介文・袋と色・値段。
  - **プレビュー**: アプリと同じ部品(`src/app/js` のステッカーの描画と袋の絵)で、ショップでの見え方と、各レア度の出る確率(%)を表示。
  - 下書きの保存と読み込み(`~/Peta-packs/<packId>/` のようなリポジトリの外。絵と `pack.json`)。
  - **Sign & upload**: 公式の鍵ファイルのパス(暗号化ディスク)と、行き先(dev / prod)を選ぶ → `peta-pass shop-pack`(§3.1)で署名 → 結果を検証 → `wrangler` で R2 にファイル、D1 に行を入れる(期間はまだ空 = 下書き。並べるのは管理ページで)。**秘密鍵は Node のプロセスも読まない**(パスを `peta-pass` に渡すだけ)。
- `peta-pass shop-pack --key <path> --key-id k2 --dir <folder> --out <file>`: §2 の検査をして署名。既存の `grant-pack` の作りを参考に。
- dev では公開済みのテスト鍵 k1 で署名できる(手順書に、テスト用で本番には使えないことを書く)。

# 4. サーバー(`peta-api`)と管理ページ(`peta-admin`)

- D1 `0011_shop_packs.sql`: `shop_packs(pack_id TEXT, version INTEGER, title TEXT, file TEXT, size INTEGER, sha256 TEXT, starts_at INTEGER, ends_at INTEGER, created_at INTEGER, stopped_at INTEGER, PRIMARY KEY(pack_id, version))`。
- `peta-api`: 設定の取得(`/v1/config` など今の窓口)に、**今並んでいるパック**(期間内・停止していない・各 `pack_id` の最新版)の `{packId, version, size, sha256}` を足す。ファイルは `/v1/shop-pack/<token>` で、アプリ内更新と同じ**10分・その Mac 専用・ハッシュで保存**のトークンで渡す。招待が必須の環境では招待済みの Mac だけ。
- 管理ページ「Packs」タブ: 一覧(下書き / 予定 / 販売中 / 終了 / 停止)、ファイルの中身の表示(絵のサムネイル・名前・レア度・値段。**`blob:` の画像とプレーンテキスト**)、期間の設定(開始・終了。終了なしも可)、停止、`shop_config` の Featured 候補・並び順に**新しいパックも選べる**ようにする。**管理ページでは署名しない・中身を変えない**(中身を変えたいときは Pack Studio で版を上げる)。
- R2 の容量の表示(公開の古い版の片付けは、販売していない古い `version` を確認つきで消す。棚にある分はアプリ側に絵が保存されているので、サーバーから消しても困らない)。

# 5. アプリ

- 取得(`server` feature): 設定の取得のついでに一覧を受け取り、手元にない `{packId, version}` だけファイルを落とす。**公式の鍵で検証してから**、絵を `shop/<packId>/<version>/<key>.png` に保存し、中身を DB に記録(新しいマイグレーション。既存の表の意味は変えない)。検証に失敗したら捨てる。
- ショップ(`market.js`): 既存の6パックと、**今並んでいる**新しいパックを一緒に表示。Featured・並び順・売る売らない・値段の調整(`shop_config`)は両方に効く。絵は保存した PNG を使う(アプリ同梱の `A[key]` ではなく)。
- 買う(`scraps::trade` の `Kind::Pack`): 新しいパックなら、`pack_items` と `signed_pack_items`(保存した PNG の参照・名前・レア度)と `pack_item_weights` で1セットを棚に入れる。値段は §2 の `price` に `shop_config` の調整をかけたもの。**画面の値段と実際に引かれる Scraps は同じ関数から**(既存と同じ)。封をした数の上限(100)も既存のまま。
- 期間が終わったパック: ショップから消えるが、棚にある封をした分は開けられる。**棚にある分が使う絵は消さない**。
- 通信しない版(offline)と、検証できなかったとき: 既存の6パックだけ。
- ステッカーの扱い(所有・台帳・Gift・Collection)は、既存のショップのパックから出たステッカーと同じにする。違いが出るなら報告に書く。

# 6. 公式の鍵 k2

- オーナーはまだ本物の公式の鍵を作っていない(`docs/official-key-howto.md`)。`KEYS` の k2 は空。
- 手順書に、**k2 を作る → 公開鍵を `official_keys.rs` の `KEYS` の末尾に `("k2", Some(…))` で入れる → その版のアプリを配る(アプリ内更新で届く)→ その後に本番のパックを出す**、の順を書く。k2 が入っていない版のアプリは、本番のパックを並べない(検証できないので無視する)。
- 鍵ファイルは `peta-pass keygen` の形式(32 バイトの生の鍵)。暗号化ディスクに置く(更新用の鍵と同じディスクでよい)。

# 7. Step

1. Rust: `shop_pack` の検証と保存、公式の鍵だけ、上限、契約テスト(袋と色の一覧)。`peta-pass shop-pack`。
2. アプリ: 取得・保存・ショップへの表示・買う・棚・期間切れ(偽のサーバーのテスト、JS のテスト)。
3. `peta-api`: `0011`、一覧、トークンつきのファイル(テスト)。dev へ。
4. 管理ページ Packs タブと `shop_config` の拡張(テスト、375px)。dev へ。
5. Pack Studio(テスト: 検査・下書き・プレビュー・署名と upload は偽の wrangler で)。
6. **dev の通し確認**: テスト鍵 k1 で Pack Studio から1パック作って dev に置き、管理ページ dev(Access は空のまま 403 なので、確認用の手順で D1 を直接更新してよい)で期間を設定 → Peta Developer のショップに並ぶ → 買う → 開ける → 期間を終わらせる → ショップから消え、棚の分は開ける。
7. 手順書 `docs/official-packs-howto.md`(k2 の作り方と順番、Pack Studio の使い方、絵の作り方の目安、管理ページでの期間と停止、片付け、うまくいかないとき)。`docs/admin-page-howto.md`・`docs/release-day-runbook.md` から短くリンク。報告 `docs/official-packs-report.md`。

# 8. テスト(各 Step の終わりに全部)

```bash
cd cloudflare/peta-api && npm test && npx tsc --noEmit
cd cloudflare/peta-download && npm test && npx tsc --noEmit
cd cloudflare/peta-admin && npm test && npx tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml --workspace --features server
cargo test --manifest-path src-tauri/Cargo.toml --workspace
cargo test --manifest-path src-tauri/crates/core/Cargo.toml --features developer --test official_trust
npm test
python3 scripts/test-release-mac.py
```

ディスクが少ない Mac なので、Rust は `CARGO_INCREMENTAL=0` などで軽くし、終わったら `npm run clean:target`。報告に空き容量を書く。

# 9. クラウドでやる場合

アプリ本体は Mac でしかビルド・テストできない。クラウドでは **Step 3・4・5 と Step 1 の `peta-pass`(Linux でも動く部分)** だけを行い、Step 2 と 6 は Mac に残す。報告に「Mac で未テスト」を明記する。

# 10. 受け入れ条件

- Pack Studio で作ったパックが、管理ページで期間を決めると、Peta Developer のショップに**アプリの更新なしで**並び、買って開けられる。
- 公式の鍵で署名していない・クーポン鍵で署名した・改ざんした・上限外のファイルは、アプリが並べない。
- 秘密鍵は Web ページにも Node のプロセスにも読まれない(`peta-pass` だけが読む)。
- 期間切れ・停止でショップから消えても、棚の分は開けられる。
- 画面の値段と引かれる Scraps が一致する。offline 版は既存の6パックだけ。
