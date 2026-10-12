//! Gifts move real stickers. V3 preserves creation signatures and transfer history.
//! V1/v2 remain readable, with unverified authorship. An offline chain cannot prevent forks.

use serde::{Deserialize, Serialize};

use crate::{
    db::now,
    error::{Error, Result},
    ids::new_gift_id,
    library::Library,
    models::{SourceType, Sticker},
};

const MAGIC: &[u8; 8] = b"PETAGIFT";
const VERSION: u8 = 3;
/// Refuse anything bigger: a gift is one sticker, not a way to move files around.
const MAX_PNG: usize = 8 * 1024 * 1024;
const MAX_HEADER: usize = 64 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Origin {
    pub sticker_id: String,
    pub creator_name: Option<String>,
    /// When the original was made.
    pub created_at: String,
    pub material_id: Option<String>,
    pub aspect: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GiftHeader {
    pub gift_id: String,
    /// The sender's name, as printed on the envelope.
    pub from: String,
    pub note: Option<String>,
    pub sent_at: String,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub edition: Option<i64>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub history: Option<crate::ownership::Chain>,
    pub origin: Origin,
    pub png_len: usize,
    pub mask_len: usize,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub signer: Option<crate::sign::Signer>,
    /// Studio: how the gift is wrapped (a wrapping id and one decoration) and the name written on the wrapping. All optional; a gift
    /// made before Studio has none of them.
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub bag: Option<String>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub deco: Option<String>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub to: Option<String>,
}

pub const GIFT_BAGS: [&str; 6] = ["airmail", "photo", "kraft-parcel", "wrap", "cotton", "glassine"];
pub const GIFT_NOTE_MAX: usize = 80;
pub const GIFT_TO_MAX: usize = 40;

/// How a gift is wrapped. `bag` of None means the plain envelope.
#[derive(Deserialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GiftDress {
    #[serde(default)] pub bag: Option<String>,
    #[serde(default)] pub deco: Option<String>,
}
fn dress_ok(bag: &Option<String>, deco: &Option<String>, to: &Option<String>) -> bool {
    bag.as_deref().is_none_or(|b| GIFT_BAGS.contains(&b)) && deco.as_deref().is_none_or(|d| crate::creator_pack::DECOS.contains(&d))
        && to.as_deref().is_none_or(|t| !t.trim().is_empty() && t.chars().count() <= GIFT_TO_MAX && !t.chars().any(char::is_control))
}

/// Transfer one of your real stickers for `to` (a label only you see: "Nao", "Mom"). Returns the gift id and the file.
pub fn build_gift(lib: &mut Library, sticker_id: &str, to: &str, note: Option<&str>) -> Result<(String, Vec<u8>)> {
    build_gift_dressed(lib, sticker_id, to, note, &GiftDress::default())
}

/// The same, with Studio's wrapping. With a wrapping chosen, the note is at most 80 characters and the name `to` is written on the gift
/// where the receiver sees it ("For Mika"); without one it stays a label only the sender sees.
pub fn build_gift_dressed(lib:&mut Library,sticker_id:&str,to:&str,note:Option<&str>,dress:&GiftDress)->Result<(String,Vec<u8>)> {
    transfer_gift(lib,sticker_id,to,note,dress,&crate::ownership::NoReferee,|_|Ok(()))
}

