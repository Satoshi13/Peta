//! OS adapters (spec §69-70). The rest of the app only calls `apply_layer_mode`.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::{activate_app, apply_layer_mode, cursor_position, layer_frame};

#[cfg(not(target_os = "macos"))]
mod windows;
#[cfg(not(target_os = "macos"))]
pub use windows::{activate_app, apply_layer_mode, cursor_position, layer_frame};

/// How a desktop layer window should behave.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LayerMode {
    /// Stickers sit on the wallpaper, below desktop icons; all mouse events pass through.
    Resting,
    /// Layer is raised above desktop icons and receives mouse events.
    Editing,
}

pub mod coordinates;
