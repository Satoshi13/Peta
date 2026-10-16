# 段階3: 友達の Market 設計書

2026-10-13 作成。**設計だけで、コードは未着手**。**同日、§9 の全項目をオーナーが推奨どおりに決定**。Codex への依頼書は [`codex-server-s3-prompt.md`](archive/prompts/codex-server-s3-prompt.md)。前提は [`server-plan.md`](server-plan.md)(S1 審判役・S2 友達と受信箱)、[`decisions.md`](decisions.md)(2026-10-09「Market に出るのはフレンドが出品したパックだけ」、2026-10-11「Pack は版を刷る本物のガチャ」、2026-10-13「Scraps の経済」)、[`server-s2-report.md`](archive/reports/server-s2-report.md)、[`local-market-report.md`](archive/reports/local-market-report.md)、[`economy-sim.html`](economy-sim.html)。

> **呼び方**: この文書では友達の Market を **S3** と呼ぶ。`server-plan.md` の作業表の「S3 公開(公開前チェックリスト)」は、採用時に **S4** へ読み替える。

この文書は2つに分かれる。**§1〜§8 が推奨案**(このまま Codex に渡せる形)、**§9 がオーナーが決める項目**。推奨案の中で仮に置いた数字には「(仮)」を付け、§9 にも載せている。§9 は 2026-10-13 にすべて推奨どおりに決まった。「(仮)」の数字は、実際に使ってみて変える前提の初期値として扱う。

---

## 0. いまの状態と、S3 で埋める穴

| もの | いま | S3 で足すこと |
|---|---|---|
| Scraps | 端末の SQLite(`meta` の `scraps.balance`)。入口は最初の 20・作ると +2・7日連続 +5。値段は Rust の定数 | 友達のパックを1回引くと **6 払う**、売り手に **70%** 入る(どちらも仮) |
| 出品 | `pack_market_listings`(V14)。**この Mac の Market に出すだけ**の表示切り替え | 友達の Mac に届く出品にする |
| 友達 | S2: `status=friend` が承認済み。サーバーは受信箱ごとの許可リスト `mailbox_allow` を持つ | 出品を見られるのは承認済みの友達だけ |
| 版の唯一性 | S1: `POST /v1/packs/{id}/slots/{n}/claim` で枠と版の claim を1つの D1 batch で確定 | 枠の claim と**支払いの記録**を同じ batch に入れる |
| 売れ行き | S2 Step 7: 作者だけが `drawers`(誰が引いたか)を見られる | 入った Scraps も出す |
| パックの開け方 | パックのファイルを持っていれば、誰でも無料で開けられる(S1 で枠の重複だけ防ぐ) | Market に出したパックは、**Market で払って引く**以外では開けない |

---

## 1. Scraps をサーバーで持つか(推奨: 持たない。取引だけ審判する)

### 1.1 比べた案

- **案A: Scraps をサーバーの台帳にする**。残高と入出金をすべて D1 に持つ。作る・分解・交換・道具の購入・友達のパックを引く、のすべてがサーバーを通る。
- **案B(推奨): Scraps は端末のまま。友達の間の取引だけサーバーが審判する**。引くときの「払った」という記録と売り手の取り分は D1 に残し、残高そのものは端末が持つ。
- 案C(不採用): 端末の Scraps とは別に「Market 用の財布」をサーバーに持つ。入金を端末から移すときに偽れるので案B と強さが変わらず、財布が2つになって分かりにくい。

### 1.2 比較

