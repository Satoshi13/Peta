# S2 友達・Gift の受信箱の実装報告

2026-10-13。依頼書 [codex-server-s2-prompt.md](codex-server-s2-prompt.md) の全文を読み、続けて [server-s2-handoff.md](server-s2-handoff.md) を確認。共通ルールの文書・実装ファイルを確認し、引き継ぎの「依頼書と違うところ」を優先して Step 6〜8 を完了しました。Step 1〜5 は既存コミットと引き継ぎを元に記載し、今回の全テストでも再検証しています。**本番への操作は一切実行していません。実機でしか確認できない項目は未完了です。**

## 作ったもの

| Step | 内容・主なファイル | コミット |
| --- | --- | --- |
| 1（引き継ぎ済み） | core `identity.rs`: X25519の暗号鍵・PETAF1コード・署名で結びつけた公開鍵・HPKE・鍵の書き出し／復元。Worker向け `vectors-s2.json`。 | `09df594` |
| 2（引き継ぎ済み） | Worker `inbox.ts`・`0002_inbox.sql`: 受信箱、申請、許可／拒否、R2配送、通報とWebhook、退会、回数制限。dev適用済み。 | `0d18939` |
| 3（引き継ぎ済み） | アプリDB V16、友達の requested / pending / friend / blocked、許可・受信済みID。V15→V16と既存TOFUの保持。 | `15b8fc7` |
| 4（引き継ぎ済み） | `src-tauri/src/inbox.rs`: `server`内の署名付き通信、登録・申請・承認・配送・確認・通報・退会。Gift v3の既存検証とrelease/claimへ接続。 | `9466422` |
| 5（引き継ぎ済み） | Friendsと鍵のSettingsカード、Giftsの申請／通報、StudioのTo a friend、バッジ、確認の間隔。 | `c575325` |
| 6 core | `FriendCode::parse_for_scheme`: 通常版／Developerのリンクを分け、反対スキームと不正コードを拒否。PETAF1の直接貼付は両方で可。 | `5274fcd` |
| 6 アプリ | deep-linkプラグイン、ビルド別設定、`friend_links.rs`の起動前／後のキュー、前面表示、app窓だけの取り出しIPC。 | `694dacf` |
| 6 UI | boot後にSettingsを開き、リンク入りの追加シートまで。自動送信なし、古いpreviewがSendを有効にする競合を防止。ほかのシート・ナビゲーション途中のシートも閉じるまで待つ。 | `7a2f61c`, `835ccb9` |
| 7 Worker | 署名した作者だけに `drawers[{slot,keyHash}]` を追加。作者以外は厳密に従来の `{slots}`。生の公開鍵は返さない。 | `e231989` |
| 7 core | デザイン／景品の枠範囲で人数と名前を集計。同じ人は各行に1回、知らない鍵はSomeone、重複枠は枚数に重複計上しない。 | `e47658a` |
| 7 アプリ | 作者をローカルでも確認。HTTPメタデータと枠の整合を検証し、承認済み友達だけを名前に対応。旧Workerの番号だけの応答にも対応。Library mutexを解放して通信。 | `36ec186` |
| 7 UI | 名前を小さく3人まで、残りは+N。全文はtitle／aria-label、長い名前は省略。友達のRemove／Block／改名で古い名前のキャッシュを使わない。 | `40e8f39` |
| 8 UI／文書 | Settingsに鍵だけのバックアップとデータフォルダ移行を説明。運用手順、日英プライバシー下書き、本報告、README・decisions・macOSチェックリスト。 | UI `dde4327`、文書は本報告を含むStep 8コミット |

既存のGift署名形式、8MB上限、PNG検証、`gift_already_received`、release/claim、ファイルでのGiftは維持。アプリの追加スキーマはV16、Workerは0002だけで、V1〜V15／0001は変更していません。QR、https経由の友達リンク、友達のMarket、サーバーのScraps、プッシュ、同期、複数Mac同時利用は追加していません。

## 選んだcrateと版

最終 `src-tauri/Cargo.lock` の解決版です。暗号演算は既存crateの実装に委ね、独自の暗号方式は作っていません。crateの採用やテスト通過は、Peta全体の外部セキュリティ監査を済ませたことを意味しません。

| crate | 版 | 用途 |
| --- | --- | --- |
| hpke | 0.12.0 | RFC 9180 Base: DHKEM(X25519, HKDF-SHA256)、HKDF-SHA256、ChaCha20-Poly1305 |
| x25519-dalek | 2.0.1（hpke経由） | 暗号公開鍵・受信者への封 |
| argon2 | 0.5.3 | `.petakey`のパスフレーズからArgon2idで鍵を導出 |
| chacha20poly1305 | 0.10.1 | バックアップの認証付き暗号化（ランダムsalt／nonce） |
| ed25519-dalek | 2.2.0 | 既存署名、暗号公開鍵と表示名の結びつけ |
| sha2 / hkdf | 0.10.9 / 0.12.4 | 鍵ハッシュ・HPKEのKDF |
| rand_core | 0.6.4 | HPKE／バックアップのOS乱数 |
| tauri-plugin-deep-link | **2.4.10固定** | macOSからの起動前／後の友達リンク。HTTP機能ではない |
| ureq / rustls | 2.12.1 / 0.23.45 | 既存S1のHTTP。`server`時だけ |