/// Persistence is performed while the release transaction is still reversible. A failed writer
/// leaves the held item, copies, placements, tags and history untouched.
pub fn transfer_gift(lib:&mut Library,sticker_id:&str,to:&str,note:Option<&str>,dress:&GiftDress,referee:&dyn crate::ownership::Referee,persist:impl FnOnce(&[u8])->Result<()>)->Result<(String,Vec<u8>)> {
    use crate::ownership as o;
    let dressed=dress.bag.is_some();let wrapped_to=dressed.then(||to.trim().to_owned());
    if !dress_ok(&dress.bag,&dress.deco,&wrapped_to) {return Err(Error::Invalid("That wrapping is not available.".into()));}
    let sticker=lib.db().held_sticker(sticker_id)?.ok_or_else(||Error::Invalid("Sticker not held here.".into()))?;o::require_real(&sticker)?;
    let png=lib.read_rendered(sticker_id)?;let mask=sticker.mask_asset_path.as_ref().map(|p|lib.read_asset(p)).transpose()?.unwrap_or_default();
    let key=crate::device_key::load_or_create(lib.root())?;let mut chain=o::chain_for(lib.db(),&sticker,&png,&key)?;
    let tracked=crate::server::ensure_registered(lib.db_mut(),&chain.creation,referee)?;
    let gift_id=new_gift_id();let release=o::append(&mut chain,"release",&gift_id,&key)?;o::sticker_chain_verify(&chain,&png)?;
    let header=GiftHeader{gift_id:gift_id.clone(),from:lib.db().display_name()?,note:note.map(str::trim).filter(|n|!n.is_empty()).map(|n|n.chars().take(if dressed {GIFT_NOTE_MAX}else{140}).collect()),sent_at:release.at.clone(),edition:None,
        origin:Origin{sticker_id:sticker.id.clone(),creator_name:sticker.creator_name.clone(),created_at:sticker.created_at.clone(),material_id:sticker.material_id.clone(),aspect:sticker.aspect},
        png_len:png.len(),mask_len:mask.len(),signer:Some(crate::sign::Signer::Device{public_key:crate::sign::public_key(&key)}),bag:dress.bag.clone(),deco:dress.bag.as_ref().and(dress.deco.clone()),to:wrapped_to,history:Some(chain.clone())};
    let bytes=crate::sign::seal(MAGIC,VERSION,&header,&[png,mask].concat(),&key)?;decode_gift(&bytes)?;
    if tracked {crate::server::enqueue(&lib.db().conn,"cancel_release",sticker_id,&release)?;}
    let result=(||->Result<()> {
    let tx=lib.db_mut().conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if tx.query_row("SELECT state FROM stickers WHERE id=?1",[sticker_id],|r|r.get::<_,String>(0))? != "held" {return Err(Error::Invalid("Sticker not held here.".into()));}
    let count:u32=tx.query_row("SELECT COUNT(*) FROM transfers WHERE sticker_id=?1",[sticker_id],|r|r.get(0))?;
    if count!=release.seq {return Err(Error::Invalid("Sticker history changed while sealing.".into()));}
    if tracked || !referee.enabled() {referee.release(&release)?;}o::store_creation(&tx,&chain.creation)?;o::store_transfer(&tx,&release)?;
    tx.execute("INSERT INTO gifts_sent(gift_id,sticker_id,edition,to_label,sent_at) VALUES (?1,?2,0,?3,?4)",rusqlite::params![gift_id,sticker_id,to,release.at])?;
    o::provenance(&tx,sticker_id,"gifted",Some(to),&release.at)?;o::release_local(&tx,sticker_id)?;
    tx.execute("INSERT INTO meta(key,value) VALUES (?1,'1')",[format!("export.{gift_id}")])?;
    persist(&bytes)?;
    if tracked {crate::server::remove(&tx,"cancel_release",sticker_id)?;}
    tx.commit()?;Ok(())
    })();
    if let Err(e)=result {
        if tracked {if matches!(&e,Error::Referee(o::RefereeError::Rejected(_))) {crate::server::remove(&lib.db().conn,"cancel_release",sticker_id)?;}else{crate::server::compensate_release(lib.db(),referee,&release)?;}}
        return Err(e);
    }
    Ok((gift_id,bytes))
}

pub struct Decoded<'a> {
    pub header: GiftHeader,
    pub png: &'a [u8],
    pub mask: &'a [u8],
}

fn bad(msg: &str) -> Error {
    Error::Invalid(format!("not a Peta gift: {msg}"))
}

