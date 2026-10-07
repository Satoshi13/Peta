# 2026-10-07 UI修正レポート

`claude/relaxed-dijkstra-ocnjzu` の指定コミット `27f58c1` を取得し、作業ブランチ `codex/ui-fixes-oct07` で起動時の印刷バグ、A〜Fを順番に実装した。依頼書・最新のREADME／決定事項／tokens／macOSチェックリストと、`docs/ui-proposals/feedback-2026-10-07/` の4枚を参照した。開始時の作業ツリーはクリーン。

## コミットとテスト

| 順序 | 内容 | コミット | 項目終了時のnpm test |
|---|---|---|---|
| 1 | 起動時の自動印刷を停止 | `2181237` | 58成功、0失敗 |
| 2 | A: 傾き保持・ホバー補間 | `a503e1e` | 58成功、0失敗 |
| 3 | B: 最終サイズでズーム描画 | `802d322` | 58成功、0失敗 |
| 4 | C: ズーム中の操作・フォーカス隔離 | `f782906` | 58成功、0失敗 |
| 5 | D: Featuredの紙を9-slice化 | `401474e` | 58成功、0失敗 |
| 6 | E: Settingsへコードの入口を集約 | `2dfc99d` | 58成功、0失敗 |
| 7 | F: Collectionヘッダー位置を固定 | `5ee26db` | 58成功、0失敗 |

