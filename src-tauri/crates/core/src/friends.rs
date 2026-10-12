//! TOFU remembers a key, not a verified real-world person. Compare fingerprints outside Peta.
use rusqlite::{Connection,OptionalExtension,params};
use serde::Serialize;
use crate::{db::now,error::Result,sign};
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Identity {pub name:String,pub status:String,pub fingerprint:String,pub public_key:String}
pub fn preview(conn:&Connection,public_key:&str,name:&str)->Result<Identity> {
    let key=sign::parse_public(public_key)?;let fingerprint=sign::fingerprint(&key);
    let existing=conn.query_row("SELECT name FROM friends WHERE public_key=?1",[public_key],|r|r.get::<_,String>(0)).optional()?;
    if let Some(name)=existing {return Ok(Identity{name,status:"known".into(),fingerprint,public_key:public_key.into()});}
    let mut stmt=conn.prepare("SELECT name FROM friends WHERE public_key!=?1")?;
    let names=stmt.query_map([public_key],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let collision=names.iter().any(|n|n.trim().to_lowercase()==name.trim().to_lowercase());
    Ok(Identity{name:name.trim().into(),status:if collision{"warning"}else{"new"}.into(),fingerprint,public_key:public_key.into()})
}
/// Call inside the same transaction as receipt/install; preview alone never trusts a new key.
pub fn observe(conn:&Connection,public_key:&str,name:&str)->Result<Identity> {
    let identity=preview(conn,public_key,name)?;
    conn.execute("INSERT OR IGNORE INTO friends(public_key,name,first_seen_at) VALUES (?1,?2,?3)",params![public_key,identity.name,now()])?;Ok(identity)
}

/* ---------- friends by code (server S2) ----------
   A row's status: requested = I asked them; pending = they asked me; friend; blocked. `allowed` = their gifts may reach my mailbox.
   Asking someone allows them at once (I chose them); approving allows them; declining, removing and blocking take it back.
   Gifts already received are never touched. Rows met only through a file (TOFU) keep a NULL status. */
use crate::{error::Error, identity::FriendCode};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Friend { pub public_key: String, pub name: String, pub fingerprint: String, pub status: String, pub allowed: bool, pub note: Option<String>, pub added_at: Option<String>, pub enc_key: Option<String> }

fn upsert(conn: &Connection, code: &FriendCode, status: &str, allowed: bool, note: Option<&str>, request_id: Option<&str>) -> Result<()> {
    conn.execute("INSERT INTO friends(public_key,name,first_seen_at,enc_public_key,binding,status,allowed,added_at,note,request_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?3,?8,?9)
        ON CONFLICT(public_key) DO UPDATE SET name=excluded.name,enc_public_key=excluded.enc_public_key,binding=excluded.binding,status=excluded.status,allowed=excluded.allowed,added_at=excluded.added_at,note=excluded.note,request_id=excluded.request_id",
        params![code.sign_key, code.name, now(), code.enc_key, code.binding, status, allowed, note, request_id])?;
    Ok(())
}
fn status_of(conn: &Connection, key: &str) -> Result<Option<String>> { Ok(conn.query_row("SELECT status FROM friends WHERE public_key=?1", [key], |r| r.get::<_, Option<String>>(0)).optional()?.flatten()) }
fn clean_note(note: Option<&str>) -> Option<String> { note.map(str::trim).filter(|n| !n.is_empty()).map(|n| n.chars().take(80).collect()) }

/// I paste their code and send a request. Returns false (nothing changes) for myself or someone I blocked.
pub fn request_sent(conn: &Connection, me: &str, code: &FriendCode, request_id: &str) -> Result<bool> {
    code.verify()?;
    if code.sign_key == me { return Err(Error::Invalid("That is your own friend code.".into())); }
    match status_of(conn, &code.sign_key)?.as_deref() {
        Some("blocked") => Err(Error::Invalid("You blocked this person. Unblock them in Settings first.".into())),
        Some("friend") => Ok(false),
        Some("pending") => { upsert(conn, code, "friend", true, None, None)?; Ok(true) }   // they asked first: asking back is approving
        _ => { upsert(conn, code, "requested", true, None, Some(request_id))?; Ok(true) }
    }
}
/// Their request reached my mailbox. Returns what happened: "pending", "friend" (we had both asked), or "ignored".
pub fn request_received(conn: &Connection, me: &str, code: &FriendCode, note: Option<&str>, request_id: &str) -> Result<&'static str> {
    code.verify()?;
    if code.sign_key == me { return Ok("ignored"); }
    Ok(match status_of(conn, &code.sign_key)?.as_deref() {
        Some("blocked") | Some("friend") => "ignored",
        Some("requested") => { upsert(conn, code, "friend", true, None, None)?; "friend" }
        _ => { upsert(conn, code, "pending", false, clean_note(note).as_deref(), Some(request_id))?; "pending" }
    })
}
fn set(conn: &Connection, key: &str, from: &[&str], status: Option<&str>, allowed: bool) -> Result<()> {
    let now_status = status_of(conn, key)?;
    if !from.is_empty() && !from.contains(&now_status.as_deref().unwrap_or("")) { return Err(Error::Invalid("That friend request is not waiting any more.".into())); }
    conn.execute("UPDATE friends SET status=?2,allowed=?3,note=NULL,request_id=NULL WHERE public_key=?1", params![key, status, allowed])?; Ok(())
}
pub fn approve(conn: &Connection, key: &str) -> Result<()> { set(conn, key, &["pending"], Some("friend"), true) }
pub fn decline(conn: &Connection, key: &str) -> Result<()> { set(conn, key, &["pending"], None, false) }
/// They accepted me (my gifts now reach them).
pub fn accepted(conn: &Connection, key: &str) -> Result<()> { set(conn, key, &["requested"], Some("friend"), true) }
pub fn remove(conn: &Connection, key: &str) -> Result<()> { set(conn, key, &[], None, false) }
pub fn block(conn: &Connection, key: &str) -> Result<()> {
    if status_of(conn, key)?.is_none() && conn.query_row("SELECT COUNT(*) FROM friends WHERE public_key=?1", [key], |r| r.get::<_, i64>(0))? == 0 {
        conn.execute("INSERT INTO friends(public_key,name,first_seen_at) VALUES(?1,'',?2)", params![key, now()])?;
    }
    set(conn, key, &[], Some("blocked"), false)
}
pub fn unblock(conn: &Connection, key: &str) -> Result<()> { set(conn, key, &["blocked"], None, false) }
/// Everyone with a status, friends first, then requests waiting on me, then those I asked, then blocked.
pub fn list(conn: &Connection) -> Result<Vec<Friend>> {
    let mut stmt = conn.prepare("SELECT public_key,name,status,allowed,note,added_at,enc_public_key FROM friends WHERE status IS NOT NULL
        ORDER BY CASE status WHEN 'friend' THEN 0 WHEN 'pending' THEN 1 WHEN 'requested' THEN 2 ELSE 3 END, lower(name)")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, bool>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, Option<String>>(5)?, r.get::<_, Option<String>>(6)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter().map(|(public_key, name, status, allowed, note, added_at, enc_key)| {
        let fingerprint = sign::fingerprint(&sign::parse_public(&public_key)?);
        Ok(Friend { public_key, name, fingerprint, status, allowed, note, added_at, enc_key })
    }).collect()
}
pub fn get(conn: &Connection, key: &str) -> Result<Option<Friend>> { Ok(list(conn)?.into_iter().find(|f| f.public_key == key)) }
/// Whether anyone is a friend or waiting: with no one, Peta never talks to the inbox.
pub fn anyone(conn: &Connection) -> Result<bool> { Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM friends WHERE status IN ('requested','pending','friend'))", [], |r| r.get(0))?) }