/// Read a gift file, checking it is what it says it is. Nothing is trusted: sizes are bounded and the PNG is decoded.
pub fn decode_gift(bytes: &[u8]) -> Result<Decoded<'_>> {
    if bytes.starts_with(crate::events::MAGIC) {
        let verified=crate::events::decode(bytes)?;let e=verified.header();
        if e.kind!="grant_sticker" || verified.attachments().len()!=1 {return Err(bad("not a sticker event"));}
        let (_,png,mask)=&verified.attachments()[0];
        // The original event remains the package; opening verifies its official signature again.
        let n=13+u32::from_be_bytes(bytes[9..13].try_into().unwrap()) as usize;
        let header=GiftHeader{gift_id:format!("GIFT-E-{}",e.event_id),from:"Peta".into(),note:Some(e.message.clone()),sent_at:e.issued_at.clone(),edition:Some(1),history:None,
            origin:Origin{sticker_id:format!("EVENT-{}",e.event_id),creator_name:Some("Peta".into()),created_at:e.issued_at.clone(),material_id:Some("matte".into()),aspect:{let image=image::load_from_memory(png)?;image.width() as f64/image.height() as f64}},png_len:png.len(),mask_len:mask.len(),signer:Some(e.signer.clone()),bag:None,deco:None,to:None};
        return Ok(Decoded{header,png:&bytes[n..n+png.len()],mask:&bytes[n+png.len()..n+png.len()+mask.len()]});
    }
    if bytes.len() < 13 || &bytes[..8] != MAGIC {
        return Err(bad("wrong file"));
    }
    if bytes.len()>crate::sign::MAX_FILE {return Err(bad("unreasonable size"));}
    if ![1,2,VERSION].contains(&bytes[8]) {
        return Err(bad("made by a newer version of Peta"));
    }
    let json_len = u32::from_be_bytes([bytes[9], bytes[10], bytes[11], bytes[12]]) as usize;
    if json_len == 0 || json_len > MAX_HEADER || bytes.len() < 13 + json_len {
        return Err(bad("damaged header"));
    }
    let (header,body):(GiftHeader,&[u8])=if bytes[8]>=2 {
        let (json,body)=crate::sign::unseal(bytes,MAGIC,bytes[8])?;
        let header:GiftHeader=serde_json::from_value(json).map_err(|_|bad("damaged header"))?;
        if !matches!(header.signer,Some(crate::sign::Signer::Device{..})){return Err(bad("gift needs a device signature"));}
        (header,body)
    }else {
        let header:GiftHeader=serde_json::from_slice(&bytes[13..13+json_len]).map_err(|_|bad("damaged header"))?;
        if header.signer.is_some(){return Err(bad("unsigned gift claims a signature"));}
        (header,&bytes[13+json_len..])
    };
    if header.png_len==0 || header.png_len>MAX_PNG || header.mask_len>MAX_PNG{return Err(bad("unreasonable size"));}
    if body.len() != header.png_len + header.mask_len {
        return Err(bad("damaged contents"));
    }
    if !header.gift_id.starts_with("GIFT-") || !crate::events::safe_id(&header.gift_id) || header.gift_id.len()>40 || header.from.len()>200 || header.from.trim().is_empty() || (bytes[8]<3 && header.edition.is_none_or(|n|n<1)) || !header.origin.aspect.is_finite() || header.origin.aspect<=0.0 || !dress_ok(&header.bag,&header.deco,&header.to) {
        return Err(bad("damaged header"));
    }
    let (png, mask) = body.split_at(header.png_len);
    crate::events::validate_png(png,MAX_PNG)?;if !mask.is_empty(){crate::events::validate_png(mask,MAX_PNG)?;}
    if bytes[8]==3 {
        let chain=header.history.as_ref().ok_or_else(||bad("missing history"))?;
        crate::ownership::sticker_chain_verify(chain,png)?;
        let release=chain.transfers.last().ok_or_else(||bad("missing release"))?;
        let sender=match &header.signer {Some(crate::sign::Signer::Device{public_key})=>public_key,_=>return Err(bad("missing sender"))};
        if header.edition.is_some()||chain.creation.sticker_id!=header.origin.sticker_id||chain.creation.created_at!=header.origin.created_at||chain.creation.creator_name!=header.origin.creator_name||release.kind!="release"||release.reference!=header.gift_id||&release.actor_key!=sender||release.at!=header.sent_at {
            return Err(Error::Invalid("The history of this sticker does not add up. Envelope and release disagree.".into()));
        }
    } else if header.history.is_some() {return Err(bad("legacy gift claims v3 history"));}
    Ok(Decoded { header, png, mask })
}

