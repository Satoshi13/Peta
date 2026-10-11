//! Apple Vision foreground extraction. Native objects stay inside this synchronous worker;
//! callers run it off the UI thread and receive only an owned grayscale mask.
use image::{imageops::FilterType, GrayImage, RgbaImage};
use crate::error::{Error, Result};

/// Stateless: Vision owns its system model; nothing is bundled or cached by Peta.
pub struct Segmenter;
impl Segmenter {
    pub fn matte(&self, image: &RgbaImage) -> Result<GrayImage> { foreground_mask(image) }
}

pub fn foreground_mask(image: &RgbaImage) -> Result<GrayImage> {
    if image.width() == 0 || image.height() == 0 { return Err(Error::Model("Nothing was cut out. Try another picture.".into())); }
    // Vision cannot identify a subject in a uniform picture.
    if image.pixels().all(|p| p == image.get_pixel(0, 0)) { return Err(no_subject()); }
    let longest = image.width().max(image.height());
    let small;
    let input = if longest > 2048 {
        let scale = 2048.0 / longest as f64;
        small = image::imageops::resize(image, (image.width() as f64 * scale).round().max(1.0) as u32,
            (image.height() as f64 * scale).round().max(1.0) as u32, FilterType::Lanczos3);
        &small
    } else { image };
    let mask = native::mask(input)?;
    if mask.dimensions() == image.dimensions() { Ok(mask) }
    else { Ok(image::imageops::resize(&mask, image.width(), image.height(), FilterType::Triangle)) }
}
fn no_subject() -> Error { Error::Model("Nothing was cut out. Try another picture.".into()) }

mod native {
    use super::*;
    use objc2::{rc::autoreleasepool, AnyThread};
    use objc2_core_foundation::CFData;
    use objc2_core_graphics::{CGColorSpace, CGDataProvider, CGImage, CGBitmapInfo, CGImageAlphaInfo, CGColorRenderingIntent, kCGColorSpaceSRGB};
    use objc2_core_video::*;
    use objc2_foundation::{NSArray, NSDictionary, NSProcessInfo, NSOperatingSystemVersion};
    use objc2_vision::{VNGenerateForegroundInstanceMaskRequest, VNImageRequestHandler, VNRequest};

    fn fail(e: impl std::fmt::Display) -> Error { Error::Model(e.to_string()) }
    struct Locked<'a>(&'a CVPixelBuffer);
    impl Drop for Locked<'_> {
        fn drop(&mut self) { unsafe { CVPixelBufferUnlockBaseAddress(self.0, CVPixelBufferLockFlags::ReadOnly); } }
    }
    pub(super) fn mask(input: &RgbaImage) -> Result<GrayImage> {
        autoreleasepool(|_| unsafe {
            if !NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(NSOperatingSystemVersion { majorVersion: 14, minorVersion: 0, patchVersion: 0 }) {
                return Err(fail("Cutting out needs macOS 14 or later."));
            }
            // CFData owns a copy. CGImage/handler can retain it without borrowing the Rust input.
            let data = CFData::from_bytes(input.as_raw());
            let provider = CGDataProvider::with_cf_data(Some(&data)).ok_or_else(|| fail("Could not read the picture."))?;
            let space = CGColorSpace::with_name(Some(kCGColorSpaceSRGB)).ok_or_else(|| fail("Could not create sRGB color space."))?;
            let image = CGImage::new(input.width() as usize, input.height() as usize, 8, 32,
                input.width() as usize * 4, Some(&space), CGBitmapInfo(CGImageAlphaInfo::Last.0), Some(&provider),
                std::ptr::null(), false, CGColorRenderingIntent::RenderingIntentDefault).ok_or_else(|| fail("Could not create the picture."))?;
            let handler = VNImageRequestHandler::initWithCGImage_options(VNImageRequestHandler::alloc(), &image, &NSDictionary::new());
            let request = VNGenerateForegroundInstanceMaskRequest::new();
            handler.performRequests_error(&NSArray::<VNRequest>::from_slice(&[&request])).map_err(fail)?;
            let results = request.results().ok_or_else(no_subject)?;
            let observation = results.firstObject().ok_or_else(no_subject)?;
            let instances = observation.allInstances();
            if instances.count() == 0 { return Err(no_subject()); }
            let buffer = observation.generateScaledMaskForImageForInstances_fromRequestHandler_error(&instances, &handler).map_err(fail)?;
            if CVPixelBufferIsPlanar(&buffer) { return Err(fail("Vision returned an unsupported planar mask.")); }
            let format = CVPixelBufferGetPixelFormatType(&buffer);
            let bytes_per_pixel = if format == kCVPixelFormatType_OneComponent8 { 1 } else if format == kCVPixelFormatType_OneComponent32Float { 4 }
                else { return Err(fail(format!("Vision returned an unsupported mask format: {format}."))); };
            if CVPixelBufferLockBaseAddress(&buffer, CVPixelBufferLockFlags::ReadOnly) != 0 { return Err(fail("Could not read the Vision mask.")); }
            let _locked = Locked(&buffer);
            let (w, h, stride) = (CVPixelBufferGetWidth(&buffer), CVPixelBufferGetHeight(&buffer), CVPixelBufferGetBytesPerRow(&buffer));
            let base = CVPixelBufferGetBaseAddress(&buffer).cast::<u8>();
            if base.is_null() || w == 0 || h == 0 || stride < w * bytes_per_pixel || w > u32::MAX as usize || h > u32::MAX as usize {
                return Err(fail("Vision returned a damaged mask."));
            }
            let mut mask = GrayImage::new(w as u32, h as u32);
            for y in 0..h { for x in 0..w {
                let pixel = base.add(y * stride + x * bytes_per_pixel);
                let value = if bytes_per_pixel == 1 { *pixel } else { (pixel.cast::<f32>().read_unaligned().clamp(0.0, 1.0) * 255.0).round() as u8 };
                mask.put_pixel(x as u32, y as u32, image::Luma([value]));
            }}
            if !mask.pixels().any(|p| p.0[0] > 127) { return Err(no_subject()); }
            Ok(mask)
        })
    }
}
