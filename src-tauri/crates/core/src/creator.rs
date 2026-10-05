//! Sticker Creator pipeline (spec §22-26):
//!
//!   Input Image -> Subject Detection -> Background Removal -> Mask Cleanup -> Silhouette -> Border
//!   -> Material Rendering -> Final Sticker
//!
//! `Session` holds one image being worked on. The slow part (decode + network) runs once in
//! `Session::new`; everything after it (cutout adjust, brush edits, material change) is fast enough
//! to re-render live while a slider moves.

use std::path::PathBuf;

use image::{
    codecs::{jpeg::JpegEncoder, png::{CompressionType, FilterType as PngFilter, PngEncoder}},
    imageops::FilterType,
    ExtendedColorType, ImageEncoder, RgbaImage,
};

use crate::{
    cutout::{self, Edits, EDIT_ERASE, EDIT_RESTORE},
    error::{Error, Result},
    image_import::decode_oriented,
    materials::MaterialRecipe,
    segment::{Segmenter, KNOWN_MODELS, U2NETP},
    sticker,
};

/// Longest edge of the working copy. Border and padding bring the finished sticker to ~1000 px.
pub const WORK_EDGE: u32 = 940;

/// Default value of the "cutout adjust" slider.
pub const DEFAULT_STRENGTH: f32 = 0.5;
/// Smoother than the model's raw edge by default: bumpy die-cut outlines look cheap.
pub const DEFAULT_SMOOTH: f32 = 0.7;

/// Pick a segmentation model. `PETA_MODEL=<name>` (u2netp | silueta | isnet-general-use) selects another
/// one if its `.onnx` file sits in one of `dirs`; otherwise the bundled u2netp is used. Pure-Rust inference
/// makes the bigger models several times slower, which is why u2netp is the default.
pub fn load_segmenter(dirs: &[PathBuf], bundled_u2netp: &[u8]) -> Result<Segmenter> {
    if let Ok(wanted) = std::env::var("PETA_MODEL") {
        if let Some(spec) = KNOWN_MODELS.iter().find(|m| m.name == wanted) {
            for dir in dirs {
                let path = dir.join(format!("{}.onnx", spec.name));
                if let Ok(bytes) = std::fs::read(&path) {
                    return Segmenter::from_onnx_bytes(&bytes, *spec);
                }
            }
        }
    }
    Segmenter::from_onnx_bytes(bundled_u2netp, U2NETP)
}

/// The photo, downscaled, plus the (edge-snapped) subject probability.
#[derive(Clone)]
pub struct Analysis {
    pub work: RgbaImage,
    pub matte: Vec<f32>,
    pub w: usize,
    pub h: usize,
    /// The input already had a transparent background; no model was needed.
    pub had_alpha: bool,
}

#[derive(Clone, Debug)]
pub struct Params {
    /// "Cutout adjust" 0..1 (tighter .. looser).
    pub strength: f32,
    /// "Outline" 0..1 (natural .. smooth).
    pub smooth: f32,
    pub recipe: MaterialRecipe,
}

pub struct Rendered {
    /// The finished sticker, cropped to its die-cut outline (transparent PNG).
    pub sticker_png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// The subject alone, at working size (not cropped): the Cutting Mat's middle pane.
    pub cutout_png: Vec<u8>,
    /// The subject mask (8-bit gray PNG) at working size: stored with the sticker.
    pub mask_png: Vec<u8>,
    /// Fraction of the image the subject covers (a tiny value means the cut-out probably failed).
    pub coverage: f32,
}

/// Previews are drawn at 1/PREVIEW_DOWNSCALE size.
pub const PREVIEW_DOWNSCALE: usize = 2;

/// One piece of a brush stroke, as it arrived (a stroke is streamed in pieces while it is painted).
#[derive(Clone)]
struct Piece {
    points: Vec<(f32, f32)>,
    radius: f32,
    value: u8,
}

