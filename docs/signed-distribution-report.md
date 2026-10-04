# 署名付き配布の実装報告

対象: `claude/relaxed-dijkstra-ocnjzu`。指示書 `docs/codex-signed-distribution-prompt.md` のStep順に実装する。画像・アート・CSS・決定表は変更しない。本物の公式秘密鍵は生成しない。

## Step 1 — 署名の土台

Ed25519-dalek v2、SHA-256、OS乱数、Base64公開鍵、鍵ID、8桁の指紋を追加した。共通フレームは最大24MB／ヘッダー64KBで、ヘッダーを上限付きで読み、MAGICから添付末尾までの署名を検証してから添付を呼出元へ渡す。`verify_strict`を使う。

端末鍵のI/Oは`device_key.rs`に閉じ、ライブラリフォルダの`device.key`を新規作成0600で保存する。既存鍵を上書きせず、不正長・シンボリックリンク・Unixでの公開権限を拒否する。秘密鍵の内容はエラー／ログへ出さない。`.key`／`.pem`／`.secret`をgitignoreへ追加した。

公式公開鍵の`k1`は開発用の仮キーで、本番配布の信頼根には使わない。`official_keys.rs`の`TODO(owner): replace with the real official public key`をオーナーが差し替える。公式の秘密鍵は生成・保存していない。自動テスト用鍵は毎回OS乱数で生成する。

署名の限界（実世界の本人確認、配布済み取消、配布人数、別端末での再利用を防げない）は`sign.rs`のモジュールコメントに記載した。端末鍵のバックアップ／Keychain移行は今後の運用判断。

検証: 共通フレーム・署名の正常系、1バイト改ざん、異なる鍵、未知の公式鍵ID、端末鍵の再読込・権限・上書き拒否を自動確認。全workspaceの`cargo test`と`npm test`をStepごとに実行する。初回は既存の生成物でディスクが満杯になったため、targetの増分／examplesだけを削除して再実行した。

Step 1結果: cargo test --workspace 全て成功（core 96件、統合5件、Tauri側テスト対象のビルド成功（登録テスト0件））、npm test 31件成功。

## Step 2 — 公式イベント／コード／DB V8／追加封筒

公式イベントは全体署名→種類／期間／素材／数量／画像検証→DBのImmediateトランザクションで適用する。イベントIDはコードとファイルで共通で、既受領／無効化済みを拒否する。未知の種類は更新案内。PNGはバイト上限に加え4096px／64MBのデコード上限を設けた。画像は署名後に、検証済みファイルのSHA-256から生成した内部パスへ保存する。DBが失敗しても効果／受領記録は巻き戻る（未参照の検証済みファイルが残る場合がある）。

V8はv1〜v7のSQLを変更せず、applied_events／revoked_events／friends、追加封筒meta、Gift署名情報、配布Pack／項目情報、packs_madeを追加する。Step 5／6に必要な表も今回のV8へ含めた。後から既存V8を書き換えたり追加マイグレーションを要求したりしないためで、まだ友達登録／作者パックの操作は追加していない。Scrapsテストの最新schema確認だけを8へ追従させた。

追加封筒は通常の封筒を開けた後だけ消費し、既存と同じ抽選をする。初回通常封筒のHolographicは維持。通常封筒とボーナスの開封・素材在庫・発見を一取引にし、残数は日をまたいで残る。受領期限はイベントを適用する期限で、受領済みの封筒を失効させない。Today／トレイ／既存デスクトップ封筒で`An extra envelope from Peta.`を表示する。作成数・Welcome・FIFO・Scrapsの仕様は変更しない。

コード形式の判断: `PETA1-`＋Crockford Base32、version／kind／公式キーの追記専用スロット／短いイベントID／固定payload／期限を署名する。notAfterは指定のUTC日u16（2020基準）に日内秒を加え、notBeforeも同様に入れる。時差付きの期限を切り捨てたり延長したりしないため。空白・ハイフン・大小・O/0・I/L/1を正規化する。114バイト→183 Base32文字＋区切り＝234文字で、130文字目標には収まらない。Ed25519の64バイトだけで103文字（区切り込み128）必要なので、目標を優先して署名・期限・IDを削ることはしない。短いIDは16バイト以下、添付付きのイベントはファイル限定。コードでは任意のタイトル／メッセージは持たず、効果から結果文を作る。

