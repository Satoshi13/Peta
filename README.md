# Peta — One sticker a day.

毎日、ひとつだけ。デスクトップに残る、ステッカーのある暮らし。

現在は `src/` と `src-tauri/` の本物のTauriアプリに、Studio / Desk、Cutting Mat、Print → Grab → Paste、Collection、Packs、Gifts、MaterialsとSettingsがあります。DBはv8。配布版の素材はすべて有限で、Welcomeは1日1回、Market / Giftは回数制限なしです。作成は選んだ素材を1枚消費します。最新のルールは [docs/decisions.md](docs/decisions.md)、移植・未決事項は [docs/port-spec/README.md](docs/port-spec/README.md) を参照してください。

## ネイティブUIの設定

窓の描画全体をStudioは18px、Deskは20pxの丸い外周に収めます。紙の影が透明な四隅へ残って尖って見えることを防ぎ、開封画面にも同じ外周を適用します。上端の移動と右下のリサイズは引き続き使えます。

Settings の Appearance は Day（既定）／Night／Auto。AutoだけmacOSの外観変更を購読し、Day／Nightでは購読・ポーリングを行いません。Studioでは窓・サイドバー・平らな面を夜色に、Deskでは外側のマットだけを暗い既存素材にします。紙札・付箋・裏紙・素材カード・Settingsの紙操作盤は色と暗いインクを保ち、切り替えは即時。設定は `peta.preferences` に保存します。

Settings の Sounds / Haptics / Reduce motion は `peta.preferences` に保存され、開いているデスクトップ層にも通知されます。Haptics は既定オン。Printの貼り付け成功・編集モードで動かして貼り直した成功時に LevelChange(2)、剥がし成功・Giftの封蝋を割った瞬間に Generic(0) を各1回。ドラッグ途中・ホバー・単なるボタン操作では鳴らしません。Sounds と Reduce motion とは独立し、対応トラックパッドのない環境では何も起きません。

文字は役割で統一します。見出し・説明・在庫はシステム書体、補足は12px以上、Overlineは11px。Special Eliteは13px以上の日付・時計・Scrapsの印字、Klee Oneは裏紙・ギフトのメモ・値札などの物にだけ使います。補助色は暖かい濃色 `#655e51`、平らな面と文字は共通トークンで管理し、本文のコントラスト4.5:1以上を検査します。

StudioのナビはMake / Collect / Discoverに分け、PetaロゴをTodayの上、Settingsとローカルプロフィール札を下端に置きます。Deskは従来の縦並びと下端のSettings、≤880pxは従来の下部バーです。⌘1〜⌘7はToday / Create / Collection / Packs / Gifts / Materials / Market、⌘,はSettings。入力・ダイアログ・演出中は無効。未開封Giftは数、今日の封筒はクラフト色の点で示します。

開封後のTodayはCreateを主導線にし、今日の素材とStuck todayを同じ高さのカードに配置します。素材の説明ピルは置かず、在庫はスウォッチと枚数で示します。開封前の封筒、次の封筒の札・Redeem Codeは維持します。

### Todayの次の封筒

今日の素材を開封すると、小さな紙札に `Next envelope in HH:MM:SS` が表示されます。端末の実時間の次のローカル0時が基準で、開発用の日付送りによる `daily.date` には依存しません。Todayが見える間だけ秒を更新し、離れる・閉じる・最小化・開封演出中は止めます。0時で既存のRust日付切り替え処理を即時呼び出し、新しい封筒へ戻ります。日次枠の使用数には依存せず、毎秒の読み上げはありません。

札は開封後の見出し右側に置き、本文末尾に一段を追加しません。日付は見出し左側に残ります。Special Eliteの数字は1文字ずつ固定幅の8枠へ収め、秒が進んでも札の幅や周囲の配置を変えません。

### BookのList / Calendar

見出しの切り替えは設定へ保存され、既定はListです。Listは全期間の記録を貼付日の新しい順、同日は作成時刻の新しい順に表示し、月タブ・年月見出しは出しません。既存Bookと同じく、同じステッカーを別の日にも使った記録はそれぞれ残します。画像は画面付近に入ってから読み込み、既存のPNGと読み込み結果をキャッシュします。

