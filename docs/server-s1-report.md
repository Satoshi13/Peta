# S1 審判役の実装報告

2026-10-12。実装・自動テスト・dev へのマイグレーション／デプロイを完了。本番は変更していません。実機での確認項目は残しています。

## 作ったもの

- `cloudflare/peta-api/`: Wrangler 4.149.0 に固定した TypeScript Worker、D1 `0001_ledger.sql`、署名・nonce・時刻・拒否鍵・回数制限の検証、全9台帳 API と署名不要 health。フレームワーク・R2 binding はなし。
- Creation / Transfer / Request の固定鍵検証データ。Rust と Worker で同じバイト列・署名を検証。既存 Creation / Transfer の内容と Gift v1〜v3、Pack v1/v2 の形式は維持。
- app crate の optional `ureq` / rustls を使う `HttpReferee`。10秒、リダイレクトなし。`server` を `developer` が有効にする。既定ビルドは NoReferee で、HTTP コード・依存を含まない。
- core の Referee、まとめた PackRegistration、V14 の登録／取消／枠の引き待ち、正確な Gift claim の再送、既存データの一度限りの移行、使われた枠の除外と最大3回の引き直し。
- 起動・フォーカス復帰・操作前・作成後の送信。自動は4件、Sync now は最大60件。オフラインで打ち切り、拒否された1件に関係のない登録は処理する。自動 HTTP 中は Library mutex を解放する。server 構成の Library を待つ IPC は UI スレッドの外で実行する。
- Collection / 裏面の Checked by Peta・Waiting to check・Not checked、確認済み版の警告抑制、英語の失敗文言、開発者 Settings の URL・最終通信・待ち件数・終端復旧件数・Sync now。
- 運用手順、README、判断記録、macOS 実機チェック項目。

台帳は SQL trigger と条件付き更新、batch の途中の失敗を強制する assertion を使う。Gift claim の競合では1人、枠と版の claim も同じ batch で1人だけが確定する。200枠の press は JSON のまとめた INSERT で D1 のクエリ数を抑える。

## dev の結果

