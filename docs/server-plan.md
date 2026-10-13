# サーバー(審判役・友達・Gift の受信箱)統合設計書

決定日: 2026-10-12(オーナー)。**方針と設計の記録で、Worker のコードは未着手**。置き場所(D1・R2)は作成済み → [`server-resources.md`](server-resources.md)。

この文書は次の2つを**置き換える**(古い文書は経緯として残す):
- [`gift-inbox-plan.md`](gift-inbox-plan.md)(2026-10-06): Gift v2(コピー)と DB V9 が前提だった。受信箱・友達・通報・公開前チェックリストの考え方は**ここに引き継ぐ**。
- [`static-catalog-plan.md`](static-catalog-plan.md)(2026-10-05): 公式カタログは**廃止**(§決めたこと 3)。

## なぜ要るか

V12〜V13 で、ステッカーは「本物を持つ・手放す・受け取る」(Gift v3 の release/claim)になり、Pack は番号つきの版を刷るガチャになった。アプリ側の受け口は `ownership::Referee`(`register` / `release` / `claim` / `claim_slot`)だが、中身は全部通す `NoReferee`。そのため今は:
- 同じ Gift ファイルを複数人が受け取れる。
- 同じパックのファイルを複数人が別々に開くと、同じ番号の版が複数できる。

連鎖(署名つきの履歴)は**証拠**であって**強制ではない**。強制には、全端末が同じ台帳を見る**審判役**が要る。

## 決めたこと(オーナー、2026-10-12)

1. **つながらないときは失敗にして元に戻す**。審判役の確認が要る操作(Gift を送る・受け取る、パックを刷る・開ける)は、サーバーの OK がなければローカルの変更をすべて戻す。ファイルは手元に残るので、つながってからやり直せる。
2. **Scraps は当面、端末に置いたまま**。最初のサーバーは審判役・友達・受信箱だけ。友達の間で Scraps を払う・売り手に取り分を渡す段階で、サーバーで持つかを改めて決める。
3. **公式カタログは廃止**し、Market は友達だけにする(2026-10-09 の決定と揃える)。同梱の無料パックはアプリに入ったまま。
4. **サーバーができる前に配られたものは、すべて「未確認」のまま**。サーバー以前の Gift・パックの版は台帳に載せず、確認済みにはしない。確認済みになるのは、サーバー以後に登録されたものだけ。
5. **届出**: Peta が完全に無料(料金・広告・アプリ内課金なし)の間は電気通信事業の「営む」に当たらず、届出は不要(総務省「電気通信事業参入マニュアル(追補版)」の「営む」の定義)。**お金を取り始める前に届出をする**。通信の秘密は、届出の有無にかかわらず設計で守る(運営者は中身を見ない)。

## 全体の構成

```
Peta(Mac)                                   Cloudflare
  device_key(Ed25519)で署名 ──HTTPS──▶  Worker「peta-api」
                                              ├─ D1: 台帳(持ち主・版の枠)・友達の許可・受信箱の索引・nonce
                                              └─ R2: 暗号化した Gift(7日で自動削除)
```

- Worker は1つ(`cloudflare/peta-api/`、TypeScript、`wrangler.jsonc` に `dev` と `prod` の環境)。
- 住所: 開発用は `peta-api-dev.<サブドメイン>.workers.dev`。本番は公開前に独自ドメイン(`api.<ドメイン>`)へ。アプリの接続先は定数1か所(開発者版は上書き可)。
- **秘密鍵は Worker に置かない**。Worker は署名を**検証**するだけ。
- 段階(§段階)ごとに Cargo feature で切る。**配布版では、その段階を公開すると決めるまで通信コードをコンパイルしない**。

## 共通: リクエストの署名

