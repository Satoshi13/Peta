# ベータのアプリ内アップデート

友達限定ベータだけが対象です。offlineとDeveloperには更新用プラグインを組み込みません。Developerも`server`を使うため、更新の依存は追加の`beta` featureで分けています。`build:beta`は`beta`を選びます。Rust 1.90以上が必要です。

## オーナーの鍵

暗号化したディスクをマウントし、新しいパスを指定します。既存ファイルを上書きしません。パスワードは対話で入力し、秘密鍵は表示しません。

```sh
bash scripts/updater-key.sh /Volumes/Peta-private/updater.key
```

表示される**公開鍵だけ**を`src-tauri/tauri.beta.conf.json`の`plugins.updater.pubkey`へ入れます。`requireSignedVersion: true`を維持します。空・壊れた公開鍵ではbetaをビルドできません。本物の秘密鍵やパスワードはリポジトリ、ログ、CI、Worker、チャットへ入れず、オーナーの暗号化ディスクと暗号化した予備だけに置きます。

鍵をなくすと、その鍵を持つ既存アプリへは以降の版を配れません。漏れた場合も新しい公開鍵を入れた版をDMGで配り直します。サーバーの鍵を変えるだけでは移行できません。

## 版を出す

1. `tauri.conf.json`・Cargoとパッケージの版を整え、公開鍵入りv0.1.0を最初の配布に入れます。
2. 暗号化ディスク上の秘密鍵の**パス**を環境変数`TAURI_SIGNING_PRIVATE_KEY_PATH`へ指定します。必要なパスワードは安全な手元のセッションで`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`へ設定し、コマンド引数やログへ出さないでください。終了後に解除します。
3. `bash scripts/release-mac.sh beta --unsigned`、またはDeveloper ID設定済みなら`bash scripts/release-mac.sh beta`。署名ありの場合はアプリの公証・stapleが終わってから最終アーカイブを作り直して署名します。
4. DMGの隣の`Peta-<version>.app.tar.gz`と`.sig`を一緒に保持します。署名には版番号も含みます。新しい出力名を使い、途中失敗したアーカイブを別の版へ使い回しません。
5. `bash scripts/publish-release.sh <DMG> dev --unsigned --notes "What changed" --keep 3`でdevを確認します。本番への公開はオーナーが`prod`を明示して行います。DMG→更新tar.gz→署名→`latest.json`の順に書きます。

公開後は全容量と版数を表示し、保持する最新N版より古い候補だけを一覧にします。削除は`y`を入力した場合だけです。現在の`latest.json`が指す版・ファイルを保護します。保管数は`--keep N`。10GBの無料枠には他のR2データも含むため、アカウント全体もCloudflareで確認してください。

手動で容量・削除候補を確認する場合は`python3 scripts/prune-releases.py dev <latest.json> --keep 3`。手動削除は候補を確認してから`npx wrangler r2 object delete peta-downloads-dev/releases/<file> --remote`、更新は`releases/updates/<version>/Peta.app.tar.gz`と`.sig`を同様に削除します。最新版は消しません。Wranglerの認証情報は補助ツールのメモリ内だけで利用し、画面には表示しません。

## 友達に見えるもの

起動時・ウィンドウを前に出した時に、6時間に1回まで確認します。招待停止中のMacはサーバーが拒否します。ダウンロードと署名検証は裏で行い、完了後に`Peta … is ready. Restart to update · Later`と表示します。Laterは次の起動までその版を控えます。演出中・編集中・印刷待ちには通知を待たせ、印刷中の入れ替えはRust側でも拒否します。

SettingsのAbout Petaに現在の版とCheck for updatesがあります。新しい版がない知らせは手動時だけです。通信・署名検証・置き換えの失敗は自動時は静かに扱い、手動時だけ短く知らせます。検証失敗したデータは保存・利用しません。

署名検証に失敗したら、再署名・公開鍵・署名対象の版番号を確認します。古い版の署名を新しい版として使えません。サーバー側で更新を止める場合は`latest.json`の`update`を外します。更新トークンは10分、そのMacと版に結び付いています。公開中に最新版を切り替えると旧版のトークンは失効するため、次の確認で取得し直します。

## 実機の確認と配布日

実機確認の結果・未確認範囲は[updater-report.md](updater-report.md)。ローカルで生成したad-hocアプリの結果と、ブラウザから初めてダウンロードするDMGのGatekeeper判定を混同しないでください。今回のローカルad-hoc版の更新・自動再起動は追加操作なしで通りました。初回DMGでは引き続き「このまま開く」が必要になる場合があります。許可済みの位置情報が保持されるかは未確認です。配布前に実際のDMG経路で確認してください。

prodへのD1・R2・Worker反映や秘密の登録は今回行っていません。配布日にオーナーが0008〜0010のD1適用、公開鍵入りアプリ、R2の公開、peta-apiの招待必須化をまとめて行います。順番は[release-day-runbook.md](release-day-runbook.md)。`updater-test`は使い捨て実機テスト専用で、配布ビルドでは拒否します。

確認したTauri公式文書:

- [Updater v2](https://v2.tauri.app/plugin/updater/)
- [Rust updater API](https://docs.rs/tauri-plugin-updater/2.14.0/tauri_plugin_updater/struct.Update.html)
- [版を署名へ含めるCLI変更](https://v2.tauri.app/release/tauri-cli/v2.12.0/)
- [Process v2](https://v2.tauri.app/plugin/process/)
