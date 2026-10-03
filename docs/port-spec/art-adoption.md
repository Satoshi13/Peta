# 納品素材の採用状況

棚卸し基準: `claude/relaxed-dijkstra-ocnjzu` の `b82a86c`。スライス1〜8と review-01 / review-02 を含む。対象は `src/art/` の PNG / JPG / SVG **232点**。フォント・プレビュー HTML / JS / CSS・manifest 自体は素材数に含めない。

`app.html` と `index.html` から実際に開かれる画面・レイヤー、Rust のトレイ / アプリアイコンを確認した。P への登録、`--a-*` の注入、manifest の usedBy、`src/art/preview.html`、起動されない旧ウィンドウだけの参照は採用と数えない。上書きされる CSS / 存在しない DOM も除いた。

基準時点: 採用済み **101点**、未使用 **131点**。採用済みには Today / Gift の封筒、3種の Pack、素材カード・裏紙、月フラグ、紙ラベル・シール・操作ピル、Create、12サンプルを含む。`brand/tray-template@2x.png` は `src-tauri/icons/tray.png` と RGBA が一致。`brand/app-icon-1024.png` は `src-tauri/icons/` の配布サイズへ変換して使用されている。

## 基準時点で使われていない素材

パスはすべて `src/art/` からの相対パス。「使う場所」は用途候補であり、オーナー不採用の素材を復活させる指示ではない。

