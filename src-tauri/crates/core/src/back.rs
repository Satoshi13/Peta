//! The back of a sticker (spec §30-33): where it came from, who made it, when, with what.
//! Everything is returned as ready-to-print strings; the UI only lays them out.

use serde::Serialize;

use crate::{
    db::Database,
    error::Result,
    materials,
    models::{ProvenanceKind, SourceType},
};

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BackKind {
    /// Made by you: `ORIGINAL No. 0001`.
    Original,
    /// Came to you from someone (a gift, a pack): `Received from … · Edition #0042`.
    Received,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackMaterial {
    pub id: String,
    pub name: String,
    pub rarity: materials::Rarity,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackEntry {
    #[serde(rename = "type")]
    pub kind: ProvenanceKind,
    pub by: Option<String>,
    /// e.g. "Oct 7, 2026"
    pub on: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StickerBack {
    pub sticker_id: String,
    /// `PETA-A6F4-8Q21` — shown small, never the headline (spec §33).
    pub id_code: String,
    pub kind: BackKind,
    /// "0001" for `ORIGINAL No. 0001`.
    pub original_number: Option<String>,
    /// "0042" for `Edition #0042`.
    pub edition_number: Option<String>,
    pub created_by: String,
    pub created_on: String,
    pub material: Option<BackMaterial>,
    pub received_from: Option<String>,
    pub received_on: Option<String>,
    pub history: Vec<BackEntry>,
}

const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/// "2026-10-03" -> "Oct 3, 2026". Anything else is returned unchanged.
pub fn long_date(ymd: &str) -> String {
    let parts: Vec<&str> = ymd.split('-').collect();
    if let [y, m, d] = parts[..] {
        if let (Ok(m), Ok(d)) = (m.parse::<usize>(), d.parse::<u32>()) {
            if (1..=12).contains(&m) {
                return format!("{} {d}, {y}", MONTHS[m - 1]);
            }
        }
    }
    ymd.to_owned()
}

/// An RFC 3339 timestamp as a local `YYYY-MM-DD`.
pub fn local_ymd(rfc3339: &str) -> Option<String> {
    chrono::DateTime::parse_from_rfc3339(rfc3339)
        .ok()
        .map(|t| t.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string())
}

fn four(n: i64) -> String {
    format!("{n:04}")
}

/// Build the back of a sticker. `fallback_name` is used for stickers made before names were recorded;
/// `ymd` turns a stored timestamp into a local date (`local_ymd` in the app, anything in tests).
pub fn sticker_back(db: &Database, id: &str, fallback_name: &str, ymd: &dyn Fn(&str) -> Option<String>) -> Result<Option<StickerBack>> {
    let Some(sticker) = db.sticker(id)? else { return Ok(None) };
    let on = |ts: &str| long_date(&ymd(ts).unwrap_or_else(|| ts.chars().take(10).collect()));

    let history: Vec<BackEntry> = sticker
        .provenance
        .iter()
        .map(|p| BackEntry { kind: p.kind, by: p.user_id.clone(), on: on(&p.timestamp) })
        .collect();
    let created_on = sticker
        .provenance
        .iter()
        .find(|p| p.kind == ProvenanceKind::Created)
        .map(|p| on(&p.timestamp))
        .unwrap_or_else(|| on(&sticker.created_at));

    let arrival = sticker
        .provenance
        .iter()
        .rev()
        .find(|p| matches!(p.kind, ProvenanceKind::Received | ProvenanceKind::PackOpened));
    let received = arrival.is_some() || matches!(sticker.source_type, SourceType::Gift | SourceType::Pack);

    Ok(Some(StickerBack {
        sticker_id: sticker.id.clone(),
        id_code: sticker.id.clone(),
        kind: if received { BackKind::Received } else { BackKind::Original },
        original_number: if received { None } else { sticker.original_number.map(four) },
        edition_number: sticker.edition_number.map(four),
        created_by: sticker.creator_name.clone().unwrap_or_else(|| fallback_name.to_owned()),
        created_on,
        material: sticker.material_id.as_deref().and_then(materials::get).map(|m| BackMaterial {
            id: m.id,
            name: m.name,
            rarity: m.rarity,
        }),
        received_from: arrival.and_then(|a| a.user_id.clone()),
        received_on: arrival.map(|a| on(&a.timestamp)),
        history,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NewSticker;

    fn ident(ts: &str) -> Option<String> {
        Some(ts.chars().take(10).collect())
    }

    fn sticker(db: &mut Database, id: &str, material: Option<&str>, source: SourceType, name: Option<&str>) {
        db.create_sticker(NewSticker {
            name: None,
            id: id.into(),
            creator_id: None,
            creator_name: name.map(str::to_owned),
            original_asset_path: "o".into(),
            rendered_asset_path: "r".into(),
            mask_asset_path: None,
            material_id: material.map(str::to_owned),
            source_type: source,
            aspect: 1.0,
        })
        .unwrap();
    }

    #[test]
    fn long_dates() {
        assert_eq!(long_date("2026-10-03"), "Oct 3, 2026");
        assert_eq!(long_date("2026-01-31"), "Jan 31, 2026");
        assert_eq!(long_date("2026-12-09"), "Dec 9, 2026");
        assert_eq!(long_date("garbage"), "garbage");
        assert_eq!(long_date("2026-13-01"), "2026-13-01");
    }

    #[test]
    fn local_ymd_parses_timestamps() {
        let d = local_ymd("2026-10-03T12:00:00+00:00").unwrap();
        assert_eq!(d.len(), 10);
        assert!(["2026-10-03", "2026-10-02", "2026-10-04"].contains(&d.as_str())); // any timezone
        assert_eq!(local_ymd("nope"), None);
    }

    #[test]
    fn the_back_of_something_you_made() {
        let mut db = Database::open_in_memory().unwrap();
        sticker(&mut db, "PETA-AAAA-0001", Some("holographic"), SourceType::Created, Some("Satoshi"));
        sticker(&mut db, "PETA-AAAA-0002", Some("kraft"), SourceType::Created, Some("Satoshi"));
        let back = sticker_back(&db, "PETA-AAAA-0001", "Me", &ident).unwrap().unwrap();
        assert_eq!(back.kind, BackKind::Original);
        assert_eq!(back.original_number.as_deref(), Some("0001"));
        assert_eq!(back.created_by, "Satoshi");
        assert_eq!(back.material.as_ref().unwrap().name, "Holographic");
        assert_eq!(back.id_code, "PETA-AAAA-0001");
        assert_eq!(back.edition_number, None);
        assert_eq!(back.history.len(), 1);
        assert_eq!(back.history[0].kind, ProvenanceKind::Created);
        assert_eq!(sticker_back(&db, "PETA-AAAA-0002", "Me", &ident).unwrap().unwrap().original_number.as_deref(), Some("0002"));
        assert!(sticker_back(&db, "nope", "Me", &ident).unwrap().is_none());
    }

    #[test]
    fn stickers_from_before_names_were_recorded_use_the_fallback() {
        let mut db = Database::open_in_memory().unwrap();
        sticker(&mut db, "OLD", None, SourceType::Created, None);
        let back = sticker_back(&db, "OLD", "Satoshi", &ident).unwrap().unwrap();
        assert_eq!(back.created_by, "Satoshi");
        assert!(back.material.is_none());
    }

    #[test]
    fn the_back_of_something_you_received() {
        let mut db = Database::open_in_memory().unwrap();
        sticker(&mut db, "GIFT", Some("matte"), SourceType::Gift, Some("Nao"));
        db.add_provenance("GIFT", ProvenanceKind::Received, Some("Satoshi"), "2026-10-07T09:00:00+00:00").unwrap();
        let back = sticker_back(&db, "GIFT", "Me", &ident).unwrap().unwrap();
        assert_eq!(back.kind, BackKind::Received);
        assert_eq!(back.original_number, None, "someone else's sticker has no ORIGINAL number of yours");
        assert_eq!(back.created_by, "Nao");
        assert_eq!(back.received_from.as_deref(), Some("Satoshi"));
        assert_eq!(back.received_on.as_deref(), Some("Oct 7, 2026"));
        assert_eq!(back.history.len(), 2);
        assert_eq!(back.history[1].by.as_deref(), Some("Satoshi"));
    }

    #[test]
    fn edition_numbers_are_padded() {
        let mut db = Database::open_in_memory().unwrap();
        sticker(&mut db, "E", None, SourceType::Pack, Some("Nao"));
        // simulate a limited edition (set by packs later)
        db.add_provenance("E", ProvenanceKind::PackOpened, None, "2026-10-07T09:00:00+00:00").unwrap();
        let back = sticker_back(&db, "E", "Me", &ident).unwrap().unwrap();
        assert_eq!(back.kind, BackKind::Received);
        assert_eq!(four(42), "0042");
    }

    #[test]
    fn display_name_is_stored_and_can_be_reset() {
        let mut db = Database::open_in_memory().unwrap();
        assert!(!db.display_name().unwrap().is_empty());
        db.set_display_name("  Satoshi ").unwrap();
        assert_eq!(db.display_name().unwrap(), "Satoshi");
        db.set_display_name("").unwrap();
        assert_eq!(db.display_name().unwrap(), crate::db::default_display_name());
    }
}
