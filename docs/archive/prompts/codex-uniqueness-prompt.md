# Codex への依頼: ステッカーの唯一性(本物は移動する、複製は手元に残る)

**使い方**: この文書の全文を Codex に渡す。**実装の指示**(Rust・JS)で、画像制作・見た目のデザインではない。作業は **Step 順**。各 Step の終わりに `cargo test --manifest-path src-tauri/Cargo.toml --workspace` と `npm test` を通す。

> 日本語で指示。コード中のコメントと UI の文言は、既存に合わせて**英語**。説明文書は日本語。

**これは [`codex-edition-pack-prompt.md`](codex-edition-pack-prompt.md) の土台**(先にこちらを終える)。

**背景(決定済み、`docs/decisions.md` 2026-10-11「ステッカーの唯一性」)**:

> **本物は移動する。複製は手元に残る。**

唯一なのは**画像ではなく記録**(ステッカーのID・作者の署名つきの作成時刻・持ち主の移動の記録)。画像そのものは、いくらでも複製できるので、唯一にしない。

- **本物** = 原本(自分で作ったもの)と、パックから出た版(`#3/10`)。贈る・売る・パックに入れるときは、**持ち主が移る**(コピーしない)。**Gift は譲渡**になる(いまは「コピーを渡し、元は残り、エディション番号が付く」)。
- **複製** = 飾り用の、手元だけのコピー。何枚作っても、**贈れず・売れず・パックにも入れられず・Studio でも選べない**。
- **毎日のボーナスは「新しい画像のとき」だけ**。判定は**完全に同じファイルか**(画像の指紋)だけ。似た画像の検出はしない。
- **複製ツールは売らない**(同じ・似た画像で作り直せば足りるので防げない)。Duplicate は無料で、飾り専用。

---

# 0. 範囲

## やること

1. DB **V12**: 本物と複製の区別、作者の署名、移動の記録、画像の指紋。
2. 複製(Duplicate)の作成と、複製に対する制限(Rust 側で拒否)。
3. **Gift を譲渡に変える**(送ると、送り手の Collection からそのステッカーが消える)。新しい Gift ファイル形式(`PETAGIFT` v3)。v1 / v2 は、いままでどおり受け取れる。
4. 作成時に、画像の指紋を保存し、「新しい画像か」を返す(**Scraps のボーナスの支払いは、いまは実装しない**。呼び出しの口だけ作る)。
5. **審判役(サーバー)が後から入れられる形**にする(§6)。いまは、審判なしで動く。
6. 機能に必要な**最小限の UI**(§7)。見た目は、既存の部品に合わせる。**視覚的なデザインは別担当**なので、凝らない。
7. ドキュメントと報告。

## やらないこと

- サーバー側(友達・受信箱・審判役)。Scraps の経済(ボーナスの金額・支払い)。ツール(複製ツールは売らない決定)。
- パックの版(エディション)の仕組み。それは `codex-edition-pack-prompt.md` で行う。**ただし**、この Step で作る「本物 / 複製」の形が、そちらでそのまま使えるようにする。
- Gift の見た目(封蝋・包みの意匠)の変更。

---

# 1. 共通ルール

- 作業前に `README.md`、`docs/decisions.md`(Gift・Pack・リンクタグ・「ステッカーの唯一性」の行)、`docs/gift-inbox-plan.md`、`src-tauri/crates/core/src/{db.rs,models.rs,gift.rs,sticker.rs,library.rs,sign.rs,link_tag.rs}`、`src-tauri/src/{gifts.rs,collection.rs,creator.rs,today.rs}`、`src/app/js/{studio.js,book.js}` を読む。
- **変えてよいスキーマ変更は V12 だけ**。V1〜V11 の SQL の意味は変えない。**`SCHEMA_VERSION` を 12 にし、V11 → V12 のマイグレーションのテスト**(既存データの保持)を書く。既存のステッカーは、すべて「本物」(`lineage = 'real'`)として移行する。
- 既存の**署名・TOFU・Gift v1/v2 の受け取り**は壊さない。
- 画像素材は追加・変更しない。文字列は英語。「Reduce motion」を尊重。常時の重い処理を入れない。
- コードは周囲のスタイルに合わせる。**暗号は自作しない**(既存の `ed25519-dalek` と `sign.rs`)。
- **移動の処理は、1つのトランザクション**にする(途中で失敗したら、元に戻る)。
- 変更したルールは `README.md` と `docs/decisions.md`(日付 **2026-10-11**)に追記する。報告 `docs/archive/reports/uniqueness-report.md`。
- 実機確認が要る項目は `docs/port-spec/macos-checklist.md` に追記する。

