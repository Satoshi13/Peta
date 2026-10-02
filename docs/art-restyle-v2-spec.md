# 見本ステッカー リスタイル v2(「AIっぽさ」を減らす)

2026-10-02。`art-restyle-spec.md` で作り直した見本12枚は、質感のあるペイント調になり、ステッカーとしても成立している(検査も合格)。
ただしオーナーから **「まぁまぁしっかりAIっぽい」** との指摘。監査と後処理の実験(`docs/art-humanize/`)で次が分かった:

- 後処理(粒・色数・ハイライト圧縮)では、見た目の印象はほとんど変わらない。**原因は絵の構造そのもの**なので、**生成のやり直し(プロンプトと選び方の変更)**で直す。
- この仕様は `art-restyle-spec.md` の **STYLE-sample と §5 の題材プロンプトを置き換える**。それ以外(寸法・8px余白・白フチと影を付けない・文字は GOOD DAY / Peta だけ・検査・原本はGit外)は従来どおり。

---

## 1. 何がAIっぽいのか(現状の見本12枚の診断)

| # | 症状 | 目立つ素材 |
|---|---|---|
| 1 | **12枚すべてに同じ油絵の筆跡**がかかっている。人が描くと素材ごとに質感が変わる | 全部 |
| 2 | 描き込みすぎ。ステッカーの絵としては**情報量が多すぎる**(毛の1本ずつ、細かい反射) | `cat-skateboard` |
| 3 | **エナメルのようなツヤ**(縁を回る光、点の反射) | `good-day` `peta-bubble` `film-camera` |
| 4 | 形が整いすぎ・光が理想的すぎる(全体が同じ明るさで、手のゆらぎがない) | 全部 |
| 5 | 仕様とずれた絵: マーカーの一筆線のはずが**立体のリボン** | `purple-scribble` |
| 6 | 毛・ひげの先の縁がささくれ(ダイカットの縁としては汚い) | `cat-skateboard` |
| 7 | 実在製品に近い形(Leica M 型のレンジファインダー) | `film-camera` |

## 2. 方針: 「描き込む」から「見立てて省く」へ

AIっぽさは**描き込みの量と均一さ**から出る。ステッカー絵として、人がイラストレーターとして描く密度に落とす。

1. **情報量を減らす**: 1枚の絵に出す要素は少なく(目安: はっきり分かれた形が15個以内)。毛・葉脈・ネジなどは**代表的なものだけ**描く。
2. **陰影は2〜3段**: なめらかなグラデーションではなく、はっきりした濃淡の段で見せる(ガッシュ・スクリーン印刷のような)。
3. **素材ごとに画材を変える**(下の §4)。12枚が「同じ筆」にならないようにする。ただし**彩度・光(左上)・パレット・線の細さは共通**で、同じ棚に並べて違和感が出ないこと。
4. **わずかな非対称・手のゆらぎ**: 線や縁が少し揺れる。完全な左右対称・完全な円を避ける。
5. **ツヤを描かない**: 反射は**1か所の小さな単純な形**まで。縁取りの光(rim light)・点の反射の散らばりは禁止。
6. **縁はすっきり**: ダイカットの外形は、毛・ひげ・葉の先がささくれず、なめらかな輪郭(細いひげは**太めに**描いて残すか、省く)。

## 3. STYLE-sample v2

STYLE-sample を次に**置き換える**(各題材の画材 `{MEDIUM}` は §4 の表から入れる)。

```
STYLE-sample v2 — Peta welcome sticker illustration.
A single sticker-ready illustration as a human illustrator would draw it for a stationery brand: SIMPLE and CONFIDENT, with large clear shapes and only the details that matter. Medium: {MEDIUM}.
Shading in only 2–3 clear tone steps, not smooth airbrushed gradients. A little hand-made wobble in lines and edges; slightly asymmetric; nothing perfectly symmetrical or perfectly round. Matte finish.
Warm natural colours, slightly desaturated: cream, kraft brown, dusty blue, sage green, brick red, butter yellow, graphite. Light from the upper left, soft and low-contrast. Late-90s / early-2000s Japanese stationery-shop nostalgia: cute but grown-up, calm, restrained.
Reflections: at most ONE small simple highlight shape. No rim lighting, no sparkles, no glossy enamel look.
The subject is isolated on a fully transparent background, tightly cropped with an 8 px transparent margin, long edge 1024 px. The silhouette is clean and smooth (no fuzzy hair fringe, no frayed edges).
NO white die-cut border, NO ground shadow, NO background, NO sticker backing sheet.
```

NEGATIVE:

```
Avoid: highly detailed, hyper-detailed, intricate, 8k, photorealistic, photograph, 3D render, cinematic lighting, rim light, glossy, enamel, plastic gloss, airbrushed gradient, smooth blended shading, individual hair strands, sparkles, bokeh, symmetrical perfection, flat vector with hard black outlines, neon colours, white die-cut border, background, drop shadow, real brands, logos, extra text, gibberish text, watermark.
```

## 4. 12題材(画材は題材ごとに変える)