| 観点 | 案A サーバーの台帳 | 案B 端末のまま + 取引の審判 |
|---|---|---|
| **不正耐性: 残高を水増し** | 防げる。ただし入口(+2・+5)はサーバーから見ると「新しい画像を作った」ことしか分からず、素材の分解・交換の入金は**素材の在庫も端末にあるので検証できない**。素材と毎日の抽選までサーバーへ移さないと穴が残る | 防げない(今と同じ。SQLite を書き換えれば増える) |
| **不正耐性: 払わずに引く** | 防げる | 防げない。改造したアプリは払わずに `pulls` を送れる。**被害は「友達の版を買い占める」ことだけ**で、次で抑える: 1人1日に引ける回数の上限(サーバー)、友達だけに見える、作者は誰が引いたかを見られて Remove/Block できる |
| **不正耐性: 売り手の取り分を水増し** | 防げる | **防げる**。取り分はサーバーの売上の記録から計算し、端末の申告を使わない。自分の別の鍵で自分のパックを引いても 6 払って 4.2 戻るだけで、増えない |
| **費用(Cloudflare)** | 作る・分解・交換・道具のたびに書き込み。リクエストは S2 の約 1.5〜2 倍 | 引く1回 = 書き込み1リクエスト(約7行)。Market を開く・売上の確認は読み込みだけ。S2 の見込み(約1,000人まで無料)をほぼ変えない |
| **オフライン** | 作ったボーナスも、素材の交換・道具の購入も**つながるまでできない**か、端末で仮に積んで後で確定(二重の状態) | 作る・分解・交換・道具は**今までどおりオフラインでできる**。友達のパックを引く・出品するだけがオンライン必須(決めたこと 1 と同じ「失敗して戻す」) |
| **S1 Referee との関係** | 別の台帳(残高)を作り、端末のすべての Scraps 取引(`scraps::trade` は在庫・残高・レシートを1トランザクションで確定)を S1 と同じ2段階(サーバー → 端末の確定 → ずれたら取り消し)に作り直す | S1 の枠の claim を**そのまま延長**する。`pack_slots` の claim と `market_sales` の1行を同じ D1 batch に入れるだけで、復旧(同じ枠で再送・`slot_taken` で引き直し)も S1 のまま使える |
| **既存の残高の移行** | 端末の残高は検証できないので、0 に戻すか、未確認のまま持ち込むかを決める必要がある | 移行なし |
| **データ削除(App Store 5.1.1(v))** | 残高という「価値」がサーバーに残り、削除の扱いが重くなる | サーバーに残るのは売上の行(鍵のハッシュ)だけ |
| **将来お金を取るとき** | 資金決済法の未使用残高の管理などに、そのまま使える | サーバーの台帳へ移す工事が要る(§4.3) |
| **作業量** | 大(素材・毎日の抽選・ボーナス・道具をすべて作り直す) | 小〜中(Worker 1ファイル・D1 表4つ・アプリの購入と精算) |

### 1.3 推奨と理由

**案B を推奨する**。

1. Peta の Scraps は無料で配る遊びの点数で、換金もできない。いまでも端末を書き換えれば増やせる。案A にしても、素材の在庫と毎日の抽選がまだ端末にあるかぎり水増しは止めきれず、作業だけが大きい。
2. 守りたいのは **「友達が刷った唯一の版」と「売り手に入る取り分」** の2つ。版は S1 がすでに守っていて、取り分はサーバーの売上の記録から計算すれば守れる。案B で両方守れる。
3. 払わずに引く改造の被害は「友達の版を買い占める」ことで、友達だけの小さな輪では1日の上限・誰が引いたかの表示・Remove/Block で十分抑えられる。
4. オフラインでも作る・交換する体験が今のまま残り、決めたこと 2(Scraps は当面端末)とも食い違わない。

**案A に切り替える合図**: Scraps をお金で買えるようにする、公開カタログを作って知らない人とも取引する、のどちらかを決めたとき(§4.3)。そのときは S3 の `market_sales` がそのまま台帳の入出金の一部になる。

---

## 2. 出品の置き場と見え方

### 2.1 置き場

- **サーバー(R2)には暗号化した2つのファイルだけを置く**。
  - **カード**(`card`、1MiB まで(仮)): 題名・説明・作者名・包み・表紙・飾り・中身の見本3枚(「A peek inside」)・デザインと景品の一覧(版の数)。棚とズームしたカードを描くのに足りるもの。
  - **パック**(`pack`、既存の 24MiB 上限): 署名済みの PETAPACK v2 そのまま(My shelf のアーカイブと同じバイト列)。
- 暗号: 出品ごとにランダムな**内容鍵**(32バイト)を作り、ChaCha20-Poly1305(既存の crate)でカードとパックを封じる。内容鍵は、**承認済みの友達1人ずつの暗号公開鍵**(S2 の X25519)へ HPKE で封じた「封筒」にして D1 に置く。サーバーは内容鍵を持たないので、**運営は出品の中身を見られない**(S2 の Gift と同じ方針。通報のときだけ、通報した人の同意で中身を運営へ送る)。
- 内容鍵は売り手の端末の DB に保存する(V17)。データフォルダごと新しい Mac へ移せば出品はそのまま続く。**鍵だけを戻した場合**(DB がない)は、内容鍵がないので新しい友達に封筒を作れない。ただし、すでに封筒を持つ友達はそのまま引け、売り手の精算は鍵だけで受け取れる。一度やめた(closed)出品は再登録できないので、「出し直す」ことはできない(2026-10-13 実装時に修正。以前は「取り下げて出し直す」と書いていたが、§3.1 の「やめた出品は無料開封に戻さない」・1パック1出品と両立しないため)。
- R2 のバケットは **`peta-market-dev` / `peta-market-prod` を新しく作る**。Gift のバケットには7日で消すルールがあるので混ぜない。

