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
            .title("Peta").inner_size(1060.0, 700.0).min_inner_size(720.0, 520.0)
            .decorations(false).transparent(true).shadow(false).resizable(true).center().build()?;
    }
    Ok(())
}
