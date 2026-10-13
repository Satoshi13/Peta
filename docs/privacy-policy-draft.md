# Peta プライバシーポリシー下書き / Privacy policy draft

2026-10-14、S1〜S3と公開前修正の現行実装に基づく公開前の文案。**法的な判断はオーナーと専門家が行います。この文書は正式なポリシーでも法的助言でもありません。** 責任主体・連絡先・適用地域・法的根拠・委託契約・保存期間と例外を決めてから公開してください。

**This is a pre-release draft based on the S1–S3 and release-hardening implementation, not a final policy or legal advice. The owner and qualified advisers must make the legal decisions before publication.** The operator, contact details, applicable regions, legal basis, processor arrangements and retention exceptions remain to be confirmed.

## 未記入・要決定項目 / Owner completion list

以下はすべて **【オーナーが記入】**。公開前に専門家と実際の契約・運用へ合わせて確定する。

| 項目 / Item | 値 / Value |
| --- | --- |
| 運営者 / Operator | 【オーナーが記入】 |
| 問い合わせ窓口 / Privacy contact | 【オーナーが記入】 |
| 施行日 / Effective date | 【オーナーが記入】 |
| 提供地域・法的根拠 / Applicable regions and legal basis | 【オーナーが記入】 |
| Cloudflareの契約・処理国・再委託先・保護措置 / Processor terms, countries, subprocessors and safeguards | 【オーナーが記入】 |
| IP情報等のCloudflare側の保持条件 / Cloudflare network-data retention | 【オーナーが記入】 |
| 開示・訂正・削除の本人確認と応答方法 / Verification and privacy-request procedure | 【オーナーが記入】 |
| 法的保存例外・変更の告知方法 / Required retention exceptions and policy-change notices | 【オーナーが記入】 |

## 日本語

### 運営・対象

運営者: **【オーナーが記入】**。問い合わせ・削除等の窓口: **【オーナーが記入】**。施行日: **【オーナーが記入】**。

この文案は、Petaの所有権確認、友達とGift受信箱、友達のMarket、通報、端末内の移行を扱います。通信なしの通常版にサーバー通信のコード・依存は含めません。Developerはdev、友達限定ベータは本番用の固定接続先を使います。本番はオーナー準備後に運用し、その準備が済むまで配布しません。現金決済とライブラリの同期は実装していません。

### 端末で扱うもの・サーバーへ送るもの

Collection、ステッカーの完成画像・元写真、配置、ローカルの友達の記録、秘密鍵、鍵バックアップのパスフレーズはMacで扱います。元写真・秘密鍵・パスフレーズはサーバーへ送りません。`.petakey` は鍵だけで、ステッカー帳や友達を含むデータフォルダのバックアップではありません。`.petamove` はDB・assets・鍵をまとめた暗号化移行ファイルで、作成・読み込みでサーバーに何も送りません。移行後は元のMacでPetaを使わないでください。

サーバーは、配達・認証・持ち主確認・不正利用防止のため、次の情報を受け取ります。

- 受信箱ID、署名／暗号の**公開鍵**、その結びつけの署名、登録時の表示名、登録時刻。表示名と公開鍵は平文の登録情報です。
- 許可／拒否する相手の鍵ハッシュ、申請・GiftのID、送り手の鍵ハッシュ、サイズ、送受信・期限の時刻、封をしたデータ。鍵ハッシュも人と結びつく識別子になり得ます。
- 所有権の台帳: ステッカー／パックID、完成画像のダイジェスト、作者名・公開鍵と証明、持ち主の公開鍵、移動と署名、使用済みの枠。台帳に画像そのものは保存しません。
- 認証の時刻・nonce、鍵ハッシュごとの回数制限・運営の拒否の記録。Cloudflareは接続元IP等のネットワーク情報を処理し得ます。Peta WorkerのコードはIP・鍵・本文をログへ出さず、永続Workers Logsを有効にしていません。Cloudflare側の処理まで「IPを扱わない」とは約束しません。

友達の申請本文とGiftは、送信前に受け取る人の暗号公開鍵にHPKEで封をします。通常の配達ではPeta運営とWorkerは本文・Giftの画像を復号できません。配達先・送り手・サイズ・時刻等のメタデータは暗号化によって隠れません。友達本人は受け取った内容を読めます。

パックの作者には、引かれた枠と、引いた人の鍵ハッシュを返します。他の人には枠番号だけです。アプリは承認済み友達のハッシュを端末内の名前に対応させ、知らない人は `Someone` と表示します。友達の一覧やこの名前の対応表を作者へ送る仕組みではありません。

