# サーバーの置き場所(Cloudflare)

作成日・S1 dev デプロイ日: 2026-10-12。Worker のコードは `cloudflare/peta-api/`。S1 は D1 の審判役だけを使用し、R2 binding はありません。

アカウント ID: `7ebfd4fac7f7545a9e34a963af32ae7c`(Wrangler は `npx wrangler@4.149.0`、ログイン済み)

| 用途 | 開発用(`--env dev`) | 本番用 |
|---|---|---|
| D1(台帳・友達・受信箱の索引) | `peta-dev` / `806da135-64f5-4063-8bce-0dca96d969db` | `peta-prod` / `9517d6ae-1676-4dc4-a906-462650d21586` |
| R2(暗号化した Gift) | `peta-gifts-dev` | `peta-gifts-prod` |
| R2(通報、非公開。S2) | `peta-reports-dev`(作成済み 2026-10-13) | `peta-reports-prod`(作成済み 2026-10-14、非公開) |
| R2(友達の Market の暗号文、非公開。S3) | `peta-market-dev`(作成済み 2026-10-13。ライフサイクルなし) | `peta-market-prod`(作成済み 2026-10-14、非公開。ライフサイクルなし) |

- どちらも場所のヒントは `apac`。
- Gift の R2 は両方にライフサイクルルール `expire-7d`(7日で削除、途中のマルチパートは1日で破棄)。Market の R2 にはライフサイクルを付けない(出品をやめたときに Worker が消す)。
- **テストは開発用だけで行う**。審判役の台帳に本番で書いた記録は消せない前提で扱う。
- D1 の ID は秘密ではない(Worker の設定ファイルに書く)。API トークンや Webhook の URL は `wrangler secret put` で入れ、リポジトリに書かない。
- 開発用 Worker: [peta-api-dev](https://peta-api-dev.peta-api.workers.dev)。D1 `0001_ledger.sql` 適用済み。Rate Limiting binding と D1 カウンタを使用。
- 開発用には `0002_inbox.sql`・`0003_market.sql`・`0004_reports.sql` も適用済み。
- **本番(2026-10-14、オーナーが実行)**: `peta-prod` に `0001`〜`0004` を適用、`peta-api-prod` をデプロイ([peta-api-prod](https://peta-api-prod.peta-api.workers.dev)、Version ID `47b22798-ba28-4a22-aee4-b1d6091697fe`、`/v1/health` 200)。Cron `15 3 * * *`(対応済みから30日の通報を削除)。`REPORT_WEBHOOK` は 2026-10-14 にオーナーの新しい Discord Webhook へ差し替え済み(値はリポジトリに書かない)。Cloudflare の使用量の通知は未設定(オーナー)。独自ドメインは未実装で、ベータ版(`npm run build:beta`)はこの workers.dev の住所につなぐ。