| 素材名 | 使う場所 | 使われていない理由 |
| --- | --- | --- |
| `back/edition-ribbon.png` | ステッカー裏紙・edition表示 | edition は裏面の文字で表示。リボンを重ねる DOM はない。 |
| `back/peta-mark-small.png` | ステッカー裏紙・edition表示 | 裏面の印は CSS の ink wordmark mask を使用。別の小ロゴは未使用。 |
| `back/stamp-original-frame.png` | ステッカー裏紙・edition表示 | P に登録のみ。裏面の文字情報と素材別裏紙に該当フレームは重ねていない。 |
| `back/torn-edge-mask.png` | ステッカー裏紙・edition表示 | 裏面は素材別 JPG、ステッカー輪郭は元画像の alpha / Rust renderer。裂けた裏紙 mask は未使用。 |
| `book/cover-edge.png` | Desk / Book の紙・表紙・とじ目 | 未登録・未適用。現行の紙の端・角・穴は CSS の仮部品。新しい紙パーツへの差し替え対象。 |
| `book/cover-kraft.png` | Desk / Book の紙・表紙・とじ目 | 閉じた Notebook 用。現在は開いた Book と cover-board.jpg を使用。 |
| `book/notebook-page.png` | Desk / Book の紙・表紙・とじ目 | 紙面全体の代替品。現行 page-paper.jpg の紙面を維持し、端パーツだけ差し替える予定。 |
| `book/page-corner-curl.png` | Desk / Book の紙・表紙・とじ目 | 未登録・未適用。現行の紙の端・角・穴は CSS の仮部品。新しい紙パーツへの差し替え対象。 |
| `book/page-curl-shadow.png` | Desk / Book の紙・表紙・とじ目 | 旧 Notebook のページめくり専用 .under-shade。Studio / Desk の DOM に存在しない。 |
| `book/page-dots.png` | Desk / Book の紙・表紙・とじ目 | 未登録・未適用。現行の紙の端・角・穴は CSS の仮部品。新しい紙パーツへの差し替え対象。 |
| `book/page-edge-bottom.png` | Desk / Book の紙・表紙・とじ目 | 未登録・未適用。現行の紙の端・角・穴は CSS の仮部品。新しい紙パーツへの差し替え対象。 |
| `book/page-edge-right.png` | Desk / Book の紙・表紙・とじ目 | 未登録・未適用。現行の紙の端・角・穴は CSS の仮部品。新しい紙パーツへの差し替え対象。 |
| `book/page-gutter.png` | Desk / Book の紙・表紙・とじ目 | 未登録・未適用。現行の紙の端・角・穴は CSS の仮部品。新しい紙パーツへの差し替え対象。 |
| `book/page-left.jpg` | Desk / Book の紙・表紙・とじ目 | 穴の焼き込まれた旧 Notebook 用。review-01 で二重の穴を避け、穴のない page-paper.jpg に統一。 |
| `book/page-right.jpg` | Desk / Book の紙・表紙・とじ目 | 旧見開き Notebook 用。Studio / Desk の Book は単一のスクロール面。 |
| `book/spiral-binding-graphite.png` | Desk / Book の紙・表紙・とじ目 | 黒とじ目の代替色。golden の銀とじ目に変更しない。 |
| `book/spiral-binding.png` | Desk / Book の紙・表紙・とじ目 | 未登録・未適用。現行の紙の端・角・穴は CSS の仮部品。新しい紙パーツへの差し替え対象。 |
| `book/spiral-cap-bottom.png` | Desk / Book の紙・表紙・とじ目 | 新しい binding と同じ位相で有限長に組み合わせるパーツ。現行 coil には未接続。 |
| `book/spiral-cap-top.png` | Desk / Book の紙・表紙・とじ目 | 新しい binding と同じ位相で有限長に組み合わせるパーツ。現行 coil には未接続。 |
| `book/spiral-holes.png` | Desk / Book の紙・表紙・とじ目 | 旧 CSS に参照があるが native.css がその疑似要素を非表示。現在は CSS の穴と単独 coil を組み合わせている。 |
| `book/spiral-rings.png` | Desk / Book の紙・表紙・とじ目 | 旧 coil の代替品。穴と一体の binding はまだ未適用。併用するとリングが重複する。 |
| `book/tab-blank-1.png` | Desk / Book の紙・表紙・とじ目 | NAV が --tab-img を登録するだけで Studio / Desk の CSS は参照しない。Book の月は month-flag-* を使用。 |
| `book/tab-blank-2.png` | Desk / Book の紙・表紙・とじ目 | NAV が --tab-img を登録するだけで Studio / Desk の CSS は参照しない。Book の月は month-flag-* を使用。 |
| `book/tab-blank-3.png` | Desk / Book の紙・表紙・とじ目 | NAV が --tab-img を登録するだけで Studio / Desk の CSS は参照しない。Book の月は month-flag-* を使用。 |
| `book/tab-blank-4.png` | Desk / Book の紙・表紙・とじ目 | NAV が --tab-img を登録するだけで Studio / Desk の CSS は参照しない。Book の月は month-flag-* を使用。 |
| `book/tab-blank-5.png` | Desk / Book の紙・表紙・とじ目 | NAV が --tab-img を登録するだけで Studio / Desk の CSS は参照しない。Book の月は month-flag-* を使用。 |
| `book/tab-blank-6.png` | Desk / Book の紙・表紙・とじ目 | NAV が --tab-img を登録するだけで Studio / Desk の CSS は参照しない。Book の月は month-flag-* を使用。 |
| `brand/logo-wordmark-ink.png` | アプリアイコン・ロゴ・トレイ | 同じロゴの SVG を CSS mask に使用。PNG は未使用。 |
| `brand/logo-wordmark-white.png` | アプリアイコン・ロゴ・トレイ | 現在のサイドバーは ink SVG。白ロゴを使う背景がない。 |
| `brand/logo-wordmark-white.svg` | アプリアイコン・ロゴ・トレイ | 現在のサイドバーは ink SVG。白ロゴを使う背景がない。 |
| `brand/tray-template.svg` | アプリアイコン・ロゴ・トレイ | トレイは同じ納品絵の 44×44 PNG を src-tauri/icons/tray.png で使用。SVG 自体は未使用。 |
| `creator/cut-line-00.png` | Create の作業マット・カット線 | カット線は cut-line-sheet.png の sprite を既に使用。個別12フレームは使わない。 |
| `creator/cut-line-01.png` | Create の作業マット・カット線 | カット線は cut-line-sheet.png の sprite を既に使用。個別12フレームは使わない。 |
| `creator/cut-line-02.png` | Create の作業マット・カット線 | カット線は cut-line-sheet.png の sprite を既に使用。個別12フレームは使わない。 |
| `creator/cut-line-03.png` | Create の作業マット・カット線 | カット線は cut-line-sheet.png の sprite を既に使用。個別12フレームは使わない。 |
| `creator/cut-line-04.png` | Create の作業マット・カット線 | カット線は cut-line-sheet.png の sprite を既に使用。個別12フレームは使わない。 |
| `creator/cut-line-05.png` | Create の作業マット・カット線 | カット線は cut-line-sheet.png の sprite を既に使用。個別12フレームは使わない。 |
| `creator/cut-line-06.png` | Create の作業マット・カット線 | カット線は cut-line-sheet.png の sprite を既に使用。個別12フレームは使わない。 |
| `creator/cut-line-07.png` | Create の作業マット・カット線 | カット線は cut-line-sheet.png の sprite を既に使用。個別12フレームは使わない。 |
| `creator/cut-line-08.png` | Create の作業マット・カット線 | カット線は cut-line-sheet.png の sprite を既に使用。個別12フレームは使わない。 |
| `creator/cut-line-09.png` | Create の作業マット・カット線 | カット線は cut-line-sheet.png の sprite を既に使用。個別12フレームは使わない。 |
| `creator/cut-line-10.png` | Create の作業マット・カット線 | カット線は cut-line-sheet.png の sprite を既に使用。個別12フレームは使わない。 |
| `creator/cut-line-11.png` | Create の作業マット・カット線 | カット線は cut-line-sheet.png の sprite を既に使用。個別12フレームは使わない。 |
| `creator/cutting-mat-dark.jpg` | Create の作業マット・カット線 | 承認済み cutting-mat.jpg を使用。暗色マット切替はない。 |
| `empty/collection-empty.png` | Book / Today / Gifts / Peel の空状態 | README §5 の未採用品。空状態はプロトタイプ同様に文のみ。画像を追加する承認済み構成がない。 |
| `empty/inbox-empty.png` | Book / Today / Gifts / Peel の空状態 | README §5 の未採用品。空状態はプロトタイプ同様に文のみ。画像を追加する承認済み構成がない。 |
| `empty/nothing-to-peel.png` | Book / Today / Gifts / Peel の空状態 | README §5 の未採用品。空状態はプロトタイプ同様に文のみ。画像を追加する承認済み構成がない。 |
| `empty/stuck-empty.png` | Book / Today / Gifts / Peel の空状態 | README §5 の未採用品。空状態はプロトタイプ同様に文のみ。画像を追加する承認済み構成がない。 |
| `fx/peta-tag-bubble.png` | 貼り付け成功時の Peta! タグ | 未登録・未適用。TAGS の en 以外はまだ CSS。round / holo / stamp を既存4枠へ適用予定。bubble / flag / torn は既存4枠の外。 |
| `fx/peta-tag-flag.png` | 貼り付け成功時の Peta! タグ | 未登録・未適用。TAGS の en 以外はまだ CSS。round / holo / stamp を既存4枠へ適用予定。bubble / flag / torn は既存4枠の外。 |
| `fx/peta-tag-holo.png` | 貼り付け成功時の Peta! タグ | 未登録・未適用。TAGS の en 以外はまだ CSS。round / holo / stamp を既存4枠へ適用予定。bubble / flag / torn は既存4枠の外。 |
| `fx/peta-tag-ja.png` | 貼り付け成功時の Peta! タグ | Aa Std / 英語 UI の TAGS は tagEn と pill / holo / stamp。日本語タグは出現プールにない。 |
| `fx/peta-tag-round.png` | 貼り付け成功時の Peta! タグ | 未登録・未適用。TAGS の en 以外はまだ CSS。round / holo / stamp を既存4枠へ適用予定。bubble / flag / torn は既存4枠の外。 |
| `fx/peta-tag-stamp.png` | 貼り付け成功時の Peta! タグ | 未登録・未適用。TAGS の en 以外はまだ CSS。round / holo / stamp を既存4枠へ適用予定。bubble / flag / torn は既存4枠の外。 |
| `fx/peta-tag-torn.png` | 貼り付け成功時の Peta! タグ | 未登録・未適用。TAGS の en 以外はまだ CSS。round / holo / stamp を既存4枠へ適用予定。bubble / flag / torn は既存4枠の外。 |
| `notes/binder-clip.png` | 付箋・メモ・インデックスカード・紙クリップ | 未登録・未適用。現行の付箋 / 紙カードは CSS または ui/ の旧パーツ。色・罫線の別案は使用箇所が未定。 |
| `notes/note-index-card-blank.png` | 付箋・メモ・インデックスカード・紙クリップ | 未登録・未適用。現行の付箋 / 紙カードは CSS または ui/ の旧パーツ。色・罫線の別案は使用箇所が未定。 |
| `notes/note-index-card-dot.png` | 付箋・メモ・インデックスカード・紙クリップ | 未登録・未適用。現行の付箋 / 紙カードは CSS または ui/ の旧パーツ。色・罫線の別案は使用箇所が未定。 |
| `notes/note-index-card-ruled.png` | 付箋・メモ・インデックスカード・紙クリップ | 未登録・未適用。現行の付箋 / 紙カードは CSS または ui/ の旧パーツ。色・罫線の別案は使用箇所が未定。 |
| `notes/note-memo-torn-cream.png` | 付箋・メモ・インデックスカード・紙クリップ | 未登録・未適用。現行の付箋 / 紙カードは CSS または ui/ の旧パーツ。色・罫線の別案は使用箇所が未定。 |
| `notes/note-memo-torn-kraft.png` | 付箋・メモ・インデックスカード・紙クリップ | 未登録・未適用。現行の付箋 / 紙カードは CSS または ui/ の旧パーツ。色・罫線の別案は使用箇所が未定。 |
| `notes/note-memo-torn-lined.png` | 付箋・メモ・インデックスカード・紙クリップ | 未登録・未適用。現行の付箋 / 紙カードは CSS または ui/ の旧パーツ。色・罫線の別案は使用箇所が未定。 |
| `notes/note-sticky-mint.png` | 付箋・メモ・インデックスカード・紙クリップ | 未登録・未適用。現行の付箋 / 紙カードは CSS または ui/ の旧パーツ。色・罫線の別案は使用箇所が未定。 |
| `notes/note-sticky-pad-pink.png` | 付箋・メモ・インデックスカード・紙クリップ | 未登録・未適用。現行の付箋 / 紙カードは CSS または ui/ の旧パーツ。色・罫線の別案は使用箇所が未定。 |
| `notes/note-sticky-pad-yellow.png` | 付箋・メモ・インデックスカード・紙クリップ | 未登録・未適用。現行の付箋 / 紙カードは CSS または ui/ の旧パーツ。色・罫線の別案は使用箇所が未定。 |
| `notes/note-sticky-pink.png` | 付箋・メモ・インデックスカード・紙クリップ | 未登録・未適用。現行の付箋 / 紙カードは CSS または ui/ の旧パーツ。色・罫線の別案は使用箇所が未定。 |
| `notes/note-sticky-sky.png` | 付箋・メモ・インデックスカード・紙クリップ | 未登録・未適用。現行の付箋 / 紙カードは CSS または ui/ の旧パーツ。色・罫線の別案は使用箇所が未定。 |
| `notes/note-sticky-yellow.png` | 付箋・メモ・インデックスカード・紙クリップ | 未登録・未適用。現行の付箋 / 紙カードは CSS または ui/ の旧パーツ。色・罫線の別案は使用箇所が未定。 |
| `notes/paper-clip.png` | 付箋・メモ・インデックスカード・紙クリップ | 未登録・未適用。現行の付箋 / 紙カードは CSS または ui/ の旧パーツ。色・罫線の別案は使用箇所が未定。 |
| `onboarding/hero.png` | 初回起動 | 専用オンボーディング画面は現行の8ページにない。 |
| `tabs/tab-film-lemon.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-film-lilac.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-film-mint.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-film-orange.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-film-pink.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-film-sky.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-paper-cream.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-paper-grey.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-paper-kraft.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-paper-lemon.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-paper-mint.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-paper-pink.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-paper-sky.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-shadow-strip.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-washi-dot.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-washi-plain.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `tabs/tab-washi-stripe.png` | ナビ・月タブ | 月は month-flag-*、ナビはシェル固有 CSS を使用。別の紙 / フィルム / 和紙タブの使用箇所がない。 |
| `today/choice-pack-box.png` | Today の封筒・選択肢 | 現行は envelope の4パーツと choice-pack-pouch.png。閉じた封筒1枚絵 / 別の箱は使わない。 |
| `today/envelope-closed.png` | Today の封筒・選択肢 | 現行は envelope の4パーツと choice-pack-pouch.png。閉じた封筒1枚絵 / 別の箱は使わない。 |
| `today/sparkles-sheet.png` | Today の封筒・選択肢 | 現行は envelope の4パーツと choice-pack-pouch.png。閉じた封筒1枚絵 / 別の箱は使わない。 |
| `ui/avatar-frame.png` | 共通 UI の紙パーツ | README §5 の未採用品。Creator はサンプル絵のまま、アカウント仕様が未決。 |
| `ui/binder-clip.png` | 共通 UI の紙パーツ | P に登録のみ。現行カードは paper-clip.png を使う。 |
| `ui/close-pencil-hover.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。閉じる操作は紙ピルの赤丸に置換済み。 |
| `ui/close-pencil-normal.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。閉じる操作は紙ピルの赤丸に置換済み。 |
| `ui/close-pencil-pressed.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。閉じる操作は紙ピルの赤丸に置換済み。 |
| `ui/close-stitch-hover.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。閉じる操作は紙ピルの赤丸に置換済み。 |
| `ui/close-stitch-normal.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。閉じる操作は紙ピルの赤丸に置換済み。 |
| `ui/close-stitch-pressed.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。閉じる操作は紙ピルの赤丸に置換済み。 |
| `ui/close-tape-hover.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。閉じる操作は紙ピルの赤丸に置換済み。 |
| `ui/close-tape-normal.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。閉じる操作は紙ピルの赤丸に置換済み。 |
| `ui/close-tape-pressed.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。閉じる操作は紙ピルの赤丸に置換済み。 |
| `ui/close-wax-hover.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。閉じる操作は紙ピルの赤丸に置換済み。 |
| `ui/close-wax-normal.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。閉じる操作は紙ピルの赤丸に置換済み。 |
| `ui/close-wax-pressed.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。閉じる操作は紙ピルの赤丸に置換済み。 |
| `ui/index-card-dot.png` | 共通 UI の紙パーツ | 現行 Featured カードは index-card-blank.png。ドット罫を必要とする表示がない。 |
| `ui/index-card-ruled.png` | 共通 UI の紙パーツ | 現行 Featured カードは index-card-blank.png。罫線を必要とする表示がない。 |
| `ui/memo-torn.png` | 共通 UI の紙パーツ | P に登録のみ。現行 Today / Packs の DOM にこのメモはない。 |
| `ui/pin-red.png` | 共通 UI の紙パーツ | README §5 に従いオーナー不採用。Market は厚紙ボード＋カード＋クリップ。 |
| `ui/pinboard.png` | 共通 UI の紙パーツ | README §5 に従いオーナー不採用。Market は厚紙ボード＋カード＋クリップ。 |
| `ui/pocket-back.png` | 共通 UI の紙パーツ | 収納ポケットの DOM がない。Gift / Today は専用封筒パーツを使用。 |
| `ui/pocket-front.png` | 共通 UI の紙パーツ | 収納ポケットの DOM がない。Gift / Today は専用封筒パーツを使用。 |
| `ui/resize-corner.png` | 共通 UI の紙パーツ | review-01 の指示で装飾を非表示。ネイティブのリサイズ当たり判定だけ残している。 |
| `ui/ribbon-bookmark.png` | 共通 UI の紙パーツ | 旧しおり閉じる操作用。現在のシェルは紙ピルで閉じる。 |
| `ui/seg-chip.png` | 共通 UI の紙パーツ | review-02 で選択肢をペンの丸に変更。旧 CSS は native.css が上書き。 |
| `ui/seg-track.png` | 共通 UI の紙パーツ | review-02 で選択肢をペンの丸に変更。旧 CSS は native.css が上書き。 |
| `ui/slider-knob-paper.png` | 共通 UI の紙パーツ | 現行スライダーは slider-knob.png を使用。差し替え対象がない。 |
| `ui/tag-cream.png` | 共通 UI の紙パーツ | 旧タグ系の代替品。現在の閉じる操作は紙ピル、ラベルは専用 button / seal 素材。 |
| `ui/tag-kraft.png` | 共通 UI の紙パーツ | 旧 close-tag の参照のみ。DOM がなく、ウィンドウ操作は左上の紙ピルへ置換済み。 |
| `ui/tag.png` | 共通 UI の紙パーツ | 旧タグ系の代替品。現在の閉じる操作は紙ピル、ラベルは専用 button / seal 素材。 |
| `ui/tape-5.png` | 共通 UI の紙パーツ | 現在は creator/tape-1..4 を使用。追加4柄に切り替える規則がない。 |
| `ui/tape-6.png` | 共通 UI の紙パーツ | 現在は creator/tape-1..4 を使用。追加4柄に切り替える規則がない。 |
| `ui/tape-7.png` | 共通 UI の紙パーツ | 現在は creator/tape-1..4 を使用。追加4柄に切り替える規則がない。 |
| `ui/tape-8.png` | 共通 UI の紙パーツ | 現在は creator/tape-1..4 を使用。追加4柄に切り替える規則がない。 |
| `ui/ticket-stub.png` | 共通 UI の紙パーツ | README §5 の未採用品。購入証明・半券の表示フローがない。 |
| `ui/window-controls/assembled-preview.png` | 共通 UI の紙パーツ | 納品確認用の合成プレビュー。実装は backing と赤・黄・緑の各パーツ。 |
| `ui/window-top-desk-hover.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。窓上端の帯は使わず drag-strip のみ。 |
| `ui/window-top-desk.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。窓上端の帯は使わず drag-strip のみ。 |
| `ui/window-top-notebook-hover.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。窓上端の帯は使わず drag-strip のみ。 |
| `ui/window-top-notebook.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。窓上端の帯は使わず drag-strip のみ。 |
| `ui/window-top-studio-hover.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。窓上端の帯は使わず drag-strip のみ。 |
| `ui/window-top-studio.png` | 共通 UI の紙パーツ | README §5 のオーナー不採用。窓上端の帯は使わず drag-strip のみ。 |

