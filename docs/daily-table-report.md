# 毎日の素材表：実装・確認結果

2026-10-16。通常表・期間限定イベント・署名・アプリ取得・管理画面を実装しました。本番のデプロイ・秘密登録は行っていません。

## 実装

- PETAEVNTに`daily_table`を追加。クーポン鍵はbundle／daily_tableだけを信用し、公式鍵の配列・PETA1の素材番号・既存DB表の意味は維持。
- `tableKind`を署名済みpayloadへ追加。通常表とイベントの優先順位を、未署名のサーバー情報に依存せず判定。
- Matte最低20%、Special／Archiveそれぞれ最大5%、既知で重複しない1〜20素材、重み1〜1000。範囲外は丸ごと不採用。保存済みの日・初日Holographicを維持。
- 通常表1件＋イベント最大10件を署名付きのままmetaへ保存し、読み出し時も検証。応答全体が正常な場合にだけ入れ替える。失敗時は前の有効な保存分を維持し、正常な空応答で解除。
- server版は友達が0人でも起動・前面化で6時間ごとに確認。offlineの抽選は保存表を参照しない。追加封筒の既存抽選は変更なし。
- 管理ページDailyに素材・スウォッチ・割合・上限理由・週間期待枚数とScraps・イベント日時と停止。日時は端末時間帯→UTC。通常表を固定へ戻せる。
- D1は`0008_daily_tables.sql`のみを追加。既存表の意味を変更せず、1年経過の終了・停止行を削除。

## 実際に通した確認

- 指定の全チェック：API／download／adminのテストと型確認、Rust workspace server／offline、developer official_trust、root npm、release手順。
- 統合時点：API 73件、download 9件、admin 27件、Rust server 304件（既存のlive 3件はignore）、offline 293件、official_trust 2件、UI 237件。
- 同じ署名済みキャッシュを置いたDBで、offlineは固定抽選・server相当は配信表を使う統合テストを両feature構成で実行。
- RustとWorkerの署名バイト一致・素材一覧／rarity／分解レート／上限の契約一致。
- 上限の境界、未知素材・重複・異常値、開始を含む／終了を含まない期間、重複イベント、初日固定、既存の日の不変性、受領記録を作らないこと、失敗時の保存維持。
- 管理APIのオーナー限定、署名とD1のID／種別／日時一致、上限で書き込み拒否、通常表の入れ替え、予定10件の上限、停止。
- 隔離ブラウザで保存・割合・制約・期待値・375px幅を確認（`scripts/check-daily-admin.mjs`）。スクリーンショットは`/tmp/peta-daily-admin/`。
- devへ署名付きGETを実送信し、`/v1/daily-table`の200・空tablesを確認。

Peta Developerの「次の日にする」の実操作は行わず、依頼文が許容する偽応答・署名契約・日次記録のテストで代替しました。dev管理ページは既存のAccess・オーナー設定が空で403のため、devで実際のオーナー発行を操作するには設定が必要です。実在の友達の表は変更していません。

## dev反映

- D1 `peta-dev`へ0008適用済み。更新APIの0009が先に適用済みでしたが、Wranglerは未適用0008を正常に検出・適用し、両表が有効です。
- peta-api-devを反映済み（2026-10-16、`4207e444-551f-42a6-9d6a-69f6d52c8432`時点）。
- peta-admin-dev／peta-download-devも更新。adminの最終版は`4ecc622d-e021-4b45-93ee-683ddfc7b090`、downloadは`7a837a7c-4454-4e42-8923-b095af24f5c2`。Accessや秘密の登録は変更していません。

## オーナーが配布日に行うこと

1. prodのD1へ0008と0009を順に適用。
2. c2を信用する対応アプリを配る。新しい素材を将来追加する場合も、アプリ更新を先に配る。
3. peta-admin prodとpeta-download prodを再デプロイ。
4. **peta-api prodは招待必須化などとまとめて、配布日にオーナーの指示で再デプロイ。今回実施していません。**
5. オーナーの画面で通常表・イベントを確認してから発行。停止しても、オフラインのMacは次の正常な確認か署名期限まで古い検証済み表を使う点を理解して運用。

操作は[daily-table-howto.md](daily-table-howto.md)、新しい紙の実装は[new-material-howto.md](new-material-howto.md)。