署名の限界とrevokeの範囲はevents.rsのモジュールコメントとコード形式コメントにも記載した。配布後に元に戻す処理・通信・時刻改ざん対策は入れていない。

Step 2結果: cargo test --workspace成功（core 102件＋統合5件、Tauriの全テスト対象ビルド）、npm test 31件成功。V7→V8のデータ保持、適用中断の巻戻し、二重受領／revoke、期限、数量／素材上限、コード正規化、署名を画像より先に検証する経路を確認した。

## Step 3 — ファイル取り込み／コード入力／関連付け

Open Peta file…をトレイとGiftsへ追加し、MAGICでGiftと公式イベントを分岐する。読込は24MB＋1の時点で止め、巨大ファイルを先に拒否する。公式イベントは検証→適用→announce。結果をInboxのFrom Peta ✓に保存し、ステッカー配布は封をしたGiftとして表示する。Gift v1にはUnsignedを付ける。友達のNew friend／確認済み／同名別鍵の表示枠も用意し、Step 5で実データを接続する。

Redeem Code…はToday／Gifts／トレイから開く、小さいネイティブHTML dialog。フォーカストラップ、取消／Escape、送信中の二重操作防止、読みやすい結果／エラーを付けた。受領済み記録はイベント適用と同じ取引で保存。CSS・画像は変更していない。

bundle.fileAssociationsへ.petaを追加した。macOSのRunEvent::Openedは起動後のStoreで受け取るので、実行中とダブルクリック起動の両経路を処理する。Linuxでは起動引数を処理する。macOSの実際の関連付け／未起動・起動中／Finder／トレイは実機で要確認。

Step 3結果: cargo test --workspace成功（Tauriのファイル読込上限1件、core 102件＋統合5件）、npm test 31件成功。関連付けは設定／イベントハンドラー実装までで、Finderからの実起動はmacOS環境がないため未確認。全Step後に実Tauriの取り込みUIを検証する。

## Step 4 — peta-pass

coreと同じフレーム／署名／コードを使うCLIをworkspaceに追加した。keygen／pubkey／event／grant-pack／verify、--keyまたはPETA_SIGNING_KEY（パス）、コード出力、画像付きステッカー配布を提供する。CLIは鍵ファイルの内容を出力しない。verifyは受領／DB更新をしない。未同梱の公開鍵を明示する検証オプションは「同梱の公式信頼ではない」と出力で区別する。

`docs/distribution-howto.md`に、オーナーが自分で実行するkeygen、公開鍵差し替え、鍵の保護、ファイル／コード配布、範囲／限界を記載した。本物の公式秘密鍵は作っていない。CLI自動テストは毎回test-only.keyを/tmpへ生成し、検証後に削除する。

Step 4結果: cargo test --workspace成功（CLI roundtrip 1件、Tauri 1件、core 102件＋統合5件）、npm test 31件成功。CLIの新規鍵／再生成拒否／公開鍵／ファイル＋コード／明示公開鍵verify／改ざん拒否／秘密鍵を出力しないことを一時テスト鍵で確認した。

## Step 5 — Gift v2／TOFU

新規Giftは端末鍵のv2署名付きで、MAGIC・from・edition・来歴・完成PNG・maskの全体を署名する。v1は署名を自称しないものだけUnsignedとして読める。元画像を送らず、コピー／Edition／8MB／一度だけの受領を維持。署名後のPNG／maskを検証し、受領と友達登録を同じ取引で行う。

TOFUはfriends.rsにまとめた。初回は指紋＋New friend、既知の鍵は登録済みの名前＋✓、同名別鍵は警告して受領する。プレビューは友達を登録せず、受領で初めて登録する。名前だけでは本人と判断しない。受領パッケージは内容ハッシュの内部パスに保存し、別内容で同じGift IDのファイルが元の包みを上書きしない。開封済みGiftは新しいステッカーを作る前に拒否する。

Step 5結果: cargo test --workspace成功（core 104件＋統合5件、Tauri 1件、CLI 1件）、npm test 31件成功。別ライブラリでNew friend→同じ端末鍵の2通目で✓→別端末の同名鍵で警告、v1のUnsigned、from／edition／PNG改ざんの拒否、秘密鍵再読込を確認した。指紋と警告は封筒の名前欄へ詰め込まず下に表示する。

## Step 6 — 作者パック

