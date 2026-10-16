# 公式パックを、アプリの更新なしで配る（オーナー向け）

2026-10-16。ショップの公式パックを、アプリを更新せずに足す手順です。中身（絵・名前・レア度・値段）は**オーナーの Mac の上で公式の鍵で署名**し、いつ並べるか（期間・停止）は管理ページで決めます。

```
管理ページ Packs タブ   下書きを作る → Ready to sign
オーナーの Mac           bash scripts/sign-pack.sh <draftId> prod   ← 絵を目で確かめてから y
管理ページ Packs タブ   期間を決める（停止・延長もここ）
各 Mac の Peta           設定の取得のついでに新しいパックを受け取り、公式の鍵で確かめてからショップへ
```

- 既存の6パック（Tokyo など）はアプリに入ったまま。売る・売らない・値段・並び順は今までどおり Shop タブで。
- 新しいパックは、買うたびに同じ中身の1セットが棚に入ります（数量限定の版ではありません）。
- 期間が終わる・停止すると、ショップからは消えます。**買って棚にある分は、いつでも開けられます**。

> **2026-10-16 時点の状態**: 署名ファイル（`peta-core` の `shop_pack`）、`peta-pass shop-pack`、`peta-api` の一覧と配信、管理ページの Packs タブ、`sign-pack.sh` はできています。**アプリがパックを受け取ってショップに並べる部分（指示書の Step 2）は、Mac での作業が残っています**。それが入った版を配るまで、署名して期間を決めても友達のショップには並びません。詳しくは [official-packs-report.md](official-packs-report.md)。

## 1. 最初に一度だけ: 公式の鍵 k2

本番のパックは公式の鍵 k2 で署名します。k2 が入っていない版のアプリは、本番のパックを検証できないので並べません（無視します）。だから**順番が大事**です。

1. 鍵を作る（ネットワークを切った Mac で。詳しくは [official-key-howto.md](official-key-howto.md)）。
   ```sh
   cargo build --release --manifest-path src-tauri/Cargo.toml -p peta-pass
   src-tauri/target/release/peta-pass keygen --out /Volumes/Peta-private/official.key
   src-tauri/target/release/peta-pass pubkey /Volumes/Peta-private/official.key   # 公開鍵だけが出る
   ```
   `/Volumes/Peta-private` は更新用の鍵と同じ暗号化ディスクでかまいません。鍵ファイルはそのディスクの外へコピーしません。
2. 公開鍵を `src-tauri/crates/core/src/official_keys.rs` の `KEYS` の**末尾**に `("k2", Some("…"))` で足す。k1 を消したり順番を変えたりしない（PETA1 のコードが鍵の番号を使うため）。
3. その版のアプリを配る（アプリ内更新で届く）。
4. その後で、本番のパックを署名して並べる。

dev では公開済みのテスト鍵 k1 で署名できます。k1 はテスト用で、通常版・ベータ版のアプリは信用しません。本番には使えません。

## 2. 反映の準備（オーナー、本番は自分の判断で）

D1 に `0011_shop_packs.sql`（下書き・掲載・配信トークンの表）を当て、`peta-api` と `peta-admin` をデプロイします。dev で確かめてから本番へ。

```sh
cd cloudflare/peta-api
npx wrangler d1 migrations apply peta-dev --remote --env dev
npx wrangler deploy --env dev
cd ../peta-admin && npx wrangler deploy --env dev
```

本番は `--env prod` / `peta-prod` で同じことをします。`peta-admin` には新しい変数 `PETA_ENV`（`dev` / `prod`）が入っていて、Ready to sign のときに表示するコマンドの行き先を決めます。

## 3. パックを作る（管理ページ Packs タブ）

1. **New pack ID** に ID（英数字・`-`・`_`、40字まで。例 `autumn-walk`）を入れて **Start a draft**。ID は後から変えられません。中身を変えるときは同じ ID の新しい版になります。
2. 題名・作者（既定 `Peta`）・Market の一行・袋（kraft / matte / holo / glassine）・色（matte と holo だけ）・値段（4〜40 Scraps）を入れる。
3. 絵をドラッグ（複数可）。ブラウザで長辺 1024px に縮小し、背景が透明でない絵・大きすぎる絵はその場で理由を出して受け付けません。
4. 各ステッカーの名前・レア度（common / uncommon / rare）・重み（1〜100。空なら 4 / 2 / 1）・並び順。プレビューに、袋とステッカーと、各ステッカー・各レア度の出る確率が出ます。
5. **Save draft** で保存。3〜12枚そろったら **Ready to sign**。以後この下書きは変えられません（直すなら **Duplicate**）。
6. 画面に出るコマンドを **Copy command** でコピーします。