## 今回の差し替え対象と不足

- タグ: `en / round / holo / stamp` を prototype TAGS の4枠に対応させる。1回ごとの抽選・直前と同じ枠を除外・成功した貼り付けだけ・1300ms を保つ。日本語・bubble / flag / torn を追加すると既存4枠の出現確率を変えるため、プールを増やさない。
- 紙: `notes/` の付箋・インデックスカード・クリップと `book/` の端・とじ目・角を適用する。色 / 紙種の全バリエーションを無条件に表示することはしない。
- 今回のタグ・紙パーツに新規生成が必要な素材はない。足りないものは **新規生成ではなく決定**: 付箋の他色や pad、別柄の罫線・タブ・空状態をどの画面へ出すか。golden にない画面 / 部品は勝手に増やさず、上表に残す。
- `page-gutter.png` は160px幅のうち絵が左端約6pxだけ。幅全体を引き伸ばすと影が消えるので CSS で本来の絵を配置する。`page-left.jpg` と穴付きとじ目を併用しない。画像ファイルの変更・追加生成はしない。

## 項目2 適用済み（基準時点の表との差分）

| 素材名 | 実際の使用場所 | 変更 |
| --- | --- | --- |
| `fx/peta-tag-round.png` | `src/layer-port.js` TAGS の第2枠 | CSS pill を画像へ置換。円形を歪めず96×96px。 |
| `fx/peta-tag-holo.png` | 同 第3枠 | CSS foil を画像へ置換。124×50px、contain。 |
| `fx/peta-tag-stamp.png` | 同 第4枠 | CSS stamp を画像へ置換。112×52px、contain。旧枠線を除去。 |

