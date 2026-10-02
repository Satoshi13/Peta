//! Menu bar / system tray entry point (spec §52-53). Only what exists so far is listed.

use std::thread;

use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Wry,
};
use tauri_plugin_dialog::DialogExt;

use crate::{collection, layers, platform, store::Store, today};

/// Kept in app state so Esc / the Done button can un-check the menu item.
pub struct EditItem(pub CheckMenuItem<Wry>);
/// Kept in app state so the label can show the arrival indicator.
pub struct TodayItem(pub MenuItem<Wry>);

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let today_item = MenuItem::with_id(app, "today", "Today's Peta", true, None::<&str>)?;
    let collection = MenuItem::with_id(app, "collection", "Collection", true, None::<&str>)?;
    let edit = CheckMenuItem::with_id(app, "edit", "Edit Stickers", true, false, None::<&str>)?;
    let resync = MenuItem::with_id(app, "resync", "Re-sync Displays", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Peta", true, Some("CmdOrCtrl+Q"))?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    // Developer tools exist only in debug builds. They bypass or bend the daily rule on purpose.
    let dev: Option<Submenu<Wry>> = if cfg!(debug_assertions) {
        let add_image = MenuItem::with_id(app, "dev_add_image", "Cut Out Image… (ignores daily rule)", true, None::<&str>)?;
        let add_sample = MenuItem::with_id(app, "dev_add_sample", "Add Sample Cat (ignores daily rule)", true, None::<&str>)?;
        let next_day = MenuItem::with_id(app, "dev_next_day", "Next Day (+1 day)", true, None::<&str>)?;
        let reset_today = MenuItem::with_id(app, "dev_reset_today", "Reset Today", true, None::<&str>)?;
        Some(Submenu::with_items(
            app,
            "Developer",
            true,
            &[&add_image, &add_sample, &PredefinedMenuItem::separator(app)?, &next_day, &reset_today],
        )?)
    } else {
        None
    };

    let mut items: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = vec![&today_item, &collection, &edit, &sep1];
    if let Some(dev) = dev.as_ref() {
        items.push(dev);
    }
    items.extend_from_slice(&[&resync, &sep2, &quit]);
    let menu = Menu::with_items(app, &items)?;

    app.manage(EditItem(edit.clone()));
    app.manage(TodayItem(today_item));

    TrayIconBuilder::with_id("peta")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true) // macOS: adapts to light/dark menu bar
        .tooltip("Peta")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "today" => {
                if let Err(e) = today::open_window(app) {
                    eprintln!("[peta] could not open Today: {e}");
                }
            }
            "collection" => {
                if let Err(e) = collection::open_window(app) {
                    eprintln!("[peta] could not open the Sticker Book: {e}");
                }
            }
            // A CheckMenuItem toggles itself on click; read the new state.
            "edit" => layers::set_edit_mode(app, edit.is_checked().unwrap_or(false)),
            "resync" => {
                if let Err(e) = layers::sync(app) {
                    eprintln!("[peta] re-sync failed: {e}");
                }
            }
            "dev_add_image" => {
                platform::activate_app(); // Accessory app: otherwise the dialog opens behind other windows
                let app = app.clone();
                app.clone()
                    .dialog()
                    .file()
                    .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
                    .pick_file(move |picked| {
                        if let Some(path) = picked.and_then(|f| f.into_path().ok()) {
                            today::dev_open_image(&app, &path);
                        }
                    });
            }
            "dev_add_sample" => {
                let app = app.clone();
                thread::spawn(move || {
                    let primary = app.state::<layers::Layers>().primary_display_id();
                    if let Err(e) = app.state::<Store>().add_sample(&primary) {
                        eprintln!("[peta] add sample failed: {e}");
                    }
                    let _ = app.emit("placements-changed", ());
                });
            }
            "dev_next_day" => today::dev_next_day(app),
            "dev_reset_today" => today::dev_reset_today(app),
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

/// Arrival indicator (spec §53): a dot while Today's Material is unopened, a check once today's Peta is stuck.
pub fn refresh_today(app: &AppHandle) {
    let Some(item) = app.try_state::<TodayItem>() else { return };
    let label = match today::status(app) {
        Ok(s) if !s.material_opened => "Today's Peta  ●",
        Ok(s) if matches!(s.slot, peta_core::SlotState::Confirmed | peta_core::SlotState::Used) => "Today's Peta  ✓",
        _ => "Today's Peta",
    };
    let _ = item.0.set_text(label);
}
