//! Print → Grab → Paste (spec §26-29). Making a Peta does not stick it: it is *printed* at an abstract slot at
//! the top of the primary display and waits there until the player grabs it and sticks it down. Until then
//! the day's slot is CONFIRMED (not USED), which survives quitting the app: the Peta is there again next launch.

use peta_core::{daily, default_scale, ids::random_unit};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::{layers, layers::Layers, store::Store, today};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPrint {
    pub sticker_id: String,
    pub aspect: f64,
    pub material_id: Option<String>,
    /// Width as a fraction of the screen width: the size it will be stuck at.
    pub relative_scale: f64,
}

/// The Peta waiting at the print slot, if any (read from the library, so it survives a restart).
pub fn pending(app: &AppHandle) -> Result<Option<PendingPrint>, String> {
    let date = app.state::<today::Today>().date();
    let store = app.state::<Store>();
    let mut lib = store.lock();
    let record = daily::ensure_today(lib.db_mut(), &date, random_unit()).map_err(|e| e.to_string())?;
    let Some(id) = record.waiting_sticker() else { return Ok(None) };
    let Some(sticker) = lib.db().sticker(id).map_err(|e| e.to_string())? else { return Ok(None) };
    Ok(Some(PendingPrint {
        relative_scale: default_scale(sticker.aspect),
        aspect: sticker.aspect,
        material_id: sticker.material_id,
        sticker_id: sticker.id,
    }))
}

/// Make the layer match the library: grabbable if a Peta is waiting, resting otherwise.
pub fn sync(app: &AppHandle) {
    layers::set_print(app, matches!(pending(app), Ok(Some(_))));
}

/// Start (or resume) the print if a Peta is waiting: the primary layer becomes grabbable.
pub fn begin(app: &AppHandle) {
    if matches!(pending(app), Ok(Some(_))) {
        layers::set_print(app, true);
    }
}

#[tauri::command]
pub fn print_pending(app: AppHandle) -> Result<Option<PendingPrint>, String> {
    pending(&app)
}

/// Let go: stick it where the pointer is (centre as fractions of the primary display), spend the slot and enter Edit Mode.
#[tauri::command]
pub fn print_paste(app: AppHandle, layers: State<Layers>, store: State<Store>, sticker_id: String, x: f64, y: f64) -> Result<(), String> {
    let date = app.state::<today::Today>().date();
    {
        let mut lib = store.lock();
        let record = daily::ensure_today(lib.db_mut(), &date, random_unit()).map_err(|e| e.to_string())?;
        if record.waiting_sticker() != Some(sticker_id.as_str()) {
            return Err("nothing is waiting to be pasted".into());
        }
        let sticker = lib
            .db()
            .sticker(&sticker_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("unknown sticker {sticker_id}"))?;
        lib.stick_new(&sticker, &layers.primary_display_id(), x, y).map_err(|e| e.to_string())?;
        daily::mark_used(lib.db_mut(), &date).map_err(|e| e.to_string())?;
    }
    layers::set_print(&app, false);
    // Straight into Edit Mode: the new sticker can be resized, turned and moved right away instead of being stuck
    // before you have had a chance to adjust it. Esc / Done leaves it.
    layers::set_edit_mode(&app, true);
    today::announce(&app);
    Ok(())
}

/// Not now: the layer goes back to resting, the Peta keeps waiting (menu bar → Today's Peta brings it back).
#[tauri::command]
pub fn print_later(app: AppHandle) {
    layers::set_print(&app, false);
}

/// Resume after a ceremony, or from the tray. The pending print remains in Rust storage.
#[tauri::command]
pub fn print_resume(app: AppHandle) { begin(&app); }