`gift-inbox-plan.md` のまま: `X-Peta-Key`(署名公開鍵)・`X-Peta-Time`(UNIX 秒、±5分)・`X-Peta-Nonce`(16バイト)・`X-Peta-Sig`(メソッド・パス・時刻・nonce・本文の SHA-256 への Ed25519 署名)。
- **nonce を記録するのは、データを変えるリクエストだけ**(GET は時刻の窓だけで検証)。D1 の書き込みの無料枠(1日10万行)を nonce で使い切らないため。
- 時刻のずれは `clock_skew` で返し、アプリは「Mac の時計を確認してください」と出す。

## 段階1: 審判役(台帳)

**サーバーが持つのは「誰が今持っているか」と「どの枠が引かれたか」だけ**。画像も Gift の中身も持たない。

### 台帳(D1)

| 表 | 列 | 意味 |
|---|---|---|
| `stickers` | `id` PK、`creator_key`、`holder_key`、`state`(`held` / `released`)、`seq`(次に来る transfer の番号)、`release_ref`、`registered_at`、`updated_at` | 1枚の本物の今の持ち主 |
| `transfers` | `sticker_id`、`seq`、`kind`、`actor_key`、`ref`、`at`、`sig`、`received_at`。PK(`sticker_id`, `seq`) | 監査用の記録(アプリの連鎖と同じもの) |
| `packs` | `pack_id` PK、`creator_key`、`slot_count`、`header_digest`、`registered_at` | 刷られたパック |
| `pack_slots` | `pack_id`、`slot_no`、`claimer_key`、`claimed_at`。PK(`pack_id`, `slot_no`) | 引かれた枠 |
| `nonces` | `key_hash`、`nonce`、`expires_at` | 再送防止(10分) |
| `blocked_keys` | `key_hash`、`reason`、`at` | 運営の拒否リスト(段階2の通報から) |

### API

| メソッド・パス | 誰が | 規則 |
|---|---|---|
| `POST /v1/stickers` | 作者 | `Creation`(署名つき)を送る。`creator_sig` を検証し、`id` が未登録なら `holder=creator`・`state=held`・`seq=0` で登録。**同じ内容の再送は OK(冪等)**、別の内容で同じ `id` は `409 taken` |
| `POST /v1/stickers/{id}/release` | 今の持ち主 | `Transfer(kind=release)`。`actor_key==holder_key`・`state=held`・`seq` が一致・署名が正しいときだけ `state=released`、`release_ref=ref`。同じ transfer の再送は OK |
| `POST /v1/stickers/{id}/claim` | 受け取る人 | `Transfer(kind=claim)`。`state=released`・`ref==release_ref`・`seq` が一致・署名が正しいときだけ `holder=actor`・`state=held`。**2人目は `409 already_claimed`**。同じ transfer の再送は OK |
| `POST /v1/stickers/{id}/cancel` | 今の持ち主 | 自分の release の取り消し。`state=released` で `release_ref` が一致し、まだ誰も claim していなければ `state=held` に戻し `seq` も戻す。すでに `held` なら OK(冪等)。端末側の確定に失敗したときだけ使う |
| `GET /v1/stickers/{id}` | 誰でも(署名つき) | `holder_key`・`state`・`seq`。Collection の「確認済み」表示と復旧に使う |
| `POST /v1/packs` | 刷った人 | **1回のリクエストで**、パック(`pack_id`・枠の数・ヘッダの SHA-256)と、中の版すべての `register` + `release` を登録する。D1 の batch で**全部か無しか**。景品の枠も数に含める |
| `POST /v1/packs/{id}/slots/{n}/claim` | 開ける人 | 枠 `n` が未使用なら引いた人を記録。中身が本物の版なら、**同じリクエストで**その版の `claim` も行う(どちらかが失敗したら両方なし)。使用済みは `409 slot_taken` |
| `POST /v1/packs/{id}/cancel` | 刷った人 | **まだ1枠も引かれていなければ**、パックの登録・その時に登録した版・パックへ移した本物の release をまとめて取り消す。端末側の確定に失敗したときだけ使う |
| `GET /v1/packs/{id}/slots` | 誰でも(署名つき) | 引かれた枠の番号の一覧。**アプリは開ける前にこれで残りを合わせ、引かれた枠を除いて抽選する**(他の人が先に引いた枠を何度も引かないため) |