### 2.2 見え方(承認済みの友達だけ。公開カタログは作らない)

- 出品が見えるのは、**その出品の封筒を持ち、かつ売り手と相互に許可し合っている人**だけ。
  - 封筒: 売り手のアプリが `status=friend` の友達にだけ作る。友達が増えたら足し、Remove / Block したら消す(起動・フォーカス復帰・友達の変更の後に合わせる)。
  - サーバーの確認: 売り手の `mailbox_allow` に買い手、買い手の `mailbox_allow` に売り手が入っていること(S2 では、申請した側は申請時に、承認した側は承認時に相手を許可に入れるので、**相互の許可 = 承認済みの友達**)。封筒が残っていても、どちらかが外せば見えないし引けない。
  - 運営の拒否リスト(`blocked_keys`)の鍵は出品も購入もできない。
- **一覧・検索・人気順などの全体の窓口は作らない**。`GET /v1/market/listings` は「自分宛ての封筒がある出品」だけを返し、それ以外を探す API はない。
- サーバーが知ること: 売り手の鍵・パック ID・枠の数と残り・値段・誰に封筒があるか(鍵のハッシュ)・誰がいつ引いたか(鍵のハッシュ)。**知らないこと**: 題名・絵・説明・友達の名前。
- 出品は「出す / 一時的に下げる / やめる」の3つ。今の Take down は「一時的に下げる」(`paused`)にあたり、My shelf に残り、また出せる。

### 2.3 アプリの見え方(Market の Packs)

- 同梱の公式パック(Tokyo など)の棚は今のまま残す(決めたこと 3)。その下に **友達ごとのレール**(「From Nao」など)を足し、友達の出品を吊るす。今の「On this Mac」は自分の出品の確認用として残す。
- 袋の下の文字は `6 Scraps` と `12 of 30 left`(残りはサーバーの枠の数)。売り切れは `Sold out`。
- ズームしたカード: 作者名・題名・説明・見本3枚・デザインと景品ごとの残り・`Pull one — 6 Scraps`。払う前に「Costs 6 / Scraps after N」を出す(今の購入カードと同じ形)。
- 空の状態: 友達がいない → 「Add a friend to see the packs they make.」と Settings の Friends へのリンク。友達はいるが出品がない → 「Your friends haven't put any packs out yet.」
- オフライン: 最後に取ってきた一覧を薄く出し、「Connect to the internet to pull from your friends' packs.」。引くボタンは押せない。

---

## 3. 購入(引く)の流れと唯一性

### 3.1 決めごと

- **買う = その場で1枠を引く**。買って取っておく「未開封の権利」は作らない(サーバーに未開封の状態を持たなくて済む)。複数回は1回ずつ順に引く(今の10連と同じく `pack_open` を順に呼ぶ形)。
- 値段は**出品に記録した値段**(v1 は全員 6 で固定(仮))。サーバーは「出品の値段」と「買い手が払ったと言う値段」が一致しないと断る。
- **自分の出品は引けない**(今の「自分のパックは開けられない」をサーバーでも確かめる)。
- **Market に出したパックは、ファイルで持っていても無料では開けない**。出品の記録があるパックへの今の `POST /v1/packs/{id}/slots/{n}/claim` は `403 for_sale` で断る。一度出品したパックは、取り下げてもファイルでの無料開封には戻さない(戻せると、出品 → 無料配布で版を配り直せる)。出品していないパックをファイルで配って無料で開けてもらうのは今のまま。

### 3.2 流れ

```
買い手の Mac                                  Worker / D1
1. 一覧と枠の同期(GET listings, GET slots)
2. 1つのトランザクションで:
   残高 -6、market_pulls に pending(pullId・枠・claim の署名)を記録
3. POST /v1/market/listings/{L}/pulls/{pullId}  ──▶  1つの D1 batch で:
   {slot, claim, price}                              出品が open・相互の許可・封筒あり・自分以外・値段一致・1日の上限
                                                     → 枠の claim(S1 と同じ)+ 版の transfer + market_sales に1行
                                              ◀──  200 {saleId, slotsLeft}
4. 1つのトランザクションで:
   版を Collection へ(今の open_row)、market_pulls を done
```

- **失敗して戻す**(決めたこと 1):
  - 2 の前にオフライン → 何も変わらない。
  - 3 が `not_friend` / `listing_closed` / `for_sale` 以外の確定的な拒否 / `price_changed` → `market_pulls` を `refunded` にし、**同じトランザクションで 6 を戻す**。
  - 3 が `slot_taken`(他の人が先に引いた)→ 払いはそのまま、**同じ pullId で別の枠**を引き直す(S1 の自動引き直しと同じ、3回まで)。3回だめなら返金。
  - 3 の応答が来ない・5xx → `pending` のまま。**次も同じ pullId・同じ枠・同じ署名で再送**する(S1 の `pack_slot_pending` と同じ規則)。再送が `200` なら 4 へ、別の人の `slot_taken` なら引き直し、`sold_out` なら返金。
  - 4 が失敗 → `pending` のまま残り、再送で `200`(冪等)が返るので 4 をやり直せる。
