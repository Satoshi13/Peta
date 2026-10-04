# Codex に送るメッセージ(署名つき配布:公式配布・コード・Gift の署名)

**使い方**: この文書の全文を Codex に渡す。**実装の指示**(Rust と JS)で、画像制作ではない。作業は **Step 順**。各 Step の終わりに `cargo test` と `npm test` を通し、Step ごとにコミットする。

> 日本語で指示。コード中のコメントと UI の文言は、既存に合わせて**英語**。

---

# 0. 目的と前提

Peta を**友達の間で**配って遊ぶためのしくみ。ただし「友達用だから適当」にはしない(本格的に、小さく作る)。

**やりたいこと**
1. 開発者(オーナー)が、好きなタイミングで次を**配れる**ようにする。
   - 今日の素材ガチャのクールタイム回復(**もう 1 通、封筒が届く**)
   - 素材(Kraft など)を N 枚
   - パック、ステッカー(画像つき)
2. 配り方は**自由**にする: ファイルを送る(AirDrop・LINE・Discord)/ **コード**を貼る(SNS の投稿など)。
3. Gift(友達どうしの贈り物)も、**署名**で「改ざんされていない」「同じ人からのものだ」と分かるようにする。
4. **友達が自分のステッカーでパックを作り、署名して配れる**(作者パック。Step 6)。受け取った側は「by Nao ✓」で棚に並べ、開封できる。**交換や、アプリの外での売り買い**の土台になる(お金・決済はアプリに入れない)。

**サーバーは使わない。アカウントも作らない。**(Phase A。ネットワーク通信も入れない。Phase B は別の指示で後日。)

**署名でできること / できないこと(この指示の前提)**
- できる: 「**公式(開発者)が作ったものだ**」「**途中で書き換えられていない**」「**Gift は前回と同じ送り手の鍵だ**」の確認。
- できない: 配ったあとの取り消し、配布数の制限(「先着 100 人」)、**同じコードを複数の端末で使われる**ことの防止、実世界での本人確認。
  → 無料の素材・ステッカーなので許容する。**仕様書とコードのコメントに、この限界を書く。**

---

# 1. 既存コードとの接続点(必ず読む)

| 読むもの | 何があるか |
|---|---|
| `src-tauri/crates/core/src/gift.rs` | Gift のファイル形式(`PETAGIFT` + version + JSON ヘッダー + PNG + マスク)。`build_gift` / `decode_gift` / `receive_gift` / `open_gift` |
| `src-tauri/src/gifts.rs` | Gift のダイアログと Tauri コマンド(`gift_send` `gift_receive_file` `gift_inbox` `gift_open`) |
| `src-tauri/crates/core/src/db.rs` | マイグレーション(今は **V7**。次は **V8**)、`add_material(material_id, n)`、`pack_install(...)`、`gifts_received` など |
| `src-tauri/crates/core/src/daily.rs` | 日ごとの記録。`ensure_today` / `open_material`(今日の素材の封筒を開ける)/ `confirm` |
| `src-tauri/crates/core/src/pack.rs` / `library.rs` | パックの取り込み(`add_from_pack`)。Pack のステッカーは Matte のフチ付き、ORIGINAL 番号なし |
| `src-tauri/src/today.rs` | `announce(app)`(画面へ「変わった」を通知)、`roll_day`、封筒の到着(`arrival.rs`) |
| `docs/decisions.md` | 決定事項。**Gift は「コピー」、元の写真は入れない、受け取りは 1 つにつき 1 回、8MB 上限と PNG 検証** |

**守ること**
- 既存の Gift のルール(コピー・エディション・8MB・PNG 検証・`gift_already_received`)は**変えない**。
- **素材の抽選、日次ルール、DB v1〜v7 の意味を変えない**。追加は **V8 のマイグレーション**でだけ行う。
- アート(`src/art/`)・CSS の見た目には手を付けない(文言とボタンの追加は最小限)。

---

# 2. 暗号の方針

- 署名: **Ed25519**(Rust は `ed25519-dalek` v2)。ハッシュ: **SHA-256**。
- 乱数は OS の乱数(`getrandom` / `rand_core::OsRng`)。**自作の暗号は書かない。**
- 署名の対象は**ファイルの本体すべて**(ヘッダー JSON のバイト列 + 添付の PNG など)。**署名の確認が通る前に、添付を展開・デコードしない**(サイズ上限の確認は先に行ってよい)。
- **鍵は 2 種類**:
  1. **公式の鍵(Official key)**: 開発者だけが持つ。**公開鍵をアプリに同梱**し(`core/src/official_keys.rs`)、**鍵 ID を付けて複数**持てる(鍵の入れ替えのため)。**秘密鍵は絶対にリポジトリに入れない**(`.gitignore` に追加)。
  2. **端末の鍵(Device key)**: Gift の送り手の鍵。初回に端末で生成し、アプリのデータフォルダに保存(権限 0600)。将来 Keychain へ移せるよう、読み書きを 1 つのモジュールに閉じる。
