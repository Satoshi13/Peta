# UI review corrections

The JPG comparisons show **before / after in the real Tauri / WebKitGTK app** at 1060×700, in the same disposable library. These are the requested corrections to the initial port, so the original golden is retained as the historical reference rather than changed to approve a new design. Separate PNGs retain both native captures. The captures wait for fonts, CSS art and sticker images to finish loading.

| Screenshot feedback | Correction | Native comparison |
| --- | --- | --- |
| 1, 6 | Remove the inherited outer Common frame and the image's empty side gutters. Other rarities use their supplied paper art consistently. | [Materials](studio-materials.jpg), [actual Pack reveal](reveal-after.png) |
| 2 | Shorten the paper window-control pill from 108 to 96px and space the three original paper dots evenly. | [Settings](studio-settings.jpg) |
| 3, 5, 13 | One textured segmented-control style for Market, Window style and Erase/Restore, with identical padding, corners and selected-state treatment. | [Market](studio-market.jpg), [Settings](studio-settings.jpg), [Create](desk-create.jpg) |
| 4 | Fit the Featured text and action inside the visible card; align the pouch/fan and retain room around the paper clip. Use the page container for the narrow layout. | [Studio Market](studio-market.jpg), [Desk Market](desk-market.jpg) |
| 7 | Remove the folded corner artwork; retain the invisible native resize target and cursor. | [Desk Book](desk-book.jpg) |
| 8 | Keep selected/unselected Desk navigation on the same centre line, with no lateral shift, rotation or tape over the icon. | [Desk Book](desk-book.jpg) |
| 9 | Remove the Gifts “No daily limit” badge. Gift rules remain unchanged. | [Gifts](studio-gifts.jpg) |
| 10 | Separate the cover, fixed binding and scrolling paper. Space the original metal coils as individual loops anchored in single holes; keep content clear of the binding. | [Book](desk-book.jpg), [Book detail](desk-book-detail.jpg) |
| 11 | Wheel-zoom just the cutout illustration (100–600%), anchored at the pointer. The checker and page stay fixed; the percentage button returns to 100%. Brush coordinates/radius follow the transformed canvas; zoom never changes saved pixels. | [Native wheel zoom](zoom.jpg) |

No original art, prototype or golden image was edited. Transparent artwork is positioned/scaled in CSS. Rust rules and rendering code are unchanged in this correction.

## Verification

- Native build passed; placement JS tests: **13 passed**. Rust is unchanged from the preceding **83 passing** tests.
- [controls.json](controls.json): native mouse-wheel zoom, unchanged renderer/checker/page, Erase at the intended original-image coordinate (error < 1 image pixel), exact-pixel Undo/Redo/Restore, native reset button without a stroke, and transformed coordinates at 720×520. Also verifies the common segmented style, centred navigation, fixed Book binding/content clearance, clean seal, removed Gifts badge/corner artwork and card action inside its paper.
- [window.json](window.json): actual native drag and resize to 720×520 with the invisible corner, maximize/restore, minimize/resume, red/Esc/outside close and Sound/Reduce motion in both webviews.
- [audit.json](audit.json): all eight pages × two shells × two sizes = 32 states, **0 actionable overflow issues**. The 16 raw known false positives are the unchanged paper-button pseudo-element art.
- [details.json](details.json): actual Pack tear/pull/reveal confirms the Common label has no outer frame; native wheel capture enlarges only the illustration.

Reproduce with the debug app and disposable capture fixture described in the [parent README](../README.md): `python3 scripts/port-review.py before` on the preceding commit, then `python3 scripts/port-review.py after` on this revision. Run `port-verify-review.py`, `port-review-details.py` (requires an unopened Market Pack), `port-verify-window.py review-01/window.json`, and `port-audit.py 9` (save the generated audit under this folder). These commands use real IPC and native input, never a mocked bridge.
