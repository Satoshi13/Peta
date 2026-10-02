//! The Sticker Book (spec §43-46): your stickers, a page per month.
//!
//! A sticker belongs on the page of the month it was stuck as *that day's* Peta. One that was stuck again
//! months later also appears on that month's page. Stickers that were never a day's Peta (developer adds,
//! samples, ones carried over from Phase 0) sit on the page of the month they were made.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::{
    back::local_ymd,
    db::Database,
    error::Result,
    models::SourceType,
};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookEntry {
    /// Local `YYYY-MM-DD`.
    pub date: String,
    pub sticker_id: String,
    pub original_number: Option<i64>,
    pub material_id: Option<String>,
    pub source_type: SourceType,
    pub aspect: f64,
    /// Currently stuck on the desktop.
    pub on_desktop: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MonthIndex {
    pub year: i32,
    pub month: u32,
    pub count: usize,
}

/// All entries, oldest first. `ymd` turns a stored timestamp into a local date (`local_ymd` in the app).
pub fn entries(db: &Database, ymd: &dyn Fn(&str) -> Option<String>) -> Result<Vec<BookEntry>> {
    let mut out: Vec<BookEntry> = db
        .book_rows()?
        .into_iter()
        .map(|r| BookEntry {
            date: r
                .daily_date
                .or_else(|| ymd(&r.created_at))
                .unwrap_or_else(|| r.created_at.chars().take(10).collect()),
            sticker_id: r.sticker_id,
            original_number: r.original_number,
            material_id: r.material_id,
            source_type: r.source_type,
            aspect: r.aspect,
            on_desktop: r.on_desktop,
        })
        .collect();
    out.sort_by(|a, b| {
        (&a.date, a.original_number, &a.sticker_id).cmp(&(&b.date, b.original_number, &b.sticker_id))
    });
    Ok(out)
}

pub fn entries_local(db: &Database) -> Result<Vec<BookEntry>> {
    entries(db, &local_ymd)
}

fn year_month(date: &str) -> Option<(i32, u32)> {
    let mut it = date.split('-');
    Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
}

/// Months that have a page, newest first.
pub fn index(entries: &[BookEntry]) -> Vec<MonthIndex> {
    let mut counts: BTreeMap<(i32, u32), usize> = BTreeMap::new();
    for e in entries {
        if let Some(ym) = year_month(&e.date) {
            *counts.entry(ym).or_default() += 1;
        }
    }
    counts.into_iter().rev().map(|((year, month), count)| MonthIndex { year, month, count }).collect()
}

/// One page of the book, oldest first.
pub fn page(entries: &[BookEntry], year: i32, month: u32) -> Vec<BookEntry> {
    entries.iter().filter(|e| year_month(&e.date) == Some((year, month))).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{daily, models::{NewSticker, Placement}};

    fn ident(ts: &str) -> Option<String> {
        Some(ts.chars().take(10).collect())
    }

    fn make(db: &mut Database, id: &str) {
        db.create_sticker(NewSticker {
            id: id.into(),
            creator_id: None,
            creator_name: None,
            original_asset_path: "o".into(),
            rendered_asset_path: "r".into(),
            mask_asset_path: None,
            material_id: Some("matte".into()),
            source_type: SourceType::Created,
            aspect: 1.0,
        })
        .unwrap();
    }

    fn stick(db: &mut Database, id: &str) {
        db.place(Placement {
            sticker_id: id.into(), display_id: "d".into(), relative_x: 0.5, relative_y: 0.5, relative_scale: 0.1,
            rotation: 0.0, placed_at: String::new(), is_on_desktop: true, z: 0,
        })
        .unwrap();
    }

    fn choose(db: &mut Database, day: &str, id: &str, source: SourceType) {
        daily::confirm(db, day, id, source, 0.5).unwrap();
        daily::mark_used(db, day).unwrap();
    }

    #[test]
    fn a_sticker_lands_on_the_page_of_the_day_it_was_stuck() {
        let mut db = Database::open_in_memory().unwrap();
        for id in ["A", "B", "C"] {
            make(&mut db, id);
        }
        stick(&mut db, "A");
        choose(&mut db, "2026-09-30", "A", SourceType::Created);
        choose(&mut db, "2026-10-01", "B", SourceType::Created);
        choose(&mut db, "2026-10-02", "C", SourceType::Created);
        let e = entries(&db, &ident).unwrap();
        assert_eq!(e.iter().map(|x| x.date.as_str()).collect::<Vec<_>>(), ["2026-09-30", "2026-10-01", "2026-10-02"]);
        assert_eq!(index(&e), vec![MonthIndex { year: 2026, month: 10, count: 2 }, MonthIndex { year: 2026, month: 9, count: 1 }]);
        assert_eq!(page(&e, 2026, 10).iter().map(|x| x.sticker_id.as_str()).collect::<Vec<_>>(), ["B", "C"]);
        assert!(page(&e, 2026, 8).is_empty());
        assert!(e[0].on_desktop && !e[1].on_desktop, "A is on the desktop, B was never stuck down");
    }

    #[test]
    fn a_sticker_stuck_again_later_appears_on_both_pages() {
        let mut db = Database::open_in_memory().unwrap();
        make(&mut db, "A");
        choose(&mut db, "2026-09-15", "A", SourceType::Created);
        choose(&mut db, "2026-10-20", "A", SourceType::Collection);
        let e = entries(&db, &ident).unwrap();
        assert_eq!(e.len(), 2);
        assert_eq!(page(&e, 2026, 9).len(), 1);
        assert_eq!(page(&e, 2026, 10)[0].source_type, SourceType::Collection);
    }

    #[test]
    fn stickers_that_were_never_a_days_peta_use_their_creation_month() {
        let mut db = Database::open_in_memory().unwrap();
        make(&mut db, "SAMPLE");
        let created = db.sticker("SAMPLE").unwrap().unwrap().created_at;
        let e = entries(&db, &ident).unwrap();
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].date, created.chars().take(10).collect::<String>());
        // and never twice
        make(&mut db, "B");
        choose(&mut db, "2026-10-01", "B", SourceType::Created);
        let e = entries(&db, &ident).unwrap();
        assert_eq!(e.iter().filter(|x| x.sticker_id == "B").count(), 1);
    }

    #[test]
    fn empty_book() {
        let db = Database::open_in_memory().unwrap();
        let e = entries_local(&db).unwrap();
        assert!(e.is_empty() && index(&e).is_empty());
    }

    #[test]
    fn within_a_day_the_order_is_by_original_number() {
        let mut db = Database::open_in_memory().unwrap();
        for id in ["Z", "Y"] {
            make(&mut db, id); // Z gets No.1, Y gets No.2
        }
        let e = entries(&db, &|_| Some("2026-10-05".into())).unwrap();
        assert_eq!(e.iter().map(|x| x.sticker_id.as_str()).collect::<Vec<_>>(), ["Z", "Y"]);
    }
}
