# Peta プライバシーポリシー下書き / Privacy policy draft

2026-10-13、S2の現行実装に基づく公開前の文案。**法的な判断はオーナーと専門家が行います。この文書は正式なポリシーでも法的助言でもありません。** 責任主体・連絡先・適用地域・法的根拠・委託契約・保存期間と例外を決めてから公開してください。

**This is a pre-release draft based on the S2 implementation, not a final policy or legal advice. The owner and qualified advisers must make the legal decisions before publication.** The operator, contact details, applicable regions, legal basis, processor arrangements and retention exceptions remain to be confirmed.

## 日本語

### 運営・対象

運営者: **［オーナーが記入］**。問い合わせ・削除等の窓口: **［オーナーが記入］**。施行日: **［公開前に決定］**。

この文案は、Petaの所有権確認、友達とGift受信箱、通報を扱います。現在サーバー機能は開発者版のdev環境限定です。通常版にサーバー通信のコード・依存は含めていません。将来のMarket・決済・同期等には、その実装時に文案を更新します。

### 端末で扱うもの・サーバーへ送るもの

Collection、ステッカーの完成画像・元写真、配置、ローカルの友達の記録、秘密鍵、鍵バックアップのパスフレーズはMacで扱います。元写真・秘密鍵・パスフレーズはサーバーへ送りません。`.petakey` は鍵だけで、ステッカー帳や友達を含むデータフォルダのバックアップではありません。

サーバーは、配達・認証・持ち主確認・不正利用防止のため、次の情報を受け取ります。

- 受信箱ID、署名／暗号の**公開鍵**、その結びつけの署名、登録時の表示名、登録時刻。表示名と公開鍵は平文の登録情報です。
- 許可／拒否する相手の鍵ハッシュ、申請・GiftのID、送り手の鍵ハッシュ、サイズ、送受信・期限の時刻、封をしたデータ。鍵ハッシュも人と結びつく識別子になり得ます。
- 所有権の台帳: ステッカー／パックID、完成画像のダイジェスト、作者名・公開鍵と証明、持ち主の公開鍵、移動と署名、使用済みの枠。台帳に画像そのものは保存しません。
- 認証の時刻・nonce、鍵ハッシュごとの回数制限・運営の拒否の記録。Cloudflareは接続元IP等のネットワーク情報を処理し得ます。Peta WorkerのコードはIP・鍵・本文をログへ出さず、永続Workers Logsを有効にしていません。Cloudflare側の処理まで「IPを扱わない」とは約束しません。

友達の申請本文とGiftは、送信前に受け取る人の暗号公開鍵にHPKEで封をします。通常の配達ではPeta運営とWorkerは本文・Giftの画像を復号できません。配達先・送り手・サイズ・時刻等のメタデータは暗号化によって隠れません。友達本人は受け取った内容を読めます。

パックの作者には、引かれた枠と、引いた人の鍵ハッシュを返します。他の人には枠番号だけです。アプリは承認済み友達のハッシュを端末内の名前に対応させ、知らない人は `Someone` と表示します。友達の一覧やこの名前の対応表を作者へ送る仕組みではありません。

### 通報の例外

受け取ったGiftをReport…で通報し、同意して送信すると、**復号済みの元のGiftファイル（完成画像・メモ等）、理由、送り手と通報者の鍵ハッシュ、時刻**を運営用の非公開R2に送ります。この場合は運営が内容を確認できます。元写真はGiftに含めません。通報は相手を自動でブロックせず、利用者が選べます。運営へのWebhookにはIDと保存中の件数だけを送り、内容・画像・鍵／鍵ハッシュは送りません。

### 保存期間

| 情報 | 現行の扱い |
| --- | --- |
| 未処理の申請・未受取Gift | 7日で期限切れ。通常は受取後・取消で早く削除。申請／索引は受信箱APIで掃除し、GiftのR2には7日の削除ルールを設定。削除処理は非同期で、厳密な時刻の物理削除を保証しません。 |
| 受信箱の登録、許可／拒否 | 本人の退会まで。 |
| 通報と索引 | 対応完了後30日で運営が削除。対応中は保管。対応日と削除予定日の管理は手動で、自動ジョブはありません。 |
| 所有権の台帳・運営の拒否 | 退会しても残します。持ち主確認と不正利用防止に必要なため、現行実装に期限付き削除はありません。 |
| nonce・回数カウンタ | 有効期間を過ぎた古い行をAPIの書き込み時に掃除。クラウド側バックアップは契約・設定に従い、即時消去を保証しません。 |
| 受取済みGift・Collection・友達・鍵 | Mac上に保持。アプリの操作またはデータフォルダの管理によります。 |

### 委託先・海外での処理

