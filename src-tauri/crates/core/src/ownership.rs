//! Portable creation proofs and local ownership. A chain is evidence; only a server can prevent forks.
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::SigningKey;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use crate::{db::now, Error, Result, Sticker, Database, sign};
pub const MAX_COPIES: u32 = 10;
fn invalid(reason: &str) -> Error { Error::Invalid(format!("The history of this sticker does not add up. {reason}")) }
pub fn digest(bytes: &[u8]) -> String { Sha256::digest(bytes).iter().map(|b|format!("{b:02x}")).collect() }
fn json(value: &impl Serialize) -> Result<Vec<u8>> { serde_json::to_vec(value).map_err(|e|invalid(&e.to_string())) }
fn signed(key: &SigningKey, bytes: &[u8]) -> String { STANDARD.encode(sign::sign(key, bytes)) }
fn verify(key: &str, bytes: &[u8], signature: &str) -> Result<()> {
    let sig=STANDARD.decode(signature).map_err(|_|invalid("Damaged signature."))?;
    sign::verify(&sign::parse_public(key).map_err(|_|invalid("Damaged key."))?,bytes,&sig).map_err(|_|invalid("Invalid signature."))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn new(id:&str)->crate::NewSticker {crate::NewSticker{id:id.into(),creator_id:None,creator_name:Some("Maker".into()),original_asset_path:"photo.jpg".into(),rendered_asset_path:"render.png".into(),mask_asset_path:Some("mask.png".into()),material_id:Some("matte".into()),source_type:crate::SourceType::Created,aspect:1.0}}
    #[test]
    fn proofs_bind_images_authors_and_each_transfer() {
        let a=sign::generate().unwrap();let b=sign::generate().unwrap();let stranger=sign::generate().unwrap();
        let mut chain=Chain{creation:Creation::new("proof",None,"2026-01-01T00:00:00Z",b"png",&a).unwrap(),transfers:vec![]};
        assert_eq!(sticker_chain_verify(&chain,b"png").unwrap(),sign::public_key(&a));
        assert!(sticker_chain_verify(&chain,b"other").is_err());
        let mut bad=chain.clone();bad.creation.creator_public_key=Some(sign::public_key(&b));assert!(sticker_chain_verify(&bad,b"png").is_err());
        append(&mut chain,"release","gift",&a).unwrap();append(&mut chain,"claim","gift",&b).unwrap();
        assert_eq!(sticker_chain_verify(&chain,b"png").unwrap(),sign::public_key(&b));
        let mut wrong=chain.clone();append(&mut wrong,"release","next",&stranger).unwrap();assert!(sticker_chain_verify(&wrong,b"png").is_err());
        let mut wrong=chain.clone();wrong.transfers.swap(0,1);assert!(sticker_chain_verify(&wrong,b"png").is_err());
        let mut wrong=chain.clone();wrong.transfers[1].reference="other".into();wrong.transfers[1].sig=signed(&b,&wrong.transfers[1].bytes().unwrap());assert!(sticker_chain_verify(&wrong,b"png").is_err());
        let mut wrong=chain.clone();wrong.transfers[1].at="2025-01-01T00:00:00Z".into();wrong.transfers[1].sig=signed(&b,&wrong.transfers[1].bytes().unwrap());assert!(sticker_chain_verify(&wrong,b"png").is_err());
        wrong.transfers[1].at="2999-01-01T00:00:00Z".into();wrong.transfers[1].sig=signed(&b,&wrong.transfers[1].bytes().unwrap());assert!(sticker_chain_verify(&wrong,b"png").is_err());
    }
    #[test]
    fn copies_share_assets_resolve_the_root_and_do_not_spend_stock() {
        let mut db=Database::open_in_memory().unwrap();db.create_sticker(new("real")).unwrap();
        let stock=db.material_count("matte").unwrap();let first=db.sticker_duplicate("real",2).unwrap();
        assert_eq!(first[0].rendered_asset_path,"render.png");assert_eq!(first[0].mask_asset_path.as_deref(),Some("mask.png"));assert_eq!(first[0].copy_no,Some(2));
        assert_eq!(first[0].provenance[0].kind,crate::ProvenanceKind::Duplicated);
        db.sticker_duplicate(&first[0].id,8).unwrap();assert_eq!(db.copies("real").unwrap(),10);
        assert!(matches!(db.sticker_duplicate("real",1),Err(Error::Invalid(s)) if s=="copy_limit"));
        assert!(matches!(require_real(&first[0]),Err(Error::Invalid(s)) if s=="copies_stay_home"));
        assert_eq!(db.material_count("matte").unwrap(),stock);
        db.delete_original(&first[0].id).unwrap();assert_eq!(db.copies("real").unwrap(),9);
        db.delete_original("real").unwrap();assert_eq!(db.sticker_count().unwrap(),0);
    }
    #[test]
    fn source_hashes_survive_deletion_and_only_creation_calls_the_bonus_seam() {
        let mut db=Database::open_in_memory().unwrap();let key=sign::generate().unwrap();
        crate::scraps::NEW_STICKER_CALLS.with(|c|c.borrow_mut().clear());
        assert!(db.create_signed_sticker(new("a"),b"source",b"png",&key,&NoReferee).unwrap().new_image);
        db.delete_original("a").unwrap();
        assert!(!db.create_signed_sticker(new("b"),b"source",b"different finish",&key,&NoReferee).unwrap().new_image);
        assert!(db.create_signed_sticker(new("c"),b"other source",b"png",&key,&NoReferee).unwrap().new_image);
        db.sticker_duplicate("c",1).unwrap();
        crate::scraps::NEW_STICKER_CALLS.with(|c|assert_eq!(*c.borrow(),vec![("a".into(),true),("b".into(),false),("c".into(),true)]));
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct LegacyHolder { pub key: String, pub at: String, pub sig: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Creation {
    pub sticker_id: String, pub creator_public_key: Option<String>, pub creator_name: Option<String>,
    pub created_at: String, pub image_digest: String, pub creator_sig: Option<String>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub legacy: Option<LegacyHolder>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub edition_no: Option<u32>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub edition_total: Option<u32>,
}
impl Creation {
    fn bytes(&self) -> Result<Vec<u8>> { json(&("peta.creation.v1", &self.sticker_id, &self.creator_public_key, &self.created_at, &self.image_digest, &self.creator_name, self.edition_no, self.edition_total)) }
    fn legacy_bytes(&self,key:&str,at:&str) -> Result<Vec<u8>> { json(&("peta.legacy-holder.v1", self.bytes()?, key, at)) }
    pub fn new(id:&str,name:Option<String>,at:&str,png:&[u8],key:&SigningKey) -> Result<Self> {
        let mut origin=Self{sticker_id:id.into(),creator_public_key:Some(sign::public_key(key)),creator_name:name,created_at:at.into(),image_digest:digest(png),creator_sig:None,legacy:None,edition_no:None,edition_total:None};
        origin.creator_sig=Some(signed(key,&origin.bytes()?)); Ok(origin)
    }
    pub fn edition(id:&str,name:Option<String>,at:&str,png:&[u8],key:&SigningKey,no:u32,total:u32) -> Result<Self> {
        let mut origin=Self::new(id,name,at,png,key)?; origin.edition_no=Some(no);origin.edition_total=Some(total);
        origin.creator_sig=Some(signed(key,&origin.bytes()?));Ok(origin)
    }
    pub fn verified(&self) -> bool { self.legacy.is_none() && self.creator_sig.is_some() }
    pub fn anchor_key(&self) -> Result<&str> { if let Some(legacy)=&self.legacy {Ok(&legacy.key)} else {self.creator_public_key.as_deref().ok_or_else(||invalid("Missing creator key."))} }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Transfer { pub sticker_id:String,pub seq:u32,pub kind:String,pub actor_key:String,#[serde(rename="ref")] pub reference:String,pub at:String,pub sig:String }
impl Transfer {
    fn bytes(&self)->Result<Vec<u8>> { json(&("peta.transfer.v1",&self.sticker_id,self.seq,&self.kind,&self.actor_key,&self.reference,&self.at)) }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Chain { pub creation:Creation,pub transfers:Vec<Transfer> }
fn time(at:&str)->Result<chrono::DateTime<chrono::FixedOffset>> { let at=chrono::DateTime::parse_from_rfc3339(at).map_err(|_|invalid("Invalid date."))?; if at>chrono::Utc::now() {return Err(invalid("Future date."));}Ok(at) }
pub fn sticker_chain_verify(chain:&Chain,png:&[u8])->Result<String> {
    let c=&chain.creation;
    if !crate::events::safe_id(&c.sticker_id)||c.sticker_id.len()>120||c.image_digest!=digest(png)||chain.transfers.len()>256 {return Err(invalid("Invalid creation record or image."));}
    let mut previous=time(&c.created_at)?;
    if c.edition_no.is_some()!=c.edition_total.is_some() || c.edition_no.zip(c.edition_total).is_some_and(|(n,total)|n==0||n>total||total>30) {return Err(invalid("Invalid edition."));}
    match (&c.creator_public_key,&c.creator_sig,&c.legacy) {
        (Some(key),Some(sig),None)=>verify(key,&c.bytes()?,sig)?,
        (None,None,Some(holder))=>{ let at=time(&holder.at)?;if at<previous{return Err(invalid("Legacy attestation precedes creation."));}verify(&holder.key,&c.legacy_bytes(&holder.key,&holder.at)?,&holder.sig)?;previous=at; },
        _=>return Err(invalid("Missing creation proof.")),
    }
    let mut owner=c.anchor_key()?.to_owned();let mut pending:Option<&str>=None;
    for (seq,t) in chain.transfers.iter().enumerate() {
        if t.seq as usize!=seq||t.sticker_id!=c.sticker_id||t.reference.is_empty()||t.reference.len()>512 {return Err(invalid("Invalid transfer sequence."));}
        let at=time(&t.at)?;if at<previous{return Err(invalid("Dates run backwards."));} previous=at;
        verify(&t.actor_key,&t.bytes()?,&t.sig)?;
        match (t.kind.as_str(),pending) {
            ("release",None) if t.actor_key==owner=>pending=Some(&t.reference),
            ("claim",Some(reference)) if reference==t.reference=>{owner=t.actor_key.clone();pending=None;},
            _=>return Err(invalid("Wrong owner, order or reference.")),
        }
    }
    Ok(owner)
}
pub fn append(chain:&mut Chain,kind:&str,reference:&str,key:&SigningKey)->Result<Transfer> {
    let mut t=Transfer{sticker_id:chain.creation.sticker_id.clone(),seq:chain.transfers.len() as u32,kind:kind.into(),actor_key:sign::public_key(key),reference:reference.into(),at:now(),sig:String::new()};t.sig=signed(key,&t.bytes()?);chain.transfers.push(t.clone());Ok(t)
}
/// A future service can reject a fork. Rejections happen before a local transaction commits.
pub trait Referee { fn register(&self,sticker_id:&str,creator_sig:&str)->Result<()>;fn release(&self,release:&Transfer)->Result<()>;fn claim(&self,claim:&Transfer)->Result<()>;fn claim_slot(&self,_pack_id:&str,_slot:u32,_claimer_key:&str)->Result<()> {Ok(())} }
pub struct NoReferee;
impl Referee for NoReferee { fn register(&self,_:&str,_:&str)->Result<()>{Ok(())}fn release(&self,_:&Transfer)->Result<()>{Ok(())}fn claim(&self,_:&Transfer)->Result<()>{Ok(())} }
pub fn chain_for(db:&Database,s:&Sticker,png:&[u8],key:&SigningKey)->Result<Chain> {
    let record:Option<String>=db.conn.query_row("SELECT creation_record FROM stickers WHERE id=?1",[&s.id],|r|r.get(0))?;
    let creation=if let Some(record)=record {serde_json::from_str(&record).map_err(|_|invalid("Damaged stored origin."))?} else {
        let mut c=Creation{sticker_id:s.id.clone(),creator_public_key:None,creator_name:s.creator_name.clone(),created_at:s.created_at.clone(),image_digest:digest(png),creator_sig:None,legacy:None,edition_no:s.edition_number.and_then(|n|n.try_into().ok()),edition_total:None};
        // Old edition numbers are labels, with no provable total.
        c.edition_no=None;let holder_key=sign::public_key(key);let at=now();let sig=signed(key,&c.legacy_bytes(&holder_key,&at)?);c.legacy=Some(LegacyHolder{key:holder_key,at,sig});c
    };
    let mut stmt=db.conn.prepare("SELECT seq,kind,actor_key,ref,at,sig FROM transfers WHERE sticker_id=?1 ORDER BY seq")?;
    let transfers=stmt.query_map([&s.id],|r|Ok(Transfer{sticker_id:s.id.clone(),seq:r.get(0)?,kind:r.get(1)?,actor_key:r.get(2)?,reference:r.get(3)?,at:r.get(4)?,sig:r.get(5)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let chain=Chain{creation,transfers};let owner=sticker_chain_verify(&chain,png)?;
    if owner!=sign::public_key(key)||chain.transfers.last().is_some_and(|t|t.kind!="claim") {return Err(invalid("This device is not the holder."));}Ok(chain)
}
pub(crate) fn store_creation(conn:&Connection,c:&Creation)->Result<()> {
    conn.execute("UPDATE stickers SET creation_record=?2,creator_sig=?3,creator_public_key=?4,image_digest=?5,verified=?6 WHERE id=?1",params![c.sticker_id,serde_json::to_string(c).map_err(|e|invalid(&e.to_string()))?,c.creator_sig,c.creator_public_key,c.image_digest,c.verified()])?;Ok(())
}
pub(crate) fn store_transfer(conn:&Connection,t:&Transfer)->Result<()> {conn.execute("INSERT INTO transfers(sticker_id,seq,kind,actor_key,ref,at,sig) VALUES (?1,?2,?3,?4,?5,?6,?7)",params![t.sticker_id,t.seq,t.kind,t.actor_key,t.reference,t.at,t.sig])?;Ok(())}
pub(crate) fn provenance(conn:&Connection,id:&str,kind:&str,user:Option<&str>,at:&str)->Result<()> {conn.execute("INSERT INTO provenance SELECT ?1,COALESCE(MAX(seq),-1)+1,?2,?3,?4 FROM provenance WHERE sticker_id=?1",params![id,kind,user,at])?;Ok(())}
pub(crate) fn release_local(conn:&Connection,id:&str)->Result<()> {
    if conn.execute("UPDATE stickers SET state='gone' WHERE id=?1 AND state='held' AND lineage='real'",[id])?!=1 {return Err(Error::Invalid("That sticker is no longer held here.".into()));}
    conn.execute("DELETE FROM stickers WHERE copy_of=?1",[id])?;
    for table in ["placements","link_tags","print_queue"] {conn.execute(&format!("DELETE FROM {table} WHERE sticker_id=?1"),[id])?;}
    conn.execute("DELETE FROM meta WHERE key='profile.icon_sticker_id' AND value=?1",[id])?;
    conn.execute("UPDATE daily_records SET sticker_id=NULL,confirmed_at=NULL,used_at=NULL WHERE sticker_id=?1",[id])?;
    provenance(conn,id,"released",None,&now())?;Ok(())
}
pub fn require_real(s:&Sticker)->Result<()> {if s.lineage=="copy" {Err(Error::Invalid("copies_stay_home".into()))} else if s.state!="held" {Err(Error::Invalid("That sticker is no longer in your Collection.".into()))} else {Ok(())}}
impl Database {
    pub fn copies(&self,id:&str)->Result<u32>{Ok(self.conn.query_row("SELECT COUNT(*) FROM stickers WHERE copy_of=?1",[id],|r|r.get(0))?)}
    pub fn sticker_duplicate(&mut self,id:&str,count:u32)->Result<Vec<Sticker>> {
        let s=self.held_sticker(id)?.ok_or_else(||Error::Invalid("Sticker not found.".into()))?;let root=s.copy_of.as_deref().unwrap_or(&s.id).to_owned();
        let original=self.held_sticker(&root)?.ok_or_else(||Error::Invalid("The real sticker is no longer here.".into()))?;require_real(&original)?;
        let tx=self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if !tx.query_row("SELECT EXISTS(SELECT 1 FROM stickers WHERE id=?1 AND state='held' AND lineage='real')",[&root],|r|r.get::<_,bool>(0))? {return Err(invalid("Real sticker left this device."));}
        let existing:u32=tx.query_row("SELECT COUNT(*) FROM stickers WHERE copy_of=?1",[&root],|r|r.get(0))?;
        if count==0||count>MAX_COPIES||existing+count>MAX_COPIES {return Err(Error::Invalid("copy_limit".into()));}
        let mut ids=Vec::new();let mut used=std::collections::HashSet::new();
        {let mut stmt=tx.prepare("SELECT copy_no FROM stickers WHERE copy_of=?1")?;for n in stmt.query_map([&root],|r|r.get::<_,u32>(0))? {used.insert(n?);}}
        for _ in 0..count {
            let no=(2..=MAX_COPIES+1).find(|n|!used.contains(n)).unwrap();used.insert(no);let id=crate::ids::new_sticker_id();
            tx.execute("INSERT INTO stickers(id,creator_id,creator_name,created_at,original_asset_path,rendered_asset_path,mask_asset_path,material_id,source_type,aspect,lineage,copy_of,copy_no,title) SELECT ?2,creator_id,creator_name,?3,original_asset_path,rendered_asset_path,mask_asset_path,material_id,'collection',aspect,'copy',id,?4,title FROM stickers WHERE id=?1 AND state='held'",params![root,id,now(),no])?;
            provenance(&tx,&id,"duplicated",Some(&root),&now())?;ids.push(id);
        }
        tx.commit()?;ids.into_iter().map(|id|self.sticker(&id)?.ok_or_else(||invalid("Copy vanished."))).collect()
    }
    pub fn held_sticker(&self,id:&str)->Result<Option<Sticker>> {Ok(self.sticker(id)?.filter(|s|s.state=="held"))}
}
