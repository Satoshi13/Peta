# 見本ステッカーのリスタイル仕様(質感のあるイラスト案)

2026-10-02 決定。Stage 2 で納品された見本ステッカー12枚は、**4色以内のフラットなベクター調**だった。
オーナーが好きな参考画像(`docs/art-reference/style-target-stickers.jpg`)は**質感のあるペイント調のイラスト**で、フラットな見本はそれより平らで「グラフィック寄り」。
そこで**見本ステッカーの絵柄を、質感のあるイラスト案に作り直す**。紙・封筒など他の素材は既に質感があるので、見本だけが浮いていた状態を解消する。

> この仕様は `docs/codex-art-prompt.md` §8.7(見本ステッカー)の絵柄指定を**置き換える**(§8.7 の「4色まで」「フラットなベクター風」は無効)。
> それ以外(寸法・透過・余白・白フチを付けない・文字列の正確さ・原本を Git に入れない・コミットは小さく)は従来どおり。

---

## 1. 目指す絵(参考画像の読み取り)

参考画像 `docs/art-reference/style-target-stickers.jpg`:

- **上段(PC に貼られたステッカー)**: 猫+スケボー / 目玉焼き / GOOD DAY / ポラロイドの山 / 青い花 / レトロPC / コーヒー / Peta / ホログラムの一筆線。
  ペイント調で、**やわらかい陰影・筆のあと・紙の粒・インクのかすれ**がある。線は太い黒ではなく、面と色で形を作る。1枚ごとに「物としての立体感」が少しある。
- **下段(Tokyo Pack の中身)**: 手描きのインク線+水彩のスケッチ調(カメラ・建物)。素朴で温かい。→ これは**今回の対象外**(将来の Creator Pack 見本。Stage 3 で扱う)。

名前を付けるなら: **「ラップトップステッカー系 × レトロ雑貨(90〜2000年代の文具店)× ペイント調イラスト」**。かわいいが大人っぽく、少し不完全で手作り感がある。

## 2. 変えるもの / 変えないもの

| | 内容 |
|---|---|
| **変える** | 見本12枚の絵柄(下の §4・§5) |
| **一緒に直す** | ① `onboarding/hero.png`(新しい見本で組み直す。監査の指摘も反映)② `book/cover-kraft.png` の青い花ステッカー ③ 紙テクスチャ `back/paper-cream.jpg` `back/paper-kraft.jpg`(監査の指摘:ほぼベタ塗り) ④ 見本を含むその他の素材(`manifest.json` を `cat-skateboard` `fried-egg` `blue-flower` `good-day` で検索して洗い出す)⑤ `docs/art-stage2/*.jpg`(一覧ボード)と `preview.html` |
| **変えない** | 寸法(長辺1024px・周囲8pxの透明余白)、ファイル名、被写体(12題材)、白フチ・接地影・背景を**付けない**こと(アプリが素材ごとに付ける)、`data-art`・ID、Rust/JS/HTML/CSS |
| **対象外** | Stage 3(Pack・Market 等)。Pack 内の手描きインク+水彩の見本は、その Stage で別途 |

## 3. 決定の背景(迷ったときの判断基準)

- 見本は「そのままアプリのライブラリに入れる」Welcome Pack(Phase 6)。**初めて開いたとき最初に目にする絵**で、アプリの印象を決める。
- Peta の世界観は「紙・クラフト・ホログラム・手作りの文具」。見本だけ平らなベクターだと、封筒や台紙の質感と並んだとき**別の製品に見える**。
- 一方で**フォトリアルや3Dレンダーには寄せない**(NG 2)。「ペイントされたイラスト」で止める。

## 4. 絵の仕様(STYLE-sample)

STYLE-lite(フラット・4色)の**代わり**に使う。

```
STYLE-sample — Peta welcome sticker illustration.
A single sticker-ready illustration painted in a soft, semi-realistic gouache / digital-paint style: gentle volume shading, soft highlights, subtle visible brush strokes, fine paper grain, tiny ink wear where it suits (worn ink speckle on lettering). Warm natural colours, slightly desaturated and harmonised: cream, kraft brown, dusty blue, sage green, brick red, butter yellow, graphite. Light from the upper left; shading falls to the lower right, soft and low-contrast.
Think of the charming illustrated stickers people put on laptops: cute but grown-up, a little nostalgic (late-90s / early-2000s stationery-shop warmth), slightly imperfect and hand-made. Calm, restrained, premium indie-Mac-app taste. Not kawaii overload.
The subject is isolated on a fully transparent background, tightly cropped with an 8 px transparent margin, long edge 1024 px.
NO white die-cut border, NO ground shadow, NO background, NO sticker backing sheet.
Lines: no heavy black outline. Define edges with colour and soft value change; use a thin darker-tone line only where the subject needs it.
```