Listの各記録はドット罫の台紙、日付札、名前・素材・番号／Receivedの2行で表示します。On desktopは緑の点。今日まだ貼っていない場合だけ先頭にTodayへの空きスロットを置き、選択モードでは出しません。詳細操作と画像の遅延読み込みは維持します。

Calendarは既存の `e.date` をそのまま日単位で集計する紙の台帳です。最初の記録の月から今月まで、空の月も移動でき、未来月には進めません。週の先頭は端末ロケール、未対応時は日曜。複数枚の日は最新を開き、詳細のサムネイルで切り替えます。休んだ日は小さな `rest`、今日が空ならTodayへの `+`、未来日は薄い日付のみ。全日埋まった月だけCOMPLETEを表示し、今月は月末を迎えるまで出しません。スタンプは初表示で1回、`+`の脈動も表示時の短い1回だけとし、待機中の常時アニメーションを避けます。Reduce motionではめくり・持ち上がり・押印・脈動を省略します。切り替えても選択と既存の詳細・反転・Peel / Gift / Stick操作を保持します。

### 新素材の製造と入手

Gold Foil／Riso／Vintage／Clear／Pixel／Washi／Sakuraを製造できるようにしました。素材は画像フィルターではなく、Rustで境界・紙質・インク・透過を描く製造レシピです。Goldは金箔、Risoは青と珊瑚色の版ずれ、Vintageは褪色した紙、Clearは白インクと透けるフィルム、Pixelは淡い角形の印刷、Washiは植物繊維、Sakuraは薄桃色の紙と少量の押し花です。新素材の画像追加はなく、既存アートと静的なCSS／Canvasでカードと裏紙を表示します。

通常版ではCreateが1枚を消費します。再編集・再印刷・Pack／Giftには消費しません。入手と分解は既存の確認画面と一体のトランザクションを使い、再送で重複付与しません。DBはv8のままです。

| 素材 | 交換（1枚） | 分解（1枚） |
| --- | ---: | ---: |
| Gold Foil | 12 Scraps | 6 Scraps |
| Riso / Pixel / Washi | 2 Scraps | 1 Scrap |
| Vintage | 8 Scraps | 4 Scraps |
| Clear | 6 Scraps | 3 Scraps |
| Sakura | 通常の交換なし | 4 Scraps |

新素材はMarketのScraps交換または公式署名付き配布で入手します。Sakuraは春限定のArchiveとして製造・署名付き受取・分解だけを提供し、配布時期は未決です。既存の日替わり抽選（Matte 50／Kraft 32／Holographic 18）と初回Holographicは変更しません。Developerは7種類を含む全素材を無制限に使用できます。

Goldのデスクトップ反射はHolographicと共通のカーソル追従を使い、Reduce motionでは静止します。3Dの傾き・影・拡大は加えません。ほかの新素材に常時アニメーションはありません。

### 素材カードの共通形状

Today・Create・Materials・Market・開封時の素材カードは、同じ縦横比・角丸・ラベル位置で表示します。既存画像の文字のない質感部分をCSSで表示し、紙・クラフト・ホロ・金箔・Riso・Vintageの色と質感を残します。Clear／Pixel／Washi／Sakuraは同じ形状に静的なCSSの質感を表示します。画像ファイル自体は変更しません。素材別のステッカーの輪郭や製造ルールは従来どおりです。

### 操作の動き

ボタンとカードの操作面は固定し、絵だけを最大3pxの小さな持ち上がりで応答させます。親と内側のボタンは別々に動かしません。素材・ステッカーの光の追従は共有RAFで補間し、収束・ページ離脱・Reduce motionで止めます。自分自身を操作面にするカードは反射だけを変え、固定した親を持つ絵の傾きは最大5°、拡大は1.015倍までです。封筒・開封後の絵・光線の常時浮遊／回転はありません。

### 素材カードの引き出し

今日の素材は「封筒のフラップを開く → 白紙のカードを引き出す → 素材の柄と名前が現れる → Keep it」の流れです。引き出しが確定するまで素材の柄・名前・レア度を見せず、読み上げにも結果を含めません。カードは取り出すまで封筒の前面の後ろにあり、別の袋を切って同じカードを再び取り出す工程はありません。引き出しは上へのドラッグ、ダブルクリック、Enter／Spaceで操作できます。Pack／Giftの包装と受取処理は従来どおりです。

