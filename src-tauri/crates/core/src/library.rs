//! The sticker library: database + asset files on disk.
//!
//! Layout under the app data dir:
//!   peta.db
//!   assets/stickers/<ID>/original.<ext>   the file the user gave us, untouched
//!   assets/stickers/<ID>/rendered.png     what is drawn on the desktop

use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::{
    db::{now, Database},
    error::{Error, Result},
    ids::{new_sticker_id, random_unit},
    image_import::Processed,
    models::{NewSticker, Placement, SourceType, Sticker},
};

/// Longer side of a freshly stuck sticker, as a fraction of the display width.
const DEFAULT_LONG_SIDE: f64 = 0.18;

pub struct Library {
    db: Database,
    assets_dir: PathBuf,
}

impl Library {
    pub fn open(dir: &Path) -> Result<Self> {
        fs::create_dir_all(dir.join("assets"))?;
        Ok(Library { db: Database::open(&dir.join("peta.db"))?, assets_dir: dir.join("assets") })
    }

    pub fn db(&self) -> &Database {
        &self.db
    }

    pub fn db_mut(&mut self) -> &mut Database {
        &mut self.db
    }

    /// Store a processed image as a new sticker made by the user (not yet on the desktop).
    pub fn add_created(&mut self, processed: &Processed, original: &[u8], creator_id: Option<&str>) -> Result<Sticker> {
        let id = loop {
            let id = new_sticker_id();
            if !self.db.sticker_id_exists(&id)? {
                break id;
            }
        };
        let original_rel = format!("stickers/{id}/original.{}", processed.original_ext);
        let rendered_rel = format!("stickers/{id}/rendered.png");
        self.write_asset(&original_rel, original)?;
        self.write_asset(&rendered_rel, &processed.png)?;

        let created = self.db.create_sticker(NewSticker {
            id: id.clone(),
            creator_id: creator_id.map(str::to_owned),
            original_asset_path: original_rel,
            rendered_asset_path: rendered_rel,
            material_id: None,
            source_type: SourceType::Created,
            aspect: processed.aspect(),
        });
        if created.is_err() {
            let _ = fs::remove_dir_all(self.assets_dir.join("stickers").join(&id)); // don't leave orphans
        }
        created
    }

    /// Stick a sticker on the desktop at a relative position with a natural-looking default size
    /// and a slight random tilt.
    pub fn stick_new(&mut self, sticker: &Sticker, display_id: &str, relative_x: f64, relative_y: f64) -> Result<Placement> {
        let scale = if sticker.aspect >= 1.0 { DEFAULT_LONG_SIDE } else { DEFAULT_LONG_SIDE * sticker.aspect };
        self.db.place(Placement {
            sticker_id: sticker.id.clone(),
            display_id: display_id.to_owned(),
            relative_x: relative_x.clamp(0.0, 1.0),
            relative_y: relative_y.clamp(0.0, 1.0),
            relative_scale: scale,
            rotation: (random_unit() - 0.5) * 10.0,
            placed_at: now(),
            is_on_desktop: true,
            z: 0,
        })
    }

    pub fn read_rendered(&self, sticker_id: &str) -> Result<Vec<u8>> {
        let rel = self
            .db
            .rendered_asset_path(sticker_id)?
            .ok_or_else(|| Error::Invalid(format!("unknown sticker {sticker_id}")))?;
        Ok(fs::read(self.assets_dir.join(rel))?)
    }

    fn write_asset(&self, rel: &str, bytes: &[u8]) -> Result<()> {
        let path = self.assets_dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, bytes)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{ImageFormat, Rgba, RgbaImage};

    use super::*;
    use crate::image_import::process_image;

    fn tmp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("peta-lib-test-{}", new_sticker_id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn png(w: u32, h: u32) -> Vec<u8> {
        let img = RgbaImage::from_pixel(w, h, Rgba([30, 120, 200, 255]));
        let mut out = Vec::new();
        img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png).unwrap();
        out
    }

    #[test]
    fn import_stick_restart_roundtrip() {
        let dir = tmp();
        let bytes = png(300, 200);
        let id = {
            let mut lib = Library::open(&dir).unwrap();
            let processed = process_image(&bytes).unwrap();
            let sticker = lib.add_created(&processed, &bytes, Some("me")).unwrap();
            assert_eq!(sticker.original_number, Some(1));
            assert!(sticker.id.starts_with("PETA-"));
            let placement = lib.stick_new(&sticker, "display-1", 0.4, 0.6).unwrap();
            assert!((placement.relative_scale - 0.18).abs() < 1e-9); // landscape: width = long side
            assert!(placement.rotation.abs() <= 5.0);
            sticker.id
        };

        // "restart"
        let lib = Library::open(&dir).unwrap();
        let on = lib.db().on_desktop().unwrap();
        assert_eq!(on.len(), 1);
        assert_eq!((on[0].sticker_id.as_str(), on[0].display_id.as_str()), (id.as_str(), "display-1"));
        let rendered = lib.read_rendered(&id).unwrap();
        assert_eq!(image::load_from_memory(&rendered).unwrap().width(), 300);
        assert!(dir.join("assets/stickers").join(&id).join("original.png").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn portrait_stickers_get_a_narrower_default_width() {
        let dir = tmp();
        let bytes = png(100, 200);
        let mut lib = Library::open(&dir).unwrap();
        let s = lib.add_created(&process_image(&bytes).unwrap(), &bytes, None).unwrap();
        let p = lib.stick_new(&s, "d", 0.5, 0.5).unwrap();
        assert!((p.relative_scale - 0.09).abs() < 1e-9);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unknown_sticker_asset_is_an_error() {
        let dir = tmp();
        let lib = Library::open(&dir).unwrap();
        assert!(lib.read_rendered("PETA-NOPE-NOPE").is_err());
        let _ = fs::remove_dir_all(dir);
    }
}