NEGATIVE(末尾に付ける):

```
Avoid: flat vector art, cel-shading, posterised colour blocks, 3D render, plastic gloss, photograph, photorealistic, neon or fluorescent colours, harsh black outlines, heavy drop shadow, white die-cut border, background, hands, desk, people, real brands, logos, extra text, gibberish text, watermark, signature, grunge, dirt.
```

### ルール

- **色数の制限はなくす**。ただし彩度は抑えめ(蛍光・ネオン禁止)。12枚を並べたときの彩度・コントラストが揃うこと。
- **12枚は同じ手で描いたように**: 筆致の細かさ・陰影の強さ・彩度・紙の粒の量を揃える。1枚だけ写真っぽい/1枚だけ平ら、は不可。
- **文字は指定の2つだけ**: `GOOD DAY` と `Peta`(綴り・字形を正確に)。他の文字・数字・ロゴ・実在ブランドは入れない(カメラ・PC・カセットのラベルは空白)。
- 被写体自身の白(カップ・ポラロイドの枠・目玉焼きの白身)は**絵柄の一部**なので OK。ただし、周囲に**フチとして白を足さない**。
- 写真の質感に寄せない: ポラロイドの中の山も「ペイントで描いた風景」にする。

## 5. 12枚の題材(各プロンプトは STYLE-sample の後に続ける)

| ファイル | 題材 |
|---|---|
| `samples/cat-skateboard.png` | `A cheerful tabby-and-cream cat riding a skateboard, one eye in a small wink, soft fluffy fur painted with visible strokes, dark teal-grey board with warm wooden wheels, slightly goofy, full body, three-quarter view.` |
| `samples/fried-egg.png` | `A sunny-side-up fried egg: glossy golden yolk with a soft window highlight, slightly crinkled white with a faint golden-brown fried edge, gentle shading.` |
| `samples/good-day.png` | `Retro comic-style lettering "GOOD DAY" in two slanted lines, muted brick-red letters (about #D8453A, slightly softened) with a thin off-white inner edge and worn ink speckle. Exactly these letters: G O O D  D A Y.` |
| `samples/blue-flower.png` | `A blue bellflower / cornflower painted with soft petal shading, a pale centre with a few yellow stamens, a small bud, a slender stem and two sage-green leaves.` |
| `samples/polaroid-mountain.png` | `An instant-photo print with a cream-white frame, wider at the bottom, very slightly tilted. The picture is a softly PAINTED landscape: a snow-capped mountain, evergreen forest, dusty blue sky. Not photographic.` |
| `samples/retro-computer.png` | `A beige all-in-one retro computer with a chunky rounded CRT case, a small soft cloud icon on the screen, a separate keyboard below, gentle plastic shading. No logo. Do not imitate the original Macintosh silhouette: make the case wider and rounder.` |
| `samples/coffee-cup.png` | `A cappuccino in a cream-white cup on a saucer, seen from a slightly raised three-quarter angle, a heart in the latte art, soft blue-grey shading on the porcelain. No steam, no text.` |
| `samples/peta-bubble.png` | `Plump bubble lettering "Peta" in dusty blue with a soft inner highlight and a butter-yellow offset outline. Exactly the spelling: P e t a.` |
| `samples/purple-scribble.png` | `A bold one-stroke marker line in soft lilac-purple, flowing into one or two loops, subtle pearly sheen, slightly textured marker edge. An abstract line: it must NOT read as letters.` |
| `samples/film-camera.png` | `A retro 35 mm rangefinder camera: cream body with tan leatherette, a lens with a soft glass reflection, small dials. No brand name, no readable text.` |
| `samples/potted-plant.png` | `A monstera in a terracotta pot, leaves painted with soft veins and light-to-dark shading, a hint of glaze highlight on the pot.` |
| `samples/cassette-tape.png` | `A compact cassette tape: tan shell, a blank cream label with a pale blue stripe, two reels, small screws, slightly worn edges. The label has no text.` |

