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
