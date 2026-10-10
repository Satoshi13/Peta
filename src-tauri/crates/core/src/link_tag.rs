//! Link tags: a reusable little tool that makes a sticker open an app, a web page or a folder when it is clicked.
//! The tag belongs to the person, not to the sticker: removing it puts it back in stock, and sealing the sticker into a Gift or a Pack
//! takes it off first (the target never travels with the sticker). Nothing here opens anything; this is the record and its rules.
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use crate::{db::{now, Database}, error::{Error, Result}};

pub const OWNED_KEY: &str = "link_tags.owned";
pub const KINDS: [&str; 3] = ["app", "website", "folder"];
const LABEL_MAX: usize = 40;
const URL_MAX: usize = 2048;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkTag { pub sticker_id: String, pub kind: String, pub target: String, pub label: String, pub show_in_collection: bool, pub attached_at: String }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stock { pub owned: i64, pub attached: i64, pub available: i64 }

/// What is allowed to be a target. A tag only ever *opens* something; it cannot run a command or a file.
pub fn validate(kind: &str, target: &str, label: &str) -> Result<()> {
    let bad = |m: &str| Err(Error::Invalid(m.into()));
    if !KINDS.contains(&kind) { return bad("Choose an app, a website or a folder."); }
    let label = label.trim();
    if label.is_empty() || label.chars().count() > LABEL_MAX || label.chars().any(char::is_control) { return bad("Give the tag a short name."); }
    match kind {
        "website" => {
            let t = target.trim();
            let rest = t.strip_prefix("https://").or_else(|| t.strip_prefix("http://"));
            let host = rest.map(|r| r.split(['/', '?', '#']).next().unwrap_or("")).unwrap_or("").split(':').next().unwrap_or("");
            if t.len() > URL_MAX || rest.is_none() || host.is_empty() || !host.contains('.') && host != "localhost" || t.chars().any(|c| c.is_whitespace() || c.is_control()) {
                return bad("Enter a web address that starts with https:// or http://");
            }
        }
        "app" => {
            let p = std::path::Path::new(target);
            if !p.is_absolute() || !target.ends_with(".app") || target.contains('\0') { return bad("Choose an app (a .app in Applications)."); }
        }
        _ => {
            let p = std::path::Path::new(target);
            if !p.is_absolute() || target.contains('\0') { return bad("Choose a folder."); }
        }
    }
    Ok(())
}

