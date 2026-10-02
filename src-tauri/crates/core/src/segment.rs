//! Subject segmentation (background removal) with an ONNX salient-object model, run by `tract`
//! (pure Rust: no native runtime to ship, same code on macOS and Windows).
//!
//! Models are the U²-Net family as exported by the rembg project (Apache-2.0):
//! `u2netp` (4.5 MB, bundled), `silueta` (44 MB, better thin parts), `isnet-general-use` (178 MB).

use std::io::Cursor;

use image::{imageops::FilterType, GrayImage, ImageBuffer, Luma, RgbaImage};
use tract_onnx::prelude::*;

use crate::error::{Error, Result};

#[derive(Clone, Copy, Debug)]
pub struct ModelSpec {
    pub name: &'static str,
    /// The network takes a square `size` x `size` input.
    pub size: u32,
    pub mean: [f32; 3],
    pub std: [f32; 3],
}

const IMAGENET_MEAN: [f32; 3] = [0.485, 0.456, 0.406];

pub const U2NETP: ModelSpec = ModelSpec { name: "u2netp", size: 320, mean: IMAGENET_MEAN, std: [0.229, 0.224, 0.225] };
pub const SILUETA: ModelSpec = ModelSpec { name: "silueta", size: 320, mean: IMAGENET_MEAN, std: [0.229, 0.224, 0.225] };
pub const ISNET: ModelSpec = ModelSpec { name: "isnet-general-use", size: 1024, mean: IMAGENET_MEAN, std: [1.0, 1.0, 1.0] };

/// The specs we know how to run, best first. `file_stem` is the `.onnx` file name without extension.
pub const KNOWN_MODELS: [ModelSpec; 3] = [ISNET, SILUETA, U2NETP];

type Plan = std::sync::Arc<TypedSimplePlan>;

pub struct Segmenter {
    spec: ModelSpec,
    model: Plan,
}

fn model_err<E: std::fmt::Display>(e: E) -> Error {
    Error::Model(e.to_string())
}

/// tract multiplies matrices on one thread unless told otherwise. Spread the work over the CPU cores.
fn use_all_cores() {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let n = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
        if n > 1 {
            tract_linalg::multithread::set_default_executor(tract_linalg::multithread::Executor::multithread(n));
        }
    });
}

impl Segmenter {
    pub fn from_onnx_bytes(bytes: &[u8], spec: ModelSpec) -> Result<Self> {
        use_all_cores();
        let s = spec.size as usize;
        let model = tract_onnx::onnx()
            .model_for_read(&mut Cursor::new(bytes))
            .map_err(model_err)?
            .with_input_fact(0, f32::fact([1, 3, s, s]).into())
            .map_err(model_err)?
            .into_optimized()
            .map_err(model_err)?
            .into_runnable()
            .map_err(model_err)?;
        Ok(Segmenter { spec, model })
    }

    pub fn name(&self) -> &'static str {
        self.spec.name
    }

    /// Foreground probability for every pixel of `img` (255 = surely subject), at the size of `img`.
    pub fn matte(&self, img: &RgbaImage) -> Result<GrayImage> {
        let s = self.spec.size;
        // Composite over white first: transparent pixels carry arbitrary RGB.
        let mut rgb = image::RgbImage::new(img.width(), img.height());
        for (x, y, p) in img.enumerate_pixels() {
            let a = p.0[3] as f32 / 255.0;
            let c = |v: u8| (v as f32 * a + 255.0 * (1.0 - a)).round() as u8;
            rgb.put_pixel(x, y, image::Rgb([c(p.0[0]), c(p.0[1]), c(p.0[2])]));
        }
        let small = image::imageops::resize(&rgb, s, s, FilterType::Lanczos3);

        // Same preprocessing as rembg: divide by the max value, then ImageNet normalisation.
        let max = small.as_raw().iter().copied().max().unwrap_or(1).max(1) as f32;
        let n = (s * s) as usize;
        let mut data = vec![0f32; 3 * n];
        for (i, p) in small.pixels().enumerate() {
            for c in 0..3 {
                data[c * n + i] = (p.0[c] as f32 / max - self.spec.mean[c]) / self.spec.std[c];
            }
        }
        let input: Tensor = tract_ndarray::Array4::from_shape_vec((1, 3, s as usize, s as usize), data)
            .map_err(model_err)?
            .into();
        let outputs = self.model.run(tvec!(input.into())).map_err(model_err)?;
        let out = outputs[0].to_plain_array_view::<f32>().map_err(model_err)?;
        let flat: Vec<f32> = out.iter().copied().collect();
        if flat.len() != n {
            return Err(Error::Model(format!("unexpected output size {} (wanted {n})", flat.len())));
        }

        let (lo, hi) = flat.iter().fold((f32::MAX, f32::MIN), |(lo, hi), v| (lo.min(*v), hi.max(*v)));
        let range = (hi - lo).max(1e-6);
        let mut mask: GrayImage = ImageBuffer::new(s, s);
        for (i, v) in flat.iter().enumerate() {
            mask.put_pixel((i as u32) % s, (i as u32) / s, Luma([(((v - lo) / range) * 255.0).round() as u8]));
        }
        Ok(image::imageops::resize(&mask, img.width(), img.height(), FilterType::Lanczos3))
    }
}
