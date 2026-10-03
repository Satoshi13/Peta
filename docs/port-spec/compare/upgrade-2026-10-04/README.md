# ネイティブ機能追加（2026-10-04）

変更ごとに共通ルールを確認してコミットする。DB v7・日次素材・Welcome の日次制限・Matte 無制限・Market/Gift 無制限を維持し、O1〜O5・画像素材・プロトタイプを変更しない。

## 1. ホロ反射

`reflection.json` は本物の Tauri / WebKitGTK 層と Rust IPC の確認結果。テスト用のカーソルイベントを注入し、帯の3変数だけが変わること、Matte/Kraft と全ステッカーの transform が変わらないこと、補間の収束後に RAF が増えないこと、画面外で元の静止反射へ戻ることを確認した。編集バーのpointermoveも窓全体で受け、同じ帯の計算で通常素材／transformを保つことを確認。Reduce motion とホロ0枚で activeLayers は0。Linux の cursorReads は常に0であり、macOS のグローバル座標取得・33ms間隔・複数画面・CPU は実機チェックリストに残す。

`npm test`: 17件成功。`rustc --test tests/reflection-coordinates.rs` の4件成功（上下反転・負の画面位置・Retina論理座標・境界）。Linux debugビルド成功。

`npm run check:mac` は Apple SDK のない Linux では C/Objective-C 依存のコンパイルに失敗した。README記載の方法で、Cオブジェクトの生成のみを省略する一時CCとインストール済み `aarch64-apple-darwin` Rust標準ライブラリを使った同コマンドでは型検査成功。これは Rust の型検査であり、macOS アプリのリンク・実行成功を意味しない。以降の各項目も同じ条件で確認する。

参考として指定された `ui-proposals/upgrade-preview.html` は対象ブランチに存在しないため、依頼文の仕様と既存UIトークンで実装した。

## 2. 触覚

`haptics.json`: Rustの実コマンドを呼ぶヘルパーを計数し、Bookの剥がし1回、Gift封蝋の連続クリックでも1回、ネイティブマウスによるPrint貼り付け1回、Hapticsオフの層への反映、Soundsオフ／Reduce motionとの独立を確認。ヘルパーの非対応エラーの吸収もテスト済み。実際の触感・編集モードの貼り直し・Force TouchはmacOSチェックリストH1〜H4に残す。

`npm test`: 18件成功。Linux debugビルド、前述のC依存省略条件での `npm run check:mac` 型検査成功。共通ルールの対象ファイル・DB・O1〜O5に変更なし。

## 3. Todayのカウントダウン

`countdown.json`: 未開封は非表示、開封後に秒が進む、aria-liveなし、別ページ／hide／最小化でintervalが0、復帰で1個だけ、境界で既存Rust reloadを即時呼ぶことを実Tauriで確認した。境界検査は札の期限を短縮して同じ処理を通したもので、実際のローカル0時・開発日送りはT2/T3の実機確認を残す。

`npm test`: 20件成功（ローカル0時・端数秒・日付境界・DST23/25時間）。変更JSの構文、Linux debugビルド、C依存省略条件のmacOS Rust型検査成功。共通ルール・DB/schema・日付の定義は維持。

## 4. BookのList / Calendar

`{studio,desk}-book-list-1060-golden.jpg` が既存手順と同じ未変更goldenの1060×700切り出し／本物のTauriの並置比較。Listの月タブ・年月見出しを除去し、全期間を新しい順にしたため件数・並びは意図的に変わる。右上のList/Calendar以外にSort/Filterを増やさず、操作を簡潔に保った。紙・素材・詳細・付箋・とじ目は既存のまま。比較データは実際のfixture記録とPNGで、goldenの猫や件数へ捏造していない。Linuxのシステム書体の差も残る。

8枚の `{studio,desk}-book-{list,calendar}-{1060,720}.png` と `book.json` で通常／最小幅・両シェルを確認。文字はみ出しと横スクロール0、カレンダー画像の縦横比の崩れ0。最小幅の既存flex縦並びが本文を縮めていたため、Book本文を利用可能な幅へ広げた。選択保持、設定保存、同日サムネイル、クリック反転、ListでPeel→CalendarでGiftフォーム／Stickの実際の印刷待ちへの追加、空の月、未来月禁止、COMPLETEの初回だけの演出を確認した。既存FIFOの先頭を入れ替えない。

`studio-calendar-empty-month.png` と `studio-calendar-complete.png` は専用/tmpのSQLiteへ追加したテスト用の履歴（月間30日充足）を実際のbook_pageから読んだ画面。`book.json` の400日分の履歴を追加した検査では、画面付近だけ画像を生成し、最後へスクロールすると末尾の画像を生成。ページを離れるとIntersectionObserverを破棄する。これは通常データ・スキーマ・ルールを変更するものではない。

`book-empty.json` は別の新規/tmpライブラリで、今日の＋→既存Today、1回の脈動終了、Reduce motionで脈動なし、両表示・両シェルの最小幅詳細を確認。最初の記録の月が開始点で、それ以前と未来月には移動しない。同じ原本を別の日に使った記録は既存Book同様にListにも各日残す。

`npm test`: 24件成功。日付集計・作成時刻順・曜日開始・閏年・31日・COMPLETE・安定した傾きの純関数を追加。Rust workspace89件、Linux debugビルド、C依存省略条件のmacOS Rust型検査成功。共通ルール・DB v7・O1〜O5・src/art/・prototypeは変更なし。macOS固有の確認はB1〜B5へ。