/// How many strokes can be undone. Older ones are baked in and stay.
const UNDO_LIMIT: usize = 100;

pub struct Session {
    pub analysis: Analysis,
    preview: Analysis,
    pub edits: Edits,
    /// Strokes dropped off the end of the undo history, already painted.
    base: Edits,
    history: Vec<Vec<Piece>>,
    redo: Vec<Vec<Piece>>,
    pub original: Vec<u8>,
    pub original_ext: &'static str,
}

/// Reopen a user's original without losing its saved cutout or settings. Undo starts at this saved state.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct EditorState {
    version: u8,
    width: usize,
    height: usize,
    matte: Vec<f32>,
    edits: Vec<u8>,
    had_alpha: bool,
    pub outline: f32,
    pub smooth: f32,
    pub strength: f32,
}

impl EditorState {
    pub fn capture(session: &Session, outline: f32, smooth: f32, strength: f32) -> Self {
        Self { version: 1, width: session.analysis.w, height: session.analysis.h,
            matte: session.analysis.matte.clone(), edits: session.edits.data.clone(), had_alpha: session.analysis.had_alpha,
            outline, smooth, strength }
    }
    pub fn restore(&self, session: &mut Session) -> Result<()> {
        let pixels = session.analysis.w * session.analysis.h;
        if self.version != 1 || (self.width, self.height) != session.size() || self.matte.len() != pixels || self.edits.len() != pixels
            || self.matte.iter().any(|v| !v.is_finite() || !(0.0..=1.0).contains(v)) || self.edits.iter().any(|v| *v > 2)
            || !self.outline.is_finite() || !(4.0..=64.0).contains(&self.outline)
            || !self.smooth.is_finite() || !(0.0..=1.0).contains(&self.smooth)
            || !self.strength.is_finite() || !(0.0..=1.0).contains(&self.strength) {
            return Err(Error::Invalid("saved editor state does not match the original image".into()));
        }
        session.analysis.matte = self.matte.clone(); session.analysis.had_alpha = self.had_alpha;
        session.edits.data = self.edits.clone(); session.base = session.edits.clone();
        session.history.clear(); session.redo.clear();
        session.preview = session.analysis.downscaled(PREVIEW_DOWNSCALE);
        Ok(())
    }
}

fn png_fast(img: &RgbaImage) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    PngEncoder::new_with_quality(&mut out, CompressionType::Fast, PngFilter::Adaptive)
        .write_image(img.as_raw(), img.width(), img.height(), ExtendedColorType::Rgba8)?;
    Ok(out)
}

fn luma_plane(img: &RgbaImage) -> Vec<f32> {
    img.pixels().map(|p| (0.299 * p.0[0] as f32 + 0.587 * p.0[1] as f32 + 0.114 * p.0[2] as f32) / 255.0).collect()
}

/// Does the image already carry a real cut-out (a good share of transparent *and* opaque pixels)?
fn has_cutout_alpha(img: &RgbaImage) -> bool {
    let n = (img.width() * img.height()) as f32;
    let clear = img.pixels().filter(|p| p.0[3] < 16).count() as f32;
    let solid = img.pixels().filter(|p| p.0[3] > 240).count() as f32;
    clear / n > 0.01 && solid / n > 0.01
}

impl Analysis {
    /// The same analysis at 1/`k` size, for live previews while a slider moves.
    pub fn downscaled(&self, k: usize) -> Analysis {
        let (w, h) = ((self.w / k).max(1), (self.h / k).max(1));
        let work = image::imageops::resize(&self.work, w as u32, h as u32, FilterType::Triangle);
        let mut matte = vec![0f32; w * h];
        for y in 0..h {
            for x in 0..w {
                let mut sum = 0.0;
                for dy in 0..k {
                    for dx in 0..k {
                        sum += self.matte[((y * k + dy).min(self.h - 1)) * self.w + (x * k + dx).min(self.w - 1)];
                    }
                }
                matte[y * w + x] = sum / (k * k) as f32;
            }
        }
        Analysis { work, matte, w, h, had_alpha: self.had_alpha }
    }