引き出しが確定した瞬間に `Tilt it to catch the light.` に切り替えます。Pack / Giftも共通のスリーブ処理で同じ文言へ即時切り替え、画像の読み込みを待ちません。素材カードの最終位置・縮尺はステージ内のヒントと情報欄の実寸から計算し、低い窓では縦横比を保って縮めます。表示後のリサイズもResizeObserverで再計算し、Keep itで破棄するため待機中のポーリングはありません。動く演出はReduce motionで省略します。

## 動かし方(Mac)

必要なもの: Xcode Command Line Tools、Rust(`rustup`)、Node 20+

```sh
npm install
npm run dev        # = tauri dev
```

- Dockには出ません。メニューバーに Peta のアイコンが出ます。
- 初回起動で、メインディスプレイの右上寄りにサンプルの猫が貼られます。
- 保存先: `~/Library/Application Support/app.peta.desktop/`(`peta.db` と `assets/stickers/<ID>/`)。Phase 0 の `placements.json` は初回に自動で移行されます。

### git pullで未コミット変更がある場合

`cannot pull with rebase: You have unstaged changes`は、手元の変更が残っているため更新が止まった状態です。`git status --short`で対象を確認し、変更を残したまま更新するなら次の順に実行します。

```sh
cd ~/Peta
git stash push -u -m "peta-before-update"
git pull --rebase
git stash pop
npm run dev
```

競合が出たら、そのファイルを解決してから起動します。stash popが競合した場合、退避した変更はstashに残ります。`git reset --hard`で変更を消す必要はありません。

### Creatorのアイコン

SettingsのCreator icon、またはMarket → Creatorsの自分のプロフィールのChange icon…から、自作のオリジナルステッカーを選びます。Save iconで保存、Cancel／Escでは変更しません。Use initialで名前の頭文字へ戻せます。完成画像を縦横比を保って表示し、アイコン設定で素材やステッカーは消費しません。

設定は既存DB v8のmetaへ保存し、再起動後も残ります。元のオリジナルを再編集すると表示も更新され、削除すると設定を解除します。Gift／Packの受取コピーは選択対象外です。現在はローカルのプロフィール設定で、アカウント同期や友達へのプロフィール配布は含みません。

### メニュー

| 項目 | 動作 |
|---|---|
| Open Peta | Todayを開く。素材未開封は `●`、印刷確定・貼付後は `✓` |
| Resume printing | 印刷待ちのFIFOを再開（待ちがあるとき有効） |
| Edit stickers | 編集モードのON/OFF。Esc / Doneで終了 |
| Settings… | 主窓のSettingsを開く |
| Quit Peta | 終了 |

トレイはこの5操作と区切り線の6項目。旧READMEにあったDeveloperのNext Day / Reset Todayと手動Re-syncは、現行ブランチには入口がありません。ディスプレイの自動再構成は維持しています。開発用コントロールをどこへ戻すかは [open-questions.md のP1](docs/port-spec/open-questions.md) に提案だけを残し、今回追加していません。

### 素材と開封のルール

Marketの購入済みパックは、Featuredのボタン・一覧の`On your shelf`・詳細の同ボタンからPacksへ移動し、該当する袋を表示します。表示はチェック付きの小さな紙色ラベル。棚への移動だけではパックを開封せず、残数や素材を消費しません。Reduce motionでは移動後のスクロールも即時にします。

- 今日の素材はローカル日付ごとに1つ抽選し、初回はHolographic。以降の重みはMatte / Kraft / Holographic = 50 / 32 / 18。
- 封筒を開けると素材を獲得。Matte / Kraft / Holographicはすべて有限で、作成時に選んだ素材を1枚消費します。在庫がないと新規作成できません。素材帳の発見記録は残ります。
- CreateとBookからの再印刷に1日1枚の上限はありません。Welcome Packは1日1回、Market Pack / Giftは回数制限なしで素材を消費しません。
- Cutting Matで作成を確定するまでは素材を消費しません。Cancel・画像ダイアログの取消・閲覧だけでは変わらず、編集・剥がし・貼り直しも素材を消費しません。
- 素材選択は位置を固定したカードの薄い紙色の台座と小さなチェックで示し、上の装飾テープ・持ち上げ・傾きは使いません。選択してもボタンを作り直さず、フォーカスを保持します。Materials／Packsの反射は固定した操作面から算出し、Createの見本・画像ドロップ・Giftの操作面もホバーで動かしません。Reduce motionでは追従と装飾の移動を止めます。
- 画像ドロップも既存のCutting Matを開きます。原本の再編集は同じステッカーの切抜き・輪郭を更新し、在庫や番号を消費しません。
- ローカル0時で切り替え。通常の30秒検知に加え、開封後のTodayが見える間はカウントダウンの境界で即座に同じ更新処理を呼びます。