友達の Market(S3)では、出品のカード(題名・説明・見本の絵など)とパックを、出品ごとの鍵で端末で暗号化してから送ります。その鍵は、承認済みの友達1人ずつの暗号公開鍵に封をして渡します。Peta 運営とWorkerは鍵を持たないので、出品の中身を復号できません。サーバーが受け取るのは、出品ID・パックID・値段・状態・暗号文の大きさとダイジェスト、封筒の宛先の鍵ハッシュ、売上の記録(買い手の鍵ハッシュ・売り手の公開鍵・枠・値段・取り分・時刻)です。Scraps の残高はMacにあり、サーバーへ送りません。

### 通報の例外

受け取ったGiftまたは閲覧した友達のMarketの出品をReport…で通報し、同意して送信すると、**復号済みの元のGiftファイル（完成画像・メモ等）、またはMarketの復号済みカードとパック、理由、送り手と通報者の鍵ハッシュ、時刻**を運営用の非公開R2に送ります。この場合は運営が内容を確認できます。元写真はGiftに含めません。通報は相手を自動でブロックせず、利用者が選べます。運営へのWebhookにはIDと保存中の件数だけを送り、内容・画像・鍵／鍵ハッシュは送りません。

### 保存期間

| 情報 | 現行の扱い |
| --- | --- |
| 未処理の申請・未受取Gift | 7日で期限切れ。通常は受取後・取消で早く削除。申請／索引は受信箱APIで掃除し、GiftのR2には7日の削除ルールを設定。削除処理は非同期で、厳密な時刻の物理削除を保証しません。 |
| 受信箱の登録、許可／拒否 | 本人の退会まで。 |
| 通報と索引 | 運営が対応時刻を記録し、日次Cronで対応済みから30日経った内容と索引を自動削除。未対応は保存。削除失敗は再試行し、厳密な時刻の消去を保証しません。 |
| 友達の Market の出品(暗号文・封筒) | 売り手が販売をやめるか退会すると、R2 の暗号文と封筒を削除。 |
| 友達の Market の売上の記録 | 台帳の一部として残します(持ち主確認と売り手の精算に必要)。現行実装に期限付き削除はありません。 |
| 所有権の台帳・運営の拒否 | 退会しても残します。持ち主確認と不正利用防止に必要なため、現行実装に期限付き削除はありません。 |
| nonce・回数カウンタ | 有効期間を過ぎた古い行をAPIの書き込み時に掃除。クラウド側バックアップは契約・設定に従い、即時消去を保証しません。 |
| 受取済みGift・Collection・友達・鍵 | Mac上に保持。アプリの操作またはデータフォルダの管理によります。 |

出品の配送証拠は、封筒の削除後にも通報できるよう出品ID・受取人と送り手の鍵ハッシュの組だけを残します。内容鍵・暗号化封筒は含めません。現行ではこの証拠の時限削除はありません。

### 委託先・海外での処理