### 絵の作り方の目安

- 透明な背景の PNG。**縁取り・影は入れない**（アプリが素材ごとにフチと影を付けます）。
- 長辺 1024px 以下、1枚 1.5MB 以下、全部で 12MB 以下。大きい絵はページが縮めます。
- 水彩・手描きの画風で。写真・3D・強いツヤは避ける（[design-principles.md](design-principles.md)）。

## 4. 署名する（オーナーの Mac で1行）

```sh
bash scripts/sign-pack.sh d-0123456789abcdef prod
```

1. 自分の wrangler ログインで、下書き（D1 の行、R2 の `pack.json` と絵）を一時フォルダに取ってきます。管理ページは通りません。
2. `peta-pass shop-pack --check` で、アプリと同じ上限と「これまでに署名した版より新しいこと」を確かめます。
3. **取ってきたファイルからプレビューを作って開きます**。ターミナルにも要約が出ます。**絵を1枚ずつ目で確かめてください**。下書きはサーバーにあったので、サーバーが乗っ取られて絵がすり替えられていても、ここで気づけます。おかしければ `n`（何も署名・アップロードしません）。
4. `y` で、`peta-pass` が公式の鍵（既定 `/Volumes/Peta-private/official.key`、`PETA_SIGNING_KEY` で変更可、鍵の番号は prod が k2・dev が k1）で署名します。鍵ファイルを読むのは `peta-pass` だけです。
5. 署名したファイルを確かめ直してから R2 の `shop/<packId>/<version>.peta` に置き、「署名済み（未掲載）」にします。まだ並びません。
6. 一時フォルダは消えます。

## 5. 並べる・止める（管理ページ Packs タブ）

- **Signed packs** で **Show contents**: 署名済みのファイルの中身（絵と文字）を、そのファイルから読んで表示します。
- **Put on sale**: 開始と終了（**No end** で終わりなし）。友達の Peta には次のチェックイン（6時間以内）で届きます。期間はいつでも **Change period** で変えられます（署名し直しは要りません）。
- **Stop**: ショップから下げます。もう一度売るには新しい版を作ります。棚にある分は開けられます。
- 同時に販売中・予定にできるのは 24 パックまで。
- **New version…**: 同じ ID・次の版の下書きを、今の中身と絵から作ります。新しい版を並べると、古い版の代わりにそれが売られます。

### Shop タブで目立たせる

Shop タブの Featured と New and popular に、署名済みのパックも出ます（`shop:<packId>`）。値段の調整はそのパックの値段の 50〜200%。

> 注意: **新しいパックを名指しした Shop の設定は、それを知らない古いアプリでは丸ごと無視されます**（古いアプリは内蔵の並びに戻るだけで、壊れはしません）。友達のアプリが Step 2 の入った版に更新されてから、新しいパックを Featured にしてください。

## 6. 片付け

**Clean up…** で、売っていない古い版（新しい版があり、販売中・予定でないもの）と、捨てた下書き・署名済みの下書きの絵を R2 から消します（確認つき）。棚にある分の絵は各 Mac に保存されているので、サーバーから消しても困りません。ストレージの使用量は Packs タブの下に出ます。

## 7. うまくいかないとき

| 症状 | 見るところ |
|---|---|
| `sign-pack.sh` が「not ready to sign」 | 管理ページで Ready to sign を押したか |
| `sign-pack.sh` が「not newer than the signed vN」 | その版はもう署名済み。New version… で次の版を作る |
| `No key file at …` | 暗号化ディスクをマウントしたか、`PETA_SIGNING_KEY` |
| Ready to sign が「Add a picture for …」 | その名前のステッカーに絵がない |
| 期間を決めたのにショップに出ない | アプリが Step 2 の入った版か（k2 入りか）。チェックインまで最大6時間 |
| Put on sale が「At most 24 packs」 | 何かを止めるか、期間を終わらせる |
