//! Menu bar / system tray entry point (spec §52-53, reduced to what Phase 0 needs).

use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Wry,
};

use crate::{layers, placements::Store};

/// Kept in app state so Esc / the Done button can un-check the menu item.
pub struct EditItem(pub CheckMenuItem<Wry>);

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let edit = CheckMenuItem::with_id(app, "edit", "Edit Stickers", true, false, None::<&str>)?;
    let reset = MenuItem::with_id(app, "reset", "Reset Test Sticker", true, None::<&str>)?;
    let resync = MenuItem::with_id(app, "resync", "Re-sync Displays", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Peta", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(
        app,
        &[&edit, &PredefinedMenuItem::separator(app)?, &reset, &resync, &PredefinedMenuItem::separator(app)?, &quit],
    )?;
    app.manage(EditItem(edit.clone()));

    TrayIconBuilder::with_id("peta")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true) // macOS: adapts to light/dark menu bar
        .tooltip("Peta")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            // A CheckMenuItem toggles itself on click; read the new state.
            "edit" => layers::set_edit_mode(app, edit.is_checked().unwrap_or(false)),
            "reset" => {
                let primary = app.state::<layers::Layers>().primary_display_id();
                if let Err(e) = app.state::<Store>().reset(&primary) {
                    eprintln!("[peta] reset failed: {e}");
                }
                if let Err(e) = layers::sync(app) {
                    eprintln!("[peta] re-sync failed: {e}");
                }
            }
            "resync" => {
                if let Err(e) = layers::sync(app) {
                    eprintln!("[peta] re-sync failed: {e}");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn sync_edit_checkbox(app: &AppHandle, on: bool) {
    if let Some(item) = app.try_state::<EditItem>() {
        let _ = item.0.set_checked(on);
    }
}
