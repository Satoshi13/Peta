//! Development-only native capture bridge. Enabled only by PETA_PORT_CAPTURE_DIR in a debug build.
//! The capture runner sends one script at a time and gets the result through the actual Tauri IPC.
use tauri::{AppHandle, Manager, WebviewWindow};
#[tauri::command]
pub fn port_capture_report(window: WebviewWindow, result: serde_json::Value) -> Result<(), String> {
    if !cfg!(debug_assertions) || (window.label() != crate::app_window::APP_LABEL && !window.label().starts_with("layer-")) { return Err("capture disabled".into()); }
    let dir = std::env::var("PETA_PORT_CAPTURE_DIR").map_err(|_| "capture disabled")?;
    std::fs::write(std::path::Path::new(&dir).join("result.json"), result.to_string()).map_err(|e| e.to_string())
}
pub fn start(app: &AppHandle) {
    if !cfg!(debug_assertions) { return; }
    let Ok(dir) = std::env::var("PETA_PORT_CAPTURE_DIR") else { return };
    let app = app.clone();
    let _ = crate::app_window::open(&app, "settings");
    std::thread::spawn(move || {
        let command = std::path::Path::new(&dir).join("command.js");
        loop {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(script) = std::fs::read_to_string(&command) {
                let _ = std::fs::remove_file(&command);
                let message=serde_json::from_str::<serde_json::Value>(&script).ok();
                let label=message.as_ref().and_then(|m|m["label"].as_str()).unwrap_or(crate::app_window::APP_LABEL);
                let source=message.as_ref().and_then(|m|m["script"].as_str()).unwrap_or(&script);
                if label==crate::app_window::APP_LABEL||label.starts_with("layer-") { if let Some(w)=app.get_webview_window(label) { let _=w.eval(source); } }
            }
        }
    });
}

/// Inspect / display the very same native Menu instance installed on the tray (never HTML).
#[tauri::command]
pub fn port_capture_tray(window: WebviewWindow, popup: bool) -> Result<serde_json::Value, String> {
    use tauri::menu::{ContextMenu, MenuItemKind};
    if !cfg!(debug_assertions) || window.label()!=crate::app_window::APP_LABEL || std::env::var("PETA_PORT_CAPTURE_DIR").is_err() {
        return Err("capture disabled".into());
    }
    let menu=&window.state::<crate::tray::TrayMenu>().0;
    let mut items=Vec::new();
    for item in menu.items().map_err(|e|e.to_string())? {
        let value=match item {
            MenuItemKind::MenuItem(i)=>serde_json::json!({"id":i.id().as_ref(),"text":i.text().map_err(|e|e.to_string())?,"enabled":i.is_enabled().map_err(|e|e.to_string())?}),
            MenuItemKind::Check(i)=>serde_json::json!({"id":i.id().as_ref(),"text":i.text().map_err(|e|e.to_string())?,"enabled":i.is_enabled().map_err(|e|e.to_string())?,"checked":i.is_checked().map_err(|e|e.to_string())?}),
            MenuItemKind::Predefined(_)=>serde_json::json!({"separator":true}),
            _=>return Err("unexpected tray menu item".into()),
        };
        items.push(value);
    }
    if popup { menu.popup_at(window.as_ref().window().clone(), tauri::LogicalPosition::new(200.0,80.0)).map_err(|e|e.to_string())?; }
    Ok(serde_json::json!({"items":items}))
}
