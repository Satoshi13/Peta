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
    conn.execute("INSERT OR IGNORE INTO friends VALUES (?1,?2,?3)",params![public_key,identity.name,now()])?;Ok(identity)
}
