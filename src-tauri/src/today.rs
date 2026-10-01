//! Today: the Daily Slot as the app sees it (spec §11-15).
//! Rules live in `peta_core::daily`; this module owns the clock, the Today window and the events.

use std::{
    path::PathBuf,
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
    materials, process_image, Database, Material, SlotState, SourceType, Sticker,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

use crate::{layers::Layers, platform, store::Store, tray};

pub const TODAY_LABEL: &str = "today";
/// Error string the UI recognises: today's new Peta has already been confirmed.
pub const ALREADY_USED: &str = "already_used_today";

/// Where a Peta made through the Today screen lands until the Print -> Grab -> Paste flow exists (Phase 4).
const DEFAULT_SPOT: (f64, f64) = (0.5, 0.45);

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
    let mut m = materials::get(id)?;
    m.unlocked_at = db.material_unlocked_at(id).ok().flatten();
    Some(m)
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
        material: if opened { material_view(db, &record.material_id) } else { None },
        slot,
        can_create: slot.can_add_new(),
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
}

// ---- opening the Today screen ----

pub fn open_window(app: &AppHandle) -> tauri::Result<()> {
    platform::activate_app(); // we're an Accessory app; bring the window to the front
    if let Some(w) = app.get_webview_window(TODAY_LABEL) {
        w.show()?;
        return w.set_focus();
    }
    WebviewWindowBuilder::new(app, TODAY_LABEL, WebviewUrl::App("today.html".into()))
        .title("Today's Peta")
        .inner_size(560.0, 720.0)
        .min_inner_size(460.0, 520.0)
        .center()
        .build()?;
    Ok(())
}

// ---- the actions ----

/// Which material a new Peta is made with: the one asked for (if unlocked), else today's (if opened), else Matte.
fn pick_material(db: &Database, record: &DailyRecord, requested: Option<&str>) -> String {
    let unlocked = db.unlocked_material_ids().unwrap_or_default();
    if let Some(id) = requested.filter(|id| unlocked.iter().any(|u| u == id)) {
        return id.to_owned();
    }
    if record.material_opened_at.is_some() {
        return record.material_id.clone();
    }
    materials::DEFAULT_MATERIAL.to_owned()
}

/// Make today's Peta from image bytes (Create) and stick it on the desktop. Confirms and spends the slot.
pub fn create_today(
    app: &AppHandle,
    bytes: &[u8],
    display_id: &str,
    (rx, ry): (f64, f64),
    material_id: Option<&str>,
) -> Result<Sticker, String> {
    let date = app.state::<Today>().date();
    let store = app.state::<Store>();

    // Cheap check first so a refused attempt doesn't pay for image decoding.
    {
        let mut lib = store.lock();
        let record = daily::ensure_today(lib.db_mut(), &date, random_unit()).map_err(|e| e.to_string())?;
        if !record.slot(false).can_add_new() {
            return Err(ALREADY_USED.into());
        }
    }
    let processed = process_image(bytes).map_err(|e| e.to_string())?; // slow: outside the lock

    let sticker = {
        let mut lib = store.lock();
        let record = daily::ensure_today(lib.db_mut(), &date, random_unit()).map_err(|e| e.to_string())?;
        if !record.slot(false).can_add_new() {
            return Err(ALREADY_USED.into()); // lost a race
        }
        let material = pick_material(lib.db(), &record, material_id);
        let sticker = lib.add_created(&processed, bytes, None, Some(&material)).map_err(|e| e.to_string())?;
        lib.stick_new(&sticker, display_id, rx, ry).map_err(|e| e.to_string())?;
        // Confirmed = point of no return; Used = it is on the desktop. (Phase 4 puts Print/Grab/Paste between them.)
        daily::confirm(lib.db_mut(), &date, &sticker.id, SourceType::Created, random_unit()).map_err(|e| e.to_string())?;
        daily::mark_used(lib.db_mut(), &date).map_err(|e| e.to_string())?;
        sticker
    };
    announce(app);
    Ok(sticker)
}

/// Use a sticker from the collection (peeled off, or never stuck) as today's Peta.
pub fn stick_from_collection(app: &AppHandle, sticker_id: &str, display_id: &str) -> Result<(), String> {
    let date = app.state::<Today>().date();
    let store = app.state::<Store>();
    {
        let mut lib = store.lock();
        let record = daily::ensure_today(lib.db_mut(), &date, random_unit()).map_err(|e| e.to_string())?;
        if !record.slot(false).can_add_new() {
            return Err(ALREADY_USED.into());
        }
        let sticker = lib
            .db()
            .sticker(sticker_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("unknown sticker {sticker_id}"))?;
        lib.stick_new(&sticker, display_id, DEFAULT_SPOT.0, DEFAULT_SPOT.1).map_err(|e| e.to_string())?;
        daily::confirm(lib.db_mut(), &date, sticker_id, SourceType::Collection, random_unit()).map_err(|e| e.to_string())?;
        daily::mark_used(lib.db_mut(), &date).map_err(|e| e.to_string())?;
    }
    announce(app);
    Ok(())
}

// ---- commands (called by the Today window) ----

#[tauri::command]
pub fn daily_status(app: AppHandle) -> Result<DailyStatus, String> {
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

/// Create: pick an image (native dialog), make today's Peta from it. Cancelling the dialog changes nothing.
#[tauri::command]
pub async fn daily_create(
    window: WebviewWindow,
    app: AppHandle,
    layers: State<'_, Layers>,
    material_id: Option<String>,
) -> Result<DailyStatus, String> {
    if !status(&app)?.can_create {
        return Err(ALREADY_USED.into());
    }
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
    create_today(&app, &bytes, &layers.primary_display_id(), DEFAULT_SPOT, material_id.as_deref())?;
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

// ---- developer switches (debug builds only show these in the menu) ----

pub fn dev_next_day(app: &AppHandle) {
    app.state::<Today>().day_offset.fetch_add(1, Ordering::SeqCst);
    roll_day(app);
}

/// Forget today's record (its sticker stays) so the slot, the draw and the envelope start over.
pub fn dev_reset_today(app: &AppHandle) {
    let date = app.state::<Today>().date();
    if let Err(e) = app.state::<Store>().lock().db_mut().daily_delete(&date) {
        eprintln!("[peta] reset today failed: {e}");
    }
    roll_day(app);
}

pub fn dev_import_paths(app: &AppHandle, paths: &[PathBuf]) {
    let primary = app.state::<Layers>().primary_display_id();
    app.state::<Store>().import_paths(paths, &primary, 0.5, 0.45);
    let _ = app.emit("placements-changed", ());
}