- **コードの中に本物の公式の秘密鍵を書かない。** テスト用の鍵は、テスト内で毎回生成するか、`tests/` に「テスト用」と明記して置く。**本物の公式鍵はオーナーが別に作る**(Step 4 のツールで `keygen`)。公式公開鍵の枠には、最初は**開発用の仮の公開鍵**を入れ、`// TODO(owner): replace with the real official public key` を残す。

---

# 3. ファイル形式

既存の Gift(`PETAGIFT`, version 1)は**読めるまま**にする(後方互換)。

## 3.1 共通の入れ物

```
MAGIC(8) · version(1) · u32 BE ヘッダー長 · ヘッダー JSON · 添付(0個以上) · 署名(64)
```

- `MAGIC`: Gift = `PETAGIFT`(version **2** を新設)、公式イベント = `PETAEVNT`(version 1)、**作者パック = `PETAPACK`(version 1。§3.5)**。
- ヘッダー JSON には必ず `signer` を入れる: `{ "kind": "official", "keyId": "k1" }` または `{ "kind": "device", "publicKey": "<base64>" }`。
- 署名は「MAGIC から添付の最後まで」のバイト列に対する Ed25519。
- 上限: ヘッダー 64KB、添付 1 つあたり 8MB、全体 24MB。

## 3.2 公式イベント(`PETAEVNT`)のヘッダー

```json
{
  "eventId": "2026-10-31-halloween",
  "kind": "extra_envelope",
  "issuedAt": "2026-10-30T12:00:00Z",
  "notBefore": "2026-10-31T00:00:00+09:00",
  "notAfter":  "2026-11-02T00:00:00+09:00",
  "title": "Happy Halloween",
  "message": "One more envelope, on the house.",
  "payload": { "count": 1 },
  "signer": { "kind": "official", "keyId": "k1" }
}
```

| `kind` | `payload` | 効果 |
|---|---|---|
| `extra_envelope` | `{ "count": 1〜3 }` | 今日の素材ガチャの**追加の封筒**を count 個、持たせる(§4.2) |
| `grant_material` | `{ "materialId": "kraft", "count": 1〜10 }` | `add_material(materialId, count)`。**カタログに無い素材 ID は拒否**。Matte は不可 |
| `grant_pack` | `{ "packId", "title", "author", "pouch", "items": [{ "key", "name", "rarity" }] }` + 添付 PNG(各 key) | パックを棚に追加(`pack_install` を一般化)。**各 PNG は PNG 検証** |
| `grant_sticker` | `{ "name"? }` + 添付 PNG 1 枚(+ マスク任意) | 受信箱に**封をした贈り物**として届く(Gift と同じ流れ。送り手は `Peta`)|
| `revoke` | `{ "eventId": "…" }` | **まだ適用していない端末**で、その eventId を無効にする(適用済みは戻さない) |

- **未知の `kind` は無視**し、「この Peta では使えません。アップデートしてください」と表示する。
- `notBefore` / `notAfter` は端末の時計で判定(UTC に直して比較)。範囲外なら「まだ / もう受け取れません」。

## 3.3 コード(貼り付け用の文字列)

- **署名つきイベントのうち、添付なしのもの**(`extra_envelope` / `grant_material` / `revoke`)を、**1 つの文字列**にして貼れるようにする。
- 形式: `PETA1-` + **Base32(Crockford、大文字小文字を区別しない、4 文字ごとにハイフン)** で、`version(1) · kind(1) · eventId(≦16 byte の短い ID) · payload を固定長で · notAfter(日単位 u16) · 署名(64)`。**短く**する(目標は 130 文字前後)。
- 入力時は、空白・ハイフン・大文字小文字・`O/0` `I/1` の取り違えを**許容して正規化**する。
- 添付つきのもの(`grant_pack` / `grant_sticker`)は**ファイルだけ**(コードにはしない)。

## 3.4 Gift v2(端末の署名)

- ヘッダーに `signer: { "kind": "device", "publicKey": "…" }` を追加し、**末尾に署名**を付ける。
- **TOFU(初回に信頼)**: 受け取り時に送り手の公開鍵を調べる。
  - 初めての鍵 → 「新しい友達」として `friends(publicKey, name, firstSeenAt)` に保存し、「**Nao(ABCD-EFGH)**」のように**指紋(公開鍵の SHA-256 の先頭 8 文字)**を見せる。
  - 既知の鍵 → 「**Nao ✓**」のように確認済みで表示。
  - **同じ名前で別の鍵**から来た → **警告**を出す(名前だけ同じ別人の可能性)。受け取りは止めない。
