//! Reusable screen arrangements. Only references are saved; no printing, daily records or tags are changed.
use crate::{db::now, Database, Error, Placement, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

pub const OWNED_KEY: &str = "boards.owned";
pub const MAX_OWNED: i64 = 12;
const UNDO_KEY: &str = "boards.undo";
fn invalid(code: &str) -> Error {
    Error::Invalid(code.into())
}
fn json<T: Serialize>(v: &T) -> Result<String> {
    serde_json::to_string(v).map_err(|e| invalid(&e.to_string()))
}
fn meta(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0))
        .optional()?)
}
fn set(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO meta VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )?;
    Ok(())
}
fn name(raw: &str) -> Result<String> {
    let n = crate::clean_title(raw)
        .map_err(|_| invalid("invalid_board_name"))?
        .ok_or_else(|| invalid("invalid_board_name"))?;
    if n.chars().count() > 24 {
        return Err(invalid("invalid_board_name"));
    }
    Ok(n)
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub sticker_id: String,
    pub relative_x: f64,
    pub relative_y: f64,
    pub relative_scale: f64,
    pub rotation: f64,
    pub z: i64,
}
impl From<&Placement> for Item {
    fn from(p: &Placement) -> Self {
        Self {
            sticker_id: p.sticker_id.clone(),
            relative_x: p.relative_x,
            relative_y: p.relative_y,
            relative_scale: p.relative_scale,
            rotation: p.rotation,
            z: p.z,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub id: String,
    pub name: String,
    pub sort: i64,
    pub created_at: String,
    pub updated_at: String,
    pub items: Vec<Item>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rule {
    pub id: String,
    pub sort: i64,
    pub kind: String,
    pub days: u8,
    pub start_min: Option<u16>,
    pub end_min: Option<u16>,
    pub wifi: Option<String>,
    pub display_id: String,
    pub board_id: String,
    pub enabled: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stock {
    pub owned: i64,
    pub available: i64,
    pub limit: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Undo {
    pub display_id: String,
    pub items: Vec<Placement>,
    pub at: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    pub sticker_id: String,
    pub reason: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PutResult {
    pub display_id: String,
    pub placed: usize,
    pub skipped: Vec<Skipped>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemStatus {
    #[serde(flatten)]
    pub item: Item,
    pub state: String,
    pub aspect: f64,
    pub on_display: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardStatus {
    #[serde(flatten)]
    pub board: Board,
    pub stickers: Vec<ItemStatus>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screen {
    pub id: String,
    pub connected: bool,
    pub primary: bool,
    pub items: Vec<ItemStatus>,
    pub board: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub screens: Vec<Screen>,
    pub boards: Vec<BoardStatus>,
    pub rules: Vec<Rule>,
    pub stock: Stock,
    pub undo: Option<Undo>,
}

fn placements(conn: &Connection, display: &str) -> Result<Vec<Placement>> {
    let mut q=conn.prepare("SELECT sticker_id,relative_x,relative_y,relative_scale,rotation,z,placed_at FROM placements WHERE is_on_desktop=1 AND display_id=?1 ORDER BY z,sticker_id")?;
    let rows = q.query_map([display], |r| {
        Ok(Placement {
            sticker_id: r.get(0)?,
            display_id: display.into(),
            relative_x: r.get(1)?,
            relative_y: r.get(2)?,
            relative_scale: r.get(3)?,
            rotation: r.get(4)?,
            z: r.get(5)?,
            placed_at: r.get(6)?,
            is_on_desktop: true,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}
fn items(conn: &Connection, id: &str) -> Result<Vec<Item>> {
    let mut q=conn.prepare("SELECT sticker_id,relative_x,relative_y,relative_scale,rotation,z FROM board_items WHERE board_id=?1 ORDER BY z,sticker_id")?;
    let rows = q.query_map([id], |r| {
        Ok(Item {
            sticker_id: r.get(0)?,
            relative_x: r.get(1)?,
            relative_y: r.get(2)?,
            relative_scale: r.get(3)?,
            rotation: r.get(4)?,
            z: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}
fn boards(conn: &Connection) -> Result<Vec<Board>> {
    let mut q =
        conn.prepare("SELECT id,name,sort,created_at,updated_at FROM boards ORDER BY sort,id")?;
    let rows = q.query_map([], |r| {
        Ok(Board {
            id: r.get(0)?,
            name: r.get(1)?,
            sort: r.get(2)?,
            created_at: r.get(3)?,
            updated_at: r.get(4)?,
            items: vec![],
        })
    })?;
    let mut out: Vec<Board> = rows.collect::<rusqlite::Result<_>>()?;
    for b in &mut out {
        b.items = items(conn, &b.id)?;
    }
    Ok(out)
}
fn stock(conn: &Connection) -> Result<Stock> {
    let owned = meta(conn, OWNED_KEY)?
        .ok_or_else(|| invalid("Board stock could not be read."))?
        .parse::<i64>()
        .map_err(|_| invalid("Board stock could not be read."))?;
    if !(2..=MAX_OWNED).contains(&owned) {
        return Err(invalid("Board stock is out of range."));
    }
    let used: i64 = conn.query_row("SELECT COUNT(*) FROM boards", [], |r| r.get(0))?;
    Ok(Stock {
        owned,
        available: (owned - used).max(0),
        limit: MAX_OWNED,
    })
}
fn read_undo(conn: &Connection) -> Result<Option<Undo>> {
    meta(conn, UNDO_KEY)?
        .map(|s| serde_json::from_str(&s).map_err(|_| invalid("Undo could not be read.")))
        .transpose()
}
fn exists(conn: &Connection, id: &str) -> Result<()> {
    if conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM boards WHERE id=?1)",
        [id],
        |r| r.get::<_, bool>(0),
    )? {
        Ok(())
    } else {
        Err(invalid("board_not_found"))
    }
}
fn copy_screen(conn: &Connection, id: &str, display: &str) -> Result<()> {
    if placements(conn, display)?.is_empty() {
        return Err(invalid("nothing_to_save"));
    }
    conn.execute("DELETE FROM board_items WHERE board_id=?1", [id])?;
    conn.execute("INSERT INTO board_items SELECT ?1,sticker_id,relative_x,relative_y,relative_scale,rotation,z FROM placements WHERE is_on_desktop=1 AND display_id=?2",params![id,display])?;
    Ok(())
}
fn apply(conn: &Connection, display: &str, wanted: &[Item]) -> Result<PutResult> {
    conn.execute(
        "UPDATE placements SET is_on_desktop=0 WHERE display_id=?1 AND is_on_desktop=1",
        [display],
    )?;
    let mut result = PutResult {
        display_id: display.into(),
        placed: 0,
        skipped: vec![],
    };
    for it in wanted {
        let state: Option<String> = conn
            .query_row(
                "SELECT state FROM stickers WHERE id=?1",
                [&it.sticker_id],
                |r| r.get(0),
            )
            .optional()?;
        let other:Option<String>=conn.query_row("SELECT display_id FROM placements WHERE sticker_id=?1 AND is_on_desktop=1 AND display_id!=?2",params![it.sticker_id,display],|r|r.get(0)).optional()?;
        let reason = if state.as_deref() != Some("held") {
            Some("not_yours")
        } else if other.is_some() {
            Some("on_another_screen")
        } else {
            None
        };
        if let Some(r) = reason {
            result.skipped.push(Skipped {
                sticker_id: it.sticker_id.clone(),
                reason: r.into(),
            });
            continue;
        }
        if ![it.relative_x, it.relative_y, it.relative_scale, it.rotation]
            .iter()
            .all(|x| x.is_finite())
            || !(0.0..=1.0).contains(&it.relative_x)
            || !(0.0..=1.0).contains(&it.relative_y)
            || !(0.03..=0.8).contains(&it.relative_scale)
        {
            return Err(invalid("invalid_board_placement"));
        }
        conn.execute("INSERT INTO placements(sticker_id,display_id,relative_x,relative_y,relative_scale,rotation,z,placed_at,is_on_desktop) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1) ON CONFLICT(sticker_id) DO UPDATE SET display_id=excluded.display_id,relative_x=excluded.relative_x,relative_y=excluded.relative_y,relative_scale=excluded.relative_scale,rotation=excluded.rotation,z=excluded.z,placed_at=excluded.placed_at,is_on_desktop=1",params![it.sticker_id,display,it.relative_x,it.relative_y,it.relative_scale,it.rotation,it.z,now()])?;
        result.placed += 1;
    }
    Ok(result)
}
/// Ignore stacking order, and compare angles across the +/-180 boundary.
pub fn matches(a: &[Item], b: &[Item]) -> bool {
    a.len() == b.len()
        && a.iter().all(|p| {
            b.iter()
                .find(|q| p.sticker_id == q.sticker_id)
                .is_some_and(|q| {
                    let angle = (p.rotation - q.rotation + 180.0).rem_euclid(360.0) - 180.0;
                    (p.relative_x - q.relative_x).abs() <= 0.005
                        && (p.relative_y - q.relative_y).abs() <= 0.005
                        && (p.relative_scale - q.relative_scale).abs() <= 0.01
                        && angle.abs() <= 1.0
                })
        })
}
fn annotate(conn: &Connection, it: Item) -> Result<ItemStatus> {
    let (state, aspect): (String, f64) = conn.query_row(
        "SELECT state,aspect FROM stickers WHERE id=?1",
        [&it.sticker_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let on_display = conn
        .query_row(
            "SELECT display_id FROM placements WHERE sticker_id=?1 AND is_on_desktop=1",
            [&it.sticker_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(ItemStatus {
        item: it,
        state,
        aspect,
        on_display,
    })
}
impl Database {
    pub fn board_stock(&self) -> Result<Stock> {
        stock(&self.conn)
    }
    pub fn boards(&self) -> Result<Vec<Board>> {
        boards(&self.conn)
    }
    pub fn board_save(&mut self, display: &str, raw: &str) -> Result<Board> {
        let n = name(raw)?;
        let id = crate::ids::new_sticker_id();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if placements(&tx, display)?.is_empty() {
            return Err(invalid("nothing_to_save"));
        }
        if stock(&tx)?.available == 0 {
            return Err(invalid("no_blank_board"));
        }
        let sort: i64 = tx.query_row("SELECT COALESCE(MAX(sort),-1)+1 FROM boards", [], |r| {
            r.get(0)
        })?;
        let at = now();
        tx.execute(
            "INSERT INTO boards VALUES (?1,?2,?3,?4,?4)",
            params![id, n, sort, at],
        )?;
        copy_screen(&tx, &id, display)?;
        let b = boards(&tx)?.into_iter().find(|b| b.id == id).unwrap();
        tx.commit()?;
        Ok(b)
    }
    pub fn board_update(&mut self, id: &str, display: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        exists(&tx, id)?;
        copy_screen(&tx, id, display)?;
        tx.execute(
            "UPDATE boards SET updated_at=?2 WHERE id=?1",
            params![id, now()],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn board_rename(&mut self, id: &str, raw: &str) -> Result<()> {
        let n = name(raw)?;
        if self.conn.execute(
            "UPDATE boards SET name=?2,updated_at=?3 WHERE id=?1",
            params![id, n, now()],
        )? == 0
        {
            return Err(invalid("board_not_found"));
        }
        Ok(())
    }
    pub fn board_delete(&mut self, id: &str) -> Result<()> {
        if self.conn.execute("DELETE FROM boards WHERE id=?1", [id])? == 0 {
            return Err(invalid("board_not_found"));
        }
        Ok(())
    }
    pub fn board_put(
        &mut self,
        id: &str,
        display: &str,
        connected: &[String],
    ) -> Result<PutResult> {
        if !connected.iter().any(|d| d == display) {
            return Err(invalid("screen_not_connected"));
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let r = put_in(&tx, id, display)?;
        tx.commit()?;
        Ok(r)
    }
    pub fn board_undo(&mut self) -> Result<Option<PutResult>> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let Some(u) = read_undo(&tx)? else {
            return Ok(None);
        };
        let r = apply(
            &tx,
            &u.display_id,
            &u.items.iter().map(Item::from).collect::<Vec<_>>(),
        )?;
        // Preserve the original placement timestamps too.
        for p in &u.items {
            tx.execute("UPDATE placements SET placed_at=?3 WHERE sticker_id=?1 AND display_id=?2 AND is_on_desktop=1",params![p.sticker_id,u.display_id,p.placed_at])?;
        }
        tx.execute("DELETE FROM meta WHERE key=?1", [UNDO_KEY])?;
        tx.commit()?;
        Ok(Some(r))
    }
    pub fn board_bring_here(&mut self, from: &str, to: &str) -> Result<usize> {
        if from == to || from.is_empty() || to.is_empty() {
            return Err(invalid("invalid_screen"));
        }
        let tx = self.conn.transaction()?;
        let n = tx.execute(
            "UPDATE placements SET display_id=?2 WHERE display_id=?1 AND is_on_desktop=1",
            params![from, to],
        )?;
        tx.commit()?;
        Ok(n)
    }
    pub fn boards_status(&self, connected: &[String], primary: &str) -> Result<Status> {
        let tx = self.conn.unchecked_transaction()?;
        let saved = boards(&tx)?;
        let mut ids = connected.to_vec();
        {
            let mut q=tx.prepare("SELECT DISTINCT display_id FROM placements WHERE is_on_desktop=1 ORDER BY display_id")?;
            for id in q.query_map([], |r| r.get::<_, String>(0))? {
                let id = id?;
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
        let mut screens = vec![];
        for id in ids {
            let p: Vec<Item> = placements(&tx, &id)?.iter().map(Item::from).collect();
            let board = saved
                .iter()
                .find(|b| matches(&p, &b.items))
                .map(|b| b.id.clone());
            screens.push(Screen {
                id: id.clone(),
                connected: connected.contains(&id),
                primary: id == primary,
                items: p
                    .into_iter()
                    .map(|p| annotate(&tx, p))
                    .collect::<Result<_>>()?,
                board,
            });
        }
        let mut out = vec![];
        for b in saved {
            let stickers = b
                .items
                .iter()
                .cloned()
                .map(|it| annotate(&tx, it))
                .collect::<Result<_>>()?;
            out.push(BoardStatus { board: b, stickers });
        }
        let status = Status {
            screens,
            boards: out,
            rules: rules(&tx)?,
            stock: stock(&tx)?,
            undo: read_undo(&tx)?,
        };
        tx.commit()?;
        Ok(status)
    }
    pub fn board_rules(&self) -> Result<Vec<Rule>> {
        rules(&self.conn)
    }
    pub fn board_rule_save(&mut self, mut rule: Rule, connected: &[String]) -> Result<Rule> {
        if !["time", "place"].contains(&rule.kind.as_str()) {
            return Err(invalid("invalid_rule"));
        }
        if rule.kind == "time" {
            if rule.days == 0
                || rule.days > 127
                || rule.start_min.is_none()
                || rule.end_min.is_none()
                || rule.start_min == rule.end_min
                || rule.start_min.unwrap() > 1439
                || rule.end_min.unwrap() > 1439
            {
                return Err(invalid("invalid_time_rule"));
            }
            rule.wifi = None;
        } else {
            let w = rule.wifi.as_deref().unwrap_or("").trim();
            if w.is_empty() || w.chars().count() > 64 || w.chars().any(char::is_control) {
                return Err(invalid("invalid_wifi_name"));
            }
            rule.wifi = Some(w.into());
            rule.days = 0;
            rule.start_min = None;
            rule.end_min = None;
        }
        let tx = self.conn.transaction()?;
        exists(&tx, &rule.board_id)?;
        if !connected.contains(&rule.display_id) && placements(&tx, &rule.display_id)?.is_empty() {
            return Err(invalid("screen_not_found"));
        }
        let old: Option<i64> = tx
            .query_row(
                "SELECT sort FROM board_rules WHERE id=?1",
                [&rule.id],
                |r| r.get(0),
            )
            .optional()?;
        rule.sort = old.unwrap_or(tx.query_row(
            "SELECT COALESCE(MAX(sort),-1)+1 FROM board_rules",
            [],
            |r| r.get(0),
        )?);
        if old.is_none() {
            rule.id = crate::ids::new_sticker_id();
        }
        tx.execute("INSERT INTO board_rules VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,days=excluded.days,start_min=excluded.start_min,end_min=excluded.end_min,wifi=excluded.wifi,display_id=excluded.display_id,board_id=excluded.board_id,enabled=excluded.enabled",params![rule.id,rule.sort,rule.kind,rule.days,rule.start_min,rule.end_min,rule.wifi,rule.display_id,rule.board_id,rule.enabled])?;
        tx.commit()?;
        Ok(rule)
    }
    pub fn board_rule_delete(&mut self, id: &str) -> Result<()> {
        if self
            .conn
            .execute("DELETE FROM board_rules WHERE id=?1", [id])?
            == 0
        {
            return Err(invalid("rule_not_found"));
        }
        Ok(())
    }
    pub fn board_rule_toggle(&mut self, id: &str) -> Result<()> {
        if self
            .conn
            .execute("UPDATE board_rules SET enabled=1-enabled WHERE id=?1", [id])?
            == 0
        {
            return Err(invalid("rule_not_found"));
        }
        Ok(())
    }
    pub fn board_rule_move(&mut self, id: &str, direction: &str) -> Result<()> {
        if !["up", "down"].contains(&direction) {
            return Err(invalid("invalid_direction"));
        }
        let tx = self.conn.transaction()?;
        let all = rules(&tx)?;
        let i = all
            .iter()
            .position(|r| r.id == id)
            .ok_or_else(|| invalid("rule_not_found"))?;
        let j = if direction == "up" {
            i.checked_sub(1)
        } else {
            (i + 1 < all.len()).then_some(i + 1)
        };
        if let Some(j) = j {
            tx.execute(
                "UPDATE board_rules SET sort=?2 WHERE id=?1",
                params![id, all[j].sort],
            )?;
            tx.execute(
                "UPDATE board_rules SET sort=?2 WHERE id=?1",
                params![all[j].id, all[i].sort],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}
pub(crate) fn put_in(conn: &Connection, id: &str, display: &str) -> Result<PutResult> {
    exists(conn, id)?;
    let wanted = items(conn, id)?;
    set(
        conn,
        UNDO_KEY,
        &json(&Undo {
            display_id: display.into(),
            items: placements(conn, display)?,
            at: now(),
        })?,
    )?;
    apply(conn, display, &wanted)
}
fn rules(conn: &Connection) -> Result<Vec<Rule>> {
    let mut q=conn.prepare("SELECT id,sort,kind,days,start_min,end_min,wifi,display_id,board_id,enabled FROM board_rules ORDER BY sort,id")?;
    let rows = q.query_map([], |r| {
        Ok(Rule {
            id: r.get(0)?,
            sort: r.get(1)?,
            kind: r.get(2)?,
            days: r.get(3)?,
            start_min: r.get(4)?,
            end_min: r.get(5)?,
            wifi: r.get(6)?,
            display_id: r.get(7)?,
            board_id: r.get(8)?,
            enabled: r.get(9)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn seed() -> Database {
        let mut db = Database::open_in_memory().unwrap();
        for id in ["a", "b", "c", "d"] {
            db.create_sticker(crate::NewSticker {
                id: id.into(),
                creator_id: None,
                creator_name: None,
                original_asset_path: "o".into(),
                rendered_asset_path: "r".into(),
                mask_asset_path: None,
                material_id: None,
                source_type: crate::SourceType::Created,
                aspect: 1.0,
            })
            .unwrap();
        }
        db
    }
    fn place(db: &mut Database, id: &str, display: &str) {
        db.place(Placement {
            sticker_id: id.into(),
            display_id: display.into(),
            relative_x: 0.4,
            relative_y: 0.5,
            relative_scale: 0.1,
            rotation: 2.0,
            z: 0,
            placed_at: String::new(),
            is_on_desktop: true,
        })
        .unwrap();
    }
    fn rule(board: &str) -> Rule {
        Rule {
            id: String::new(),
            sort: 0,
            kind: "time".into(),
            days: 31,
            start_min: Some(540),
            end_min: Some(1080),
            wifi: None,
            display_id: "one".into(),
            board_id: board.into(),
            enabled: true,
        }
    }
    #[test]
    fn save_update_rename_delete_and_rules_use_reusable_blanks() {
        let mut db = seed();
        assert!(db
            .board_save("one", "Empty")
            .unwrap_err()
            .to_string()
            .contains("nothing_to_save"));
        place(&mut db, "a", "one");
        for n in ["", " \n ", &"a".repeat(25)] {
            assert!(db.board_save("one", n).is_err());
        }
        let b = db.board_save("one", " Work\n day ").unwrap();
        assert_eq!(b.name, "Work day");
        assert_eq!(db.board_stock().unwrap().available, 1);
        let r = db.board_rule_save(rule(&b.id), &["one".into()]).unwrap();
        let r2 = db.board_rule_save(rule(&b.id), &["one".into()]).unwrap();
        db.board_rule_move(&r2.id, "up").unwrap();
        assert_eq!(db.board_rules().unwrap()[0].id, r2.id);
        db.board_rule_toggle(&r.id).unwrap();
        assert!(!db.board_rules().unwrap()[1].enabled);
        db.board_save("one", "Second").unwrap();
        assert!(db
            .board_save("one", "Third")
            .unwrap_err()
            .to_string()
            .contains("no_blank_board"));
        place(&mut db, "b", "one");
        db.board_update(&b.id, "one").unwrap();
        assert_eq!(db.boards().unwrap()[0].items.len(), 2);
        assert_eq!(db.board_stock().unwrap().available, 0);
        db.board_rename(&b.id, "New").unwrap();
        assert_eq!(db.boards().unwrap()[0].name, "New");
        db.board_delete(&b.id).unwrap();
        assert_eq!(db.board_stock().unwrap().available, 1);
        assert!(db.board_rules().unwrap().is_empty());
        assert_eq!(db.on_desktop().unwrap().len(), 2);
    }
    #[test]
    fn put_skips_other_screens_including_stored_and_gone_and_undo_restores() {
        let mut db = seed();
        for id in ["a", "b", "c"] {
            place(&mut db, id, "one");
        }
        let b = db.board_save("one", "Look").unwrap();
        db.peel("a").unwrap();
        place(&mut db, "b", "stored");
        db.conn
            .execute("UPDATE stickers SET state='gone' WHERE id='c'", [])
            .unwrap();
        db.peel("c").unwrap();
        place(&mut db, "d", "one");
        let before = db.on_desktop().unwrap();
        db.daily_insert("2026-10-13", "matte").unwrap();
        db.daily_set_confirmed("2026-10-13", "a", crate::SourceType::Created, "stamp")
            .unwrap();
        db.link_tag_add_stock(1).unwrap();
        db.link_tag_attach("a", "folder", "/tmp", "Tmp", true)
            .unwrap();
        let daily = db.daily_get("2026-10-13").unwrap();
        let scraps = db.scrap_status().unwrap().balance;
        let queue = db.next_print().unwrap();
        let r = db.board_put(&b.id, "one", &["one".into()]).unwrap();
        assert_eq!(r.placed, 1);
        assert_eq!(
            r.skipped
                .iter()
                .map(|s| s.reason.as_str())
                .collect::<Vec<_>>(),
            ["on_another_screen", "not_yours"]
        );
        assert_eq!(
            db.boards_status(&["one".into()], "one").unwrap().boards[0].stickers[2].state,
            "gone"
        );
        assert_eq!(db.daily_get("2026-10-13").unwrap(), daily);
        assert_eq!(db.next_print().unwrap(), queue);
        assert_eq!(db.scrap_status().unwrap().balance, scraps);
        assert!(db.link_tag("a").unwrap().is_some());
        db.board_undo().unwrap();
        assert_eq!(db.on_desktop().unwrap(), before);
        assert!(db.board_undo().unwrap().is_none());
        assert!(db.board_put(&b.id, "stored", &["one".into()]).is_err());
    }
    #[test]
    fn failure_rolls_back_placements_and_the_previous_undo() {
        let mut db = seed();
        place(&mut db, "a", "one");
        let a = db.board_save("one", "A").unwrap();
        db.peel("a").unwrap();
        place(&mut db, "b", "one");
        let b = db.board_save("one", "B").unwrap();
        db.board_put(&a.id, "one", &["one".into()]).unwrap();
        let before = db.on_desktop().unwrap();
        let undo = meta(&db.conn, UNDO_KEY).unwrap();
        db.conn.execute_batch("CREATE TRIGGER fail_board BEFORE UPDATE ON placements WHEN NEW.sticker_id='b' BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
        assert!(db.board_put(&b.id, "one", &["one".into()]).is_err());
        assert_eq!(db.on_desktop().unwrap(), before);
        assert_eq!(meta(&db.conn, UNDO_KEY).unwrap(), undo);
        db.conn.execute_batch("DROP TRIGGER fail_board;").unwrap();
        place(&mut db, "b", "other");
        let r = db.board_undo().unwrap().unwrap();
        assert_eq!(r.placed, 0);
        assert_eq!(r.skipped[0].reason, "on_another_screen");
    }
    #[test]
    fn deletion_cascades_but_gone_stickers_remain_and_bring_preserves_geometry() {
        let mut db = seed();
        place(&mut db, "a", "stored");
        place(&mut db, "b", "stored");
        let b = db.board_save("stored", "Stored").unwrap();
        db.delete_original("a").unwrap();
        db.conn
            .execute("UPDATE stickers SET state='gone' WHERE id='b'", [])
            .unwrap();
        assert_eq!(db.boards().unwrap()[0].items.len(), 1);
        db.conn
            .execute("UPDATE stickers SET state='held' WHERE id='b'", [])
            .unwrap();
        let before = db.on_desktop().unwrap()[0].clone();
        assert_eq!(db.board_bring_here("stored", "one").unwrap(), 1);
        let after = db.on_desktop().unwrap()[0].clone();
        assert_eq!(
            after,
            Placement {
                display_id: "one".into(),
                ..before
            }
        );
        let status = db.boards_status(&["one".into()], "one").unwrap();
        assert_eq!(status.screens[0].board, Some(b.id));
    }
    #[test]
    fn match_tolerates_geometry_ignores_z_and_wraps_angles() {
        let a = Item {
            sticker_id: "a".into(),
            relative_x: 0.5,
            relative_y: 0.5,
            relative_scale: 0.1,
            rotation: 179.8,
            z: 0,
        };
        let mut b = a.clone();
        b.relative_x += 0.004;
        b.relative_scale += 0.009;
        b.rotation = -179.8;
        b.z = 99;
        assert!(matches(&[a.clone()], &[b.clone()]));
        b.relative_y += 0.006;
        assert!(!matches(&[a.clone()], &[b]));
        assert!(!matches(&[a], &[]));
    }
    #[test]
    fn purchase_cap_balance_and_receipt_are_atomic() {
        let mut db = seed();
        let req = crate::scraps::Trade {
            kind: crate::scraps::Kind::Tool,
            item_id: "board".into(),
            quantity: 1,
        };
        assert!(db.scrap_trade(&req, "poor").is_err());
        assert_eq!(db.board_stock().unwrap().owned, 2);
        db.conn
            .execute("INSERT INTO meta VALUES ('scraps.balance','200')", [])
            .unwrap();
        let r = db.scrap_trade(&req, "once").unwrap();
        assert_eq!(r.delta, -12);
        assert_eq!(db.scrap_trade(&req, "once").unwrap(), r);
        assert_eq!(db.board_stock().unwrap().owned, 3);
        db.scrap_trade(
            &crate::scraps::Trade {
                quantity: 9,
                ..req.clone()
            },
            "nine",
        )
        .unwrap();
        assert_eq!(db.board_stock().unwrap().owned, 12);
        let balance = db.scrap_status().unwrap().balance;
        assert!(db.scrap_trade(&req, "over").is_err());
        assert_eq!(db.scrap_status().unwrap().balance, balance);
        let mut db = seed();
        db.conn
            .execute("INSERT INTO meta VALUES ('scraps.balance','20')", [])
            .unwrap();
        db.conn.execute_batch("CREATE TRIGGER fail_receipt BEFORE INSERT ON meta WHEN NEW.key='scraps.tx.fail' BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
        assert!(db.scrap_trade(&req, "fail").is_err());
        assert_eq!(db.board_stock().unwrap().owned, 2);
        assert_eq!(db.scrap_status().unwrap().balance, 20);
    }
    #[test]
    fn invalid_rules_do_not_mutate_and_missing_screens_are_rejected() {
        let mut db = seed();
        place(&mut db, "a", "one");
        let b = db.board_save("one", "A").unwrap();
        let connected = vec!["one".into()];
        for bad in [
            Rule {
                days: 0,
                ..rule(&b.id)
            },
            Rule {
                end_min: Some(540),
                ..rule(&b.id)
            },
            Rule {
                start_min: Some(1440),
                ..rule(&b.id)
            },
            Rule {
                display_id: "missing".into(),
                ..rule(&b.id)
            },
            Rule {
                kind: "place".into(),
                wifi: Some("x".repeat(65)),
                ..rule(&b.id)
            },
        ] {
            assert!(db.board_rule_save(bad, &connected).is_err());
        }
        assert!(db.board_rules().unwrap().is_empty());
    }
    #[cfg(feature = "developer")]
    #[test]
    fn developer_board_purchase_is_free_but_capped() {
        let mut db = seed();
        db.enable_developer().unwrap();
        let req = crate::scraps::Trade {
            kind: crate::scraps::Kind::Tool,
            item_id: "board".into(),
            quantity: 10,
        };
        assert_eq!(db.scrap_trade(&req, "free").unwrap().delta, 0);
        assert_eq!(db.board_stock().unwrap().owned, 12);
        assert!(db.scrap_trade(&req, "cap").is_err());
    }
}