/// Put a gift in the Inbox, still sealed. Receiving the same gift twice is refused.
pub fn receive_gift(lib:&mut Library,bytes:&[u8])->Result<crate::db::IncomingGift> {receive_gift_with_referee(lib,bytes,&crate::ownership::NoReferee)}
pub fn receive_gift_with_referee(lib: &mut Library, bytes: &[u8],referee:&dyn crate::ownership::Referee) -> Result<crate::db::IncomingGift> {
    let d = decode_gift(bytes)?;
    if lib.db().gift_is_received(&d.header.gift_id)? {
        return Err(Error::GiftAlreadyReceived);
    }
    let mut incoming=d.header.history.clone();
    if let Some(chain)=incoming.as_mut() {
        let id=&chain.creation.sticker_id;
        if lib.db().held_sticker(id)?.is_some() {return Err(Error::Invalid("This real sticker is already in your Collection.".into()));}
        if let Some(old)=lib.db().sticker(id)? {
            let record:Option<String>=lib.db().conn.query_row("SELECT creation_record FROM stickers WHERE id=?1",[id],|r|r.get(0))?;
            let creation:crate::ownership::Creation=serde_json::from_str(record.as_deref().ok_or_else(||bad("missing previous origin"))?).map_err(|_|bad("damaged previous origin"))?;
            let mut stmt=lib.db().conn.prepare("SELECT seq,kind,actor_key,ref,at,sig FROM transfers WHERE sticker_id=?1 ORDER BY seq")?;
            let previous=stmt.query_map([id],|r|Ok(crate::ownership::Transfer{sticker_id:id.clone(),seq:r.get(0)?,kind:r.get(1)?,actor_key:r.get(2)?,reference:r.get(3)?,at:r.get(4)?,sig:r.get(5)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
            if old.state!="gone"||creation!=chain.creation||!chain.transfers.starts_with(&previous)||chain.transfers.len()<=previous.len() {return Err(bad("incoming history does not extend your record"));}
        }
        let key=crate::device_key::load_or_create(lib.root())?;
        use rusqlite::OptionalExtension;
        let pending:Option<(String,String)>=lib.db().conn.query_row("SELECT chain,content_digest FROM gift_claim_pending WHERE gift_id=?1",[&d.header.gift_id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((saved,digest))=pending {
            if digest!=crate::ownership::digest(bytes){return Err(bad("pending gift changed"));}
            *chain=serde_json::from_str(&saved).map_err(|_|bad("damaged pending claim"))?;
        }else{crate::ownership::append(chain,"claim",&d.header.gift_id,&key)?;}
        crate::ownership::sticker_chain_verify(chain,d.png)?;
        if referee.enabled() {lib.db().conn.execute("INSERT OR IGNORE INTO gift_claim_pending VALUES (?1,?2,?3)",rusqlite::params![d.header.gift_id,crate::server::json(chain)?,crate::ownership::digest(bytes)])?;}

    }
    use sha2::{Digest,Sha256};
    let content_id=Sha256::digest(bytes).iter().map(|b|format!("{b:02x}")).collect::<String>();
    let rel = format!("gifts/{content_id}.peta");
    let mut writes=crate::asset_writes::AssetWrites::new(lib);writes.write(&rel, bytes)?;
    let checked=if referee.enabled() {incoming.as_ref().map(|c|crate::server::known_status(referee,&c.creation.sticker_id)).transpose()?.unwrap_or(false)}else{false};
    let tx=lib.db_mut().conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(chain)=&incoming {
        if tx.query_row("SELECT EXISTS(SELECT 1 FROM stickers WHERE id=?1 AND state='held')",[&chain.creation.sticker_id],|r|r.get::<_,bool>(0))? {return Err(bad("sticker already held"));}
        if checked || !referee.enabled() {referee.claim(chain.transfers.last().unwrap())?;}
    }
    let identity=if let Some(crate::sign::Signer::Device{public_key})=&d.header.signer {Some(crate::friends::observe(&tx,public_key,&d.header.from)?)} else {None};
    tx.execute("INSERT INTO gifts_received(gift_id,from_name,note,sent_at,received_at,package) VALUES (?1,?2,?3,?4,?5,?6)",rusqlite::params![d.header.gift_id,identity.as_ref().map(|i|i.name.as_str()).unwrap_or(&d.header.from),d.header.note,d.header.sent_at,now(),rel])?;
    if d.header.bag.is_some() || d.header.deco.is_some() || d.header.to.is_some() {
        tx.execute("INSERT INTO gift_dress VALUES (?1,?2,?3,?4)",rusqlite::params![d.header.gift_id,d.header.bag,d.header.deco,d.header.to])?;
    }
    tx.execute("INSERT INTO gift_signers VALUES (?1,?2,?3,?4)",rusqlite::params![d.header.gift_id,identity.as_ref().map(|i|i.status.as_str()).unwrap_or("unsigned"),identity.as_ref().map(|i|&i.fingerprint),identity.as_ref().map(|i|&i.public_key)])?;
    if let Some(chain)=incoming {tx.execute("INSERT INTO gift_claims VALUES (?1,?2,?3)",rusqlite::params![d.header.gift_id,chain.creation.sticker_id,serde_json::to_string(&chain).map_err(|_|bad("could not save history"))?])?;}
    tx.execute("INSERT INTO gift_server_checks VALUES (?1,?2)",rusqlite::params![d.header.gift_id,checked])?;
    tx.execute("DELETE FROM gift_claim_pending WHERE gift_id=?1",[&d.header.gift_id])?;
    writes.commit(tx)?;
    lib.db()
        .gifts_received()?
        .into_iter()
        .find(|g| g.gift_id == d.header.gift_id)
        .ok_or_else(|| Error::Invalid("gift vanished after receiving".into()))
}

/// Break the seal: claim the transferred real sticker, or receive an unverified legacy gift.
pub fn open_gift(lib:&mut Library,gift_id:&str)->Result<Sticker> {open_gift_inner(lib,gift_id,None)}
pub fn open_gift_print(lib:&mut Library,gift_id:&str,date:&str)->Result<Sticker> {
    open_gift_inner(lib,gift_id,Some(date))
}
fn open_gift_inner(lib: &mut Library, gift_id: &str,date:Option<&str>) -> Result<Sticker> {
    if lib.db().gifts_received()?.iter().any(|g|g.gift_id==gift_id && g.opened_at.is_some()){return Err(Error::Invalid("That gift was already opened.".into()));}
    let rel = lib.db().gift_package_path(gift_id)?.ok_or_else(|| Error::Invalid(format!("unknown gift {gift_id}")))?;
    let bytes = lib.read_asset(&rel)?;
    let d = decode_gift(&bytes)?;
    let h = d.header.clone();
    if h.history.is_some() {return open_transfer(lib,gift_id,&d,date);}


    let id = loop {
        let id = crate::ids::new_sticker_id();
        if !lib.db().sticker_id_exists(&id)? {
            break id;
        }
    };
    let rendered_rel = format!("stickers/{id}/rendered.png");
    let mut writes=crate::asset_writes::AssetWrites::new(lib);writes.write(&rendered_rel, d.png)?;
    let mask_rel = if d.mask.is_empty() { None } else {
        let rel = format!("stickers/{id}/mask.png");
        writes.write(&rel, d.mask)?;
        Some(rel)
    };
    let tx=lib.db_mut().conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    tx.execute("INSERT INTO stickers(id,creator_id,creator_name,created_at,original_asset_path,rendered_asset_path,mask_asset_path,material_id,source_type,aspect,parent_sticker_id,edition_number) VALUES (?1,NULL,?2,?3,?4,?4,?5,?6,'gift',?7,?8,?9)",rusqlite::params![id,h.origin.creator_name,h.origin.created_at,rendered_rel,mask_rel,h.origin.material_id,h.origin.aspect,h.origin.sticker_id,h.edition])?;
    tx.execute("UPDATE stickers SET checked='pre_server' WHERE id=?1",[&id])?;
    crate::ownership::provenance(&tx,&id,"created",None,&h.origin.created_at)?;
    crate::ownership::provenance(&tx,&id,"gifted",Some(&h.from),&h.sent_at)?;
    crate::ownership::provenance(&tx,&id,"received",Some(&h.from),&now())?;
    if tx.execute("UPDATE gifts_received SET opened_at=?2,sticker_id=?3 WHERE gift_id=?1 AND opened_at IS NULL",rusqlite::params![gift_id,now(),id])?!=1 {return Err(bad("gift already opened"));}
    if let Some(date)=date {crate::daily::ensure_today_in(&tx,date,crate::ids::random_unit())?;crate::Database::confirm_in(&tx,date,&id,SourceType::Gift,&now())?;}
    writes.commit(tx)?;lib.db().sticker(&id)?.ok_or_else(||bad("sticker vanished"))
}

fn open_transfer(lib:&mut Library,gift_id:&str,d:&Decoded<'_>,date:Option<&str>)->Result<Sticker> {
    use rusqlite::OptionalExtension;
    use crate::ownership as o;
    let saved:String=lib.db().conn.query_row("SELECT chain FROM gift_claims WHERE gift_id=?1",[gift_id],|r|r.get(0))?;
    let chain:o::Chain=serde_json::from_str(&saved).map_err(|_|bad("damaged claim"))?;o::sticker_chain_verify(&chain,d.png)?;
    let original=d.header.history.as_ref().unwrap();
    if chain.creation!=original.creation||chain.transfers.len()!=original.transfers.len()+1||!chain.transfers.starts_with(&original.transfers) {return Err(bad("damaged claim"));}
    let id=&chain.creation.sticker_id;
    let mut writes=crate::asset_writes::AssetWrites::new(lib);
    let rendered=format!("stickers/{id}/received-{}.png",o::digest(d.png));writes.write(&rendered,d.png)?;
    let mask=if d.mask.is_empty(){None}else{let rel=format!("stickers/{id}/received-{}-mask.png",o::digest(d.mask));writes.write(&rel,d.mask)?;Some(rel)};
    let h=&d.header;let tx=lib.db_mut().conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let state:Option<String>=tx.query_row("SELECT state FROM stickers WHERE id=?1",[id],|r|r.get(0)).optional()?;
    match state.as_deref() {
        Some("held")=>return Err(bad("sticker already held")),
        Some("gone")=>{tx.execute("UPDATE stickers SET state='held' WHERE id=?1",[id])?;},
        None=>{tx.execute("INSERT INTO stickers(id,creator_id,creator_name,created_at,original_asset_path,rendered_asset_path,mask_asset_path,material_id,source_type,aspect) VALUES (?1,?2,?3,?4,?5,?5,?6,?7,'gift',?8)",rusqlite::params![id,chain.creation.creator_public_key,chain.creation.creator_name,chain.creation.created_at,rendered,mask,h.origin.material_id,h.origin.aspect])?;o::provenance(&tx,id,"created",chain.creation.creator_public_key.as_deref(),&chain.creation.created_at)?;},
        _=>return Err(bad("invalid held state")),
    }
    o::store_creation(&tx,&chain.creation)?;
    let checked:bool=tx.query_row("SELECT checked FROM gift_server_checks WHERE gift_id=?1",[gift_id],|r|r.get(0)).optional()?.unwrap_or(false);
    tx.execute("UPDATE stickers SET checked=?2,edition_verified=?3 WHERE id=?1",rusqlite::params![id,if checked {"checked"}else{"pre_server"},checked])?;
    tx.execute("UPDATE stickers SET edition_number=?2,edition_total=?3 WHERE id=?1",rusqlite::params![id,chain.creation.edition_no,chain.creation.edition_total])?;
    let existing:usize=tx.query_row("SELECT COUNT(*) FROM transfers WHERE sticker_id=?1",[id],|r|r.get(0))?;
    for transfer in chain.transfers.iter().skip(existing) {o::store_transfer(&tx,transfer)?;}
    o::provenance(&tx,id,"received",Some(&h.from),&now())?;
    if tx.execute("UPDATE gifts_received SET opened_at=?2,sticker_id=?3 WHERE gift_id=?1 AND opened_at IS NULL",rusqlite::params![gift_id,now(),id])?!=1 {return Err(bad("gift already opened"));}
    if let Some(date)=date {crate::daily::ensure_today_in(&tx,date,crate::ids::random_unit())?;crate::Database::confirm_in(&tx,date,id,SourceType::Gift,&now())?;}
    tx.execute("DELETE FROM gift_claims WHERE gift_id=?1",[gift_id])?;writes.commit(tx)?;
    lib.db().sticker(id)?.ok_or_else(||bad("sticker vanished"))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{ImageFormat, Rgba, RgbaImage};

    use super::*;
    use crate::{pack,ProvenanceKind};

    fn lib() -> Library {
        let dir = std::env::temp_dir().join(format!("peta-gift-test-{}", crate::ids::new_sticker_id()));
        std::fs::create_dir_all(&dir).unwrap();
        Library::open(&dir).unwrap()
    }

    fn disc_png() -> Vec<u8> {
        let mut img = RgbaImage::new(120, 100);
        for y in 0..100i32 {
            for x in 0..120i32 {
                if (x - 60).pow(2) + (y - 50).pow(2) < 36 * 36 {
                    img.put_pixel(x as u32, y as u32, Rgba([40, 140, 90, 255]));
                }
            }
        }
        let mut out = Vec::new();
        img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png).unwrap();
        out
    }

    /// A sticker in the sender's library, made the way the Creator makes one.
    fn sender_with_sticker() -> (Library, Sticker) {
        let mut lib = lib();
        lib.db_mut().set_display_name("Satoshi").unwrap();
        let rendered = pack::render_pack_sticker(&disc_png()).unwrap();
        let s = lib.add_made(&rendered, &disc_png(), "png", None, "holographic").unwrap();
        (lib, s)
    }

    struct Refuse;
    impl crate::ownership::Referee for Refuse {
        fn register(&self,_:&crate::ownership::Creation)->Result<()> {Err(bad("referee refused"))}
        fn release(&self,_:&crate::ownership::Transfer)->Result<()> {Err(bad("referee refused"))}
        fn claim(&self,_:&crate::ownership::Transfer)->Result<()> {Err(bad("referee refused"))}
    }
    #[test]
    fn failed_writes_and_referee_rejections_leave_the_whole_holder_state_intact() {
        let (mut mine,s)=sender_with_sticker();let copies=mine.db_mut().seed_legacy_copies(&s.id,1).unwrap();
        mine.stick_new(&copies[0],"display",0.5,0.5).unwrap();
        mine.db_mut().link_tag_add_stock(2).unwrap();
        for id in [&s.id,&copies[0].id] {mine.db_mut().link_tag_attach(id,"website","https://example.com","Site",true).unwrap();}
        for refuse in [false,true] {
            let referee:&dyn crate::ownership::Referee=if refuse {&Refuse}else{&crate::ownership::NoReferee};
            assert!(transfer_gift(&mut mine,&s.id,"Nao",None,&GiftDress::default(),referee,|_|Err(bad("disk full"))).is_err());
            assert_eq!(mine.db().sticker_count().unwrap(),2);assert_eq!(mine.db().copies(&s.id).unwrap(),1);
            assert_eq!(mine.db().on_desktop().unwrap().len(),1);assert_eq!(mine.db().link_tag_stock().unwrap().attached,2);
            assert_eq!(mine.db().gifts_sent_count(&s.id).unwrap(),0);
        }
        assert!(matches!(build_gift(&mut mine,&copies[0].id,"Nao",None),Err(Error::Invalid(e)) if e=="copies_stay_home"));
        let (_,file)=build_gift(&mut mine,&s.id,"Nao",None).unwrap();assert_eq!(mine.db().link_tag_stock().unwrap().available,2);
        let mut theirs=lib();assert!(receive_gift_with_referee(&mut theirs,&file,&Refuse).is_err());assert!(theirs.db().gifts_received().unwrap().is_empty());
        assert_eq!(std::fs::read_dir(theirs.root().join("assets/gifts")).unwrap().count(),0);
    }
    #[test]
    fn legacy_v1_and_v2_open_as_unverified_real_stickers() {
        let (mut mine,s)=sender_with_sticker();let (_,file)=build_gift(&mut mine,&s.id,"Nao",None).unwrap();let d=decode_gift(&file).unwrap();
        let key=crate::device_key::load_or_create(mine.root()).unwrap();
        for version in [1,2] {
            let mut h=d.header.clone();h.history=None;h.edition=Some(7);h.gift_id=crate::ids::new_gift_id();
            let body=[d.png,d.mask].concat();let legacy=if version==2 {crate::sign::seal(MAGIC,2,&h,&body,&key).unwrap()}else{
                h.signer=None;let json=serde_json::to_vec(&h).unwrap();let mut bytes=MAGIC.to_vec();bytes.push(1);bytes.extend_from_slice(&(json.len() as u32).to_be_bytes());bytes.extend(json);bytes.extend(body);bytes
            };
            let mut theirs=lib();let receipt=receive_gift(&mut theirs,&legacy).unwrap();let opened=open_gift(&mut theirs,&receipt.gift_id).unwrap();
            assert!(!opened.verified);assert_eq!(opened.lineage,"real");assert_eq!(opened.edition_number,Some(7));
            let (_,forwarded)=build_gift(&mut theirs,&opened.id,"Friend",None).unwrap();assert!(!decode_gift(&forwarded).unwrap().header.history.unwrap().creation.verified());
        }
    }
    #[test] fn failed_print_initialization_keeps_the_gift_sealed_and_the_day_unchanged() {
        let (mut sender,s)=sender_with_sticker();let (id,file)=build_gift(&mut sender,&s.id,"Friend",None).unwrap();let mut friend=lib();receive_gift(&mut friend,&file).unwrap();
        friend.db().conn.execute_batch("CREATE TRIGGER fail_print BEFORE INSERT ON print_queue BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
        assert!(open_gift_print(&mut friend,&id,"2026-10-11").is_err());assert!(friend.db().daily_get("2026-10-11").unwrap().is_none());assert!(friend.db().next_print().unwrap().is_none());assert_eq!(friend.db().sticker_count().unwrap(),0);
        assert!(friend.db().gifts_received().unwrap()[0].opened_at.is_none());
        let dir=friend.root().join("assets/stickers").join(&s.id);assert_eq!(std::fs::read_dir(dir).unwrap().count(),0);
        friend.db().conn.execute_batch("DROP TRIGGER fail_print;").unwrap();open_gift_print(&mut friend,&id,"2026-10-11").unwrap();assert!(friend.db().next_print().unwrap().is_some());
    }

    #[test]
    fn a_real_gift_moves_and_returns_with_the_same_identity() {
        let (mut mine,sticker)=sender_with_sticker();
        let copies=mine.db_mut().seed_legacy_copies(&sticker.id,2).unwrap();
        mine.stick_new(&copies[0],"display",0.5,0.5).unwrap();
        let (id,file)=build_gift(&mut mine,&sticker.id,"Nao",Some("  for you  ")).unwrap();
        assert_eq!(file[8],3);assert_eq!(decode_gift(&file).unwrap().header.edition,None);
        assert_eq!(mine.db().sticker_count().unwrap(),0);assert!(mine.db().on_desktop().unwrap().is_empty());
        assert_eq!(mine.db().copies(&sticker.id).unwrap(),0);assert_eq!(mine.db().sticker(&sticker.id).unwrap().unwrap().state,"gone");
        assert!(build_gift(&mut mine,&sticker.id,"Mom",None).is_err());
        let mut theirs=lib();receive_gift(&mut theirs,&file).unwrap();
        assert!(matches!(receive_gift(&mut theirs,&file),Err(Error::GiftAlreadyReceived)));
        let opened=open_gift(&mut theirs,&id).unwrap();assert_eq!(opened.id,sticker.id);assert!(opened.verified);assert_eq!(opened.edition_number,None);
        assert_eq!(opened.created_at,sticker.created_at);assert_eq!(opened.creator_name,sticker.creator_name);
        assert!(open_gift(&mut theirs,&id).is_err());
        let (back_id,back_file)=build_gift(&mut theirs,&opened.id,"Satoshi",None).unwrap();
        receive_gift(&mut mine,&back_file).unwrap();let returned=open_gift(&mut mine,&back_id).unwrap();
        assert_eq!(returned.id,sticker.id);assert_eq!(returned.source_type,SourceType::Created);assert_eq!(mine.db().sticker_count().unwrap(),1);
        assert_eq!(mine.db().conn.query_row("SELECT COUNT(*) FROM transfers WHERE sticker_id=?1",[&sticker.id],|r|r.get::<_,u32>(0)).unwrap(),4);
    }

    #[test]
    fn a_wrapped_gift_carries_its_wrapping_and_the_name_to_the_receiver() {
        let (mut mine, sticker) = sender_with_sticker();
        let long = "x".repeat(120);
        let dress = GiftDress { bag: Some("airmail".into()), deco: Some("clip".into()) };
        let (_, file) = build_gift_dressed(&mut mine, &sticker.id, "Mika", Some(&long), &dress).unwrap();
        let d = decode_gift(&file).unwrap();
        assert_eq!((d.header.bag.as_deref(), d.header.deco.as_deref(), d.header.to.as_deref()), (Some("airmail"), Some("clip"), Some("Mika")));
        assert_eq!(d.header.note.as_deref().unwrap().chars().count(), GIFT_NOTE_MAX);
        let mut theirs = lib();
        let inbox = receive_gift(&mut theirs, &file).unwrap();
        assert_eq!((inbox.bag.as_deref(), inbox.deco.as_deref(), inbox.to.as_deref()), (Some("airmail"), Some("clip"), Some("Mika")));
        // an unwrapped gift: no wrapping, the label stays private, the long note keeps its old limit
        let (mut mine,sticker)=sender_with_sticker();
        let (_, plain) = build_gift(&mut mine, &sticker.id, "Nao", Some(&long)).unwrap();
        let p = decode_gift(&plain).unwrap();
        assert_eq!((p.header.bag, p.header.to), (None, None));
        assert_eq!(p.header.note.unwrap().chars().count(), 120);
        assert_eq!(receive_gift(&mut theirs, &plain).unwrap().bag, None);
    }

    #[test]
    fn a_wrapping_that_does_not_exist_is_refused_when_sending_and_when_receiving() {
        let (mut mine, sticker) = sender_with_sticker();
        for dress in [GiftDress { bag: Some("envelope".into()), deco: None }, GiftDress { bag: Some("airmail".into()), deco: Some("glitter".into()) }] {
            assert!(build_gift_dressed(&mut mine, &sticker.id, "Mika", None, &dress).is_err());
        }
        assert!(build_gift_dressed(&mut mine, &sticker.id, "  ", None, &GiftDress { bag: Some("airmail".into()), deco: None }).is_err()); // a wrapping needs a name
    }

    #[test]
    fn signed_gifts_use_tofu_and_legacy_gifts_stay_unsigned() {
        let (mut mine,sticker)=sender_with_sticker();let mut theirs=lib();
        let (_,first)=build_gift(&mut mine,&sticker.id,"Nao",None).unwrap();assert_eq!(first[8],3);
        let one=receive_gift(&mut theirs,&first).unwrap();assert_eq!(one.signature_status,"new");assert_eq!(one.fingerprint.as_ref().unwrap().len(),9);
        let rendered=pack::render_pack_sticker(&disc_png()).unwrap();let second_sticker=mine.add_made(&rendered,&disc_png(),"png",None,"matte").unwrap();
        let (_,second)=build_gift(&mut mine,&second_sticker.id,"Nao",None).unwrap();assert_eq!(receive_gift(&mut theirs,&second).unwrap().signature_status,"known");
        let (mut other,s)=sender_with_sticker();let (_,third)=build_gift(&mut other,&s.id,"Nao",None).unwrap();assert_eq!(receive_gift(&mut theirs,&third).unwrap().signature_status,"warning");
        let d=decode_gift(&first).unwrap();let mut header=d.header.clone();header.signer=None;header.history=None;header.edition=Some(1);header.gift_id=crate::ids::new_gift_id();let json=serde_json::to_vec(&header).unwrap();let mut legacy=b"PETAGIFT".to_vec();legacy.push(1);legacy.extend_from_slice(&(json.len() as u32).to_be_bytes());legacy.extend(json);legacy.extend(d.png);legacy.extend(d.mask);
        assert_eq!(receive_gift(&mut theirs,&legacy).unwrap().signature_status,"unsigned");
    }
    #[test]
    fn changing_sender_edition_or_png_is_rejected_before_any_receipt() {
        let (mut mine,sticker)=sender_with_sticker();let (_,good)=build_gift(&mut mine,&sticker.id,"Nao",None).unwrap();let mut theirs=lib();
        for changed in [
            {let mut b=good.clone();let at=b.windows(7).position(|s|s==b"Satoshi").unwrap();b[at]=b'N';b},
            {let mut b=good.clone();let at=b.windows(7).position(|s|s==b"release").unwrap();b[at]=b'x';b},
            {let mut b=good.clone();let n=b.len();b[n-65]^=1;b},
        ] {assert!(matches!(receive_gift(&mut theirs,&changed),Err(Error::Invalid(e)) if e.contains("invalid_signature")));}
        assert!(theirs.db().gifts_received().unwrap().is_empty());assert_eq!(theirs.db().conn.query_row("SELECT COUNT(*) FROM friends",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }

    #[test]
    fn giving_a_gift_is_written_on_the_back_of_the_one_you_keep() {
        let (mut mine, sticker) = sender_with_sticker();
        build_gift(&mut mine, &sticker.id, "Nao", None).unwrap();
        let after = mine.db().sticker(&sticker.id).unwrap().unwrap();
        assert!(after.provenance.iter().any(|p| p.kind == ProvenanceKind::Gifted && p.user_id.as_deref() == Some("Nao")));
    }

    #[test]
    fn broken_or_hostile_files_are_refused_without_touching_the_library() {
        let (mut mine, sticker) = sender_with_sticker();
        let (_, good) = build_gift(&mut mine, &sticker.id, "Nao", None).unwrap();
        let mut theirs = lib();
        for (name, bytes) in [
            ("empty", Vec::new()),
            ("not a gift", b"hello there, this is not a gift".to_vec()),
            ("truncated", good[..good.len() / 2].to_vec()),
            ("trailing junk", [good.clone(), vec![1, 2, 3]].concat()),
            ("wrong version", { let mut g = good.clone(); g[8] = 9; g }),
            ("huge header", { let mut g = good.clone(); g[9..13].copy_from_slice(&u32::MAX.to_be_bytes()); g }),
        ] {
            assert!(receive_gift(&mut theirs, &bytes).is_err(), "{name} must be refused");
        }
        // the picture itself must decode
        let mut broken = good.clone();
        let n = broken.len();
        broken[n - 40] ^= 0xFF;
        let _ = receive_gift(&mut theirs, &broken); // either refused, or a still-valid png: never a panic
        assert_eq!(theirs.db().gifts_received().unwrap().len() <= 1, true);
    }
}