- `from`(名前)と `edition` は**署名の対象に含まれる**ので、書き換えると検証に失敗する(=受け取り拒否、`invalid_signature`)。
- Gift v1(署名なし)は、**「署名なし」と表示して受け取れる**(古いファイルを救うため)。新しく作るのは v2 のみ。

## 3.5 作者パック(`PETAPACK`)

友達(または自分)が作ったステッカーのパック。**署名は端末の鍵**(`signer.kind = "device"`)。公式の `grant_pack` とは別物で、**パックを棚に足す以外の効果は持たない**(素材・封筒・ステッカーの直接付与はできない)。

```json
{
  "packId": "nao-desk-doodles",
  "version": 1,
  "title": "Desk Doodles",
  "author": "Nao",
  "pouch": "kraft",
  "madeAt": "2026-10-04T12:00:00Z",
  "items": [
    { "key": "tape", "name": "Tape", "rarity": "common", "materialId": "matte", "aspect": 1.2 }
  ],
  "signer": { "kind": "device", "publicKey": "<base64>" }
}
```

- 添付は、`items` の順に **仕上がったステッカーの PNG + マスク**(Gift と同じ。元の写真は入れない)。素材(`materialId`)は**裏面の表示用に残す**(受け取った側に素材の在庫は増えない)。
- 上限: 1 パックあたり **3〜24 枚**、PNG 1 枚 **2MB**、全体 **24MB**。`name` は 40 文字まで、`title` は 40 文字まで。
- `rarity` は `common` / `uncommon` / `rare`(作者が決める。開封の演出に使う)。
- **なりすまし対策**: 公式でない署名のパックは、`author` に **`Peta`(大文字小文字・前後の空白を無視)を使えない**。受け取り時は `author` の文字をそのまま信じず、**TOFU の友達の名前(§3.4)と指紋を併記**して表示する。

---

# 4. 実装の Step

## Step 1 — 署名の土台(`core`)
- `core/src/sign.rs`: Ed25519 の署名・検証、鍵の生成、`KeyId`、指紋。
- `core/src/official_keys.rs`: 公式の公開鍵(鍵 ID つき・複数)。仮の公開鍵と TODO。
- `core/src/device_key.rs`: 端末鍵の生成・読み込み(権限 0600、保存先はライブラリのフォルダ)。
- **テスト**: 正常な署名、改ざん(1 バイト変更)で失敗、別の鍵で失敗、未知の鍵 ID で失敗。

## Step 2 — 公式イベントの受け取りと適用(`core`)
- `core/src/events.rs`: `PETAEVNT` のエンコード/デコード/検証、コードの変換、適用(`apply_event`)。
- **DB V8**:
  ```sql
  CREATE TABLE applied_events (event_id TEXT PRIMARY KEY, kind TEXT NOT NULL, applied_at TEXT NOT NULL, source TEXT NOT NULL);
  CREATE TABLE revoked_events (event_id TEXT PRIMARY KEY, revoked_at TEXT NOT NULL);
  CREATE TABLE friends (public_key TEXT PRIMARY KEY, name TEXT NOT NULL, first_seen_at TEXT NOT NULL);
  ```
  + 追加の封筒の数(下)。`SCHEMA_VERSION` を 8 にし、**V7 → V8 のマイグレーションのテスト**を書く。
- **適用は 1 つのトランザクション**で行う(途中で失敗したら何も起きない)。**同じ `eventId` は 1 回だけ**(`applied_events`)。2 回目は「もう受け取り済みです」。
- **テスト**: 二重適用の拒否、期間外、`revoke` 後の拒否、未知の素材 ID、上限(素材 10 枚・封筒 3 通)を超えるものの拒否、トランザクションの途中失敗。

### 4.2 `extra_envelope`(クールタイム回復)の意味

今は「1 日に 1 回、今日の素材の封筒を開ける」(`daily::open_material`)。これに**追加の封筒**を足す。

