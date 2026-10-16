# 毎日の封筒の素材を変える

管理ページの **Daily** で、アプリに入っている素材を封筒に入れる・外す、重みを変える、期間限定の表を予約できます。新しい紙の描画自体を追加する画面ではありません。

## 通常の表

チェックした素材だけが候補です。重みは1〜1000の整数、1〜20種類、同じ素材は1回。右の割合が実際の確率です。Matteは20%以上、Special・Archiveは**素材ごと**に5%以下。理由が赤く出ている間は保存できず、アプリも同じ制約を検証します。

Save normal tableで通常の表を入れ替えます。Return to the built-in tableは通常表を停止します。固定の表はMatte 60%・Kraft 30%・Holographic 10%。最初の封筒は常にHolographicです。

## イベント

名前、開始・終了日時、同じ素材表を入力してSchedule event。日時は操作端末の時間帯で入力し、UTCの秒として保存・署名します。開始を含み、終了を含みません。開催中・予定は合計10件まで。重複中は開始が遅いイベントを優先し、同時刻なら発行時刻・IDの順で一意に決まります。終了後は通常の表、通常表もなければ固定表へ戻ります。Stopで配信を止めます。

## いつ反映されるか

起動時とウィンドウを前に出したとき、前回の試行から6時間以上なら確認します。友達が未登録でも確認します。**その日すでに決まった素材は変わりません**。翌日以降、その日が初めて保存される瞬間に有効な表を選びます。追加封筒の従来の抽選は今回変更していません。

通信失敗時は期限内の検証済み保存分を使います。初回取得前・有効な保存分がない場合と、通信しない版は固定表です。停止は次の正常な確認後に効きます。オフラインのMacに対して即時停止する仕組みではありません。通常表の署名は公開から400日で失効します。

## 経済の見込み

Expected in one weekは「同じ表で7日間、毎日1通」を仮定した素材の期待枚数です。抽選結果を保証しません。その下は7枚すべてを分解した場合のScrapsの期待値です。素材のレートを変更する機能ではありません。初日固定や期間の途中の切り替えはこの単純な見込みに含みません。

## 署名と契約

`daily_table`はクーポン鍵c1（dev）／c2（prod）で署名したPETAEVNTです。公式k鍵も利用可能。鍵の番号や既存形式を変更しません。通常／イベントの区別も署名するため、payloadには`tableId`・`tableKind`（`default`／`event`）・`items`を含めます。受信箱や受領済みイベントには入りません。

素材一覧・上限・分解レートは`cloudflare/peta-admin/test/materials-vector.json`。Rustとの一致をテストします。更新は次のコマンドで生成し、差分を確認してから管理ページを再デプロイします。

```sh
cargo run --manifest-path src-tauri/Cargo.toml -p peta-pass -- materials > cloudflare/peta-admin/test/materials-vector.json
```

手元の公式鍵で作る場合（秘密鍵は暗号化ディスク上のファイルを指定）:

```sh
peta-pass event --kind daily_table --table-kind event --id autumn-supply \
  --not-before 2026-10-20T00:00:00+09:00 --not-after 2026-11-01T00:00:00+09:00 \
  --item matte=50 --item kraft=25 --item holographic=15 --item riso=10 \
  --key-id k2 --key /Volumes/Peta-private/official.key --out autumn.peta
```

このファイルを通常の配布としてアプリへ読み込ませることはできません。専用の取得処理が検証して保存します。PETA1の短いコードにはしません。

## devと本番

devのD1へ`0008_daily_tables.sql`、devのAPIと管理ページを反映済みです。dev管理ページは既存のAccess・オーナー設定が空なので、その設定をオーナーが済ませるまで403を返します。秘密の登録や本番の再デプロイは今回していません。

devではc1を信用するDeveloper版で、確認後「次の日にする」を使います。実際に端末を操作できない場合は、署名契約・抽選・保存済みの日の不変性のテストで代替できます。DeveloperのSettingsには最終確認日時と表の検証失敗理由も表示します。

本番は配布日にオーナーがD1の0008〜0010を適用し([release-day-runbook.md](release-day-runbook.md))、管理ページとダウンロードページを更新し、**peta-api prodを他の招待必須化とまとめて**更新します。詳しくは[daily-table-report.md](daily-table-report.md)。新しい素材を追加する場合は[new-material-howto.md](new-material-howto.md)。
