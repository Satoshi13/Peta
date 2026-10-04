# デザイン品質の実装報告（2026-10-05）

対象は本物のTauri主窓。素材帳の分解導線を先に修正し、A+B → C → D → E → F → Gを別コミットで進める。画像・プロトタイプ・DB・Rust契約・素材消費／開封回数は変更しない。

## 素材帳

一覧のDismantleを撤去し、選択後のプレビューだけに残した。枚数は24pxの独立表示、Matteは∞、発見日は別行。実Tauriで0／1／∞、一覧の分解ボタン0、Kraftプレビューの分解ボタン1、閲覧時のCreate選択不変を確認。

## A+B: 文字と色

Display 40/44（Studio）、Title 22/26、Headline 15/20、Body 14/21、Meta 12/16、Overline 11/14。Special Eliteは印字に13px以上、手書きは物の上に限定した。数字はtabular-nums。コントラスト検査はWCAGの相対輝度から計算し、本文3色と状態色を5種類の面上で4.5以上、主ボタンも4.5以上とする。

| 旧 | 新（Day） | 用途 |
| --- | --- | --- |
| muted #7a7468 | #655e51 | 補助文字 |
| 個別の窓／サイド面 | w-win #f6f1e6 / w-side #efe9dc | 窓・ナビ |
| 個別の平らな面 | w-surface #fffdf8 / w-surface2 #f8f3e7 / w-sunken #efe8d7 | カード／台紙／凹み |
| 個別の線 | w-line #e3dac7 / w-line2 #ece5d4 | 枠・区切り |
| ink＋白 | w-btn #2b2a28 / w-btnfg #ffffff | 主ボタン |
| 提案 w-ok #4f7a4a | #456a40 | 濃い紙面でもAAを満たす状態色 |

### `--type` / `.hand` 判定表（ネイティブ主窓の全使用箇所）

| 箇所 | 判定／対応 |
| --- | --- |
| polish.cssのtype定義 | 定義と同梱フォントを保持 |
| eyebrow / quota small / rule-cap / pack small / mmeta small | UI説明。Overline／Metaへ置換 |
| datestamp / envelope-clock | 紙札の印字。Special Elite 13px以上 |
| scraps-count | ラベルはMeta、数字bだけ印字16px |
| scrap-summary b / input | 受取・残高の数字は印字16px、入力はシステム16px |
| calendar-multiple / calendar-rest | 集計・説明。Metaへ置換 |
| calendar-complete | 台帳の押印。Special Elite 13px |
| Bookの日付チップ | 台紙の印字。EでSpecial Elite 13px |
| back-card（base/pages/polish） | 裏紙の手書き。維持、ラベル・来歴を12px以上に |
| mcard lab | 物の名前。手書きを維持、重ね文字11px以上 |
| packs.js / market.js の b.hand | 値札の手書き名。維持 |
| ceremony.js の p.hand / ev-note b,span | Giftの紙メモ。維持 |
| library-pages.js の g-from.hand | 封筒に書いた名前。維持、FromはMeta |
| today.js lead.hand / addnote.hand | UI説明。handを外す |
| shared.js / book.js の empty-note.hand | 空表示のUI説明。handを外す |
| create.js の Cutting… hand | 進捗のUI説明。handを外す |
| settings.js のCreatorIcon頭文字 | UIのローカルアイコン。システム体へ |
| shells.css Desk ni-label / close-tag、polish.css close-tag | 現行ナビはnative.cssで既にシステム体。廃止済みclose-tagは非表示を維持 |
| env-label / env-wrap.send env-label | 封筒への手書き。維持 |
| pages.css note p / calendar-date | 紙メモ・台帳の手書き日付。維持 |
| cer-hint / calendar-add / peek-s.sealed b | 操作説明・追加ボタン・未開封表示。システム体へ |

12px未満の例外はOverline 11px、紙カードのラベル最小11px、レア度シール11px、装飾バッジ／ショートカット（C）、Book状態（E）の11px。裏面識別コードは装飾的な11px。一般の本文・補足は12px以上。

## 現行優先・プレビューとの差

- 指示書のDB v7は過去の値。署名配布で導入済みのv8を維持し、マイグレーションしない。
- ロゴtop:16pxという記述はshells.cssの初期値。現行polish.cssのtop:54px・left:22px・64×28pxを保持し、96pxの窓操作ピルも変更しない。
- Book Listは全期間、Calendarは既存構造を維持。提案の月タブ・日別ストリップ・1日1枚への回帰は実装しない。
- 参考HTMLの狭幅レールは採用せず、現行≤880pxの下部バーを維持する。
- review-14には前回のCreatorアイコン／素材形状の証跡もあるため、今回のファイルは段階名を接頭辞にして上書きしない。

