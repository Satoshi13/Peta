//! Menu bar / system tray entry point (spec §52-53, reduced to what Phase 0 needs).

use std::{path::PathBuf, thread};

use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Wry,
};
use tauri_plugin_dialog::DialogExt;

use crate::{layers, platform, store::Store};

/// Kept in app state so Esc / the Done button can un-check the menu item.
pub struct EditItem(pub CheckMenuItem<Wry>);

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let edit = CheckMenuItem::with_id(app, "edit", "Edit Stickers", true, false, None::<&str>)?;
    let add_image = MenuItem::with_id(app, "add_image", "Add Image…", true, Some("CmdOrCtrl+O"))?;
    let add_sample = MenuItem::with_id(app, "add_sample", "Add Sample Cat", true, None::<&str>)?;
    let resync = MenuItem::with_id(app, "resync", "Re-sync Displays", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Peta", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(
        app,
        &[&edit, &PredefinedMenuItem::separator(app)?, &add_image, &add_sample, &resync, &PredefinedMenuItem::separator(app)?, &quit],
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
            "add_image" => {
                platform::activate_app(); // we're an Accessory app; without this the dialog opens behind other windows
                let app = app.clone();
                app.clone()
                    .dialog()
                    .file()
                    .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
                    .pick_files(move |picked| {
                        let Some(files) = picked else { return };
                        let paths: Vec<PathBuf> = files.into_iter().filter_map(|f| f.into_path().ok()).collect();
                        let primary = app.state::<layers::Layers>().primary_display_id();
                        app.state::<Store>().import_paths(&paths, &primary, 0.5, 0.45);
                        let _ = app.emit("placements-changed", ());
                    });
            }
            "add_sample" => {
                let app = app.clone();
                thread::spawn(move || {
                    let primary = app.state::<layers::Layers>().primary_display_id();
                    if let Err(e) = app.state::<Store>().add_sample(&primary) {
                        eprintln!("[peta] add sample failed: {e}");
                    }
                    let _ = app.emit("placements-changed", ());
                });
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
