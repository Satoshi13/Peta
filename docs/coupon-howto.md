# クーポン(オーナー向け)

2026-10-14。Discord などに `HALLOWEEN` のような短い名前を投稿し、友達がアプリの **Redeem Code…** に打つと特典が届く仕組みです。

オーナー専用ページでボタンから発行・停止する方法は [admin-page-howto.md](admin-page-howto.md)。以下の手元署名の方法も引き続き使えます。

## 配れるもの

1つのクーポンに、次を組み合わせて最大10種類まで入れられます(「詰め合わせ」= イベントの種類 `bundle`)。

| 指定 | 中身 | 1クーポンの上限 |
|---|---|---|
| `--scraps N` | Scraps | 1000 |
| `--envelopes N` | 追加の封筒 | 3 |
| `--material id=N` | 素材(kraft, holographic, gold, riso, vintage, clear, pixel, washi, sakura) | 各50 |
| `--tool link-tag=N` / `--tool board=N` | リンクタグ / ボード | 20 / 12 |
| `--pack id=N` | ショップのパックの補充(tokyo, coffee, plants, pixel, cats, night) | 各5セット |

`python3 scripts/coupon.py catalog` でも一覧が出ます。上限はアプリ側(`crates/core/src/scraps.rs` の `grant_cap`)が決めていて、スクリプトの一覧はそれに合わせてあります。ボードは12枚、パックは封をした100枚までしか持てないので、超える分は配らず、受け取った人に「もう持てない」と表示します(詰め合わせのほかの物は届きます)。

## しくみ

```
あなたの Mac: coupon.py → peta-pass が公式の鍵で署名 → D1 の coupons 表へ(名前・期間・人数・署名済みファイル)
友達のアプリ: Redeem Code… に HALLOWEEN → peta-api が「開いているか・人数」を見て署名済みファイルを返す
             → アプリが公式の公開鍵で署名を確かめて、Mac 1台につき1回だけ受け取る
```

- **受け取り用の peta-api は署名鍵を持ちません。** 以下の手元署名だけなら、保存するのは署名済みファイルと名前の対応です。管理ページを導入すると、別の peta-admin Worker がクーポン専用鍵で上限内の bundle を署名します。受け入れ済みのリスクと緊急停止は [admin-page-howto.md](admin-page-howto.md) を参照してください。
- **1人1回**: 同じ Mac では1回だけ(アプリの記録)。サーバーも Mac ごとに数えるので、`--limit 30` で「先着30台」にできます。
- 本番ではサーバーが招待コードを確かめるので、**招待済みの Mac だけ**が受け取れます。
- 通信しない版(offline)ではクーポンは使えません(長いコードは今までどおり使えます)。

## 最初に一度だけ

1. **本物の公式の鍵を作る**: [official-key-howto.md](official-key-howto.md) の手順で、暗号化ディスクイメージの中に作ります。公開鍵(`peta-pass pubkey` の1行目)を Claude に渡すと、`official_keys.rs` の `k2` に入れます。**その版のアプリを配ってから**でないと、友達のアプリはクーポンの署名を信用しません。
2. **サーバーに表を作る**(何度やっても同じ。いつやってもよい)

   ```bash
   cd cloudflare/peta-api
   npx wrangler d1 migrations apply peta-prod --env prod --remote
   ```

3. **`peta-api` を公開し直す**。これで受け取り口が開きます。本番の `peta-api` を公開すると招待コードも必須になるので、[download-page-howto.md](download-page-howto.md) の「8」と同じタイミング(自分の Mac で招待コードを入れた後)にしてください。

## クーポンを出すたびに

1. 鍵の入った暗号化ディスクイメージをダブルクリックでマウントする(パスワードを聞かれます)
2. ターミナルで

   ```bash
   export PETA_SIGNING_KEY=/Volumes/Peta-private/official.key
   python3 scripts/coupon.py new HALLOWEEN --scraps 50 --envelopes 1 --material kraft=2 --until 2026-11-01 --limit 30 --title "Happy Halloween"
   ```

   中身・期間・人数が表示されるので、合っていれば `y`。最後に「Post this in Discord: HALLOWEEN」と出ます。
3. ディスクイメージを取り出す
4. Discord に名前を投稿する

よく使う指定:
- `--until 2026-11-01`: その日の終わりまで。省略すると今から14日間(`--days 7` で変更)
- `--from 2026-10-31`: その日から使える(予約)
- `--limit 30`: 先着30台。省略で無制限
- `--title` / `--message`: アプリの受け取り記録に出る見出しとひとこと
- `--dry-run`: 署名だけして、保存しない(試し用)
- `--env dev`: 開発用のサーバーへ(Peta Developer で試すとき。dev のアプリはテスト鍵 k1 を信用するので `--key-id k1`)

## 確認と停止

```bash
python3 scripts/coupon.py list            # 最近のクーポン、受け取った台数、状態(open / ended / used up / stopped)
python3 scripts/coupon.py stop HALLOWEEN  # すぐ締め切る。もう受け取った人の特典はそのまま
```

名前は一度使ったら別のクーポンには使えません(`list` に残ります)。毎回 `HALLOWEEN26` のように変えてください。

## 投稿の例

```
🎃 ハロウィンのクーポン
Peta の Redeem Code… に  HALLOWEEN  と入れてください。
Scraps 50・封筒1通・Kraft 2枚。11/1 まで、先着30人。
```