Workers、D1、R2にCloudflareを使用します。日本国外での処理・保管があり得ます。具体的な国・再委託先・契約上の保護・Cloudflareが扱うIPの保存期間等は、公開前にオーナーが実際の契約と設定を確認し、必要な告知を完成させます。[Cloudflare Data Processing Addendum](https://www.cloudflare.com/cloudflare-customer-dpa/) とその再委託先一覧が確認資料です。この文案だけで海外移転に関する法的要件を満たしたとは判断しません。

### 退会・問い合わせ

SettingsのLeaveは、本人の受信箱・許可／拒否・そこに届いた申請と未受取Giftをサーバーから削除します。台帳、受取済みの端末データ、通報、運営の拒否は残ります。他の人の受信箱へ送った分は、その人の受取・期限切れまで残り得ます。サーバー参加の状態は端末でリセットしますが、既存のファイルGiftの相手の記録は残します。

運営に拒否された鍵は退会APIも利用できません。その場合を含め、削除・開示・訂正等の問い合わせ方法と確認手順は上記の窓口を正式化して案内します。秘密鍵やパスフレーズを問い合わせに送る必要はありません。同じ鍵を複数Macで同時に使うこと、ステッカー帳の同期は対応していません。

## English

### Operator and scope

Operator: **【オーナーが記入】**. Contact for privacy requests: **【オーナーが記入】**. Effective date: **【オーナーが記入】**.

This draft covers ownership checks, friends and the Gift inbox, the friends' Market, reports and local migration. The offline standard build does not include server networking code or dependencies. Developer builds use dev; the friends-only beta has a fixed production endpoint and must not be distributed until the owner has prepared production. Cash payments and library sync are not implemented.

### Local and server data

Your Collection, finished sticker images, source photos, placements, local friend records, private keys and key-backup passphrase are handled on your Mac. Source photos, private keys and passphrases are not sent to the server. A `.petakey` file contains keys only; it is not a backup of your Collection or friends. A `.petamove` is an encrypted migration file containing the database, assets and keys. Export and restore do not send data to the server. Stop using Peta on the old Mac after moving.

For delivery, authentication, ownership checks and abuse prevention, the server receives:

- Mailbox ID, signing and encryption **public keys**, their binding signature, the registered display name and registration time. The name and public keys are plaintext registration data.
- Allowed or blocked key hashes, request and Gift IDs, sender hashes, sizes, delivery and expiry times, and sealed data. Key hashes may be identifiers associated with people.
- The ownership ledger: sticker/pack IDs, finished-image digests, creator names and public keys, proofs, holder keys, transfers, signatures and drawn slots. The ledger does not store the images themselves.
- Authentication timestamps and nonces, key-hash-based rate counters and service blocks. Cloudflare may process source IP addresses and other network information. Peta's Worker code does not log IPs, keys or message contents, and persistent Workers Logs are not enabled. This does not mean Cloudflare never processes IP information.

Friend request contents and Gifts are sealed on the sender's Mac with HPKE to the recipient's encryption public key. In ordinary delivery the operator and Worker cannot decrypt the contents or Gift images. Recipient/sender information, size and time remain visible as metadata. The recipient can read the contents.

Only a pack's authenticated maker receives hashes identifying who drew its slots. Other callers receive slot numbers only. The app matches accepted friends to names locally and shows other people as `Someone`. It does not send your friend list or local name mapping to a pack maker.

In the friends' Market (S3), a listing's card (title, description, peek pictures and so on) and pack are encrypted on the Mac with a per-listing key before they are sent. That key is sealed to each approved friend's encryption public key. Peta's operator and Worker do not hold the key and cannot decrypt listings. The server receives the listing and pack IDs, price, state, the size and digest of the encrypted files, the key hashes of the friends who received the key, and sale records (buyer key hash, seller public key, slot, price, seller's share, time). Scraps balances stay on the Mac and are not sent.

### Reports are an exception

If you choose Report… and consent to send it, **the decrypted original Gift file (including the finished image and note), or decrypted Market card and pack, your reason, sender and reporter key hashes, and time** are sent to the operator's private R2 bucket. The operator can review these contents. The original source photo is not part of the Gift. Blocking the sender is optional. A notification webhook receives only the report ID and the number of stored reports, without contents, images, keys or key hashes.

### Retention

| Data | Current handling |
| --- | --- |
| Pending requests and unreceived Gifts | Expire after 7 days; normally deleted sooner upon receipt or cancellation. Inbox API calls sweep requests/indexes, and Gift R2 objects have a 7-day deletion rule. Deletion is asynchronous; exact-time physical deletion is not guaranteed. |
| Mailbox registration and allow/block lists | Until you leave. |
| Reports and their indexes | The operator records resolution time; a daily Cron automatically deletes contents and indexes at least 30 days after resolution. Unresolved reports remain. Failures are retried; exact-time deletion is not guaranteed. |
| Friends' Market listings (encrypted files and key envelopes) | Deleted from R2 when the seller stops selling or leaves. |
| Friends' Market sale records | Kept as part of the ledger (needed for ownership checks and the seller's share). The current implementation has no timed deletion. |
| Ownership ledger and service blocks | Retained after leaving for ownership checks and abuse prevention. The current implementation has no expiry-based deletion. |
| Nonces and rate counters | Older rows are swept on API writes after their validity window. Cloud-provider backups follow the actual contract and settings and are not guaranteed to disappear immediately. |
| Received Gifts, Collection, friend records and keys | Kept on the Mac, managed through app actions or the data folder. |

Listing-delivery proof retains only the listing ID, recipient key hash and sender key hash after an envelope is deleted, so a recipient can still report it. It contains no content key or encrypted envelope. There is currently no timed deletion rule for this proof.

### Cloudflare and international processing

Peta uses Cloudflare Workers, D1 and R2. Processing or storage may occur outside Japan. Before publication the owner must verify the actual contract, countries, subprocessors, protections and Cloudflare IP-retention arrangements and complete the necessary notice. The [Cloudflare Data Processing Addendum](https://www.cloudflare.com/cloudflare-customer-dpa/) and linked subprocessor list are reference material, not a determination that legal transfer requirements are met.

### Leaving and requests

Leave in Settings deletes your mailbox, its allow/block lists, and requests and unreceived Gifts addressed to it. The ownership ledger, locally received data, reports and service blocks remain. Gifts already sent to other mailboxes may remain until those recipients receive them or they expire. Server participation state is reset locally; existing file-Gift contact records remain.

A service-blocked key cannot use the Leave API. The operator must establish the contact and verification procedure above for deletion, access, correction and related requests, including that situation. Do not send private keys or passphrases with a request. Using the same key on two Macs at once and Collection sync are unsupported.

正式化した文書のURLだけをsrc-tauri/src/about.rsのSERVICE_LINKSへ設定する。未設定ではAboutのリンクを表示しない。条項の法的な最終判断はオーナーと専門家が行う。
