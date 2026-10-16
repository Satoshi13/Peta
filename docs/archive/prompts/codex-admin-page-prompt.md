# Codex への依頼: オーナー専用の管理ページ(友達・招待・クーポン)

**使い方**: この文書の全文を Codex に渡す。**実装の指示**(TypeScript の Worker、HTML/CSS/JS、Rust の少し、Python/Bash の手順)で、画像制作ではない。作業は **Step 順**。各 Step の終わりに下の「テスト」をすべて通し、**Step ごとにコミット**する。

> 日本語で指示。コード中のコメントと UI の文言は、既存に合わせて**英語**。説明文書は日本語。

---

# 0. 目的と前提

オーナー(1人)は今、作業ごとに別の場所を使っている。

| 作業 | 今 |
|---|---|
| 友達のメールアドレスの登録・削除 | Cloudflare ダッシュボード → Zero Trust → Access → ポリシー `Peta friends` を手で編集 |
| 招待コードの停止・再開・状況 | ターミナルで `scripts/beta-invites.sh` |
| クーポンの発行・締切・状況 | ターミナルで `scripts/coupon.py`(毎回、公式の鍵の暗号化ディスクをマウントして署名) |
| 配布の状況(誰がどの版を落としたか) | `beta-invites.sh status` / `summary` |

これを **オーナーだけが入れる 1 枚の Web ページ**(スマホでも使える)にまとめる。クーポンはこのページで**ボタン1つで発行**できるようにする。そのため **クーポン専用の署名鍵**をサーバー(Worker の secret)に置き、アプリはその鍵を **詰め合わせ(bundle)だけ・上限の範囲だけ**で信用する。これはオーナーが決めた(リスクの受け入れも含む。§2.2)。

**本番へのデプロイ、Cloudflare/Zero Trust の設定、秘密の作成・登録はオーナーがやる。** Codex はやらない(手順書を書く)。

## 必ず最初に読む(既存の仕組み)

| 読むもの | 何があるか |
|---|---|
| `docs/download-page-howto.md` | ダウンロードページ、Access(チーム `peta-friends`、One-time PIN、ポリシー `Peta friends`)、招待コード、`beta-invites.sh` |
| `docs/coupon-howto.md` | クーポンの仕組み、上限、`coupon.py` |
| `cloudflare/peta-download/src/{index,access}.ts` とテスト | Access の JWT を Worker で毎回検証するやり方、`emailHash`、招待コードの発行・付け替え、`downloads` 表、セキュリティヘッダー、ページのデザイン(`public/`) |
| `cloudflare/peta-api/src/{index,invites,coupons}.ts`、`migrations/0005_invites.sql`・`0006_coupons.sql` | 招待・クーポンの表、受け取り口、`assertion`/`batch` の流儀 |
| `src-tauri/crates/core/src/{sign,events,official_keys,scraps}.rs` | 署名つきファイル `PETAEVNT` の形式(`sign::seal`: MAGIC 8 · version 1 · u32 BE ヘッダー長 · ヘッダー JSON · 本体 · Ed25519 署名 64)、`Signer::Official{keyId}`、`bundle`(`scraps::Grant`、`check_grants`、`grant_cap`、`apply_grants`) |
| `src-tauri/crates/peta-pass`、`scripts/coupon.py` | 今の手元署名の流れ(残す) |
| `docs/official-key-howto.md` | 公式の鍵 `k1`(テスト)/`k2`(本物、オーナーが作る) |

**守ること**
- 既存の `peta-download`・`peta-api` の挙動、D1 の既存の表の意味、`PETAEVNT`/`PETA1` の形式、`KEYS` の並び(PETA1 のスロット)は**変えない**。D1 の追加は新しいマイグレーション(`0007_…`)だけ。
- 公式の鍵(`k*`)の扱いは変えない。公式パック・ステッカー(画像つき)は今までどおり手元の `peta-pass` だけで作る。
- **秘密をリポジトリ・ログ・画面・チャットに出さない**(クーポン鍵の秘密部分、Cloudflare API トークン)。テストの鍵はテスト内で生成するか、公開済みの RFC 8032 テストベクトルだけを使い、そう明記する。

---

# 1. 全体の形

