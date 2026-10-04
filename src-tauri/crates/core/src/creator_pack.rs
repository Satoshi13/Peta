//! Device-signed creator packs only add a shelf pack. They never grant stock, envelopes or
//! money. TOFU is key continuity, not identity; distribution limits/revocation need a server.
use ed25519_dalek::SigningKey;
use rusqlite::{params,OptionalExtension};
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use crate::{db::now,error::Result,events::{invalid,safe_id,text,validate_png},friends::{self,Identity},library::Library,sign::{self,Signer}};
pub const MAGIC:&[u8;8]=b"PETAPACK";
pub const RARITY_WEIGHTS:[(&str,f64);3]=[("common",60.0),("uncommon",30.0),("rare",10.0)];
const MAX_PICTURE:usize=2*1024*1024;
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Item {pub key:String,pub name:String,pub rarity:String,pub material_id:String,pub aspect:f64,pub png_len:usize,pub mask_len:usize}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Header {pub pack_id:String,pub version:i64,pub title:String,pub author:String,pub pouch:String,pub made_at:String,pub items:Vec<Item>,pub signer:Signer}
pub struct Verified {header:Header,items:Vec<(Vec<u8>,Vec<u8>)>,bytes:Vec<u8>}
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Preview {pub pack_id:String,pub title:String,pub version:i64,pub count:usize,pub identity:Identity}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Selection {pub sticker_id:String,pub name:String,pub rarity:String}
impl Verified {pub fn header(&self)->&Header {&self.header}}
fn digest(bytes:&[u8])->String {Sha256::digest(bytes).iter().map(|b|format!("{b:02x}")).collect()}
fn public(header:&Header)->Result<&str>{match &header.signer{Signer::Device{public_key}=>Ok(public_key),_=>Err(invalid("Creator packs need a device signature."))}}
fn validate(header:&Header)->Result<()> {
    if !safe_id(&header.pack_id) || header.version<1 || !text(&header.title,40) || !text(&header.author,40) || header.author.trim().eq_ignore_ascii_case("peta") || !["kraft","matte","holo"].contains(&header.pouch.as_str()) || !(3..=24).contains(&header.items.len()){return Err(invalid("This creator pack has invalid details. It needs 3–24 stickers and a personal author name."));}
    public(header)?;crate::events::validate_date(&header.made_at)?;
    let mut keys=std::collections::HashSet::new();
    for item in &header.items {
        if !safe_id(&item.key) || !keys.insert(&item.key) || !text(&item.name,40) || !RARITY_WEIGHTS.iter().any(|(r,_)|*r==item.rarity) || crate::materials::get(&item.material_id).is_none() || !item.aspect.is_finite() || item.aspect<=0.0 || item.png_len==0 || item.png_len>MAX_PICTURE || item.mask_len>MAX_PICTURE {return Err(invalid("This creator pack has an invalid or oversized sticker."));}
    }Ok(())
}
pub fn encode(header:&Header,body:&[u8],key:&SigningKey)->Result<Vec<u8>> {validate(header)?;sign::seal(MAGIC,1,header,body,key)}
pub fn decode(bytes:&[u8])->Result<Verified> {
    let (header,body)=sign::unseal(bytes,MAGIC,1)?;let header:Header=serde_json::from_value(header).map_err(|_|invalid("This pack has a damaged header."))?;validate(&header)?;
    let mut rest=body;let mut items=Vec::new();
    for item in &header.items {
        let n=item.png_len.checked_add(item.mask_len).ok_or_else(||invalid("Invalid attachment length."))?;
        if rest.len()<n{return Err(invalid("This pack is truncated."));}
        let (part,tail)=rest.split_at(n);rest=tail;let (png,mask)=part.split_at(item.png_len);
        validate_png(png,MAX_PICTURE)?;if !mask.is_empty(){validate_png(mask,MAX_PICTURE)?;}
        items.push((png.to_vec(),mask.to_vec()));
    }
    if !rest.is_empty(){return Err(invalid("This pack has unexpected attachments."));}Ok(Verified{header,items,bytes:bytes.to_vec()})
}
fn internal_id(header:&Header)->Result<String>{Ok(format!("creator:{}:{}",digest(sign::parse_public(public(header)?)?.as_bytes()),header.pack_id))}
pub fn preview(lib:&Library,pack:&Verified)->Result<Preview> {
    let h=&pack.header;let identity=friends::preview(&lib.db().conn,public(h)?,&h.author)?;
    Ok(Preview{pack_id:h.pack_id.clone(),title:h.title.clone(),version:h.version,count:h.items.len(),identity})
}
pub fn install(lib:&mut Library,pack:&Verified,consent:bool)->Result<String> {
    if !consent{return Err(invalid("Pack import cancelled."));}
    let h=&pack.header;let id=internal_id(h)?;
    let existing=lib.db().conn.query_row("SELECT version FROM pack_distributions WHERE pack_id=?1",[&id],|r|r.get::<_,i64>(0)).optional()?;
    if existing.is_some_and(|v|v>=h.version){return Err(invalid("This version is already on your shelf."));}
    let content=digest(&pack.bytes);let mut paths=Vec::new();
    for (i,(png,mask)) in h.items.iter().zip(&pack.items) {
        let path=format!("packs/{content}/{}.png",i.key);lib.write_asset(&path,png)?;
        let mask_path=if mask.is_empty(){None}else{let path=format!("packs/{content}/{}-mask.png",i.key);lib.write_asset(&path,mask)?;Some(path)};paths.push((path,mask_path));
    }
    let tx=lib.db_mut().conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let existing=tx.query_row("SELECT version FROM pack_distributions WHERE pack_id=?1",[&id],|r|r.get::<_,i64>(0)).optional()?;
    if existing.is_some_and(|v|v>=h.version){return Err(invalid("This version is already on your shelf."));}
    let identity=friends::observe(&tx,public(h)?,&h.author)?;
    if existing.is_none(){tx.execute("INSERT INTO packs VALUES (?1,?2,?3,?4)",params![id,h.title,identity.name,now()])?;}
    else {tx.execute("UPDATE packs SET title=?2,by_name=?3 WHERE id=?1",params![id,h.title,identity.name])?;}
    tx.execute("INSERT INTO pack_distributions VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(pack_id) DO UPDATE SET version=excluded.version,status=excluded.status,pouch=excluded.pouch",params![id,h.pack_id,h.version,public(h)?,identity.fingerprint,identity.status,h.pouch])?;
    for (item,(path,mask_path)) in h.items.iter().zip(paths) {
        if tx.query_row("SELECT 1 FROM pack_items WHERE pack_id=?1 AND item_key=?2",params![id,item.key],|_|Ok(())).optional()?.is_some(){continue;}
        tx.execute("INSERT INTO pack_items(pack_id,item_key) VALUES (?1,?2)",params![id,item.key])?;
        tx.execute("INSERT INTO signed_pack_items VALUES (?1,?2,?3,?4,?5,?6,?7,1)",params![tx.last_insert_rowid(),path,mask_path,item.material_id,item.aspect,item.name,item.rarity])?;
    }
    tx.commit()?;Ok(id)
}
/// Preview/export does not mutate DB. Record the revision only after the user saved successfully.
pub fn build(lib:&Library,title:&str,pouch:&str,selection:&[Selection])->Result<(Header,Vec<u8>)> {
    let title=title.trim();
    if !(3..=24).contains(&selection.len()) || !text(title,40){return Err(invalid("Choose 3–24 stickers and a title up to 40 characters."));}
    let key=crate::device_key::load_or_create(lib.root())?;let author=lib.db().display_name()?;
    let slug:String=title.chars().filter(|c|c.is_ascii_alphanumeric()).take(16).flat_map(char::to_lowercase).collect();
    let pack_id=format!("{}-{}-{}",sign::fingerprint(&key.verifying_key()).replace('-',""),if slug.is_empty(){"pack"}else{&slug},&digest(title.as_bytes())[..16]);
    let version=lib.db().conn.query_row("SELECT version FROM packs_made WHERE pack_id=?1",[&pack_id],|r|r.get::<_,i64>(0)).optional()?.unwrap_or(0).checked_add(1).ok_or_else(||invalid("Pack version is too large."))?;
    let mut header=Header{pack_id,version,title:title.trim().into(),author,pouch:pouch.into(),made_at:now(),items:Vec::new(),signer:Signer::Device{public_key:sign::public_key(&key)}};let mut body=Vec::new();let mut ids=std::collections::HashSet::new();
    for item in selection {
        if !ids.insert(&item.sticker_id){return Err(invalid("Choose each sticker only once."));}
        let sticker=lib.db().sticker(&item.sticker_id)?.ok_or_else(||invalid("A selected sticker is no longer in your Book."))?;
        let png=lib.read_rendered(&item.sticker_id)?;let mask=sticker.mask_asset_path.as_ref().map(|p|lib.read_asset(p)).transpose()?.unwrap_or_default();
        header.items.push(Item{key:item.sticker_id.clone(),name:item.name.clone(),rarity:item.rarity.clone(),material_id:sticker.material_id.unwrap_or_else(||"matte".into()),aspect:sticker.aspect,png_len:png.len(),mask_len:mask.len()});body.extend(png);body.extend(mask);
    }
    let bytes=encode(&header,&body,&key)?;decode(&bytes)?;Ok((header,bytes))
}
pub fn record_made(lib:&mut Library,h:&Header)->Result<()> {
    let tx=lib.db_mut().conn.transaction()?;let version=tx.query_row("SELECT version FROM packs_made WHERE pack_id=?1",[&h.pack_id],|r|r.get::<_,i64>(0)).optional()?.unwrap_or(0);
    if h.version!=version+1{return Err(invalid("This pack changed while saving. Please save again."));}
    tx.execute("INSERT INTO packs_made VALUES (?1,?2,?3,?4) ON CONFLICT(pack_id) DO UPDATE SET title=excluded.title,version=excluded.version,made_at=excluded.made_at",params![h.pack_id,h.title,h.version,h.made_at])?;tx.commit()?;Ok(())
}
/// Redistribute absent grades by drawing only over the sum of nonempty grade weights.
pub fn weighted_index(rarities:&[&str],grade_roll:f64,item_roll:f64)->Option<usize> {
    let active:Vec<_>=RARITY_WEIGHTS.iter().filter(|(grade,_)|rarities.contains(grade)).collect();
    let total:f64=active.iter().map(|(_,weight)|weight).sum();if total==0.0{return None;}
    let mut roll=grade_roll.clamp(0.0,0.999999)*total;let mut chosen=active.last()?.0;
    for (grade,weight) in active{if roll<*weight{chosen=grade;break;}roll-=weight;}
    let indexes:Vec<_>=rarities.iter().enumerate().filter(|(_,r)|**r==chosen).map(|(i,_)|i).collect();
    indexes.get(((item_roll.clamp(0.0,0.999999)*indexes.len() as f64) as usize).min(indexes.len()-1)).copied()
}
pub fn pick(db:&crate::Database,pack_id:&str,grade_roll:f64,item_roll:f64)->Result<Option<(i64,String)>> {
    let device=db.conn.query_row("SELECT public_key FROM pack_distributions WHERE pack_id=?1",[pack_id],|r|r.get::<_,Option<String>>(0)).optional()?.flatten();
    if device.is_none(){return db.pack_pick(pack_id,item_roll);}
    let mut stmt=db.conn.prepare("SELECT i.id,i.item_key,s.rarity FROM pack_items i JOIN signed_pack_items s ON s.item_id=i.id WHERE i.pack_id=?1 AND i.opened_at IS NULL ORDER BY i.id")?;
    let items=stmt.query_map([pack_id],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
    if items.is_empty(){return db.pack_pick(pack_id,item_roll);}
    let rarities:Vec<_>=items.iter().map(|i|i.2.as_str()).collect();Ok(weighted_index(&rarities,grade_roll,item_roll).map(|i|(items[i].0,items[i].1.clone())))
}

#[cfg(test)] mod tests {
    use super::*;
    fn lib()->Library {Library::open(&std::env::temp_dir().join(format!("peta-creator-pack-{}",crate::ids::new_sticker_id()))).unwrap()}
    fn png()->Vec<u8>{let mut bytes=Vec::new();({let mut image=image::RgbaImage::new(24,20);for y in 4..16{for x in 4..20{image.put_pixel(x,y,image::Rgba([140,90,50,255]));}}image}).write_to(&mut std::io::Cursor::new(&mut bytes),image::ImageFormat::Png).unwrap();bytes}
    fn pack(key:&SigningKey,n:usize)->(Header,Vec<u8>){let png=png();let header=Header{pack_id:"desk-doodles".into(),version:1,title:"Desk Doodles".into(),author:"Nao".into(),pouch:"kraft".into(),made_at:now(),items:(0..n).map(|i|Item{key:format!("item-{i}"),name:format!("Sticker {i}"),rarity:if i==0{"rare"}else{"common"}.into(),material_id:"holographic".into(),aspect:16.0/12.0,png_len:png.len(),mask_len:png.len()}).collect(),signer:Signer::Device{public_key:sign::public_key(key)}};let body=(0..n).flat_map(|_|[png.clone(),png.clone()].concat()).collect();(header,body)}
    #[test] fn consent_versions_new_keys_and_rollback_preserve_shelf_and_tofu() {
        let key=sign::generate().unwrap();let (mut h,body)=pack(&key,3);let file=encode(&h,&body,&key).unwrap();let mut lib=lib();let p=decode(&file).unwrap();
        assert_eq!(preview(&lib,&p).unwrap().identity.status,"new");assert!(install(&mut lib,&p,false).is_err());assert!(lib.db().packs().unwrap().is_empty());assert_eq!(lib.db().conn.query_row("SELECT COUNT(*) FROM friends",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        let id=install(&mut lib,&p,true).unwrap();assert_eq!(lib.db().packs().unwrap()[0].remaining,3);assert!(install(&mut lib,&p,true).is_err());
        let (opened,_)=pick(lib.db(),&id,0.99,0.0).unwrap().unwrap();lib.db_mut().pack_mark_opened(opened,"opened-copy").unwrap();
        let (four,body)=pack(&key,4);h.items=four.items;h.version=2;let p=decode(&encode(&h,&body,&key).unwrap()).unwrap();install(&mut lib,&p,true).unwrap();let shelf=lib.db().packs().unwrap();assert_eq!((shelf[0].total,shelf[0].remaining),(4,3));assert_eq!(shelf[0].signature_status.as_deref(),Some("known"));
        h.version=3;let p=decode(&encode(&h,&body,&key).unwrap()).unwrap();lib.db().conn.execute_batch("CREATE TRIGGER fail_update BEFORE UPDATE ON pack_distributions BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();assert!(install(&mut lib,&p,true).is_err());assert_eq!(lib.db().conn.query_row("SELECT version FROM pack_distributions WHERE pack_id=?1",[id],|r|r.get::<_,i64>(0)).unwrap(),2);
    }
    #[test] fn altered_signatures_reserved_author_invalid_rarity_and_limits_are_refused() {
        let key=sign::generate().unwrap();let (h,body)=pack(&key,3);let mut file=encode(&h,&body,&key).unwrap();let n=file.len();file[n-65]^=1;assert!(matches!(decode(&file),Err(crate::Error::Invalid(e)) if e.contains("invalid_signature")));
        for change in 0..7 {let mut h=h.clone();match change{0=>h.author="  pEtA ".into(),1=>h.items[0].rarity="legendary".into(),2=>h.items.truncate(2),3=>h.items=vec![h.items[0].clone();25],4=>h.items[0].png_len=MAX_PICTURE+1,5=>h.items[1].key=h.items[0].key.clone(),_=>h.items[0].name="x".repeat(41)};assert!(encode(&h,&body,&key).is_err());}
        let mut huge=vec![0;sign::MAX_FILE+1];huge[..8].copy_from_slice(MAGIC);assert!(decode(&huge).is_err());
    }
    #[test] fn weights_are_injected_and_missing_grades_get_redistributed() {
        let all=["common","uncommon","rare"];assert_eq!(weighted_index(&all,0.59,0.0),Some(0));assert_eq!(weighted_index(&all,0.6,0.0),Some(1));assert_eq!(weighted_index(&all,0.9,0.0),Some(2));
        assert_eq!(weighted_index(&["common","uncommon"],0.65,0.0),Some(0));assert_eq!(weighted_index(&["common","uncommon"],0.67,0.0),Some(1));assert_eq!(weighted_index(&["rare","rare"],0.99,0.99),Some(1));assert_eq!(weighted_index(&[],0.0,0.0),None);
    }
    #[test] fn export_to_another_library_contains_finished_copies_only_and_versions_increase() {
        let mut mine=lib();mine.db_mut().set_display_name("Nao").unwrap();let picture=png();let rendered=crate::pack::render_pack_sticker(&picture).unwrap();let mut selections=Vec::new();
        for i in 0..4{let sticker=mine.add_made(&rendered,b"PRIVATE ORIGINAL PHOTO","jpg",None,"holographic").unwrap();selections.push(Selection{sticker_id:sticker.id,name:format!("Drawing {i}"),rarity:if i==0{"rare"}else{"common"}.into()});}
        let (h,bytes)=build(&mine,"My Desk","matte",&selections).unwrap();assert!(!bytes.windows(22).any(|b|b==b"PRIVATE ORIGINAL PHOTO"));assert!(mine.db().packs().unwrap().is_empty());assert_eq!(h.version,1);record_made(&mut mine,&h).unwrap();assert_eq!(build(&mine,"My Desk","matte",&selections).unwrap().0.version,2);
        let p=decode(&bytes).unwrap();let mut theirs=lib();let id=install(&mut theirs,&p,true).unwrap();let (item,_) =pick(theirs.db(),&id,0.99,0.0).unwrap().unwrap();let metadata=crate::pack::stored_item(theirs.db(),item).unwrap().unwrap();let png=theirs.read_asset(&metadata.png_path).unwrap();let mask=theirs.read_asset(metadata.mask_path.as_ref().unwrap()).unwrap();let sticker=theirs.add_finished_from_pack(&png,&mask,&h.title,&h.author,&metadata.material_id).unwrap();
        assert_eq!(sticker.source_type,crate::SourceType::Pack);assert_eq!(sticker.original_number,None);assert_eq!(sticker.edition_number,None);assert_eq!(sticker.material_id.as_deref(),Some("holographic"));assert_eq!(theirs.db().material_count("holographic").unwrap(),0);assert_eq!(theirs.read_asset(&sticker.original_asset_path).unwrap(),png);
        let back=crate::back::sticker_back(theirs.db(),&sticker.id,"Me",&|t|Some(t.chars().take(10).collect())).unwrap().unwrap();assert_eq!(back.received_from.as_deref(),Some("My Desk"));
    }
}
