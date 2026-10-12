# サーバーの置き場所(Cloudflare)

作成日・S1 dev デプロイ日: 2026-10-12。Worker のコードは `cloudflare/peta-api/`。S1 は D1 の審判役だけを使用し、R2 binding はありません。

アカウント ID: `7ebfd4fac7f7545a9e34a963af32ae7c`(Wrangler は `npx wrangler@4.149.0`、ログイン済み)

| 用途 | 開発用(`--env dev`) | 本番用 |
|---|---|---|
| D1(台帳・友達・受信箱の索引) | `peta-dev` / `806da135-64f5-4063-8bce-0dca96d969db` | `peta-prod` / `9517d6ae-1676-4dc4-a906-462650d21586` |
| R2(暗号化した Gift) | `peta-gifts-dev` | `peta-gifts-prod` |

- どちらも場所のヒントは `apac`。
- R2 は両方にライフサイクルルール `expire-7d`(7日で削除、途中のマルチパートは1日で破棄)。
- **テストは開発用だけで行う**。審判役の台帳に本番で書いた記録は消せない前提で扱う。
- D1 の ID は秘密ではない(Worker の設定ファイルに書く)。API トークンや Webhook の URL は `wrangler secret put` で入れ、リポジトリに書かない。
- 開発用 Worker: [peta-api-dev](https://peta-api-dev.peta-api.workers.dev)。D1 `0001_ledger.sql` 適用済み。Rate Limiting binding と D1 カウンタを使用。
- 本番への migration / deploy は未実施。通報用の非公開 R2(P2)、独自ドメインは未実装。