- サーバーの冪等: 同じ `pullId` で同じ枠・同じ claim の署名なら何度でも `200`。同じ `pullId` で別の枠・別の買い手は `409 pull_used`。

### 3.3 唯一性(S1 の claim との結び付け)

- 版の唯一性は **S1 の仕組みをそのまま使う**: 枠は `pack_slots` の `claimer_key IS NULL` を条件に1人だけ、版の claim は `transfers` のトリガーで1回だけ。
- S3 で足すのは、**同じ batch に `market_sales` の1行を入れる**ことだけ。`market_sales` は `UNIQUE(pack_id, slot_no)` と `UNIQUE(pull_id)` を持ち、枠の claim と支払いの記録は「両方あるか、両方ないか」になる。
- 景品の枠(素材・リンクタグ)も同じ。景品は刷ったときに売り手の在庫から出ているので、引いた人の端末で受け取るだけ。
- 引いた版は普通の本物。Gift v3 で渡せる。売り手が出品をやめても、すでに引かれた版には影響しない。

---

## 4. 取り分 70% の精算

### 4.1 仕組み

- 売上の1行に `price`(6)と `cut_milli`(取り分を 1/1000 Scraps 単位で: 6 × 700 = 4200)を記録する。取り分の率は**出品ごとに記録**し、あとで率を変えても過去の売上は変わらない。
- 残りの 30% は**どこにも入らずに消える**(Scraps が増えすぎない歯止め。`economy-sim.html` の前提と同じ)。
- **4.2 のような端数**: 売り手の端末が端数を `meta` の `scraps.market.remainder_milli` に持ち越し、整数になった分だけ残高に足す。6 を5回売ると 4+4+4+4+5 = 21(= 30 × 70%)で、長く見ればちょうど 70%。
- 売り手の端末は、起動・フォーカス復帰・Market を開いたとき(S1 の同期と同じ契機。常時ポーリングはしない)に精算する:
  1. `GET /v1/market/payouts` → まだ受け取っていない売上(`saleId` 順)。
  2. **1つのトランザクションで**: 残高に足す・端数を更新・`scraps.market.upto = 最後の saleId` を保存・レシート(`scraps.tx.payout-<saleId>`)を残す。
  3. `POST /v1/market/payouts/ack {upTo}` → サーバーの既読の印を進める。
  - 2 と 3 の間で落ちても、次は端末の `upto` より後だけを足すので二重にならない。鍵だけを新しい Mac に戻した場合も、サーバーの既読の印より後しか返らない。
- 知らせ: 「You earned 8 Scraps from Night Walk.」(窓が前にあるとき。今の Scraps の知らせと同じ扱い)。My shelf の売れ行きに `Earned 21 Scraps` を足す。

### 4.2 開発者版

- 開発者版は端末で Scraps を払わない(今のまま)。サーバーは開発者版かどうかを知らないので、売上は 6 で記録し売り手に取り分が入る。**開発者版は dev のサーバーだけにつなぐ**ので、本番の経済には混ざらない。

### 4.3 お金を取ることにした場合に変わること

- Scraps を円で買えるようにするなら、案A(サーバーの台帳)に移る。残高は運営が正確に管理しなければならなくなる(資金決済法の前払式支払手段: 自家型は基準日の未使用残高が1,000万円を超えると届出など)。
- 友達の間で Scraps が移るので、**換金できない・現金で買った Scraps は友達へ移らない**などの線引きが要る。課金した Scraps でガチャを引かせるなら、景品表示法(カード合わせの禁止)・確率の表示・App Store 3.1.1(アプリ内課金と確率の開示)も確かめる。
- いずれも**お金を取ると決めたときに専門家と確認する**項目で、S3 では扱わない。

---

## 5. 電気通信事業の届出

> **注意**(2026-10-13 の公開前確認 [`release-readiness-audit-2026-10-13.md`](archive/reports/release-readiness-audit-2026-10-13.md) の指摘): この節は**オーナーの方針と設計上の前提**を書いたもので、確定した法的判断ではない。Gift・Market の実際の運用(他人の通信の媒介にあたるか、収益の構造、公開の範囲)を踏まえて、**公開前に管轄の総合通信局へ確認する**(§9 の 17)。

