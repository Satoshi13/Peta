# 所持数・Scraps購入・Collectionの整理

2026-10-05。review-14後の依頼を本物のLinux Tauriアプリで確認。プロトタイプと画像素材は変更していない。

- Day／Night、Studio／Desk、1060×700／最小720×520のToday・Materials・Collection・Marketを記録。`day-verification.json`／`night-verification.json`で横方向のはみ出しがないことを確認。
- Today：素材カードの片側余白を対称にし、説明ピルを撤去。Matte 0を含め実数を表示。空のStuck todayはテープ・作成CTAを置かない。
- Materials：一覧は名前・レア度・所持数のみ。選択プレビューには説明を残し、発見日は撤去。Dismantleを所持数の下に置く。
- Creators：Nightでも背景は暗い共通の面色、名前・説明はそれぞれink／muted。灰色背景との低コントラストを解消。
- Collection：ListのToday’s slotを撤去。ページ名・サイドバー・関連通知を統一。ロゴは64×28から72×32へ。
- `flow-verification.json`：隔離fixtureにHolographic5枚を用意し、画面から分解→15 Scraps→Pixel Dream購入12 Scraps→6枚取得→同じ要求を再送して残高3・6枚を保持→実際に1枚開封して5枚に。全素材0のCreateでは入力UIを表示せずMarketへの導線を確認。

主な比較はreview-14の同じshell／幅／pageの画像と並べて見る。変更した要素以外の開封・Create・Collection詳細・サイドバー下端は維持する。Mac固有の透過・同時起動・配布bundleは実機チェックリストに残す。

## 両版の検証

`production-verification.json`でMatte1枚を実際にMakeし、在庫0・Collectionへの1枚追加を確認。0枚の新規Create、Next Day、Re-syncの直呼びは通常版で拒否され、Developer設定欄も出ない。

`developer-verification.json`では同じXDGルートで両版を同時起動。Developerは実在庫0でCreate、残高0でPixel Dreamを取得、Holographicの分解で6 Scraps獲得、Welcomeを同日2回開封、枯渇後の12枚再補充、封筒2回、日送り、手動ディスプレイ再構成が成功。PetaのMatte0・Scraps3・Day設定は変化せず、両DBはv8、Developerの開封済み履歴も残る。

`developer-studio-1060-settings-tools.png`は実際のDeveloper専用操作欄。`final-night-studio-720-preview.png`は所持数下のDismantleと、NightのCloseボタンの最終配色。

最終検査: `npm test` 39件、`cargo test --workspace` 120件、`cargo test --workspace --features developer` 121件を通過。通常版／Developerの`npm run check:mac`相当のaarch64-apple-darwin型検査も通過した。C／Objective-C依存のビルド補助stubを使ったLinux検査で、Macのリンク・bundle署名・実機確認は含まない。