- Worker: [peta-api-dev](https://peta-api-dev.peta-api.workers.dev)
- D1: `peta-dev`、`0001_ledger.sql` 適用済み。
- Worker version: `d1b088c4-827f-4172-87b7-ae22dc6ea2fa`。
- `GET /v1/health`: HTTPS、HTTP 200、`{"ok":true}` を確認。
- 実 D1 の使い捨て鍵で登録→release→B/C同時 claim→勝者の同じ claim 再送、pack 登録→B/C同じ版枠の同時 claim→使用済み枠確認→開封後 cancel の拒否、cancel が先に届いた release の拒否を確認。HTTPS で再実行済み。テストの小さな台帳記録だけが dev に残る。これはアプリ GUI・2台の Mac での検証とは別。

初回 deploy で workers.dev のサブドメインが登録され、HTTPS が使えるまで数分かかった。最初の migration は D1 リモート SQL 分割の `CASE ... END` の扱いで失敗した。CASE を括弧で囲む意味を変えない調整後に再適用して成功。ローカルとリモートの両方で確認した。関連するサービス側の事象は [Cloudflare issue #4727](https://github.com/cloudflare/workers-sdk/issues/4727) を参照。

## 依頼から追加・変更した判断

1. 作業開始時点で V14 は既にローカル Market の表に使われていた。既存 V14 を壊さず、その後に冪等な S1 拡張を適用する。バージョンは14のまま、V1〜V13 の SQL は変更しない。V13→V14 の保持、既存 V14 への再適用をテストした。
2. API 本文は現行 Rust serde に合わせ camelCase。PackRegistration は `sourceIds` も持つ。これは端末の取り消し対象の判定に使い、Worker の版証明の代わりにはしない。
3. `cancel_pack` は pack ID だけでなく登録全文を受け取り、登録 digest を照合する。release 署名と pack 登録 digest に取消記録を残す。取消が元の HTTP リクエストより先に届いても、元の操作が遅れて復活しない。同じ内容の通常の再送は成功するが、成功した取消の後に同じ操作を復活させる再送は拒否する。
4. Gift claim にも永続 `gift_claim_pending` を追加した。サーバーで claim が通り応答だけ失われた場合、同じ鍵・時刻・署名を再送して冪等性を守る。枠も同じ枠・同じ transfer を再送する。
5. 確認済み原本は画像・作成証明を変更できない。別のステッカーとして作る。登録を一度も試していない待ち原本は編集でき、登録待ち本文も更新する。登録を試した原本は応答喪失の可能性があるため編集を止める。
6. ファイル公開と SQLite COMMIT は同じトランザクションにできない。公開後の claim が先に確定して取消できなくなった場合は、遠隔の持ち主を守って終端復旧する。Gift／移動原本を gone、刷った原本を pressed にし、`referee_reconciliations` を記録。prize 在庫も取消 intent の記録から控除する。ローカル完成パックは自動復元せず、専用文言・復旧件数で知らせる。接続不能・判定不能なら取消 intent を残して対象の再送／再 press を止める。
7. Rate Limiting binding は dev で使用できた。拠点ごとの近似制限なので、変更可能な分／時間制限は D1 カウンタでも適用する。GET は nonce を保存しないが、回数カウンタは書く。
8. 指定された `@cloudflare/vitest-pool-workers` を使用。現行版は改名の警告を出す。ローカル workerd の最大 compatibility date に合わせ、テスト時だけ2026-08-22、デプロイ設定は作業日2026-10-12。

## 実行した検証

| 検証 | 結果 |
|---|---|
| Rust `cargo test --workspace`（既定） | app 5、core 196、original_management 5、CLI 1、すべて成功 |
| Rust `cargo test --workspace --features developer` | app 7（HTTPモック／リクエスト署名含む）、core 197、original_management 5、CLI 1、すべて成功 |
| リポジトリルート `npm test` | 166件成功 |
| Worker `npm test` | 3ファイル・20件成功 |
| Worker `npm run check` | TypeScript成功 |
| default `cargo tree -p peta -e normal` | ureq / rustls / reqwest なし |
| developer の同じ依存ツリー | ureq 2.12.1 → rustls 0.23.45、reqwest なし |
| dev health と署名付き台帳 smoke | 成功（上記） |

Rust は `src-tauri/Cargo.toml` を指定し、ディスク容量対策で `CARGO_INCREMENTAL=0` を使った。Worker のローカル D1 は localhost の bind、既存 Apple Vision テストは macOS の画像処理サービスが必要なため、許可された実行環境で再確認した。必要な権限による初回の失敗を、動作成功として数えていない。

偽 Referee のテストは別々の Library データフォルダで Gift の勝者を確認。オフライン作成、取消の保存と再送ブロック、保存失敗、枠の競合・同じ再送、移行の各分類、サーバー以前の受取に加え、公開直後に受取／開封された保存失敗の終端復旧、復旧拒否が他の登録を止めないことを確認した。

各段階の Rust・Worker・UI は別コミットで記録。ユーザーの既存 `docs/ui-proposals` や `.claude` などの変更はこの作業のコミットに含めていない。

## 守れないこと・未実施

- 改造したクライアントが自分のローカル DB・表示を偽ることや、同じ画像を別 ID で作ることは止められない。台帳に登録された1つの ID・枠の正当な持ち主はサーバーが決める。
- サーバー以前の Gift／Pack の全世界の重複を遡って保証しない。Not checked のまま扱う。
- 鍵を失った端末の所有権復元、友達、受信箱、R2 の Gift 配送、identity Export / Import は S2。独自ドメイン・本番公開は未実施。
- 未確認の取消・枠 pending は接続が回復するまで残る。終端復旧は相手の受取を守るため、保存失敗でも元の状態へ完全には戻せない。パックの完成記録の復元や、復旧時に不足する prize 在庫の負債管理は行わない。不足は0で止め、復旧記録を保全する。
- GUI の実操作・2台の Mac・実際の Wi-Fi 切断・強制終了は自動テストと別で、下のチェック項目が残る。

## オーナーが行うこと

[server-howto.md](server-howto.md) の本番 migration / deploy、通知・使用量監視・ログの運用、D1 バックアップ／復元、鍵の保全。本番切替と配布版の `server` 公開は別途判断する。作業中に `--env prod` の操作は実行していない。

実機では [macos-checklist.md](port-spec/macos-checklist.md) の S1 項目を確認する。

- A の原本登録→Gift保存→B/Cの同じファイル受取で B だけ成功。
- B/C の同じパックで同じ枠・版が二重に渡らないこと。
- Wi-Fi 切断で送る／受取／press／Open の英語エラーと元の状態、オフライン作成→接続後の確認済み表示。
- タイムアウト／強制終了後の同じ claim・同じ枠の再送、取消完了まで再送を止めること。
- サーバー以前の Not checked、確認済み版の裏の警告抑制、Sync now・復旧件数。
- 通常版の既存挙動、窓・保存ダイアログ・デスクトップ更新の応答性。
