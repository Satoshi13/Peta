//! Peta core — sticker rules and persistence, plus macOS Vision foreground extraction.

pub mod back;
pub mod book;
pub mod creator;
pub mod cutout;
pub mod daily;
pub mod db;
pub mod error;
pub mod gift;
pub mod ids;
pub mod image_import;
pub mod library;
pub mod materials;
pub mod pack;
pub mod models;
pub mod segment;
pub mod scraps;
pub mod sticker;
pub mod link_tag;
pub mod thumb;

pub use back::StickerBack;
pub use book::{BookEntry, MonthIndex};
pub use daily::{DailyRecord, SlotState};
pub use db::{Database, IncomingGift, PackSummary};
pub use error::{Error, Result};
pub use image_import::{process_image, Processed};
pub use library::{default_scale, Library};
pub use materials::{Material, Rarity};
pub use models::{clean_title, NewSticker, Placement, ProvenanceEntry, ProvenanceKind, SourceType, Sticker};

pub mod sign;
pub mod official_keys;
pub mod device_key;
pub mod identity;
pub mod events;
pub mod friends;
pub mod creator_pack;

pub mod ownership;

pub mod export;
mod asset_writes;

pub mod edition_pack;

pub mod server;

pub mod boards;
pub mod board_auto;
