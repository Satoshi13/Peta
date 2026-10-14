# Codex への依頼: 管理ページ第2弾(通報・アプリ内のお知らせ・ショップのピックアップ・マーケットの状況)

**使い方**: この文書の全文を Codex に渡す。**`docs/codex-daily-table-prompt.md`(毎日の封筒の確率表)の作業が終わってから**始める(署名つきの設定を配る仕組みを使い回すため)。作業は **Step 順**。各 Step の終わりに §8 のテストをすべて通し、**Step ごとにコミット**する。

> 日本語で指示。コード中のコメントと UI の文言は、既存に合わせて**英語**。説明文書は日本語。

---

# 0. 範囲

1. **通報の確認と対応**(管理ページ)
2. **アプリ内のお知らせ**(管理ページで書いて、アプリに帯で出す)
3. **ショップのピックアップ**(アプリの Market の「Featured」の決め方を変え、公式パックの部分を管理ページから設定)
4. **マーケットの状況**(管理ページで見るだけ。集計のみ)

## 必ず最初に読む

`docs/codex-admin-page-prompt.md`・`docs/admin-page-report.md`・`docs/admin-page-howto.md`、`docs/codex-daily-table-prompt.md` と `docs/daily-table-report.md`(配り方・署名・取得の間隔・上限の考え方)、`docs/server-howto.md` の通報の節、`cloudflare/peta-api/migrations/{0002_inbox,0003_market,0004_reports}.sql`、`cloudflare/peta-api/src/{index,inbox,market}.ts`、`src/app/js/market.js`(`MARKET_PACKS`、`packs()` の hero、`friendPacks()`、`FriendShop`)、`crates/core/src/{scraps,pack,events}.rs`、メモリ「Market is friends-only」の決定(マーケットは友達のパックだけ、公開のカタログにしない)。

## 守ること

- **運営は友達の出品の中身を見ない・広めない**。出品のカードとパックは友達ごとに暗号化されている(S3)。管理ページの「マーケットの状況」は**件数・量の集計だけ**で、誰が何を出しているかは出さない。
- 既存の表・形式の意味は変えない。D1 は新しいマイグレーション(`0009_…`)だけ。
- 秘密を書かない。本番のデプロイ・秘密の登録はしない。dev への D1 マイグレーションとデプロイはしてよい。**`peta-api` の prod は再デプロイしない**(配布の日にオーナーの指示でまとめて行う)。

---

# 1. 通報の確認と対応(管理ページ「Reports」タブ)

今は、通報が来ると Discord の Webhook に件数と ID が届くだけで、中身の確認・対応済みの記録・相手の停止は `wrangler` のコマンド(`docs/server-howto.md`)。これを画面でできるようにする。

- `peta-admin` に R2 `peta-reports-<env>` を `REPORTS` として bind(読む・消すだけ)。
- 一覧: 未対応を上に、ID・受け取った日時・理由・種類(Gift / Market の出品)・同じ送り手への通報の件数・対応済みの日時。送り手と通報者は**鍵ハッシュの先頭8文字**だけ見せる(人の名前はサーバーにない)。
- 詳細: R2 の `reports/<ID>.json` から、復号済みの Gift の画像(またはマーケットの出品のカードとパックの絵)とメモ・理由を表示。画像は `<img>` で `blob:` URL として出し、**HTML として解釈しない**。ダウンロードのボタンは付けない。
- 操作(確認ダイアログつき・`admin_log` に記録):
  - **Resolve**(対応済み): `reports.resolved_at` を入れる。既存の日次の Cron が 30 日後に中身を消す。
  - **Block sender**: 送り手の鍵ハッシュを `blocked_keys` に入れる(理由つき)。同じ送り手の未対応の通報もまとめて対応済みにするか選べる。
  - **Unblock**: `blocked_keys` から外す(Blocked の一覧を別に出す)。
- 未対応の件数をタブに表示。Discord の Webhook はそのまま(件数と ID だけ)。
- テスト: オーナー以外 403、一覧・詳細・Resolve・Block・Unblock、存在しない ID、R2 に中身がない(期限切れ)通報の表示。

# 2. アプリ内のお知らせ

Discord を使わない友達にも届くように、アプリの中に一行の帯を出す。

- 管理ページ「News」タブ: 本文(英語、140 字まで)、種類(info / event / maintenance)、開始・終了、任意のリンク先(**ダウンロードページか Discord の招待 URL の2種類だけから選ぶ**。自由な URL は入れない)。一覧・停止。
- 配り方: 確率表と同じ「クーポン鍵で署名した設定」(新しい種類 `announcement`)。`events::decode` のクーポン鍵で作れる種類に足す。サーバーは確率表と同じ取得の窓口で一緒に返す(`/v1/daily-table` を `/v1/config` に広げてもよい。既存の窓口は残す)。
- アプリ(`server` feature): 有効なお知らせのうち最新1件を、Today ページの上に**閉じられる帯**で出す(閉じたら同じお知らせは出さない)。本文は**プレーンテキスト**として表示(HTML にしない)。リンクはアプリに埋め込んだ2種類の URL のどちらかを開くだけ。offline 版にはない。
- テスト: 期間・停止・閉じた後・不正な種類やリンクは無視。