`peta-tag-en.png` は第1枠のまま。4枠の最初は各1/4、その後は直前以外の各1/3。抽選を繰り返す方式もプロトタイプと同じ。貼り付け成功後だけ表示し、元の位置・キーフレーム・1300ms・Reduce motion を維持する。読み込みの遅れを避けるため4枚を先に decode する。

項目2完了時: 採用済み104点 / 未使用128点。実 Tauri レイヤーの4種は `compare/art-02/native-tags.png`、読込・寸法・枠線・演出時間は `compare/art-02/verification.json`。乱数の境界と直前重複の再抽選は `tests/peta-tags.test.mjs` で確認。

実際の印刷→ポインタで貼り付けでも確認済み: 2枚の FIFO 印刷と再印刷の貼り付けで合計3タグ、紙へ戻す操作では0タグ、直前との重複0。`compare/art-02/native-paste-tags.json` と `native-print-motion.json` に記録。

## 項目3 適用済み（基準時点の表との差分）

| 素材名 | 実際の使用場所 | 変更 |
| --- | --- | --- |
| `notes/note-sticky-yellow.png` | Book / Market の共通 `.detail` | CSS の単色カードを付箋紙へ置換。306px幅・16px余白・sticky位置・スクロールは維持。 |
| `notes/note-index-card-blank.png` | Market Featured のカード | `indexCard` を notes の納品紙へ差し替え。review-02 の配置と文字サイズを維持。 |
| `notes/paper-clip.png` | Market / Create の紙クリップ | `paperClip` の参照を notes へ統一。旧 ui 版と RGBA が同一。 |
| `book/cover-edge.png` | Desk Book の表紙外周 | cover-board.jpg のテクスチャを残し、8pxの端を納品パーツへ置換。 |
| `book/page-dots.png` | Desk Book のドット罫 | native512px / 23ドットの素材を506pxで配置し、元の22pxピッチを保つ。 |
| `book/page-gutter.png` | Desk Book のとじ目 | 画像幅160pxの左端の影を配置。CSS の内側の影と重ねない。 |
| `book/page-edge-right.png` | Desk Book の右端 | 納品された積層紙の端を8px幅で配置。 |
| `book/page-edge-bottom.png` | Desk Book の下端 | 納品された積層紙の端を8px高で配置。 |
| `book/page-corner-curl.png` | Desk Book の紙面右下 | 紙面の角に28pxで配置。review-01 で消した「窓」のリサイズ装飾は復活させない。 |
| `book/spiral-binding.png` | Desk Book の固定とじ目 | 穴とリングを一体で使用。48px幅、375px高の20セル、18.75pxピッチで反復。 |
| `book/spiral-cap-top.png` | 同 上端 | 元128×64pxを48×24pxで、帯の先頭と同じ位相に配置。 |
| `book/spiral-cap-bottom.png` | 同 下端 | 帯をセル境界で切り、最終リングと同じ位相に配置。窓サイズ変更でも再計算。 |