---

# 2. Step 1: DB V12 とモデル

## 2.1 ステッカーの種類

`stickers` に次を足す(いずれも既存行は移行で埋める)。

| 列 | 意味 |
|---|---|
| `lineage TEXT NOT NULL DEFAULT 'real'` | `'real'`(本物)か `'copy'`(複製) |
| `copy_of TEXT` | 複製の元の本物のID(複製だけ) |
| `copy_no INTEGER` | 複製の番号(本物を #1、複製を #2, #3…) |
| `source_hash TEXT` | 作成時の元画像ファイルの SHA-256(16進)。本物の作成時だけ |
| `creator_sig TEXT` | 作者の署名(§2.2)。本物だけ |

- 複製は、**本物と同じ画像ファイルを参照**する(画像の実体はコピーしない。`rendered_asset_path` / `mask_asset_path` を共有)。**複製が残っている間は、本物の画像ファイルを消さない**(参照カウント、または、本物を消すと複製も消す。§3.4 の決定に従う)。
- 受け取ったステッカー(Gift・パック)は、本物(`'real'`)。
- `ProvenanceKind` に `Duplicated`(複製を作った)、`Released`(手放した)を足してよい。既存の `provenance` 表を使う。

## 2.2 作者の署名と、持ち主の移動の記録

本物のステッカーには、作者の署名がある。

- **作成の記録**: `(sticker_id, creator_public_key, created_at, image_digest)` に、作者の端末の署名鍵(`device_key`)で署名する。`image_digest` は、**完成した画像(rendered)の SHA-256**。`creator_sig` に保存し、受け取った側が検証できるようにする(§4 の Gift v3 に入れる)。
- **移動の記録**(`transfers` 表を新設): `(sticker_id, seq, kind, actor_key, ref, at, sig)`。
  - `kind = 'release'`: 持ち主が手放した(Gift を作った・パックに入れた)。`actor_key` = 手放す人、`ref` = 贈り物のID(またはパックの版のID)、`sig` = 手放す人の署名。
  - `kind = 'claim'`: 受け取った人が受け入れた。`actor_key` = 受け取った人、`ref` = 同じID、`sig` = 受け取った人の署名。
  - 連鎖の規則: **`create` → (`release` → `claim`) を繰り返す**。`release` の `actor_key` は、直前の持ち主(作者、または直前の `claim` の人)と一致しなければならない。`claim` の `ref` は、直前の `release` の `ref` と一致しなければならない。
- **検証関数**(`sticker_chain_verify`): 作成の署名、各 release / claim の署名、連鎖の規則、日時の順(未来でない・逆行しない)を確かめる。不正なら理由つきのエラー。

> 審判役(サーバー)がない間、この連鎖は「**主張の記録**」で、同じファイルを2人が受け取る不正は、**防げない**(§6)。連鎖は、不正を見つけやすくする証拠であり、強制ではない。

---

# 3. Step 2: 複製(Duplicate)と、複製への制限

## 3.1 コマンド

- `sticker_duplicate(sticker_id, count)`: 本物から、複製を `count` 枚作る(`count` は 1〜`MAX_COPIES`)。
  - **`MAX_COPIES` は定数1つ**(`link_tag.rs` のような、1か所の定数)。**いまは 10**。あとから変えやすくする。1つの本物につき、複製の合計が `MAX_COPIES` を超えたら、`Error::Invalid("copy_limit")`。
  - 複製は、素材のシートを**使わない**(無料)。ボーナスも出ない。
  - 複製の元にできるのは、**本物だけ**(複製の複製は、元の本物から数える。複製を指定したら、その元の本物から作る)。
  - 作った複製は、Collection に入る。`ProvenanceKind::Duplicated` を記録。
- 複製は、デスクトップに貼れる・剥がせる・削除できる。**これは本物と同じ**(`placements` は複製にも使える)。リンクタグも付けられる。

## 3.2 複製ができないこと(Rust で拒否)

次の処理は、**対象が複製なら、`Error::Invalid("copies_stay_home")` で拒否**する(画面の側で選べなくするだけでは足りない。Rust でも止める)。

- Gift を送る(`gift_send`、`build_gift_dressed`)。
- パックに入れる(`creator_pack_save` / `creator_pack_shelve` の `items`、`build`)。
- Studio の選択に使う(JS 側でも、一覧から外す。§7)。

## 3.3 一覧の返し方

`book_page` が返すステッカーに、`lineage`、`copyOf`、`copyNo`、`copies`(その本物の複製の数)を足す。**複製を、本物の下にまとめて表示するのは UI の仕事**。Rust は、複製も一覧に含めて返す(`copyOf` でまとめられるように)。

## 3.4 本物が手元から離れたとき

- 本物を**贈った・パックに入れた**とき(移動)、その本物の**複製は、すべて自動で削除する**(決定: 手放すと、飾りの複製も消える。持ち主が移るのに、元の持ち主の手元に増えたものが残らないようにするため)。複製に付いていたリンクタグは、在庫に戻る(`link_tag_release`)。デスクトップの配置も消える。
- 本物を**削除**したときも、複製を削除する。

---

# 4. Step 3: Gift を譲渡にする(`PETAGIFT` v3)

## 4.1 送るとき

- `gift_send` が成功(ファイルが完全に書けた)したら、**同じトランザクションで**、次をする。
  - `transfers` に `release`(手放す人の署名)を記録。
  - 送ったステッカーを、**送り手の Collection から消す**(行を消さず、`state = 'gone'` にするか、`released_stickers` 表に写して消す。**履歴(来歴)は残す**。デスクトップの配置・リンクタグの紐づけは外す。複製は §3.4 で削除)。
  - リンクタグを在庫に戻す(いまの動き)。
- 画面では、送る前に、はっきり警告する:「**This leaves your Collection.**」(確認のダイアログ。いまの Studio の封の画面に、1文足す)。
- **エディション番号を使わない**(いまの `gift_editions` による「#1, #2…」は、新しい Gift では付けない。原本を手渡すので、番号の意味がない)。テーブルは残す(v2 の履歴のため)。

## 4.2 ファイル形式

- `PETAGIFT` を **v3** にして、次を含める: 完成した画像(いまと同じ)、**作成の記録と作者の署名**、**これまでの移動の連鎖**(`create` と、`release` / `claim` の並び)、今回の **`release`(送り手の署名)**。**元の写真は入れない**(いまと同じ)。
- **v1 / v2 のファイルは、いままでどおり受け取れる**。受け取ったステッカーは、本物として扱うが、`unverified`(作者の署名がない)の印を付ける(`stickers.verified = 0`)。UI の一覧では、小さな印で分かればよい(§7)。
- **送るのは常に v3**。

## 4.3 受け取るとき

- `receive_gift`: v3 は、連鎖を `sticker_chain_verify` で検証してから受け取る。不正なら、拒否して理由を出す(「The history of this sticker does not add up.」)。
- 受け取ったら、**`claim`(受け取った人の署名)**を記録する。
- 同じ Gift を2回受け取ることは、いままでどおり拒否する(`gift_already_received`)。
- **すでに自分の Collection にあった(送り返された)ステッカー**: 連鎖の中で自分が作者・以前の持ち主なら、新しい行を作らず、元の行を `state = 'held'` に戻す(戻ってくる)。

---

# 5. Step 4: 画像の指紋と「新しい画像か」

- 本物を**新しく作る**とき(`creator_save_original` / `creator_finish` / `daily_create`)に、**元の画像ファイルのバイト列の SHA-256**(`source_hash`)を保存する。写真の読み込みで加工する前の、**ファイルそのもの**。
- 結果に **`newImage: bool`** を足す: **同じ `source_hash` を、この端末の作成者がすでに持っていなければ `true`**。
- **削除しても、判定が戻らない**ようにする: `seen_sources(hash, first_at)` 表を新設し、作るたびに追加する。ステッカーを削除しても、この表は消さない。
- クリップボードや、ファイルのない画像(貼り付け)も、同じ方式でバイト列から計算する。
- **ボーナスの支払いは実装しない**。代わりに、`scraps::on_new_sticker(db, sticker_id, new_image) -> Result<()>` という**空の口**を作り、作成の流れから呼ぶ(中身は何もしない。テストで「呼ばれる・`new_image` が正しい」ことを確かめる)。後で、Scraps の経済の作業が、ここに中身を入れる。
- 開発者版でも、`newImage` は計算する(支払いは、後で開発者版を除外する)。
- 素材違いは「別のステッカー」。同じ画像で、素材を変えて作ることは、**できる**(`newImage = false` になるだけ)。

---

# 6. 審判役のための口(いまは何もしない)

サーバー(審判役)は、後の作業で入れる。いまは、**口だけ**を作る。

```rust
/// Decides whether a release may become a transfer. Today there is no referee: it always agrees.
pub trait Referee { fn register(&self, sticker_id: &str, creator_sig: &str) -> Result<()>; fn release(&self, release: &Transfer) -> Result<()>; fn claim(&self, claim: &Transfer) -> Result<()>; }
pub struct NoReferee; // agrees to everything; used until the friends server exists
```

- 譲渡の処理は、`Referee` を通して呼ぶ(`NoReferee` では何も拒否しない)。**拒否されたら、全体を元に戻す**(トランザクション)。
- `README` に「**審判がない間は、同じファイルを2人が受け取る不正を防げない**(連鎖は証拠で、強制ではない)」と、はっきり書く。

---

# 7. Step 5: 最小限の UI

**機能に必要なものだけ**。見た目の仕上げ(間隔・色・動き)は、別担当が後でやる。クラス名は、既存の命名に合わせる。

- Collection の詳細: **「Duplicate」**ボタン(枚数を選ぶ、1〜残りの上限)。複製の詳細には「Copy #2 of …」と、「Stays on this Mac」と読める短い説明、Duplicate・Gift・Studio での選択は出さない。本物の詳細には、複製の数(「Copies: 3」)。
- Collection の一覧: 複製を、本物のタイルに**まとめる**(「×3」)。複製だけを個別に見る方法は、詳細の中でよい。
- Gift: 送る前の警告(§4.1)。受け取りで、検証に失敗したときの文言。`unverified` の小さな印。
- Studio(Pack・Gift)の選択一覧から、**複製を外す**(Rust の拒否と二重にする)。複製は、画面に出さない。
- 作成の完了のあとで、`newImage = false` のときは、**何も出さなくてよい**(ボーナスは未実装)。ログにだけ残す。
- `tests/*.test.mjs` に、Studio の一覧が複製を出さないこと、Duplicate の枚数の上限の表示を確かめるテストを足す(既存のテストの流儀に合わせる)。

---

# 8. テスト

**core(Rust)**:
- V11 → V12 のマイグレーション(既存のステッカーが `real`、データが保たれる)。
- 作成の署名の検証(正しい / 画像が違う / 作者が違う)。連鎖の検証(正しい / 順番が違う / 持ち主でない人が release / claim の `ref` が違う / 日時が逆行)。
- Duplicate: 上限(`copy_limit`)、複製の複製は元の本物から数える、複製は画像を共有、本物を削除すると複製も消える、素材のシートを使わない。
- 複製の制限: `gift_send`・パックへの追加・Studio の選択が `copies_stay_home` で拒否される。
- 譲渡: `gift_send` 成功で、送り手の Collection から消える、複製も消える、配置が消える、リンクタグが戻る、来歴が残る。**ファイルの書き込みに失敗したら、何も変わらない**。
- v3 の受け取り: 検証 OK → 受け取り+`claim`、改ざん → 拒否、v1 / v2 → 受け取れて `unverified`、同じ Gift を2回 → 拒否、送り返されたら元の行が戻る。
- 画像の指紋: 同じファイル → `newImage = false`、違うファイル → `true`、削除しても戻らない、素材違いは別のステッカー、`scraps::on_new_sticker` が呼ばれる。
- `Referee`: `NoReferee` が通す、拒否する偽物でトランザクションが元に戻る。

**JS(`npm test`)**: §7 のテスト。

---

# 9. 受け入れ条件

- [ ] 本物を Gift で送ると、送り手の Collection から消え、受け取った側に入る。送り手の手元に、そのステッカーの複製も残らない。
- [ ] Duplicate で、飾り用の複製が作れて、デスクトップに貼れる。複製は、贈れず、パックにも Studio にも入れられない(Rust も拒否する)。
- [ ] 同じファイルから、2回目に作ると `newImage = false`。削除して作り直しても、`false` のまま。
- [ ] Gift v1 / v2 のファイルが、いままでどおり受け取れる(`unverified` の印つき)。送るのは v3。
- [ ] `cargo test --workspace` と `npm test` が通る。`docs/decisions.md` と `README.md` が更新されている。
- [ ] 報告 `docs/archive/reports/uniqueness-report.md` に、**作ったもの・守れないこと(審判がない間のコピーの不正)・実機で確認する項目**を、日本語で書く。

**実機でしか確認できないこと**(オーナーがやる): 実際に Gift ファイルを別のデータフォルダ(2つのインスタンス)で受け渡す一連の流れ、複製をデスクトップに貼る操作。