    pub fn new(bytes: &[u8], segmenter: Option<&Segmenter>) -> Result<(Self, &'static str)> {
        let (full, ext) = decode_oriented(bytes)?;
        let longest = full.width().max(full.height());
        let work_rgba = if longest > WORK_EDGE {
            let k = WORK_EDGE as f32 / longest as f32;
            let (w, h) = (((full.width() as f32 * k).round() as u32).max(1), ((full.height() as f32 * k).round() as u32).max(1));
            image::imageops::resize(&full, w, h, FilterType::Lanczos3)
        } else {
            full
        };
        let (w, h) = (work_rgba.width() as usize, work_rgba.height() as usize);
        let had_alpha = has_cutout_alpha(&work_rgba);

        let (matte, work) = if had_alpha {
            let matte = work_rgba.pixels().map(|p| p.0[3] as f32 / 255.0).collect();
            let mut opaque = work_rgba;
            for p in opaque.pixels_mut() {
                p.0[3] = 255;
            }
            (matte, opaque)
        } else {
            let seg = segmenter.ok_or_else(|| Error::Model("no segmentation model is loaded".into()))?;
            let mut opaque = work_rgba;
            for p in opaque.pixels_mut() {
                // flatten any faint alpha onto white before the model sees it
                let a = p.0[3] as f32 / 255.0;
                for c in 0..3 {
                    p.0[c] = (p.0[c] as f32 * a + 255.0 * (1.0 - a)).round() as u8;
                }
                p.0[3] = 255;
            }
            let raw = seg.matte(&opaque)?;
            let raw: Vec<f32> = raw.pixels().map(|p| p.0[0] as f32 / 255.0).collect();
            // the network sees a 320px version: snap its soft edge to the real edge in the photo
            let r = (w.max(h) / 110).max(4);
            (cutout::guided_filter(&luma_plane(&opaque), &raw, w, h, r, 2e-3), opaque)
        };
        Ok((Analysis { work, matte, w, h, had_alpha }, ext))
    }

    /// The current subject mask for these settings.
    pub fn mask(&self, strength: f32, smooth: f32, edits: Option<&Edits>) -> Vec<f32> {
        let edits = edits.filter(|e| !e.is_empty());
        if self.had_alpha {
            // the user's own transparency is already exact; only smooth tiny jaggies, honour brush edits
            return cutout::refine_mask(&self.matte, self.w, self.h, 0.5 + 0.0 * strength, smooth, edits);
        }
        cutout::refine_mask(&self.matte, self.w, self.h, strength, smooth, edits)
    }
}

impl Session {
    /// Slow (decode + inference). Run it off the UI thread.
    pub fn new(bytes: &[u8], segmenter: Option<&Segmenter>) -> Result<Self> {
        let (analysis, original_ext) = Analysis::new(bytes, segmenter)?;
        let edits = Edits::new(analysis.w, analysis.h);
        let preview = analysis.downscaled(PREVIEW_DOWNSCALE);
        Ok(Session {
            analysis, preview, base: edits.clone(), edits, history: Vec::new(), redo: Vec::new(),
            original: bytes.to_vec(), original_ext,
        })
    }

    pub fn size(&self) -> (usize, usize) {
        (self.analysis.w, self.analysis.h)
    }

    /// Old originals have a finished mask but no editor snapshot. Preserve that cutout as the baseline.
    pub fn restore_mask(&mut self, bytes: &[u8]) -> Result<()> {
        let mask = image::load_from_memory(bytes)?.to_luma8();
        if (mask.width() as usize, mask.height() as usize) != self.size() {
            return Err(Error::Invalid("saved cutout mask does not match the original image".into()));
        }
        self.analysis.matte = mask.pixels().map(|p| p.0[0] as f32 / 255.0).collect();
        self.analysis.had_alpha = true; self.preview = self.analysis.downscaled(PREVIEW_DOWNSCALE);
        self.edits = Edits::new(self.analysis.w, self.analysis.h); self.base = self.edits.clone();
        self.history.clear(); self.redo.clear();
        Ok(())
    }

