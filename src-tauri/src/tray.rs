//! Menu bar / system tray entry point (spec §52-53). Only what exists so far is listed.

use crate::{layers, today};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Manager, Wry,
};

/// Kept in app state so Esc / the Done button can un-check the menu item.
pub struct EditItem(pub CheckMenuItem<Wry>);
/// Kept in app state so the label can show the arrival indicator.
pub struct TodayItem(pub MenuItem<Wry>);
/// Retain the actual tray menu for development-only native capture.
pub struct TrayMenu(pub Menu<Wry>);
struct BoardsMenu {
    menu: Submenu<Wry>,
    actions: Mutex<HashMap<String, (String, String)>>,
    generation: AtomicU64,
}
struct BoardChoice {
    display: String,
    board: String,
    name: String,
    checked: bool,
    heading: bool,
}
fn board_choices(status: &peta_core::boards::Status) -> Vec<BoardChoice> {
    let screens = status
        .screens
        .iter()
        .filter(|s| s.connected)
        .collect::<Vec<_>>();
    screens
        .iter()
        .flat_map(|screen| {
            status.boards.iter().enumerate().map(|(i, b)| BoardChoice {
                display: screen.id.clone(),
                board: b.board.id.clone(),
                name: b.board.name.clone(),
                checked: screen.board.as_deref() == Some(&b.board.id),
                heading: screens.len() > 1 && i == 0,
            })
        })
        .collect()
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let today_item = MenuItem::with_id(app, "today", "Open Peta", true, None::<&str>)?;
    let edit = CheckMenuItem::with_id(app, "edit", "Edit stickers", true, false, None::<&str>)?;
    let redeem = MenuItem::with_id(app, "redeem", "Redeem Code…", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Peta", true, Some("CmdOrCtrl+Q"))?;
    let sep = PredefinedMenuItem::separator(app)?;
    let boards = Submenu::with_id(app, "boards", "Boards", true)?;
    let menu = Menu::with_items(
        app,
        &[&today_item, &edit, &boards, &sep, &redeem, &settings, &quit],
    )?;
    app.manage(BoardsMenu {
        menu: boards,
        actions: Mutex::new(HashMap::new()),
        generation: AtomicU64::new(0),
    });
    app.manage(TrayMenu(menu.clone()));

    app.manage(EditItem(edit.clone()));
    app.manage(TodayItem(today_item));

    TrayIconBuilder::with_id("peta")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true) // macOS: adapts to light/dark menu bar
        .tooltip(if cfg!(feature = "developer") {
            "Peta Developer"
        } else {
            "Peta"
        })
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "today" => {
                let _ = today::open_window(app);
            }
            "redeem" => {
                let _ = crate::app_window::open(app, "redeem");
            }
            "settings" => {
                let _ = crate::app_window::open(app, "settings");
            }
            // The checkbox toggles itself; read its new state.
            "edit" => layers::set_edit_mode(app, edit.is_checked().unwrap_or(false)),
            "boards-open" => {
                let _ = crate::app_window::open(app, "boards");
            }
            "boards-save" => {
                let _ = crate::app_window::open(app, "boards-save");
            }
            "boards-undo" => match crate::boards::undo(app) {
                Ok(r) => crate::board_auto::notify(
                    app,
                    if r.as_ref().is_some_and(|r| !r.skipped.is_empty()) {
                        format!(
                            "{} stickers could not be restored.",
                            r.unwrap().skipped.len()
                        )
                    } else {
                        "The previous look is back.".into()
                    },
                ),
                Err(_) => crate::board_auto::notify(app, "Could not restore this look.".into()),
            },
            "quit" => app.exit(0),
            id => {
                let action = app
                    .try_state::<BoardsMenu>()
                    .and_then(|s| s.actions.lock().unwrap().get(id).cloned());
                if let Some((board, display)) = action {
                    match crate::boards::put(app, &board, &display) {
                        Ok(result) => crate::board_auto::notify(
                            app,
                            format!(
                                "Board put on {display}{}",
                                if result.skipped.is_empty() {
                                    String::new()
                                } else {
                                    format!(" · {} skipped", result.skipped.len())
                                }
                            ),
                        ),
                        Err(_) => crate::board_auto::notify(
                            app,
                            "Could not put this board on the screen.".into(),
                        ),
                    }
                }
            }
        })
        .build(app)?;
    refresh_boards(app);
    Ok(())
}

