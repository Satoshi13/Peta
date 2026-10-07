//! Print → Grab → Paste (spec §26-29). Making a Peta does not stick it: it is *printed* at an abstract slot at
//! the top of the primary display and waits there until the player grabs it and sticks it down. Until then
//! the durable FIFO queue retains every pending sticker, across local midnight and app restarts.

use peta_core::{default_scale, ids::random_unit};
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
    let store = app.state::<Store>();
    let lib = store.lock();
    let Some(id) = lib.db().next_print().map_err(|e|e.to_string())? else { return Ok(None) };
    let Some(sticker) = lib.db().sticker(&id).map_err(|e| e.to_string())? else { return Ok(None) };
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

/// Let go: stick it where the pointer is (centre as fractions of the primary display), finish this queued print and enter Edit Mode.
#[tauri::command]
pub fn print_paste(app: AppHandle, layers: State<Layers>, store: State<Store>, sticker_id: String, x: f64, y: f64, relative_scale: Option<f64>) -> Result<(), String> {
    {
        let mut lib = store.lock();
        if lib.db().next_print().map_err(|e|e.to_string())?.as_deref()!=Some(sticker_id.as_str()) {
            return Err("nothing is waiting to be pasted".into());
        }
        let sticker = lib
            .db()
            .sticker(&sticker_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("unknown sticker {sticker_id}"))?;
        let mut placement=lib.stick_new(&sticker, &layers.primary_display_id(), x, y).map_err(|e| e.to_string())?;
        if let Some(scale)=relative_scale.filter(|v|v.is_finite()&&*v>0.0) {
            placement.relative_scale=scale.clamp(0.01,1.0);
            placement.rotation=((random_unit()*14.0)-7.0).round();
            lib.db_mut().place(placement).map_err(|e|e.to_string())?;
        }
        lib.db_mut().finish_print(&sticker_id).map_err(|e|e.to_string())?;
    }
    // Keep later jobs queued until an explicit Resume; don't feed another sheet while this Peta is being adjusted.
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
/// `sticker_ids` are the ones the person has just chosen to stick: they print first, in that order, ahead of anything that was already waiting.
pub fn print_resume(app: AppHandle, store: State<Store>, sticker_ids: Option<Vec<String>>) -> Result<(), String> {
    if let Some(ids) = sticker_ids.filter(|ids| !ids.is_empty()) {
        let ids: Vec<&str> = ids.iter().map(String::as_str).collect();
        store.lock().db_mut().print_prioritize(&ids).map_err(|e| e.to_string())?;
    }
    begin(&app);
    Ok(())
}