## 6. 作り方(手順)

1. 題材ごとに**候補を4枚**生成し、**参考画像に最も近く、質感が静かなもの**を選ぶ。迷ったら静かな方。
2. 12枚が出そろったら**1枚の一覧に並べて**(クリーム・暗い面・壁紙色の3背景)、**統一感のチェック**をしてから確定する。浮く1枚は作り直す。
3. **フチ合成テスト**(必須): アプリが素材のフチを付けるのと同じ要領で、各枚に白フチ(長辺の約3.5%)+薄い影を合成し、**穴・ギザギザ・かけら・ハロー**が出ないことを確認する。
4. 見本を使う素材(hero / cover-kraft / ボード)を、**既存の制作スクリプト**(`scripts/art-build-stage1.py` `scripts/art-build-stage2.py`)の入力だけ差し替えて作り直す。スクリプトに「4色に落とす」処理(`flat` / `flat_colours`)があれば、**見本には使わない**。
5. `scripts/art-check.py` の見本向けの検査を更新する(§7)。`npm test` と `git diff --check` も通す。
6. 原本は `assets-src/art/` に置く(Git 外)。**原本・候補グリッドをコミットしない**。

### hero(`onboarding/hero.png`)の構図

監査の指摘(四隅に離れて散らばっていない)を直す:
- **5枚**(猫スケボー・目玉焼き・青い花・GOOD DAY + もう1枚(ポラロイドかコーヒー))。
- 傾き ±10°、**一部は重なってよい**(重なりは各枚の面積の15%まで)。中央の余白(`labelRect`)は維持する。
- 紙の端に**ごく薄い影か破れ縁**を付け、「紙の上に貼った」感じを出す。

### 紙テクスチャ(`back/paper-*.jpg`)

監査の指摘(明度の標準偏差 0.52 でほぼ平ら)を直す: **標準偏差 3〜6** を目安に、繊維・粒・ごく薄い雲ムラを足す。継ぎ目なし(1024)・平均色(クリーム #F5F0E6 / クラフト #C9A878)は維持。クラフトは `arrival-material.png` の質感と並べて違和感がないこと。

## 7. 検査ルールの更新

| 項目 | 変更 |
|---|---|
| 見本の「4色以内」検査 | **廃止**(手動で `art-check.py` の `4-colour samples` 関連を外す) |
| 代わりの検査 | ① 彩度の上限(画素の99パーセンタイルの HSV 彩度 ≤ 0.90。蛍光防止)② 不透明面の alpha 255 と縁の AA は従来どおり ③ **フチ合成テスト**(穴・かけらなし) |
| 容量 | 見本は **1枚 900KB 以下**(ペイント調は PNG が重くなるため。従来 600KB)。全体予算は従来どおり。JPEG テクスチャは 500KB 以下のまま |
| 周囲の余白 | 8px の透明余白は維持 |

## 8. 受け入れチェックリスト(Codex の自己点検)

- [ ] 参考画像と見本12枚を**並べて**比較した(質感・陰影・色・線・手作り感)。フラットなベクターに見える枚が無い。
- [ ] 12枚の**統一感**がある(筆致・彩度・陰影の強さ)。
- [ ] 暗い背景・明るい背景・壁紙色で、縁のハロー・白縁・茶色のにじみが無い。
- [ ] `GOOD DAY` と `Peta` の字形が正確。それ以外に文字・数字・ロゴが無い。
- [ ] レトロPCが初代 Macintosh に似すぎていない(ロゴなし、角丸で幅広)。
- [ ] フチ合成テストで穴・ギザギザ・かけらが出ない。
- [ ] hero は5枚・重なり・傾き・中央の余白。紙テクスチャは目で見える繊維・ムラがある(標準偏差 3〜6)。
- [ ] cover-kraft の花ステッカーが新しい絵になっている。
- [ ] 見本を含む他の素材(manifest 検索で洗い出した分)も差し替わっている。
- [ ] `art-check.py` / `npm test` / `git diff --check` が通る。`manifest.json` / `preview.html` / 一覧ボードを更新。
- [ ] 原本・候補グリッドは Git に入っていない。
- [ ] 報告書(`docs/art-restyle-report.md`)に、**差し替えた素材の一覧と、直せなかった点**を書いた。

## 9. コミット

`art: restyle samples — painterly illustration` として、1つか2つのコミットにまとめて push する。