PETAPACK v1は端末署名・完成PNG＋maskだけを持つ。各項目にPNG／maskの長さを追加し、順番・境界を署名対象で固定した。3〜24枚、PNG／mask各2MB、全体24MB、名前／タイトル40文字、catalog素材ID、Common／Uncommon／Rareを検証する。署名済みの検証結果は読み取り専用の型とし、外からヘッダーだけ差し替えて適用できないようにした。

BookのMake a Pack…は①3〜24枚選択（キャッシュ＋表示域に入ったサムネイルだけ生成）②名前・外装・各名前／レア度＋一括設定③Seal & Save…の順。保存先を取消したら鍵／版の記録も作らない。保存は完成した一時ファイルを置換してからpacks_madeへ記録する。自分の棚へ自動追加しない。Pack内の名前は元のステッカーの命名／編集とは別で、開封時とBookに引き継ぐ。

公開packIdは端末指紋＋題名の短いslug＋題名SHA-256の先頭16桁。題名が同じなら版を上げる。受け取り側の内部IDは公開鍵全体のSHA-256＋packIdを使い、別鍵の作者が同じpackIdを名乗っても既存Packを上書きできない。

受け取りは署名検証後のプレビューだけでは友達・棚・在庫を変更しない。確認ダイアログに題名／TOFU名＋指紋／枚数／1枚ずつランダムを表示する。Add to my shelfだけで取引し、同意したファイルのトークンと照合して再検証する。初版は棚へ、同版以下は拒否、上位版は未登録keyのみ追加し、開封履歴を残す。端末をまたぐ同意なしの自動取り込みはない。起動時のopen-fileイベントがUIの準備前に来ても、確認待ちをUIが取得する。確認待ちはメモリだけで、終了時は未取り込みのまま（再度ファイルを開ける）。

開封はSourceType::Pack、ORIGINAL／Editionなし、Received fromはPack名、authorはTOFUの保存名、素材は裏面の情報だけ。完成PNGを再レンダリングせず、そのままコピーする。RARITY_WEIGHTSを1箇所に置きCommon 60／Uncommon 30／Rare 10で等級→残る項目を抽選する。枯れた等級を除き残る重みへ配分する。既存の公式Welcome／Market／素材抽選は変えず、作者のwelcomeというIDも日次制限に入らない。素材・封筒・Scraps・価格・決済を付与／消費する経路は持たない。

新しいダイアログは既存の紙色・影・ボタンのトークンだけを使い、CSSファイルや既存画面の装飾は変更しない。レア度は既存の開封演出へ渡し、Reduce motionの既存処理を使う。署名の限界はcreator_pack.rs／friends.rsにも明記した。

Step 6結果: `cargo test --manifest-path src-tauri/Cargo.toml --workspace`成功（core 108件、既存描画統合5件、Tauri 1件、CLI 1件）、`npm test`31件成功。署名改ざん、Peta名、枚数／画像サイズ／名前／不正rarity、重複key、同意なし、版更新、取引中断、重み／枯れた等級、別ライブラリへの完成コピーと来歴を確認した。全6 Stepの末尾でcargo／npmの両テストを実施した。

## 実Tauriでの手動確認

Linuxの実Tauri＋WebKitGTK、Xvfb上で行った。プロトタイプやmock backendではない。全データ／配布／画面キャプチャは`/tmp`の使い捨てフォルダで、実ユーザーのライブラリは使用していない。既存のサンプル画像は読むだけで、リポジトリの画像は変更していない。