impl Database {
    pub fn link_tag_stock(&self) -> Result<Stock> {
        let owned: i64 = self.conn.query_row("SELECT value FROM meta WHERE key=?1", [OWNED_KEY], |r| r.get::<_, String>(0)).optional()?.and_then(|v| v.parse().ok()).unwrap_or(0);
        let attached: i64 = self.conn.query_row("SELECT COUNT(*) FROM link_tags", [], |r| r.get(0))?;
        Ok(Stock { owned, attached, available: (owned - attached).max(0) })
    }
    pub fn link_tag_add_stock(&mut self, n: i64) -> Result<()> {
        let owned = self.link_tag_stock()?.owned.checked_add(n).filter(|v| (0..=1_000_000).contains(v)).ok_or_else(|| Error::Invalid("Link tag count is out of range.".into()))?;
        self.conn.execute("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![OWNED_KEY, owned.to_string()])?;
        Ok(())
    }
    pub fn link_tags(&self) -> Result<Vec<LinkTag>> {
        let mut stmt = self.conn.prepare("SELECT sticker_id,kind,target,label,show_in_collection,attached_at FROM link_tags ORDER BY attached_at")?;
        let rows = stmt.query_map([], |r| Ok(LinkTag { sticker_id: r.get(0)?, kind: r.get(1)?, target: r.get(2)?, label: r.get(3)?, show_in_collection: r.get::<_, i64>(4)? != 0, attached_at: r.get(5)? }))?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
    pub fn link_tag(&self, sticker_id: &str) -> Result<Option<LinkTag>> {
        Ok(self.link_tags()?.into_iter().find(|t| t.sticker_id == sticker_id))
    }
    /// Put a tag on a sticker, or change where an attached one points (changing costs nothing). A new attachment needs a tag in stock.
    pub fn link_tag_attach(&mut self, sticker_id: &str, kind: &str, target: &str, label: &str, show: bool) -> Result<LinkTag> {
        validate(kind, target, label)?;
        let tx = self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if tx.query_row("SELECT COUNT(*) FROM stickers WHERE id=?1", [sticker_id], |r| r.get::<_, i64>(0))? == 0 { return Err(Error::Invalid("That sticker is not in your Collection.".into())); }
        let attached_here: bool = tx.query_row("SELECT COUNT(*) FROM link_tags WHERE sticker_id=?1", [sticker_id], |r| r.get::<_, i64>(0))? > 0;
        if !attached_here {
            let owned: i64 = tx.query_row("SELECT value FROM meta WHERE key=?1", [OWNED_KEY], |r| r.get::<_, String>(0)).optional()?.and_then(|v| v.parse().ok()).unwrap_or(0);
            let attached: i64 = tx.query_row("SELECT COUNT(*) FROM link_tags", [], |r| r.get(0))?;
            if owned - attached < 1 { return Err(Error::Invalid("You have no link tag to attach. Get one in the Market.".into())); }
        }
        let (target, label) = (target.trim(), label.trim());
        tx.execute("INSERT INTO link_tags(sticker_id,kind,target,label,show_in_collection,attached_at) VALUES(?1,?2,?3,?4,?5,?6)
                    ON CONFLICT(sticker_id) DO UPDATE SET kind=excluded.kind,target=excluded.target,label=excluded.label,show_in_collection=excluded.show_in_collection",
            params![sticker_id, kind, target, label, show as i64, now()])?;
        tx.commit()?;
        self.link_tag(sticker_id)?.ok_or_else(|| Error::Invalid("The tag could not be saved.".into()))
    }
    pub fn link_tag_set_show(&mut self, sticker_id: &str, show: bool) -> Result<()> {
        if self.conn.execute("UPDATE link_tags SET show_in_collection=?2 WHERE sticker_id=?1", params![sticker_id, show as i64])? == 0 { return Err(Error::Invalid("This sticker has no link tag.".into())); }
        Ok(())
    }
    /// Take the tag off: it goes back in stock. Nothing is spent or lost.
    pub fn link_tag_remove(&mut self, sticker_id: &str) -> Result<bool> {
        Ok(self.conn.execute("DELETE FROM link_tags WHERE sticker_id=?1", [sticker_id])? > 0)
    }
    /// A sticker is being sealed into a Gift or a Pack: its tags come off and return to the owner. Call only after the file was written.
    pub fn link_tag_release(&mut self, sticker_ids: &[String]) -> Result<usize> {
        let tx = self.conn.transaction()?;
        let mut n = 0;
        for id in sticker_ids { n += tx.execute("DELETE FROM link_tags WHERE sticker_id=?1", [id])?; }
        tx.commit()?;
        Ok(n)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attach { pub sticker_id: String, pub kind: String, pub target: String, pub label: String, #[serde(default = "yes")] pub show_in_collection: bool }
fn yes() -> bool { true }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{pack, library::Library, ids};
    fn lib() -> Library { Library::open(&std::env::temp_dir().join(format!("peta-linktag-{}", ids::new_sticker_id()))).unwrap() }
    fn sticker(lib: &mut Library) -> String {
        let png = { let mut b = Vec::new(); let mut img = image::RgbaImage::new(24, 20); for y in 4..16 { for x in 4..20 { img.put_pixel(x, y, image::Rgba([200, 20, 20, 255])); } } img.write_to(&mut std::io::Cursor::new(&mut b), image::ImageFormat::Png).unwrap(); b };
        let r = pack::render_pack_sticker(&png).unwrap(); lib.add_made(&r, &png, "png", None, "matte").unwrap().id
    }
    #[test]
    fn only_things_that_can_be_opened_are_accepted() {
        assert!(validate("website", "https://open.spotify.com/playlist/37i9dQZF1DX", "Morning mix").is_ok());
        assert!(validate("website", "http://localhost:3000/a", "Dev").is_ok());
        for bad in ["javascript:alert(1)", "file:///etc/passwd", "spotify:playlist:1", "https://", "https://nodots", "https://a b.com", "ftp://x.com", "", "  "] { assert!(validate("website", bad, "x").is_err(), "{bad}"); }
        assert!(validate("app", "/Applications/Notes.app", "Notes").is_ok());
        for bad in ["Notes.app", "/bin/sh", "/Applications/Notes", "relative/Notes.app"] { assert!(validate("app", bad, "x").is_err(), "{bad}"); }
        assert!(validate("folder", "/Users/me/Documents", "Docs").is_ok()); assert!(validate("folder", "Documents", "Docs").is_err());
        assert!(validate("script", "/x", "x").is_err());
        assert!(validate("folder", "/tmp", "").is_err()); assert!(validate("folder", "/tmp", &"x".repeat(41)).is_err());
    }
    #[test]
    fn a_tag_needs_stock_is_reusable_and_changing_or_removing_it_never_costs_anything() {
        let mut lib = lib(); let a = sticker(&mut lib); let b = sticker(&mut lib);
        assert!(lib.db_mut().link_tag_attach(&a, "app", "/Applications/Notes.app", "Notes", true).is_err()); // none owned yet
        lib.db_mut().link_tag_add_stock(1).unwrap();
        let t = lib.db_mut().link_tag_attach(&a, "app", "/Applications/Notes.app", "Notes", true).unwrap();
        assert_eq!((t.kind.as_str(), t.label.as_str(), t.show_in_collection), ("app", "Notes", true));
        assert_eq!(lib.db().link_tag_stock().unwrap().available, 0);
        assert!(lib.db_mut().link_tag_attach(&b, "folder", "/tmp", "Tmp", true).is_err()); // the one tag is in use
        lib.db_mut().link_tag_attach(&a, "website", "https://peta.example/x", "Site", false).unwrap(); // change: free
        assert_eq!(lib.db().link_tag(&a).unwrap().unwrap().kind, "website");
        assert_eq!((lib.db().link_tag_stock().unwrap().owned, lib.db().link_tag_stock().unwrap().attached), (1, 1));
        assert!(lib.db_mut().link_tag_remove(&a).unwrap());
        assert_eq!(lib.db().link_tag_stock().unwrap().available, 1);
        lib.db_mut().link_tag_attach(&b, "folder", "/tmp", "Tmp", true).unwrap(); // the same tag, reused
        lib.db_mut().link_tag_set_show(&b, false).unwrap(); assert!(!lib.db().link_tag(&b).unwrap().unwrap().show_in_collection);
        assert!(lib.db_mut().link_tag_attach("no-such-sticker", "folder", "/tmp", "x", true).is_err());
    }
    #[test]
    fn releasing_returns_tags_deleting_a_sticker_returns_its_tag_too() {
        let mut lib = lib(); let a = sticker(&mut lib); let b = sticker(&mut lib); let c = sticker(&mut lib);
        lib.db_mut().link_tag_add_stock(3).unwrap();
        for s in [&a, &b, &c] { lib.db_mut().link_tag_attach(s, "folder", "/tmp", "T", true).unwrap(); }
        assert_eq!(lib.db().link_tag_stock().unwrap().available, 0);
        assert_eq!(lib.db_mut().link_tag_release(&[a.clone(), b.clone(), "unknown".into()]).unwrap(), 2);
        assert_eq!((lib.db().link_tag_stock().unwrap().owned, lib.db().link_tag_stock().unwrap().available), (3, 2));
        assert!(lib.db().link_tag(&c).unwrap().is_some() && lib.db().link_tag(&a).unwrap().is_none());
        lib.db_mut().delete_original(&c).unwrap();
        assert_eq!(lib.db().link_tag_stock().unwrap().available, 3); // not lost with the sticker
    }
}
