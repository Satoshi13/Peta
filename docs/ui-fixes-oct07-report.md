# 2026-10-07 UI修正レポート

追加フィードバックでパック詳細のボタン寸法とナビ操作を修正した。Cのナビ隔離については[追加フィードバック](#追加フィードバック-パック詳細)が現行の動作。その後の依頼による無料開封・グレー表示・残数バッジは末尾の「無料開封と袋の表示」に記録する。

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

## 初回A〜Fの最終確認と未確認事項

最終の`npm test`は58件成功、0失敗。[出力](port-spec/compare/review-15/oct07-final-npm-test.txt)を保存した。JS回帰テストのほか、各項目のブラウザ確認はすべて成功。`git diff --check`も成功し、`src/art/`・プロトタイプ・core・DB・Cargo.lockに差分はない。

Rustコアの`cargo test --manifest-path src-tauri/Cargo.toml -p peta-core --offline`は124件（単体119＋統合5）成功、0失敗。印刷FIFO・優先順・再起動後のキュー保持を含む既存テストが通った。これは変更したTauri状態同期コードの型検査・実機検証を代替しない。[出力](port-spec/compare/review-15/oct07-core-tests.txt)を保存した。

ネイティブ全体の`cargo check`も試したが、このLinux環境には`glib-2.0.pc`がなく、`glib-sys`のビルドで停止した。Tauri本体の型検査・起動は完了していない。ChromiumのDPR2確認はmacOS WKWebViewのRetina描画を代替しない。起動時印刷・ディスプレイ再構成・トラックパッドの追従感・VoiceOver・トレイ／保存パネル／署名コードの実機確認はチェックリストで未チェックのまま残した。

## 追加フィードバック: パック詳細

オーナーの追加画像で、Open oneとOpen all 4の見える幅が違い、ズーム中にナビが押せないことを確認した。

副ボタンのクリック枠は元から幅100%だったが、紙画像の透明余白で見える枠が狭かった。ズーム内の副ボタンを紙色の丸枠で描画し、主・副の幅・高さ・角丸・行高を揃えた。主ボタンの黒、副ボタンの紙色は維持。Studio／Desk、1060×700／720×520の4構成で両ボタンのx・width・heightが一致し、高さは40 CSS px。1060pxでは幅296px、720pxはStudio約299.19px／Desk約291.83px。Day／Nightでも一致。

ナビのinertを撤去し、Tab／Shift+Tabの移動先と許可するフォーカス先に含めた。棚のinertとスクロールキーの抑止は維持する。ナビが操作できるため詳細は非モーダルdialogとし、aria-modalを外した。ナビから別ページへ移動すると既存の終了処理でズームを解除し、同じPacks／Marketを選んでも棚へ戻る。

4構成で、寄る途中（100ms）・静止後のナビクリック、ナビのEnter、同じPacksの選択、Marketからの移動、Reduce motionを確認。Tabは詳細とナビを循環し、矢印・PageUp/Down・Home/End・⌘1／⌘7は棚を動かさない。Escの元の袋への復帰・例外時の解除も確認した。先のC節は初回修正時の記録で、この追記と新しい決定表の行がナビに関する方針を更新する。

この修正時点の丸は1個が1枚分の枚数表示で、黒は未開封、薄い丸は開封済みだった。提示画像の12個は「3枚未開封・9枚開封済み」。その後のオーナー指示により、以下の無料開封の進捗表示へ変更した。

比較画像はreview-15の`<shell>-<width>-pack-feedback-before.png`／`pack-feedback-after.png`。beforeは`df2b302`。

- [修正前（Studio 1060）](port-spec/compare/review-15/studio-1060-pack-feedback-before.png)／[修正後](port-spec/compare/review-15/studio-1060-pack-feedback-after.png)
- [4構成の測定・操作結果](port-spec/compare/review-15/pack-feedback-after.json)
- [Cの更新後の操作確認](port-spec/compare/review-15/c-navigation-after.json)
- [再現スクリプト](../scripts/ui-fixes-oct07-pack-feedback.py): `python3 scripts/ui-fixes-oct07-pack-feedback.py after`

最終`npm test`は58件成功、0失敗。ブラウザ確認は実際のsrc UI＋IPC fixtureで、macOS実機・VoiceOverはチェックリストに未確認として残す。

## 無料開封と袋の表示

オーナーの回答「パック別に10枚ごとに追加1枚」に従い、通常の開封が10枚に達するたびに、そのパックの絵柄からランダムに追加1枚を受け取れるようにした。無料コピーは通常残数を減らさず、進捗にも数えない。まとめ開けは既存の1枚ずつの開封処理の成功数を数える。Welcomeの通常開封は引き続き1日1回で、獲得した無料分は別枠。

既存の開封履歴を基に付与数を計算し、無料分の受取レシートを既存のmetaへ保存する。無料コピー用の開封済みpack_itemsは通常の総数・残数・進捗から除外するため、追加購入や開発者版の補充後もカウントを保てる。DB v8のままでマイグレーションは不要。受取レシート・署名付きパックの絵柄情報・Book履歴・印刷待ちは1取引で確定する。失敗時は無料分を保持し、作成途中のコピーとファイルを片付ける。

10個の丸は開封進捗を表示し、満タンではOpen freeと未受取数を出す。通常残数はN openings leftに分けた。未受取分をすべて受け取ると次の10枚への端数に戻る（例えば12枚開封済みなら2／10）。未受取分・端数は再起動後も保持する。空袋も無料分が残っていれば受け取れるので、TodayのPack入口を利用可能にした。無料分も通常と同じ儀式で、袋を切るまでコマンドを実行しない。印刷はStick／Laterの既存選択を使う。

空袋のグレーと札のopacityはpk-stack自身の状態へ引き継ぎ、複製でも維持する。N leftはpk-stackの中へ移し、袋と同じ変換で拡大・縮小する。位置も袋の足元へ寄せ、バッジだけが背景の世界へ取り残される原因を除いた。サイズと位置は袋の幅に比例させ、最終サイズで描画する。

### 検証

- Rustコア: 通常版132件（単体127＋統合5）、developer版133件（単体128＋統合5）が成功。10枚の境界・パック別の独立性・重複受取防止・通常残数維持・再起動・署名付き絵柄とレア度・取引失敗の巻き戻し・安全な途中コピーの削除を含む。
- 開封コマンド: [実コードを使うハーネス](../tests/pack-rewards-runtime.rs)で5件成功。実SQLiteと実画像ファイルを使い、pack_status／pack_open／pack_open_freeの処理を実行。画像取得失敗とDB確定失敗で無料分を失わず、後者では途中コピーとファイルを削除して再試行できた。Tauriの状態・アセット取得・spawn_blockingだけを置き換え、ネイティブIPCやOS窓は動かしていない。
- JS: 実際の儀式関数のテストを3件追加。空のWelcomeで無料分を受け取れること、切る前のIPCがないこと、通常の日次条件と無料分の獲得条件、失敗時のbusy解除を確認。最終npm testは61件成功、0失敗。
- ブラウザ: 実際のsrc UI＋IPC fixture、DPR2、Studio／Desk・1060×700／720×520の4構成。進捗3／9／10、受取後の端数2、空袋の未受取2→1→0の計28状態を確認。Open free／Open one／Open all 4の3ボタンも幅が一致し、高さ40 CSS pxで最小窓でも操作可能。袋とバッジの相対位置・寸法を開始時とズーム途中・静止後・戻りで測定。グレー・札の薄さ、ナビ操作とReduce motionも確認。[測定結果](port-spec/compare/review-15/pack-rewards-after.json)

| 画面 | 通常残数2＋無料分1 | グレーの空袋＋無料分1 |
|---|---|---|
| Studio 1060 | [画像](port-spec/compare/review-15/studio-1060-pack-rewards-ready.png) | [画像](port-spec/compare/review-15/studio-1060-pack-rewards-empty.png) |
| Studio 720 | [画像](port-spec/compare/review-15/studio-720-pack-rewards-ready.png) | [画像](port-spec/compare/review-15/studio-720-pack-rewards-empty.png) |
| Desk 1060 | [画像](port-spec/compare/review-15/desk-1060-pack-rewards-ready.png) | [画像](port-spec/compare/review-15/desk-1060-pack-rewards-empty.png) |
| Desk 720 | [画像](port-spec/compare/review-15/desk-720-pack-rewards-ready.png) | [画像](port-spec/compare/review-15/desk-720-pack-rewards-empty.png) |

```sh
cargo test --manifest-path src-tauri/Cargo.toml -p peta-core --offline
cargo test --manifest-path src-tauri/Cargo.toml -p peta-core --features developer --offline
python3 scripts/check-pack-rewards-runtime.py
python3 scripts/ui-fixes-oct07-pack-rewards.py
npm test
```

出力はreview-15の`pack-rewards-core-tests.txt`／`pack-rewards-developer-tests.txt`／`pack-rewards-runtime-tests.txt`／`pack-rewards-final-npm-test.txt`へ保存した。ネイティブ全体のcargo checkは再確認したが、このLinux環境のglib-2.0.pc不足で停止。Tauri本体のビルド・macOS WKWebView・VoiceOver・Retina実機・実際の再起動と印刷は未確認のままチェックリストへ追記した。

ローカルでは`codex/ui-fixes-oct07`を取得・更新し、通常版は`npm run dev`、開発者版は`npm run dev:developer`で起動する。無料分の進捗を確認する場合、通常版と開発者版はデータの保存先が別である点に注意。
