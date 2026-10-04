//! One material envelope per local day. Sticker creation is unlimited subject to material stock.
//! Legacy DailyRecord/SlotState fields remain for storage/API compatibility; pending prints and
//! Welcome's separate daily allowance live in the database's v7 tables.

use serde::{Deserialize, Serialize};

use crate::{
    db::{now, Database},
    error::{Error, Result},
    materials,
    models::SourceType,
};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DailyRecord {
    pub date: String,
    pub material_id: String,
    pub material_opened_at: Option<String>,
    pub sticker_id: Option<String>,
    pub source_type: Option<SourceType>,
    pub confirmed_at: Option<String>,
    pub used_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SlotState {
    Available,
    Selecting,
    Confirmed,
    Used,
}

impl SlotState {
    /// Can today's new Peta still be chosen?
    pub fn can_add_new(self) -> bool {
        true // Creation is limited by material stock, never by another sticker made today.
    }
}

impl DailyRecord {
    /// A sticker that was made (CONFIRMED) but is not on the desktop yet: it is waiting at the print slot to
    /// be grabbed and pasted (spec §27-29). Survives quitting the app, so it is there again next launch.
    pub fn waiting_sticker(&self) -> Option<&str> {
        match (&self.confirmed_at, &self.used_at) {
            (Some(_), None) => self.sticker_id.as_deref(),
            _ => None,
        }
    }

    pub fn slot(&self, selecting: bool) -> SlotState {
        match (&self.confirmed_at, &self.used_at) {
            (_, Some(_)) => SlotState::Used,
            (Some(_), None) => SlotState::Confirmed,
            (None, None) if selecting => SlotState::Selecting,
            (None, None) => SlotState::Available,
        }
    }
}

/// Today's local date, `offset_days` ahead (0 in production; the developer "next day" switch uses it).
pub fn local_today(offset_days: i64) -> String {
    (chrono::Local::now().date_naive() + chrono::Duration::days(offset_days))
        .format("%Y-%m-%d")
        .to_string()
}

/// Today's record, drawing the day's material on first access (`roll` uniform in 0..1).
pub fn ensure_today(db: &mut Database, today: &str, roll: f64) -> Result<DailyRecord> {
    if let Some(r) = db.daily_get(today)? {
        return Ok(r);
    }
    let first_ever = db.daily_count()? == 0;
    db.daily_insert(today, &materials::draw(roll, first_ever))?;
    db.daily_get(today)?.ok_or_else(|| Error::Invalid("daily record vanished".into()))
}

/// Open the envelope: Today's Material is yours. It is written into the Material Book for good, and one of it
/// goes into your stock (materials are used up when a sticker is made with them).
/// Returns the record and whether the material was newly found (first time in the book). Idempotent per day:
/// opening again the same day adds nothing.
pub fn open_material(db: &mut Database, today: &str, roll: f64) -> Result<(DailyRecord, bool)> {
    let record = ensure_today(db, today, roll)?;
    let bonus=record.material_opened_at.is_some();
    if bonus && db.bonus_envelopes()?==0 {return Ok((record,false));}
    let material=if bonus {materials::draw(roll,false)} else {record.material_id.clone()};
    let tx=db.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if bonus {
        let changed=tx.execute("UPDATE meta SET value=CAST(value AS INTEGER)-1 WHERE key='bonus_envelopes' AND CAST(value AS INTEGER)>0",[])?;
        if changed==0 {return Err(Error::Invalid("No extra envelopes remain.".into()));}
    }
    tx.execute("UPDATE daily_records SET material_id=?1,material_opened_at=?2 WHERE date=?3",rusqlite::params![material,now(),today])?;
    let newly=tx.execute("INSERT OR IGNORE INTO material_unlocks VALUES (?1,?2)",rusqlite::params![material,now()])?>0;
    tx.execute("INSERT INTO material_stock VALUES (?1,1) ON CONFLICT(material_id) DO UPDATE SET count=count+1",[&material])?;
    tx.commit()?;
    Ok((db.daily_get(today)?.expect("just updated"),newly))
}

/// Keep this sticker in the durable print queue and Book history. No daily sticker quota.
pub fn confirm(db: &mut Database, today: &str, sticker_id: &str, source: SourceType, roll: f64) -> Result<DailyRecord> {
    ensure_today(db, today, roll)?;
    db.daily_set_confirmed(today, sticker_id, source, &now())?;
    Ok(db.daily_get(today)?.expect("just updated"))
}

/// The confirmed sticker is on the desktop: the slot is spent.
pub fn mark_used(db: &mut Database, today: &str) -> Result<DailyRecord> {
    let record = db.daily_get(today)?.ok_or_else(|| Error::Invalid("no daily record for today".into()))?;
    match record.slot(false) {
        SlotState::Confirmed => {
            if let Some(id)=record.sticker_id.as_deref() { db.finish_print(id)?; }
            db.daily_set_used(today, &now())?;
            Ok(db.daily_get(today)?.expect("just updated"))
        }
        SlotState::Used => Ok(record),
        _ => Err(Error::Invalid("nothing confirmed to mark as used".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NewSticker;

    fn db_with_sticker(id: &str) -> Database {
        let mut db = Database::open_in_memory().unwrap();
        db.create_sticker(NewSticker {
            id: id.into(),
            creator_id: None,
            creator_name: None,
            original_asset_path: "o".into(),
            rendered_asset_path: "r".into(),
            mask_asset_path: None,
            material_id: None,
            source_type: SourceType::Created,
            aspect: 1.0,
        })
        .unwrap();
        db
    }

    #[test]
    fn first_day_draws_holographic_and_is_stable_within_the_day() {
        let mut db = Database::open_in_memory().unwrap();
        let a = ensure_today(&mut db, "2026-10-01", 0.0).unwrap();
        assert_eq!(a.material_id, "holographic");
        assert_eq!(a.slot(false), SlotState::Available);
        // asking again (even with another roll) returns the same day's material
        assert_eq!(ensure_today(&mut db, "2026-10-01", 0.99).unwrap(), a);
    }

    #[test]
    fn new_day_new_material_and_new_slot() {
        let mut db = db_with_sticker("A");
        ensure_today(&mut db, "2026-10-01", 0.0).unwrap();
        confirm(&mut db, "2026-10-01", "A", SourceType::Created, 0.0).unwrap();
        mark_used(&mut db, "2026-10-01").unwrap();

        let day2 = ensure_today(&mut db, "2026-10-02", 0.7).unwrap(); // not the first draw any more
        assert_eq!(day2.material_id, "kraft");
        assert_eq!(day2.slot(false), SlotState::Available);
        assert_eq!(db.daily_get("2026-10-01").unwrap().unwrap().slot(false), SlotState::Used);
    }

    #[test]
    fn looking_at_the_material_does_not_consume_the_slot() {
        let mut db = Database::open_in_memory().unwrap();
        let (r, newly) = open_material(&mut db, "2026-10-01", 0.5).unwrap();
        assert!(newly);
        assert!(r.material_opened_at.is_some());
        assert_eq!(r.slot(false), SlotState::Available);
        assert_eq!(r.slot(true), SlotState::Selecting); // the Today screen being open
        assert!(r.slot(true).can_add_new());
    }

    #[test]
    fn a_confirmed_sticker_waits_to_be_pasted_until_used() {
        let mut db = Database::open_in_memory().unwrap();
        let sticker = db
            .create_sticker(crate::NewSticker {
                id: "PETA-WAIT-0001".into(), creator_id: None, creator_name: None,
                original_asset_path: "o".into(), rendered_asset_path: "r".into(), mask_asset_path: None,
                material_id: Some("matte".into()), source_type: SourceType::Created, aspect: 1.0,
            })
            .unwrap();
        let rec = ensure_today(&mut db, "2026-10-02", 0.5).unwrap();
        assert_eq!(rec.waiting_sticker(), None);
        let rec = confirm(&mut db, "2026-10-02", &sticker.id, SourceType::Created, 0.5).unwrap();
        assert_eq!(rec.waiting_sticker(), Some("PETA-WAIT-0001"));
        let rec = mark_used(&mut db, "2026-10-02").unwrap();
        assert_eq!(rec.waiting_sticker(), None);
    }

    #[test]
    fn opening_adds_one_to_stock_once_a_day_and_matte_is_unlimited() {
        let mut db = Database::open_in_memory().unwrap();
        assert!(db.has_material("matte").unwrap(), "plain paper always available");
        assert!(!db.has_material("holographic").unwrap());
        open_material(&mut db, "2026-10-01", 0.5).unwrap(); // first draw: holographic
        open_material(&mut db, "2026-10-01", 0.5).unwrap(); // same day again: nothing more
        assert_eq!(db.material_count("holographic").unwrap(), 1);
        assert!(db.has_material("holographic").unwrap());
        // a different day with the same kind of draw stacks up
        let mut again = open_material(&mut db, "2026-10-02", 0.95).unwrap().0; // 0.95 -> holographic
        assert_eq!(again.material_id, "holographic");
        assert_eq!(db.material_count("holographic").unwrap(), 2);
        again.used_at = None;
    }

    #[test]
    fn extra_envelopes_are_consumed_after_daily_open_and_survive_midnight() {
        let mut db=Database::open_in_memory().unwrap();
        db.conn.execute("UPDATE meta SET value='2' WHERE key='bonus_envelopes'",[]).unwrap();
        assert_eq!(open_material(&mut db,"2026-10-01",0.0).unwrap().0.material_id,"holographic");
        assert_eq!(db.bonus_envelopes().unwrap(),2);
        assert_eq!(open_material(&mut db,"2026-10-01",0.7).unwrap().0.material_id,"kraft");assert_eq!(db.bonus_envelopes().unwrap(),1);
        ensure_today(&mut db,"2026-10-02",0.0).unwrap();assert_eq!(db.bonus_envelopes().unwrap(),1);
        open_material(&mut db,"2026-10-02",0.0).unwrap();assert_eq!(db.bonus_envelopes().unwrap(),1);
        open_material(&mut db,"2026-10-02",0.95).unwrap();assert_eq!(db.bonus_envelopes().unwrap(),0);
        let stock=db.material_count("holographic").unwrap();open_material(&mut db,"2026-10-02",0.95).unwrap();assert_eq!(db.material_count("holographic").unwrap(),stock);
    }

    #[test]
    fn using_a_material_consumes_it_but_the_book_keeps_it() {
        let mut db = Database::open_in_memory().unwrap();
        open_material(&mut db, "2026-10-01", 0.5).unwrap(); // holographic x1
        db.consume_material("holographic").unwrap();
        assert_eq!(db.material_count("holographic").unwrap(), 0);
        assert!(matches!(db.consume_material("holographic"), Err(Error::MaterialUnavailable)));
        assert!(!db.has_material("holographic").unwrap());
        // still in the Material Book
        assert!(db.unlocked_material_ids().unwrap().contains(&"holographic".to_string()));
        // plain paper: never runs out
        for _ in 0..5 {
            db.consume_material("matte").unwrap();
        }
        assert!(db.has_material("matte").unwrap());
    }

    #[test]
    fn opening_unlocks_the_material_once_and_keeps_it() {
        let mut db = Database::open_in_memory().unwrap();
        assert_eq!(db.unlocked_material_ids().unwrap(), ["matte"]); // default
        assert!(open_material(&mut db, "2026-10-01", 0.5).unwrap().1);
        assert!(!open_material(&mut db, "2026-10-01", 0.5).unwrap().1); // idempotent
        assert_eq!(db.unlocked_material_ids().unwrap(), ["holographic", "matte"]);
        // a later day does not lock it again
        open_material(&mut db, "2026-10-02", 0.7).unwrap();
        assert_eq!(db.unlocked_material_ids().unwrap(), ["holographic", "kraft", "matte"]);
    }

    #[test]
    fn many_new_petas_per_day_and_reprints_are_allowed() {
        let mut db=db_with_sticker("A");
        for _ in 0..3 {
            let r=confirm(&mut db,"2026-10-01","A",SourceType::Created,0.0).unwrap();
            assert!(r.slot(false).can_add_new());
            assert_eq!(db.next_print().unwrap().as_deref(),Some("A"));
            mark_used(&mut db,"2026-10-01").unwrap();
            assert!(db.next_print().unwrap().is_none());
        }
        confirm(&mut db,"2026-10-01","A",SourceType::Collection,0.0).unwrap();
    }

    #[test]
    fn confirm_records_what_was_chosen() {
        let mut db = db_with_sticker("A");
        let r = confirm(&mut db, "2026-10-01", "A", SourceType::Collection, 0.0).unwrap();
        assert_eq!(r.sticker_id.as_deref(), Some("A"));
        assert_eq!(r.source_type, Some(SourceType::Collection));
        assert!(r.confirmed_at.is_some() && r.used_at.is_none());
    }

    #[test]
    fn mark_used_needs_a_confirmation() {
        let mut db = Database::open_in_memory().unwrap();
        assert!(mark_used(&mut db, "2026-10-01").is_err()); // no record at all
        ensure_today(&mut db, "2026-10-01", 0.0).unwrap();
        assert!(mark_used(&mut db, "2026-10-01").is_err()); // nothing confirmed
    }

    #[test]
    fn local_today_is_a_date_and_offsets_by_days() {
        let a = local_today(0);
        assert_eq!(a.len(), 10);
        let b = local_today(1);
        let da = chrono::NaiveDate::parse_from_str(&a, "%Y-%m-%d").unwrap();
        let db_ = chrono::NaiveDate::parse_from_str(&b, "%Y-%m-%d").unwrap();
        assert_eq!((db_ - da).num_days(), 1);
    }
}
