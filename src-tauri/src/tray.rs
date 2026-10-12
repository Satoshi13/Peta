//! Menu bar / system tray entry point (spec §52-53). Only what exists so far is listed.

use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Wry,
};
use crate::{layers, today};

/// Kept in app state so Esc / the Done button can un-check the menu item.
pub struct EditItem(pub CheckMenuItem<Wry>);
/// Kept in app state so the label can show the arrival indicator.
pub struct TodayItem(pub MenuItem<Wry>);
/// Retain the actual tray menu for development-only native capture.
pub struct TrayMenu(pub Menu<Wry>);

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let today_item = MenuItem::with_id(app, "today", "Open Peta", true, None::<&str>)?;
    let edit = CheckMenuItem::with_id(app, "edit", "Edit stickers", true, false, None::<&str>)?;
    let redeem=MenuItem::with_id(app,"redeem","Redeem Code…",true,None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Peta", true, Some("CmdOrCtrl+Q"))?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&today_item, &edit, &sep, &redeem, &settings, &quit])?;
    app.manage(TrayMenu(menu.clone()));

    app.manage(EditItem(edit.clone()));
    app.manage(TodayItem(today_item));

    TrayIconBuilder::with_id("peta")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true) // macOS: adapts to light/dark menu bar
        .tooltip(if cfg!(feature="developer") { "Peta Developer" } else { "Peta" })
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "today" => { let _ = today::open_window(app); }
            "redeem" => {let _=crate::app_window::open(app,"redeem");}
            "settings" => { let _ = crate::app_window::open(app, "settings"); }
            // The checkbox toggles itself; read its new state.
            "edit" => layers::set_edit_mode(app, edit.is_checked().unwrap_or(false)),
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
        Ok(s) if s.material_opened && s.bonus_envelopes>0 => "An extra envelope from Peta.",
        Ok(s) if !s.material_opened => "Open Peta  ●",
        Ok(s) if matches!(s.slot, peta_core::SlotState::Confirmed | peta_core::SlotState::Used) => "Open Peta  ✓",
        _ => "Open Peta",
    };
    let _ = item.0.set_text(label);
}
