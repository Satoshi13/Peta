# Peta プライバシーポリシー

施行日: {{EFFECTIVE_DATE}}

Peta 運営(以下「運営」)は、Mac 用アプリ「Peta」と関連サービス(以下「Peta」)で扱う情報について、次のとおり定めます。Peta は、運営が招待した人だけに日本で提供しており、日本の個人情報保護法に従います。

## 1. 運営者と窓口

**運営者**: Peta 運営(個人)。氏名・住所は、ご請求があれば遅滞なくお知らせします。
**窓口**: Peta の Discord の #ヘルプ、または運営への DM。Discord を使っていない方は satoshi_t1213@icloud.com。

## 2. Mac の中だけで扱うもの

Collection(ステッカー帳)、ステッカーの完成画像と元の写真、デスクトップの配置、友達の記録、秘密鍵、鍵のバックアップのパスフレーズは、Mac の中で扱います。**元の写真・秘密鍵・パスフレーズは、サーバーに送りません。**

`.petakey` は鍵だけのバックアップで、`.petamove` はライブラリを移すための暗号化されたファイルです。どちらも作るときや読み込むときに、サーバーには何も送りません。ステッカーの「Share」で作る共有用の画像も、Mac の中で描いて、クリップボードかご自身が選んだ場所に置くだけです(Discord などに貼った後は、そのサービスの扱いになります)。

## 3. ダウンロードページ・招待コード・クーポン

- **ログイン**: 運営は、招待した人のメールアドレスを、ダウンロードページのログインの許可リスト(Cloudflare Access)に登録します。ログインのとき、Cloudflare がそのメールアドレスへ6桁のコードを送り、ログインの記録(メールアドレス・日時・接続元の IP アドレスなど)を残します。この記録は Cloudflare が24時間保存します。
- **Peta のサーバーに保存するもの**: メールアドレスそのものではなく、その**ハッシュ値**(元に戻せない形に変換した値)。招待コード、そのコードを使った Mac の鍵のハッシュ値、使い始めた日時と止めた日時。アプリをダウンロード・更新した記録(ハッシュ値・版・日時)。
- **クーポン**: 受け取った Mac の鍵のハッシュ値、クーポンの名前、日時。
- **運営の管理画面**: 運営の操作の記録(操作の種類、日時、対象のメールアドレスのハッシュ値)。
- **利用目的**: 招待した人だけに配ること、1つのコードを1台に限ること、クーポンを1台1回にすること、配布と不正の状況を確かめること。広告や第三者への提供には使いません。

## 4. 友達・Gift・Market でサーバーに送るもの

配達・認証・持ち主の確認・不正の防止のため、サーバーは次の情報を受け取ります。

- 受信箱の ID、署名と暗号化の**公開鍵**とその結びつけの署名、登録したときの表示名、登録日時。
- 許可・拒否している相手の鍵のハッシュ値、申請や Gift の ID、送り手の鍵のハッシュ値、大きさ、送った日時・期限、封をしたデータ。鍵のハッシュ値も、人と結びつく情報になりうるものとして扱います。
- 持ち主の記録: ステッカーやパックの ID、完成画像の要約値(ダイジェスト)、作者名と公開鍵、持ち主の公開鍵、移動と署名、引かれた枠。画像そのものは記録に保存しません。
- 認証の時刻や使い捨ての値、鍵ごとの回数の制限、運営による利用のお断りの記録。

**友達への申請の本文と Gift は、送る前に、受け取る人の鍵で暗号化します。** 通常の配達では、運営もサーバーも中身や Gift の画像を読めません。ただし、宛先・送り手・大きさ・日時などは、暗号化しても隠れません。

**友達の Market** では、出品のカード(題名・説明・見本の絵など)とパックを、出品ごとの鍵で Mac の中で暗号化してから送ります。その鍵は、承認済みの友達一人ひとりの鍵で封をして渡すので、運営は出品の中身を読めません。サーバーが受け取るのは、出品やパックの ID、値段、状態、暗号化したファイルの大きさと要約値、鍵を受け取った友達の鍵のハッシュ値、売り上げの記録(買った人の鍵のハッシュ値・売り手の公開鍵・枠・値段・取り分・日時)です。Scraps の残高は Mac の中にあり、送りません。パックの作者には、引かれた枠と、引いた人の鍵のハッシュ値を返します。アプリはそれを、Mac の中で友達の名前に対応させます。

