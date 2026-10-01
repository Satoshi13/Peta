//! Peta core — everything that is true regardless of OS or UI.

pub mod db;
pub mod error;
pub mod ids;
pub mod image_import;
pub mod library;
pub mod models;

pub use db::Database;
pub use error::{Error, Result};
pub use image_import::{process_image, Processed};
pub use library::Library;
pub use models::{NewSticker, Placement, ProvenanceEntry, ProvenanceKind, SourceType, Sticker};
