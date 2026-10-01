//! OS adapters (spec §69-70). The rest of the app only calls `apply_layer_mode`.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::apply_layer_mode;

#[cfg(not(target_os = "macos"))]
mod windows;
#[cfg(not(target_os = "macos"))]
pub use windows::apply_layer_mode;

/// How a desktop layer window should behave.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LayerMode {
    /// Stickers sit on the wallpaper, below desktop icons; all mouse events pass through.
    Resting,
    /// Layer is raised above desktop icons and receives mouse events.
    Editing,
}