### Scrapsの分解・引換

未使用のMatte／Kraft 1枚は1 Scrap、Holographic 1枚は3 Scrapsへ分解できます。作成済みステッカー・Giftは対象外で、素材帳の発見記録は残ります。Matte 1枚は1 Scrap、Kraft 1枚は2 Scraps、Holographic 1枚は6 Scrapsで引換。初回無料のTokyo／Coffee／Houseplantsは、空になった同じ袋へ16／12／10 Scrapsで8／6／5枚を補充できます。開封済み項目・来歴を残し、袋の総数は累計、残数は未開封数です。Pixel Dream／Cats／Night Marketは12／10／12 Scrapsで初回購入と空袋の補充ができます。中身が残る袋・Welcomeは交換対象外です。現金価格は表示しません。

MarketとMaterialsの右上にScraps残高を表示します。Materialsのカードはクリックでプレビューを開くだけで、Createの素材を選び直しません。分解ボタンは選択後のプレビューだけに置き、一覧には素材ごとの所持枚数を大きく表示します。`Dismantle…`から数量・受取Scraps・残る素材を確認し、Marketでは受取数・合計消費Scraps・引換後残高を確認してから確定します。キャンセルや閲覧では消費しません。応答が途切れた場合のRetryは同じリクエストを確認し、既に完了していても二重消費しません。

残高の初期値は0。Rustが残高・在庫・付与・リクエストごとの取引結果を1つのSQLiteトランザクションで更新し、再送で二重消費・二重付与しません。既存DB v8のmetaを使い、スキーマと既存の作成・開封・FIFOルールは変えません。新素材の交換比率とSakuraの扱いは「新素材の製造と入手」を参照。現金決済・アカウント同期は含みません。

### 署名付き配布（Phase A）

公式イベント・コード・Gift v2・作者Packをローカルで受け取れます。BookのMake a Pack…から完成ステッカー3〜24枚を署名して保存し、受け取りはOpen Peta file…の確認後に棚へ追加します。旧Gift v1もUnsignedとして読めます。DBは既存データを保つ追加マイグレーションV8です。素材／Welcome／作成／Scrapsの既存ルールは維持します。

配布準備は[オーナー向け説明](docs/distribution-howto.md)、検証・制約は[実装報告](docs/signed-distribution-report.md)。本物の公式秘密鍵はオーナーがリポジトリ外でkeygenし、公開鍵だけを同梱します。現在の仮公開鍵は本番配布前に要差し替えです。署名は鍵と改ざんの確認であり、本人確認・配布済み取消・端末をまたぐ利用制限は提供しません。通信・決済・アカウントは追加しません。

### Cutting Mat(写真 → ステッカー)

Today の **Create**、またはデスクトップへの画像ドロップで開きます。**Original → Cutout → 完成**の3ペインです。段階1／2／3を上端に置き、Originalの余白は同じ写真の暗いぼかしで埋めます（切り取りなし、ブラシ中の再描画なし）。Material／Look／Brushの格子と34pxのスライダー行に値を固定し、Undo／Redoはアイコン。素材は同じ皿・12px以上の名前と残数・選択リングとチェックで表示し、コストは決定ボタンの隣へ。小さい窓では操作盤を2列にし、縦スクロールで全操作へ届きます。

| 操作 | 内容 |
|---|---|
| (自動) | 背景除去 → 小さなゴミを消す → 穴を埋める → 輪郭を滑らかに → 丸いフチ(はさみで切ったように、狭い隙間は橋渡しされる) |
| **Material** | 獲得済みの素材から選ぶ。Matte(白い紙)/ Kraft(茶色い紙・くすんだ印刷)/ Holographic(白いリング+レインボーの膜・ラメ) |
| **Cutout adjust** | Tight ↔ Loose。切り抜きの厳しさ(動かすと即座に更新) |
| **Fix** | 中央のペインに **Erase / Restore** のブラシで描いて直す(Photoshop 的な編集機能はこれだけ)。Reset で全部戻す |
| Make this Peta | フル解像度で仕上げ、選んだ消耗素材を1つ使ってFIFO印刷待ちへ。Grab → Pasteで貼る |