## 検証・未確認

実Tauri Linux/WebKitGTK、専用テストDBで1060×700／720×520、Studio／Deskを撮影する。macOSの実機項目は未確認。最終テスト結果とC〜Gの確認結果は完了時に追記する。

A+B検証: npm test 33件、check:mac成功（Linux上のRust型検査、ネイティブC/ObjCはスタブで未リンク）。4ページ×両シェル×2サイズで横はみ出し0。

## C: サイドバー

Make / Collect / DiscoverをStudioに追加し、表示順と遷移方向を一致させた。上側の一覧だけスクロールし、Settingsとローカルプロフィールは下端。Deskは元の92pxの縦並びを保持しSettingsを下端へ、狭幅ではラベル／札／キー表示を外して従来の下部バーへ戻す。

幅は現行204pxを採用（216px案は本文の幅を12px削るため見送り）。ロゴtop54px・64×28px、窓操作ピルの位置・サイズはそのまま。グループの装飾Overlineのみ指示どおり10.5px、項目・プロフィールの補足は12px以上。未開封Giftは数のピル、封筒はクラフト色の点。全項目はbutton・data-page・aria-currentを保持、数の意味をaria-labelへ含めた。

ショートカットは採用。tray.rsの既存アクセラレータは⌘Qだけで重複なし。純関数のテストで対応順／入力・dialog・busy・ceremony／IME／他修飾キー／⌘Zを確認。プロフィール名・アイコン変更時にもナビを更新する。アカウント認証は追加しない。

## D: 開封後のToday

短いリード・Make a Peta・Createヒーローと3枚の補助カード。下段は等高の素材カード／Stuck today、特徴チップ・既存スウォッチの在庫ピル。実際の素材・在庫・未開封数を表示する。右上の固定幅時計とRedeem Codeを保持。compact Choicesは変更しない。

Createカード内のChoose imageはspanで主ボタンの見た目を重ね、外側のbutton.choiceを唯一の操作面とする（二重buttonはHTMLとして不正で、入れ子のホバー移動も生むため）。押す位置に関わらず現行Shell.goへ移動する。Stockは素材カード下の共通行に広げ、Holographic等の長い名前と3種類の在庫が収まるようにした。下段は内容に応じて約218px（196pxは目安）。≤1000pxの1列と≤880pxの2列Choicesを維持。

実Tauri・720×520で封筒→tear→pull→Keep→.tm-card .mcardまで完了。カード下端309.6px、情報欄上端334.8px、重なりなし、終了後もwindowOpen=true。開封後の4サイズ・シェルで横はみ出し0。開封の更新処理・Rust契約は変更していない。

## E: Book List

242pxの等高カード、256pxのドット罫、Special Elite 13pxの日付札、名前と素材／No.／Receivedの2行。On desktopは緑の点、Giftは静かなチップ。選択はカード内側の2pxリング。今日未貼付・非pick・Book非空のときだけ先頭に空きスロットを表示する。Listは全期間のまま、Calendarと詳細・Flip／Peel／Gift／Edit／Delete／Stick・Make a Packを保持。クイックアクションは詳細と重複するため追加しない。

新素材・タイトル推測は追加せず、現行titleOfと既存素材／番号を使う。未決O1に踏み込まず、無名のものはStickerのまま。画像は既存lazyStickerとIntersectionObserverを再利用。

## F: Createの操作盤

段階1／2／3をペイン上端へ移し、切り取らないOriginalの余白を同じ写真の暗いぼかしで埋めた。操作盤はMaterial／Look／Brushの格子、スライダーは62px／可変／34px、行高34px。迷子の数字はrange inputの既定最小幅が可変列を押し広げていたため、width:100%・min-width:0で各outputを行内に固定した。Undo／Redoは既存ロジックのままSVGボタン。素材トレイは共通の皿・スウォッチ・名前・残数、選択リングとチェック。使う素材の文言は決定ボタン横へ。MaterialTrayの呼び出し元はCreateのみ。

720×520では3ペインを横並びに保ち、操作盤は2列（素材は上段）にする。全操作を一画面に詰め込まず、既存の縦スクロールで3本のスライダー・決定ボタンへ届く。Studioは平らな面、Deskは既存panel-paperを保持。通常／実際に作成したOriginalの編集を両シェル・両サイズで撮影。3本のoutputはすべて行内で、下端までスクロールすると欠けなく表示された。実際のポインタ入力でブラシ→Undo→⌘⇧Z、ホイール拡大を確認。ブラシ／再生成中のOriginal drawImageは0回。在庫消費や保存ルールは変えていない。

各段階終了時のnpm testとcheck:macは成功（C〜Fは35件）。実機専用の検査は未実施。