/// The app reaches friends and the inbox's small state through the database (its connection stays private to core).
impl crate::Database {
    pub fn friends(&self) -> Result<Vec<Friend>> { list(&self.conn) }
    pub fn friend(&self, key: &str) -> Result<Option<Friend>> { get(&self.conn, key) }
    pub fn friends_anyone(&self) -> Result<bool> { anyone(&self.conn) }
    pub fn friend_request_sent(&mut self, me: &str, code: &FriendCode, request_id: &str) -> Result<bool> { request_sent(&self.conn, me, code, request_id) }
    pub fn friend_request_received(&mut self, me: &str, code: &FriendCode, note: Option<&str>, request_id: &str) -> Result<&'static str> { request_received(&self.conn, me, code, note, request_id) }
    pub fn friend_approve(&mut self, key: &str) -> Result<()> { approve(&self.conn, key) }
    pub fn friend_decline(&mut self, key: &str) -> Result<()> { decline(&self.conn, key) }
    pub fn friend_accepted(&mut self, key: &str) -> Result<()> { accepted(&self.conn, key) }
    pub fn friend_remove(&mut self, key: &str) -> Result<()> { remove(&self.conn, key) }
    pub fn friend_block(&mut self, key: &str) -> Result<()> { block(&self.conn, key) }
    pub fn friend_unblock(&mut self, key: &str) -> Result<()> { unblock(&self.conn, key) }
    /// Leaving the server: every friend status goes (file friends stay as TOFU rows), and so does the inbox's state.
    pub fn inbox_forget(&mut self) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("UPDATE friends SET status=NULL,allowed=0,note=NULL,request_id=NULL", [])?;
        tx.execute("DELETE FROM meta WHERE key LIKE 'inbox.%'", [])?;
        tx.commit()?; Ok(())
    }
    /// Small inbox settings and marks, all under `inbox.` in meta.
    pub fn inbox_value(&self, key: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT value FROM meta WHERE key=?1", [format!("inbox.{key}")], |r| r.get(0)).optional()?)
    }
    pub fn set_inbox_value(&mut self, key: &str, value: Option<&str>) -> Result<()> {
        let key = format!("inbox.{key}");
        match value {
            Some(v) => self.conn.execute("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, v])?,
            None => self.conn.execute("DELETE FROM meta WHERE key=?1", [key])?,
        };
        Ok(())
    }
    /// The signing key a received gift was sealed with, when it had one (for a report).
    pub fn gift_signer_key(&self, gift_id: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT public_key FROM gift_signers WHERE gift_id=?1", [gift_id], |r| r.get::<_, Option<String>>(0)).optional()?.flatten())
    }
    pub fn inbox_seen(&self, message_id: &str) -> Result<bool> { Ok(self.conn.query_row("SELECT EXISTS(SELECT 1 FROM inbox_seen WHERE message_id=?1)", [message_id], |r| r.get(0))?) }
    pub fn mark_inbox_seen(&mut self, message_id: &str, sender: Option<&str>) -> Result<()> {
        self.conn.execute("INSERT OR IGNORE INTO inbox_seen VALUES(?1,?2,?3)", params![message_id, sender, now()])?; Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Database, identity};
    fn code(name: &str) -> (FriendCode, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("peta-friend-{}", crate::ids::new_sticker_id())); std::fs::create_dir_all(&dir).unwrap();
        (identity::my_code(&dir, &sign::generate().unwrap(), name).unwrap(), dir)
    }
    #[test]
    fn requests_approvals_and_blocks_move_between_states() {
        let db = Database::open_in_memory().unwrap(); let c = &db.conn;
        let (me, _d0) = code("Me"); let (nao, _d1) = code("Nao"); let (ren, _d2) = code("Ren"); let (eve, _d3) = code("Eve");
        assert!(request_sent(c, &me.sign_key, &me, "r0").is_err(), "not my own code");
        assert!(request_sent(c, &me.sign_key, &nao, "r1").unwrap());
        assert_eq!(get(c, &nao.sign_key).unwrap().map(|f| (f.status, f.allowed)), Some(("requested".into(), true)));
        accepted(c, &nao.sign_key).unwrap(); assert_eq!(get(c, &nao.sign_key).unwrap().unwrap().status, "friend");
        assert_eq!(request_received(c, &me.sign_key, &ren, Some("  hi from the café  "), "q1").unwrap(), "pending");
        let waiting = get(c, &ren.sign_key).unwrap().unwrap(); assert_eq!((waiting.allowed, waiting.note.as_deref()), (false, Some("hi from the café")));
        approve(c, &ren.sign_key).unwrap(); assert!(get(c, &ren.sign_key).unwrap().unwrap().allowed);
        assert!(approve(c, &ren.sign_key).is_err(), "nothing is waiting any more");
        assert_eq!(request_received(c, &me.sign_key, &eve, None, "q2").unwrap(), "pending");
        block(c, &eve.sign_key).unwrap();
        assert_eq!(request_received(c, &me.sign_key, &eve, None, "q3").unwrap(), "ignored");
        assert!(request_sent(c, &me.sign_key, &eve, "r2").is_err(), "blocked first");
        unblock(c, &eve.sign_key).unwrap(); assert!(get(c, &eve.sign_key).unwrap().is_none());
        remove(c, &nao.sign_key).unwrap(); assert!(get(c, &nao.sign_key).unwrap().is_none());
        assert_eq!(list(c).unwrap().iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["Ren"]);
        assert!(anyone(c).unwrap());
    }
    #[test]
    fn asking_each_other_makes_friends_either_way() {
        let db = Database::open_in_memory().unwrap(); let c = &db.conn; let (me, _a) = code("Me"); let (nao, _b) = code("Nao");
        request_sent(c, &me.sign_key, &nao, "r1").unwrap();
        assert_eq!(request_received(c, &me.sign_key, &nao, None, "q1").unwrap(), "friend");
        let (ren, _c) = code("Ren");
        request_received(c, &me.sign_key, &ren, None, "q2").unwrap(); request_sent(c, &me.sign_key, &ren, "r2").unwrap();
        assert_eq!(get(c, &ren.sign_key).unwrap().unwrap().status, "friend");
        let mut forged = ren.clone(); forged.name = "Mallory".into();
        assert!(request_received(c, &me.sign_key, &forged, None, "q3").is_err(), "a code that does not match its key is refused");
    }
    #[test]
    fn a_file_friend_keeps_its_row_and_gains_a_status() {
        let db = Database::open_in_memory().unwrap(); let c = &db.conn; let (me, _a) = code("Me"); let (nao, _b) = code("Nao");
        observe(c, &nao.sign_key, "Nao").unwrap();
        assert!(!anyone(c).unwrap(), "a gift file alone does not start talking to the inbox");
        request_sent(c, &me.sign_key, &nao, "r1").unwrap(); assert!(anyone(c).unwrap());
        assert_eq!(preview(c, &nao.sign_key, "Nao").unwrap().status, "known");
    }
}