- **S3 は決めたこと 5 の前提を変えない**。S3 でも Peta は完全に無料(料金・広告・アプリ内課金なし)で、Scraps は無料で配る点数で、円では買えず換金もできない。決めたこと 5 の「無料の間は届出が要らない」という判断の根拠(料金を取らない)を、S3 は新しく崩さない。
- 出品は「売り手から友達へのファイルの受け渡し」で、他人の通信の媒介にあたりうる点は Gift の受信箱と同じ。だから**通信の秘密は設計で守る**: カードもパックも暗号化し、運営は内容鍵を持たない(§2.1)。通報のときだけ、通報した人の同意で中身を運営へ送る。
- **前提が変わる条件**: Scraps・パック・道具を円で売る、広告を出す、有料プランを作る。どれか1つでも始めるなら、**お金を取り始める前に**届出の要否を確かめて手続きし、§4.3 の確認もする。
- S3 で新しく増える取得情報は、売上の行(買い手・売り手の鍵のハッシュ、時刻、値段)と出品の封筒の宛先(鍵のハッシュ)。`privacy-policy-draft.md` に追記する(保存期間は §6.4)。

---

## 6. API と D1 の表

### 6.1 D1(`migrations/0003_market.sql`)

| 表 | 列 | 意味 |
|---|---|---|
| `market_listings` | `listing_id` PK、`pack_id` UNIQUE(`packs` を参照)、`seller_key`、`price`、`cut_permille`(700)、`state`(`draft` / `open` / `paused` / `closed`)、`card_digest`、`card_size`、`pack_digest`、`pack_size`、`created_at`、`updated_at` | 出品。1パックに1つ。`closed` でも行は残す(`for_sale` の判定と売上の参照に使う) |
| `market_envelopes` | `listing_id`、`recipient_hash`、`sealed`(HPKE で封じた内容鍵、base64)、`created_at`。PK(`listing_id`, `recipient_hash`)。索引 `recipient_hash` | 誰が見られるか |
| `market_sales` | `sale_id` INTEGER PK AUTOINCREMENT、`listing_id`、`pack_id`、`slot_no`、`pull_id` UNIQUE、`buyer_hash`、`seller_key`、`price`、`cut_milli`、`at`。UNIQUE(`pack_id`, `slot_no`)。索引(`seller_key`, `sale_id`)と(`buyer_hash`, `at`) | 支払いの記録。枠の claim と同じ batch で入る |
| `market_payout_marks` | `seller_key` PK、`acked_upto` | 売り手が受け取り済みの売上の印 |

- 枠の claim の拒否は、既存の `assertions` のトリガーに `for_sale`・`not_friend`・`listing_closed`・`price_changed`・`pull_used`・`too_many_pulls` を足して、batch の途中で全部を戻す。
- `GET /v1/packs/{id}/slots` は変えない(残りの枠は出品の有無と関係なく同じ)。

### 6.2 API(すべて S1 と同じ署名つき。JSON は camelCase)

| メソッド・パス | 誰が | 規則 |
|---|---|---|
| `POST /v1/market/listings` | 売り手 | `{listingId, packId, price, cardDigest, cardSize, packDigest, packSize}`。パックが**この鍵で登録済み**(`packs.creator_key`)・値段が許された値・出品数の上限内なら `draft` で作る。同じ内容の再送は OK、同じ `packId` で別の出品が `closed` 以外なら `409 taken` |
| `PUT /v1/market/listings/{id}/card`・`/pack` | 売り手 | 暗号文をそのまま R2 へ(`market/{listingId}/card`・`/pack`)。SHA-256 と大きさが登録と一致しないと `400 digest_mismatch`。再送は上書き(同じ内容) |
| `PUT /v1/market/listings/{id}/envelopes` | 売り手 | `{add:[{to, sealed}], remove:[hash]}`。`to` は売り手の `mailbox_allow` にある鍵のハッシュだけ(それ以外は `403 not_friend`)。1回200件まで |
| `POST /v1/market/listings/{id}/open`・`/pause` | 売り手 | `open` は2つのファイルが揃っていることを確認してから。`pause` は `open` からだけ。冪等 |
| `DELETE /v1/market/listings/{id}` | 売り手 | `closed` にし、R2 の2ファイルと封筒を消す。売上の行・`for_sale` は残す |
| `GET /v1/market/listings` | 買い手 | 自分宛ての封筒があり、相互の許可があり、`open` か `paused`(paused は「Back soon」用)の出品: `{listingId, sellerHash, packId, price, state, slotCount, slotsLeft, sealed, cardDigest, packDigest, updatedAt}`。生の鍵は返さない |
| `GET /v1/market/listings/{id}/card`・`/pack` | 買い手 | 同じ条件で暗号文を返す。パックは最初に引くときだけ取り、端末に置く(`packDigest` が変わらない限り再取得しない) |
| `POST /v1/market/listings/{id}/pulls/{pullId}` | 買い手 | `{slot, claim: Transfer \| null, price}`。§3.2 の条件と、**1人1日 20 回まで**(仮)。成功で `{saleId, slotsLeft}` |
| `GET /v1/market/payouts?after={saleId}` | 売り手 | `acked_upto` と `after` の大きい方より後の売上: `[{saleId, packId, slot, cutMilli, at, buyerHash}]`(最大200件) |
| `POST /v1/market/payouts/ack` | 売り手 | `{upTo}`。今より大きいときだけ進める |
| `POST /v1/packs/{id}/slots/{n}/claim`(既存) | — | 出品の記録があるパックは `403 for_sale` |
| `POST /v1/report`(既存) | 通報する人 | `kind: "listing"` を足す。同意のうえで復号したカード(とパック)と `listingId` を送る |
| `DELETE /v1/mailbox/{id}`(既存の退会) | 本人 | 自分の出品を `closed` にし R2 を消す、自分宛ての封筒を消す。売上の行は鍵のハッシュのまま残す(相手の精算に要る) |

