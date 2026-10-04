# 署名付き配布の実装報告

対象: `claude/relaxed-dijkstra-ocnjzu`。指示書 `docs/codex-signed-distribution-prompt.md` のStep順に実装する。画像・アート・CSS・決定表は変更しない。本物の公式秘密鍵は生成しない。

## Step 1 — 署名の土台

Ed25519-dalek v2、SHA-256、OS乱数、Base64公開鍵、鍵ID、8桁の指紋を追加した。共通フレームは最大24MB／ヘッダー64KBで、ヘッダーを上限付きで読み、MAGICから添付末尾までの署名を検証してから添付を呼出元へ渡す。`verify_strict`を使う。

端末鍵のI/Oは`device_key.rs`に閉じ、ライブラリフォルダの`device.key`を新規作成0600で保存する。既存鍵を上書きせず、不正長・シンボリックリンク・Unixでの公開権限を拒否する。秘密鍵の内容はエラー／ログへ出さない。`.key`／`.pem`／`.secret`をgitignoreへ追加した。

公式公開鍵の`k1`は開発用の仮キーで、本番配布の信頼根には使わない。`official_keys.rs`の`TODO(owner): replace with the real official public key`をオーナーが差し替える。公式の秘密鍵は生成・保存していない。自動テスト用鍵は毎回OS乱数で生成する。

署名の限界（実世界の本人確認、配布済み取消、配布人数、別端末での再利用を防げない）は`sign.rs`のモジュールコメントに記載した。端末鍵のバックアップ／Keychain移行は今後の運用判断。

検証: 共通フレーム・署名の正常系、1バイト改ざん、異なる鍵、未知の公式鍵ID、端末鍵の再読込・権限・上書き拒否を自動確認。全workspaceの`cargo test`と`npm test`をStepごとに実行する。初回は既存の生成物でディスクが満杯になったため、targetの増分／examplesだけを削除して再実行した。

Step 1結果: cargo test --workspace 全て成功（core 96件、統合5件、Tauri側23件）、npm test 31件成功。
