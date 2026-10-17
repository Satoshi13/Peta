# Codex への依頼: 公式パック第2弾(内蔵パックの削除・無料パック・手動取得・ステッカーの書き出し・管理ページの使いやすさ)

**使い方**: この文書の全文を Codex に渡す。**Mac の上で作業する**(アプリ本体・Peta Developer・オーナーの wrangler ログインを使う)。Step 順、Step ごとにコミット、最後に `codex/ui-fixes-oct07` へ push。

> 日本語で指示。**アプリ**のコード中のコメントと UI の文言は既存に合わせて英語。**管理ページの UI の文言は日本語**(§5)。報告は日本語。

## 先に読む

`docs/codex-official-packs-prompt.md`、`docs/official-packs-report.md`、`docs/official-packs-howto.md`、`docs/admin-page-howto.md`、`crates/core/src/{pack,shop_pack,scraps,signed_config,events}.rs`、`src-tauri/src/{daily_supply,packs,collection}.rs`、`src/app/js/{market,packs,ceremony,catalog,share-card,book,settings,sticker}.js`、`cloudflare/peta-admin/public/*` と `src/packs.ts`・`src/shop.ts`、`cloudflare/peta-download/public/`(紙・ワードマーク・袋の絵の使い方の見本)、`scripts/sign-pack.sh`。

## 守ること

- 作業ツリーにオーナーの未コミットの変更があるかもしれない。**自分が変えたファイルだけを `git add` し、コミットの前に `git diff --cached --name-only` を確かめる**。
- **本番(prod)には触れない**(デプロイ・D1・R2・秘密)。dev の D1/R2 と `peta-api` dev・`peta-admin` dev のデプロイはしてよい。
- 署名つき形式・鍵の扱い(`shop_pack` は公式の鍵だけ、鍵は `peta-pass` だけが読む)は変えない。形式に項目を足すときは、古いアプリが丸ごと無視できる形にし、Rust・管理ページ・`peta-pass`・契約ファイル(`cloudflare/shared/shop-pack-contract.json`)をそろえる。
- **まだ誰にもアプリを配っていない**(v0.1.0 前)。友達の棚に残る内蔵パックとの互換は考えなくてよい。オーナーの Peta Developer のデータは壊さない(開けられなくなる棚の分が出るなら、報告に書く)。

---

# Step 1: 内蔵のショップパック6つを、ベータ版から外す

- オーナーの決定: **今ある公式パック(Tokyo・Coffee・Houseplants・Pixel Dream・Cats・Night Market)は全部消す**。これからは管理ページで作るパックだけにする。
- `server` feature のビルド(beta・Developer)では、ショップに内蔵の6つを出さない・売らない・Featured にしない。`shop_config` が内蔵の id を名指ししても無視する。`scraps::trade` の `Kind::Pack` も内蔵の id を受け付けない。
- 通信しない版(offline)は、サーバーがないので**今のまま内蔵の6つを残す**。
- **最初の Welcome Pack(`pack::WELCOME_PACK_ID`、初回起動で棚に入るもの)は変えない**。ショップのパックとは別物。
- 内蔵パックの絵(`src/art/samples/`)は、ほかの場所(Welcome、見本、オンボーディング、PackPeek など)でも使うので消さない。使われなくなったコード(`MARKET_PACKS` のショップ用の部分など)は、offline 用に残すものと分けて整理する。
- ショップが空のとき(パックが1つも並んでいない)の Market の表示を用意する(英語。例: "New packs are on their way.")。Featured は既存の決まり(何もなければ出さない)のまま。
- テスト: beta/Developer で内蔵パックが出ない・買えない、offline では今まで通り。

# Step 2: 無料パック = Welcome 扱い(オーナーの決定 A)

- 内蔵の無料パック(Tokyo・Coffee・Houseplants)が担っていた「無料で開けられる」役目を、**管理ページで「無料」にした公式パック**が引き継ぐ。
- `shop_pack` の payload に `free: true` を足す(古いアプリは丸ごと無視してよい形で)。`free` のとき `price` は不要(0 または省略)。上限は契約ファイルで。
- 無料パックの動き: **1台の Mac につき1セットを無料で受け取れる**。今の内蔵の無料パックと同じ見せ方(`packHasFreeOpening`、「a ready free opening always comes first」の流れ、ショップの「Free」の札)にする。受け取り済みなら、以後は買えない(無料パックに値段はない)。
- `shop_config` は無料パックに値段を付けられない(今の決まりのまま)。
- 管理ページの Packs の下書きに「無料(1台1セット、Welcome と同じ扱い)」のスイッチを足す。`sign-pack.sh` のプレビューにも無料と出す。
- テスト: 無料の受け取りが1回だけ、2台目の Mac(別のライブラリ)でも1回、署名なし・上限外は拒否。

# Step 3: アプリから手動で取得するボタン

- 今は設定(確率表・お知らせ・ショップ設定・公式パックの一覧とファイル)の取得が、起動・前面化で**6時間に1回まで**。テストしづらいので、**手動で今すぐ取得**できるようにする。
- 場所: Settings の Peta のカード(版の表示や「Check for updates」の近く)に **"Check for new packs and news"** のボタン。押すと取得し、結果を短く出す(例: "Up to date." / "2 new packs arrived." / "Couldn't connect.")。
- 制限: **ベータ版は1分に1回まで**(押せない間は残り秒数を出す)。**Developer は制限なし**。サーバー側の回数制限に引っかからないこと(必要ならサーバー側で取得の窓口の制限を確かめる)。
- 手動取得のあとの画面の再描画は、変わったときだけ(既存の `183786d` の決まり)。
- テスト(偽のサーバー): 押すと取得、1分以内の2回目は待たされる、Developer は待たない、失敗の表示。

