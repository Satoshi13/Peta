# Codex への依頼: 公式パックの仕上げ(袋の隙間と、dev での通し確認)

**使い方**: この文書の全文を Codex に渡す。**Mac の上で作業する**(Peta Developer を動かし、オーナーの wrangler ログインで dev の D1/R2 を触るため。クラウドではできない)。Step ごとにコミットし、最後に `codex/ui-fixes-oct07` へ push する。

> 日本語で指示。コード中のコメントと UI の文言は既存に合わせて英語。報告は日本語。

## 先に読む

`docs/codex-official-packs-prompt.md`、`docs/official-packs-report.md`、`docs/official-packs-howto.md`、`scripts/sign-pack.sh`、`src/app/js/{market,packs,catalog}.js` と `src/app/css/` の袋と吊り下げの部分。

## 守ること

- 作業ツリーにオーナーの未コミットの変更がある(`git status`。`creator.rs`・`ceremony.js`・`create.js`・`market.js`・`tests/create-picker.test.mjs` など)。**触らない。自分が変えたファイルだけを `git add` し、コミットの前に `git diff --cached --name-only` で確かめる**。`market.js` を直す必要があれば、オーナーの変更を消さずにその上に足す。
- **本番(prod)には一切触れない**(デプロイ・D1・R2・秘密)。dev の D1/R2 と `peta-api` dev・`peta-admin` dev のデプロイはしてよい。
- 署名は dev の**公開済みテスト鍵 k1** だけ(`docs/official-packs-howto.md` の dev の手順)。本物の鍵は作らない・探さない。

---

# Step 1: 保護紙(グラシン)の袋の吊り下げの隙間

- Market で、グラシンの袋だけ、クリップと袋の上端の間に小さな隙間が空く(`docs/official-packs-report.md` の Step 2 の追記)。ほかの袋(kraft・matte・holo・色つき)と同じように、クリップが袋の上端をつまんで見えるように直す。
- 原因(袋の絵の余白、`PackArt.shelf` の配置、`.mk-hang` の位置など)を特定し、**グラシンだけ**に効く最小の直しにする。ほかの袋の見え方を変えない。
- 確認: 既存の画面確認のスクリプト(`scripts/check-*.mjs` の Market 用、なければ同じ作りで)で、グラシン・kraft・色つき(Rose)の袋をスクリーンショットし、直す前と後を報告に貼る。夜のテーマと幅の狭い画面も。

# Step 2: dev での通し確認(公式パック Step 6)

dev の管理ページは Access が空で 403 のまま。**Access は設定しない**。代わりに次のどちらかで、管理ページの下書きと掲載の処理を**実際の Worker のコード**で通す:

- `wrangler dev`(`peta-admin`、dev の D1/R2 につなぐ `--remote`)を手元で動かし、テストと同じやり方の JWT(公開済みの手順・テスト用の鍵)で Packs の API を呼ぶ。テスト用の認証を本番のコードに足さない(既存のテストの差し替えの仕組みを使う)。
- それが難しければ、管理ページのテストの関数を使うスクリプトで下書きの行と R2 の絵を用意する。

流れ:

1. 3〜5 枚の透過 PNG(既存の `src/art/samples/` から)で、dev に下書きを作り「Ready to sign」にする。
2. `bash scripts/sign-pack.sh <draftId> dev`(テスト鍵 k1)。手元のプレビューが開き、`y` で署名・アップロードされる。
3. 掲載: 期間を「今から1日」にする。
4. Peta Developer(`npm run dev:developer`)を起動し、設定の取得(起動時)で一覧とファイルが届き、Market に新しいパックが並ぶこと。値段・紹介文・袋と色・Featured(ショップの設定で選んだ場合)を確かめる。
5. Scraps で買う → 棚に封をした1セットが入る → 開ける(破る・はがす・判子)→ Stick it / Keep。
6. 重み: 重みを偏らせた下書き(例: 1枚だけ weight 100、ほかは 1)を別の版で作り、何回か開けて偏ることを確かめる(Developer の道具で Scraps を足してよい)。
7. 期間を終わらせる(掲載の終了を過去に)→ 次の取得(Developer の道具で間隔を待たずに取得できなければ、アプリを開き直す)で Market から消え、**棚の残りは開けられる**こと。
8. 画面が6時間ごとに無駄に読み直されないこと(一覧が変わらない取得では `today` の再描画が起きない)。
9. 終わったら dev の D1/R2 から試しのパックと下書きを消す(片付けの手順で)。

各段階のスクリーンショットを報告に貼る。うまくいかなかったところは、直せる小さなものは直し(テストを足す)、大きなものは報告だけ。

# 報告

`docs/official-packs-report.md` に「Mac での仕上げ」として追記: Step 1 の原因と直し(前後の画像)、Step 2 の各段階の結果と画像、見つけて直したもの、残ったもの。テスト(§8 の全部)の結果と、ディスクの空き。終わったら `npm run clean:target`。要点だけ返事する。

# テスト

```bash
cd cloudflare/peta-api && npm test && npx tsc --noEmit
cd cloudflare/peta-admin && npm test && npx tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml --workspace --features server
cargo test --manifest-path src-tauri/Cargo.toml --workspace
npm test
```