| ファイル | `{MEDIUM}` | 題材プロンプト(STYLE-sample v2 の後に続ける) | 状態 |
|---|---|---|---|
| `cat-skateboard` | opaque gouache with visible flat brush marks, soft chalky edges | `A cheerful tabby-and-cream cat riding a skateboard, one eye in a small wink. Fur is suggested with a few clumps and clear tabby stripes, NOT individual hairs. Simple rounded body, bold clean silhouette, dark teal board with warm wooden wheels. Goofy, charming.` | **必須** |
| `purple-scribble` | one pass of a thick felt marker, dry-brush streaks at the ends | `One flat bold marker line in soft lilac-purple that sweeps and makes a single loop. Completely FLAT: no folds, no ribbon, no 3D, no shading beyond slight marker streaks. Abstract; must not read as letters.` | **必須** |
| `good-day` | matte screen-print / offset ink, slightly worn | `Retro comic-style lettering "GOOD DAY" in two slanted lines, flat muted brick-red letters with a thin off-white inner edge, tiny ink speckle wear. MATTE ink: no enamel shine, at most one small highlight. Exactly: G O O D  D A Y.` | **必須** |
| `peta-bubble` | matte screen-print vinyl, flat colour with one soft highlight band | `Plump bubble lettering "Peta" in dusty blue with a butter-yellow offset outline. Flat colour with a single simple highlight band, no gloss. Exactly: P e t a.` | **必須** |
| `film-camera` | matte flat illustration, thin pencil linework | `A chunky, toy-like compact film camera with a rounded cream body and tan leatherette panel, a big round lens with a simple single highlight. Deliberately NOT a Leica M rangefinder: no rangefinder windows in a row, no red dot, no brand name, no readable text.` | **必須** |
| `fried-egg` | gouache, soft flat shapes | `A sunny-side-up fried egg: a round matte yolk with one simple highlight, softly crinkled white with a faint golden-brown edge. Few tones.` | 差し替え推奨 |
| `blue-flower` | watercolour wash with a little coloured-pencil edge | `A blue bellflower with a pale centre, a few yellow stamens, a small bud, a slender stem and two sage-green leaves. Petals in 2–3 tones.` | 差し替え推奨 |
| `coffee-cup` | loose watercolour wash on cream paper | `A cappuccino in a cream-white cup on a saucer, three-quarter view, a heart in the latte art. Loose blue-grey wash shading, no steam, no text.` | 差し替え推奨 |
| `polaroid-mountain` | gouache landscape inside a flat cream frame | `An instant-photo print with a cream-white frame, wider at the bottom, slightly tilted. Inside, a simplified painted landscape: a snow-capped mountain, a band of evergreens, dusty blue sky. Not photographic.` | 差し替え推奨 |
| `retro-computer` | matte plastic in flat tone steps, thin pencil linework | `A beige all-in-one retro computer with a chunky rounded CRT case, a small soft cloud on the screen, a separate keyboard below. No logo. Wide and round, not the original Macintosh silhouette.` | 差し替え推奨 |
| `potted-plant` | gouache, flat leaf shapes with a few simple vein lines | `A monstera in a terracotta pot, leaves in two greens with simple vein lines, one soft highlight on the pot.` | 差し替え推奨 |
| `cassette-tape` | matte printed illustration, flat colours | `A compact cassette tape: tan shell, a blank cream label with a pale blue stripe, two simple reels, four small screws. The label has no text.` | 差し替え推奨 |

- **必須**の5枚は作り直す。**差し替え推奨**の7枚は、4候補を出して**新旧を並べ、より単純で人が描いた感じのものを選ぶ**。旧版のほうが良ければ残してよい(その場合は報告に理由を書く)。

## 5. 選び方(ここが一番大事)

- 4候補のうち、**一番情報量が少なく、一番「人が描いた」感じのもの**を選ぶ。**一番きれいに見えるもの**は選ばない。
- 次のどれかがあれば**落とす**: エナメルのツヤ・縁の光、毛1本ずつの描き込み、完全な左右対称、縁のささくれ、立体的な反射の散らばり。
- 12枚を**50%の大きさで1列に並べ**、参考画像上段(`docs/art-reference/style-target-stickers.jpg`)と比べる。**参考の方が単純で平らに見える**なら、描き込みすぎ。
- 画材は題材ごとに違ってよいが、**並べて「同じパックの絵」に見える**こと(彩度・光・線の細さを揃える)。

## 6. 一緒に直す素材

見本が変わるので、前回と同じく**依存素材を作り直す**:
`onboarding/hero.png`、`book/cover-kraft.png`(花)、`today/choice-collection.png`(表紙の縮小)、`docs/art-stage2/*.jpg` と `docs/art-restyle/*.jpg` の一覧、`manifest.json`、`preview.html`。既存の制作スクリプトの入力だけ差し替える。

## 7. 後処理(`scripts/art-humanize.py`)の扱い

- **原則使わない**。実験(`docs/art-humanize/`)では、既定の強さで差がほとんど出ず、強くすると細部がにじんだ。
- 使うとしても強さ **0.5 まで**。使った素材は報告書に書き、使わなかった素材と**並べて**違和感がないことを確認する。

## 8. 検査(従来どおり+追加)

- 従来: alpha 255(内部)・8px余白・900KB以下・彩度99%点 0.90 以下・フチ合成テスト(連結成分1・穴0・欠け0)・`art-check.py` / `npm test` / `git diff --check`。
- 追加(目視で報告に書く):
  - [ ] 12枚を50%で並べ、参考画像と比べて**描き込みすぎ**に見える枚が無い。
  - [ ] ツヤ・縁の光・毛1本ずつの描き込みが無い。
  - [ ] `purple-scribble` が**平らなマーカーの線**で、文字にも立体のリボンにも見えない。
  - [ ] `film-camera` が Leica M 型に見えない(レンジファインダー窓の並び・赤点なし)。
  - [ ] 縁にささくれ・かけらが無い(白フチ合成後に確認)。
  - [ ] 画材が素材ごとに違い、かつ同じパックに見える。

## 9. 報告とコミット

- `docs/art-restyle-v2-report.md` に、**5枚(必須)と7枚(推奨)それぞれ、作り直したか旧版を残したか、その理由**を書く。直せなかった点も書く。
- 原本・候補グリッドは `assets-src/art/`(Git外)。コミットしない。
- コミット: `art: restyle v2 — simpler, less AI-looking samples`。
