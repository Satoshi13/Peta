# 署名付き配布の使い方（オーナー向け）

§1〜7は公式ファイル・コードの配布手順です。ファイルはAirDrop／メッセージ等で運び、添付なしの配布はコードを投稿できます。受け取りはその端末のDBで1イベントにつき1回。後半にアプリ自体の通常版・ベータ版のビルドとDeveloper ID署名・公証の手順を記載します。

## 1. ツールをビルドする

```sh
cargo build --manifest-path src-tauri/Cargo.toml -p peta-pass --release
src-tauri/target/release/peta-pass --help
```

以降は`peta-pass`をPATHに置いた場合の例。ビルドした実行ファイルのフルパスでもよい。

## 2. 本物の公式鍵をオーナーが作る

**Codexは本物の公式秘密鍵を生成していません。** オフラインのMacで、パスワード付き暗号化ディスクイメージ内に既存peta-passを使って作る手順は [`official-key-howto.md`](official-key-howto.md) を参照してください。公開鍵だけをk2として末尾へ追加します。k1はRFCテスト鍵のため、通常版・ベータ版では信用しません。配列の古い位置やIDを削除・置換・並べ替えしないでください。以下の `PETA_SIGNING_KEY` は暗号化イメージ内の秘密鍵ファイルへのパスです。鍵そのもの・パスフレーズをログやチャットへ出さないでください。

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

## 2026-10-14: アプリのリリースビルドとパス検査

配布用の順序は **ビルド → パス検査 → Developer ID署名・公証**。`npm run build` は通信なしの通常版です。ビルド用ラッパーは HOME とリポジトリの絶対パスをRustの `--remap-path-prefix` で置換します。空白を含むパスと既存のRustフラグは `CARGO_ENCODED_RUSTFLAGS` で扱い、利用者ごとのパスは設定ファイルへ保存しません。

```sh
npm run build
npm run check:binary-paths
```

検査は.appのContents/MacOS内の実行ファイルにstringsをかけ、個人のホームパスが1つでも残れば一覧を出して失敗します。別の成果物は `python3 scripts/check-binary-paths.py '<成果物>/Peta.app'` で検査します。失敗した成果物は配布せず、依存ライブラリを含めてビルドフラグを確認します。

## 2026-10-14: ライセンスと脆弱性の確認

配る前に `npm run licenses` で `THIRD_PARTY_NOTICES` を再生成し、変更した依存と通知を確認します。cargo metadata（locked/offline、macOS、全feature）と既にあるcrateの本文、同梱フォントのNOTICE/OFLを使います。crate配布物に本文が無いものの補完は `third-party/licenses/sources.json` に版に対応する取得元とSHA-256を記録し、再生成では通信しません。MITを選択できる補完対象はMIT本文を同梱し、objc2の上流のApple SDK由来の告知も保持します。MPLの未変更ソースを取得する版固定URLも各項目へ記載します。上流のSDK告知・ソース提供条件を含む法律面の最終確認は専門家と行ってください。

配布前の脆弱性照合:

```sh
cargo audit --file src-tauri/Cargo.lock
npm audit
cd cloudflare/peta-api
npm audit
```

cargo auditが無ければ、その導入はオーナーが判断します。この作業はcargo audit/cargo aboutを新しくインストールしません。監査は当日時点の情報なので、実際に配る直前にも行います。検出を機械的な一括更新で消さず、影響と修正版を確認してテストします。

## 2026-10-14: Developer ID署名・公証（B2）

オーナーが一度だけ行うこと:

1. Apple Developer Programの登録と配布名義を決める。個人登録は法的氏名を用い、Developer ID証明書にもその名義が含まれる。コードの匿名化とは別なので、公開前に証明書の名義を確認する。[Appleの登録案内](https://developer.apple.com/programs/enroll/)と[Developer ID証明書の方針](https://images.apple.com/certificateauthority/pdf/Apple_Developer_ID_CPS_v3.2.pdf)を参照。
2. **Developer ID Application**証明書と対応する秘密鍵をMacのキーチェーンに準備する。Developer/Distribution/Installer証明書はこの.app用と混同しない。[Appleの作成手順](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)。
3. Xcodeのnotarytoolで資格情報をキーチェーンへ登録する。対話式に入力し、パスワードをコマンド・文書・リポジトリへ書かない。

```sh
xcrun notarytool store-credentials "Peta-notary"
```

毎回の実行（オーナー自身が行う。これを実行するとAppleへ署名のtimestamp取得と公証用.appを送信する）:

```sh
export APPLE_SIGNING_IDENTITY='Developer ID Application: <証明書に表示される名義> (<Team ID>)'
export PETA_NOTARY_PROFILE='Peta-notary'
bash scripts/release-mac.sh beta
# 通信なし版を配る場合
bash scripts/release-mac.sh offline
```

順序はbuild → 個人パス検査 → hardened runtime＋timestamp署名 → zip送信＋wait → Accepted確認 → staple/validate → codesign verify/spctl → **staple済み.appをもう一度zipへまとめる**。最終zipは `src-tauri/target/release/distribution/Peta-beta.zip`（offlineはPeta-offline.zip）。既存zipは上書きせず止まるので、別の版は `PETA_RELEASE_OUTPUT` に新しいファイル名を指定する。`PETA_APP_PATH` は検査・署名するbundleを変更する場合だけ使い、直前にビルドしたものと一致させる。署名IDまたはprofile名が無い場合は、ビルド・Apple接続前に手順を表示して止まる。証明書と秘密鍵の有無もbuild前にローカルで照合する。profileが未登録・無効の場合はnotarytoolが失敗し、配布zipは作らない。

ビルドラッパーはApple資格情報を子プロセスへ渡さず、Tauriの署名はadhocに限定する。正式署名・公証の順序はこのスクリプトだけで管理する。`PETA_ENTITLEMENTS`は必要性を確認したplistへの任意のパス。現行のWKWebView・画像処理・透明窓のために、debug/JIT/unsigned libraryの権限をまとめて追加していない。macOSPrivateApiは透明窓に必要な既存設定で、App Store向けにはしない。Developer IDでの実公証と別Macの動作は未確認で、公証ログとGatekeeperに合格してから配布する。

[Appleの公証要件](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)と[Tauriの署名・公証案内](https://v2.tauri.app/distribute/sign/macos/)に基づく。Codexは登録・証明書作成・profile登録・実署名・実公証を行っていない。`python3 scripts/test-release-mac.py` は偽のツールと一時bundleだけで順序・拒否・staple後の再zipを検証し、Appleへ接続しない。

配布前にdocs/terms-draft.md・privacy-policy-draft.mdの未記入と法的確認を終え、正式なHTTPSの規約・ポリシーURLをsrc-tauri/src/about.rsのSERVICE_LINKSへ設定してビルドする。未設定ではAboutに表示されない。