## 5. 通報したとき

受け取った Gift や、見た Market の出品を通報し、送付に同意した場合は、**復号した Gift(完成画像・メモなど)または Market のカードとパック、理由、送り手と通報者の鍵のハッシュ値、日時**を、運営だけが見られる保管場所に送ります。この場合、運営は内容を確認できます。元の写真は Gift に含まれません。運営への通知(Discord)には、通報の ID と件数だけを送り、内容・画像・鍵は送りません。

## 6. 保存期間

| 情報 | 扱い |
| --- | --- |
| 受け取られていない申請・Gift | 7日で期限切れ。通常は受け取りや取り消しの時点で早めに削除します。 |
| 受信箱の登録、許可・拒否 | 退会されるまで。 |
| 通報とその記録 | 運営が対応した日から30日で自動削除。対応前のものは保存します。 |
| Market の出品(暗号化したファイルと鍵の封筒) | 出品をやめるか退会すると削除します。 |
| Market の売り上げの記録、持ち主の記録、利用のお断りの記録 | 持ち主の確認と不正の防止に必要なため、退会後も残します。 |
| ログインの許可リスト(メールアドレス) | 運営が登録を外すまで。外すと次のログインからは入れません(ログイン中の方は、期限まで残ることがあります)。 |
| ログインの記録(Cloudflare) | 24時間。 |
| 招待コード・ダウンロードと更新の記録・クーポンの受け取り記録・運営の操作の記録 | 1年で自動削除します(記録から1年、クーポンは終了から1年、招待コードは停止から1年)。使用中の招待コードは、登録を外すまで残します。 |
| 認証の使い捨ての値・回数の記録 | 有効な期間を過ぎたものから順に削除します。 |
| 受け取った Gift、Collection、友達の記録、鍵 | Mac の中に保存します。アプリの操作やデータフォルダで管理してください。 |

削除は定期的な処理で行うため、正確な時刻に消えることまでは保証しません。

## 7. 委託先・外国での取り扱い

Peta は、ログイン(Cloudflare Access)、サーバーの処理(Workers)、データベース(D1)、ファイルの保管(R2)を、**Cloudflare, Inc.(米国)** に委託しています。情報は日本の外で処理・保管されることがあります。個人情報保護法の外国にある第三者への提供(委託)として、移転先の国(米国)、その国の個人情報保護の制度、Cloudflare が講じている措置(データ処理補遺など)についての情報は、ご請求があればお知らせします。Peta の Discord サーバーは Discord Inc. のサービスで、そこでのやりとりは Discord の規約とプライバシーポリシーに従います。

## 8. 退会・開示・訂正・削除のご請求

Settings の Leave で、ご自身の受信箱、許可・拒否のリスト、そこに届いた申請と受け取られていない Gift をサーバーから削除できます。持ち主の記録、受け取り済みの Mac のデータ、通報、利用のお断りの記録は残ります。

開示・訂正・削除・利用停止などのご請求は、上の窓口で受け付けます。登録済みのメールアドレスでのログイン、または登録済みの Discord のアカウントからのご連絡で、ご本人であることを確かめ、原則として14日以内に無料でお答えします。秘密鍵やパスフレーズを送る必要はありません。

## 9. 変更

このポリシーを変更するときは、Discord の #お知らせ とダウンロードページで告知し、重要な変更は原則として14日前までにお知らせします。

---

# Peta Privacy Policy

Effective date: {{EFFECTIVE_DATE_EN}}

This policy explains how the Peta operator ("the operator") handles information in Peta, a Mac app and related services. Peta is offered in Japan only to people the operator has invited and follows Japan's Act on the Protection of Personal Information. If the Japanese and English versions differ, the Japanese version prevails.

## 1. Operator and contact

**Operator**: Peta (run by an individual). The operator's name and address are provided without delay on request.
**Contact**: #ヘルプ (help) in the Peta Discord or a direct message to the operator; if you don't use Discord, satoshi_t1213@icloud.com.

## 2. What stays on your Mac