1. **テスト専用**の使い捨て鍵を`peta-pass keygen`で作り、公開鍵の1行目だけを一時的にk1へ入れた検証ビルドを作成。検証直後にソースを元の仮公開鍵へ戻した。本物の公式秘密鍵は作っていない。最終のcargo／npm／mac型検査は元の仮公開鍵のソースで実施。
2. `extra_envelope`（2通）のファイルをネイティブOpen Fileで受領。通常の封筒を開け済みでもTodayの文言と残数が増えた。実Tauriの`daily_open_material`を2回呼んで残数0、3回目で在庫が増えないことを確認。封筒を手でドラッグする全演出の再確認は行っていない。
3. 同じ封筒ファイルを再受領して`This event was already received.`。素材配布をコードで受領した後、そのファイルでも同じエラーとなり、ファイル／コードの二重付与がない。
4. Redeem Codeの実HTML dialogへ、大小文字・空白・O/0・I/1を変えたコードを貼って送信。Kraft ×2、InboxのFrom Peta ✓、ダイアログ終了を確認。
5. `grant_pack`のファイルをネイティブOpen Fileで受領し、Native Test Pack／Peta ✓／3枚が棚へ追加。`grant_sticker`も封をしたPetaのGiftとして届く。
6. 実Gift保存ダイアログでv2を2通保存し、別のデータフォルダへ受領。1通目New friend、2通目同じ指紋＋✓、旧v1はUnsigned。Gift／Packの添付1バイトを変えたファイルは`invalid_signature`で拒否。同名別鍵の警告はcoreテストで確認。
7. BookのMake a Pack…で4枚選び、Set all: Rare、題名Native Desk、Seal & Save…で初版を保存。自分の棚は増えない。別フォルダで確認ダイアログの題名／登録済み友達＋指紋／4枚／ランダム案内を確認。Cancelで棚が増えず確認待ちも消える。再度開きAdd to my shelfで追加。実開封のtear／pullを既存のEnter操作で進め、Holographic · rare、項目名、Rareの演出を確認。Laterで既存の印刷待ちへ進む。
8. 同じ題名で5枚選び更新版を保存。初版の再取り込みは`This version is already on your shelf.`、更新版は総数5／残数4で開封済み1枚を維持。Bookの裏面はReceived／Received from: Native Desk／作者名、ORIGINAL／Editionなし。Holographic在庫0／Kraft在庫1のままで、素材在庫に変化なし。正しく端末署名したauthor=`  pEtA `のファイルも拒否。
9. Studio／Deskの最小720×520でMake a Packの選択ダイアログ（640×416、内部スクロール）とRedeem Code（約447×218）を確認。外へはみ出さず、選択一覧を下へスクロールしてCancel／Nextへ到達できる。新しいダイアログの既定の黒枠は使わない。Reduce motionの保存／確認操作も可能。

LinuxのGTK保存ダイアログでは、テスト自動操作でCtrl+Lに拡張子付きのフルパスを入れると`.peta`が重ねて付いた。ファイルは有効で受領可能。通常の名前入力欄の操作／macOSの保存ダイアログは実機チェックに含める。

## 最終検証・残した事項

- `cargo test --manifest-path src-tauri/Cargo.toml --workspace`: 全成功（計115件）。`npm test`: 31件成功。Linuxの実Tauriビルドと上記の実操作を確認。
- `npm run check:mac`: 成功。LinuxのC／Objective-C依存生成を省略する既存の検査用コンパイラスタブを使った**aarch64 macOS向けRust型検査のみ**。macOSのリンク／実行／Finder関連付け／トレイ／VoiceOverは未確認。`docs/port-spec/macos-checklist.md`のD1〜D7へ追加済み。
- `git diff --check`、変更JSの構文検査を実施。`src/art/`、CSS、プロトタイプ、`docs/decisions.md`は変更していない。別作業の未追跡アート報告書はこの納品に含めない。
- TODO(owner): `official_keys.rs`のk1仮公開鍵を、オーナー自身がリポジトリ外で生成した本物の公開鍵へ差し替えてから本番配布する。使い方は`docs/distribution-howto.md`。秘密鍵をアプリ・Git・ログへ入れない。
- 130文字前後のコード目標には届かない（234文字）。署名・ID・期限を保つためで、キー位置／期限の固定形式を説明書へ記載。Keychain移行、本人確認、配布数、時計改ざん対策、端末間の二重利用、配布済み取り消し、通信・決済・Scrapsのやり取りは範囲外。
- 受領でDB取引が失敗した場合、内容ハッシュで保存した未参照の検証済みファイルが残り得る。DBの受領記録・棚・在庫は巻き戻る。掃除／バックアップ運用は今後の課題。

## Stepのコミット

| Step | コミット／内容 |
|---|---|
| 1 | `1ff77af` — Ed25519／公開鍵／端末鍵 |
| 2 | `8962962` — 公式イベント／コード／追加封筒／V8 |
| 3 | `ee8fdb6` — 取り込みUI／関連付け |
| 4 | `2879db4` — peta-pass／オーナー説明 |
| 5 | `5279e35` — Gift v2／TOFU |
| 6 | `feat(pack): add signed creator pack export and consented versioned imports` — 作者パックと本報告（自身のコミットIDはgit logで確認） |
