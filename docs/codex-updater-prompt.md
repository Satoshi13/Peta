# Codex への依頼: アプリ内アップデート(友達限定ベータ)

**使い方**: この文書の全文を Codex に渡す。**実装の指示**(Rust、TypeScript の Worker、アプリの HTML/CSS/JS、シェル/Python のリリース手順)。作業は **Step 順**。各 Step の終わりに §8 のテストをすべて通し、**Step ごとにコミット**する。

> 日本語で指示。コード中のコメントと UI の文言は、既存に合わせて**英語**。説明文書は日本語。

---

# 0. 目的

今、新しい版は「ダウンロードページで DMG を落とし、アプリケーションへドラッグして置き換える」しかない。Apple の公証をしない配布(`release-mac.sh --unsigned`)では、友達は更新のたびに「このまま開く」も必要。

これを、**アプリが新しい版を見つけて、ボタン1つで入れ替えて再起動する**形にする(Tauri v2 の `tauri-plugin-updater`)。

- 対象は **友達限定ベータ(`server` feature、`build:beta`)だけ**。通信しない版(offline)と Peta Developer には入れない(依存もコンパイルしない)。
- **最初の版(v0.1.0)に入っていないと効かない**。この版を配る前に完成させる。
- 招待していない人には更新を配らない。なりすました更新は入れない。

## 必ず最初に読む

`docs/download-page-howto.md`、`docs/distribution-howto.md`、`docs/admin-page-howto.md`、`scripts/{build-mac.py,release-mac.sh,publish-release.sh,make-dmg.sh,test-release-mac.py}`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`(feature の構成)、`src-tauri/src/{referee,invite,coupon,referee_access,lib}.rs`、`cloudflare/peta-api/src/{index,invites}.ts`、`cloudflare/peta-download/src/index.ts`(`latest.json` の形 `validRelease`)、`cloudflare/peta-admin/src/release.ts`。Tauri の updater の現行ドキュメント(v2)を必ず確認し、報告に URL を書く。

## 守ること

- 既存の形式・表・鍵(`PETAEVNT`、`KEYS`/`COUPON_KEYS`、D1 の既存の表)は変えない。D1 を足すなら新しいマイグレーション。
- **秘密を書かない**: 更新用の署名鍵(Tauri の minisign 秘密鍵とパスワード)はリポジトリ・ログ・CI・Worker に置かない。オーナーの手元の暗号化ディスクにだけ置く(公式の鍵 k2 と同じ扱い。`docs/official-key-howto.md`)。テストは、テスト内で作った使い捨ての鍵だけ。
- 本番のデプロイ・秘密の登録はしない。dev への D1 マイグレーションとデプロイはしてよい。**`peta-api` の prod は再デプロイしない**(招待の必須化が有効になるため。配布の日にオーナーの指示でまとめて行う)。
- ad-hoc 署名(未公証)と Developer ID 署名(公証あり)の**両方**で動くこと。

---

# 1. 全体の形

```
publish-release.sh ── R2 peta-downloads-<env>: releases/<file>.dmg(今まで通り)
                                              releases/updates/<version>/Peta.app.tar.gz と .sig(新規)
                                              releases/latest.json(版・DMG に加えて、更新の情報)
アプリ(beta) ──署名つき要求──▶ peta-api: 招待済みの Mac か確かめ、Tauri の更新の JSON を返す
             ──短命のトークン──▶ peta-api: 更新ファイル(tar.gz)を R2 から渡す
             ── Tauri の公開鍵で .sig を検証してから入れ替え ── 再起動
