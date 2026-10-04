# 署名付き配布の使い方（オーナー向け）

通信・アカウント・決済は使わない。ファイルはAirDrop／メッセージ等で運び、添付なしの配布はコードを投稿できる。受け取りはその端末のDBで1イベントにつき1回。

## 1. ツールをビルドする

```sh
cargo build --manifest-path src-tauri/Cargo.toml -p peta-pass --release
src-tauri/target/release/peta-pass --help
```

以降は`peta-pass`をPATHに置いた場合の例。ビルドした実行ファイルのフルパスでもよい。

## 2. 本物の公式鍵をオーナーが作る

**Codexは本物の公式秘密鍵を生成していない。以下はオーナー自身が実行する。**

```sh
mkdir -m 700 "$HOME/Peta-private"
peta-pass keygen --out "$HOME/Peta-private/official.key"
peta-pass pubkey "$HOME/Peta-private/official.key"
```

keygenは既存ファイルを上書きしない。秘密鍵は32バイトの生データ、Unixで0600。画面に出るBase64は**公開鍵**で、秘密鍵をBase64化して貼る操作ではない。

`src-tauri/crates/core/src/official_keys.rs`のTODO箇所で仮公開鍵を差し替え、`("k1", "表示された公開鍵")`をアプリに同梱して再ビルドする。仮キーのまま本番配布しない。鍵を入れ替えるときは`k2`などを**末尾へ追加**し、古いキーIDを再利用・並べ替え・削除しない（コードは追記専用のキー位置を持つ）。新しい公式キーIDは`--key-id k2`で指定する。

秘密鍵はリポジトリ外に置き、安全な暗号化バックアップを取る。LINE等に秘密鍵を送らない。`.gitignore`だけを保護策にせず、公開鍵の出力を除きファイルの内容をログ／チャットへ貼らない。`PETA_SIGNING_KEY`環境変数も**内容ではなくパス**。

## 3. 追加封筒／素材／無効化の通知

```sh
export PETA_SIGNING_KEY="$HOME/Peta-private/official.key"
peta-pass event --id halloween-26 --kind extra_envelope --count 1 \
  --not-before 2026-10-31T00:00:00+09:00 --not-after 2026-11-02T00:00:00+09:00 \
  --title "Happy Halloween" --message "One more envelope." --out halloween.peta --as-code

peta-pass event --id kraft-fall-26 --kind grant_material --material kraft --count 2 \
  --not-after 2026-11-02T00:00:00+09:00 --title "A little paper" --out kraft.peta --as-code

peta-pass event --id withdraw-fall --kind revoke --revoke-id kraft-fall-26 \
  --not-after 2026-11-02T00:00:00+09:00 --out revoke.peta --as-code
```

`--key`も使える。出力ファイルは新規作成し、既存ファイル（鍵を含む）を上書きしない。封筒は1〜3通、素材は1〜10枚。カタログにある有限素材のみでMatteは不可。追加封筒は通常の封筒を開けた後に消費され、残数は翌日に持ち越す。受領期限を過ぎてからイベントを適用することはできないが、受領済みの封筒の残数は失効しない。

同じ配布のファイルとコードは**同じイベントID**を使う。IDは一度使ったら別の配布へ使い回さない。コードはID16バイト以下、ASCII英数字から始め、英数字／`-_.`だけ。ファイルは80バイト以下。コードは114バイトをBase32にして234文字。署名が64バイトあるため、130文字へ切り詰めることはできない。タイトル／メッセージはファイルにのみ入る。

受け取り側はOpen Peta file…でファイルを開くか、Redeem Code…へコードを貼る。空白／ハイフン／大小文字／Oと0／I・Lと1は許容される。入力を手で短縮しない。

## 4. 画像付きの公式Pack／ステッカー

pack.jsonの例（画像は手元にあるものを使う。PNGファイル名はkeyと同じ）:

```json
{
  "packId": "fall-desk-26",
  "title": "Fall Desk",
  "author": "Peta",
  "pouch": "kraft",
  "items": [
    {"key": "leaf", "name": "Leaf", "rarity": "rare"}
  ]
}
```

```sh
peta-pass grant-pack --id fall-pack-26 --pack pack.json --dir ./pngs \
  --not-after 2026-11-02T00:00:00+09:00 --out fall-pack.peta

peta-pass event --id fall-sticker-26 --kind grant_sticker --png ./leaf.png \
  --not-after 2026-11-02T00:00:00+09:00 --title "A leaf for you" --out leaf.peta
```

Packは1〜24枚、各PNG8MB以下、全体24MB以下。外装はkraft／matte／holo、レア度はcommon／uncommon／rare。grant_stickerはPNG1枚と任意の`--mask`で、Petaからの封をしたGiftになる。画像付き配布はコードにしない。ファイル署名が通る前にはPNGをデコードしない。画像は4096px／64MBデコード上限もある。

## 5. 読むだけの検証

```sh
peta-pass verify halloween.peta
```

同梱の公式公開鍵で検証し、中身を表示する。DBへ適用はしない。新しい鍵の公開鍵をアプリへ同梱する前にツールだけ検査するなら`--public-key "公開鍵"`も使えるが、この結果は**指定鍵での署名一致**で、アプリが公式と認める保証ではない。Gift v1は署名なし、v2とPETAPACKは端末の署名を検証する。

## 6. 配布後の限界と端末鍵

署名は「その鍵で作られ、途中で変わっていない」ことを示す。友達の鍵は初回信頼（TOFU）で、本人確認ではない。指紋は別の会話等で本人に確認できる。同名別鍵の警告は受け取りを止めず、同じ鍵の2通目から✓を出す。端末鍵はライブラリフォルダのdevice.key。消す／紛失すると同じ送り手として署名できなくなるので、ライブラリと一緒に保護してバックアップする。

配布済みの取り消し、先着人数、端末をまたぐコード再利用、端末時計の改ざんは防げない。revokeはその通知を受け取った端末で**未適用イベント**だけを拒否し、既に受領した素材等を回収しない。サーバーによる全体配布数の管理はない。現金・Scraps・アカウント同期はこの機能に含まれない。

## 7. 友達が作る作者パック

BookのMake a Pack…で3〜24枚を選ぶ。次の画面で40文字以内のパック名、kraft／matte／holoの外装、各ステッカーの名前とCommon／Uncommon／Rareを指定する。Set allで一括設定できる。Seal & Save…で端末鍵を使って署名し、.petaとして保存する。元の写真やORIGINAL番号は含まれず、完成PNGとマスクだけが入る。PNG／maskは各2MB、全体24MBまで。自分の棚へは自動で追加しない。

同じ端末・同じ題名で保存すると版が上がる。題名を変えると別パックになる。作者名はSettingsの名前を使い、Peta（大小文字・前後の空白違いも含む）は使えない。保存ダイアログを取消したら版は増えない。

受け取り側はOpen Peta file…で開き、作者の指紋・枚数・ランダム開封の案内を確認してAdd to my shelfを押す。Cancelでは棚も友達の登録も変わらない。同じ版以下は受け取れず、新しい版ではまだ無い項目だけが加わる。既存項目の画像／名前／レア度は置換せず、開封済みの履歴は残る。素材の在庫は増減しない。友達のパックは中身がある間、回数制限なく開けられる。

レア度の抽選はCommon 60／Uncommon 30／Rare 10の重みで等級を選び、その等級の残る項目から1枚を選ぶ。尽きた等級の重みは残る等級へ配分する。署名は鍵の継続性を示すもので、レア度や作者の実世界の本人確認を保証するものではない。
