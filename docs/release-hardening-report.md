# 公開前修正と友達限定ベータの実装報告

作業日: 2026-10-14。段階順に実装・検証・コミットする。本番の照会・migration・deploy・secret設定、本物の公式秘密鍵の生成、Appleへの公証送信は行わない。既存のオーナーの未コミット変更は開始時点で控えを取り、自分の差分だけをステージする。

## Step 1 — C1

k1の鍵スロット0を保持し、通常版では信頼を無効化した。coreをcfg(test)なしでコンパイルする統合テストで、公式ファイルとPETA1コードの拒否／Developerの受け入れを確認する。本物の鍵の生成は実行せず、既存peta-pass CLIとパスワード付きディスクイメージの手順を追加した。新規crateなし。

検証: sandbox内の全テストは既存Apple Visionの3件とlocalhostを使うテストが環境制限で失敗するため、通常の実行環境で必須セットを再実行する。詳細結果とコミットは各段階完了時に追記する。

Step 1 の必須セット（通常環境）: Rust既定・Developer、JS194件、Worker50件・型チェックがすべて成功。Apple Visionの3件も通常環境で成功し、既知の失敗はsandbox制限によるものと確認した。

## Step 2 — C2・C3

初期表示名を空にし、名前が未設定の共有をcoreとUIで拒否する。inbox_statusは名前未設定でも友達の状態を返すが、共有用コードとリンクは空にする。既存保存名は保持する。例示の個人名・ホーム絶対パスを匿名化し、文字列長に依存する改ざんテストと絶対パス検証の意味も合わせた。Git履歴には以前の例示が残る。画像内の文字は本作業の置換対象外。開始時点で未追跡だった提案・計画文書の匿名化は作業ツリーに保持し、元のオーナーの内容を丸ごとコミットしない。

Step 1 commit: `e706201`。Step 2: 必須5コマンドと追加後のRust既定・Developer全テストが成功（JS195件、Worker50件）。新規crateなし。

## Step 3 — C5

Step 2 commit: `befb4f7`。新旧の鍵ペアを0600ファイル・0700作業ディレクトリに保存し、公開前にファイルとディレクトリをfsyncする専用journalを追加。1つ目のrename後の中断、破損した新しい鍵、以前鍵が無かった場合、壊れたjournalでの読み込み拒否を検証する。Library起動と鍵の読み込み前に復旧し、完了した作業は先にディレクトリごと退役させて掃除する。既存 `.petakey`の形式・crateは変更なし。

Step 3: 必須5コマンドがすべて成功。故障注入を含む鍵復旧3件も両ビルドで成功。古い生成物2.93GBを既存clean-target.pyで整理し、データフォルダ・ソースには触れていない。

## Step 4 — C4

Step 3 commit: `c8a5c70`。通常版とDeveloperのreleaseビルドを共通ラッパーにし、HOMEとソースルートをremapする。encoded rustflagsで空白付きパスと継承フラグを維持する。パス検査は.appの実行ファイルをstringsで調べ、残存時に一覧と失敗を返す。最終の通常版・ベータ版バイナリの検査結果はビルド段階で記載する。新規crateなし。

Step 4: 必須5コマンドすべて成功。空白付きパスのフラグ保持、パス検査の成功・拒否を一時fixtureで確認。

## Step 5 — C6

