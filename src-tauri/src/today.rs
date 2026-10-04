//! Today: one material envelope per local day, with unlimited sticker creation.
//! Rules live in `peta_core::daily`; this module owns the clock, the one-window Today route and the events.

use std::{
    sync::{
        atomic::{AtomicI64, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use peta_core::{
    daily::{self, DailyRecord},
    ids::random_unit,
    Database, Material, SlotState, SourceType,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::{creator, layers::Layers, store::Store, tray};

pub const TODAY_LABEL: &str = crate::app_window::APP_LABEL;
/// Where a Peta made through the Today screen lands until the Print -> Grab -> Paste flow exists (Phase 4).
pub const DEFAULT_SPOT: (f64, f64) = (0.5, 0.45);

#[derive(Default)]
pub struct Today {
    /// Developer "next day" switch. Always 0 in release builds.
    day_offset: AtomicI64,
    last_seen: Mutex<String>,
}

impl Today {
    /// Local date, `YYYY-MM-DD`. The slot resets when this changes (spec §13).
    pub fn date(&self) -> String {
        daily::local_today(self.day_offset.load(Ordering::SeqCst))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyStatus {
    pub date: String,
    /// Today's material is a surprise until the envelope is opened.
    pub material_opened: bool,
    pub bonus_envelopes: i64,
    pub material: Option<Material>,
    pub slot: SlotState,
    pub can_create: bool,
    /// The sticker that is today's Peta, once confirmed.
    pub sticker_id: Option<String>,
    /// Everything unlocked so far (the Material Book).
    pub unlocked: Vec<Material>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerSummary {
    pub id: String,
    pub original_number: Option<i64>,
    pub created_at: String,
    pub material_id: Option<String>,
    pub aspect: f64,
}

fn material_view(db: &Database, id: &str) -> Option<Material> {
    db.material_with_stock(id).ok().flatten()
}

fn build_status(app: &AppHandle, record: &DailyRecord, db: &Database) -> DailyStatus {
    let opened = record.material_opened_at.is_some();
    // the Today screen being open is the SELECTING state (spec §12)
    let selecting = app.get_webview_window(TODAY_LABEL).is_some();
    let slot = record.slot(selecting);
    let unlocked = db
        .unlocked_material_ids()
        .unwrap_or_default()
        .iter()
        .filter_map(|id| material_view(db, id))
        .collect();
    DailyStatus {
        date: record.date.clone(),
        material_opened: opened,
        bonus_envelopes: db.bonus_envelopes().unwrap_or(0),
        material: if opened { material_view(db, &record.material_id) } else { None },
        slot,
        can_create: peta_core::materials::catalog().iter().any(|m| db.has_material(&m.id).unwrap_or(false)),
        sticker_id: record.sticker_id.clone(),
        unlocked,
    }
}

/// Today's status; draws the day's material on first call of the day.
pub fn status(app: &AppHandle) -> Result<DailyStatus, String> {
    let date = app.state::<Today>().date();
    let store = app.state::<Store>();
    let mut lib = store.lock();
    let record = daily::ensure_today(lib.db_mut(), &date, random_unit()).map_err(|e| e.to_string())?;
    Ok(build_status(app, &record, lib.db()))
}

/// Tell every window (and the menu bar) that something about today changed.
pub fn announce(app: &AppHandle) {
    let _ = app.emit("daily-changed", ());
    let _ = app.emit("placements-changed", ());
    tray::refresh_today(app);
    crate::arrival::sync(app);
}

// ---- opening the Today screen ----

pub fn open_window(app: &AppHandle) -> tauri::Result<()> {
    crate::app_window::open(app, "today")
}

// ---- the actions ----

/// Use a sticker from the collection (peeled off, or never stuck) as today's Peta.
pub fn stick_from_collection(app: &AppHandle, sticker_id: &str, _display_id: &str) -> Result<(), String> {
    let date = app.state::<Today>().date();
    let store = app.state::<Store>();
    {
        let mut lib = store.lock();
        let _sticker = lib
            .db()
            .sticker(sticker_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("unknown sticker {sticker_id}"))?;
        daily::confirm(lib.db_mut(), &date, sticker_id, SourceType::Collection, random_unit()).map_err(|e| e.to_string())?;
    }
    announce(app);
    Ok(())
}

// ---- commands (called by the Today window) ----

#[tauri::command]
pub fn daily_status(app: AppHandle) -> Result<DailyStatus, String> {
    let today = app.state::<Today>();
    let changed = *today.last_seen.lock().unwrap() != today.date();
    if changed { roll_day(&app); }
    status(&app)
}

/// Open the envelope: today's material is yours and joins the Material Book.
#[tauri::command]
pub fn daily_open_material(app: AppHandle, store: State<Store>, today: State<Today>) -> Result<DailyStatus, String> {
    {
        let mut lib = store.lock();
        daily::open_material(lib.db_mut(), &today.date(), random_unit()).map_err(|e| e.to_string())?;
    }
    announce(&app);
    status(&app)
}

/// Create: pick an image (native dialog), then cut it out on the Cutting Mat. Cancelling the dialog changes
/// nothing; nothing is spent until "Make this Peta" there.
#[tauri::command]
pub async fn daily_create(
    window: WebviewWindow,
    app: AppHandle,
    layers: State<'_, Layers>,
    material_id: Option<String>,
) -> Result<DailyStatus, String> {
    let picked = app
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .blocking_pick_file();
    let Some(path) = picked.and_then(|f| f.into_path().ok()) else {
        return status(&app); // cancelled: nothing is consumed
    };
    let bytes = std::fs::read(&path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    creator::begin(
        &app,
        bytes,
        creator::Target {
            display_id: layers.primary_display_id(),
            x: DEFAULT_SPOT.0,
            y: DEFAULT_SPOT.1,
            counts_for_today: true,
            material_hint: material_id,
        },
    )?;
    status(&app)
}

/// Stickers that are not on the desktop right now.
#[tauri::command]
pub fn collection_unused(store: State<Store>) -> Result<Vec<StickerSummary>, String> {
    let lib = store.lock();
    let stickers = lib.db().off_desktop().map_err(|e| e.to_string())?;
    Ok(stickers
        .into_iter()
        .map(|s| StickerSummary {
            id: s.id,
            original_number: s.original_number,
            created_at: s.created_at,
            material_id: s.material_id,
            aspect: s.aspect,
        })
        .collect())
}

#[tauri::command]
pub fn daily_stick_from_collection(app: AppHandle, layers: State<Layers>, sticker_id: String) -> Result<DailyStatus, String> {
    stick_from_collection(&app, &sticker_id, &layers.primary_display_id())?;
    status(&app)
}

// ---- day rollover ----

/// Called on startup and whenever the date may have changed.
pub fn roll_day(app: &AppHandle) {
    let today = app.state::<Today>();
    let date = today.date();
    *today.last_seen.lock().unwrap() = date;
    if let Err(e) = status(app) {
        eprintln!("[peta] rolling the day failed: {e}");
    }
    announce(app);
    crate::print::sync(app); // a Peta made but never pasted is waiting at the print slot again (or no longer)
}

/// The slot resets at local midnight even if Peta stays open (spec §13). Cheap poll; no OS hooks needed.
pub fn spawn_day_watcher(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(30));
        let today = app.state::<Today>();
        let changed = *today.last_seen.lock().unwrap() != today.date();
        if changed {
            roll_day(&app);
        }
    });
}
