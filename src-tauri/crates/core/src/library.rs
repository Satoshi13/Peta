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

/// Width (as a fraction of the screen width) a freshly stuck sticker gets: its long side is `DEFAULT_LONG_SIDE`.
/// The Print animation uses the same size, so the sticker does not change size when it is let go.
pub fn default_scale(aspect: f64) -> f64 {
    if aspect >= 1.0 { DEFAULT_LONG_SIDE } else { DEFAULT_LONG_SIDE * aspect }
}

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
    pub fn add_created(
        &mut self,
        processed: &Processed,
        original: &[u8],
        creator_id: Option<&str>,
        material_id: Option<&str>,
    ) -> Result<Sticker> {
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
            name: None,
            id: id.clone(),
            creator_id: creator_id.map(str::to_owned),
            creator_name: Some(self.db.display_name()?),
            original_asset_path: original_rel,
            rendered_asset_path: rendered_rel,
            mask_asset_path: None,
            material_id: material_id.map(str::to_owned),
            source_type: SourceType::Created,
            aspect: processed.aspect(),
        });
        if created.is_err() {
            let _ = fs::remove_dir_all(self.assets_dir.join("stickers").join(&id)); // don't leave orphans
        }
        created
    }

    /// Store a sticker made in the Creator (cut out, bordered, material applied).
    pub fn add_made(
        &mut self,
        rendered: &crate::creator::Rendered,
        original: &[u8],
        original_ext: &str,
        creator_id: Option<&str>,
        material_id: &str,
    ) -> Result<Sticker> {
        let by = self.db.display_name()?;
        self.add_rendered(rendered, original, original_ext, creator_id, Some(by), material_id, SourceType::Created)
    }

    /// Store a sticker that came out of a pack: its maker is the pack's author, and the back says which pack.
    pub fn add_from_pack(
        &mut self,
        rendered: &crate::creator::Rendered,
        original: &[u8],
        original_ext: &str,
        pack_title: &str,
        pack_by: &str,
        material_id: &str,
    ) -> Result<Sticker> {
        let sticker = self.add_rendered(rendered, original, original_ext, None, Some(pack_by.to_owned()), material_id, SourceType::Pack)?;
        self.db.add_provenance(&sticker.id, crate::models::ProvenanceKind::PackOpened, Some(pack_title), &now())?;
        self.db.sticker(&sticker.id)?.ok_or_else(|| Error::Invalid("sticker vanished".into()))
    }

    #[allow(clippy::too_many_arguments)]
    fn add_rendered(
        &mut self,
        rendered: &crate::creator::Rendered,
        original: &[u8],
        original_ext: &str,
        creator_id: Option<&str>,
        creator_name: Option<String>,
        material_id: &str,
        source_type: SourceType,
    ) -> Result<Sticker> {
        let id = loop {
            let id = new_sticker_id();
            if !self.db.sticker_id_exists(&id)? {
                break id;
            }
        };
        let original_rel = format!("stickers/{id}/original.{original_ext}");
        let rendered_rel = format!("stickers/{id}/rendered.png");
        let mask_rel = format!("stickers/{id}/mask.png");
        self.write_asset(&original_rel, original)?;
        self.write_asset(&rendered_rel, &rendered.sticker_png)?;
        self.write_asset(&mask_rel, &rendered.mask_png)?;
        let created = self.db.create_sticker(NewSticker {
            name: None,
            id: id.clone(),
            creator_id: creator_id.map(str::to_owned),
            creator_name,
            original_asset_path: original_rel,
            rendered_asset_path: rendered_rel,
            mask_asset_path: Some(mask_rel),
            material_id: Some(material_id.to_owned()),
            source_type,
            aspect: rendered.aspect(),
        });
        if created.is_err() {
            let _ = fs::remove_dir_all(self.assets_dir.join("stickers").join(&id));
        }
        created
    }

    /// Stick a sticker on the desktop at a relative position with a natural-looking default size
    /// and a slight random tilt.
    pub fn stick_new(&mut self, sticker: &Sticker, display_id: &str, relative_x: f64, relative_y: f64) -> Result<Placement> {
        let scale = default_scale(sticker.aspect);
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

    pub(crate) fn read_asset(&self, rel: &str) -> Result<Vec<u8>> {
        Ok(fs::read(self.assets_dir.join(rel))?)
    }

    pub(crate) fn write_asset(&self, rel: &str, bytes: &[u8]) -> Result<()> {
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
            let sticker = lib.add_created(&processed, &bytes, Some("me"), Some("matte")).unwrap();
            assert_eq!(sticker.original_number, Some(1));
            assert_eq!(sticker.material_id.as_deref(), Some("matte"));
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
        let s = lib.add_created(&process_image(&bytes).unwrap(), &bytes, None, None).unwrap();
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
