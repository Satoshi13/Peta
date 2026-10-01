//! Tauri-side owner of the sticker library (peta-core): opening it, first-run seeding,
//! migrating the Phase 0 JSON file, and importing image files.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, MutexGuard,
    },
};

use peta_core::{process_image, Library, Placement, Sticker};
use tauri::{AppHandle, Manager};

/// Bundled sample so a first launch has something on the desktop.
const SAMPLE_CAT: &[u8] = include_bytes!("../assets/sample-cat.png");

const LEGACY_JSON: &str = "placements.json";

pub struct Store {
    lib: Mutex<Option<Library>>,
    needs_seed: AtomicBool,
}

impl Default for Store {
    fn default() -> Self {
        Store { lib: Mutex::new(None), needs_seed: AtomicBool::new(false) }
    }
}

pub struct Locked<'a>(MutexGuard<'a, Option<Library>>);

impl std::ops::Deref for Locked<'_> {
    type Target = Library;
    fn deref(&self) -> &Library {
        self.0.as_ref().expect("library not opened")
    }
}
impl std::ops::DerefMut for Locked<'_> {
    fn deref_mut(&mut self) -> &mut Library {
        self.0.as_mut().expect("library not opened")
    }
}

impl Store {
    pub fn lock(&self) -> Locked<'_> {
        Locked(self.lib.lock().unwrap())
    }

    pub fn open(&self, app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let dir = app.path().app_data_dir()?;
        fs::create_dir_all(&dir)?;
        let first_run = !dir.join("peta.db").exists() && !dir.join(LEGACY_JSON).exists();
        let mut lib = Library::open(&dir)?;

        if dir.join(LEGACY_JSON).exists() && lib.db().sticker_count()? == 0 {
            migrate_legacy_json(&mut lib, &dir.join(LEGACY_JSON));
        }
        *self.lib.lock().unwrap() = Some(lib);
        self.needs_seed.store(first_run, Ordering::SeqCst);
        Ok(())
    }

    /// First launch only: one sample cat on the primary display.
    pub fn seed_if_needed(&self, primary_display_id: &str) {
        if self.needs_seed.swap(false, Ordering::SeqCst) {
            if let Err(e) = self.add_sample(primary_display_id) {
                eprintln!("[peta] seeding sample failed: {e}");
            }
        }
    }

    pub fn add_sample(&self, display_id: &str) -> Result<Sticker, String> {
        self.import_bytes(SAMPLE_CAT, display_id, 0.72, 0.31)
    }

    /// Placements to draw (everything currently on the desktop, bottom -> top).
    pub fn on_desktop(&self) -> Vec<Placement> {
        self.lock().db().on_desktop().unwrap_or_else(|e| {
            eprintln!("[peta] reading placements failed: {e}");
            Vec::new()
        })
    }

    /// Decode + downscale OUTSIDE the lock (it's the slow part), then store and stick it down.
    pub fn import_bytes(&self, bytes: &[u8], display_id: &str, rx: f64, ry: f64) -> Result<Sticker, String> {
        let processed = process_image(bytes).map_err(|e| e.to_string())?;
        let mut lib = self.lock();
        let sticker = lib.add_created(&processed, bytes, None).map_err(|e| e.to_string())?;
        lib.stick_new(&sticker, display_id, rx, ry).map_err(|e| e.to_string())?;
        Ok(sticker)
    }

    /// Import files; each next one is nudged so a multi-drop fans out instead of stacking exactly.
    /// Returns how many were stuck down; failures are logged and skipped.
    pub fn import_paths(&self, paths: &[PathBuf], display_id: &str, rx: f64, ry: f64) -> usize {
        let mut ok = 0;
        for (i, path) in paths.iter().enumerate() {
            let nudge = i as f64 * 0.03;
            let result = fs::read(path)
                .map_err(|e| e.to_string())
                .and_then(|bytes| self.import_bytes(&bytes, display_id, rx + nudge, ry + nudge));
            match result {
                Ok(_) => ok += 1,
                Err(e) => eprintln!("[peta] could not import {}: {e}", path.display()),
            }
        }
        ok
    }
}

/// Phase 0 kept one sample cat in placements.json. Carry its position over, then retire the file.
fn migrate_legacy_json(lib: &mut Library, json: &Path) {
    let migrated = (|| -> Result<(), String> {
        let bytes = fs::read(json).map_err(|e| e.to_string())?;
        let legacy: Vec<Placement> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        for old in legacy {
            let processed = process_image(SAMPLE_CAT).map_err(|e| e.to_string())?;
            let sticker = lib.add_created(&processed, SAMPLE_CAT, None).map_err(|e| e.to_string())?;
            lib.db_mut()
                .place(Placement { sticker_id: sticker.id, z: 0, ..old })
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    match migrated {
        Ok(()) => {
            let _ = fs::rename(json, json.with_extension("json.migrated"));
        }
        Err(e) => eprintln!("[peta] legacy placements.json not migrated: {e}"),
    }
}