Workers、D1、R2にCloudflareを使用します。日本国外での処理・保管があり得ます。具体的な国・再委託先・契約上の保護・Cloudflareが扱うIPの保存期間等は、公開前にオーナーが実際の契約と設定を確認し、必要な告知を完成させます。[Cloudflare Data Processing Addendum](https://www.cloudflare.com/cloudflare-customer-dpa/) とその再委託先一覧が確認資料です。この文案だけで海外移転に関する法的要件を満たしたとは判断しません。

### 退会・問い合わせ

SettingsのLeaveは、本人の受信箱・許可／拒否・そこに届いた申請と未受取Giftをサーバーから削除します。台帳、受取済みの端末データ、通報、運営の拒否は残ります。他の人の受信箱へ送った分は、その人の受取・期限切れまで残り得ます。サーバー参加の状態は端末でリセットしますが、既存のファイルGiftの相手の記録は残します。

運営に拒否された鍵は退会APIも利用できません。その場合を含め、削除・開示・訂正等の問い合わせ方法と確認手順は上記の窓口を正式化して案内します。秘密鍵やパスフレーズを問い合わせに送る必要はありません。同じ鍵を複数Macで同時に使うこと、ステッカー帳の同期は対応していません。

## English

### Operator and scope

Operator: **[owner to complete]**. Contact for privacy requests: **[owner to complete]**. Effective date: **[to be decided before publication]**.

This draft covers ownership checks, friends and the Gift inbox, and reports. Server features currently operate only in the Developer build against dev. The standard build does not include the server networking code or dependencies. Future Market, payments or sync features require an updated policy.

### Local and server data

Your Collection, finished sticker images, source photos, placements, local friend records, private keys and key-backup passphrase are handled on your Mac. Source photos, private keys and passphrases are not sent to the server. A `.petakey` file contains keys only; it is not a backup of your Collection or friends.

For delivery, authentication, ownership checks and abuse prevention, the server receives:

- Mailbox ID, signing and encryption **public keys**, their binding signature, the registered display name and registration time. The name and public keys are plaintext registration data.
- Allowed or blocked key hashes, request and Gift IDs, sender hashes, sizes, delivery and expiry times, and sealed data. Key hashes may be identifiers associated with people.
- The ownership ledger: sticker/pack IDs, finished-image digests, creator names and public keys, proofs, holder keys, transfers, signatures and drawn slots. The ledger does not store the images themselves.
- Authentication timestamps and nonces, key-hash-based rate counters and service blocks. Cloudflare may process source IP addresses and other network information. Peta's Worker code does not log IPs, keys or message contents, and persistent Workers Logs are not enabled. This does not mean Cloudflare never processes IP information.

Friend request contents and Gifts are sealed on the sender's Mac with HPKE to the recipient's encryption public key. In ordinary delivery the operator and Worker cannot decrypt the contents or Gift images. Recipient/sender information, size and time remain visible as metadata. The recipient can read the contents.

Only a pack's authenticated maker receives hashes identifying who drew its slots. Other callers receive slot numbers only. The app matches accepted friends to names locally and shows other people as `Someone`. It does not send your friend list or local name mapping to a pack maker.

### Reports are an exception

If you choose Report… and consent to send it, **the decrypted original Gift file (including the finished image and note), your reason, sender and reporter key hashes, and time** are sent to the operator's private R2 bucket. The operator can review these contents. The original source photo is not part of the Gift. Blocking the sender is optional. A notification webhook receives only the report ID and the number of stored reports, without contents, images, keys or key hashes.

### Retention

| Data | Current handling |
| --- | --- |
| Pending requests and unreceived Gifts | Expire after 7 days; normally deleted sooner upon receipt or cancellation. Inbox API calls sweep requests/indexes, and Gift R2 objects have a 7-day deletion rule. Deletion is asynchronous; exact-time physical deletion is not guaranteed. |
| Mailbox registration and allow/block lists | Until you leave. |
| Reports and their indexes | Manually deleted by the operator 30 days after resolution; kept while unresolved. Resolution and deletion dates require manual tracking; there is no automated job. |
| Ownership ledger and service blocks | Retained after leaving for ownership checks and abuse prevention. The current implementation has no expiry-based deletion. |
| Nonces and rate counters | Older rows are swept on API writes after their validity window. Cloud-provider backups follow the actual contract and settings and are not guaranteed to disappear immediately. |
| Received Gifts, Collection, friend records and keys | Kept on the Mac, managed through app actions or the data folder. |

### Cloudflare and international processing

Peta uses Cloudflare Workers, D1 and R2. Processing or storage may occur outside Japan. Before publication the owner must verify the actual contract, countries, subprocessors, protections and Cloudflare IP-retention arrangements and complete the necessary notice. The [Cloudflare Data Processing Addendum](https://www.cloudflare.com/cloudflare-customer-dpa/) and linked subprocessor list are reference material, not a determination that legal transfer requirements are met.

### Leaving and requests

Leave in Settings deletes your mailbox, its allow/block lists, and requests and unreceived Gifts addressed to it. The ownership ledger, locally received data, reports and service blocks remain. Gifts already sent to other mailboxes may remain until those recipients receive them or they expire. Server participation state is reset locally; existing file-Gift contact records remain.

A service-blocked key cannot use the Leave API. The operator must establish the contact and verification procedure above for deletion, access, correction and related requests, including that situation. Do not send private keys or passphrases with a request. Using the same key on two Macs at once and Collection sync are unsupported.