```
オーナー ──(Access: 新しいポリシー「Peta owner」= オーナーのメールだけ)──▶ peta-admin Worker(新規 cloudflare/peta-admin)
                                                                          │ secret: COUPON_SIGNING_KEY, CF_API_TOKEN
                                                                          ├─ D1 peta-prod(invites, downloads, coupons, coupon_claims, admin_log)
                                                                          ├─ R2 peta-downloads-prod の releases/latest.json(読むだけ)
                                                                          └─ Cloudflare API: ポリシー「Peta friends」のメール一覧を読む・書く
友達のアプリ ── Redeem Code… ──▶ peta-api /v1/coupons/redeem(既存。変更なし)──▶ 署名を確かめて受け取る
```

- **別の Worker にする**理由: 秘密(クーポン鍵、API トークン)を友達が入る `peta-download` に置かない。Access のアプリケーションも別(オーナーだけ)。
- `peta-admin` も `peta-download` と同じく **Worker が Access の JWT を毎回検証**し、さらに **`OWNER_EMAILS`(var)に入っているメールだけ**を通す。`ACCESS_TEAM_DOMAIN`・`ACCESS_AUD`・`OWNER_EMAILS` のどれかが空・不正なら**全員を断る**(fail closed)。JWT 検証は `peta-download/src/access.ts` と同じ実装を使う(共有するなら `cloudflare/shared/` に移し、両方のテストを通す。コピーするならテストもコピーして、差分が出ないようにする)。
- `workers_dev: true`、`preview_urls: false`、`assets.run_worker_first: true`(静的ファイルも Worker を通す)。

---

# 2. クーポン専用の鍵

## 2.1 アプリ側(Rust)

- `official_keys.rs` に **`COUPON_KEYS`**(`KEYS` とは別の配列。PETA1 のスロットに影響させない)を足す。`c1` = テスト用(`cfg(any(test, feature="developer"))` のときだけ公開済み RFC 8032 テストベクトルの公開鍵。`k1` と同じ流儀)、本番は `None` で、オーナーが本物の公開鍵を **`c2` として末尾に追加**する(`// TODO(owner)` を残す)。
- `sign::resolve`(または events の trust)で、`keyId` が `COUPON_KEYS` にあれば、その鍵で検証する。**ただし `events::decode` の後で、クーポン鍵で署名されたイベントは `kind == "bundle"`・添付なし、でなければ拒否**("This coupon key can only give bundles.")。上限は既存の `check_grants`/`grant_cap` がそのまま効く。`revoke` などもクーポン鍵では不可。
- テスト: クーポン鍵の bundle は受け取れる/クーポン鍵の `grant_pack`・`grant_sticker`・`extra_envelope`・`revoke` は拒否/上限超えの bundle は拒否/公式の鍵 `k*` の挙動は不変/本番ビルド(`developer` なし)では `c1` を信用しない。

## 2.2 リスク(オーナー承認済み。手順書にも書く)

- Worker が乗っ取られると、**上限内の詰め合わせ**(Scraps・封筒・素材・リンクタグ・ボード・ショップのパック)を勝手に作られうる。画像・お金・個人情報には及ばない。
- 止め方: 管理ページの全クーポン停止(§4)と、アプリの `COUPON_KEYS` から該当鍵を外した版を配る/新しい鍵 `c3` に差し替える。手順を `docs/admin-page-howto.md` に書く。

## 2.3 Worker 側(TypeScript)で bundle を作る

- `PETAEVNT` v1 を Rust の `sign::seal` と**バイト単位で同じ**に組み立て、WebCrypto の Ed25519 で署名する。ヘッダーは `events::Event` と同じ JSON(`eventId, kind:"bundle", issuedAt, notBefore, notAfter, title, message, payload:{items:[{kind,id,count}]}, signer:{kind:"official",keyId}, attachments:[]`)。フィールド名・順序は Rust の serde 出力に合わせる(`Signer` の表現は `sign.rs` を見て合わせる)。
- **言語をまたぐ契約テスト**: Worker のテストが、固定のテスト鍵・固定の時刻で bundle を作り、`cloudflare/peta-admin/test/coupon-vector.json`(バイト列 base64、期待する items、公開鍵)を出力・照合する。Rust 側のテスト(`events.rs` か `tests/`)がこのファイルを `include_str!` で読み、`decode` → `apply_event` まで通ることを確かめる。`grant_cap` の上限一覧も同じファイルに入れ、Rust が自分の `grant_cap` と一致することを確かめる(Worker のフォームの上限と食い違わないように)。
- 秘密鍵は Worker secret `COUPON_SIGNING_KEY`(Ed25519 の 32 バイトの seed を base64)。`COUPON_KEY_ID` は var(prod `c2`、dev `c1`)。