- 追加の封筒の数を `bonus_envelopes`(V8 で追加、`meta` か専用の表)に持つ。
- 今日の素材をすでに開封済みでも、`bonus_envelopes > 0` なら **もう 1 回 `open_material` できる**(1 回開けるごとに −1)。素材の抽選は既存と同じ確率(初回だけ Holographic の決まりは**そのまま**)。
- Today 画面とメニューバー、デスクトップの隅の封筒(`arrival.rs`)に、**追加の封筒が届いている**ことが分かる(既存の封筒の演出を使う。文言: `An extra envelope from Peta.`)。
- **日次の「ステッカーを 1 日 N 枚」のルールは変えない**(これは素材の封筒だけの話)。
- 適用後は `today::announce(app)` を呼ぶ。
- **テスト**: 開封済みの日に追加の封筒で開けられる、count を使い切ると開けられない、日をまたいでも残る(期限は `notAfter` のみ)。

## Step 3 — 取り込み口(Tauri・UI)
- メニューの **Open Gift…** を **「Open Peta file…」**にし、ファイルの MAGIC で **Gift / 公式イベント**を判別して処理する(`gifts.rs` に分岐。`events.rs` を呼ぶ)。
- **Redeem Code…**(メニューまたは Today の小さな項目): 文字列を貼る**小さなダイアログ**。正規化 → 検証 → 適用 → 結果の表示(`Kraft ×2 arrived.` など)。
- **`.peta` のファイルの関連付け**(`tauri.conf.json` の bundle `fileAssociations`、macOS のダブルクリックで開く)。起動中・未起動の両方で動くようにする(macOS の open-file イベント)。
- 受信箱(Inbox)に、**公式のイベントは「From Peta ✓」(既存の封蝋の絵を流用)**、友達の Gift は「From Nao ✓」または「新しい友達」「署名なし」「名前が同じで鍵が違う」を表示する。
- **文言は英語、簡潔に**。エラーは人が読める文(`This file was changed after it was made.` など)。

## Step 4 — 開発者ツール(`peta-pass` CLI)
オーナーが配るためのコマンド。`src-tauri/crates/` に **`peta-pass`**(core の同じコードを使う。形式のずれを防ぐため)。

```
peta-pass keygen --out official.key          # 公式の鍵を作る(秘密鍵はコミットしない)
peta-pass pubkey official.key                # 公開鍵(official_keys.rs に貼る用)を表示
peta-pass event --key official.key --id 2026-10-31-halloween --kind extra_envelope \
  --count 1 --not-before 2026-10-31T00:00:00+09:00 --not-after 2026-11-02T00:00:00+09:00 \
  --title "Happy Halloween" --message "One more envelope." --out halloween.peta
peta-pass event … --as-code                  # 添付なしの種類は、貼り付け用のコードも出す
peta-pass grant-pack --key official.key --id … --pack pack.json --dir ./pngs --out pack.peta
peta-pass verify halloween.peta              # 中身と署名の確認(読むだけ)
```

- 秘密鍵のパスは `--key` か環境変数 `PETA_SIGNING_KEY`。**秘密鍵をログや出力に出さない**。
- 使い方を `docs/distribution-howto.md` にまとめる(オーナー向け: 鍵の作り方、守り方、配り方、**配ったあとの限界**)。

## Step 5 — Gift v2(端末の署名)
- `gift.rs` に v2 の作成・検証を足す(§3.4)。`friends` の保存・指紋・警告。
- **テスト**: 改ざん、`from` の書き換え、鍵が同じなら ✓、同名で別の鍵なら警告、v1 は「署名なし」で受け取れる。

## Step 6 — 作者パック(作って、署名して、配る・受け取る)

**作る側(Collection / Book から)**
- Book の画面に **Make a Pack…** を追加する。流れ: ① コレクションから 3〜24 枚を選ぶ → ② パックの名前・外装(`kraft` / `matte` / `holo`)・各ステッカーの名前とレア度(既定は Common。**一括で設定できる小さな操作**)→ ③ **Seal & Save…** で `.peta`(`PETAPACK`)を保存。
- 署名は端末鍵(Step 1)。`packId` は **端末の指紋 + 名前から作った短い文字列**にする(同じ作者の同名パックが衝突しない)。
- 作ったパックを `packs_made(pack_id, title, version, made_at)` に記録。**同じ `packId` で作り直すと `version` が上がる**。
- 作った自分の端末には、**自分のパックは棚に自動で入れない**(自分のステッカーはもうコレクションにあるため)。

**受け取る側(Open Peta file… / Redeem Code… ではなくファイルのみ)**
- `PETAPACK` を開くと、**確認ダイアログ**(同意なしには取り込まない)を出す: パック名、作者名(**友達の名前 + 指紋**、初めての鍵なら「新しい友達」)、枚数、**開くと 1 枚ずつランダムに出る**こと。
- **Add to my shelf** で、次を行う(1 つのトランザクション):
  1. 署名を検証(§2。**検証の前に添付を展開しない**)。
  2. `packId` が棚に無ければ新規に追加、**同じ `packId` で `version` が同じなら「もう棚にあります」**、**`version` が上がっていれば、まだ無い `key` の分だけを追加**する。
  3. ステッカーは **Pack のステッカーと同じ扱い**(`SourceType::Pack`、ORIGINAL 番号なし、裏面は Received で「Received from: パック名」、作者は `author`)。