### 6.3 回数と大きさの上限(仮。`wrangler.jsonc` の `vars` で変えられるようにする)

| 名前 | 値 | 理由 |
|---|---|---|
| `MARKET_LISTINGS` | 売り手1人の `closed` 以外の出品 10 | R2 の容量 |
| `MARKET_PULLS_PER_DAY` | 買い手1人 1日 20 | 払わずに引く改造の被害を抑える。`economy-sim` の最大は1日10回 |
| `MARKET_CARD_MAX` | 1 MiB | 一覧を開いたときの通信量 |
| パック | 既存の 24 MiB | PETAPACK の上限 |

### 6.4 費用と保存期間

- R2: 1人あたり出品 3つ × 平均 10MB として、1,000人で約30GB。無料枠(10GB)を超えた分は月 0.015ドル/GB で、**月 0.3ドル程度**。取り出しの料金はかからない。オーナーが Cloudflare の使用量通知を R2 にも設定する。
- D1: 引く1回で約7行の書き込み(nonce・枠・transfer・持ち主・売上)。1人1日 3回引くとしても S2 の受信箱の確認(1日最大約50リクエスト)より小さい。
- 保存期間: 出品をやめたら R2 の2ファイルと封筒はすぐ消す。売上の行は台帳の一部(S1 の `transfers` と同じ扱い)として残す。データ削除の扱いは `server-plan.md` の未決事項(鍵を匿名の印に置き換える案)に合わせる。

---

## 7. アプリ側の変更点

### 7.1 core(Rust)

- **DB V17**(番号は実装時の最新に合わせる。V1〜V16 は変えない):
  - `market_my_listings`: `pack_id` PK(`packs` を参照)、`listing_id`、`content_key`、`state`、`card_uploaded`・`pack_uploaded`、`updated_at`。V14 の `pack_market_listings`(この Mac での表示)は残し、出品したら両方を同じトランザクションで更新する。
  - `market_listings_seen`: 取ってきた友達の出品のキャッシュ(`listing_id` PK、`seller_key`、`pack_id`、`price`、`state`、`slot_count`・`slots_left`、`card_path`、`pack_digest`、`fetched_at`)。オフラインの表示に使う。
  - `market_packs`: 引くために取ってきたパック(`pack_id` PK、`listing_id`)。**Packs の棚には出さず**、無料で開けるボタンも出さない。
  - `market_pulls`: `pull_id` PK、`listing_id`、`pack_id`、`slot_no`、`price`、`state`(`pending` / `done` / `refunded`)、`transfer`、`created_at`、`finished_at`。**残高を減らすのと `pending` の記録は1つのトランザクション**、返金(`refunded` + 残高を戻す)も1つのトランザクション。
  - `meta`: `scraps.market.upto`、`scraps.market.remainder_milli`。
- **`scraps`**: `Kind` に `Pull`(払う)と `Payout`(受け取る)を足す。値段・取り分の率は Rust の定数(`FRIEND_PULL_PRICE = 6`、`SELLER_CUT_PERMILLE = 700`、いずれも仮)。開発者版は今と同じく払わない。
- **`ownership::Referee`**: `purchase(listing, pull_id, slot, claim, price)` を足す(中身は §6.2 の `pulls`)。`NoReferee` は `Offline` を返す(配布版では Market の友達の棚自体が出ない)。
- **`edition_pack::open`** に「Market で引く」経路を足す: `claim_slot` の代わりに `purchase` を呼び、`slot_taken` の引き直し・同じ枠での再送は今の `pack_slot_pending` の規則のまま。
- **`market` モジュール(新規)**: カードを作る(表紙・包み・飾り・見本3枚・デザインと景品の一覧)、内容鍵での封と開封、封筒の作成(`identity` の HPKE を使う)、精算(端数の持ち越し)。

