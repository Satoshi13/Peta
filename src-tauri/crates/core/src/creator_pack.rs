//! Device-signed packs: legacy weighted designs and finite numbered editions with inventory prizes.
//! Money and envelopes are never granted. TOFU is key continuity, not identity; spent slots need a server.
use ed25519_dalek::SigningKey;
use rusqlite::{params,OptionalExtension};
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use crate::{db::now,error::Result,events::{invalid,safe_id,text,validate_png},friends::{self,Identity},library::Library,sign::{self,Signer}};
pub const MAGIC:&[u8;8]=b"PETAPACK";
/// Legacy grades (packs made before Studio): the weight an item of that grade is read as. A grade is no longer chosen by authors;
/// rarity follows the material, and how likely an item is to come out is its own weight (1..=16).
pub const LEGACY_WEIGHTS:[(&str,u32);3]=[("common",4),("uncommon",2),("rare",1)];
pub const MAX_WEIGHT:u32=16;
const GRADES:[&str;5]=["common","uncommon","rare","special","archive"];
pub const BAGS:[&str;8]=["kraft","matte","holo","glassine","kraft-parcel","pocket","drawer","cotton"];
pub const DECOS:[&str;3]=["clip","pin","tape"];
const MAX_PICTURE:usize=2*1024*1024;
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Item {#[serde(default,skip_serializing_if="Option::is_none")] pub copies:Option<u32>,#[serde(default,skip_serializing_if="Vec::is_empty")] pub histories:Vec<crate::ownership::Chain>,#[serde(default,skip_serializing_if="std::ops::Not::not")] pub minted:bool,pub key:String,pub name:String,pub rarity:String,pub material_id:String,pub aspect:f64,pub png_len:usize,pub mask_len:usize,#[serde(default,skip_serializing_if="Option::is_none")] pub weight:Option<u32>}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Header {#[serde(default,skip_serializing_if="Vec::is_empty")] pub prizes:Vec<crate::edition_pack::Prize>,pub pack_id:String,pub version:i64,pub title:String,pub author:String,pub pouch:String,pub made_at:String,pub items:Vec<Item>,pub signer:Signer,
    #[serde(default,skip_serializing_if="Option::is_none")] pub layout:Option<Layout>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub cover:Option<String>,#[serde(default,skip_serializing_if="Option::is_none")] pub deco:Option<String>,#[serde(default,skip_serializing_if="Option::is_none")] pub blurb:Option<String>}
pub struct Verified {pub(crate) header:Header,pub(crate) items:Vec<(Vec<u8>,Vec<u8>)>,pub(crate) bytes:Vec<u8>,pub(crate) format:u8}
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Preview {pub pack_id:String,pub title:String,pub version:i64,pub count:usize,pub identity:Identity}
#[cfg(test)]
#[derive(Clone,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct LegacySelection {pub sticker_id:String,pub name:String,#[serde(default)] pub weight:Option<u32>}
/// How the pack is dressed (all optional): the sticker shown on the cover, one decoration, and a line for the Market card.
#[derive(Deserialize,Default,Debug)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Dress {#[serde(default)] pub cover:Option<String>,#[serde(default)] pub deco:Option<String>,#[serde(default)] pub blurb:Option<String>,#[serde(default)] pub layout:Option<Layout>}
/// Where the label, the cover sticker and up to two small accents sit on the wrapping (percent of the wrapping, centres). The label is always there: it has a place, never an off switch.
/// The window clamps every place to the inside of the wrapping when it draws, so a file from someone else cannot put anything outside it either.
pub const COMPOSITIONS:[&str;4]=["center","corner","band","free"];
pub const MAX_ACCENTS:usize=2;
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq)]
#[serde(rename_all="camelCase")]
pub struct Accent {pub kind:String,pub x:f64,pub y:f64}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq)]
#[serde(rename_all="camelCase")]
pub struct Layout {pub comp:String,#[serde(default)] pub label:Option<[f64;2]>,#[serde(default)] pub cover:Option<[f64;2]>,#[serde(default)] pub accents:Vec<Accent>}
fn spot(p:&[f64;2])->bool {p.iter().all(|v|v.is_finite()&&(0.0..=100.0).contains(v))}
fn layout_ok(l:&Layout)->bool {
    COMPOSITIONS.contains(&l.comp.as_str())&&l.label.as_ref().is_none_or(spot)&&l.cover.as_ref().is_none_or(spot)&&l.accents.len()<=MAX_ACCENTS
        &&l.accents.iter().all(|a|DECOS.contains(&a.kind.as_str())&&spot(&[a.x,a.y]))&&{let mut kinds:Vec<&str>=l.accents.iter().map(|a|a.kind.as_str()).collect();kinds.sort_unstable();kinds.dedup();kinds.len()==l.accents.len()}
}
impl Verified {pub fn header(&self)->&Header {&self.header}}
fn digest(bytes:&[u8])->String {Sha256::digest(bytes).iter().map(|b|format!("{b:02x}")).collect()}
pub(crate) fn public(header:&Header)->Result<&str>{match &header.signer{Signer::Device{public_key}=>Ok(public_key),_=>Err(invalid("Creator packs need a device signature."))}}
fn validate(header:&Header)->Result<()> {
    if !safe_id(&header.pack_id) || header.version<1 || !text(&header.title,40) || !text(&header.author,40) || header.author.trim().eq_ignore_ascii_case("peta") || !BAGS.contains(&header.pouch.as_str()) || !(3..=24).contains(&header.items.len()){return Err(invalid("This creator pack has invalid details. It needs 3–24 stickers and a personal author name."));}
    public(header)?;crate::events::validate_date(&header.made_at)?;
    let mut keys=std::collections::HashSet::new();
    for item in &header.items {
        if !safe_id(&item.key) || !keys.insert(&item.key) || !text(&item.name,40) || !GRADES.contains(&item.rarity.as_str()) || item.weight.is_some_and(|w|w==0||w>MAX_WEIGHT) || crate::materials::get(&item.material_id).is_none() || !item.aspect.is_finite() || item.aspect<=0.0 || item.png_len==0 || item.png_len>MAX_PICTURE || item.mask_len>MAX_PICTURE {return Err(invalid("This creator pack has an invalid or oversized sticker."));}
    }
    if let Some(cover)=&header.cover {if !header.items.iter().any(|i|&i.key==cover){return Err(invalid("The cover sticker is not in this pack."));}}
    if let Some(deco)=&header.deco {if !DECOS.contains(&deco.as_str()){return Err(invalid("Unknown decoration."));}}
    if let Some(layout)=&header.layout {if !layout_ok(layout){return Err(invalid("The pack's layout is not valid."));}}
    if let Some(blurb)=&header.blurb {if blurb.chars().count()>60||blurb.chars().any(char::is_control){return Err(invalid("The pack description is too long."));}}
    Ok(())
}
pub fn encode(header:&Header,body:&[u8],key:&SigningKey)->Result<Vec<u8>> {validate(header)?;let version=if header.items.iter().any(|i|i.copies.is_some()){2}else{1};if version==2 {crate::edition_pack::validate(header)?;sign::seal_large(MAGIC,2,header,body,key)}else{sign::seal(MAGIC,1,header,body,key)}}
pub fn decode(bytes:&[u8])->Result<Verified> {
    let format=bytes.get(8).copied().unwrap_or(0);let (header,body)=match format {1=>sign::unseal(bytes,MAGIC,1)?,2=>sign::unseal_large(bytes,MAGIC,2)?,_=>return Err(invalid("This pack needs a newer Peta."))};let header:Header=serde_json::from_value(header).map_err(|_|invalid("This pack has a damaged header."))?;validate(&header)?;if format==2{crate::edition_pack::validate(&header)?;}else if !header.prizes.is_empty()||header.items.iter().any(|i|i.copies.is_some()||!i.histories.is_empty()||i.minted){return Err(invalid("Legacy pack claims new editions."));}
    let mut rest=body;let mut items=Vec::new();
    for item in &header.items {
        let n=item.png_len.checked_add(item.mask_len).ok_or_else(||invalid("Invalid attachment length."))?;
        if rest.len()<n{return Err(invalid("This pack is truncated."));}
        let (part,tail)=rest.split_at(n);rest=tail;let (png,mask)=part.split_at(item.png_len);
        validate_png(png,MAX_PICTURE)?;if !mask.is_empty(){validate_png(mask,MAX_PICTURE)?;}
        if format==2 {crate::edition_pack::verify_item(&header,item,png)?;}
        items.push((png.to_vec(),mask.to_vec()));
    }
    if !rest.is_empty(){return Err(invalid("This pack has unexpected attachments."));}Ok(Verified{header,items,bytes:bytes.to_vec(),format})
}
pub(crate) fn internal_id(header:&Header)->Result<String>{Ok(format!("creator:{}:{}",digest(sign::parse_public(public(header)?)?.as_bytes()),header.pack_id))}
pub fn preview(lib:&Library,pack:&Verified)->Result<Preview> {
    let h=&pack.header;let identity=friends::preview(&lib.db().conn,public(h)?,&h.author)?;
    Ok(Preview{pack_id:h.pack_id.clone(),title:h.title.clone(),version:h.version,count:if pack.format==2{crate::edition_pack::slots(h) as usize}else{h.items.len()},identity})
}
pub fn install(lib:&mut Library,pack:&Verified,consent:bool)->Result<String> {
    if !consent{return Err(invalid("Pack import cancelled."));}
    if pack.format==2 {return crate::edition_pack::install(lib,pack);}
    let h=&pack.header;let id=internal_id(h)?;if crate::edition_pack::is_v2(lib.db(),&id)? {return Err(invalid("Editions cannot be replenished."));}let lib_root=lib.root().to_path_buf();
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
    // A pack you made yourself is not a new friend: it is marked as yours and nobody is added to the friends list
    let own=crate::device_key::load_or_create(&lib_root).ok().map(|k|sign::public_key(&k));
    let identity=if own.as_deref()==Some(public(h)?) {Identity{name:h.author.clone(),status:"mine".into(),fingerprint:sign::fingerprint(&sign::parse_public(public(h)?)?),public_key:public(h)?.into()}} else {friends::observe(&tx,public(h)?,&h.author)?};
    if existing.is_none(){tx.execute("INSERT INTO packs VALUES (?1,?2,?3,?4)",params![id,h.title,identity.name,now()])?;}
    else {tx.execute("UPDATE packs SET title=?2,by_name=?3 WHERE id=?1",params![id,h.title,identity.name])?;}
    tx.execute("INSERT INTO pack_distributions VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(pack_id) DO UPDATE SET version=excluded.version,status=excluded.status,pouch=excluded.pouch",params![id,h.pack_id,h.version,public(h)?,identity.fingerprint,identity.status,h.pouch])?;
    for (item,(path,mask_path)) in h.items.iter().zip(paths) {
        if tx.query_row("SELECT 1 FROM pack_items WHERE pack_id=?1 AND item_key=?2",params![id,item.key],|_|Ok(())).optional()?.is_some(){continue;}
        tx.execute("INSERT INTO pack_items(pack_id,item_key) VALUES (?1,?2)",params![id,item.key])?;
        let item_id=tx.last_insert_rowid();
        tx.execute("INSERT INTO signed_pack_items(item_id,png_path,mask_path,material_id,aspect,name,rarity,finished) VALUES (?1,?2,?3,?4,?5,?6,?7,1)",params![item_id,path,mask_path,item.material_id,item.aspect,item.name,item.rarity])?;
        if let Some(w)=item.weight {tx.execute("INSERT INTO pack_item_weights VALUES (?1,?2)",params![item_id,w])?;}
    }
    match &h.layout {Some(layout)=>{tx.execute("INSERT INTO meta(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![format!("pack.layout.{id}"),serde_json::to_string(layout).map_err(|e|invalid(&e.to_string()))?])?;},None=>{tx.execute("DELETE FROM meta WHERE key=?1",params![format!("pack.layout.{id}")])?;}}
    tx.execute("INSERT INTO pack_dress VALUES (?1,?2,?3,?4) ON CONFLICT(pack_id) DO UPDATE SET cover=excluded.cover,deco=excluded.deco,blurb=excluded.blurb",params![id,h.cover,h.deco,h.blurb])?;
    tx.commit()?;Ok(id)
}
/// Preview/export does not mutate DB. Record the revision only after the user saved successfully.
#[cfg(test)]
fn build_legacy(lib:&Library,title:&str,pouch:&str,selection:&[LegacySelection],dress:&Dress)->Result<(Header,Vec<u8>)> {
    let title=title.trim();
    if !(3..=24).contains(&selection.len()) || !text(title,40){return Err(invalid("Choose 3–24 stickers and a title up to 40 characters."));}
    let key=crate::device_key::load_or_create(lib.root())?;let author=lib.db().display_name()?;
    let slug:String=title.chars().filter(|c|c.is_ascii_alphanumeric()).take(16).flat_map(char::to_lowercase).collect();
    let pack_id=format!("{}-{}-{}",sign::fingerprint(&key.verifying_key()).replace('-',""),if slug.is_empty(){"pack"}else{&slug},&digest(title.as_bytes())[..16]);
    let version=lib.db().conn.query_row("SELECT version FROM packs_made WHERE pack_id=?1",[&pack_id],|r|r.get::<_,i64>(0)).optional()?.unwrap_or(0).checked_add(1).ok_or_else(||invalid("Pack version is too large."))?;
    let mut header=Header{prizes:vec![],pack_id,version,title:title.trim().into(),author,pouch:pouch.into(),made_at:now(),items:Vec::new(),signer:Signer::Device{public_key:sign::public_key(&key)},cover:dress.cover.clone().filter(|c|!c.is_empty()),deco:dress.deco.clone().filter(|d|!d.is_empty()),blurb:dress.blurb.as_deref().map(str::trim).filter(|b|!b.is_empty()).map(String::from),layout:dress.layout.clone()};let mut body=Vec::new();let mut ids=std::collections::HashSet::new();
    for item in selection {
        if !ids.insert(&item.sticker_id){return Err(invalid("Choose each sticker only once."));}
        let sticker=lib.db().sticker(&item.sticker_id)?.ok_or_else(||invalid("A selected sticker is no longer in your Book."))?;
        crate::ownership::require_real(&sticker)?;
        let png=lib.read_rendered(&item.sticker_id)?;let mask=sticker.mask_asset_path.as_ref().map(|p|lib.read_asset(p)).transpose()?.unwrap_or_default();
        let material_id=sticker.material_id.unwrap_or_else(||"matte".into());
        header.items.push(Item{copies:None,histories:vec![],minted:false,key:item.sticker_id.clone(),name:item.name.clone(),rarity:crate::materials::rarity_name(&material_id),material_id,aspect:sticker.aspect,png_len:png.len(),mask_len:mask.len(),weight:Some(item.weight.unwrap_or(4))});body.extend(png);body.extend(mask);
    }
    let bytes=encode(&header,&body,&key)?;decode(&bytes)?;Ok((header,bytes))
}
pub fn record_made(lib:&mut Library,h:&Header)->Result<()> {
    let tx=lib.db_mut().conn.transaction()?;let version=tx.query_row("SELECT version FROM packs_made WHERE pack_id=?1",[&h.pack_id],|r|r.get::<_,i64>(0)).optional()?.unwrap_or(0);
    if h.version!=version+1{return Err(invalid("This pack changed while saving. Please save again."));}
    tx.execute("INSERT INTO packs_made VALUES (?1,?2,?3,?4) ON CONFLICT(pack_id) DO UPDATE SET title=excluded.title,version=excluded.version,made_at=excluded.made_at",params![h.pack_id,h.title,h.version,h.made_at])?;tx.commit()?;Ok(())
}
/// Choose an index in proportion to the weights (`roll` is uniform in 0..1). Items with no weight are never chosen.
pub fn weighted_pick(weights:&[f64],roll:f64)->Option<usize> {
    let total:f64=weights.iter().filter(|w|**w>0.0).sum();if total<=0.0{return None;}
    let mut target=roll.clamp(0.0,0.999999)*total;
    for (i,w) in weights.iter().enumerate(){if *w<=0.0{continue;}if target<*w{return Some(i);}target-=w;}
    weights.iter().rposition(|w|*w>0.0)
}
/// What an item's weight is: its own, or what its legacy grade reads as.
fn weight_of(weight:Option<u32>,grade:&str)->f64 {f64::from(weight.unwrap_or_else(||LEGACY_WEIGHTS.iter().find(|(g,_)|*g==grade).map(|(_,w)|*w).unwrap_or(1)))}
type Row=(i64,String,String,Option<u32>);
fn rows(db:&crate::Database,sql:&str,pack_id:&str)->Result<Vec<Row>> {
    let mut stmt=db.conn.prepare(sql)?;
    let found=stmt.query_map([pack_id],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<u32>>(3)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
    Ok(found)
}
/// Draw one unopened item of a signed pack in proportion to the item weights. `_item_roll` stays for callers written for the old
/// two-step (grade, then item) draw.
pub fn pick(db:&crate::Database,pack_id:&str,roll:f64,_item_roll:f64)->Result<Option<(i64,String)>> {
    if crate::edition_pack::is_v2(db,pack_id)? {return crate::edition_pack::pick(db,pack_id,roll);}
    let device=db.conn.query_row("SELECT public_key FROM pack_distributions WHERE pack_id=?1",[pack_id],|r|r.get::<_,Option<String>>(0)).optional()?.flatten();
    if device.is_none(){return db.pack_pick(pack_id,roll);}
    let items=rows(db,"SELECT i.id,i.item_key,s.rarity,w.weight FROM pack_items i JOIN signed_pack_items s ON s.item_id=i.id LEFT JOIN pack_item_weights w ON w.item_id=i.id WHERE i.pack_id=?1 AND i.opened_at IS NULL ORDER BY i.id",pack_id)?;
    if items.is_empty(){return db.pack_pick(pack_id,roll);}
    let weights:Vec<f64>=items.iter().map(|i|weight_of(i.3,&i.2)).collect();Ok(weighted_pick(&weights,roll).map(|i|(items[i].0,items[i].1.clone())))
}

/// A bonus draws from the pack's original designs, including exhausted ones, without spending stock.
pub fn pick_bonus(db:&crate::Database,pack_id:&str,roll:f64,_item_roll:f64)->Result<Option<(i64,String)>> {
    if crate::edition_pack::is_v2(db,pack_id)? {return crate::edition_pack::pick(db,pack_id,roll);}
    let items=rows(db,"SELECT MIN(i.id),i.item_key,COALESCE(s.rarity,'common'),w.weight FROM pack_items i LEFT JOIN signed_pack_items s ON s.item_id=i.id LEFT JOIN pack_item_weights w ON w.item_id=i.id WHERE i.pack_id=?1 GROUP BY i.item_key ORDER BY MIN(i.id)",pack_id)?;
    let weights:Vec<f64>=items.iter().map(|i|weight_of(i.3,&i.2)).collect();
    Ok(weighted_pick(&weights,roll).map(|i|(items[i].0,items[i].1.clone())))
}
/// Up to three pictures to show on the pack's card: the cover first, then the items that come out most often (the rarest are kept
/// as a surprise). Returns `(item id, name, picture path, material id)`.
pub fn peek(db:&crate::Database,pack_id:&str)->Result<Vec<(i64,String,String,String)>> {
    if crate::edition_pack::is_v2(db,pack_id)? {return crate::edition_pack::peek(db,pack_id);}
    let cover:Option<String>=db.conn.query_row("SELECT cover FROM pack_dress WHERE pack_id=?1",[pack_id],|r|r.get(0)).optional()?.flatten();
    let mut stmt=db.conn.prepare("SELECT MIN(i.id),i.item_key,s.name,s.png_path,s.material_id,s.rarity,w.weight FROM pack_items i JOIN signed_pack_items s ON s.item_id=i.id LEFT JOIN pack_item_weights w ON w.item_id=i.id WHERE i.pack_id=?1 GROUP BY i.item_key ORDER BY MIN(i.id)")?;
    let found=stmt.query_map([pack_id],|r|{let weight:Option<u32>=r.get(6)?;let grade:String=r.get(5)?;Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,weight_of(weight,&grade)))})?.collect::<std::result::Result<Vec<(i64,String,String,String,String,f64)>,_>>()?;
    let mut all=found;
    all.sort_by(|a,b|b.5.partial_cmp(&a.5).unwrap_or(std::cmp::Ordering::Equal)); // stable: ties keep the order they were made in
    if let Some(c)=&cover {if let Some(at)=all.iter().position(|i|&i.1==c){let item=all.remove(at);all.insert(0,item);}}
    Ok(all.into_iter().take(3).map(|i|(i.0,i.2,i.3,i.4)).collect())
}

#[cfg(test)] mod tests {
    use super::*;
    fn lib()->Library {Library::open(&std::env::temp_dir().join(format!("peta-creator-pack-{}",crate::ids::new_sticker_id()))).unwrap()}
    fn png()->Vec<u8>{let mut bytes=Vec::new();({let mut image=image::RgbaImage::new(24,20);for y in 4..16{for x in 4..20{image.put_pixel(x,y,image::Rgba([140,90,50,255]));}}image}).write_to(&mut std::io::Cursor::new(&mut bytes),image::ImageFormat::Png).unwrap();bytes}
    fn pack(key:&SigningKey,n:usize)->(Header,Vec<u8>){let png=png();let header=Header{prizes:vec![],pack_id:"desk-doodles".into(),version:1,title:"Desk Doodles".into(),author:"Nao".into(),pouch:"kraft".into(),made_at:now(),items:(0..n).map(|i|Item{copies:None,histories:vec![],minted:false,key:format!("item-{i}"),name:format!("Sticker {i}"),rarity:if i==0{"rare"}else{"common"}.into(),material_id:"holographic".into(),aspect:16.0/12.0,png_len:png.len(),mask_len:png.len(),weight:None}).collect(),signer:Signer::Device{public_key:sign::public_key(key)},cover:None,deco:None,blurb:None,layout:None};let body=(0..n).flat_map(|_|[png.clone(),png.clone()].concat()).collect();(header,body)}
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
    #[test] fn a_draw_follows_the_weights_and_never_picks_a_zero() {
        assert_eq!(weighted_pick(&[1.0,4.0,4.0],0.0),Some(0));assert_eq!(weighted_pick(&[1.0,4.0,4.0],0.12),Some(1));assert_eq!(weighted_pick(&[1.0,4.0,4.0],0.99),Some(2));
        assert_eq!(weighted_pick(&[0.0,3.0],0.0),Some(1));assert_eq!(weighted_pick(&[2.0,0.0],0.999),Some(0));assert_eq!(weighted_pick(&[],0.5),None);assert_eq!(weighted_pick(&[0.0],0.5),None);
        let mut counts=[0;3];for k in 0..16000{counts[weighted_pick(&[1.0,3.0,12.0],k as f64/16000.0).unwrap()]+=1;}assert_eq!(counts,[1000,3000,12000]);
    }
    #[test] fn a_pack_without_weights_reads_its_old_grades_as_4_2_1() {
        let key=sign::generate().unwrap();let (mut h,body)=pack(&key,3);h.items[1].rarity="uncommon".into(); // rare, uncommon, common = 1, 2, 4
        let mut lib=lib();let id=install(&mut lib,&decode(&encode(&h,&body,&key).unwrap()).unwrap(),true).unwrap();
        let mut hits=std::collections::HashMap::new();for k in 0..7000{let (_,item)=pick(lib.db(),&id,k as f64/7000.0,0.0).unwrap().unwrap();*hits.entry(item).or_insert(0)+=1;}
        assert_eq!((hits["item-0"],hits["item-1"],hits["item-2"]),(1000,2000,4000));
    }
    #[test] fn item_weights_set_how_often_each_comes_out_and_rarity_does_not_matter() {
        let key=sign::generate().unwrap();let (mut h,body)=pack(&key,3);for (i,w) in [1u32,16,4].into_iter().enumerate(){h.items[i].weight=Some(w);}h.items[0].rarity="archive".into();
        let mut lib=lib();let id=install(&mut lib,&decode(&encode(&h,&body,&key).unwrap()).unwrap(),true).unwrap();
        let mut hits=std::collections::HashMap::new();for k in 0..2100{let (_,item)=pick(lib.db(),&id,k as f64/2100.0,0.0).unwrap().unwrap();*hits.entry(item).or_insert(0)+=1;}
        assert_eq!((hits["item-0"],hits["item-1"],hits["item-2"]),(100,1600,400));
        let (a,_)=pick_bonus(lib.db(),&id,0.99,0.0).unwrap().unwrap();assert_eq!(crate::pack::stored_item(lib.db(),a).unwrap().unwrap().rarity,"common");
    }
    #[test] fn dressing_is_signed_checked_and_kept_on_the_shelf() {
        let key=sign::generate().unwrap();let (mut h,body)=pack(&key,3);h.pouch="glassine".into();h.cover=Some("item-1".into());h.deco=Some("clip".into());h.blurb=Some("Small things that make a morning.".into());
        let file=encode(&h,&body,&key).unwrap();let p=decode(&file).unwrap();assert_eq!(p.header().cover.as_deref(),Some("item-1"));
        let mut lib=lib();let id=install(&mut lib,&p,true).unwrap();let shelf=lib.db().packs().unwrap();
        assert_eq!((shelf[0].pouch.as_deref(),shelf[0].cover.as_deref(),shelf[0].deco.as_deref(),shelf[0].blurb.as_deref()),(Some("glassine"),Some("item-1"),Some("clip"),Some("Small things that make a morning.")));let _=id;
        for change in 0..6 {let mut h=h.clone();match change{0=>h.cover=Some("nope".into()),1=>h.deco=Some("glitter".into()),2=>h.blurb=Some("x".repeat(61)),3=>h.pouch="envelope".into(),4=>h.items[0].weight=Some(0),_=>h.items[0].weight=Some(17)};assert!(encode(&h,&body,&key).is_err(),"change {change}");}
        // a pack made before Studio has no dressing at all and still reads
        let (old,body)=pack(&key,3);assert!(decode(&encode(&old,&body,&key).unwrap()).is_ok());
    }
    #[test] fn the_peek_shows_the_cover_and_the_most_common_and_keeps_the_rarest_hidden() {
        let key=sign::generate().unwrap();let (mut h,body)=pack(&key,5);for (i,w) in [1u32,2,16,8,4].into_iter().enumerate(){h.items[i].weight=Some(w);}h.cover=Some("item-4".into());
        let mut lib=lib();let id=install(&mut lib,&decode(&encode(&h,&body,&key).unwrap()).unwrap(),true).unwrap();
        let keys:Vec<String>=peek(lib.db(),&id).unwrap().into_iter().map(|p|p.1).collect();assert_eq!(keys,["Sticker 4","Sticker 2","Sticker 3"]); // cover, then 16, then 8; the weight 1 and 2 stay hidden
    }
    #[test] fn exhausted_signed_pack_bonus_uses_original_grades_and_finished_metadata() {
        let key=sign::generate().unwrap();let (h,body)=pack(&key,3);let mut lib=lib();
        let id=install(&mut lib,&decode(&encode(&h,&body,&key).unwrap()).unwrap(),true).unwrap();
        for _ in 0..3 {
            let (item,_)=pick(lib.db(),&id,0.0,0.0).unwrap().unwrap();
            lib.db_mut().pack_mark_opened(item,"old-copy").unwrap();
        }
        assert!(pick(lib.db(),&id,0.99,0.0).unwrap().is_none());
        let (rare,key)=pick_bonus(lib.db(),&id,0.0,0.0).unwrap().unwrap();
        assert_eq!(key,"item-0");
        let metadata=crate::pack::stored_item(lib.db(),rare).unwrap().unwrap();
        assert_eq!(metadata.rarity,"rare");assert_eq!(metadata.name,"Sticker 0");assert!(metadata.finished);
        let (common,_)=pick_bonus(lib.db(),&id,0.99,0.0).unwrap().unwrap();
        assert_eq!(crate::pack::stored_item(lib.db(),common).unwrap().unwrap().rarity,"common");
    }
    #[test] fn a_pack_you_made_can_go_on_your_own_shelf_dressed_and_weighted() {
        let mut mine=lib();mine.db_mut().set_display_name("Nao").unwrap();let rendered=crate::pack::render_pack_sticker(&png()).unwrap();let mut selections=Vec::new();
        for i in 0..4{let sticker=mine.add_made(&rendered,b"orig","jpg",None,"holographic").unwrap();selections.push(LegacySelection{sticker_id:sticker.id,name:format!("Drawing {i}"),weight:Some([1,2,4,16][i])});}
        let copy=mine.db_mut().sticker_duplicate(&selections[0].sticker_id,1).unwrap().remove(0);
        let mut invalid=selections.clone();invalid[0].sticker_id=copy.id;
        assert!(matches!(build_legacy(&mine,"No copies","cotton",&invalid,&Dress::default()),Err(crate::Error::Invalid(e)) if e=="copies_stay_home"));
        let dress=Dress{cover:Some(selections[2].sticker_id.clone()),deco:Some("pin".into()),blurb:Some("Small things.".into()),layout:None};
        let (h,bytes)=build_legacy(&mine,"My Desk","cotton",&selections,&dress).unwrap();
        assert!(h.items.iter().all(|i|i.rarity=="rare"&&i.material_id=="holographic")); // the grade written down is the material's
        let id=install(&mut mine,&decode(&bytes).unwrap(),true).unwrap();record_made(&mut mine,&h).unwrap();
        let shelf=mine.db().packs().unwrap();let mine_on_shelf=shelf.iter().find(|p|p.id==id).unwrap();
        assert_eq!((mine_on_shelf.pouch.as_deref(),mine_on_shelf.deco.as_deref(),mine_on_shelf.blurb.as_deref(),mine_on_shelf.total),(Some("cotton"),Some("pin"),Some("Small things."),4));
        let peeked=peek(mine.db(),&id).unwrap();assert_eq!(peeked.len(),3);assert_eq!(peeked[0].1,"Drawing 2"); // the cover first, then 16, then 4... the weight 1 stays hidden
        assert!(!peeked.iter().any(|p|p.1=="Drawing 0"));
        assert_eq!(mine_on_shelf.signature_status.as_deref(),Some("mine"));assert_eq!(mine.db().conn.query_row("SELECT COUNT(*) FROM friends",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        // a second save of the same pack is a newer version, not a duplicate on the shelf
        let (h2,bytes2)=build_legacy(&mine,"My Desk","cotton",&selections,&dress).unwrap();assert_eq!(h2.version,2);install(&mut mine,&decode(&bytes2).unwrap(),true).unwrap();
        assert_eq!(mine.db().packs().unwrap().iter().filter(|p|p.title=="My Desk").count(),1);
    }
    #[test] fn export_to_another_library_contains_finished_copies_only_and_versions_increase() {
        let mut mine=lib();mine.db_mut().set_display_name("Nao").unwrap();let picture=png();let rendered=crate::pack::render_pack_sticker(&picture).unwrap();let mut selections=Vec::new();
        for i in 0..4{let sticker=mine.add_made(&rendered,b"PRIVATE ORIGINAL PHOTO","jpg",None,"holographic").unwrap();selections.push(LegacySelection{sticker_id:sticker.id,name:format!("Drawing {i}"),weight:Some(if i==0{1}else{4})});}
        let (h,bytes)=build_legacy(&mine,"My Desk","matte",&selections,&Dress::default()).unwrap();assert!(!bytes.windows(22).any(|b|b==b"PRIVATE ORIGINAL PHOTO"));assert!(mine.db().packs().unwrap().is_empty());assert_eq!(h.version,1);record_made(&mut mine,&h).unwrap();assert_eq!(build_legacy(&mine,"My Desk","matte",&selections,&Dress::default()).unwrap().0.version,2);
        let p=decode(&bytes).unwrap();let mut theirs=lib();let id=install(&mut theirs,&p,true).unwrap();let (item,_) =pick(theirs.db(),&id,0.99,0.0).unwrap().unwrap();let metadata=crate::pack::stored_item(theirs.db(),item).unwrap().unwrap();let png=theirs.read_asset(&metadata.png_path).unwrap();let mask=theirs.read_asset(metadata.mask_path.as_ref().unwrap()).unwrap();let sticker=theirs.add_finished_from_pack(&png,&mask,&h.title,&h.author,&metadata.material_id).unwrap();
        assert_eq!(sticker.source_type,crate::SourceType::Pack);assert_eq!(sticker.original_number,None);assert_eq!(sticker.edition_number,None);assert_eq!(sticker.material_id.as_deref(),Some("holographic"));assert_eq!(theirs.db().material_count("holographic").unwrap(),0);assert_eq!(theirs.read_asset(&sticker.original_asset_path).unwrap(),png);
        let back=crate::back::sticker_back(theirs.db(),&sticker.id,"Me",&|t|Some(t.chars().take(10).collect())).unwrap().unwrap();assert_eq!(back.received_from.as_deref(),Some("My Desk"));
    }

    #[test] fn a_layout_is_signed_kept_on_the_shelf_and_refused_when_it_is_not_valid() {
        let key=sign::generate().unwrap();let (mut h,body)=pack(&key,3);
        let ok=Layout{comp:"free".into(),label:Some([40.0,35.0]),cover:Some([70.0,75.0]),accents:vec![Accent{kind:"clip".into(),x:75.0,y:10.0},Accent{kind:"tape".into(),x:50.0,y:8.0}]};
        h.layout=Some(ok.clone());let p=decode(&encode(&h,&body,&key).unwrap()).unwrap();assert_eq!(p.header().layout.as_ref(),Some(&ok));
        let mut lib=lib();let id=install(&mut lib,&p,true).unwrap();
        let shelf=lib.db().packs().unwrap();let mine=shelf.iter().find(|x|x.id==id).unwrap();let kept:Layout=serde_json::from_str(mine.layout.as_deref().unwrap()).unwrap();assert_eq!(kept,ok);
        for bad in [Layout{comp:"anywhere".into(),..ok.clone()},Layout{label:Some([140.0,10.0]),..ok.clone()},Layout{cover:Some([f64::NAN,10.0]),..ok.clone()},
            Layout{accents:vec![Accent{kind:"clip".into(),x:1.0,y:1.0},Accent{kind:"pin".into(),x:2.0,y:2.0},Accent{kind:"tape".into(),x:3.0,y:3.0}],..ok.clone()},
            Layout{accents:vec![Accent{kind:"clip".into(),x:1.0,y:1.0},Accent{kind:"clip".into(),x:2.0,y:2.0}],..ok.clone()},Layout{accents:vec![Accent{kind:"glitter".into(),x:1.0,y:1.0}],..ok.clone()}] {
            let mut h=h.clone();h.layout=Some(bad);assert!(encode(&h,&body,&key).is_err());
        }
        h.layout=None;h.version=2;let again=decode(&encode(&h,&body,&key).unwrap()).unwrap();install(&mut lib,&again,true).unwrap();assert!(lib.db().packs().unwrap().iter().find(|x|x.id==id).unwrap().layout.is_none());
    }
}

pub use crate::edition_pack::{Selection,Prize,press};