- 元から**透明な背景の PNG**は、モデルを使わずにそのまま使います(フチと素材だけ付きます)。
- スマホ写真の**向き(EXIF)**は自動で直します。
- 背景除去は**同梱の u2netp(4.5MB)**を純Rust(tract)で実行します。**初回の解析に 1〜3 秒**かかります(Mac の方が速いはずです)。
  大きいモデル(silueta など)は `PETA_MODEL=silueta` で切り替えられます。細い部分に強いですが数倍遅いです → [src-tauri/models/README.md](src-tauri/models/README.md)。
- **Holographic／Goldの光沢**はmacOSのグローバルカーソルに追従します。帯の位置・角度だけが変わり、ステッカーの傾き・影・大きさは変えません。カーソルが未移動／層の外なら従来の位置・回転による反射へ戻ります。補間は収束で停止し、反射対象0枚／Reduce motionでは33msのカーソル取得も停止します。反射対象は `REFLECTIVE_MATERIALS` に集約。`reflection_status` の activeLayers / timerRunning / cursorReads とdebugログで停止を確認できます。Windows／Linuxのグローバル取得は未提供です。

### ステッカーの裏面(裏返す)

編集モード中に、ステッカーを**ダブルクリック**(または、ポインターを重ねて **F** キー)すると、ステッカーが真横を向いて**裏面のカード**に入れ替わります。もう一度ダブルクリックで表に戻ります。

- 自分で作ったもの: `ORIGINAL` のスタンプ / Created by(名前と日付)/ Material / `No. 0001` / Peta。
- 受け取ったもの(Gift・Pack): Created by / Received from(誰から・いつ)/ `Edition #0042`。データ側(来歴の記録と表示)は実装済みです。
- 裏返している間は**移動と裏返しだけ**できます(拡大縮小・回転・剥がすは表のときだけ)。編集モードを終えると、全部表に戻ります。
- 名前はSettingsの「Your name on stickers」で変えられます(以降に作るステッカーから。既定は OS のユーザー名)。

### Book(ステッカー帳)とMaterials

主窓のBookナビゲーションから開きます。List / Calendarの表示は上記のとおり。記録の日付は既存どおり、今日のPetaとして使った日（別の日にも使えば両日）、一度も使っていないサンプル等は作成日です。

- クリックで詳細を開き、ステッカーそのものをクリック／Space／Enterで表裏を切り替えます。Turn over行はありません。
- 既存の素材・日付・番号・来歴と、Stick on desktop / Peel off desktop / Giftを表示します。今日の枠の空きに依存せず、再印刷は既存FIFOへ追加します。
- オリジナルだけEdit（切抜き・輪郭の再編集）／確認付きDelete。Giftコピーは送信済みの相手側へ影響しません。タイトルの保存は未決のままです。
- Materialsは独立したナビゲーションで開き、獲得済みの素材・レア度・残数と、未獲得の表示を確認できます。

### 編集モードの操作

枠や取っ手はありません。ステッカー自体が反応します(透明な部分は掴めません)。

Option＋引き離しは、引く方向と反対側の端からめくれ、手の方向へ折り返します。まだ貼り付いている部分は平らに残り、輪郭に沿った素材の裏紙が連続したCanvas曲面に現れます。独立した3D紙片を重ねず、細かい曲面と連続した陰影で裏面の継ぎ目を抑えます。途中で離すと巻き戻り、十分引いて離すと最後の接着部分も剥がれて外れます。従来の距離判定・ライブラリへの保持・成功時1回の触覚は維持します。中断／Escなら戻し、Reduce motionでは巻き返し・飛び去りを省略します。表示部品と短いRAFは操作終了で破棄し、静止中にカールを更新しません。