```

- **本物かどうかの最後の確認は、アプリに埋め込んだ Tauri の更新用公開鍵**(`plugins.updater.pubkey`)。サーバーが乗っ取られても、オーナーの秘密鍵で署名していない更新は入らない。
- 更新ファイルは universal(Apple シリコンと Intel)1つ。更新の JSON の `darwin-aarch64` と `darwin-x86_64` が同じファイルを指す。

# 2. サーバー(`cloudflare/peta-api`)

- R2 `peta-downloads-<env>` を `RELEASES` として**読むだけ**で bind(prod と dev)。
- `GET /v1/update?current=<semver>`(既存の署名つきリクエスト。招待が必須の環境では招待済みの Mac だけ):
  - `releases/latest.json` を読み、`update` 欄があり `current` より新しければ、Tauri の更新 JSON(`version`、`notes`、`pub_date`、`platforms.{darwin-aarch64,darwin-x86_64}.{url,signature}`)を返す。なければ `204`。
  - `url` は `/v1/update/file/<token>`。`token` は **10分で切れ、その Mac(鍵ハッシュ)と版に結びついた**ランダム値(D1 に保存して1回か短時間だけ有効、または HMAC。秘密を使うなら Worker secret。URL にメールや鍵そのものを入れない)。
- `GET /v1/update/file/<token>`: トークンを確かめて R2 の tar.gz をそのまま流す(`Content-Length`、`Cache-Control: private, no-store`)。
- `downloads` 表に「更新で受け取った」記録を足す(ダウンロードページの記録と区別できる列を足すか、版に印。既存の意味は変えない)。管理ページの Release タブで **版ごとの台数**(ページから / アプリ内更新)が見られるとよい。
- テスト: 招待必須のとき未招待は 403、新しい版がないと 204、トークンの期限切れ・別の Mac・別の版は拒否、ファイルが流れる、記録が残る。

# 3. アプリ

- `tauri-plugin-updater`(と再起動用の `tauri-plugin-process`)を **`server` feature の optional 依存**に。`capabilities` は必要な許可だけ。
- 更新の公開鍵は beta のビルドだけに入れる(`tauri.beta.conf.json` のような重ねる設定を作り、`build:beta` と `release-mac.sh beta` が使う。offline・Developer の設定には入れない)。公開鍵はオーナーが作る(§5)。**未設定のまま beta をビルドしたら失敗させる**(公開鍵なしで配ってしまう事故を防ぐ)。
- 確認のきっかけ: 起動時と、アプリのウィンドウが前に来たとき。**6時間に1回まで**。まず §2 の署名つき要求で更新の JSON を受け取り、その JSON を updater に渡してダウンロード・検証する(updater の `check()` に任意の取得処理を使えない場合は、§2 の更新 JSON を返す短命トークンつきの GET を足し、それを endpoint にする。どちらにしても**招待の確認を通った Mac だけ**がファイルを取れること)。
- ダウンロードは裏で行い、終わったら静かな知らせ(既存の `Shell.toast` か、Settings の Peta カードの帯。既存のデザインに合わせる): 「Peta 0.2.0 is ready. **Restart to update** · Later」。押すと入れ替えて再起動。`Later` ならその版は次の起動まで聞かない。**セレモニー(封筒を開ける演出など)や印刷の途中には出さない・再起動しない**。
- Settings(または About)に今の版と「Check for updates」。手動で確かめたときだけ「You're up to date.」を出す。
- 失敗(通信・検証・置き換え)は黙って次の機会に回す。手動で確かめたときだけ短い文言で知らせる。**検証に失敗したファイルは使わず消す**。
- 招待がまだない・停止された Mac は更新を受け取らない(招待の画面が先)。
- **未公証のときの確認(実機で)**: 更新で入れ替えたアプリを開いたとき、macOS の「このまま開く」が再び必要かを、ad-hoc 署名の古い版 → 新しい版で実際に試し、結果を報告に書く。必要なら、その旨をアプリの知らせと手順書に書く。位置情報など macOS の許可が更新でリセットされるかも確かめて書く。
- テスト(偽のサーバー): 新しい版なし・あり、間隔、招待なし、署名の不一致で入れ替えない、`Later`。

# 4. リリースの手順

- `release-mac.sh`(署名あり・`--unsigned` の両方): `bundle.createUpdaterArtifacts` で `Peta.app.tar.gz` と `.sig` を作る。署名にはオーナーの手元の鍵(環境変数 `TAURI_SIGNING_PRIVATE_KEY_PATH` などでファイルを指す。**中身を引数や画面に出さない**。鍵がなければ、何もビルドせず案内を出して止まる)。署名あり(公証)の流れでは、**staple 済みの .app から** tar.gz を作る(公証の印が更新後も残るように)。
- `publish-release.sh`: DMG と一緒に `releases/updates/<version>/` に tar.gz と .sig を置き、`latest.json` に `update: { version, file, signature, notes }` を足す。`notes` は `--notes "…"` で指定(英語。省略可)。**更新ファイルを置いてから `latest.json` を書く**(途中で止まっても半端な更新を配らない)。
- `latest.json` の形が変わるので、`peta-download` の `validRelease` と `peta-admin` の Release タブも対応(`update` 欄は任意)。
- **古い版の片付け**(R2 の無料枠 10GB を超えないように): `publish-release.sh` は公開の後、R2 の容量の合計と版の数を表示し、**最新の3版より古い** DMG と `releases/updates/<version>/` を一覧にして、確認(`y`)してから消す。`--keep N` で残す数を変えられる。`latest.json` が指す版は絶対に消さない。消す対象の一覧を出す部分と、消さないものの判定はテストする(偽の wrangler で)。手順書にも、手で消す方法と、容量の確認の仕方を書く。
- `scripts/test-release-mac.py` に、鍵なしで止まる・tar.gz と .sig ができる・公証ありは staple 後に作る、を足す(偽のツールで)。

# 5. 更新用の鍵(オーナー用)

- `scripts/updater-key.sh`: `tauri signer generate` で鍵を作り、**オーナーが選んだ暗号化ディスクのパスにだけ**書く(既存なら上書きしない)。パスワードは対話で入れる。**公開鍵だけ**を表示し、「`tauri.beta.conf.json` の pubkey に入れる」と案内。
- 手順書に: 鍵をなくすと、それ以降の版をアプリ内で更新できない(DMG で入れ直しになる)こと、予備を暗号化して保管すること、漏れたら新しい鍵の版を DMG で配り直すしかないこと。

# 6. Step

1. サーバー §2(テスト、dev へのマイグレーションとデプロイ)。
2. リリース手順 §4 と鍵 §5(テスト用の使い捨て鍵で、tar.gz と .sig ができること)。
3. アプリ §3(偽のサーバーのテスト)。
4. `peta-download`・`peta-admin` の `latest.json` の対応と、Release タブの台数(テスト。dev へデプロイ)。
5. **実機の通し確認(dev)**: 使い捨ての鍵で、ad-hoc の v0.0.1-test → v0.0.2-test を dev の R2 に置き、dev の peta-api につながる beta 相当のビルドで更新が見つかり、入れ替わり、再起動し、データが残ることを確かめる(dev 用の接続先が beta のビルドに無ければ、確認用の設定で dev を指すビルドを作ってよい。**配布物には使わない**)。「このまま開く」が再び要るかもここで確かめる。終わったら dev の R2 から試しのファイルを消す。
6. 手順書 `docs/updater-howto.md`(鍵の作り方・保管、版を出す手順、友達に見えるもの、うまくいかないとき)、`docs/download-page-howto.md` と `docs/discord-server-plan.md` の「新しい版にするとき」を、アプリ内更新が基本・DMG は予備に更新。報告 `docs/updater-report.md`(オーナーがやること: 鍵を作って公開鍵を渡す → v0.1.0 に入れる、prod の R2/D1/peta-api の作業は配布の日にまとめて)。

# 7. やらないこと

- 通信しない版・Developer の自動更新。差分更新。ベータ以外の配布経路(App Store など)。強制アップデート(最低版の強制)は今回は不要。必要になったら `latest.json` に足せる形にしておく。

# 8. テスト(各 Step の終わりに全部)

```bash
cd cloudflare/peta-api && npm test && npx tsc --noEmit
cd cloudflare/peta-download && npm test && npx tsc --noEmit
cd cloudflare/peta-admin && npm test && npx tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml --workspace --features server
cargo test --manifest-path src-tauri/Cargo.toml --workspace
npm test
python3 scripts/test-release-mac.py
```

# 9. 受け入れ条件

- 招待済みの Mac の beta は、新しい版を見つけて、ボタン1つで入れ替わり、再起動後もデータ(ステッカー・友達・Scraps・招待)が残る。
- 招待していない・停止した Mac、トークンの期限切れ、別の Mac のトークンでは、更新ファイルを取れない。
- オーナーの鍵で署名していない更新(サーバーが別のファイルを返した場合)は入らない。
- offline 版と Developer には updater が入っていない。beta は公開鍵なしではビルドできない。
- 未公証の更新で「このまま開く」が再び要るかどうか、macOS の許可が残るかが、実機の結果として報告にある。
