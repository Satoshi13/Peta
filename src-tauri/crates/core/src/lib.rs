//! Peta core — everything that is true regardless of OS or UI.

pub mod back;
pub mod book;
pub mod creator;
pub mod cutout;
pub mod daily;
pub mod db;
pub mod error;
pub mod ids;
pub mod image_import;
pub mod library;
pub mod materials;
pub mod models;
pub mod segment;
pub mod sticker;

pub use back::StickerBack;
pub use book::{BookEntry, MonthIndex};
pub use daily::{DailyRecord, SlotState};
pub use db::Database;
pub use error::{Error, Result};
pub use image_import::{process_image, Processed};
pub use library::{default_scale, Library};
pub use materials::{Material, Rarity};
pub use models::{NewSticker, Placement, ProvenanceEntry, ProvenanceKind, SourceType, Sticker};