署名のバイト列は Rust の `Creation::bytes()` / `Transfer::bytes()` と**完全に同じ**でなければならない(serde_json のタプル = JSON 配列)。Worker 側で同じ配列を組み立てて検証する。**Rust のテストで作った検証用データ(JSON)を Worker のテストが読む**ことで、言語間のずれを防ぐ。

### アプリ側

- `HttpReferee`(`Referee` の実装)を追加し、開発者版で `NoReferee` と差し替える。`Referee` の形は変えてよい(`register` は `Creation` 全体を受け取る、`claim_slot` は版の `claim` を一緒に受け取る、など)。
- **ステッカーを作るのはオフラインでもできる**。`register` は「登録待ち」に積み、つながったときに送る。手放す(Gift・パック)前に登録が済んでいなければ、先に登録する。作ることを止めないため(決めたこと 1 は「渡す・受け取る」操作の話)。
- **サーバーの OK と端末の確定がずれたときの復旧**:
  - release(Gift を送る・パックを刷る)が通ったあと端末の確定に失敗したら、または応答が来なかったら、**`cancel` で取り消す**(ファイルは端末の失敗で消えているので、外に出た Gift はない)。`cancel` も届かなければ「取り消し待ち」に積み、次の起動で再試行する。取り消しが済むまで、そのステッカーは渡せない。
  - claim が通ったあと端末の確定に失敗したら、Gift ファイルが残っているので、受け取り直すと同じ transfer の再送になり OK が返る。
  - パックの枠: 開ける前に「この枠を引く」を端末に記録してから送る。応答が来なかったら、**次も同じ枠で**再送する(別の枠を引くと、1人で2枠を使い、片方が誰にも渡らなくなる)。
- **サーバー以前のもの**(決めたこと 4): 移行のとき、**この端末の鍵で作り、一度も手放していない原本**(`transfers` が空で `pressed` でない)だけを登録する。受け取った本物・旧形式の Gift・サーバー以前に刷られたパックの版は登録せず、`pre_server` として「未確認」の表示を続ける。これらはファイルで渡すことはできるが、台帳では追わない。サーバー以前に刷られたパックは、開けるときも `claim_slot` を呼ばない(今の「Edition numbers are not checked by a server yet」のまま)。
- 表示: 確認済み = 台帳の持ち主がこの端末の鍵と一致する本物。文言は `Checked by Peta` / `Not checked`(UI の文言は英語)。
- 失敗の文言: `offline`(「Connect to the internet to receive this.」)、`already_claimed`(「Someone already received this gift.」)、`slot_taken`(引き直し。利用者には見せずに残りを合わせて自動で引き直す。3回失敗したら止める)。

## 段階2: 友達と Gift の受信箱

`gift-inbox-plan.md` の「友達と許可(承認制)」「API(受信箱)」「送信・受信の流れ」「通報・ブロック」を**そのまま使い**、次だけ変える:

- 包む中身は **Gift v3 ファイル**(本物の譲渡)。受信箱は**運び方が増えるだけ**で、受け取りは段階1の `claim` を通る。
- **送る**: release(段階1)→ 暗号化してアップロード → 両方が通ってから端末で確定。アップロードが失敗したら、自分の release を claim し直して取り戻す。
- 「1つの Gift は1回だけ」は**審判役が保証する**(受信箱を削除するタイミングに頼らない)。
- DB の追加は V14 以降(`friends` の拡張など。番号は実装時の最新に合わせる)。
- **鍵の書き出し・復元(Export / Import identity)をこの段階に入れる**。台帳の持ち主は鍵で決まるので、鍵をなくすと**持っている本物を二度と渡せない**。友達限定ベータの前に必須。
- 届出が要らないのは無料の間だけ(決めたこと 5)。

## 段階3: 友達の Market