Your Collection, finished stickers and original photos, desktop placements, friend records, private keys and key-backup passphrase are handled on your Mac. **Original photos, private keys and passphrases are never sent to the server.** `.petakey` and `.petamove` files are made and read without sending anything. Share pictures are drawn on the Mac and only placed on the clipboard or where you save them (once posted to Discord or elsewhere, that service's terms apply).

## 3. Download page, invite codes and coupons

- **Sign-in**: The operator adds invited people's email addresses to the download page's sign-in allow list (Cloudflare Access). When you sign in, Cloudflare sends a 6-digit code to that address and keeps a sign-in record (email, time, source IP address and similar) for 24 hours.
- **Stored on Peta's server**: not your email address but a **hash** of it (a one-way value); your invite code; a hash of the key of the Mac that used it, and when it started and was paused; records of downloads and updates (hash, version, time).
- **Coupons**: a hash of the receiving Mac's key, the coupon name and the time.
- **Operator's admin page**: records of operator actions (action, time, hash of the affected email).
- **Purposes**: giving Peta only to invited people, limiting each code to one Mac and each coupon to once per Mac, and checking distribution and misuse. Never used for advertising or provided to third parties.

## 4. What friends, Gifts and the Market send

For delivery, authentication, ownership checks and abuse prevention, the server receives: mailbox IDs, signing and encryption **public keys** and their binding signature, the display name and time of registration; allowed and blocked key hashes, request and Gift IDs, sender key hashes, sizes, delivery and expiry times and sealed data (key hashes are treated as information that can relate to a person); ownership records (sticker and pack IDs, finished-image digests, creator names and public keys, holders' public keys, transfers and signatures, drawn slots — not the images themselves); authentication times and one-time values, per-key rate counters and service-refusal records.

**Friend requests and Gifts are encrypted to the recipient's key before they are sent.** In ordinary delivery neither the operator nor the server can read them or see Gift images; recipients, senders, sizes and times remain visible.

**In the friends' Market**, a listing's card and pack are encrypted on the Mac with a per-listing key, which is sealed to each approved friend, so the operator cannot read listings. The server receives listing and pack IDs, prices, states, encrypted file sizes and digests, the key hashes of friends who received the key, and sale records (buyer key hash, seller public key, slot, price, share, time). Scraps balances stay on the Mac. A pack's maker receives the drawn slots and the drawers' key hashes, which the app matches to friends' names on the Mac.

## 5. Reports

If you report a Gift or a Market listing and consent to sending it, **the decrypted Gift (finished image, note) or the listing's card and pack, your reason, the sender's and your key hashes and the time** go to storage only the operator can access, and the operator can review them. Original photos are not part of Gifts. The operator's notification (Discord) carries only the report ID and count.

## 6. Retention

| Information | Handling |
| --- | --- |
| Requests and Gifts not yet received | Expire after 7 days; normally deleted sooner on receipt or cancellation. |
| Mailbox registration, allow and block lists | Until you leave. |
| Reports and their records | Deleted automatically 30 days after the operator resolves them; unresolved reports are kept. |
| Market listings (encrypted files and key envelopes) | Deleted when the seller stops selling or leaves. |
| Market sale records, ownership records, service-refusal records | Kept after leaving, for ownership checks and abuse prevention. |
| Sign-in allow list (email addresses) | Until the operator removes the registration; an existing session may last until it expires. |
| Sign-in records (Cloudflare) | 24 hours. |
| Invite codes, download and update records, coupon receipts, operator action records | Deleted automatically after one year (one year after recording, after a coupon ends, or after an invite is paused). An invite code in use stays until the registration is removed. |
| Authentication one-time values and rate counters | Removed after their validity window. |
| Received Gifts, Collection, friend records, keys | Kept on your Mac; manage them in the app or the data folder. |

Deletion runs as a periodic job, so exact-time deletion is not guaranteed.

## 7. Processors and international handling

Peta entrusts sign-in (Cloudflare Access), server processing (Workers), its database (D1) and file storage (R2) to **Cloudflare, Inc. (United States)**; information may be processed or stored outside Japan. Information about the destination country, its privacy regime and Cloudflare's safeguards (such as its data processing addendum) is available on request. The Peta Discord server is a Discord Inc. service governed by Discord's terms and privacy policy.

## 8. Leaving and your requests

Leave in Settings deletes your mailbox, its allow and block lists, and requests and unreceived Gifts addressed to it from the server. Ownership records, data already on Macs, reports and service-refusal records remain.

Send requests for disclosure, correction, deletion or suspension of use to the contact above. The operator verifies you by sign-in with your registered email or a message from your registered Discord account, and normally answers free of charge within 14 days. Never send private keys or passphrases.

## 9. Changes

Changes are announced in the Discord #お知らせ channel and on the download page; material changes are normally announced at least 14 days in advance.