    /// The Cutting Mat's left pane.
    pub fn original_jpeg(&self) -> Result<Vec<u8>> {
        let rgb = image::DynamicImage::ImageRgba8(self.analysis.work.clone()).to_rgb8();
        let mut out = Vec::new();
        JpegEncoder::new_with_quality(&mut out, 88).write_image(rgb.as_raw(), rgb.width(), rgb.height(), ExtendedColorType::Rgb8)?;
        Ok(out)
    }

    /// Brush stroke in working-image pixels. `restore` brings subject back, otherwise it erases.
    /// A stroke arrives in pieces while it is painted: `new_stroke` starts a new one (one undo step), otherwise the
    /// piece continues the previous stroke.
    pub fn stroke(&mut self, points: &[(f32, f32)], radius: f32, restore: bool, new_stroke: bool) {
        let piece = Piece { points: points.to_vec(), radius: radius.max(1.0), value: if restore { EDIT_RESTORE } else { EDIT_ERASE } };
        self.edits.stroke(&piece.points, piece.radius, piece.value);
        if new_stroke || self.history.is_empty() {
            self.history.push(vec![piece]);
            self.redo.clear(); // painting something new ends the redo chain
            if self.history.len() > UNDO_LIMIT {
                for p in self.history.remove(0) {
                    self.base.stroke(&p.points, p.radius, p.value);
                }
            }
        } else if let Some(last) = self.history.last_mut() {
            last.push(piece);
        }
    }

    /// Take back the last stroke. Returns false if there is nothing to take back.
    pub fn undo(&mut self) -> bool {
        let Some(group) = self.history.pop() else { return false };
        self.redo.push(group);
        self.rebuild();
        true
    }

    /// Put back the stroke that was taken back.
    pub fn redo(&mut self) -> bool {
        let Some(group) = self.redo.pop() else { return false };
        self.history.push(group);
        self.rebuild();
        true
    }

