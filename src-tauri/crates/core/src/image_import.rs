//! Image import: decode anything common, trim transparent margins, downscale to a display-friendly
//! size, re-encode as PNG. (Background removal comes in Phase 3; today only transparent PNGs look like stickers.)

use std::io::Cursor;

use image::{imageops::FilterType, ImageFormat, RgbaImage};

use crate::error::{Error, Result};

/// Longer edge of the rendered asset. Plenty for a sticker shown at ~20% of a 5K display.
pub const MAX_EDGE: u32 = 1024;

/// Pixels with alpha at or below this count as empty when trimming.
const TRIM_ALPHA: u8 = 8;

pub struct Processed {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// Extension for storing the untouched original ("png", "jpg", "webp").
    pub original_ext: &'static str,
}

impl Processed {
    pub fn aspect(&self) -> f64 {
        self.width as f64 / self.height as f64
    }
}

pub fn process_image(bytes: &[u8]) -> Result<Processed> {
    let format = image::guess_format(bytes).map_err(|_| Error::Image("not a supported image file".into()))?;
    let original_ext = match format {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpg",
        ImageFormat::WebP => "webp",
        _ => return Err(Error::Image("only PNG, JPEG and WebP are supported".into())),
    };
    let mut img = image::load_from_memory_with_format(bytes, format)?.to_rgba8();

    let (x0, y0, x1, y1) = opaque_bounds(&img).ok_or_else(|| Error::Image("the image is fully transparent".into()))?;
    if (x0, y0, x1, y1) != (0, 0, img.width(), img.height()) {
        img = image::imageops::crop_imm(&img, x0, y0, x1 - x0, y1 - y0).to_image();
    }

    let longest = img.width().max(img.height());
    if longest > MAX_EDGE {
        let k = MAX_EDGE as f64 / longest as f64;
        let w = ((img.width() as f64 * k).round() as u32).max(1);
        let h = ((img.height() as f64 * k).round() as u32).max(1);
        img = image::imageops::resize(&img, w, h, FilterType::Lanczos3);
    }

    let (width, height) = img.dimensions();
    let mut png = Vec::new();
    img.write_to(&mut Cursor::new(&mut png), ImageFormat::Png)?;
    Ok(Processed { png, width, height, original_ext })
}

/// Bounding box (x0, y0, x1, y1 — exclusive) of non-transparent pixels.
fn opaque_bounds(img: &RgbaImage) -> Option<(u32, u32, u32, u32)> {
    let (mut x0, mut y0, mut x1, mut y1) = (u32::MAX, u32::MAX, 0u32, 0u32);
    for (x, y, p) in img.enumerate_pixels() {
        if p.0[3] > TRIM_ALPHA {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x + 1);
            y1 = y1.max(y + 1);
        }
    }
    (x1 > x0 && y1 > y0).then_some((x0, y0, x1, y1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn png_of(img: &RgbaImage) -> Vec<u8> {
        let mut out = Vec::new();
        img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png).unwrap();
        out
    }

    #[test]
    fn trims_transparent_margins() {
        let mut img = RgbaImage::from_pixel(100, 80, Rgba([0, 0, 0, 0]));
        for y in 20..60 {
            for x in 10..50 {
                img.put_pixel(x, y, Rgba([200, 10, 10, 255]));
            }
        }
        let p = process_image(&png_of(&img)).unwrap();
        assert_eq!((p.width, p.height), (40, 40));
        assert_eq!(p.original_ext, "png");
        assert!((p.aspect() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn downscales_large_images_keeping_aspect() {
        let img = RgbaImage::from_pixel(2048, 1024, Rgba([10, 200, 10, 255]));
        let p = process_image(&png_of(&img)).unwrap();
        assert_eq!((p.width, p.height), (1024, 512));
        // output decodes back to the same size
        let back = image::load_from_memory(&p.png).unwrap();
        assert_eq!((back.width(), back.height()), (1024, 512));
    }

    #[test]
    fn small_images_are_not_upscaled() {
        let img = RgbaImage::from_pixel(64, 32, Rgba([1, 2, 3, 255]));
        let p = process_image(&png_of(&img)).unwrap();
        assert_eq!((p.width, p.height), (64, 32));
    }

    #[test]
    fn rejects_garbage_and_empty_images() {
        assert!(process_image(b"definitely not an image").is_err());
        let empty = RgbaImage::from_pixel(10, 10, Rgba([0, 0, 0, 0]));
        assert!(process_image(&png_of(&empty)).is_err());
    }
}
