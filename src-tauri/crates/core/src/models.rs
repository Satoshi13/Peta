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
    /// The name printed on the back ("Created by …"), frozen at creation. `None` on stickers made before it existed.
    pub creator_name: Option<String>,
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
    pub creator_name: Option<String>,
    pub original_asset_path: String,
    pub rendered_asset_path: String,
    pub mask_asset_path: Option<String>,
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

/// The longest name a sticker can have, in letters (Unicode scalar values).
pub const MAX_TITLE_LETTERS: usize = 40;

/// A name the person typed, made safe to store and show: runs of whitespace (and line breaks) become one space, control and invisible
/// direction/zero-width characters are dropped, the ends are trimmed. Nothing left means "no name" (`None`); too long is refused, never cut.
pub fn clean_title(raw: &str) -> crate::Result<Option<String>> {
    let invisible = |c: char| matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}');
    let mut out = String::new(); let mut gap = false;
    for c in raw.chars() {
        if c.is_whitespace() || (c.is_control() && matches!(c, '\n' | '\r' | '\t')) { gap = !out.is_empty(); continue; }
        if c.is_control() || invisible(c) { continue; }
        if gap { out.push(' '); gap = false; }
        out.push(c);
    }
    if out.is_empty() { return Ok(None); }
    if out.chars().count() > MAX_TITLE_LETTERS {
        return Err(crate::Error::Invalid(format!("A name can be up to {MAX_TITLE_LETTERS} letters.")));
    }
    Ok(Some(out))
}

#[cfg(test)]
mod title_tests {
    use super::*;
    #[test]
    fn names_are_tidied_and_empty_means_none() {
        assert_eq!(clean_title("  Sunny   side\n up ").unwrap().as_deref(), Some("Sunny side up"));
        assert_eq!(clean_title("").unwrap(), None);
        assert_eq!(clean_title(" \t\n ").unwrap(), None);
        assert_eq!(clean_title("a\u{0007}b\u{200B}c\u{202E}d").unwrap().as_deref(), Some("abcd"));
        assert_eq!(clean_title("目玉焼き 🍳").unwrap().as_deref(), Some("目玉焼き 🍳"));
    }
    #[test]
    fn a_name_of_forty_letters_fits_and_forty_one_is_refused_not_cut() {
        assert!(clean_title(&"あ".repeat(40)).unwrap().is_some());
        assert!(clean_title(&"あ".repeat(41)).is_err());
        assert!(clean_title(&format!("{}{}", "a ".repeat(20), "b")).is_err()); // 41 letters once spaced
    }
}
