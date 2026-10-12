//! Durable referee work. HTTP belongs to the app; recovery records precede remote effects.
use crate::{
    db::now,
    ownership::{self as o, Creation, Referee, RefereeError, Status, Transfer},
    Database, Error, Library, Result,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

pub(crate) fn schema(conn: &mut Connection) -> Result<()> {
    let tx = conn.transaction()?;
    let checked: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('stickers') WHERE name='checked')",
        [],
        |r| r.get(0),
    )?;
    if !checked {
        tx.execute_batch("ALTER TABLE stickers ADD COLUMN checked TEXT CHECK(checked IN ('pending','checked','pre_server'));")?;
    }
    tx.execute_batch("CREATE TABLE IF NOT EXISTS referee_outbox(kind TEXT NOT NULL CHECK(kind IN ('register','cancel_release','cancel_pack')),target TEXT NOT NULL,body TEXT NOT NULL,queued_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(kind,target));
    CREATE TABLE IF NOT EXISTS referee_reconciliations(kind TEXT NOT NULL,target TEXT NOT NULL,body TEXT NOT NULL,code TEXT NOT NULL,detected_at TEXT NOT NULL,PRIMARY KEY(kind,target));
    CREATE TABLE IF NOT EXISTS pack_slot_pending(pack_id TEXT PRIMARY KEY,slot_no INTEGER NOT NULL,transfer TEXT);
    CREATE TABLE IF NOT EXISTS pack_slot_exclusions(pack_id TEXT NOT NULL,slot_no INTEGER NOT NULL,PRIMARY KEY(pack_id,slot_no));
    CREATE TABLE IF NOT EXISTS server_pack_state(pack_id TEXT PRIMARY KEY,pre_server INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS gift_claim_pending(gift_id TEXT PRIMARY KEY,chain TEXT NOT NULL,content_digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS gift_server_checks(gift_id TEXT PRIMARY KEY,checked INTEGER NOT NULL);
    INSERT OR IGNORE INTO meta VALUES ('server.schema.s1','1');")?;
    tx.commit()?;
    Ok(())
}
pub fn enabled(db: &Database) -> Result<bool> {
    Ok(db.conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM meta WHERE key='server.migrated_at')",
        [],
        |r| r.get(0),
    )?)
}
pub fn checked(db: &Database, id: &str) -> Result<Option<String>> {
    Ok(db
        .conn
        .query_row("SELECT checked FROM stickers WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .optional()?
        .flatten())
}
pub(crate) fn enqueue(
    conn: &Connection,
    kind: &str,
    target: &str,
    body: &impl Serialize,
) -> Result<()> {
    conn.execute("INSERT INTO referee_outbox(kind,target,body,queued_at) VALUES (?1,?2,?3,?4) ON CONFLICT(kind,target) DO UPDATE SET body=excluded.body",params![kind,target,json(body)?,now()])?;
    Ok(())
}
pub(crate) fn remove(conn: &Connection, kind: &str, target: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM referee_outbox WHERE kind=?1 AND target=?2",
        params![kind, target],
    )?;
    Ok(())
}
pub(crate) fn json(value: &impl Serialize) -> Result<String> {
    serde_json::to_string(value).map_err(|e| Error::Invalid(e.to_string()))
}
fn parse<T: serde::de::DeserializeOwned>(s: &str) -> Result<T> {
    serde_json::from_str(s).map_err(|e| Error::Invalid(e.to_string()))
}
pub fn pending_cancel(db: &Database, id: &str) -> Result<bool> {
    Ok(db.conn.query_row("SELECT EXISTS(SELECT 1 FROM referee_outbox WHERE kind='cancel_release' AND target=?1 OR kind='cancel_pack' AND (target=?1 OR EXISTS(SELECT 1 FROM json_each(body,'$.movedReleases') WHERE json_extract(value,'$.stickerId')=?1) OR EXISTS(SELECT 1 FROM json_each(body,'$.sourceIds') WHERE value=?1)))",[id],|r|r.get(0))?)
}
/// One-time classification uses verified bytes, not only the stored verified flag.
pub fn migrate(lib: &mut Library) -> Result<()> {
    if enabled(lib.db())? {
        return Ok(());
    }
    let key = crate::device_key::load_or_create(lib.root())?;
    let public = crate::sign::public_key(&key);
    let mut stmt = lib
        .db()
        .conn
        .prepare("SELECT id FROM stickers WHERE lineage='real'")?;
    let ids = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);
    let mut originals = Vec::new();
    for id in ids {
        let s = lib
            .db()
            .sticker(&id)?
            .ok_or_else(|| Error::Invalid("Missing sticker.".into()))?;
        if s.state != "held"
            || s.pressed
            || s.edition_number.is_some()
            || s.source_type != crate::SourceType::Created
            || s.creator_public_key.as_deref() != Some(&public)
            || !o::stored_transfers(&lib.db().conn, &id)?.is_empty()
        {
            continue;
        }
        let record: Option<String> = lib.db().conn.query_row(
            "SELECT creation_record FROM stickers WHERE id=?1",
            [&id],
            |r| r.get(0),
        )?;
        if let Some(c) = record.and_then(|s| serde_json::from_str::<Creation>(&s).ok()) {
            if c.verified()
                && lib.read_rendered(&id).ok().is_some_and(|png| {
                    o::sticker_chain_verify(
                        &o::Chain {
                            creation: c.clone(),
                            transfers: vec![],
                        },
                        &png,
                    )
                    .is_ok()
                })
            {
                originals.push(c);
            }
        }
    }
    let tx = lib.db_mut().conn.transaction()?;
    tx.execute(
        "UPDATE stickers SET checked='pre_server' WHERE lineage='real'",
        [],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO server_pack_state SELECT pack_id,1 FROM edition_pack_frames",
        [],
    )?;
    for c in originals {
        tx.execute(
            "UPDATE stickers SET checked='pending' WHERE id=?1",
            [&c.sticker_id],
        )?;
        enqueue(&tx, "register", &c.sticker_id, &c)?;
    }
    tx.execute("INSERT INTO meta VALUES ('server.migrated_at',?1)", [now()])?;
    tx.commit()?;
    Ok(())
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub registrations: u32,
    pub cancellations: u32,
    pub slots: u32,
    pub reconciliations: u32,
}
pub fn counts(db: &Database) -> Result<Counts> {
    Ok(Counts {
        reconciliations: db.conn.query_row(
            "SELECT COUNT(*) FROM referee_reconciliations",
            [],
            |r| r.get(0),
        )?,
        registrations: db.conn.query_row(
            "SELECT COUNT(*) FROM referee_outbox WHERE kind='register'",
            [],
            |r| r.get(0),
        )?,
        cancellations: db.conn.query_row(
            "SELECT COUNT(*) FROM referee_outbox WHERE kind!='register'",
            [],
            |r| r.get(0),
        )?,
        slots: db
            .conn
            .query_row("SELECT COUNT(*) FROM pack_slot_pending", [], |r| r.get(0))?,
    })
}
/// Network work can run without the app's Library mutex. Apply only the same durable intent.
#[derive(Clone)]
pub struct SyncWork {
    pub kind: String,
    pub target: String,
    body: String,
}
impl SyncWork {
    pub fn run(&self, referee: &dyn Referee) -> Result<()> {
        match self.kind.as_str() {
            "register" => referee.register(&parse::<Creation>(&self.body)?),
            "cancel_release" => referee.cancel_release(&parse::<Transfer>(&self.body)?),
            "cancel_pack" => referee.cancel_pack(&parse::<o::PackRegistration>(&self.body)?),
            _ => Err(Error::Invalid("Unknown recovery intent.".into())),
        }
    }
}
pub fn pending_work(db: &mut Database, limit: u32) -> Result<Vec<SyncWork>> {
    let mut stmt=db.conn.prepare("SELECT kind,target,body FROM referee_outbox ORDER BY attempts,CASE kind WHEN 'register' THEN 1 ELSE 0 END,queued_at LIMIT ?1")?;
    let rows = stmt
        .query_map([limit], |r| {
            Ok(SyncWork {
                kind: r.get(0)?,
                target: r.get(1)?,
                body: r.get(2)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);
    for row in &rows {
        db.conn.execute(
            "UPDATE referee_outbox SET attempts=attempts+1 WHERE kind=?1 AND target=?2",
            params![row.kind, row.target],
        )?;
    }
    Ok(rows)
}
pub fn finish_work(db: &mut Database, work: &SyncWork, result: Result<()>) -> Result<()> {
    let current: Option<String> = db
        .conn
        .query_row(
            "SELECT body FROM referee_outbox WHERE kind=?1 AND target=?2",
            params![work.kind, work.target],
            |r| r.get(0),
        )
        .optional()?;
    if current.as_deref() != Some(&work.body) {
        return Ok(());
    }
    result?;
    let tx = db.conn.transaction()?;
    if work.kind == "register" {
        tx.execute(
            "UPDATE stickers SET checked='checked' WHERE id=?1 AND checked='pending'",
            [&work.target],
        )?;
    }
    remove(&tx, &work.kind, &work.target)?;
    tx.commit()?;
    Ok(())
}
/// Process unrelated rows even after a refusal; stop on a network outage.
pub fn sync(db: &mut Database, referee: &dyn Referee) -> Result<()> {
    if !referee.enabled() {
        return Ok(());
    }
    let mut first = None;
    for work in pending_work(db, 60)? {
        let result = work.run(referee);
        let result = reconcile_work(db, &work, referee, result);
        let offline = matches!(&result, Err(Error::Referee(RefereeError::Offline)));
        if let Err(e) = finish_work(db, &work, result) {
            if first.is_none() {
                first = Some(e);
            }
        }
        if offline {
            break;
        }
    }
    first.map_or(Ok(()), Err)
}
fn accept_release_in(tx: &Connection, t: &Transfer) -> Result<()> {
    let local:Option<(String,u32)>=tx.query_row("SELECT state,(SELECT COUNT(*) FROM transfers WHERE sticker_id=?1) FROM stickers WHERE id=?1",[&t.sticker_id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    if let Some((state, count)) = local {
        if state == "held" && count == t.seq {
            o::store_transfer(tx, t)?;
            o::release_local(tx, &t.sticker_id)?;
        } else if state != "gone" || !o::stored_transfers(tx, &t.sticker_id)?.contains(t) {
            return Err(Error::Invalid("Recovery history changed.".into()));
        }
    }
    Ok(())
}
/// A visible file may have been consumed before local COMMIT failed. Preserve remote truth.
pub fn reconcile_work(
    db: &mut Database,
    work: &SyncWork,
    referee: &dyn Referee,
    result: Result<()>,
) -> Result<()> {
    let current: Option<String> = db
        .conn
        .query_row(
            "SELECT body FROM referee_outbox WHERE kind=?1 AND target=?2",
            params![work.kind, work.target],
            |r| r.get(0),
        )
        .optional()?;
    if current.as_deref() != Some(&work.body) {
        return Ok(());
    }
    let code = match &result {
        Err(Error::Referee(RefereeError::Rejected(code))) => code.as_str(),
        _ => return result,
    };
    if work.kind == "cancel_release" && code == "not_yours" {
        let t = parse::<Transfer>(&work.body)?;
        if !matches!(referee.status(&t.sticker_id)?,Status::Held{holder} if holder!=t.actor_key) {
            return result;
        }
        let tx = db.conn.transaction()?;
        accept_release_in(&tx, &t)?;
        tx.execute("INSERT OR REPLACE INTO referee_reconciliations VALUES ('release_committed_remote',?1,?2,?3,?4)",params![work.target,work.body,code,now()])?;
        remove(&tx, &work.kind, &work.target)?;
        tx.commit()?;
        return Err(RefereeError::Rejected("gift_received_during_save".into()).into());
    }
    if work.kind == "cancel_pack" && code == "already_opened" {
        let p = parse::<o::PackRegistration>(&work.body)?;
        let recovery: serde_json::Value = parse(&work.body)?;
        let tx = db.conn.transaction()?;
        let moved: Vec<Transfer> = recovery
            .get("recoveryMoved")
            .map(|v| serde_json::from_value(v.clone()))
            .transpose()
            .map_err(|e| Error::Invalid(e.to_string()))?
            .unwrap_or_else(|| p.moved_releases.clone());
        for t in &moved {
            accept_release_in(&tx, t)?;
        }
        for source in &p.source_ids {
            if !moved.iter().any(|t| &t.sticker_id == source) {
                tx.execute(
                    "UPDATE stickers SET pressed=1 WHERE id=?1 AND state='held'",
                    [source],
                )?;
            }
        }
        if let Some(materials) = recovery
            .get("recoveryMaterials")
            .and_then(|v| v.as_object())
        {
            for (id, count) in materials {
                let count = count.as_u64().unwrap_or(0);
                tx.execute(
                    "UPDATE material_stock SET count=MAX(0,count-?2) WHERE material_id=?1",
                    params![id, count],
                )?;
            }
        }
        let tags = recovery
            .get("recoveryTags")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        if tags > 0 {
            tx.execute(
                "UPDATE meta SET value=MAX(0,CAST(value AS INTEGER)-?2) WHERE key=?1",
                params![crate::link_tag::OWNED_KEY, tags],
            )?;
        }
        tx.execute("INSERT OR REPLACE INTO referee_reconciliations VALUES ('pack_opened_remote',?1,?2,?3,?4)",params![work.target,work.body,code,now()])?;
        remove(&tx, &work.kind, &work.target)?;
        tx.commit()?;
        return Err(RefereeError::Rejected("pack_opened_during_save".into()).into());
    }
    result
}
pub fn ensure_registered(db: &mut Database, c: &Creation, referee: &dyn Referee) -> Result<bool> {
    if !referee.enabled() {
        return Ok(false);
    }
    if pending_cancel(db, &c.sticker_id)? {
        return Err(RefereeError::Rejected("pending_cancel".into()).into());
    }
    if checked(db, &c.sticker_id)?.as_deref() == Some("pre_server") || !c.verified() {
        return Ok(false);
    }
    if checked(db, &c.sticker_id)?.as_deref() != Some("checked") {
        referee.register(c)?;
        let tx = db.conn.transaction()?;
        tx.execute(
            "UPDATE stickers SET checked='checked' WHERE id=?1",
            [&c.sticker_id],
        )?;
        remove(&tx, "register", &c.sticker_id)?;
        tx.commit()?;
    }
    Ok(true)
}
fn compensate(db: &mut Database, referee: &dyn Referee, kind: &str, target: &str) -> Result<()> {
    let body: String = db.conn.query_row(
        "SELECT body FROM referee_outbox WHERE kind=?1 AND target=?2",
        params![kind, target],
        |r| r.get(0),
    )?;
    let work = SyncWork {
        kind: kind.into(),
        target: target.into(),
        body,
    };
    let result = work.run(referee);
    match reconcile_work(db, &work, referee, result) {
        Ok(()) => finish_work(db, &work, Ok(())),
        Err(Error::Referee(RefereeError::Rejected(code)))
            if code == "gift_received_during_save" || code == "pack_opened_during_save" =>
        {
            Err(RefereeError::Rejected(code).into())
        }
        _ => Ok(()), // Retryable intent remains durable, including an unknown remote operation.
    }
}
pub(crate) fn compensate_release(
    db: &mut Database,
    referee: &dyn Referee,
    t: &Transfer,
) -> Result<()> {
    compensate(db, referee, "cancel_release", &t.sticker_id)
}
pub(crate) fn compensate_pack(
    db: &mut Database,
    referee: &dyn Referee,
    p: &o::PackRegistration,
) -> Result<()> {
    compensate(db, referee, "cancel_pack", &p.pack_id)
}
pub(crate) fn known_status(referee: &dyn Referee, id: &str) -> Result<bool> {
    match referee.status(id) {
        Ok(Status::Unknown) | Err(Error::Referee(RefereeError::Unknown)) => Ok(false),
        Ok(_) => Ok(true),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        creator_pack,
        ownership::{Chain, PackRegistration},
        sign,
    };
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    #[derive(Default)]
    struct Ledger {
        stickers: HashMap<String, Chain>,
        packs: HashMap<String, PackRegistration>,
        slots: HashMap<(String, u32), Option<Transfer>>,
        fail_release: bool,
        fail_cancel: bool,
        fail_press: bool,
        fail_claim_response: bool,
        fail_slot_response: bool,
        collisions: u32,
        slot_calls: Vec<u32>,
        cancel_calls: u32,
    }
    #[derive(Default)]
    struct Memory(RefCell<Ledger>);
    fn rejected(code: &str) -> Error {
        RefereeError::Rejected(code.into()).into()
    }
    impl Referee for Memory {
        fn register(&self, c: &Creation) -> Result<()> {
            let mut m = self.0.borrow_mut();
            if let Some(old) = m.stickers.get(&c.sticker_id) {
                if old.creation != *c {
                    return Err(rejected("taken"));
                }
            } else {
                m.stickers.insert(
                    c.sticker_id.clone(),
                    Chain {
                        creation: c.clone(),
                        transfers: vec![],
                    },
                );
            }
            Ok(())
        }
        fn release(&self, t: &Transfer) -> Result<()> {
            let mut m = self.0.borrow_mut();
            if m.fail_release {
                return Err(RefereeError::Offline.into());
            }
            let chain = m
                .stickers
                .get_mut(&t.sticker_id)
                .ok_or(RefereeError::Unknown)?;
            if chain.transfers.last() == Some(t) {
                return Ok(());
            }
            if chain.transfers.len() != t.seq as usize {
                return Err(rejected("seq_mismatch"));
            }
            chain.transfers.push(t.clone());
            Ok(())
        }
        fn cancel_release(&self, t: &Transfer) -> Result<()> {
            let mut m = self.0.borrow_mut();
            m.cancel_calls += 1;
            if m.fail_cancel {
                return Err(RefereeError::Offline.into());
            }
            if let Some(chain) = m.stickers.get_mut(&t.sticker_id) {
                if chain.transfers.last().is_some_and(|t| t.kind == "claim") {
                    return Err(rejected("not_yours"));
                }
                if chain.transfers.last() == Some(t) {
                    chain.transfers.pop();
                }
            }
            Ok(())
        }
        fn claim(&self, t: &Transfer) -> Result<()> {
            let mut m = self.0.borrow_mut();
            let chain = m
                .stickers
                .get_mut(&t.sticker_id)
                .ok_or(RefereeError::Unknown)?;
            if chain.transfers.last() == Some(t) {
                return Ok(());
            }
            if chain.transfers.len() != t.seq as usize
                || chain.transfers.last().is_none_or(|t| t.kind != "release")
            {
                return Err(rejected("already_claimed"));
            }
            chain.transfers.push(t.clone());
            if m.fail_claim_response {
                m.fail_claim_response = false;
                return Err(RefereeError::Offline.into());
            }
            Ok(())
        }
        fn register_pack(&self, p: &PackRegistration) -> Result<()> {
            if self.0.borrow().fail_press {
                return Err(rejected("taken"));
            }
            for e in &p.editions {
                self.register(&e.creation)?;
                self.release(&e.release)?;
            }
            for t in &p.moved_releases {
                self.release(t)?;
            }
            self.0
                .borrow_mut()
                .packs
                .insert(p.pack_id.clone(), p.clone());
            Ok(())
        }
        fn cancel_pack(&self, registration: &PackRegistration) -> Result<()> {
            let mut m = self.0.borrow_mut();
            m.cancel_calls += 1;
            if m.fail_cancel {
                return Err(RefereeError::Offline.into());
            }
            if m.slots.keys().any(|(id, _)| id == &registration.pack_id) {
                return Err(rejected("already_opened"));
            }
            if let Some(p) = m.packs.remove(&registration.pack_id) {
                for e in p.editions {
                    m.stickers.remove(&e.creation.sticker_id);
                }
                for t in p.moved_releases {
                    if let Some(c) = m.stickers.get_mut(&t.sticker_id) {
                        c.transfers.pop();
                    }
                }
            }
            Ok(())
        }
        fn claim_slot(&self, id: &str, slot: u32, t: Option<&Transfer>) -> Result<()> {
            {
                let mut m = self.0.borrow_mut();
                m.slot_calls.push(slot);
                if m.collisions > 0 {
                    m.collisions -= 1;
                    m.slots.insert((id.into(), slot), None);
                    return Err(rejected("slot_taken"));
                }
                if let Some(old) = m.slots.get(&(id.into(), slot)) {
                    if old.as_ref() == t {
                        return Ok(());
                    }
                    return Err(rejected("slot_taken"));
                }
            }
            if let Some(t) = t {
                self.claim(t)?;
            }
            let mut m = self.0.borrow_mut();
            m.slots.insert((id.into(), slot), t.cloned());
            if m.fail_slot_response {
                m.fail_slot_response = false;
                return Err(RefereeError::Offline.into());
            }
            Ok(())
        }
        fn claimed_slots(&self, id: &str) -> Result<Vec<u32>> {
            Ok(self
                .0
                .borrow()
                .slots
                .keys()
                .filter(|(p, _)| p == id)
                .map(|(_, n)| *n)
                .collect())
        }
        fn status(&self, id: &str) -> Result<Status> {
            Ok(self
                .0
                .borrow()
                .stickers
                .get(id)
                .map(|c| {
                    if c.transfers.last().is_some_and(|t| t.kind == "release") {
                        Status::Released
                    } else {
                        Status::Held {
                            holder: c
                                .transfers
                                .last()
                                .map(|t| t.actor_key.clone())
                                .unwrap_or_else(|| c.creation.creator_public_key.clone().unwrap()),
                        }
                    }
                })
                .unwrap_or(Status::Unknown))
        }
        fn pack_known(&self, id: &str) -> Result<bool> {
            Ok(self.0.borrow().packs.contains_key(id))
        }
    }
    fn library() -> Library {
        Library::open(&std::env::temp_dir().join(crate::ids::new_gift_id())).unwrap()
    }
    fn art() -> (Vec<u8>, crate::creator::Rendered) {
        let mut image = image::RgbaImage::new(24, 20);
        for y in 3..17 {
            for x in 3..21 {
                image.put_pixel(x, y, image::Rgba([100, 80, 40, 255]));
            }
        }
        let mut png = vec![];
        image
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let rendered = crate::pack::render_pack_sticker(&png).unwrap();
        (png, rendered)
    }
    fn make(lib: &mut Library) -> crate::Sticker {
        let (png, rendered) = art();
        lib.add_made(&rendered, &png, "png", None, "kraft").unwrap()
    }
    fn pack_fixture(m: &Memory) -> (Library, Vec<creator_pack::Selection>) {
        let mut lib = library();
        migrate(&mut lib).unwrap();
        let mut items = vec![];
        for n in 0..3 {
            let s = make(&mut lib);
            items.push(creator_pack::Selection {
                sticker_id: s.id,
                name: format!("Design {n}"),
                copies: 2,
            });
        }
        sync(lib.db_mut(), m).unwrap();
        (lib, items)
    }
    fn send(lib: &mut Library, id: &str, m: &dyn Referee) -> Result<Vec<u8>> {
        crate::gift::transfer_gift(
            lib,
            id,
            "Friend",
            None,
            &crate::gift::GiftDress::default(),
            m,
            |_| Ok(()),
        )
        .map(|(_, bytes)| bytes)
    }
    #[test]
    fn offline_creation_then_sync_marks_checked_without_consuming_twice() {
        let mut lib = library();
        migrate(&mut lib).unwrap();
        let s = make(&mut lib);
        assert_eq!(
            checked(lib.db(), &s.id).unwrap().as_deref(),
            Some("pending")
        );
        let m = Memory::default();
        sync(lib.db_mut(), &m).unwrap();
        assert_eq!(
            checked(lib.db(), &s.id).unwrap().as_deref(),
            Some("checked")
        );
        assert_eq!(counts(lib.db()).unwrap().registrations, 0);
    }
    #[test]
    fn one_gift_only_one_data_folder_receives_and_retry_reuses_the_exact_claim() {
        let m = Memory::default();
        let mut a = library();
        migrate(&mut a).unwrap();
        let s = make(&mut a);
        let bytes = send(&mut a, &s.id, &m).unwrap();
        let mut b = library();
        let mut c = library();
        m.0.borrow_mut().fail_claim_response = true;
        assert!(matches!(
            crate::gift::receive_gift_with_referee(&mut b, &bytes, &m),
            Err(Error::Referee(RefereeError::Offline))
        ));
        assert!(b.db().gifts_received().unwrap().is_empty());
        let saved: String = b
            .db()
            .conn
            .query_row("SELECT chain FROM gift_claim_pending", [], |r| r.get(0))
            .unwrap();
        crate::gift::receive_gift_with_referee(&mut b, &bytes, &m).unwrap();
        let chain: Chain = parse(&saved).unwrap();
        assert_eq!(
            m.0.borrow().stickers[&s.id].transfers.last(),
            chain.transfers.last()
        );
        assert!(
            matches!(crate::gift::receive_gift_with_referee(&mut c,&bytes,&m),Err(Error::Referee(RefereeError::Rejected(code))) if code=="already_claimed")
        );
        assert!(c.db().gifts_received().unwrap().is_empty());
        let gift = b.db().gifts_received().unwrap()[0].gift_id.clone();
        crate::gift::open_gift(&mut b, &gift).unwrap();
        assert_eq!(checked(b.db(), &s.id).unwrap().as_deref(), Some("checked"));
    }
    #[test]
    fn failed_send_compensates_and_pending_cancellation_blocks_another_send() {
        let m = Memory::default();
        let mut lib = library();
        migrate(&mut lib).unwrap();
        let s = make(&mut lib);
        sync(lib.db_mut(), &m).unwrap();
        m.0.borrow_mut().fail_release = true;
        assert!(send(&mut lib, &s.id, &m).is_err());
        assert_eq!(lib.db().sticker(&s.id).unwrap().unwrap().state, "held");
        m.0.borrow_mut().fail_release = false;
        m.0.borrow_mut().fail_cancel = true;
        assert!(crate::gift::transfer_gift(
            &mut lib,
            &s.id,
            "Friend",
            None,
            &crate::gift::GiftDress::default(),
            &m,
            |_| Err(Error::Invalid("disk full".into()))
        )
        .is_err());
        assert_eq!(lib.db().gifts_sent_count(&s.id).unwrap(), 0);
        assert_eq!(counts(lib.db()).unwrap().cancellations, 1);
        assert!(
            matches!(send(&mut lib,&s.id,&m),Err(Error::Referee(RefereeError::Rejected(code))) if code=="pending_cancel")
        );
        m.0.borrow_mut().fail_cancel = false;
        sync(lib.db_mut(), &m).unwrap();
        send(&mut lib, &s.id, &m).unwrap();
    }
    #[test]
    fn pre_server_gift_is_received_without_claiming() {
        let mut a = library();
        let s = make(&mut a);
        let bytes = send(&mut a, &s.id, &o::NoReferee).unwrap();
        let m = Memory::default();
        let mut b = library();
        let gift = crate::gift::receive_gift_with_referee(&mut b, &bytes, &m).unwrap();
        crate::gift::open_gift(&mut b, &gift.gift_id).unwrap();
        assert_eq!(
            checked(b.db(), &s.id).unwrap().as_deref(),
            Some("pre_server")
        );
        assert!(m.0.borrow().stickers.is_empty());
    }
    #[test]
    fn press_rejection_and_commit_failure_leave_originals_and_cancel_the_pack() {
        let m = Memory::default();
        let (mut lib, items) = pack_fixture(&m);
        m.0.borrow_mut().fail_press = true;
        assert!(creator_pack::press(
            &mut lib,
            "Rejected",
            "kraft",
            &items,
            &[],
            &crate::creator_pack::Dress::default(),
            false,
            &m,
            |_, _| Ok(())
        )
        .is_err());
        assert!(items
            .iter()
            .all(|i| !lib.db().sticker(&i.sticker_id).unwrap().unwrap().pressed));
        m.0.borrow_mut().fail_press = false;
        assert!(creator_pack::press(
            &mut lib,
            "Disk full",
            "kraft",
            &items,
            &[],
            &crate::creator_pack::Dress::default(),
            false,
            &m,
            |_, _| Err(Error::Invalid("disk full".into()))
        )
        .is_err());
        assert!(m.0.borrow().packs.is_empty());
        assert!(m.0.borrow().cancel_calls > 0);
        assert_eq!(counts(lib.db()).unwrap().cancellations, 0);
    }
    #[test]
    fn opening_syncs_other_slots_and_preserves_one_pending_draw_after_timeout() {
        let m = Memory::default();
        let (mut a, items) = pack_fixture(&m);
        let mut bytes = vec![];
        creator_pack::press(
            &mut a,
            "Finite",
            "kraft",
            &items,
            &[],
            &crate::creator_pack::Dress::default(),
            false,
            &m,
            |_, b| {
                bytes = b.to_vec();
                Ok(())
            },
        )
        .unwrap();
        let p = creator_pack::decode(&bytes).unwrap();
        let public = p.header().pack_id.clone();
        m.0.borrow_mut().slots.insert((public, 0), None);
        let mut b = library();
        let id = creator_pack::install(&mut b, &p, true).unwrap();
        m.0.borrow_mut().fail_slot_response = true;
        assert!(matches!(
            crate::edition_pack::open(&mut b, &id, 0.0, false, "2026-10-12", true, &m),
            Err(Error::Referee(RefereeError::Offline))
        ));
        assert_eq!(b.db().sticker_count().unwrap(), 0);
        assert_eq!(counts(b.db()).unwrap().slots, 1);
        let slot: u32 = b
            .db()
            .conn
            .query_row("SELECT slot_no FROM pack_slot_pending", [], |r| r.get(0))
            .unwrap();
        assert_ne!(slot, 0);
        let award =
            crate::edition_pack::open(&mut b, &id, 0.99, false, "2026-10-12", true, &m).unwrap();
        assert!(award.sticker_id.is_some());
        let calls = &m.0.borrow().slot_calls;
        assert_eq!(calls[calls.len() - 1], calls[calls.len() - 2]);
        assert_eq!(counts(b.db()).unwrap().slots, 0);
        assert_eq!(award.remaining, 4);
    }
    #[test]
    fn slot_collisions_redraw_at_most_three_times() {
        let m = Memory::default();
        let (mut a, items) = pack_fixture(&m);
        let mut bytes = vec![];
        creator_pack::press(
            &mut a,
            "Contended",
            "kraft",
            &items,
            &[],
            &crate::creator_pack::Dress::default(),
            false,
            &m,
            |_, b| {
                bytes = b.to_vec();
                Ok(())
            },
        )
        .unwrap();
        let p = creator_pack::decode(&bytes).unwrap();
        let mut b = library();
        let id = creator_pack::install(&mut b, &p, true).unwrap();
        m.0.borrow_mut().collisions = 3;
        assert!(
            matches!(crate::edition_pack::open(&mut b,&id,0.0,false,"2026-10-12",false,&m),Err(Error::Referee(RefereeError::Rejected(code))) if code=="busy_pack")
        );
        assert_eq!(m.0.borrow().slot_calls.len(), 3);
        assert_eq!(b.db().sticker_count().unwrap(), 0);
        assert_eq!(counts(b.db()).unwrap().slots, 0);
        crate::edition_pack::open(&mut b, &id, 0.0, false, "2026-10-12", false, &m).unwrap();
    }
    #[test]
    fn migration_classifies_only_proven_never_released_local_originals() {
        let mut lib = library();
        let local = make(&mut lib);
        let pressed = make(&mut lib);
        let gone = make(&mut lib);
        let damaged = make(&mut lib);
        let edition = make(&mut lib);
        let foreign = make(&mut lib);
        lib.db()
            .conn
            .execute("UPDATE stickers SET pressed=1 WHERE id=?1", [&pressed.id])
            .unwrap();
        lib.db()
            .conn
            .execute("UPDATE stickers SET state='gone' WHERE id=?1", [&gone.id])
            .unwrap();
        lib.db()
            .conn
            .execute(
                "UPDATE stickers SET creation_record='bad' WHERE id=?1",
                [&damaged.id],
            )
            .unwrap();
        lib.db()
            .conn
            .execute(
                "UPDATE stickers SET edition_number=1 WHERE id=?1",
                [&edition.id],
            )
            .unwrap();
        lib.db()
            .conn
            .execute(
                "UPDATE stickers SET creator_public_key=?2 WHERE id=?1",
                params![foreign.id, sign::public_key(&sign::generate().unwrap())],
            )
            .unwrap();
        let copied = lib.db_mut().seed_legacy_copies(&local.id, 1).unwrap();
        let transferred = make(&mut lib);
        let t = Transfer {
            sticker_id: transferred.id.clone(),
            seq: 0,
            kind: "release".into(),
            actor_key: "key".into(),
            reference: "gift".into(),
            at: now(),
            sig: "test".into(),
        };
        o::store_transfer(&lib.db().conn, &t).unwrap();
        migrate(&mut lib).unwrap();
        assert_eq!(
            checked(lib.db(), &local.id).unwrap().as_deref(),
            Some("pending")
        );
        for s in [pressed, gone, damaged, edition, foreign, transferred] {
            assert_eq!(
                checked(lib.db(), &s.id).unwrap().as_deref(),
                Some("pre_server")
            );
        }
        assert_eq!(checked(lib.db(), &copied[0].id).unwrap(), None);
        let before: HashSet<String> = lib
            .db()
            .conn
            .prepare("SELECT target FROM referee_outbox")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        migrate(&mut lib).unwrap();
        assert_eq!(before.len(), 1);
        assert_eq!(counts(lib.db()).unwrap().registrations, 1);
    }
    #[test]
    fn consumed_gift_before_local_failure_reconciles_and_does_not_starve_registration() {
        let m = Memory::default();
        let mut a = library();
        migrate(&mut a).unwrap();
        let s = make(&mut a);
        sync(a.db_mut(), &m).unwrap();
        let recipient = crate::device_key::load_or_create(library().root()).unwrap();
        let result = crate::gift::transfer_gift(
            &mut a,
            &s.id,
            "Friend",
            None,
            &crate::gift::GiftDress::default(),
            &m,
            |bytes| {
                let mut chain = crate::gift::decode_gift(bytes)?.header.history.unwrap();
                let reference = chain.transfers.last().unwrap().reference.clone();
                let t = o::append(&mut chain, "claim", &reference, &recipient)?;
                m.claim(&t)?;
                Err(Error::Invalid("simulated local save failure".into()))
            },
        );
        assert!(
            matches!(result,Err(Error::Referee(RefereeError::Rejected(code))) if code=="gift_received_during_save")
        );
        assert_eq!(a.db().sticker(&s.id).unwrap().unwrap().state, "gone");
        assert_eq!(counts(a.db()).unwrap().reconciliations, 1);
        assert!(!pending_cancel(a.db(), &s.id).unwrap());
        let next = make(&mut a);
        sync(a.db_mut(), &m).unwrap();
        assert_eq!(
            checked(a.db(), &next.id).unwrap().as_deref(),
            Some("checked")
        );
        assert_eq!(o::stored_transfers(&a.db().conn, &s.id).unwrap().len(), 1);
    }
    #[test]
    fn opened_pack_before_local_failure_marks_sources_pressed() {
        let m = Memory::default();
        let (mut a, items) = pack_fixture(&m);
        let result = creator_pack::press(
            &mut a,
            "Test pack",
            "kraft",
            &items,
            &[],
            &creator_pack::Dress::default(),
            false,
            &m,
            |h, _| {
                let p = m.0.borrow().packs.get(&h.pack_id).unwrap().clone();
                let e = &p.editions[0];
                let mut chain = Chain {
                    creation: e.creation.clone(),
                    transfers: vec![e.release.clone()],
                };
                let recipient = crate::device_key::load_or_create(library().root())?;
                let t = o::append(&mut chain, "claim", &e.release.reference, &recipient)?;
                m.claim_slot(&h.pack_id, 0, Some(&t))?;
                Err(Error::Invalid("simulated save failure".into()))
            },
        );
        assert!(
            matches!(result,Err(Error::Referee(RefereeError::Rejected(code))) if code=="pack_opened_during_save")
        );
        for item in &items {
            assert!(a.db().sticker(&item.sticker_id).unwrap().unwrap().pressed);
        }
        assert_eq!(counts(a.db()).unwrap().reconciliations, 1);
        assert_eq!(counts(a.db()).unwrap().cancellations, 0);
        assert_eq!(
            a.db()
                .conn
                .query_row("SELECT COUNT(*) FROM packs_made", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn rejected_recovery_does_not_starve_an_unrelated_registration() {
        struct Refusal;
        impl Referee for Refusal {
            fn cancel_pack(&self, _: &PackRegistration) -> Result<()> {
                Err(rejected("ref_mismatch"))
            }
        }
        let m = Memory::default();
        let (mut a, items) = pack_fixture(&m);
        m.0.borrow_mut().fail_cancel = true;
        let _ = creator_pack::press(
            &mut a,
            "Test pack",
            "kraft",
            &items,
            &[],
            &creator_pack::Dress::default(),
            false,
            &m,
            |_, _| Err(Error::Invalid("save failure".into())),
        );
        let next = make(&mut a);
        assert!(sync(a.db_mut(), &Refusal).is_err());
        assert_eq!(
            checked(a.db(), &next.id).unwrap().as_deref(),
            Some("checked")
        );
        assert_eq!(counts(a.db()).unwrap().cancellations, 1);
    }
}