Step 4 commit: `6e0d92e`。通常版・Developerで同じCSPを明示する。同梱scriptだけを許可し、styleのみ既存の動的な位置・素材表示のためunsafe-inlineを許可する。画像はself/data/blob/Tauri asset、接続はselfとIPC。APIの通信はRustなのでWebViewからの外部接続を許可しない。3つのHTMLにインラインscript/イベント属性はない。[Tauri公式文書](https://v2.tauri.app/security/csp/)を確認した。隔離IPCを使ったブラウザ検証と、ネイティブWebViewでの実機確認は区別して記録する。

Step 5: 必須5コマンドすべて成功。Chrome＋隔離IPCで実ファイルの10ページ、デスクトップ層、arrivalを設定したCSPヘッダー下で読み込み、違反なしを確認。任意のインラインscriptの実行は拒否された。ネイティブWebViewの全操作は未実施でチェックリストに残す。

## Step 6 — C7・C10

Step 5 commit: `710f8c4`。0004だけで通報の重複索引・対応時刻・保存状態・過去の出品配送証拠を追加。配送証拠には内容鍵・封筒を残さず、出品IDと鍵ハッシュの組だけを保持する。許可/拒否リストの関係と配送証拠を照合し、SQLiteの単一INSERTで容量を予約する。R2保存失敗は予約を保持し、同じ内容の再送で回復する。解決済みから30日のみ日次CronでR2→D1の順に削除する。Gift署名のサーバー検証は任意項目として見送った：既存のGift v3全フレームの別実装を増やさず、通報の真正性を運営が確認し、自動制裁には使わない。新規crateなし。本番には操作しない。

Step 6: 必須5コマンドすべて成功（Worker56件）。無関係の相手・出品受取権・偽の送り手の拒否、封筒削除後の通報、並行重複・件数上限、R2失敗後の再送、30日/29日/未対応と削除失敗の再試行を確認。devに0004を適用し、Worker 4.149.0でデプロイ成功：version `f3ad58a8-0257-41be-94b4-bc876c891edd`、日次Cron登録を確認。削除条件は隔離テストで検証し、実際のdev通報を作成・削除する検証は行っていない。本番には照会も変更もしていない。

## Step 7 — C8

Step 6 commit: `a8ee1d6`。Cargoのlocked/offline metadataと手元のソースでmacOS全feature（CLIとビルド用依存も含める）の323パッケージと同梱フォントを列挙する。crate配布物に本文が無かった18パッケージについて、版固定の上流告知と選択したMIT/Mozilla MPLの本文9ファイルを補完し、取得元・SHA-256を保存した。新しいツール・crateは導入していない。objc2上流のApple SDK由来の告知、MPLの版固定ソース取得先も残し、最終の法的確認はオーナーと専門家へ委ねる。一覧をbundle resourceに追加し、AboutからTextEditで開く。配布前のcargo audit/npm audit手順を追加した。

Step 7: 再生成のSHA-256が一致し、一覧は3,046,617 bytes。必須5コマンドすべて成功。npm auditはルート0件、Workerの開発・テスト用依存に7件（high 5・moderate 2）。対象は旧Workerテストpool経由のwrangler/miniflare/undici/sharpとvitest/mocker。Worker自身に実行時npm依存はないが、開発環境の指摘は未解消として扱う。指定されたCLI固定版を無断でまとめて更新・ダウングレードせず、配布前の依存更新と再検証の項目に残す。cargo auditは未導入で、依頼どおり新規導入せずRustの最新脆弱性照合はオーナーの配布前手順に残る。

移行機能の前の追加レビューで、C5の「ぶら下がったjournal symlinkの拒否」「復旧で完了した場合は成功を返してinboxメタデータも更新」「旧鍵の控えを公開前に読み戻して検証」を補強した。これらも移行段階のテストセットで確認する。

## Step 8 — C9

Step 7 commit: `d250bbf`。`.petamove`（PETAMOV1）を追加した。既存Argon2id 0.5.3・ChaCha20-Poly1305 0.10.1を使用し、256KiBごとに番号・終端・長さ・ヘッダーを認証する。SQLiteのVACUUM INTO snapshot、assets、2つの鍵、その他永続ファイルを含める。メモリにはチャンクと一覧のメタデータだけを持ち、完全認証後に0600/0700の一時領域で展開する。パス・重複・サイズ・ハッシュ、鍵、DB integrity/schema/外部キー、参照assetsを検証する。64GiB・10万エントリ・パス1024bytesが形式上限。

読み込みは、元々空だった初回起動で、自動のWelcome/sample/daily準備後に固定した変更数と永続内容の指紋が一致する場合だけ許可する。**同じ初回起動内**という安全側の制約を選んだ。初期サンプルを理由に新規Macの復元が常に不可能になることと、削除済みだから空だと推測することを避ける。アプリのV18は不要で、schema17と既存署名形式を維持する。交換は親journalとold/stageのフォルダ単位で行い、DB接続を閉じ、cache writerを止め、成功後に再起動する。サーバーへは送信しない。旧Mac停止と実際の2台移行はオーナーの確認項目。

移行レビュー後の追加対応: tag-iconsを再生成cacheとして除外し、thumbnailとapp iconの書き込みを同じ交換ロックで止める。Marketカードの旧絶対パスはsnapshot内だけroot相対へ正規化し、元DBは変更しない（この保存先列だけは文字列の一致ではなく移行先での参照の一致）。material/tag賞品の空png_pathは画像検証から除く。stage/old/rootのsymlink置換を拒否し、旧フォルダの指紋を確認してからrollbackする。親ディレクトリの宣言・chmod後のfsyncも検証する。

Step 8: 必須5コマンドすべて成功（JS198件、Worker56件）。追加した移行10件（Market/賞品/重複/親欠落/リンク置換を含む）と鍵復旧も既定・Developer両方で成功。NativeのDeveloper cargo checkも成功。実際の2台移行は未実施。

## Step 9 — B1

Step 8 commit: `e000a56`。

通常版設定のserverビルドをbuild:betaに追加し、通常版と同じbundle IDと保存先を使う。本番固定APIとDeveloperのdev/環境上書きを分けた。友達も進行中の申請も無い場合は自動受信・審判・Market同期を止める。申請は通信に必要なので「承認済みだけ」に限定しない。利用者が押した手動確認と共有操作の事前確認は維持する。Peta checksもserver版で表示する。ビルドのApple資格情報を継承せず、adhoc以外の署名・公証はreleaseスクリプトだけで行う。新規crateなし。本番照会なし。

Step 9の実ビルドで通常版に1件の個人パスが見つかった。Rustの位置情報ではなく、同梱の名前札PNGのtEXt（元画像の保存先）だったため、このchunkのみ除去した。PNGのIDAT bytes/SHA-256は前後で完全一致し、画素・見た目・color情報は変更なし。ソース/同梱assetsのバイナリも再走査した。通常版のcargo tree -e normalにはureq/reqwest/hyper/rustlsがなく、server版にはureq 2.12.1とTLS依存がある。

Step 9: 必須5コマンドがすべて成功（JS198・Worker56）。非Developerのserver付きworkspaceテストも成功。通常版/ベータ版の実releaseビルドと再検査が成功し、残存個人パス0件、bundle IDは両方app.peta.desktop。実行して本番へ接続する検証はしていない。生成物はtarget/release/verified/{offline,beta}/Peta.appに保持（正式配布用署名・公証なし）。全featureの実機操作はチェックリストに残す。

## Step 10 — B2

Step 9 commit: `44acea6`。owner-runの署名・公証scriptを追加。Apple ID/password/API鍵を引数やリポジトリへ保存せず、Developer ID名義とキーチェーンprofile名を環境変数で受け取る。資格情報なしではApple接続前に停止する。実際の登録・資格情報設定・署名・公証は未実施。mockのみで欠落、拒否、Accepted後のstaple/検証/再zip、上書き防止を確認した。既存distribution文書のk1差し替え指示も、現行のk2末尾追加と暗号化保管手順へ統一した。新規crateなし。

Step 10: mock検証とbash構文検査、必須5コマンドがすべて成功（JS198・Worker56）。Appleの実資格情報を使うコマンドは実行していない。
