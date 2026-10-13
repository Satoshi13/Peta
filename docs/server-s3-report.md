# S3 友達のMarket — 途中報告

2026-10-13。**Step 1・Step 2まで完了。ユーザーの指示によりClaudeへ引き継ぐため停止。S3全体は未完了で、アプリから友達のMarketを利用できる状態にはまだなっていない。** 再開手順・設計メモは [server-s3-handoff.md](server-s3-handoff.md)。

## 完了したもの

| Step | 内容 | コミット |
| --- | --- | --- |
| 1 | Rustの内容暗号化・HPKE封筒、固定鍵のMarket登録/pull署名検証データ、Workerとの照合テスト | `5a5f8f5` |
| 2 | Workerの暗号文出品、相互の友達だけの一覧・取得、枠claimと売上の同時確定、payout/ack、close/leave、listing通報、0003 migrationと上限設定 | `5e6ffc9` |

既存のChaCha20-Poly1305 0.10.1・HPKE 0.12.0・rand_core 0.6.4・Ed25519を使用。新たなcrateは追加していない。Workerは既存Wrangler 4.149.0とVitestを使用。アプリDBのV17、Scraps支払い/精算、HTTP/IPC、UI、devデプロイは未着手。

## 検証

- Rust既定: app 11 / core 229 / original_management 5 / CLI 1、成功。
- Rust developer: app 14 / core 231 / original_management 5 / CLI 1、成功。任意の実API liveテスト1件はignoredで、今回は実行していない。
- ルートJS: 187件成功。
- Worker: 6ファイル・50件成功。TypeScript検査成功。
- 相互許可と封筒のない鍵の拒否、edition claimとsaleの同時確定、競合の勝者1人、同じpullの再送、rolling 24h上限、payoutの本人限定・ack後退防止、close後も無料claim不可、退会で暗号文削除・売上保持を検証。
- 別経路のsticker/pack cancelによる出品中の版の取り出しを拒否。購入確定後の運営Blockでも正確な再送だけを許可し、新規購入を拒否することを追加検証。
- sandbox内でのApple Vision失敗とWorker待受失敗は、必要な権限で再実行して成功した。テストをskipして成功扱いにはしていない。

## 依頼書から補ったこと・未解決の仕様

- 出品行にサーバー導出の `seller_hash` を保存し、最大100件の一覧を相互許可付きSQLで取得する。
- 通報の種類を0003でreports表へ追加。最大200件の封筒はbulk SQLで更新。
- 大容量のbase64変換をchunk化し、spreadのスタック超過を防ぐ。
- 正確な確定済みpullの復旧に限って、後のclose・友達解除・Blockで拒否されないようにする。新規操作の制限は維持する。
- pack_idがUNIQUEでclosedを残す指定と、「鍵だけ復元したら新しい内容鍵で出し直す」というplanの記述は整合が必要。現Workerはclosedの別listingへの再登録を拒否し、pausedから同じ出品をopenすることは可能。Step 4で報告・整理する。

## 残る作業と制約

Step 3〜7を依頼書の順に続ける。S3とは別の公開前問題（公式仮鍵、CSP、identity復元、OS名の初期表示）は変更していない。ユーザーはApp Storeへ出さない方針。

Scrapsは端末残高のままなので、改造アプリによる「払わずに引く」、DBの残高書き換えをサーバーは防げない。友達が取得した暗号解除済みパックを別の人へ渡すことも防げないが、出品済みpackの無料開封はWorkerが拒否する。listing通報の真偽は運営確認が必要。

devのbucket作成・リモートmigration・deploy・実API往復は未実施。本番には一切操作していない。最終の依存ツリー確認、3つのデータフォルダを使うアプリ往復、Mac実機UI、通信断、24MB近いパックの時間確認も未実施。運用手順・日英プライバシー下書き・README・decisions・実機チェックリストのS3更新はStep 7に残る。
