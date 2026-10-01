//! Data model (spec §58-65). Serialized as camelCase for the web layer.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceType {
    Created,
    Gift,
    Pack,
    Collection,
}

impl SourceType {
    pub fn as_str(self) -> &'static str {
        match self {
            SourceType::Created => "created",
            SourceType::Gift => "gift",
            SourceType::Pack => "pack",
            SourceType::Collection => "collection",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "created" => SourceType::Created,
            "gift" => SourceType::Gift,
            "pack" => SourceType::Pack,
            "collection" => SourceType::Collection,
            _ => return None,
        })
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProvenanceKind {
    Created,
    Gifted,
    Received,
    PackOpened,
}

impl ProvenanceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ProvenanceKind::Created => "created",
            ProvenanceKind::Gifted => "gifted",
            ProvenanceKind::Received => "received",
            ProvenanceKind::PackOpened => "pack_opened",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "created" => ProvenanceKind::Created,
            "gifted" => ProvenanceKind::Gifted,
            "received" => ProvenanceKind::Received,
            "pack_opened" => ProvenanceKind::PackOpened,
            _ => return None,
        })
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceEntry {
    #[serde(rename = "type")]
    pub kind: ProvenanceKind,
    pub user_id: Option<String>,
    pub timestamp: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sticker {
    /// e.g. `PETA-A6F4-8Q21`
    pub id: String,
    pub creator_id: Option<String>,
    pub created_at: String,
    /// Paths are relative to the assets directory.
    pub original_asset_path: String,
    pub rendered_asset_path: String,
    pub mask_asset_path: Option<String>,
    pub material_id: Option<String>,
    /// `ORIGINAL #n` for stickers the user made (spec §32).
    pub original_number: Option<i64>,
    pub edition_number: Option<i64>,
    pub source_type: SourceType,
    pub parent_sticker_id: Option<String>,
    /// width / height of the rendered image.
    pub aspect: f64,
    pub provenance: Vec<ProvenanceEntry>,
}

/// Everything needed to insert a sticker; `id` and counters are assigned by the library.
#[derive(Clone, Debug)]
pub struct NewSticker {
    pub id: String,
    pub creator_id: Option<String>,
    pub original_asset_path: String,
    pub rendered_asset_path: String,
    pub material_id: Option<String>,
    pub source_type: SourceType,
    pub aspect: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub sticker_id: String,
    pub display_id: String,
    /// Sticker center, 0..1 of the display.
    pub relative_x: f64,
    pub relative_y: f64,
    /// Sticker width as a fraction of the display width.
    pub relative_scale: f64,
    /// Degrees, clockwise.
    pub rotation: f64,
    #[serde(default)]
    pub placed_at: String,
    #[serde(default = "yes")]
    pub is_on_desktop: bool,
    /// Stacking order (higher = on top). Assigned by the library on every `place`.
    #[serde(default)]
    pub z: i64,
}

fn yes() -> bool {
    true
}
