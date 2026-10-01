//! Placement persistence (spike steps 09-10). JSON file in the app data dir.
//! Phase 1 replaces this with SQLite; the `Placement` shape follows spec §59.

use std::{fs, io, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub sticker_id: String,
    pub display_id: String,
    /// Sticker center, 0..1 of the display.
    pub relative_x: f64,
    pub relative_y: f64,
    /// Sticker width as a fraction of the display width.
    pub relative_scale: f64,
    /// Degrees, clockwise.
    pub rotation: f64,
    #[serde(default)]
    pub placed_at: String,
    #[serde(default = "yes")]
    pub is_on_desktop: bool,
}

fn yes() -> bool {
    true
}

#[derive(Default)]
pub struct Store {
    path: Mutex<Option<PathBuf>>,
    items: Mutex<Vec<Placement>>,
}

impl Store {
    pub fn load(&self, app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let dir = app.path().app_data_dir()?;
        fs::create_dir_all(&dir)?;
        let path = dir.join("placements.json");
        let items = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|e| {
                eprintln!("[peta] placements.json unreadable ({e}); starting empty");
                Vec::new()
            }),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e.into()),
        };
        *self.items.lock().unwrap() = items;
        *self.path.lock().unwrap() = Some(path);
        Ok(())
    }

    pub fn all(&self) -> Vec<Placement> {
        self.items.lock().unwrap().clone()
    }

    /// Insert or replace by `sticker_id`, then write to disk.
    pub fn upsert(&self, mut p: Placement) -> io::Result<()> {
        if p.placed_at.is_empty() {
            p.placed_at = chrono::Utc::now().to_rfc3339();
        }
        {
            let mut items = self.items.lock().unwrap();
            match items.iter_mut().find(|x| x.sticker_id == p.sticker_id) {
                Some(slot) => *slot = p,
                None => items.push(p),
            }
        }
        self.flush()
    }

    /// First launch: put the single test cat on the primary display.
    pub fn seed_if_empty(&self, primary_display_id: &str) -> io::Result<()> {
        if !self.items.lock().unwrap().is_empty() {
            return Ok(());
        }
        self.reset(primary_display_id)
    }

    pub fn reset(&self, primary_display_id: &str) -> io::Result<()> {
        *self.items.lock().unwrap() = vec![Placement {
            sticker_id: "cat".into(),
            display_id: primary_display_id.into(),
            relative_x: 0.72,
            relative_y: 0.31,
            relative_scale: 0.12,
            rotation: -7.0,
            placed_at: chrono::Utc::now().to_rfc3339(),
            is_on_desktop: true,
        }];
        self.flush()
    }

    /// Atomic write: temp file + rename, so a crash can't leave a half-written file.
    fn flush(&self) -> io::Result<()> {
        let Some(path) = self.path.lock().unwrap().clone() else {
            return Ok(());
        };
        let json = serde_json::to_vec_pretty(&*self.items.lock().unwrap())?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json)?;
        fs::rename(tmp, path)
    }
}
