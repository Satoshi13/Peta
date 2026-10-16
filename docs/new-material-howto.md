# 新しい素材をアプリへ追加する

Daily画面で追加できるのは既存素材の抽選への参加です。新しい絵・紙・反射にはアプリ更新が必要です。追加の際は次を確認します。

- `src-tauri/crates/core/src/materials.rs`の`catalog()`に、恒久的なid・名前・rarity・recipeを追加。既存idを変更しない。初日の`FIRST_DRAW_MATERIAL`はHolographicのまま。日次上限定数を変える場合はアプリ更新としてテストする。
- `src-tauri/crates/core/src/sticker.rs`の`Substrate`・recipeからの変換・ピクセル処理・マスク／境界／反射を追加。透明画像、縦横の画像、大きい画像、プレビューと保存画像の一致を確認する。`src-tauri/src/creator.rs`の描画・キャッシュ・素材選択を確認する。
- `src/app/js/catalog.js`の`MAT`、`src/app/js/sticker.js`のCanvas／DOM表示を追加。反射素材なら`src/app/css/sticker.css`などの関連描画も確認。書き出し・編集・贈り物・パック・デスクトップの各表示を確認する。
- `src/app/js/assets.js`の`P`へカード・スウォッチ・裏面の参照を追加。絵は`src/art/today/`・`src/art/materials/`・`src/art/back/`など既存構成へ。既存画像の流用で足りなければCodexのimagegenスキルで生成・透過・質感を確認し、採用した画像だけをアセットへ登録する。新しい画像の作成を依頼するときは該当スキルを読む。
- 素材カードやスウォッチのCSS（`src/app/css/`）と、`src/app/js/shared.js`等のカード・裏面の素材対応を検索して追加する。ラベルは英語、明暗両テーマと縮小表示を確認する。
- `src-tauri/crates/core/src/scraps.rs`の`MATERIALS`へ分解・交換レートを追加。経済を別途判断する。日次表の変更だけでレートを変えない。
- クーポン対象なら`grant_cap`と管理ページ`src/bundle.ts`の`CATALOG`を更新。`cloudflare/peta-admin/test/coupon-vector.json`との上限一致、発行→検証→適用を確認。契約更新は管理ページの`scripts/coupon-vector.mjs`で行い、秘密鍵は使用しない。
- PETA1で素材を配る場合、`events.rs`の`CODE_MATERIALS`は**末尾への追加だけ**。削除・並べ替え・既存位置の差し替えは禁止。古いコードと`KEYS`の対応を保つ。
- `daily_tables.rs`の`catalog_contract()`のスウォッチと、素材数を固定しているテストを更新。`peta-pass materials`から`cloudflare/peta-admin/test/materials-vector.json`を生成し、id・名前・rarity・分解レート・上限をレビュー。管理画面の選択肢はこのファイルから自動で作る。
- カタログ、描画、保存して再起動、編集、素材の消費、クーポン、PETA1の後方互換、確率表の既知素材判定・上限、管理ページ契約をテスト。375px幅とキーボード操作も確認する。

検索の出発点は`rg 'sakura|Sakura' src-tauri src/app`など既存素材の参照です。ただし素材によって実装箇所が違うため、これだけで完了とはしません。

**アプリの更新を先に配り、対応する管理ページを更新してから、Dailyで封筒に入れます。** 古いアプリは未知の素材を含む表を丸ごと拒否するため、更新が行き渡る前に配信しないでください。