deep-linkは既存Tauri v2と組み合わせ、選んだ版の最低Rust版1.77.2に合わせてappの宣言を1.77→1.77.2へ更新しました（全依存の最低Rust版を保証する検証ではありません）。既定の依存ツリーにureq/rustls/reqwestはありません。

## 依頼書と違う判断・理由

引き継ぎの6項目を維持しています。

1. **最初の友達追加だけでなく、Copy code／Copy link時にも受信箱を登録**。そうしないと友達0人の相手に申請が届きません。受信箱通信の条件は「友達がいる、または受信箱を登録済み」です。依頼書の「友達0人なら一切通信しない」は、この登録済みの例外では成立しません。S1台帳の通信も独立した条件です。
2. **GET `/v1/mailbox/{id}/allowed`** を追加。申請した人が承認されたことを知るため、呼び出した本人が許可されているかだけを返します。
3. 確認はブラウザconfirmではなく**紙のシート**（Friends.ask）。既存UIの部品に合わせます。
4. Giftの封とuploadは `gift::transfer_gift` の **persist内**。通常の失敗は既存transferのrelease取消と、upload済みメッセージの削除に接続します。`inbox_outbox` は作成済みですが、現在未使用の将来用です。
5. 通報は受取時の**元のGiftファイル**（`gift_package_path`）を使います。通常配送と違い、本人の同意で復号済みの内容を運営へ送ります。
6. `.petakey` は**鍵だけ**。友達・Collection・配置・画像はDBとassetsを含むデータフォルダ全体を別途移します。空のDBへ鍵だけ復元しても友達や持っていた本物は戻りません。同じ受信箱IDを継続することと、ステッカー帳の同期は別です。

現行APIに合わせ、申請・メッセージのPOSTはクライアント生成ID付き `/requests/{rid}`・`/messages/{mid}` を使用します。これで同じ送信の再試行を識別します。期限切れの掃除は書き込みだけでなく一覧・取得などの受信箱APIでも行います。

Step 7は既存Refereeに任意の作者用メタデータを追加し、旧Workerと既存NoRefereeを維持。友達の定義は**承認済みのstatus=friendだけ**（TOFU・申請中・ブロック済みは名前にしない）。名前の表示は同じ人を各デザイン／景品に1回とし、3人を超えた数を+Nにします。名前・友達一覧をサーバーに照会して解決する仕組みではありません。

