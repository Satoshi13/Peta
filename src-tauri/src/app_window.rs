//! One native shell. Desktop sticker layers and their placement APIs are independent.
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use crate::platform;
pub const APP_LABEL: &str = "peta-app";
pub fn open(app: &AppHandle, page: &str) -> tauri::Result<()> {
    platform::activate_app();
    if let Some(w) = app.get_webview_window(APP_LABEL) {
        w.unminimize()?;
        w.show()?;
        w.set_focus()?;
        w.emit("app-page", page)?;
    } else {
        WebviewWindowBuilder::new(app, APP_LABEL, WebviewUrl::App(format!("app.html?page={page}").into()))
            .title(if cfg!(feature="developer") { "Peta Developer" } else { "Peta" }).inner_size(1060.0, 700.0).min_inner_size(720.0, 520.0)
            .decorations(false).transparent(true).shadow(true).resizable(true).center().build()?;
    }
    Ok(())
}

/// Turn the translucent Studio sidebar material on or off. The page keeps its opaque sidebar unless this returns `true`.
#[tauri::command]
pub async fn window_vibrancy(window: tauri::WebviewWindow, enabled: bool) -> Result<bool, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let target = window.clone();
    window.run_on_main_thread(move || { let _ = tx.send(platform::set_sidebar_vibrancy(&target, enabled, 18.0)); }).map_err(|e| e.to_string())?;
    Ok(rx.recv().unwrap_or(false))
}