**設計は [`server-s3-market-plan.md`](server-s3-market-plan.md)**(2026-10-13、オーナーが推奨案どおりに決定。Codex への依頼書は [`codex-server-s3-prompt.md`](codex-server-s3-prompt.md))。要点: Scraps は端末のまま(決めたこと 2 を維持)で、友達のパックを引く取引だけを審判役が記録する。出品は暗号化して R2 に置き、承認済みの友達だけが見られる。引くのは1回 6 Scraps で、売り手に 70%(どちらも仮の初期値)。

## 費用の見込み(2026-10 の料金表)

- 段階1だけなら 1人1日数リクエスト。**約2万人まで無料枠**。
- 段階2を足すと、15分ごとの受信箱確認で 1人1日最大約50リクエスト。**約1,000人まで無料**、それ以上は月5ドルの有料プランで約5,000人まで。新着がない間は確認の間隔を延ばす。
- 無料の `workers.dev` ではダッシュボードのレート制限ルールが使えないので、**Worker の中で回数を制限する**(鍵ごと・IP ごと)。独自ドメインに移したらルールも足す。Cloudflare の使用量通知はオーナーが設定する。

## 段階と作業の区切り(Codex 向け)

| 段階 | 内容 | 配布版 |
|---|---|---|
| S1 | Worker(台帳・署名検証・回数制限)とテスト、`HttpReferee`、登録待ち、サーバー以前の印、枠の同期、復旧。Cargo feature `server`(`developer` が有効にする) | 無効 |
| S2 | 友達・受信箱・Export/Import identity・通報・拒否リスト・Settings | 友達限定ベータで有効 |
| S3 | 友達の Market([`server-s3-market-plan.md`](server-s3-market-plan.md)) | 友達限定ベータで有効 |
| S4 | 公開前チェックリスト(`gift-inbox-plan.md` の末尾。電気通信事業法の項は決めたこと 5 で更新)と公開前確認([`release-readiness-audit-2026-10-13.md`](release-readiness-audit-2026-10-13.md))→ 機能フラグを外す | 公開 |

各段階で `cargo test` と `npm test`、Worker は `vitest`(`@cloudflare/vitest-pool-workers`)を通す。**本番(`--env prod`)へのデプロイはオーナーが行う**。開発用(`--env dev`)は Codex / Claude が行ってよい。

**S1 の受け入れ条件の例**: 2つのデータフォルダ(2台の端末の代わり)で、A が作る → 登録される → A が Gift を保存 → B と C が同じファイルを受け取ろうとする → **B だけが受け取れ、C は `already_claimed` で何も変わらない**。同じパックのファイルを B と C が開く → 同じ枠は1人だけ、残りは自動で別の枠を引く → 版の番号は全体で重複しない。オフラインでは受け取り・開封・送付が失敗し、端末は元のまま。作るのはオフラインでもでき、つながると登録される。署名の改ざん・nonce の再利用・時刻のずれ・他人の release は拒否。サーバー以前の Gift は「Not checked」のまま受け取れる。

## まだ決めていないこと

- ~~段階3(友達の Market)の全体と、Scraps をサーバーで持つか。~~ → 2026-10-13 に決定([`server-s3-market-plan.md`](server-s3-market-plan.md))。
- 決めたこと 5(届出)を、Gift・Market の実際の運用を説明して管轄の総合通信局に確認すること(公開前確認の指摘)。
- データ削除の手段(App Store 5.1.1(v))。台帳から鍵を消すと、その人の持つ本物は誰にも渡せなくなる。鍵を匿名の印に置き換える案などを S2 で決める。
- 本番の独自ドメイン名。
- 通報の通知手段(メールか Discord の Webhook か)。

## 2026-10-14: ベータ版のビルド（B1）

| 作業 | 状態 | 配布条件 |
| --- | --- | --- |
| 通常設定＋serverの `npm run build:beta` | 実装済み | 本番はオーナーが準備する。本番のR2・D1・deploy・secret・使用量通知と実機往復の確認が済むまで配らない |

通常版は通信なし、Developerはdev。本番APIを照会する検証は行わない。
