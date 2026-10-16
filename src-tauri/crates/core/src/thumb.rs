//! Thumbnails of finished stickers, for lists. A tile of the Collection is about 200 px wide; sending and decoding the full
//! 1024 px picture for each of a hundred tiles is what made the page heavy. A thumbnail is the same picture, smaller.

use crate::error::{Error, Result};
use image::{codecs::png::{CompressionType, FilterType as PngFilter, PngEncoder}, imageops::FilterType, ImageEncoder, RgbaImage};

/// Shrink a PNG so its longer side is at most `max` px (never enlarged). Transparent edges are resized with premultiplied colour,
/// so the sticker's rim does not pick up a dark halo from the invisible pixels around it.
pub fn thumbnail_png(bytes: &[u8], max: u32) -> Result<Vec<u8>> {
    let max = max.clamp(16, 2048);
    let img = crate::image_limits::decode(bytes, None, crate::image_limits::STORED).map_err(|e| Error::Invalid(format!("thumbnail: {e}")))?.to_rgba8();
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 { return Err(Error::Invalid("thumbnail: empty picture".into())); }
    if w.max(h) <= max { return Ok(bytes.to_vec()); }
    let k = max as f32 / w.max(h) as f32;
    let (nw, nh) = (((w as f32 * k).round() as u32).max(1), ((h as f32 * k).round() as u32).max(1));
    let mut pre = img;
    for p in pre.pixels_mut() { let a = p[3] as u32; for c in 0..3 { p[c] = ((p[c] as u32 * a + 127) / 255) as u8; } }
    let mut small: RgbaImage = image::imageops::resize(&pre, nw, nh, FilterType::Triangle);
    for p in small.pixels_mut() { let a = p[3] as u32; if a > 0 && a < 255 { for c in 0..3 { p[c] = ((p[c] as u32 * 255 + a / 2) / a).min(255) as u8; } } }
    let mut out = Vec::with_capacity((nw * nh) as usize);
    PngEncoder::new_with_quality(&mut out, CompressionType::Fast, PngFilter::Adaptive)
        .write_image(small.as_raw(), nw, nh, image::ExtendedColorType::Rgba8)
        .map_err(|e| Error::Invalid(format!("thumbnail: {e}")))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
        let img = RgbaImage::from_fn(w, h, |x, y| image::Rgba(f(x, y)));
        let mut out = Vec::new();
        PngEncoder::new(&mut out).write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgba8).unwrap();
        out
    }

    #[test]
    fn the_longer_side_is_capped_and_the_shape_kept() {
        let t = thumbnail_png(&png(400, 200, |_, _| [200, 10, 10, 255]), 100).unwrap();
        let img = image::load_from_memory(&t).unwrap();
        assert_eq!((img.width(), img.height()), (100, 50));
    }

    #[test]
    fn a_picture_already_small_enough_is_left_alone() {
        let src = png(64, 64, |_, _| [1, 2, 3, 255]);
        assert_eq!(thumbnail_png(&src, 128).unwrap(), src);
    }

    #[test]
    fn the_rim_of_a_sticker_keeps_its_colour_and_gets_no_dark_halo() {
        // a white disc on a transparent background whose hidden colour is black (as in the app's finished stickers)
        let src = png(256, 256, |x, y| { let d = ((x as f32 - 128.0).powi(2) + (y as f32 - 128.0).powi(2)).sqrt(); if d < 90.0 { [255, 255, 255, 255] } else { [0, 0, 0, 0] } });
        let t = image::load_from_memory(&thumbnail_png(&src, 64).unwrap()).unwrap().to_rgba8();
        let mut partial = 0;
        for p in t.pixels() { if p[3] > 20 && p[3] < 235 { partial += 1; assert!(p[0] > 235, "a half-covered rim pixel went grey: {:?}", p); } }
        assert!(partial > 0, "the test needs a soft edge to mean anything");
    }

    #[test]
    fn a_real_sticker_becomes_a_fraction_of_its_size() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../src/art/samples/good-day.png");
        let full = std::fs::read(path).unwrap();
        let t = thumbnail_png(&full, 384).unwrap();
        println!("good-day.png: {} bytes -> {} bytes", full.len(), t.len());
        assert!(t.len() * 3 < full.len(), "{} -> {}", full.len(), t.len());
    }

    #[test]
    fn rubbish_is_an_error_not_a_panic() {
        assert!(thumbnail_png(b"not a png", 64).is_err());
    }
}