代わりに `ui/index-card-blank.png`、`ui/paper-clip.png`、`book/spiral-coil.png` は使用を終了。前者2点は notes へ参照を移し、coil は穴付き binding に置換した。`spiral-holes.png` と穴付き旧 page-left.jpg を重ねない。Studio に Desk のノート枠・とじ目は出さない。

項目3完了時: 採用済み **113点 / 未使用119点**（基準時点からタグ3点、紙12点を採用し、旧紙3点を使用終了）。他色の付箋 / pad、罫線付きカード、黒とじ目、見開き・閉じたノートは承認済みの表示箇所がないため未使用のまま。

### 比較と検証

`compare/art-03/` に元 golden を左・実 Tauri を右にした比較6枚、実画面 PNG、720×520の確認4枚、寸法・位相・スクロールの `verification.json`、全32状態の `overflow.json` を保存。再撮影は `scripts/port-art-review.py`。撮影は独立した `/tmp/peta-art-data` の実 SQLite fixture を使用し、通常のデータには触れない。

新規納品紙による差分は意図した置換: 詳細が黄色の付箋、表紙外周・銀とじ目・右下の紙の角、Featured の紙の縁。golden 原本・prototype・納品画像は変更していない。Linux / WebKitGTK のシステムフォント、実データの中立名 `Sticker`、素材の解放日、Today の未開封通知等は golden と異なる。**画素単位の一致・macOS の描画一致は未確認**。参考画像に合わせるための偽のタイトルや通知状態は実装していない。

検証: Rust84件、JavaScript14件が通過。8ページ×2シェル×2サイズで実際のはみ出し0、既知の紙ボタンの4px判定だけ4件。ノートの全サイズでリング帯をセル境界に合わせ、旧 coil DOM を除去。詳細カードは最下端までスクロール可能。必要な紙パーツはすべて納品済みで、追加生成は不要。
