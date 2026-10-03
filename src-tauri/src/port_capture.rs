//! Development-only native capture bridge. Enabled only by PETA_PORT_CAPTURE_DIR in a debug build.
//! The capture runner sends one script at a time and gets the result through the actual Tauri IPC.
use tauri::{AppHandle, Manager, WebviewWindow};
#[tauri::command]
pub fn port_capture_report(window: WebviewWindow, result: serde_json::Value) -> Result<(), String> {
    if !cfg!(debug_assertions) || window.label() != crate::app_window::APP_LABEL { return Err("capture disabled".into()); }
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
                if let Some(w) = app.get_webview_window(crate::app_window::APP_LABEL) { let _ = w.eval(&script); }
            }
        }
    });
}