### 7.2 アプリ(src-tauri、Cargo feature `server`)

- 新しい IPC: `market_friend_listings`(一覧と同期)、`market_pull`(1回引く)、`market_list_pack` / `market_pause_pack` / `market_close_pack`、`market_payouts_sync`。
- 同期の契機: 起動・フォーカス復帰・Market を開いたとき・友達の承認/Remove/Block の後。封筒の付け外しと精算をここで行う。常時ポーリングはしない。
- 出品は、上げ終わるまで UI に進み具合を出す(パックは最大 24MiB)。途中で失敗したら `draft` のまま残し、次の同期で続きから上げる。
- 通信中は Library の mutex を持たない(S1・S2 と同じ)。

### 7.3 UI(`src/app/js/market.js` ほか)

- §2.3 の友達のレール・カード・空の状態・オフラインの表示。
- 引いた後の演出は今の1枚開封(封筒 → 光の演出 → 「Stick it」/「Keep in Collection」)をそのまま使う。
- My shelf の自作パック: `List in Market` は「友達に出す」意味に変わる(文言は `Show to friends in Market` など、§9)。`Take down` は一時的に下げる。新しく `Stop selling`(やめる。確認のシートつき)。売れ行きに `Earned N Scraps`。
- 失敗の文言(英語): `offline` →「Connect to the internet to pull from your friends' packs.」、`not_friend` →「You and {name} aren't friends anymore.」、`sold_out` →「Someone pulled the last one. Your Scraps are back.」、`too_many_pulls` →「That's enough pulls for today. Try again tomorrow.」、`for_sale`(ファイルで開こうとしたとき)→「{name} sells this pack in Market.」。

---

## 8. Codex 向けの作業ステップと受け入れ条件

S1・S2 と同じく、**Step 順・Step ごとにコミット**(Worker・Rust のルール・UI は別コミット)。各 Step の終わりに `cargo test --manifest-path src-tauri/Cargo.toml --workspace`(既定と `--features developer`)、`npm test`、`cloudflare/peta-api/` の `npm test` と `npm run check` を通す。**本番(`--env prod`)の migration・deploy・R2 の作成はオーナー**。dev は Codex / Claude が行ってよい。

| Step | 内容 | 主なファイル |
|---|---|---|
| 1 | 検証用データ(Rust): 出品の登録本文・`pulls` 本文・封筒(HPKE)・カードとパックの暗号文を固定鍵で作り、`vectors-s3.json` に書く | core のテスト、`cloudflare/peta-api/test/vectors-s3.json` |
| 2 | Worker: `0003_market.sql`、`src/market.ts`(出品・R2・封筒・一覧・引く・精算・退会)、既存の枠の claim に `for_sale`、通報に `listing`、上限の `vars`。vitest | `cloudflare/peta-api/` |
| 3 | core: V17、`scraps` の `Pull` / `Payout`、`market` モジュール、`Referee::purchase`、`edition_pack::open` の Market 経路。状態を持つ偽の審判でテスト | `src-tauri/crates/core/` |
| 4 | アプリ: HTTP の `purchase`・出品のアップロード・一覧と精算の同期・封筒の付け外し・IPC | `src-tauri/src/` |
| 5 | UI: 友達のレール・カード・引く・空とオフラインの表示・My shelf の出品と売れ行き | `src/app/js/market.js`、`packs.js`、CSS |
| 6 | dev: `peta-market-dev` を作り、`wrangler.jsonc` に binding、`0003` を dev に適用して deploy | `wrangler.jsonc` |
| 7 | 文書: `docs/archive/reports/server-s3-report.md`、`decisions.md`、`server-howto.md`、`server-resources.md`、`privacy-policy-draft.md`、`port-spec/macos-checklist.md` | `docs/` |

### 受け入れ条件

- [ ] Worker の `npm test` が通る(検証用データの全項目を含む)。`npm run check` が通る。
- [ ] `cargo test --workspace`(既定と `--features developer`)と `npm test` が通る。**既定ビルドに HTTP の依存が入っていない**(`cargo tree` で確認して報告に書く)。
- [ ] 偽の審判で:
  - 引く: 残高 -6 と `pending` が同時に入る。`200` で版が Collection に入り `done`。`slot_taken` で同じ払いのまま別の枠(3回で止まり返金)。`Offline` で何も変わらない。応答なしで `pending` が残り、次は同じ枠・同じ署名で再送。`not_friend` / `sold_out` で返金され残高が元に戻る。
  - 精算: 6 を5回売ると 21 入り、端数が持ち越される。同じ売上を2回足さない(端末の `upto` とサーバーの ack のどちらが欠けても)。
  - 自分の出品は引けない。出品したパックをファイルから開くと `for_sale` で何も変わらない。