- 開封は既存の Pack と同じ(1 枚ずつランダム)。**`rarity` を使って抽選の重みを付ける**(Common 60 / Uncommon 30 / Rare 10。**重みは 1 か所の定数**にして、あとで変えやすく)。
  - ただし**中身が無くなった等級は、残りの等級に重みを回す**(Rare が無ければ Common と Uncommon だけで抽選)。
- 受信箱には出さず、**棚(Packs)に直接**並べる。公式のパックと同じ見た目で、タグに `by Nao ✓` を出す。
- **Welcome Pack の「1 日 1 回」のルールは、公式の Welcome Pack だけ**に残す。友達のパックは、Market のパックと同じく**いつでも何度でも**開けられる(中身がなくなるまで)。

**やらないこと(Step 6)**: アプリ内での値段・決済・Scraps のやり取り、友達の棚の自動取得(Phase B)、パックの更新通知、パックの削除の同期。

**テスト**
- 署名の改ざん、`author` が `Peta`、上限(枚数・サイズ)、`rarity` の不正値、同じ `packId` の二重取り込み、`version` が上がった時の差分だけの追加、**同意しない場合は DB が変わらない**。
- 開封の抽選で、重みと「等級が尽きたとき」の挙動(乱数を注入して確定的にテスト)。
- 作った `.peta` を別のデータフォルダで取り込むと、ステッカーが Pack として入り、元の写真や作者の ORIGINAL 番号が**混ざらない**。

---

# 5. 受け入れ条件

自動:
- `cargo test`(core・tauri 側の既存テストも含め**すべて**)と `npm test` が通る。
- 署名の改ざん・二重適用・期間外・未知の鍵・未知の素材・上限超えが**テストで拒否される**。
- DB は V7 から V8 へ移行でき、既存のデータ(ステッカー・素材・Pack・Gift)が**そのまま残る**。

手で確認(報告に手順と結果を書く):
1. `peta-pass keygen` → 公開鍵を `official_keys.rs` に入れてビルド。
2. `extra_envelope` のファイルを作って開く → 今日開封済みでも**もう 1 通**開けられる。
3. 同じファイルをもう一度開く → 「もう受け取り済み」。
4. コード(`--as-code`)を Redeem Code に貼る(大文字小文字・ハイフン違いでも通る)。
5. `grant_pack` のファイルを開く → パックが棚に増える。
6. Gift を作って別のデータフォルダ(別ユーザー相当)で受け取る → 「新しい友達」→ 2 通目で ✓。ファイルを 1 バイト書き換えると拒否。
7. **Make a Pack…** で 4 枚のパックを作り、別のデータフォルダで開く → 確認ダイアログ → 棚に並ぶ → 開封して Rare の演出になる。
8. 同じパックを `version` を上げて作り直し、もう一度取り込む → 増えた分だけが入る。作者名を `Peta` にしたファイルは拒否される。

---

# 6. やらないこと(Phase A の範囲外)

- **ネットワーク通信**(配布サーバーの確認・自動取得)。**Phase B として別の指示**で行う(静的ファイルの取得、起動時と数時間おきの確認、短い合言葉)。
- アカウント、ログイン、決済、プッシュ通知、集計、不正対策(時計の改ざん等)。
- 配布済みの取り消し、「先着 N 人」の制限、コードの端末またぎの使用制限。
- **売り買い**(値段の表示・決済・Scraps のやり取り)、**友達の棚(フィード)の自動取得**・Market への集約(Phase B 以降)。作者パックの売買は、**アプリの外**(BOOTH など)で行い、Peta は署名つきファイルの取り込みだけを受け持つ。
- 抽選の確率・素材カタログ・Scraps / Market の仕様変更(これらは別の議論)。
- 画像・アートの制作。

---

# 7. 納品

- Step ごとにコミット(例: `feat(sign): ed25519 signing foundation`)。指定ブランチへ push。
- `docs/signed-distribution-report.md`: 各 Step で何を作ったか、設計の判断(特に**迷った点と選んだ理由**)、**限界(§0)をコードのどこにコメントしたか**、手での確認の結果、残した TODO(特に `TODO(owner)`)。
- `docs/decisions.md` には**書かない**(オーナーが決定するときに追記する)。必要なら「提案」として報告書に書く。
