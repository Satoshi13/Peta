# review-14: Creatorアイコンと素材カード

2026-10-04〜05（日本時間）、Linuxの実Tauri／WebKitGTK、使い捨ての`/tmp`ライブラリで検証。プロトタイプやmock IPCは使っていない。画像素材とgoldenは変更していない。

Creatorの保存・所有権のルールは`04a10a4`、Settings／Creatorsの選択UIは`cefd198`、素材の外形とこの記録は次の別コミット。DBは既存v8のmetaのみを使い、スキーマ・在庫・来歴・署名付き配布形式は変えていない。現在のプロフィールはローカルで、他端末へアイコンを配るアカウント機能は含まない。

## 比較画像

- [素材カードの変更前／後](material-cards-before-after.jpg): 以前のホロは小さく横長、Goldは大きく角丸が深かった。新しい表示は既存画像の文字のない質感部分をCSSで表示し、外形・角丸・ラベルを共通にする。画像ファイル自体のリサイズ／加工はしていない。
- [Creatorsとgolden](studio-creators-golden.jpg): 自分のプロフィール1行とChange icon…を追加した差分が意図した変更。サンプル作者のFollowは従来の未提供のまま。
- [Materialsとgolden](studio-materials-golden.jpg): 素材カードの共通外形が今回の差分。Scraps表示・分解ボタン・発見／在庫・説明文は以前の実装と実データによる差分。
- [アイコン選択](studio-icon-picker.png)、[Studio最小サイズ](studio-picker-720.png)、[Desk最小サイズ](desk-picker-720.png)。720×520では両シェルとも既存の下端ナビゲーションを使う。ダイアログは580×約379、一覧だけスクロールし、保存／取消を常に表示する。
- [Studioの素材Market最小サイズ](studio-market-materials-720.png)、[Deskの素材Market最小サイズ](desk-market-materials-720.png)。カードはどの素材でも同じ外形。

## 操作確認

実Settingsからオリジナルを選択して保存、Creatorsの自分の欄へ反映。8枚のオリジナル＋頭文字の9候補を表示し、矢印キーで選択とフォーカスが同じ候補へ移る。頭文字を選んでCancelすると以前のアイコンのまま。プロセス再起動後もIDが残る。Use initialを保存すると解除。アイコンに選んだオリジナルのDeleteでBookと設定が共に消え、頭文字へ戻る。原本再編集のID保持とGift／Pack／存在しないIDの拒否、削除の途中失敗の巻戻しはRustテストで確認した。

Marketで5種類の外形は幅148.34375／高さ89.578125／角丸5.632pxと一致。同じサイズのラベルを使う。最小720×520の素材開封は、ヒント下端約77px、カード上端約107／下端約209px、情報欄上端約352pxで重ならず、Keep itからTodayへ戻る。Createも実Rustの透明PNGセッションで素材トレーを確認し、取消した（素材は消費していない）。生の測定値は[verification.json](verification.json)。

## テスト

- `cargo test --manifest-path src-tauri/Cargo.toml --workspace`: 117件成功（core110＋統合5＋Tauri1＋CLI1）。
- `npm test`: 31件成功。変更JSの`node --check`と`git diff --check`も成功。
- `npm run check:mac`: Linuxの検査用C依存スタブを使ったaarch64 macOS向けRust型検査のみ成功。macOSのリンク／実行／VoiceOver／Retinaの描画は未確認で、macos-checklist.mdのC1〜C4へ追記した。

待機中のタイマー／常時アニメーションは追加していない。アイコンの画像は既存PNGキャッシュを使い、選択一覧は表示付近だけ読み込む。Reduce motionで操作可能。素材の製造輪郭は変更していない。


## デザイン品質・素材帳（2026-10-05）

詳細は[デザイン品質の報告](../../../design-quality-report.md)。先行のCreatorアイコン／素材形状の証跡は保持し、今回の撮影は接頭辞を分けた。

| 接頭辞 | 内容 |
| --- | --- |
| material-stock | 一覧の所持枚数、選択後のみDismantle |
| ab | 文字と昼のコントラスト |
| c | グループ／下端固定／520px高とキー検査 |
| d | 開封後Todayと実際の素材開封 |
| e | Book Listと選択維持 |
| f | Create通常／編集、720pxの操作盤 |
| g-day / g-night | 全8ページ×Studio／Desk×1060×700／720×520 |
| g-…-gift-form / dialog / gift-opening / calendar / edit-controls | 紙上の文字、dialog、開封、Calendar、編集の追加検査 |

各PNGは実Tauri窓のキャプチャ。goldenは歴史的な基準として保持し、今回意図した差分はTodayのヒーロー／等高カード、Book Listの242px台紙、Createの操作格子、Studioのグループと下端固定、Nightの部屋色。Listの月タブやCalendar構造・ルールは戻さない。JSONに横はみ出し／在庫／操作／遅延描画の測定値を保存。npm test 39件、check:macのRust型検査成功。macOSの実機描画・Retina／VoiceOverは未確認。