# 3. ショップのピックアップ(Market の「Featured」)

今は `market.js` の `packs()` で、hero(Featured)がいつも `MARKET_PACKS[0]`。これを次の順で決める(**アプリの中だけで決める**。運営に友達の出品の情報は渡らない)。

1. **友達の出品**: その人が見られる友達の出品のうち、**自分の出品でない・売り切れていない・ブロックしていない・カードが復号できた**もの。あれば**ランダムに1つ**。Market のページを開くたびに選び直し、開いている間は変えない。hero の表示は「From a friend」+ 友達の名前(端末の対応表。知らない人は出さない)+ カードの絵。ボタンは友達のレールと同じ `PackZoom` を開く。
2. **公式パック**: 友達の出品がなければ、**オーナーが管理ページで選んだピックアップ**(1つ以上。複数ならランダム)。設定がなければ、今と同じ `MARKET_PACKS[0]`。売っていない・持てない(上限)パックは除く。
3. **どちらもなければ hero ごと出さない**。

- オーナーの設定(管理ページ「Shop」タブ。確率表と同じ署名つきの設定 `shop_config`):
  - **Featured の候補**(公式パックから複数選択)、期間(なければ常に)。
  - **Official first**(任意。既定はオフ): 期間中は、友達の出品より公式パックを優先する(新しい公式パックを出した週などに)。
  - **New and popular の並び順**と、公式パックの**紹介文**の差し替え(英語、120 字まで)。
  - **売る・売らない**の切り替えと、**値段(Scraps)**。値段は `scraps.rs` の `PACKS` の既定値の **50%〜200%** だけ(アプリ側で上限を検査。範囲外の設定は丸ごと無視)。無料のパックを有料にはしない。
- `scraps.rs` の `trade` が使う値段は、有効な `shop_config` があればそれ、なければ既定値。**アプリの表示と実際に引かれる Scraps が必ず一致**すること(テスト)。
- offline 版: 友達の出品がないので、2(既定の `MARKET_PACKS[0]`)のまま。
- テスト(JS と Rust): 友達の出品があるとき・ないとき・自分の出品だけ・売り切れだけ・Official first の期間中・何もないとき hero が出ないこと、値段の上限と一致。

# 4. マーケットの状況(管理ページ「Market」タブ、見るだけ)

- D1 の `market_listings`・`market_sales` から**集計だけ**: 公開中の出品数、出品している人の数、日ごとの引かれた回数と動いた Scraps(30 日のグラフ)、売り手に入った取り分の合計。公式ショップ(端末の中だけの取引)はサーバーにないので出さない、と画面に一行書く。
- **個人の一覧(誰が・何を・いくつ)は出さない**。鍵ハッシュも出さない。
- グラフは外部のライブラリなしで(SVG を自前で)。管理ページの CSP のまま。
- テスト: 集計の値、空のとき。

# 5. 署名つきの設定のまとめ

- クーポン鍵で作れる種類: `bundle`、`daily_table`、**`announcement`、`shop_config`**。それ以外は拒否(既存のテストを広げる)。
- それぞれアプリ側に上限と形の検査を置き、範囲外は丸ごと無視(部分的に直して使わない)。
- 取得はアプリ1つにつき 6 時間に1回まで(確率表と同じ)。

# 6. Step

1. 通報(§1)。dev にデプロイ。
2. 署名つき設定の種類を広げる(§5)+ アプリ内のお知らせ(§2)。
3. ショップのピックアップ(§3。アプリの Featured の決め方 → 管理ページの Shop タブ → 値段の反映)。
4. マーケットの状況(§4)。
5. 手順書(`docs/admin-page-howto.md` に4つのタブの使い方と、通報の対応の流れ。`docs/server-howto.md` の通報の節から管理ページへのリンク)、報告 `docs/admin-round2-report.md`(オーナーがやること: prod の D1 マイグレーション、`peta-admin` prod の再デプロイ、`peta-api` prod は配布の日にまとめて)。

# 7. やらないこと

- 友達の出品を運営がピックアップ・宣伝すること。個人の Scraps の増減(クーポンで渡す)。絵つきの新しい公式パックをサーバーから配ること(アプリの更新で足す)。

# 8. テスト(各 Step の終わりに全部)

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

# 9. 受け入れ条件

- 管理ページで通報の中身を見て、対応済み・送り手の停止・解除ができ、すべて `admin_log` に残る。
- 管理ページで書いたお知らせが、dev の Peta Developer の Today に帯で出て、閉じたら出ない。本文に HTML を書いても文字として出る。
- Market の Featured は、友達の出品があればそれをランダムに、なければオーナーのピックアップ(なければ既定)を出し、どちらもなければ出さない。Official first の期間中は公式が先。
- ショップの値段は上限の範囲だけで、表示と実際の Scraps が一致する。
- マーケットの状況に、個人を特定できる情報が出ない。