| 操作 | 動作 |
|---|---|
| 中心寄りをドラッグ | 移動(持ち上がり、離すと「ペタッ」と貼り直される) |
| **輪郭の外側寄りをドラッグ** | 角をつまんで引くように、**拡大縮小と回転が同時に**かかる(カーソルが回転マークに変わる) |
| トラックパッドのピンチ / ひねり | 拡大縮小 / 回転(同時可。WebKit のジェスチャーイベント) |
| **Option を押しながらドラッグして引き離す** | 手の方向へ紙が折り返す。十分に引いて離すと**剥がれて消える**。途中で離すと貼り直される |
| Delete / Backspace | ポインター下のステッカーを剥がす |
| **ダブルクリック / F** | **裏返す**(もう一度で表へ) |

| **画像ファイルをデスクトップへドロップ**(編集モード中) | 既存のCutting Matへ取り込み。素材残数の範囲で何枚でも作る |

操作を離した時点で自動保存されます。触ったステッカーは最前面に来ます。
印刷から1枚貼り終えると給紙を止め、そのステッカーの編集へ戻ります。残りの印刷待ちは保存した順に残し、続きはトレイのResume printingで次の1枚を出します。新しく作る／Stickを押す操作でも既存の印刷待ちが先なら、その順序は維持します。起動・日付更新での既存の再開処理は維持します。
剥がしたステッカーは**デスクトップから外れるだけでライブラリには残ります**(Bookで確認できます)。再起動しても戻りません。
透明PNGはモデルなしで使えます。JPEG等の背景除去にはONNXモデルが必要です。
編集バーには、直近のドラッグの描画性能(fps / 最悪フレーム時間)が出ます。カクつき調査用です。

## 検証チェックリスト(仕様 §87 の Spike 順)

実機で確認して ✅ を付けてください。macOS固有の操作は実機確認が必要です。LinuxでのRust/JSテストと実Tauri画面の検証は [検証記録](docs/port-spec/compare/upgrade-2026-10-04/README.md)、今回追加した実機項目は [macOSチェックリスト](docs/port-spec/macos-checklist.md) を参照してください。

| # | 項目 | 見るポイント | 状態 |
|---|---|---|---|
| 01 | macOSでDesktop Layerを表示 | 壁紙の上に猫が出る。窓の枠・影・背景色がない | ☐ |
| 02 | Windows | 今回はスコープ外(`platform/windows.rs` はスタブ) | — |
| 03 | PNGを1枚表示 | 白フチの猫がきれいに(透過で)表示される | ☐ |
| 04 | click-through | 猫の上でも Finder / デスクトップアイコンを普通に操作できる | ☐ |
| 05 | Edit Mode | メニューで ON → 猫を掴める。OFF → また透過に戻る | ☐ |
| 06 | Sticker drag | 猫を動かせる | ☐ |
| 07 | Sticker resize | 輪郭の外側を掴んで拡大縮小 | ☐ |
| 08 | Sticker rotate | 輪郭の外側を掴んで拡大縮小+回転が同時にできる | ☐ |
| 08b | Peel Off | Option+引き離しでめくれ、離すと剥がれる / 貼り直される | ☐ |
| 09 | Placement保存 | 動かすと `~/Library/Application Support/app.peta.desktop/placements.json` が更新される | ☐ |
| 10 | 再起動後Restore | 終了 → 再起動で同じ位置・大きさ・角度 | ☐ |
| 11 | 解像度変更 | 解像度を変えても相対位置が保たれる | ☐ |
| 12 | 外部ディスプレイ | 接続で各画面にレイヤーが出る。外すとメイン画面へ退避し、再接続で元の画面へ戻る | ☐ |

### 特に注意して見てほしい点(未検証のリスク)

1. **重なり順**: 通常時、猫は壁紙の上・デスクトップアイコンの**下**に入るか。編集モードではアイコンの**上**に出るか。
   (`platform/macos.rs` のウィンドウレベル。期待通りでなければここを調整します)
2. **Spaces / フルスクリーン**: 別のデスクトップ(Space)に切り替えても猫が残るか。フルスクリーンアプリの上に出ていないか。
3. **異なるスケールのマルチディスプレイ**(Retina + 外部モニター等): 位置・サイズがずれないか。Tauri 側の座標変換が怪しい領域です。
4. **編集モードで最初のクリックが効くか**: アプリが非アクティブな状態でも掴めるか。
5. **メニューバーのアイコン**: ライト / ダークで見えるか。