READMEと決定表に各項目を追記（決定日2026-10-07、1件1行）。実機項目は[macOSチェックリストの23節](port-spec/macos-checklist.md#23-2026-10-07-のui修正)へ追加した。

## 原因と修正

### 起動時の印刷

Rustの起動・日付切替の`print::sync()`が保存済みキューの存在から印刷モードを有効にしていた。加えて、デスクトップUIの`initPrint()`も初期状態を印刷中としてキューを読み出していた。この両方を修正し、保存済みの待ちはResume／Stickまで静かに残す。キューのFIFO・優先処理・配置・DBは変更していない。

実行中の印刷をディスプレイ再構成で失わないよう、`print-changed`を購読してから既存の`layer_info`で現在の実行状態を受け直す。Rust変更はこの状態同期に必要な4ファイルだけ。既存コマンドの名前・引数・戻り値と、イベントのbool形式は維持した。

実際の`src/print.js`を実行する回帰テストを3件追加し、保存済みキューから起動しても画像を読み出さないこと、明示的開始で読み出すこと、再構成で実行中の状態を復元すること、Laterで途中の読み出しを無効にすることを確認した。macOSでの再起動・フォーカス・複数画面は未確認。

### A: 素材カードと他のホバー

Materialsの追従は`baseTransform`が空でCSSの−2°を上書きしていた。基底に`rotate(-2deg)`を渡し、追従と合成した。`[data-follow]`の一括transition無効化を撤去し、transformはJSの既存補間、背景色・影・filter・opacityはCSS補間に分けた。操作面を固定し、持ち上がりは内側の`.mc`だけで行う。

`.mbook`／`.mk-mat`／`.mk-tile`／`.choice`／`.tile`／`.sample`／`.pack`／`.cr-card`／`.stuck-t`を監査し、状態変化と装飾の補間を220ms・`cubic-bezier(.2,.7,.3,1)`で揃えた。既存の反射追従とRAFの終了処理は維持。Reduce motionではホバー移動を省略し、静止角を保つ。

4構成すべてで修正前はホバー時0°、修正後は静止・ホバー・離脱とも−2°（丸め誤差0.0001°未満）。ホバー前後のボタン矩形は完全一致。Market MaterialsもFull motionで−2°を確認した。[測定値](port-spec/compare/review-15/a-after.json)

### B: パックの描画解像度

修正前は棚サイズの複製に約1.37〜1.88倍のscaleを残していた。複製を最終位置・寸法でレイアウトし、縮小変換から等倍へ移動させ、静止後は`transform:none`を明示する。背景のカメラ移動・680msの寄り／560msの戻り・イージングは維持。早期Escは現在の変換から戻る。

DPR2の4構成すべてで最終transformはnone、袋・ラベルは最終寸法で描画された。袋は最大330×440 CSS px（660×880 device px）。720px窓ではStudioが約248.39×331.19、Deskが約240.83×321.11 CSS px。同梱袋アートは768×1024で、解像度を超えないようDPRに応じて上限を設けた。ホロのsheenを保持し、Packsの3種・Market・Reduce motion・途中Escで最終状態と復帰を確認した。[測定値](port-spec/compare/review-15/b-after.json)

Chromium DPR2で輪郭・文字を確認したが、原因に挙がっているmacOS WKWebViewのラスタライズとRetina実機の鮮明さは別途確認が必要。

### C: モーダルの操作隔離

`aria-modal`だけでは実際の背景操作を止められなかった。ページの各子とナビをinertにし、窓操作を除外した。Tab／Shift+Tabは有効な詳細ボタンを循環し、背景スクロールキーとグローバルショートカットを抑止する。入力部品の編集・ボタンのEnter／Spaceは通す。

4構成で矢印・PageUp/Down・Home/End・⌘1／⌘7後も背景scrollTopとページが不変、フォーカスは詳細内。Enter／Spaceはボタンを実行し、Escは元の袋にフォーカスを戻した。画面更新と意図的なopen例外でもinert・overflowを解除した。終了処理は以前のinertとインラインstyleを復元する。[確認値](port-spec/compare/review-15/c-after.json)

### D: Featuredの索引カード

紙を100%×100%、さらに120%×140%の背景で引き伸ばしていた。900×600pxの画像を確認し、透明余白・角・右上の穴が中央の伸縮へ入らないよう、上／右／下／左を175／205／110／150pxでスライスし、35／41／22／30pxで描画した。角と穴は縦横とも0.2倍で固定、中央と直線の縁だけがカード寸法に追従する。クリップ・0.6°の静止回転・drop-shadowは維持。

Studio／Deskの720・1060・1400pxで確認。狭幅はスクロールして紙全体を収めた画像も追加した。左の袋は104pxの実寸レイアウト、扇は約84pxと画像比率でレイアウトし回転だけなので、拡大scaleの置き換えは不要だった。`src/`内で同じ索引カードを引き伸ばす別の描画箇所はなかった。左の配置・寸法・アートは変更していない。[測定値](port-spec/compare/review-15/d-after.json)

### E: Redeemの入口

TodayとGiftsのリンクを削除し、Settingsの通常カードの最後に指定文言と`.btn.paper.small`の副ボタンを配置した。GiftsのOpen Peta fileは維持。Rustのメニューバーは変更せず、`app-page`のredeem分岐だけを整理し、既存ページを再構築・移動せずにダイアログを出す。窓を隠した後も同じページ、初回の`?page=redeem`はTodayになる。パックのズーム中なら先に操作隔離を解除する。

4構成でSettingsボタンへTab→Enterで到達し、入力エラー・成功・キャンセル、成功後のreload／refresh／同じトースト、追加封筒のTodayへの反映を確認。Collectionの表示中と隠した後のメニューイベントで、ページとDOMの同一性を保った。初回URLとズーム中の呼び出しも確認。Todayの開封前後とGiftsにはRedeemがなく、末尾レイアウトの比較画像を保存した。[確認値](port-spec/compare/review-15/e-after.json)

これらの受取結果はIPC fixtureによる確認。実際の署名付きコード・ファイル・トレイ操作・ミニマイズからの復帰はmacOS実機項目。

### F: Collectionの固定配置

右寄せの可変ボタン列の先頭に切替を置いていたため、Save posterの追加で切替が動いていた。また選択中の太字で切替全体の幅が約2.8px変わっていた。ボタン群を切替の左へ移し、切替の各ボタンを76pxに固定した。880px以下は切替をタイトルと同じ段の右、ボタン群を次の段の右に固定する。

4構成でList→Calendar→Listを繰り返し、切替・Make a Pack・ヘッダーの矩形が完全一致した。Make a PackとSave posterの既存ハンドラ、有効／空Collectionでの無効状態も確認。ビュー設定の保存と本体の処理は変更していない。[全測定値](port-spec/compare/review-15/f-after.json)

値はCSS px、順にx / y / width / height。両ビューで同じ値。

| Shell | 窓 | List／Calendar切替 | Make a Pack | 切替／Makeの座標差 |
|---|---|---|---|---|
| Studio | 1060×700 | 862.000 / 48.000 / 162.000 / 38.000 | 725.641 / 52.000 / 124.359 / 30.000 | 0 / 0 |
| Studio | 720×520 | 522.000 / 50.000 / 162.000 / 38.000 | 559.641 / 112.000 / 124.359 / 30.000 | 0 / 0 |
| Desk | 1060×700 | 836.000 / 76.000 / 162.000 / 38.000 | 699.641 / 80.000 / 124.359 / 30.000 | 0 / 0 |
| Desk | 720×520 | 504.000 / 73.000 / 162.000 / 38.000 | 541.641 / 130.000 / 124.359 / 30.000 | 0 / 0 |

## 画像と再現方法

保存先は[review-15](port-spec/compare/review-15/)。既存の画像・資料は保持し、今回のファイルは`<studio|desk>-<1060|720>-<項目>-<before|after>.png`を基本に追加した。Dは1400pxと、紙を画面内へスクロールした`d-card`も含む。Eは`e-settings`／`e-today-opened`／`e-today-arrived`、Fは`f-list`／`f-calendar`。CはBの見た目を維持する操作修正なので測定JSONで記録した。

| 比較 | 修正前 | 修正後 |
|---|---|---|
| A: Materials（Studio 1060） | [前](port-spec/compare/review-15/studio-1060-a-before.png) | [後](port-spec/compare/review-15/studio-1060-a-after.png) |
| B: Pixel Dream（Studio 1060、DPR2） | [前](port-spec/compare/review-15/studio-1060-b-before.png) | [後](port-spec/compare/review-15/studio-1060-b-after.png) |
| D: Featured（Desk 720） | [前](port-spec/compare/review-15/desk-720-d-card-before.png) | [後](port-spec/compare/review-15/desk-720-d-card-after.png) |
| E: Settings（Desk 720） | [前](port-spec/compare/review-15/desk-720-e-settings-before.png) | [後](port-spec/compare/review-15/desk-720-e-settings-after.png) |
| F: Calendar（Studio 1060） | [前](port-spec/compare/review-15/studio-1060-f-calendar-before.png) | [後](port-spec/compare/review-15/studio-1060-f-calendar-after.png) |

実際のネイティブ用`src/app.html`とCSS／JSをChromiumで動かし、Tauri IPCだけを固定データへ差し替えた。プロトタイプの画面・HTMLは使っていない。全構成はDPR2。beforeは指定コミット`27f58c1`の`src/`をgitから読み込み、チェックアウトやDBを書き換えない。

再現にはPython PlaywrightとChromiumが必要（アプリのnpm依存は増やしていない）。[確認スクリプト](../scripts/ui-fixes-oct07-review.py)はローカルサーバーを自動起動する。[fixture](../scripts/ui-fixes-oct07-fixture.js)は実DB・ネイティブコマンドを実行しない。

```sh
python3 scripts/ui-fixes-oct07-review.py a before
python3 scripts/ui-fixes-oct07-review.py a after
# aをb〜fに置き換えて各項目を確認。Dは1400pxも含む。
npm test
```

## 最終確認と未確認事項

最終の`npm test`は58件成功、0失敗。[出力](port-spec/compare/review-15/oct07-final-npm-test.txt)を保存した。JS回帰テストのほか、各項目のブラウザ確認はすべて成功。`git diff --check`も成功し、`src/art/`・プロトタイプ・core・DB・Cargo.lockに差分はない。

Rustコアの`cargo test --manifest-path src-tauri/Cargo.toml -p peta-core --offline`は124件（単体119＋統合5）成功、0失敗。印刷FIFO・優先順・再起動後のキュー保持を含む既存テストが通った。これは変更したTauri状態同期コードの型検査・実機検証を代替しない。[出力](port-spec/compare/review-15/oct07-core-tests.txt)を保存した。

ネイティブ全体の`cargo check`も試したが、このLinux環境には`glib-2.0.pc`がなく、`glib-sys`のビルドで停止した。Tauri本体の型検査・起動は完了していない。ChromiumのDPR2確認はmacOS WKWebViewのRetina描画を代替しない。起動時印刷・ディスプレイ再構成・トラックパッドの追従感・VoiceOver・トレイ／保存パネル／署名コードの実機確認はチェックリストで未チェックのまま残した。
