//! Bounds for every picture Peta decodes. A small compressed file can describe an enormous picture, so the
//! decoder is told the largest size and memory it may use before it allocates anything.
use std::io::Cursor;

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};

use crate::error::{Error, Result};

/// Pictures that arrive from someone else (Gifts, packs, events, Market cards). Stickers are at most 1024 px.
pub const RECEIVED: (u32, u64) = (4096, 64 * 1024 * 1024);
/// Pictures already in this library (stickers, masks, thumbnails of them).
pub const STORED: (u32, u64) = (8192, 256 * 1024 * 1024);
/// Photos the owner chooses to cut out (a 48 MP phone photo is about 8064 × 6048).
pub const PHOTO: (u32, u64) = (16384, 1024 * 1024 * 1024);

/// Decoder limits for `bound` (largest edge in pixels, largest allocation in bytes).
pub fn limits((edge, bytes): (u32, u64)) -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(edge);
    limits.max_image_height = Some(edge);
    limits.max_alloc = Some(bytes);
    limits
}

fn too_large() -> Error { Error::Image("This picture is too large.".into()) }

/// A reader for `format` (or the format the bytes announce) that refuses pictures beyond `bound`.
pub fn reader(bytes: &[u8], format: Option<ImageFormat>, bound: (u32, u64)) -> Result<ImageReader<Cursor<&[u8]>>> {
    let mut reader = match format {
        Some(format) => ImageReader::with_format(Cursor::new(bytes), format),
        None => ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|_| Error::Image("not a supported image file".into()))?,
    };
    reader.limits(limits(bound));
    Ok(reader)
}

/// Decode within `bound`. The header's dimensions are checked before any pixels are allocated.
pub fn decode(bytes: &[u8], format: Option<ImageFormat>, bound: (u32, u64)) -> Result<DynamicImage> {
    let mut decoder = reader(bytes, format, bound)?.into_decoder().map_err(image_error)?;
    decoder.set_limits(limits(bound)).map_err(|_| too_large())?;
    DynamicImage::from_decoder(decoder).map_err(image_error)
}

fn image_error(e: image::ImageError) -> Error {
    match e {
        image::ImageError::Limits(_) => too_large(),
        other => Error::Image(other.to_string()),
    }
}

/// Width and height from the header only (nothing is decoded), refusing sizes beyond `bound`.
pub fn dimensions(bytes: &[u8], format: Option<ImageFormat>, bound: (u32, u64)) -> Result<(u32, u32)> {
    let (w, h) = reader(bytes, format, bound)?.into_dimensions().map_err(image_error)?;
    if w == 0 || h == 0 { return Err(Error::Image("This picture is empty.".into())); }
    if w > bound.0 || h > bound.0 { return Err(too_large()); }
    Ok((w, h))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{codecs::png::PngEncoder, ExtendedColorType, ImageEncoder};

    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut out = Vec::new();
        PngEncoder::new(&mut out).write_image(&vec![0; (w * h * 4) as usize], w, h, ExtendedColorType::Rgba8).unwrap();
        out
    }

    #[test]
    fn a_picture_within_bounds_decodes_and_reports_its_size() {
        let bytes = png(40, 30);
        assert_eq!(decode(&bytes, Some(ImageFormat::Png), RECEIVED).unwrap().width(), 40);
        assert_eq!(dimensions(&bytes, None, RECEIVED).unwrap(), (40, 30));
    }

    #[test]
    fn a_small_file_describing_a_huge_picture_is_refused_before_decoding() {
        // An all-zero 5000 × 10 picture compresses to a few hundred bytes.
        let bytes = png(5000, 10);
        assert!(bytes.len() < 4096);
        assert!(matches!(decode(&bytes, Some(ImageFormat::Png), RECEIVED), Err(Error::Image(m)) if m.contains("too large")));
        assert!(dimensions(&bytes, None, RECEIVED).is_err());
        assert_eq!(decode(&bytes, None, STORED).unwrap().width(), 5000);
    }

    #[test]
    fn something_that_is_not_a_picture_is_an_error() {
        assert!(decode(b"not a picture", None, PHOTO).is_err());
        assert!(dimensions(b"not a picture", Some(ImageFormat::Png), PHOTO).is_err());
    }
}