## 2.4 鍵を作る手順(オーナー用スクリプト)

- `scripts/coupon-key.sh [prod|dev]`: 新しい Ed25519 鍵を作り、**秘密部分は画面にもファイルにも出さず**、パイプで `npx wrangler secret put COUPON_SIGNING_KEY --env <env>`(`cloudflare/peta-admin` で)に渡す。**公開鍵だけ**を表示し、「これを `official_keys.rs` の `COUPON_KEYS` に `c2` として追加」と案内する。既に secret があるときは上書きの確認を取る。
- dev は RFC テスト鍵 `c1` を使えるようにする(手順書に、公開済みのテスト鍵であることを明記)。

---

# 3. Cloudflare API でメール一覧を扱う

- secret `CF_API_TOKEN`(オーナーが作る。権限は **Access: Apps and Policies の Edit だけ**、対象アカウントだけ)。var `CF_ACCOUNT_ID`、`ACCESS_FRIENDS_POLICY_ID`(ポリシー `Peta friends` の ID。オーナーが調べて入れる)。
- **再利用可能ポリシー**(account レベルの Access policies)の取得・更新 API を使う。**実装前に Cloudflare の現行の API ドキュメントで、エンドポイントと include の形(`{"email":{"email":"..."}}`)を確認**し、報告に URL を書く。取得 → 一覧を変更 → 同じポリシーを更新(他の項目は保持)。
- メールは小文字・前後の空白なしに正規化し、形式を検査、重複を拒否。上限 200 件。**オーナー自身のメールは消せない**(締め出し防止)。
- API の失敗はそのままの文言を出さず、「Cloudflare didn't accept the change. Nothing was changed.」などにして、詳細は `admin_log` に残す(トークンは残さない)。
- テストは `fetch` を差し替えて(依存注入。本番コードにテスト用の裏口を作らない)、取得・追加・削除・失敗・自分を消せない、を確かめる。

---

# 4. 管理ページの機能

ルートはすべて `peta-admin` の中。API は `POST` は `Origin` が自分と一致し `Content-Type: application/json` のときだけ受ける(CSRF)。`GET` は副作用なし。全操作を `admin_log(at, action, detail)` に記録(メールはハッシュで。`detail` に秘密を入れない)。

## 4.1 Friends(友達)

- 一覧: ポリシー `Peta friends` のメール + それぞれの **招待コードの状態**(まだページを開いていない/コードあり・Mac 未使用/Mac 使用中(いつから)/停止中)、**最後にダウンロードした版と日時**。招待とダウンロードは `peta-download` の `emailHash` と同じ計算で突き合わせる(同じ関数を共有するか、同じテストベクトルで一致を確かめる)。
- 追加: メールを1つ(または改行・カンマ区切りで複数)入れて Add。追加後に「Discord/LINE に送る文」(ページの URL と手順)をコピーできるボタン。
- 削除: 確認ダイアログで「ページに入れなくする」+「招待も止める(その Mac がつながらなくなる)」をまとめて行う(招待の停止は `invites.revoked_at`)。
- 招待の停止・再開だけもできる。

## 4.2 Coupons(クーポン)

- 発行フォーム:
  - 名前(`^[A-Z0-9][A-Z0-9-]{2,23}$`、自動で大文字。既存の名前は不可)
  - 中身の行を足していく形: 種類(Scraps / Envelopes / Material / Tool / Pack)→ 種類によって id の選択肢 → 数(上限を表示し、超えたら送れない)。最大10行、同じ物は1行。
  - 期間: 開始(省略で今)、終了(日付ピッカー。その日の終わりまで。既定は14日後)。時刻はオーナーの端末の時間帯で表示し、保存は UTC。
  - 先着の台数(省略で無制限)、見出し(既定 `From Peta`)、ひとこと
  - 送信前に「こう見えます」の確認(中身・期間・人数)
