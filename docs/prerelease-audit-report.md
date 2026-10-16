# 配布前の総点検 報告(v0.1.0 友達限定ベータ)

2026-10-16。指示書は [codex-prerelease-audit-prompt.md](codex-prerelease-audit-prompt.md)。ブランチ `codex/ui-fixes-oct07`。

- この環境は Mac ではないので、**Rust はビルド・テストしていません**(読んで点検しただけ。Rust のコードは今回1行も変えていません)。Worker と JS のテストは全部回しました。
- Cloudflare へのデプロイ・D1 の操作・秘密の登録はしていません。
- オーナーの未コミットの作業(`src/app/js/`・CSS)とぶつからないよう、アプリの JS・CSS には触れていません。

**配る日の手順書: [release-day-runbook.md](release-day-runbook.md)**

---

## 1. 一覧

### 配る前に必ず直すもの

| 重さ | 場所 | 内容 | 直したか |
|---|---|---|---|
| 高(止まる) | `src-tauri/tauri.beta.conf.json` | 更新用の公開鍵 `plugins.updater.pubkey` が**空**。`build.rs` が beta のビルドを止める(意図どおりの安全装置)。公開鍵の入った版を最初に配らないと、後からアプリ内更新で届けられない。 | いいえ(オーナーが `updater-key.sh` で作る。runbook §1) |
| 高(止まる) | `src-tauri/tauri.conf.json` ほか | 版が `0.0.1`。v0.1.0 にする(アプリ・DMG の名前・更新の版は `tauri.conf.json` から読む)。`Cargo.toml`・`package.json` もそろえる。 | いいえ(配る日の判断。runbook §1) |
| 中 | `cloudflare/shared/access.ts` | Access の署名鍵を1時間キャッシュし、知らない鍵 ID のトークンを拒否していた。Access は鍵を交換するとすぐ新しい鍵で署名するので、交換の直後は**ダウンロードページと管理ページに最大1時間ログインできない**。 | **はい**(知らない鍵 ID なら取り直す。1分に1回まで。無ければ今までどおり拒否) |
| 中 | 3つの Worker の開発用依存 | `npm audit` が各7件(high 5)。どれも本番の Worker には入らない(テスト用の vitest / miniflare)。 | **はい**(下の §2) |
| 中 | 手順書 | 古い記述・食い違い(下の §4)。配る日にそのまま従うと迷う箇所があった。 | **はい** |
| 中 | `docs/terms-draft.md`・`privacy-policy-draft.md` | 施行日が未記入、公開場所が未定。アプリの About にリンクを出すなら `about.rs` の `SERVICE_LINKS` に URL を入れて**ビルド前に**。 | いいえ(オーナーの判断。runbook §1・§6) |

### 配った後でよいもの