# Step 4: ステッカーの書き出し(透過 PNG)

オーナーは、公式パックの絵を、アプリで作ったステッカーから持ってきたい。今は Share で**背景つき**の画像しか書き出せない。

- Collection のステッカーの詳細の **Share** シートに、書き出しの種類を足す:
  1. **Share card**(今のもの。背景つき・3:2)
  2. **Sticker (transparent)**: ステッカーのフチ・素材の見た目つき、**背景は透明**。影は付けない。
  3. **Cut-out for a pack**: **フチなしの切り抜き(透過)**。公式パックの絵にはこれを使う(フチと影はアプリが素材ごとに付けるため。§2 の決まり)。長辺 1024px 以下に縮める。
  - それぞれ Copy と Save…。ファイル名は `Peta <名前>.png`、切り抜きは `Peta <名前> cut-out.png`。
- 元になる画像は Rust 側にある(ステッカーの完成画像と、切り抜きのマスク)。必要なら Rust のコマンドを足す(既存の `poster_save`・`share_copy` の検査を流用)。元の写真は書き出さない(切り抜きの外は透明にする)。
- **共有画像の不具合も直す**: 共有画像で、ステッカーのフチの外側に黒い短い線(点線のような跡)と、角の尖った出っ張りが出ることがある(オーナーの例: しっぽの上と足元)。原因(フチの生成、影、縮小、素材の描画のどれか)を調べて直す。直す前と後の画像を報告に貼る。
- テスト: 3種類が出る、透明の部分が本当に透明(アルファ 0)、切り抜きにフチがない、大きさの上限。

# Step 5: 管理ページを使いやすくする

オーナーしか見ないページなので、**分かりやすさ優先**。

- **言葉は日本語**(固有名詞・製品名、たとえば Peta・Scraps・Featured・Market・Discord・Gift はそのまま)。全タブ(Friends・Coupons・Release・Daily・Reports・News・Shop・Market・Packs)のボタン・見出し・説明・エラー・確認ダイアログ。日付は日本の書き方。単数と複数の英語の言い回し("1 stickers" など)は日本語にして消える。
- **Peta の素材を使う**: 紙の背景、ワードマーク、等幅の小見出し(`peta-download/public` と同じ素材)。**パックのプレビューは、アプリと同じ袋の絵**(`src/art` の袋・グラシン・色、`PackArt` の描き方)と、**ステッカーのフチ**(素材ごとの見た目)で描く。今のグラデーションの仮の箱はやめる。素材は `peta-admin` の静的ファイルとして持つ(外部から読み込まない。CSP はそのまま)。
- **Packs の作り方を分かりやすく**:
  - 画面の上に、手順を3つの段で表示: 「1. 作る → 2. Mac で署名する → 3. 並べる」。今どの段にいるかが分かるように。
  - 絵の入れ方の説明: 「アプリで、Collection → ステッカー → Share → **Cut-out for a pack** で書き出した PNG をドラッグ」。透過していない絵・大きすぎる絵は、理由を日本語で。
  - 「Ready to sign」のあとは、コピーするコマンドと、次にやること(暗号化ディスクを開く → ターミナルに貼る → プレビューで確かめて y)を、その場に表示。
  - 署名済みのあとは「並べる」へ自然に進める(期間の入力がすぐ見える)。
  - **削除**: 下書きは「捨てる」、掲載中・予定のパックは「ショップから外す」(棚の分は開けられる、と一言)。どちらも確認つき。
- そのほかのタブも、迷いやすい所に一言の説明を足す(例: Daily の「反映は友達の次の日の封筒から」、Shop の「新しいパックは k2 入りの版が届いてから並ぶ」)。
- 375px のスマホ幅でも崩れない。テストは日本語の文言に合わせて直す。

# Step 6: dev での確認

- dev の管理ページ(手元で Worker を動かす既存の手順)で、無料パック1つと有料パック1つを作る → `sign-pack.sh <draftId> dev`(テスト鍵 k1)→ 並べる → Peta Developer の **手動取得のボタン**で届く → 無料の受け取りが1回だけ、有料を買って開ける → ショップから外す → 棚の分は開ける。内蔵の6つが出ないこと。
- ステッカーの書き出し3種類を Peta Developer で試し、**Cut-out for a pack** で書き出した PNG を、管理ページの下書きにドラッグして使えること。
- 各段階のスクリーンショットを報告に。試験データは片付ける。

# 報告とテスト

- 報告: `docs/official-packs-report.md` に「第2弾」として追記。`docs/official-packs-howto.md` を新しい流れ(内蔵なし・無料・手動取得・書き出し)に直す。
- テスト(全部): Worker 3つの `npm test` と `npx tsc --noEmit`、`cargo test --workspace --features server`、`cargo test --workspace`、`npm test`、`python3 scripts/test-release-mac.py`。Rust は `CARGO_INCREMENTAL=0` で軽くし、終わったら `npm run clean:target`、報告に空き容量。