- 発行: Worker が §2.3 で署名し、`coupons` に INSERT(`peta-api` が読むのと同じ形。`event` は base64)。`event_id` は `cpn-<name 小文字>-<YYYYMMDDHHmm>`。
- 発行後: 「Discord に貼る文」(`docs/discord-server-plan.md` のクーポンのテンプレートの形)をコピーするボタン。
- 一覧: 名前・中身(event をデコードして表示)・期間・受け取り台数/上限・状態(open / not yet / ended / used up / stopped)。**停止**ボタン。**全部停止**(緊急用、確認つき)。
- `coupon.py`(手元の公式の鍵で署名する方法)も残す。どちらで作っても同じ一覧に出る。

## 4.3 Release(配布の状況、読むだけ)

- `releases/latest.json` の版・サイズ・公開日。版ごとのダウンロード人数(`downloads`)。DMG のアップロードはしない(`publish-release.sh` のまま)。

## 4.4 見た目

- `peta-download/public/` のデザイン(紙・インク、等幅の小見出し)に合わせる。スマホ幅 375px で横スクロールなし、操作は親指で押せる大きさ。外部のスクリプト・フォントは使わない(CSP は `peta-download` と同じ強さ)。
- 3つのタブ(Friends / Coupons / Release)。危ない操作は赤・確認つき。

---

# 5. D1

- `cloudflare/peta-api/migrations/0007_admin.sql`: `admin_log(at INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL)` と索引。ほかに必要な列があれば足す(既存の表の意味は変えない)。`peta-admin` の `wrangler.jsonc` の `migrations_dir` は `../peta-api/migrations`(`peta-download` と同じ)。

---

# 6. Step

1. **Rust: クーポン鍵の信用(§2.1)と契約テストの受け口**。テスト。
2. **Worker の骨組みと認証**: `cloudflare/peta-admin`(package.json・wrangler.jsonc の dev/prod・vitest)、Access JWT + `OWNER_EMAILS`、fail closed、セキュリティヘッダー、`admin_log`。テスト(オーナー以外・不正 JWT・設定なしは全部 403、オーナーは 200)。
3. **bundle の署名(§2.3)と契約ファイル**。Worker テストで生成・照合、Rust テストで受け取りまで。
4. **Coupons の API と画面(§4.2)**。テスト(発行・名前の重複・上限・期間・停止・全部停止・`peta-api` の受け取り口がそのまま読めること)。
5. **Friends の API と画面(§3, §4.1)**。テスト(Cloudflare API を差し替えて)。
6. **Release の表示(§4.3)**。
7. **`scripts/coupon-key.sh`(§2.4)と手順書** `docs/admin-page-howto.md`: Access アプリケーション(workers.dev に Access を有効化、新しいポリシー `Peta owner`=オーナーのメールだけ、One-time PIN、AUD を var に)、`CF_API_TOKEN` の作り方(最小権限)、ポリシー ID の調べ方、`OWNER_EMAILS`、`COUPON_SIGNING_KEY`、`COUPON_KEY_ID`、マイグレーション、デプロイ、`COUPON_KEYS` に `c2` を入れた版のアプリを配るまでクーポン鍵のクーポンは受け取られないこと、§2.2 のリスクと止め方。`docs/coupon-howto.md`・`docs/download-page-howto.md` から管理ページへのリンクを足す。

# 7. テスト(各 Step の終わりに全部)

```bash
cd cloudflare/peta-admin && npm test && npx tsc --noEmit
cd cloudflare/peta-download && npm test && npx tsc --noEmit
cd cloudflare/peta-api && npm test && npx tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml --workspace --features server
cargo test --manifest-path src-tauri/Cargo.toml --workspace
npm test
```

ディスクの空きが少ない Mac なので、Rust は `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0` で回してよい。

# 8. 受け入れ条件

- オーナー以外(友達のメール、不正・期限切れの JWT、設定が空)は、ページも API も 403。
- 管理ページで発行したクーポンを、Peta Developer(dev、`c1`)の Redeem Code… で受け取れる(手で確かめられない場合は、契約テストと `peta-api` のテストで代える、と報告に書く)。
- 本番ビルドのアプリは、`c2` が入るまでクーポン鍵の bundle を受け取らない。クーポン鍵では bundle 以外を作れない。
- 友達の追加・削除が Cloudflare のポリシーに反映され(テストでは差し替え)、オーナー自身は消せない。
- 秘密がリポジトリ・ログ・応答・`admin_log` に出ない。
- 報告 `docs/archive/reports/admin-page-report.md`: やったこと、確認した Cloudflare API のドキュメント、テスト結果、オーナーがやること(順番つき)、未確認のこと。