## 構成

```
src/                 フロントエンド(ビルド不要の素のJS)
  placement.js         座標計算(純粋関数。tests/ で単体テスト)
  main.js / style.css  レイヤー描画と編集モード
  today.html/js/css    Today 画面(機能するプレースホルダー)
  creator.html/js/css  Cutting Mat(機能するプレースホルダー)
  collection.html/js/css  Sticker Book(機能するプレースホルダー)
  back-card.js/css     ステッカーの裏面カード(デスクトップと Collection で共有)
src-tauri/crates/core/ peta-core: OS・UIに依存しない中核(Linuxでも cargo test できる)
  db.rs                SQLite(stickers / provenance / placements)
  library.rs           DB + 画像ファイルの管理
  image_import.rs      画像の取り込み(EXIF向き・余白トリミング・縮小・PNG化)
  segment.rs           背景除去(ONNX モデルを tract で実行)
  cutout.rs            マスクの道具(エッジ吸着・ゴミ取り・穴埋め・距離場・ダイカット輪郭)
  sticker.rs           素材の描画(Matte / Kraft / Holographic)
  creator.rs           Cutting Mat のパイプラインとセッション(ブラシ補正・半解像度プレビュー)
  back.rs              ステッカーの裏面の中身(ORIGINAL / Received・来歴・日付の整形)
  book.rs              ステッカー帳(どの月のページに載るか・目次)
  daily.rs             Daily Slot(AVAILABLE→SELECTING→CONFIRMED→USED)
  materials.rs         素材カタログ(Matte / Kraft / Holographic)と抽選
src-tauri/crates/core/ の daily.rs / materials.rs: 日次素材・素材残数・無制限作成のルールと素材カタログ(時計を外から渡せるのでテスト可能)
src-tauri/src/
  today.rs             Today の状態・コマンド・ウィンドウ・日付変更の監視
  collection.rs        Bookのデータと、裏面・素材帳・名前のコマンド
  creator.rs           Cutting Mat のコマンド(作成時に保存・素材消費・FIFO印刷待ちへ)
  layers.rs            ディスプレイごとの透明レイヤー生成・再同期
  store.rs             ライブラリの所有、初回起動、旧JSONの移行、取り込み
  tray.rs              メニューバー
  platform/macos.rs    ウィンドウレベル / Space挙動(OS依存部)
  platform/windows.rs  スタブ
```

## 開発コマンド

```sh
npm test             # 座標計算の単体テスト(JS)
cargo test -p peta-core --manifest-path src-tauri/Cargo.toml   # ライブラリ層の単体テスト(Rust)
npm run check:mac    # Linux等から macOS 向けRustの型検査(要 rustup target add aarch64-apple-darwin。ObjC依存のため CC のダミー指定が必要)
```

### 画面整理（2026-10-05）

ステッカーの保存場所の表示名はCollectionに統一しました。Todayの素材カードはトレイ中央に配置し、説明ピルを撤去。所持素材は0枚も含めて実数を表示します。Stuck todayの空表示は文字のみで、テープと作成ボタンは置きません。Materials一覧の発見日・レシピ説明と、プレビューの発見日を省き、分解ボタンを所持数の下に配置します。Collection ListのToday’s slotを撤去し、StudioのPetaロゴを少し拡大。Creatorsの平面カードはDay／Nightの共通面・文字色を使用します。

### 配布版と開発者版

通常版は`npm run dev`／`npm run build`。開発者版は`npm run dev:developer`／`npm run build:developer`。ビルド時のRust featureで分け、Settingsのスイッチでは切り替えません。buildは配布用releaseビルドです。

Peta Developerは`app.peta.developer`、通常版は`app.peta.desktop`。アプリ名・在庫・Scraps・Collection・署名鍵・設定の保存先を分離します。開発者版は新素材を含む実装済み10素材を利用可能にし、素材消費・Scraps支払い・封筒／Welcome回数・袋の枯渇を解除。空袋は元の項目と署名済み素材情報を複製して補充し、開封済み履歴を残します。Settingsに封筒の再開封・Next Day・Re-sync Displaysを表示します。署名検証・所有権・ファイル仕様／サイズの検証は両版共通です。未実装の素材や共有Marketを追加する機能ではありません。モデレーターは依頼者の回答により後回しにします。