    pub fn can_undo(&self) -> bool {
        !self.history.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    fn rebuild(&mut self) {
        self.edits = self.base.clone();
        for group in &self.history {
            for p in group {
                self.edits.stroke(&p.points, p.radius, p.value);
            }
        }
    }

    /// "Reset": everything painted is gone (and cannot be undone).
    pub fn clear_edits(&mut self) {
        self.edits = Edits::new(self.analysis.w, self.analysis.h);
        self.base = self.edits.clone();
        self.history.clear();
        self.redo.clear();
    }

    /// Owned render inputs let native preview workers release the editing-session lock.
    /// Do not copy the original upload or undo history for a preview.
    pub fn render_inputs(&self, preview: bool) -> (Analysis, Edits) {
        if preview { (self.preview.clone(), self.edits.downscaled(PREVIEW_DOWNSCALE)) }
        else { (self.analysis.clone(), self.edits.clone()) }
    }

    /// Full-resolution render: what gets stuck on the desktop.
    pub fn render(&self, params: &Params) -> Result<Rendered> {
        render(&self.analysis, Some(&self.edits), params)
    }

    /// Quick half-size render for live feedback (slider, brush, material chips). Same look, fewer pixels.
    pub fn render_preview(&self, params: &Params) -> Result<Rendered> {
        render(&self.preview, Some(&self.edits.downscaled(PREVIEW_DOWNSCALE)), params)
    }
}

/// Mask -> border -> material -> finished sticker.
pub fn render(analysis: &Analysis, edits: Option<&Edits>, params: &Params) -> Result<Rendered> {
    let (w, h) = (analysis.w, analysis.h);
    let mask = analysis.mask(params.strength, params.smooth, edits);

    // subject bounding box -> border width (a fraction of the subject's longer side)
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0usize, 0usize);
    let mut area = 0usize;
    for y in 0..h {
        for x in 0..w {
            if mask[y * w + x] > 0.5 {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x + 1);
                y1 = y1.max(y + 1);
                area += 1;
            }
        }
    }
    if area == 0 {
        return Err(Error::Invalid("nothing was cut out".into()));
    }
    let long_side = (x1 - x0).max(y1 - y0) as f32;
    let border_px = (sticker::border_fraction(&params.recipe) * long_side).max(2.0);

    // pad the canvas so the border has room to grow past the photo's edges
    let pad = (border_px * 1.9).ceil() as usize + 4;
    let (pw, ph) = (w + 2 * pad, h + 2 * pad);
    let mut padded_rgb = RgbaImage::new(pw as u32, ph as u32);
    for y in 0..ph {
        for x in 0..pw {
            let sx = x.saturating_sub(pad).min(w - 1);
            let sy = y.saturating_sub(pad).min(h - 1);
            padded_rgb.put_pixel(x as u32, y as u32, *analysis.work.get_pixel(sx as u32, sy as u32));
        }
    }
    let mut padded_mask = vec![0f32; pw * ph];
    for y in 0..h {
        padded_mask[(y + pad) * pw + pad..(y + pad) * pw + pad + w].copy_from_slice(&mask[y * w..(y + 1) * w]);
    }

    let sil = cutout::silhouette_smooth(&padded_mask, pw, ph, border_px, params.smooth);
    let painted = sticker::render_sticker(&padded_rgb, &padded_mask, &sil, &params.recipe);

    // crop to the die-cut outline
    let (mut cx0, mut cy0, mut cx1, mut cy1) = (pw, ph, 0usize, 0usize);
    for y in 0..ph {
        for x in 0..pw {
            if sil.alpha[y * pw + x] > 0.01 {
                cx0 = cx0.min(x);
                cy0 = cy0.min(y);
                cx1 = cx1.max(x + 1);
                cy1 = cy1.max(y + 1);
            }
        }
    }
    let (cw, ch) = ((cx1 - cx0) as u32, (cy1 - cy0) as u32);
    let cropped = image::imageops::crop_imm(&painted, cx0 as u32, cy0 as u32, cw, ch).to_image();

    // the Cutting Mat's middle pane and the stored mask, both at working size
    let mut cutout_img = analysis.work.clone();
    let mut mask_img = image::GrayImage::new(w as u32, h as u32);
    for (i, p) in cutout_img.pixels_mut().enumerate() {
        let a = (mask[i].clamp(0.0, 1.0) * 255.0).round() as u8;
        p.0[3] = a;
        mask_img.put_pixel((i % w) as u32, (i / w) as u32, image::Luma([a]));
    }
    let mut mask_png = Vec::new();
    PngEncoder::new_with_quality(&mut mask_png, CompressionType::Fast, PngFilter::Adaptive)
        .write_image(mask_img.as_raw(), w as u32, h as u32, ExtendedColorType::L8)?;

    Ok(Rendered {
        sticker_png: png_fast(&cropped)?,
        width: cw,
        height: ch,
        cutout_png: png_fast(&cutout_img)?,
        mask_png,
        coverage: area as f32 / (w * h) as f32,
    })
}

impl Rendered {
    pub fn aspect(&self) -> f64 {
        self.width as f64 / self.height as f64
    }
}