| 重さ | 場所 | 内容と再現の筋道 | 直し方 | 直したか |
|---|---|---|---|---|
| 低〜中 | `src-tauri/Cargo.lock` の rustls 0.23.45 | §2 の4件。beta の更新(reqwest)と server の通信(ureq)だけに入る。offline には入らない。 | `cargo update -p rustls --precise 0.23.46`(パッチ版)→ Mac で全テストと更新の実機確認 | いいえ(アプリ本体の依存は上げない方針) |
| 低 | `peta-api/src/invites.ts` の `sweepRecords` | 一時停止(Pause)した招待は1年で行ごと消える(ポリシーどおり)。その友達が Access の `Peta friends` に**残ったまま**だと、次にページを開いたとき新しい有効な招待が作られ、停止が解ける。Remove した友達は Access で入れないので影響なし。 | 1年以上止めたままにするなら Remove する。または sweep で「Access にまだいる人」を残す(Access の一覧が必要で設計の変更) | いいえ(運用で回避。報告のみ) |
| 低 | `peta-api/src/coupons.ts` | 先着の数え方は D1 の batch(assertion → claim → +1)で原子的。ただし assertion は `claims<max_claims` だけを見て、**停止・期限切れを batch の中で見直さない**。読み取りと batch の間(ミリ秒)に Stop した場合だけ1台多く受け取れる。 | assertion の条件に `stopped_at IS NULL AND ends_at>?` を足す | いいえ(窓が極小。報告のみ) |
| 低 | 同上 | 同じ Mac が同じクーポンを**同時に**2回送ると、片方が主キーの衝突で 503 になる(もう片方は成功、再試行すれば同じイベントが返る)。害はない。 | `UNIQUE` を `already_claimed` 扱いにして既存のイベントを返す | いいえ |
| 低 | `invites.ts`・`coupons.ts` の試行制限 | 招待コード(10回/時)とクーポン名(20回/時)の制限は**署名鍵ごと**で、鍵はいくらでも作れる。ただし招待コードは50ビットで総当たりは現実的でない。クーポンは本番では招待済みの鍵しか試せない(`INVITE_REQUIRED`)。 | 必要になれば Cloudflare の WAF で IP ごとの制限 | いいえ |
| 低 | `cloudflare/shared/identity.ts` | メールのハッシュは塩なしの SHA-256(用途の接頭辞つき)。D1 が漏れると「このメールの人がいるか」を確かめられる。管理ページの手順書にも「仮名データで匿名化ではない」と明記済み。 | 秘密の pepper を足す(既存のハッシュが全部変わるのでデータ移行が要る) | いいえ(設計の変更) |
| 低 | Access のセッション | Remove した友達の Access のセッションは期限(1か月)までページの外枠を開ける。招待は止まるので DMG もアプリの通信も拒否される。手順書に記載済み。 | 即時に閉じるなら Zero Trust でセッションを失効 | いいえ(記載済み) |
| 低 | `peta-download/src/index.ts` | `HEAD /download/<DMG>` をダウンロード1回として数えていた。 | GET だけ数える | **はい** |
| 低 | `.gitignore` | Wrangler のローカル秘密 `.dev.vars` と `.env` が無視されていなかった(今は存在しない)。 | 追加 | **はい** |
| 低 | `scripts/check-binary-paths.py` | `Contents/MacOS` の実行ファイルの `/Users/` だけを見る。Resources やフレームワークは見ない。今の構成(Rust の実行ファイル1つ)では十分。 | 必要になれば対象を広げる | いいえ |
| 情報 | `official_keys.rs` | Developer 版はテスト鍵 k1・c1(公開済みの RFC 8032 の鍵)を信用する。**Developer 版は配らない**。`publish-release.sh` は識別子 `app.peta.desktop` 以外を拒否するので、誤って公開はできない。 | — | — |
| 情報 | `official_keys.rs` | 本物の公式鍵 `k2` はまだ入っていない。`coupon.py`(手元署名、既定 `--key-id k2`)のクーポンは本番のアプリで受け取れない。本番は管理ページ(c2)で出す。 | k2 を作って追加した版を配る | 手順書に追記 |

### 問題なし(読んで確かめたもの)

1. **管理ページ**(`peta-admin`): Access の JWT を毎回検証(RS256・`kid`・署名・`iss`=チーム・`aud`・`exp`/`nbf`・メールあり)。チームの書式と64桁の AUD が不正なら全員拒否。`OWNER_EMAILS` が空・1つでも不正なら `owners()` が null で全員拒否。`run_worker_first: true` で静的ファイルも認証の後。POST は `Origin` 一致と `Content-Type: application/json` を要求、16KB 上限、変更はロックで直列化。`admin_log` に入るのはハッシュ・名前・状態・数値コードだけで、秘密・トークン・JWT・メール本文は入らない(すべての `audit()` 呼び出しを確認)。Cloudflare API トークンは secret、ポリシーの読み書きだけに使い、応答の本文は記録・表示しない。通報の画像は PNG の先頭8バイトを確かめて base64 で返し、ページは `image/png` の `blob:` で `<img>` に出すだけ。`innerHTML` 等は使っていない。CSP・`nosniff`・`X-Frame-Options: DENY`・`no-store`。
2. **ダウンロードページ**(`peta-download`): 同じ Access の検証。DMG は `latest.json` が指すファイルだけを、Access と招待の確認の後に R2 から返す(公開 URL なし、`preview_urls: false`)。止めた招待には版も DMG も出さない。新しいコードは `Origin` 一致の POST だけ。コードの付け替えと peta-api の結び付けは、どちらも1文の UPDATE か D1 の batch(assertion つき)で、競合しても二重に結び付かない。メールはハッシュだけを保存。
3. **peta-api**: `/v1/health` 以外のすべてのルートが `authenticate()` を通り、その中で `INVITE_REQUIRED` を確認する(`/v1/invite` だけ例外)。クーポン・更新(確認とファイル)・設定(`/v1/config`・`/v1/daily-table`)も対象。更新ファイルのトークンは32バイトの乱数、D1 には SHA-256 だけ、10分、鍵ハッシュ・版・ファイルに結び付き、`latest.json` が変われば失効。ファイルの取得にもその Mac の署名が要る。`sweepRecords` は使用中の招待(`revoked_at IS NULL`)と期間中のクーポン(`ends_at` が未来で未停止)を消さない。
4. **クーポン鍵の範囲**(`crates/core`): `events::decode_with` がクーポン鍵(c*)の署名を `bundle`・`daily_table`・`announcement`・`shop_config` だけに限り、添付・本文があれば拒否。`bundle` は `scraps::check_grants`(`grant_cap`、1〜10種類、重複なし)。毎日の表は Matte 20% 以上・Special/Archive 各5%以下(`daily_tables::validate`)。ショップは知っている公式パックだけ・値段 50〜200%・無料パックに値段なし・一行120字(`signed_config::validate_shop`)。お知らせは140字・制御文字なし・リンクは `download`/`discord` の2択(`deny_unknown_fields` で自由な URL は入らない)。範囲外は `filter` で**丸ごと**捨てる。保存済みのものも読むたびに再検証。本番ビルドは `cfg!(any(test, feature="developer"))` でない限り c1・k1 の公開鍵が `None`。
5. **アプリ内アップデート**: `build.rs` が beta で公開鍵の形(minisign の Ed 鍵)と `requireSignedVersion: true` を必須にし、beta と developer の同時指定も止める。プラグインは 2.14.0 に固定、署名と署名された版番号を検証してからバイト列を返す(検証前のファイルは使わない・ディスクに残さない)。取得先は本番 API と同じ origin・https・`/v1/update/file/<64桁>` だけ(`allowed_url`)、リダイレクトは `Policy::none()`(プラグインのソースで、ダウンロードにも同じ client 設定が使われることを確認)。updater は `beta` feature だけにあり、offline と Developer には入らない。
6. **秘密がリポジトリにないこと**: 全履歴(380 コミット)を、秘密鍵の PEM・minisign の秘密鍵・Discord/Slack の Webhook・GitHub/AWS 等のトークン・`*_KEY=` の代入・パスワード・32バイトの base64 で検索。見つかったのは公開鍵(k1/c1/c2)・RFC 8032 のテスト用の秘密鍵(公開済みのテストベクタ)・テスト用のベクタだけ。`.key`/`.pem` などのファイルも履歴に無い。
7. **アプリが外に出すもの**: 通信のコード(`referee`・ureq)は `server` feature の中だけで、offline には rustls も reqwest も入らない(`cargo tree` で確認)。ログ(`eprintln!`)はレイヤー・同期の失敗など内部のエラーだけで、鍵・メール・本文は出さない。updater の詳しいログは `updater-test` だけ。`check-binary-paths.py` は `release-mac.sh` の署名あり・なし両方の経路で実行される。

