# Segmentation models

`u2netp.onnx` (4.5 MB) is bundled with the app (`include_bytes!`) so cutting out works offline.

- Model: **U²-Net-P** ("u2netp"), Qin et al., *U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection*,
  Pattern Recognition 2020. Code and weights: <https://github.com/xuebinqin/U-2-Net> — **Apache License 2.0**.
- ONNX export: the [rembg](https://github.com/danielgatis/rembg) project's release asset
  `https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx` (rembg is MIT licensed).
- SHA-256: `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`

## Bigger models (optional)

Put the `.onnx` next to it (dev: this folder; installed app: `<app data>/models/`) and start Peta with
`PETA_MODEL=<name>`. They cut thin parts (raised arms, whiskers) better but run several times slower in
pure-Rust inference (tract), which is why the small model is the default.

| name | file | size | SHA-256 | measured here (4 cores) |
|---|---|---|---|---|
| `u2netp` (default, bundled) | `u2netp.onnx` | 4.5 MB | `309c8469…ddd8` | ~1.4 s |
| `silueta` | `silueta.onnx` | 44 MB | `75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb` | ~7 s |
| `isnet-general-use` | `isnet-general-use.onnx` | 178 MB | `60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a` | slower still |

Download URLs: `https://github.com/danielgatis/rembg/releases/download/v0.0.0/<file>`.
