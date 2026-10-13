# 公式イベントの鍵（オーナーだけが行う）

2026-10-14。k1 は公開された RFC 8032 のテスト鍵です。通常版・ベータ版は信用せず、テストと Developer だけで使用できます。配列の0番は残し、PETA1 の鍵番号を変えません。

本物の鍵は、ネットワークを切ったオーナーの Mac で生成します。以下は手順で、今回の作業では実行していません。

1. 既存の `peta-pass` をあらかじめビルドします。`cargo build --manifest-path src-tauri/Cargo.toml -p peta-pass --release`。
2. ディスクユーティリティでパスワード付き暗号化ディスクイメージを作り、マウントします。パスワードと復旧用の控えはオーナーだけが保管します。
3. オフラインで `peta-pass keygen --out /Volumes/Peta-private/official.key` を実行します。新規0600ファイルにのみ書き、秘密鍵は標準出力に出ません。CLI の鍵ファイル自体は平文なので、暗号化イメージの外へコピーしないでください。
4. `peta-pass pubkey /Volumes/Peta-private/official.key` で公開鍵だけを取得します。
5. `official_keys.rs` の KEYS の**末尾**に `("k2", Some("公開鍵"))` を追加します。k1 を消したり順番を変えたりしません。古い鍵のスロットも維持します。
6. 更新したアプリを配った後、イベントを `--key-id k2 --key /Volumes/Peta-private/official.key` で署名します。イメージをアンマウントし、暗号化した予備をオーナーの手元に保管します。

秘密鍵・ディスクイメージ・パスワードはリポジトリ、Worker、チャットへ入れません。詳しいイベント生成は [distribution-howto.md](distribution-howto.md) を参照してください。
