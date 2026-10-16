# scripts

リポジトリのルートから実行します（例: `python3 scripts/test-harness.py`）。

## 確認（CI でも実行）

| スクリプト | 内容 |
|---|---|
| `test-harness.py` | `tests/*.rs` の Rust ハーネスをすべて実行（`npm run test:harness`） |
| `check-arrival-threading.py` / `check-pack-rewards-runtime.py` | 上のハーネスの個別実行 |
| `check-csp.mjs` | 全ページを本番の CSP で描画し、違反がないこと |
| `check-responsive.mjs` | 480〜1440px の幅と2つの窓スタイルで、崩れ・はみ出しがないこと |
| `check-boards.mjs` / `check-ui-feedback.mjs` / `check-updater-ui.mjs` | Boards・操作のフィードバック・更新通知の画面の動き |
| `check-admin-round2.mjs` / `check-daily-admin.mjs` / `check-admin-packs.mjs` | 管理画面（cloudflare/peta-admin）の画面 |
| `test-sign-pack.py` | `sign-pack.sh` を偽の wrangler と使い捨ての鍵で動かす |
| `ui-fixes-oct07-fixture.js` | 上の画面チェックが共有する偽の Tauri IPC（ユーザーデータに触れない） |

画面のチェックは Playwright が必要です。`PETA_PLAYWRIGHT_MODULE`（Playwright の `index.mjs`）と `PETA_BROWSER`（Chromium の実行ファイル）で、手元のものを指定できます。

## ビルドと配布（オーナーが実行）

| スクリプト | 内容 |
|---|---|
| `build-mac.py` | 配布用ビルド（`npm run build` / `build:beta` / `build:developer`） |
| `release-mac.sh` | Developer ID 署名と公証 |
| `make-dmg.sh` / `publish-release.sh` | ディスクイメージの作成と、友達限定ダウンロードページへの公開 |
| `updater-artifact.sh` / `updater-key.sh` / `prune-releases.py` | アプリ内更新の成果物・鍵・古いリリースの整理 |
| `test-release-mac.py` / `test-updater-release.py` / `test-updater-live.py` | 配布物と更新の検証（dev 環境のみ） |
| `check-binary-paths.py` | 実行ファイルに個人のパスが残っていないこと |
| `third-party-licenses.py` | `THIRD_PARTY_NOTICES` の生成（`npm run licenses`） |
| `coupon.py` / `coupon-key.sh` / `beta-invites.sh` | クーポンとベータ招待の運用 |
| `sign-pack.sh` | 管理ページで「Ready to sign」にした公式パックを、手元で確かめてから公式の鍵で署名して置く |
| `clean-target.py` | `src-tauri/target` の掃除（`npm run clean:target`） |

## 素材と経済

| スクリプト | 内容 |
|---|---|
| `art-check.py` / `art-export.py` / `art-humanize.py` / `art-restyle.py` / `art-mix-samples.py` | 描いた素材の受け入れ検査と書き出し |
| `economy-sim.mjs` | Scraps の経済シミュレーター（`docs/economy-sim.html`） |

## archive/

過去の移植・アートの各段階・UI 修正の検証で一度だけ使ったスクリプトです。記録として残していますが、現在の画面やデータ形式に合わせて更新していません。