## 2. 依存の指摘

### npm

| 場所 | 指摘 | 本番に入るか | 対応 | 危険 |
|---|---|---|---|---|
| ルート | 0件 | — | — | — |
| 3つの Worker | `vitest` 4.1.0 の `@vitest/mocker`(GHSA-82fw-gwwq-j7x9、moderate) | いいえ(テストだけ) | `vitest` 4.1.12(パッチ版) | 低。テスト全件成功 |
| 3つの Worker | `@cloudflare/vitest-pool-workers` 0.23.0(最新)が固定する `miniflare` の `undici` 7.29.0(GHSA 10件、high)・`sharp` 0.35.2(high)、それに伴う `wrangler` 4.124.0 | いいえ(テスト用。デプロイに使う `wrangler` 4.149.0 は元から修正済みの版) | `overrides` で miniflare の下の `undici` を 7.29.1、`sharp` を 0.35.5 に(デプロイ用 wrangler と同じパッチ版) | 低。テスト全件成功。pool-workers が新しい版を出したら `overrides` を外す |

更新後は3つとも `npm audit` 0件。npm 10.9 の不具合(`edgesOut` の例外)で `npm install vitest@4.1.12` が通らないため、`npx npm@11.6.2` で lockfile を作り、npm 10 の `npm ci` で入ることを確認しました。lockfile の差分は上の版の変更と、npm 11 が書かない `libc` の欄だけです。

### cargo(`cargo audit --file src-tauri/Cargo.lock`、cargo-audit 0.22.2)

| crate | 指摘 | 本番に入るか・到達するか | 提案 | 直したときの危険 |
|---|---|---|---|---|
| rustls 0.23.45 | RUSTSEC-2026-0346(medium): クライアントのセッション値の `Debug` が TLS の秘密を出す | beta(reqwest・updater)と server(ureq)。Peta はセッション値を `Debug` で出していない | `cargo update -p rustls --precise 0.23.46` | 低(パッチ版)。ただし Mac で全テストと更新の実機確認が要る |
| rustls 0.23.45 | RUSTSEC-2026-0349(low): 認証前の ServerHello で以後の接続が従来の鍵交換に落ちる | 同上。通信路上の攻撃者が必要、落ちても TLS 1.3 の従来の鍵交換 | 同上 | 同上 |
| rustls 0.23.45 | RUSTSEC-2026-0348(low): Brotli の証明書圧縮の展開で最大1GiB | **到達しない**(rustls の `brotli` feature は有効でない。`cargo tree -e features` で確認) | 同上 | 同上 |
| rustls 0.23.45 | RUSTSEC-2026-0347(low): ECH 拒否後のデータ送信 | **到達しない**(ECH を使っていない) | 同上 | 同上 |
| glib 0.18.5 | RUSTSEC-2024-0429(unsound) | **入らない**(Linux の GTK だけ。macOS のビルドには無い) | なし | — |
| proc-macro-error 1.0.4 | RUSTSEC-2024-0370(unmaintained) | **入らない**(同上) | なし | — |

