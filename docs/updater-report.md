# アプリ内更新：実装・確認結果

2026-10-16。友達限定ベータの更新API・署名検証・ダウンロード・静かな再起動案内・リリース手順を実装しました。本番のデプロイ、秘密の登録、本物の更新鍵の生成は行っていません。

## 実装したもの

- `beta`だけにupdater／process依存を組み込みます。`server`を使うDeveloperにも、offlineにも含めません。公開鍵なし、壊れた鍵、署名版番号の検証を無効にしたbetaはビルドを拒否します。
- APIは既存の端末署名・招待・停止判定を通します。更新URLは10分で切れ、端末と版に結び付きます。トークンはD1にハッシュだけ保存し、ファイル要求にも端末署名が必要です。
- 固定のAPI origin・正確なファイルパスだけを許可し、リダイレクトを拒否。更新の署名と署名済み版番号を埋め込み公開鍵で検証します。未検証のファイルは保存せず、検証済みバイト列だけを入れ替えに使います。
- 起動・前面化で6時間に1回まで確認。通知は演出・編集・印刷中に待たせ、Laterは次の起動までその版を控えます。Settingsで現在の版と手動確認ができます。自動失敗は静かに扱います。
- 最終アプリからtar.gzを作り、版番号を含めて署名。公証ありではstaple後に作成。公開はDMG・更新ファイル・署名を先に置き、最後にlatest.jsonを切り替えます。
- R2の容量・旧版候補を表示し、確認した場合だけ削除します。削除直前にも実際のlatest.jsonを読み直し、最新版と参照ファイルを保護します。
- 管理ページReleaseはページ経由とアプリ内更新の台数を別々に表示します。

## 自動テスト

指定の全チェックを通しました：3 Workerのテスト・型確認、Rust workspace server／offline、developer official_trust、UI、リリース手順。

- API 73件、download 9件、admin 27件、Rust server 304件（既存live 3件はignore）、offline 293件、official_trust 2件、UI 237件。
- betaの偽HTTPサーバー＋実際のupdaterプラグイン：署名済みファイルの取得、バイト改変、別鍵、別版、版番号なし署名の拒否。3件成功（最終アーカイブでの仮アプリ置き換えを含む）。
- 招待なし・停止、期限切れ・別端末・別版のトークン拒否、ストリームと更新台数の記録。
- 通知の印刷／演出待ち、Later、手動再確認、自動失敗時の無通知を隔離ブラウザで確認。
- 使い捨て鍵で実際の署名を生成。鍵なしの停止、公証・stapleと梱包の順序、暗号化ディスク以外への鍵作成拒否、上書き拒否、公開鍵だけの表示、旧版削除の確認と保護は偽ツールでも確認。
- offline／server／Developerの通常依存ツリーにupdater・processがなく、betaにだけ存在することを確認。

最終全チェックの記録は`/tmp/peta-feature-checks/completed/`、betaの最終記録は`/tmp/peta-updater-isolated-final.log`です。

## 実機の通し確認（dev）

**成功：ad-hoc署名のuniversal版0.0.1-test → devの署名付き更新API → ダウンロード・署名／版検証 → アプリ置き換え → 0.0.2-testへ自動再起動。** 実施MacはApple silicon、macOS 27.2 (26B5112a)。両版ともarm64／x86_64の2スライスとcodesignを確認しました。Intel実機での起動は未確認です。

ステッカー1枚・友達1人・Scraps 20・招待情報・保存確認マーカーがすべて一致しました。結果は`/private/var/folders/m4/ff9wnnhd2hl7bhyszm_tv5yr0000gn/T/peta-updater-live-vmz04hlg/result.json`。devの最新版案内は元の状態へ戻し、0.0.1-test／0.0.2-testのtar.gzと署名、計4オブジェクトを削除済みです。

- **「このまま開く」：この試験の更新・自動再起動では追加操作なしで起動しました。** 起点はローカル生成の未quarantineアプリです。ブラウザから初回DMGを取得し、Gatekeeperで一度許可した経路そのものではないため、その経路でも必ず再確認不要とは断定しません。初回DMGと公証済み配布物は別途オーナーの確認対象です。
- **位置情報：更新前後とも`unknown`（未許可）、アプリ内のpromptedもfalseで一致。許可済み状態の維持は未確認です。** 別試行で位置情報要求は行いましたが、OSの許可状態がunknownのままで、許可済み→更新の比較には至りませんでした。許可が保持されると断定しません。
- 通常のPetaのデータには触れず、専用identifier・一時ライブラリ・使い捨て鍵・固定dev接続先を使用。配布用ビルドと公開スクリプトは`updater-test`を拒否します。

通し確認で見つかった梱包不具合も修正しました。macOSのtarが付けるAppleDoubleの`._Peta.app`が、updaterの展開先ルートと衝突して失敗していました。`COPYFILE_DISABLE=1`で不要メタデータを含めず、アプリ内のファイルとstaple後の内容を保持して梱包します。xattr付き仮アプリの実インストールとアーカイブ内容の回帰テストを追加しました。配布前にも単一のPeta.appルートとAppleDouble不在を確認します。

テスト起動時の`/var`シンボリックリンクとAppKitのクラッシュ後ウィンドウ復元も切り分けました。テスト側だけで起動パスを正規化し、復元を控える引数を使っています。Tauriの実行パス保護や通常のPetaのOS設定は弱めていません。

## devの反映

- D1 `peta-dev`へ0008／0009を適用。
- API dev：`4207e444-551f-42a6-9d6a-69f6d52c8432`。
- admin dev：`4ecc622d-e021-4b45-93ee-683ddfc7b090`。
- download dev：`7a837a7c-4454-4e42-8923-b095af24f5c2`。
- devのAccess設定は既存の空設定のまま、管理・ダウンロードページは403で閉じています。秘密やオーナー権限の設定は変更していません。

## オーナーが配布日に行うこと

1. 暗号化ディスクで`scripts/updater-key.sh`を使い、本物の鍵を作ります。公開鍵だけを`tauri.beta.conf.json`へ入れ、予備を暗号化保管します。現在のpubkeyは意図的に空で、配布用betaは止まります。
2. 公開鍵入りのv0.1.0を最初の配布に含めます。使い捨て鍵・updater-testアプリは使いません。
3. prod D1へ0008／0009、R2 binding・更新ファイル、admin／downloadを反映します。
4. **peta-api prodの再デプロイは、招待必須化とまとめて配布日にオーナーの指示で実行します。今回実施していません。**
5. 公証ありで配る場合はオーナーのDeveloper ID／公証設定で実行します。今回のApple署名・公証手順の確認は偽ツールであり、公証済み実配布物の実機確認ではありません。

手順は[updater-howto.md](updater-howto.md)。確認した公式資料は[Updater v2](https://v2.tauri.app/plugin/updater/)、[Update API 2.14.0](https://docs.rs/tauri-plugin-updater/2.14.0/tauri_plugin_updater/struct.Update.html)、[署名への版番号追加](https://v2.tauri.app/release/tauri-cli/v2.12.0/)、[Process v2](https://v2.tauri.app/plugin/process/)。