/// Decode PNG bytes (tests, tools).
pub fn decode_png(bytes: &[u8]) -> Result<RgbaImage> {
    Ok(image::load_from_memory(bytes)?.to_rgba8())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::materials;

    const CAT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../assets-src/cat-original.png");
    const MODEL: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../models/u2netp.onnx");

    fn params(material: &str) -> Params {
        Params { strength: DEFAULT_STRENGTH, smooth: DEFAULT_SMOOTH, recipe: materials::get(material).unwrap().recipe }
    }

    fn segmenter() -> Segmenter {
        load_segmenter(&[], &std::fs::read(MODEL).expect("bundled u2netp model")).unwrap()
    }

    /// The (transparent) sample cat pasted onto a busy synthetic photo background.
    fn cat_on_background() -> (Vec<u8>, Vec<bool>, (u32, u32)) {
        let cat = image::open(CAT).unwrap().to_rgba8();
        let (w, h) = (cat.width() / 2, cat.height() / 2);
        let cat = image::imageops::resize(&cat, w, h, FilterType::Lanczos3);
        let mut photo = image::RgbImage::new(w, h);
        for (x, y, p) in photo.enumerate_pixels_mut() {
            let (fx, fy) = (x as f32 / w as f32, y as f32 / h as f32);
            let stripes = (((x / 24 + y / 24) % 2) as f32) * 30.0;
            *p = image::Rgb([
                (60.0 + 140.0 * fx + stripes) as u8,
                (170.0 - 90.0 * fy + stripes) as u8,
                (90.0 + 120.0 * (fx * fy)) as u8,
            ]);
        }
        let mut truth = vec![false; (w * h) as usize];
        for (x, y, c) in cat.enumerate_pixels() {
            let a = c.0[3] as f32 / 255.0;
            let bg = photo.get_pixel(x, y).0;
            let mix = |f: u8, b: u8| (f as f32 * a + b as f32 * (1.0 - a)).round() as u8;
            photo.put_pixel(x, y, image::Rgb([mix(c.0[0], bg[0]), mix(c.0[1], bg[1]), mix(c.0[2], bg[2])]));
            truth[(y * w + x) as usize] = c.0[3] > 127;
        }
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 92)
            .write_image(photo.as_raw(), w, h, ExtendedColorType::Rgb8)
            .unwrap();
        (jpeg, truth, (w, h))
    }

    #[test]
    fn a_transparent_image_needs_no_model() {
        let bytes = std::fs::read(CAT).unwrap();
        let session = Session::new(&bytes, None).unwrap();
        assert!(session.analysis.had_alpha);
        let r = session.render(&params("holographic")).unwrap();
        assert!(r.width > 100 && r.height > 100);
        assert!(r.coverage > 0.2 && r.coverage < 0.95, "coverage {}", r.coverage);
        let sticker = decode_png(&r.sticker_png).unwrap();
        assert_eq!((sticker.width(), sticker.height()), (r.width, r.height));
        assert_eq!(sticker.get_pixel(0, 0).0[3], 0, "corners are transparent");
    }

    #[test]
    fn an_opaque_photo_without_a_model_is_a_clear_error() {
        let (jpeg, _, _) = cat_on_background();
        assert!(matches!(Session::new(&jpeg, None), Err(Error::Model(_))));
    }

    #[test]
    fn the_model_finds_the_cat_in_a_busy_photo() {
        let (jpeg, truth, (w, h)) = cat_on_background();
        let session = Session::new(&jpeg, Some(&segmenter())).unwrap();
        assert!(!session.analysis.had_alpha);
        assert_eq!((session.analysis.w as u32, session.analysis.h as u32), (w, h));
        let mask = session.analysis.mask(DEFAULT_STRENGTH, DEFAULT_SMOOTH, None);
        let (mut inter, mut union) = (0usize, 0usize);
        for i in 0..truth.len() {
            let (a, b) = (mask[i] > 0.5, truth[i]);
            inter += (a && b) as usize;
            union += (a || b) as usize;
        }
        let iou = inter as f32 / union as f32;
        // the white/rainbow die-cut border of the sample sticker is part of the "truth": be generous
        assert!(iou > 0.80, "IoU {iou}");
    }

    #[test]
    fn cutout_adjust_and_brush_edits_change_the_result() {
        let (jpeg, _, _) = cat_on_background();
        let mut session = Session::new(&jpeg, Some(&segmenter())).unwrap();
        let base = session.render(&params("matte")).unwrap();

        let mut loose = params("matte");
        loose.strength = 1.0;
        let mut tight = params("matte");
        tight.strength = 0.0;
        let (rl, rt) = (session.render(&loose).unwrap(), session.render(&tight).unwrap());
        assert!(rl.coverage >= base.coverage && base.coverage >= rt.coverage, "{} {} {}", rl.coverage, base.coverage, rt.coverage);

        // erase the whole left half of the subject with a fat brush
        let (w, h) = session.size();
        let pts: Vec<(f32, f32)> = (0..h).step_by(8).map(|y| (w as f32 * 0.3, y as f32)).collect();
        session.stroke(&pts, w as f32 * 0.25, false, true);
        let erased = session.render(&params("matte")).unwrap();
        assert!(erased.coverage < base.coverage - 0.05, "{} vs {}", erased.coverage, base.coverage);
        session.clear_edits();
        let again = session.render(&params("matte")).unwrap();
        assert_eq!(again.sticker_png, base.sticker_png, "clearing edits restores the original result");
    }

    /// A session over a plain transparent image: no model needed.
    fn flat_session() -> Session {
        let mut img = RgbaImage::new(120, 90);
        for y in 20..70u32 {
            for x in 30..90u32 {
                img.put_pixel(x, y, image::Rgba([200, 90, 60, 255]));
            }
        }
        Session::new(&encode_png(&img), None).unwrap()
    }

    fn encode_png(img: &RgbaImage) -> Vec<u8> {
        let mut out = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png).unwrap();
        out
    }

    #[test]
    fn new_finishes_pass_through_both_creator_sizes_without_stretching_or_losing_the_cutout() {
        let s=flat_session();
        let base=s.render(&params("matte")).unwrap();
        for id in ["gold","riso","vintage","clear","pixel","washi","sakura"] {
            let full=s.render(&params(id)).unwrap();
            let preview=s.render_preview(&params(id)).unwrap();
            assert_eq!((full.width,full.height),(base.width,base.height),"{id}");
            let a=decode_png(&full.sticker_png).unwrap();
            let b=decode_png(&preview.sticker_png).unwrap();
            assert!(a.width()>a.height() && b.width()>b.height(),"{id}: landscape remains landscape");
            assert_eq!(full.cutout_png,base.cutout_png,"{id}: only the finish changes");
            assert_eq!(a.get_pixel(0,0).0[3],0,"{id}: no rectangular background");
            assert!(b.pixels().any(|p| p.0[3]==255),"{id}: image remains opaque");
        }
    }

    #[test]
    fn undo_takes_back_one_whole_stroke_even_when_it_arrived_in_pieces() {
        let mut s = flat_session();
        let params = params("matte");
        let base = s.render(&params).unwrap().sticker_png;
        // stroke 1 arrives in three pieces, stroke 2 in one
        s.stroke(&[(40.0, 30.0), (50.0, 30.0)], 6.0, false, true);
        s.stroke(&[(50.0, 30.0), (60.0, 30.0)], 6.0, false, false);
        s.stroke(&[(60.0, 30.0), (70.0, 30.0)], 6.0, false, false);
        let after_one = s.render(&params).unwrap().sticker_png;
        s.stroke(&[(40.0, 55.0), (80.0, 55.0)], 6.0, false, true);
        let after_two = s.render(&params).unwrap().sticker_png;
        assert_ne!(base, after_one);
        assert_ne!(after_one, after_two);

        assert!(s.can_undo() && !s.can_redo());
        assert!(s.undo());
        assert_eq!(s.render(&params).unwrap().sticker_png, after_one, "the second stroke is gone, the first stays whole");
        assert!(s.can_redo());
        assert!(s.undo());
        assert_eq!(s.render(&params).unwrap().sticker_png, base, "all three pieces of the first stroke are gone together");
        assert!(!s.undo() && !s.can_undo(), "nothing left to take back");
        assert!(s.redo() && s.redo());
        assert_eq!(s.render(&params).unwrap().sticker_png, after_two, "redo puts both strokes back");
        assert!(!s.redo());
    }

    #[test]
    fn painting_after_an_undo_ends_the_redo_chain_and_reset_clears_everything() {
        let mut s = flat_session();
        s.stroke(&[(40.0, 30.0), (60.0, 30.0)], 5.0, false, true);
        s.undo();
        assert!(s.can_redo());
        s.stroke(&[(40.0, 60.0), (60.0, 60.0)], 5.0, true, true);
        assert!(!s.can_redo(), "a new stroke ends the redo chain");
        s.stroke(&[(40.0, 40.0), (60.0, 40.0)], 5.0, false, true);
        s.clear_edits();
        assert!(!s.can_undo() && !s.can_redo());
        assert!(s.edits.is_empty());
    }

    #[test]
    fn old_strokes_fall_off_the_undo_history_but_stay_painted() {
        let mut s = flat_session();
        for i in 0..(UNDO_LIMIT + 5) {
            s.stroke(&[(35.0 + (i % 50) as f32, 40.0)], 2.0, false, true);
        }
        let before: Vec<u8> = s.edits.data.clone();
        let mut undone = 0;
        while s.undo() {
            undone += 1;
        }
        assert_eq!(undone, UNDO_LIMIT, "only the latest strokes can be undone");
        let baked = s.edits.data.iter().filter(|v| **v != 0).count();
        assert!(baked > 0, "the older strokes are still painted");
        while s.redo() {}
        assert_eq!(s.edits.data, before, "redoing everything gives the same result");
    }

    #[test]
    fn preview_is_a_half_size_version_of_the_final() {
        let bytes = std::fs::read(CAT).unwrap();
        let session = Session::new(&bytes, None).unwrap();
        let (full, preview) = (session.render(&params("kraft")).unwrap(), session.render_preview(&params("kraft")).unwrap());
        let ratio = full.width as f32 / preview.width as f32;
        assert!((1.7..2.3).contains(&ratio), "ratio {ratio}");
        assert!((full.aspect() - preview.aspect()).abs() < 0.05);
        assert!((full.coverage - preview.coverage).abs() < 0.03);
    }

    #[test]
    fn render_inputs_keep_full_and_preview_pixels_and_do_not_follow_new_edits() {
        let mut session = flat_session();
        session.stroke(&[(45.0, 40.0), (60.0, 40.0)], 3.0, false, true);
        let params = params("matte");
        let (full, edits) = session.render_inputs(false);
        let (preview, preview_edits) = session.render_inputs(true);
        let expected = session.render(&params).unwrap();
        let expected_preview = session.render_preview(&params).unwrap();
        session.stroke(&[(55.0, 55.0)], 8.0, false, true);
        let snapshot = render(&full, Some(&edits), &params).unwrap();
        let snapshot_preview = render(&preview, Some(&preview_edits), &params).unwrap();
        assert_eq!(snapshot.sticker_png, expected.sticker_png);
        assert_eq!(snapshot.cutout_png, expected.cutout_png);
        assert_eq!(snapshot_preview.sticker_png, expected_preview.sticker_png);
        assert_eq!(snapshot_preview.cutout_png, expected_preview.cutout_png);
        assert_ne!(snapshot.sticker_png, session.render(&params).unwrap().sticker_png);
    }

    #[test]
    fn nothing_cut_out_is_reported() {
        let bytes = std::fs::read(CAT).unwrap();
        let mut session = Session::new(&bytes, None).unwrap();
        let (w, h) = session.size();
        session.stroke(&[(w as f32 / 2.0, h as f32 / 2.0)], (w.max(h)) as f32, false, true); // erase everything
        assert!(matches!(session.render(&params("matte")), Err(Error::Invalid(_))));
    }
}