pub fn sync_edit_checkbox(app: &AppHandle, on: bool) {
    if let Some(item) = app.try_state::<EditItem>() {
        let _ = item.0.set_checked(on);
    }
}

/// Arrival indicator (spec §53): a dot while Today's Material is unopened, a check once today's Peta is stuck.
pub fn refresh_today(app: &AppHandle) {
    let Some(item) = app.try_state::<TodayItem>() else {
        return;
    };
    let label = match today::status(app) {
        Ok(s) if s.material_opened && s.bonus_envelopes > 0 => "An extra envelope from Peta.",
        Ok(s) if !s.material_opened => "Open Peta  ●",
        Ok(s)
            if matches!(
                s.slot,
                peta_core::SlotState::Confirmed | peta_core::SlotState::Used
            ) =>
        {
            "Open Peta  ✓"
        }
        _ => "Open Peta",
    };
    let _ = item.0.set_text(label);
}

/// Queue a rebuild on the main thread after releasing Store/topology locks.
pub fn refresh_boards(app: &AppHandle) {
    if app.try_state::<BoardsMenu>().is_none() {
        return;
    }
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = rebuild_boards(&handle);
    });
}
fn rebuild_boards(app: &AppHandle) -> tauri::Result<()> {
    let Ok(view) = crate::boards::status(app) else {
        return Ok(());
    };
    let state = app.state::<BoardsMenu>();
    let generation = state.generation.fetch_add(1, Ordering::Relaxed);
    let mut actions = HashMap::new();
    while state.menu.remove_at(0)?.is_some() {}
    let choices = board_choices(&view.status);
    if choices.is_empty() {
        state
            .menu
            .append(&MenuItem::new(app, "No boards yet", false, None::<&str>)?)?;
    }
    for (i, choice) in choices.into_iter().enumerate() {
        if choice.heading {
            let name = view
                .displays
                .iter()
                .find(|d| d.id == choice.display)
                .map(|d| d.name.as_str())
                .unwrap_or(&choice.display);
            state
                .menu
                .append(&MenuItem::new(app, name, false, None::<&str>)?)?;
        }
        let id = format!("boards-put-{generation}-{i}");
        state.menu.append(&CheckMenuItem::with_id(
            app,
            &id,
            &choice.name,
            true,
            choice.checked,
            None::<&str>,
        )?)?;
        actions.insert(id, (choice.board, choice.display));
    }
    state.menu.append(&PredefinedMenuItem::separator(app)?)?;
    state.menu.append(&MenuItem::with_id(
        app,
        "boards-undo",
        "Undo",
        view.status.undo.is_some(),
        None::<&str>,
    )?)?;
    state.menu.append(&MenuItem::with_id(
        app,
        "boards-save",
        "Save this screen as a board…",
        true,
        None::<&str>,
    )?)?;
    state.menu.append(&MenuItem::with_id(
        app,
        "boards-open",
        "Open Boards…",
        true,
        None::<&str>,
    )?)?;
    *state.actions.lock().unwrap() = actions;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn board_choices_target_only_connected_screens_and_check_native_matches() {
        use peta_core::boards::*;
        let mut status = Status {
            screens: vec![
                Screen {
                    id: "one".into(),
                    connected: true,
                    primary: true,
                    items: vec![],
                    board: Some("b".into()),
                },
                Screen {
                    id: "two".into(),
                    connected: true,
                    primary: false,
                    items: vec![],
                    board: None,
                },
                Screen {
                    id: "stored".into(),
                    connected: false,
                    primary: false,
                    items: vec![],
                    board: Some("b".into()),
                },
            ],
            boards: vec![BoardStatus {
                board: Board {
                    id: "b".into(),
                    name: "Work".into(),
                    sort: 0,
                    created_at: "".into(),
                    updated_at: "".into(),
                    items: vec![],
                },
                stickers: vec![],
            }],
            rules: vec![],
            stock: Stock {
                owned: 2,
                available: 1,
                limit: 12,
            },
            undo: None,
        };
        let rows = board_choices(&status);
        assert_eq!(rows.len(), 2);
        assert!(rows[0].checked);
        assert!(!rows[1].checked);
        assert!(rows.iter().all(|r| r.heading));
        assert_eq!(rows[1].display, "two");
        status.screens[1].connected = false;
        let rows = board_choices(&status);
        assert_eq!(rows.len(), 1);
        assert!(!rows[0].heading);
        status.boards.clear();
        assert!(board_choices(&status).is_empty());
    }
}