- [ ] 開発者版の3つのデータフォルダ(A・B・C)で: A と B は友達、C は A の友達でない。A が出品 → **B にだけ見え、C には見えない**(C が出品 ID を知っていても `GET` も `pulls` も断られる)。B が引く → A の売れ行きに B の名前と取り分が出る。A が B を Remove → B の一覧から消え、引けない。B がすでに引いた版は B の手元に残り、Gift で渡せる。
- [ ] 同じ出品を B と D(A の友達)が同時に引く → 同じ枠は1人だけ、版の番号は全体で重複しない、売上の行と枠の claim の数が一致する。
- [ ] R2 のカードとパックが暗号文で、D1 に内容鍵がないこと(テストで中身を読もうとして失敗すること)。
- [ ] 1日の上限を超えると `too_many_pulls` で何も変わらない。
- [ ] 配布版(既定ビルド)の Market・Packs・Scraps の動きは今までどおり。
- [ ] 報告 `docs/archive/reports/server-s3-report.md` に、**作ったもの・本書と違う判断とその理由・守れないこと(改造したアプリが払わずに引くこと、端末の残高の書き換え、など)・オーナーがやること(本番の R2 作成・migration・deploy)・実機で確認する項目**を日本語で書く。

**実機でしか確認できないこと**(オーナー): 2〜3台の Mac での出品 → 引く → 精算、Wi‑Fi を切ったときの文言と返金、24MB 近いパックのアップロードとダウンロードの時間、本番へのデプロイ。

---

## 9. オーナーが決める項目

推奨案を採るかどうかと、推奨案の中で仮に置いた数字・文言。**2026-10-13、1〜16 はすべて推奨どおりに決定**(オーナー)。変える場合は本書の該当節と依頼書を直す。17 は公開前確認の指摘で足した、まだ終わっていない確認。

| # | 決めること | 推奨 / 仮 | 関係する節 |
|---|---|---|---|
| 1 | Scraps をサーバーで持つか | **持たない**(案B: 端末のまま、取引だけ審判) | §1 |
| 2 | 友達のパックの値段と、売り手が値段を選べるか | **6 で固定**(選べない)。選べるなら 4 / 6 / 8 などの選択肢に限る | §3.1、§6.2 |
| 3 | 売り手の取り分 | **70%**(残り 30% は消える) | §4 |
| 4 | 1人1日に引ける回数 | **20 回**(仮) | §6.3 |
| 5 | 1人が1つのパックで引ける上限 | **なし**(友達だけなので)。買い占めが気になるなら「枠の半分まで」など | §1.2、§6.3 |
| 6 | 出品したパックをファイルで無料で開けるか | **開けない**。取り下げても無料には戻さない | §3.1 |
| 7 | 売り手1人の出品数 | **10**(仮) | §6.3 |
| 8 | 見本3枚の選び方 | 未決のまま(decisions 2026-10-10)。例: 一番レアなものは見本に出さない | §2.1 |
| 9 | 出品の中身を暗号化し、運営は通報のときだけ見る方針 | **暗号化する** | §2.1、§5 |
| 10 | Market の並び(同梱の公式パックの棚を残すか、友達のレールをどこに置くか) | 公式の棚の下に友達ごとのレール | §2.3 |
| 11 | 出品ボタンの文言 | `Show to friends in Market` / `Take down` / `Stop selling`(仮) | §7.3 |
| 12 | まとめて引く(10連)を入れるか | **入れない**(v1 は1回ずつ) | §3.1 |
| 13 | Drop / First day(発売日・初日の印)を入れるか | **入れない**(後で再検討) | decisions 2026-10-13 |
| 14 | `server-plan.md` の「S3 公開」を「S4」に読み替える | 読み替える | 冒頭 |
| 15 | 本番の作業(`peta-market-prod` の作成・`0003` の適用・deploy・R2 の使用量通知) | オーナーが行う | §6.4、§8 |
| 16 | 将来お金を取るか | **当面は取らない**。取るなら、その前に届出の要否と §4.3 を確認し、案A へ移る | §4.3、§5 |
| 17 | 届出の要否を管轄の総合通信局に確認する(Gift・Market の運用を説明して) | **未確認**。公開前に行う | §5 |