通常版にもOSの `peta` スキームを登録しますが、serverが無いのでリンクを開くと機能の案内までです。Developerは `peta-developer`。リンクも直接貼付も反対ビルドのリンクを拒否します。新しいスキームをmacOSに登録した実機確認にはインストールした .app が必要です。[Tauri deep-link docs](https://v2.tauri.app/plugin/deep-linking/) を参照。

## 検証結果

Stepごとに指定の4系統を完了後、各コンポーネントをコミットしました。Step 6のシート競合対策も最終全テストで確認しています。

| 段階 | Rust既定（app/core/original_management/CLI） | Rust developer | ルートJS | Worker |
| --- | --- | --- | --- | --- |
| Step 6 | 9 / 227 / 5 / 1 | 11 / 229 / 5 / 1 | 181件 | 4ファイル・30件 |
| Step 7 | 11 / 228 / 5 / 1 | 14 / 230 / 5 / 1 | 186件 | 4ファイル・31件 |
| Step 8 最終 | **11 / 228 / 5 / 1** | **14 / 230 / 5 / 1** | **187件** | **4ファイル・31件** |

全件成功。developer全テストでは任意実行の `inbox_live_round_trip` 1件はignoredですが、今回**別途devに対して明示実行し、1件成功**しています。これはHPKEで封をしたダミーバイト列の配送と削除を含むAPI往復で、本物のGift v3のGUI受取や2台のMacの検証とは別です。引き継ぎ書のWorker32件に対し、作業開始時の実行結果は30件でした。本報告は実際の結果を記載しています。

実行したコマンド:

```sh
CARGO_INCREMENTAL=0 cargo test --manifest-path src-tauri/Cargo.toml --workspace
CARGO_INCREMENTAL=0 cargo test --manifest-path src-tauri/Cargo.toml --workspace --features developer
npm test
# cloudflare/peta-api 内
npm test
npm run check
# リポジトリルートから明示的なdev往復
CARGO_INCREMENTAL=0 cargo test --manifest-path src-tauri/Cargo.toml -p peta --features developer inbox_live -- --ignored
```

- Worker TypeScript検査成功。作者／作者以外／不正署名／版と景品の枠をテスト。
- coreで枠範囲、重複の扱い、友達とSomeone、旧番号だけの互換性。appで友達の状態別の名前対応、HTTPメタデータの整合検証。
- JSでboot前後のリンク、別シート／ナビ中のシート、重複通知、previewだけで送信しないこと、不正・自分・blocked等、古いpreviewの拒否。売れ行きの+N、文字列の安全な描画、友情変更のキャッシュ更新、ネイティブ応答のpanel描画。
- Chromeで実際のアプリCSSと売れ行きrendererを使い、デザイン・景品・長い名前・+Nを描画。360pxの欄で横にはみ出さないことを画像と寸法で確認。
- `cargo tree --manifest-path src-tauri/Cargo.toml -p peta -e normal` にureq/rustls/reqwestなし。developerにureq/rustlsあり、reqwestなし。
- `git diff --check` 成功。既存のオーナーのUIプレビュー・Link tag画像等の未コミット変更は、この作業のコミットに含めていません。

## devの再デプロイ

`npx wrangler@4.149.0 deploy --env dev` 成功。

- Worker: `peta-api-dev`
- URL: `https://peta-api-dev.peta-api.workers.dev`
- Version ID: `d70f7158-1a1f-44f2-b984-b9ba3747bd18`
- binding: `peta-dev` / `peta-gifts-dev` / `peta-reports-dev`。今回はマイグレーション追加なし。

再デプロイ後 `/v1/health` 200、署名した小さなテストパックで版／景品のclaim→作者の鍵ハッシュ付き応答→別の鍵の番号だけの応答を**実APIで確認**。テスト用のパック・版・枠の小さな台帳記録がdevに残ります。受信箱の往復テストは最後に両受信箱を削除しました。Webhook secretは今回設定していません。

## 守れないこと・残る制約

- macOSにインストールした署名付き .app のリンク起動、GUIの2台往復、スリープ、実際の通信断や強制終了は未検証。下のオーナー項目に残します。
- 強制終了を含むGift送信の耐久性を完全に保証したとは言えません。現在 `inbox_outbox` を配送ジャーナルとして使っていないため、upload／ローカル確定の各境界の終了と再起動は実機で重点的に確認します。通常エラーの補償とS1台帳の取消は自動テストの対象です。
- 7日と対応後30日は、APIの掃除・R2設定・運営の手動削除に依存します。未対応通報の期限や自動削除ジョブはなく、Webhook失敗の自動再通知もありません。クラウド側バックアップの即時消去も保証しません。
- Report APIは認証と形式・サイズを確認しますが、送ったGiftと申告した送り手の真偽を自動検証しません。運営は証拠を確認してから対応します。
- 退会で自分の受信箱は消えますが、持ち主の台帳・通報・運営の拒否・相手の受信箱へ既に送った分は一括削除しません。運営の拒否に入った鍵は本人の退会APIも拒否されます。
- 鍵の紛失やパスフレーズ忘れを運営が復旧する仕組み、同じ鍵の2台同時利用、同期はありません。改造クライアントのローカル表示や、別のID／新しい鍵の作成も止められません。
- 深いリンクはメモリ上の待ちキュー（最大32件、1リンク2048文字まで）。アプリを終了したときのキューの永続化はしません。
- プライバシー文案は実装の説明であり、法的適合の確認・外部セキュリティ監査を代替しません。

## オーナーの作業・実機で確かめること

運用は [server-howto.md](server-howto.md)、日英文案は [privacy-policy-draft.md](privacy-policy-draft.md)、操作項目は [macos-checklist.md のS2](port-spec/macos-checklist.md) に記載しました。

1. 本番 `peta-reports-prod` を**非公開**で作成、GIFTSの7日削除ルールを確認、D1をexportして0002までmigration、prodへdeploy。運営専用 `REPORT_WEBHOOK` をsecretで設定。**この作業ではprodを照会も変更もしていません。**
2. 通報の担当・確認周期・対応日／削除予定日の管理を決め、対応後30日のR2・D1・取得コピーの削除、blocked_keysの登録／解除、通知失敗・退会／削除依頼の対応をdevで試す。
3. 責任主体・連絡先・Cloudflare委託と国外処理・保存期間と例外を専門家と確認し、公開条件を完了。本番URLと通常版serverの公開は別途決定（dev URLのまま有効にしない）。
4. 異なる鍵の2台でコード交換→申請→承認→双方向Gift v3→封筒→開封→サーバー削除と唯一の持ち主。not_allowed、Decline／Block／Remove、期限・上限、二重受取、失敗の補償。
5. 通常／Developerの .app のCFBundleURLTypesと分離、メッセージ・メモ・メールから起動前／後／最小化／別シート中のリンク。入力済みのシートまでで勝手に送信しないこと。
6. 鍵だけのexportとデータフォルダ全体の移行、誤パスフレーズ／破損の拒否、同じ友達・受信箱・持ち主の継続、旧Mac停止。
7. 起動・Gifts・フォーカス・Check now・15分・スリープ復帰、友達0人未登録と登録後の通信条件、バッジ、作者だけの引いた人表示、通報とLeave。