Tauri・tauri-plugin-*・ed25519 系などアプリ本体の依存は、方針どおり上げていません。

## 3. 直したもののコミットと足したテスト

| コミット | 内容 |
|---|---|
| `8b0ca04` | Workers: vitest 4.1.12、miniflare の undici/sharp をパッチ版に(§2) |
| `3d436f8` | Access の鍵を知らない ID で取り直す(1分に1回まで)/ HEAD をダウンロードに数えない / `.gitignore` に `.dev.vars`・`.env` |
| `dc84433` | 手順書の整理と `release-day-runbook.md` |
| (このコミット) | この報告 |

足したテスト(`cloudflare/peta-download/test/download.test.ts`。直す前のコードで3件とも失敗することを確認):

- 「downloads only the current release…」に、HEAD が 200・`Content-Length` を返し、数に入らないことを追加。
- 「a key ID missing from the cached set is looked up again…」: 新しい鍵 ID のトークンが取り直しで通る、知っている ID では取り直さない、どこにも無い ID は取り直した後も拒否。
- 「the shared certificate cache refreshes for a new key ID at most once a minute」: `fetchKeys` が1時間のキャッシュを保ち、取り直しは前回から1分たっていないときはしない。

結果(この環境): peta-api 74件・peta-download 11件・peta-admin 45件、すべて成功、3つとも `tsc --noEmit` エラーなし。ルートの `npm test` 219件成功。

## 4. 手順書の食い違い(直したもの)

| 手順書 | 古かった/食い違っていた点 | 直した内容 |
|---|---|---|
| admin-page-howto | 確認の手順が「3タブ」 | 8つのタブ |
| admin-page-howto | クーポン鍵が信用されるのは「bundle 以外を信用しない」 | `bundle`・`daily_table`・`announcement`・`shop_config` だけ(アプリの実装どおり) |
| admin-page-howto | Discord リンクは `None` なので差し替えた版が要る | 招待 URL は設定済み |
| updater-howto・daily-table-howto | 本番の D1 は「0008/0009」 | 0008〜0010(0010 は署名つき設定) |
| download-page-howto・distribution-howto | `release-mac.sh beta` の前に `TAURI_SIGNING_PRIVATE_KEY_PATH` が要ることが無い(無いとビルドが始まらない)。`.app.tar.gz`・`.sig` の扱いが無い | 追記 |
| download-page-howto・discord-server-plan | 友達の追加は Zero Trust で手作業 | 管理ページの Friends を基本に(手作業は予備) |
| distribution-howto | `npm audit` が peta-api だけ。「Worker 開発依存7件が未解消、cargo audit 未導入」 | 3つの Worker を監査するコマンド、今回の結果への追記 |
| coupon-howto | k2 を前提にした手元署名 | k2 は未登録、本番は管理ページ(c2)で、と注記 |

各手順書から `release-day-runbook.md` へリンクしました。報告書(`*-report.md`)はその時点の記録なので変えていません。

## 5. Mac で確かめてほしいこと

テスト(Claude がオーナーの Mac で回す):

```bash
cargo test --manifest-path src-tauri/Cargo.toml --workspace --features server
cargo test --manifest-path src-tauri/Cargo.toml --workspace
python3 scripts/test-release-mac.py
```

rustls を上げる場合は、上げた後にこの3つと `cargo test --manifest-path src-tauri/Cargo.toml --features beta`、`python3 scripts/test-updater-release.py` も。

実機(runbook の中で):

- 公開鍵入りで `release-mac.sh beta --unsigned` が通り、DMG・`.app.tar.gz`・`.sig` がそろう。
- オーナーの Mac で上書きインストール → データがそのまま → 招待コード(peta-api の再デプロイの後に聞かれることがある)。
- 別のブラウザでダウンロードページから落とした DMG が「このまま開く」で開ける。Intel の Mac があればそちらでも。
- peta-api の再デプロイ後: Today のお知らせの帯・Market の Featured・毎日の素材が `/v1/config` から届く、Check for updates が「新しい版はない」。
- 管理ページ・ダウンロードページにログインできる(Access の鍵の取り直しを入れた Worker で)。

## 6. 配る日の手順

[release-day-runbook.md](release-day-runbook.md)。前日まで → ビルド → オーナーの Mac → 本番の更新(D1 → peta-admin → peta-download → R2 の確認 → **peta-api は最後**)→ 公開 → 規約 → 友達 → 配った後 → 戻し方。
