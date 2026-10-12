//! Native boundary for local Boards. Copy display state before locking the library.
use crate::{layers::Layers, store::Store};
use peta_core::boards::{Board, PutResult, Rule, Status};
use tauri::{AppHandle, Emitter, Manager};
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    #[serde(flatten)]
    pub status: Status,
    pub displays: Vec<crate::layers::DisplayInfo>,
}
fn connected(app: &AppHandle) -> Vec<String> {
    app.state::<Layers>()
        .snapshot()
        .0
        .into_iter()
        .map(|d| d.id)
        .collect()
}
fn require_connected(app: &AppHandle, id: &str) -> Result<(), String> {
    if connected(app).iter().any(|d| d == id) {
        Ok(())
    } else {
        Err("screen_not_connected".into())
    }
}
pub fn status(app: &AppHandle) -> Result<View, String> {
    let (displays, primary) = app.state::<Layers>().snapshot();
    let ids = displays.iter().map(|d| d.id.clone()).collect::<Vec<_>>();
    let status = app
        .state::<Store>()
        .lock()
        .db()
        .boards_status(&ids, &primary)
        .map_err(|e| e.to_string())?;
    Ok(View { status, displays })
}
pub fn announce(app: &AppHandle) {
    let _ = app.emit("placements-changed", ());
    let _ = app.emit("boards-changed", ());
}
pub fn put(app: &AppHandle, id: &str, display: &str) -> Result<PutResult, String> {
    let ids = connected(app);
    let r = app
        .state::<Store>()
        .lock()
        .db_mut()
        .board_put(id, display, &ids)
        .map_err(|e| e.to_string())?;
    announce(app);
    Ok(r)
}
pub fn undo(app: &AppHandle) -> Result<Option<PutResult>, String> {
    let r = app
        .state::<Store>()
        .lock()
        .db_mut()
        .board_undo()
        .map_err(|e| e.to_string())?;
    announce(app);
    Ok(r)
}
#[tauri::command]
pub async fn boards_status(app: AppHandle) -> Result<View, String> {
    status(&app)
}
#[tauri::command]
pub async fn boards_save(
    app: AppHandle,
    display_id: String,
    name: String,
) -> Result<Board, String> {
    require_connected(&app, &display_id)?;
    let r = app
        .state::<Store>()
        .lock()
        .db_mut()
        .board_save(&display_id, &name)
        .map_err(|e| e.to_string())?;
    announce(&app);
    Ok(r)
}
#[tauri::command]
pub async fn boards_update(
    app: AppHandle,
    board_id: String,
    display_id: String,
) -> Result<(), String> {
    require_connected(&app, &display_id)?;
    app.state::<Store>()
        .lock()
        .db_mut()
        .board_update(&board_id, &display_id)
        .map_err(|e| e.to_string())?;
    announce(&app);
    Ok(())
}
#[tauri::command]
pub async fn boards_rename(app: AppHandle, board_id: String, name: String) -> Result<(), String> {
    app.state::<Store>()
        .lock()
        .db_mut()
        .board_rename(&board_id, &name)
        .map_err(|e| e.to_string())?;
    announce(&app);
    Ok(())
}
#[tauri::command]
pub async fn boards_delete(app: AppHandle, board_id: String) -> Result<(), String> {
    app.state::<Store>()
        .lock()
        .db_mut()
        .board_delete(&board_id)
        .map_err(|e| e.to_string())?;
    announce(&app);
    Ok(())
}
#[tauri::command]
pub async fn boards_put(
    app: AppHandle,
    board_id: String,
    display_id: String,
) -> Result<PutResult, String> {
    put(&app, &board_id, &display_id)
}
#[tauri::command]
pub async fn boards_undo(app: AppHandle) -> Result<Option<PutResult>, String> {
    undo(&app)
}
#[tauri::command]
pub async fn boards_bring_here(
    app: AppHandle,
    from_display: String,
    to_display: String,
) -> Result<usize, String> {
    let ids = connected(&app);
    if ids.contains(&from_display) || !ids.contains(&to_display) {
        return Err("Choose a stored screen and a connected screen.".into());
    }
    let n = app
        .state::<Store>()
        .lock()
        .db_mut()
        .board_bring_here(&from_display, &to_display)
        .map_err(|e| e.to_string())?;
    announce(&app);
    Ok(n)
}
#[tauri::command]
pub async fn board_rule_save(app: AppHandle, rule: Rule) -> Result<Rule, String> {
    let ids = connected(&app);
    let r = app
        .state::<Store>()
        .lock()
        .db_mut()
        .board_rule_save(rule, &ids)
        .map_err(|e| e.to_string())?;
    announce(&app);
    Ok(r)
}
#[tauri::command]
pub async fn board_rule_delete(app: AppHandle, rule_id: String) -> Result<(), String> {
    app.state::<Store>()
        .lock()
        .db_mut()
        .board_rule_delete(&rule_id)
        .map_err(|e| e.to_string())?;
    announce(&app);
    Ok(())
}
#[tauri::command]
pub async fn board_rule_move(
    app: AppHandle,
    rule_id: String,
    direction: String,
) -> Result<(), String> {
    app.state::<Store>()
        .lock()
        .db_mut()
        .board_rule_move(&rule_id, &direction)
        .map_err(|e| e.to_string())?;
    announce(&app);
    Ok(())
}
#[tauri::command]
pub async fn board_rule_toggle(app: AppHandle, rule_id: String) -> Result<(), String> {
    app.state::<Store>()
        .lock()
        .db_mut()
        .board_rule_toggle(&rule_id)
        .map_err(|e| e.to_string())?;
    announce(&app);
    Ok(())
}
