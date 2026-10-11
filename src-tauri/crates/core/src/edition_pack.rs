//! Finite, signed edition slots. Offline signatures provide evidence, not a global spent ledger.
use rusqlite::{params,Connection,OptionalExtension};
use serde::{Deserialize,Serialize};
use crate::{creator_pack::{self,Header,Item,Dress,Verified},ownership::{self as o,Chain,Referee},sign,db::now,events::{invalid,text},Library,Database,Result,SourceType,Sticker};

pub const MAX_COPIES_PER_DESIGN:u32=30;
pub const MAX_PACK_SLOTS:u32=200;
pub const MAX_PRIZES:u32=10;
/// Reserved for the later economy work; currently creator packs are free.
pub const CREATOR_PACK_PRICE:u32=0;
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(tag="kind",rename_all="camelCase",deny_unknown_fields)]
pub enum Prize {Material{#[serde(rename="materialId")] material_id:String,count:u32},Tag{count:u32}}
impl Prize {pub fn count(&self)->u32 {match self {Self::Material{count,..}|Self::Tag{count}=>*count}}}
#[derive(Clone,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Selection {pub sticker_id:String,pub name:String,pub copies:u32}
pub fn slots(h:&Header)->u32 {h.items.iter().map(|i|i.copies.unwrap_or(0)).sum::<u32>()+h.prizes.iter().map(Prize::count).sum::<u32>()}
pub fn validate(h:&Header)->Result<()> {
    let mut total=0u32;let mut prizes=0u32;let mut identities=std::collections::HashSet::new();
    for i in &h.items {
        let n=i.copies.ok_or_else(||invalid("Missing edition count."))?;
        if n==0||n>MAX_COPIES_PER_DESIGN||i.weight.is_some()||i.histories.len()!=n as usize||(!i.minted&&n!=1) {return Err(invalid("Invalid edition count or histories."));}
        total=total.checked_add(n).ok_or_else(||invalid("Too many slots."))?;
        for chain in &i.histories {if !identities.insert(&chain.creation.sticker_id){return Err(invalid("Duplicate real sticker identity."));}}
    }
    for prize in &h.prizes {
        if prize.count()==0||prize.count()>MAX_PRIZES {return Err(invalid("Invalid prize count."));}
        if let Prize::Material{material_id,..}=prize {if crate::materials::get(material_id).is_none(){return Err(invalid("Unknown prize material."));}}
        prizes=prizes.checked_add(prize.count()).ok_or_else(||invalid("Too many prizes."))?;
    }
    if prizes>MAX_PRIZES||total+prizes>MAX_PACK_SLOTS {return Err(invalid("This pack exceeds the slot or prize limit."));}Ok(())
}
fn slot_ref(pack:&str,no:u32)->String {format!("{pack}:slot-{no}")}
pub fn verify_item(h:&Header,item:&Item,png:&[u8])->Result<()> {
    let key=creator_pack::public(h)?;let first=h.items.iter().take_while(|i|i.key!=item.key).map(|i|i.copies.unwrap_or(0)).sum::<u32>();
    for (i,chain) in item.histories.iter().enumerate() {
        o::sticker_chain_verify(chain,png)?;let last=chain.transfers.last().ok_or_else(||invalid("Missing pack release."))?;
        if last.kind!="release"||last.actor_key!=key||last.reference!=slot_ref(&h.pack_id,first+i as u32)||last.at!=h.made_at {return Err(invalid("Pack release and header disagree."));}
        if item.minted && (chain.creation.creator_public_key.as_deref()!=Some(key)||chain.creation.edition_no!=Some(i as u32+1)||chain.creation.edition_total!=item.copies||chain.transfers.len()!=1) {return Err(invalid("The edition proof does not match its printed count."));}
    }Ok(())
}
pub fn can_press(s:&Sticker,key:&str)->bool {s.lineage=="real"&&s.state=="held"&&s.source_type==SourceType::Created&&s.edition_number.is_none()&&s.creator_public_key.as_deref().is_none_or(|k|k==key)}
fn pack_id(title:&str,key:&ed25519_dalek::SigningKey)->String {
    let slug:String=title.chars().filter(char::is_ascii_alphanumeric).take(16).flat_map(char::to_lowercase).collect();
    format!("{}-{}-{}",sign::fingerprint(&key.verifying_key()).replace('-',""),if slug.is_empty(){"pack"}else{&slug},&o::digest(title.as_bytes())[..16])
}
/// Prepare immutable bytes. Only `press` is allowed to publish them and consume inventory.
fn build(lib:&Library,title:&str,pouch:&str,selection:&[Selection],prizes:&[Prize],dress:&Dress)->Result<(Header,Vec<u8>)> {
    if !(3..=24).contains(&selection.len())||!text(title.trim(),40){return Err(invalid("Choose 3–24 designs and a short title."));}
    let key=crate::device_key::load_or_create(lib.root())?;let public=sign::public_key(&key);let id=pack_id(title.trim(),&key);
    if lib.db().conn.query_row("SELECT EXISTS(SELECT 1 FROM packs_made WHERE pack_id=?1)",[&id],|r|r.get::<_,bool>(0))? {return Err(invalid("already_pressed"));}
    let mut h=Header{prizes:prizes.to_vec(),pack_id:id,version:1,title:title.trim().into(),author:lib.db().display_name()?,pouch:pouch.into(),made_at:now(),items:vec![],signer:sign::Signer::Device{public_key:public.clone()},layout:dress.layout.clone(),cover:dress.cover.clone().filter(|s|!s.is_empty()),deco:dress.deco.clone().filter(|s|!s.is_empty()),blurb:dress.blurb.as_deref().map(str::trim).filter(|s|!s.is_empty()).map(str::to_owned)};
    let mut body=Vec::new();let mut chosen=std::collections::HashSet::new();let mut slot=0;
    for selected in selection {
        if !chosen.insert(&selected.sticker_id){return Err(invalid("Choose each design once."));}
        if selected.copies==0||selected.copies>MAX_COPIES_PER_DESIGN{return Err(invalid("Invalid edition count."));}
        let s=lib.db().held_sticker(&selected.sticker_id)?.ok_or_else(||invalid("Sticker is no longer held here."))?;o::require_real(&s)?;
        let minted=can_press(&s,&public);
        if s.pressed {return Err(invalid("already_pressed"));}
        if !minted&&selected.copies!=1 {return Err(invalid("Made by someone else: one sticker."));}
        if h.cover.as_deref()==Some(&s.id)&&!minted{return Err(invalid("Choose your own design for the cover."));}
        let png=lib.read_rendered(&s.id)?;let mask=s.mask_asset_path.as_ref().map(|p|lib.read_asset(p)).transpose()?.unwrap_or_default();
        let mut histories=Vec::new();
        for n in 1..=selected.copies {
            let mut chain=if minted {
                let id=format!("ED-{}-{n}",&o::digest(format!("{}:{}",h.pack_id,s.id).as_bytes())[..32]);
                Chain{creation:o::Creation::edition(&id,s.creator_name.clone(),&h.made_at,&png,&key,n,selected.copies)?,transfers:vec![]}
            }else{o::chain_for(lib.db(),&s,&png,&key)?};
            let mut release=o::append(&mut chain,"release",&slot_ref(&h.pack_id,slot),&key)?;
            // One signed press time binds every slot, even when preparation spans milliseconds.
            release.at=h.made_at.clone();o::resign(&mut release,&key)?;*chain.transfers.last_mut().unwrap()=release;
            histories.push(chain);slot+=1;
        }
        let material_id=s.material_id.clone().unwrap_or_else(||"matte".into());
        h.items.push(Item{copies:Some(selected.copies),histories,minted,key:s.id,name:selected.name.clone(),rarity:crate::materials::rarity_name(&material_id),material_id,aspect:s.aspect,png_len:png.len(),mask_len:mask.len(),weight:None});
        body.extend(png);body.extend(mask);
    }
    h.made_at=now();
    for item in &mut h.items {for chain in &mut item.histories {let last=chain.transfers.last_mut().unwrap();last.at=h.made_at.clone();o::resign(last,&key)?;}}
    let bytes=creator_pack::encode(&h,&body,&key)?;creator_pack::decode(&bytes)?;Ok((h,bytes))
}
type Paths=Vec<(String,Option<String>)>;
fn write_assets(lib:&Library,p:&Verified)->Result<Paths> {
    let content=o::digest(&p.bytes);let mut paths=Vec::new();
    for (item,(png,mask)) in p.header.items.iter().zip(&p.items) {
        let path=format!("packs/{content}/{}.png",item.key);lib.write_asset(&path,png)?;
        let mask_path=if mask.is_empty(){None}else{let path=format!("packs/{content}/{}-mask.png",item.key);lib.write_asset(&path,mask)?;Some(path)};paths.push((path,mask_path));
    }Ok(paths)
}
fn install_in(conn:&Connection,p:&Verified,paths:&Paths,own:&str)->Result<String> {
    let h=&p.header;let id=creator_pack::internal_id(h)?;let public=creator_pack::public(h)?;
    if conn.query_row("SELECT EXISTS(SELECT 1 FROM packs WHERE id=?1)",[&id],|r|r.get::<_,bool>(0))? {return Err(invalid("This pack is already on your shelf. Editions cannot be replenished."));}
    let identity=if own==public {crate::friends::Identity{name:h.author.clone(),status:"mine".into(),fingerprint:sign::fingerprint(&sign::parse_public(public)?),public_key:public.into()}}else{crate::friends::observe(conn,public,&h.author)?};
    conn.execute("INSERT INTO packs VALUES (?1,?2,?3,?4)",params![id,h.title,identity.name,now()])?;
    conn.execute("INSERT INTO pack_distributions VALUES (?1,?2,?3,?4,?5,?6,?7)",params![id,h.pack_id,h.version,public,identity.fingerprint,identity.status,h.pouch])?;
    conn.execute("INSERT INTO edition_pack_frames VALUES (?1,?2,?3)",params![id,serde_json::to_string(h).map_err(|e|invalid(&e.to_string()))?,o::digest(&p.bytes)])?;
    let mut slot=0u32;
    for (item,(path,mask)) in h.items.iter().zip(paths) {
        for chain in &item.histories {
            conn.execute("INSERT INTO pack_items(pack_id,item_key) VALUES (?1,?2)",params![id,item.key])?;let row=conn.last_insert_rowid();
            conn.execute("INSERT INTO signed_pack_items(item_id,png_path,mask_path,material_id,aspect,name,rarity,finished,edition_no,edition_total,kind) VALUES (?1,?2,?3,?4,?5,?6,?7,1,?8,?9,'sticker')",params![row,path,mask,item.material_id,item.aspect,item.name,item.rarity,chain.creation.edition_no,chain.creation.edition_total])?;
            conn.execute("INSERT INTO edition_pack_slots VALUES (?1,?2,?3)",params![row,slot,serde_json::to_string(chain).map_err(|e|invalid(&e.to_string()))?])?;slot+=1;
        }
    }
    for prize in &h.prizes {
        let (kind,reference,name)=match prize {Prize::Material{material_id,..}=>("material",Some(material_id.as_str()),crate::materials::get(material_id).unwrap().name),Prize::Tag{..}=>("tag",None,"Link tag".into())};
        for _ in 0..prize.count() {
            conn.execute("INSERT INTO pack_items(pack_id,item_key) VALUES (?1,?2)",params![id,format!("prize-{slot}")])?;let row=conn.last_insert_rowid();
            conn.execute("INSERT INTO signed_pack_items(item_id,png_path,mask_path,material_id,aspect,name,rarity,finished,kind,prize_ref) VALUES (?1,'',NULL,'matte',1,?2,'common',1,?3,?4)",params![row,name,kind,reference])?;
            conn.execute("INSERT INTO edition_pack_slots VALUES (?1,?2,NULL)",params![row,slot])?;slot+=1;
        }
    }
    conn.execute("INSERT INTO pack_dress VALUES (?1,?2,?3,?4)",params![id,h.cover,h.deco,h.blurb])?;
    if let Some(layout)=&h.layout {conn.execute("INSERT INTO meta VALUES (?1,?2)",params![format!("pack.layout.{id}"),serde_json::to_string(layout).map_err(|e|invalid(&e.to_string()))?])?;}Ok(id)
}
pub fn install(lib:&mut Library,p:&Verified)->Result<String> {
    let own=sign::public_key(&crate::device_key::load_or_create(lib.root())?);let paths=write_assets(lib,p)?;
    let tx=lib.db_mut().conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;let id=install_in(&tx,p,&paths,&own)?;tx.commit()?;Ok(id)
}
pub fn press(lib:&mut Library,title:&str,pouch:&str,items:&[Selection],prizes:&[Prize],dress:&Dress,shelf:bool,referee:&dyn Referee,persist:impl FnOnce(&Header,&[u8])->Result<()>)->Result<String> {
    let (h,bytes)=build(lib,title,pouch,items,prizes,dress)?;let verified=creator_pack::decode(&bytes)?;
    let key=crate::device_key::load_or_create(lib.root())?;let own=sign::public_key(&key);let paths=if shelf {write_assets(lib,&verified)?}else{vec![]};
    let snapshots=h.items.iter().map(|i|lib.db().held_sticker(&i.key)?.ok_or_else(||invalid("Sticker left this device."))).collect::<Result<Vec<_>>>()?;
    let tx=lib.db_mut().conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let mut materials=std::collections::BTreeMap::<String,u32>::new();let mut tags=0u32;
    for prize in prizes {match prize {Prize::Material{material_id,count}=>*materials.entry(material_id.clone()).or_default()+=count,Prize::Tag{count}=>tags+=count}}
    for (id,count) in materials {
        if tx.execute("UPDATE material_stock SET count=count-?2 WHERE material_id=?1 AND count>=?2",params![id,count])?!=1 {return Err(invalid("not_enough_material"));}
    }
    let owned:i64=tx.query_row("SELECT value FROM meta WHERE key=?1",[crate::link_tag::OWNED_KEY],|r|r.get::<_,String>(0)).optional()?.unwrap_or_else(||"0".into()).parse().map_err(|_|invalid("Damaged tag stock."))?;
    let attached:i64=tx.query_row("SELECT COUNT(*) FROM link_tags",[],|r|r.get(0))?;
    if owned-attached<i64::from(tags){return Err(invalid("not_enough_tags"));}
    if tags>0 {tx.execute("UPDATE meta SET value=?2 WHERE key=?1",params![crate::link_tag::OWNED_KEY,(owned-i64::from(tags)).to_string()])?;}
    for (item,snapshot) in h.items.iter().zip(&snapshots) {
        let live:(String,String,bool)=tx.query_row("SELECT state,rendered_asset_path,pressed FROM stickers WHERE id=?1",[&item.key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
        if live.0!="held"||live.1!=snapshot.rendered_asset_path {return Err(invalid("Sticker changed while pressing."));}
        if live.2 {return Err(invalid("already_pressed"));}
        if item.minted {for chain in &item.histories {referee.register(&chain.creation.sticker_id,chain.creation.creator_sig.as_deref().unwrap())?;referee.release(chain.transfers.last().unwrap())?;}tx.execute("UPDATE stickers SET pressed=1 WHERE id=?1",[&item.key])?;}
        else {
            let chain=&item.histories[0];let release=chain.transfers.last().unwrap();let count:u32=tx.query_row("SELECT COUNT(*) FROM transfers WHERE sticker_id=?1",[&item.key],|r|r.get(0))?;
            if count!=release.seq {return Err(invalid("Sticker history changed while pressing."));}
            referee.release(release)?;o::store_creation(&tx,&chain.creation)?;o::store_transfer(&tx,release)?;o::release_local(&tx,&item.key)?;
        }
    }
    tx.execute("INSERT INTO packs_made VALUES (?1,?2,?3,?4)",params![h.pack_id,h.title,h.version,h.made_at])?;
    tx.execute("INSERT INTO meta VALUES (?1,'1')",[format!("export.{}",h.pack_id)])?;
    let id=if shelf {install_in(&tx,&verified,&paths,&own)?}else{creator_pack::internal_id(&h)?};
    persist(&h,&bytes)?;tx.commit()?;Ok(id)
}
pub fn is_v2(db:&Database,id:&str)->Result<bool> {Ok(db.conn.query_row("SELECT EXISTS(SELECT 1 FROM edition_pack_frames WHERE pack_id=?1)",[id],|r|r.get(0))?)}
pub fn ensure_can_open(lib:&Library,id:&str)->Result<()> {
    let public:Option<String>=lib.db().conn.query_row("SELECT public_key FROM pack_distributions WHERE pack_id=?1",[id],|r|r.get(0)).optional()?.flatten();
    if let Some(public)=public {if public==sign::public_key(&crate::device_key::load_or_create(lib.root())?) {return Err(invalid("your_own_pack"));}}Ok(())
}
pub fn pick(db:&Database,id:&str,roll:f64)->Result<Option<(i64,String)>> {
    if !roll.is_finite(){return Err(invalid("Invalid draw."));}let mut stmt=db.conn.prepare("SELECT id,item_key FROM pack_items WHERE pack_id=?1 AND opened_at IS NULL ORDER BY id")?;
    let rows=stmt.query_map([id],|r|Ok((r.get(0)?,r.get(1)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
    if rows.is_empty(){return Ok(None);}Ok(Some(rows[((roll.clamp(0.0,0.999999)*rows.len() as f64) as usize).min(rows.len()-1)].clone()))
}
pub fn peek(db:&Database,id:&str)->Result<Vec<(i64,String,String,String)>> {
    let mut stmt=db.conn.prepare("SELECT MIN(i.id),s.name,s.png_path,s.material_id FROM pack_items i JOIN signed_pack_items s ON s.item_id=i.id WHERE i.pack_id=?1 AND s.kind='sticker' AND i.opened_at IS NULL GROUP BY i.item_key ORDER BY COUNT(*) DESC,MIN(i.id) LIMIT 3")?;
    let rows=stmt.query_map([id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;Ok(rows)
}
#[derive(Serialize,Debug)]
#[serde(rename_all="camelCase")]
pub struct Award {pub kind:String,pub sticker_id:Option<String>,pub material_id:Option<String>,pub name:String,pub rarity:String,pub remaining:i64}
/// Claim one finite slot and its award, receipt and optional print in a single transaction.
pub fn open(lib:&mut Library,id:&str,roll:f64,free:bool,date:&str,queue:bool,referee:&dyn Referee)->Result<Award> {
    ensure_can_open(lib,id)?;if !is_v2(lib.db(),id)?{return Err(invalid("Not an edition pack."));}
    let (row,_)=pick(lib.db(),id,roll)?.ok_or_else(||invalid("pack_empty"))?;
    let metadata=crate::pack::stored_item(lib.db(),row)?.ok_or_else(||invalid("Missing slot."))?;
    let (kind,prize,slot,saved):(String,Option<String>,u32,Option<String>)=lib.db().conn.query_row("SELECT s.kind,s.prize_ref,e.slot_no,e.chain FROM signed_pack_items s JOIN edition_pack_slots e ON e.item_id=s.item_id WHERE s.item_id=?1",[row],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
    let header:String=lib.db().conn.query_row("SELECT header FROM edition_pack_frames WHERE pack_id=?1",[id],|r|r.get(0))?;let h:Header=serde_json::from_str(&header).map_err(|_|invalid("Damaged pack record."))?;
    let key=crate::device_key::load_or_create(lib.root())?;let own=sign::public_key(&key);
    let chain=if kind=="sticker" {let png=lib.read_asset(&metadata.png_path)?;let mut chain:Chain=serde_json::from_str(saved.as_deref().ok_or_else(||invalid("Missing edition proof."))?).map_err(|_|invalid("Damaged edition proof."))?;o::sticker_chain_verify(&chain,&png)?;o::append(&mut chain,"claim",&slot_ref(&h.pack_id,slot),&key)?;o::sticker_chain_verify(&chain,&png)?;Some(chain)}else{None};
    let tx=lib.db_mut().conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if !tx.query_row("SELECT EXISTS(SELECT 1 FROM pack_items WHERE id=?1 AND pack_id=?2 AND opened_at IS NULL)",params![row,id],|r|r.get::<_,bool>(0))? {return Err(invalid("That slot was already opened."));}
    if free {let (opened,claimed)=Database::pack_reward_counts(&tx,id)?;if opened/crate::pack::FREE_OPENING_EVERY<=claimed{return Err(invalid("No free opening is ready for this pack."));}}
    referee.claim_slot(&h.pack_id,slot,&own)?;
    let mut sticker_id=None;
    if let Some(chain)=chain {
        referee.claim(chain.transfers.last().unwrap())?;let c=&chain.creation;let state:Option<String>=tx.query_row("SELECT state FROM stickers WHERE id=?1",[&c.sticker_id],|r|r.get(0)).optional()?;
        if state.as_deref()==Some("held"){return Err(invalid("This real sticker is already held here."));}
        if state.is_some() {
            let record:Option<String>=tx.query_row("SELECT creation_record FROM stickers WHERE id=?1",[&c.sticker_id],|r|r.get(0))?;
            if record.as_deref().and_then(|s|serde_json::from_str::<o::Creation>(s).ok()).as_ref()!=Some(c) {return Err(invalid("Incoming edition does not match the previous origin."));}
            let previous=o::stored_transfers(&tx,&c.sticker_id)?;if !chain.transfers.starts_with(&previous){return Err(invalid("Incoming edition does not extend the holder history."));}
            tx.execute("UPDATE stickers SET state='held' WHERE id=?1",[&c.sticker_id])?;
        }else{
            tx.execute("INSERT INTO stickers(id,creator_id,creator_name,created_at,original_asset_path,rendered_asset_path,mask_asset_path,material_id,source_type,aspect,edition_number,edition_total,title) VALUES (?1,?2,?3,?4,?5,?5,?6,?7,'pack',?8,?9,?10,?11)",params![c.sticker_id,c.creator_public_key,c.creator_name,c.created_at,metadata.png_path,metadata.mask_path,metadata.material_id,metadata.aspect,c.edition_no,c.edition_total,metadata.name])?;
            o::provenance(&tx,&c.sticker_id,"created",c.creator_public_key.as_deref(),&c.created_at)?;
        }
        o::store_creation(&tx,c)?;let previous=o::stored_transfers(&tx,&c.sticker_id)?.len();for transfer in chain.transfers.iter().skip(previous){o::store_transfer(&tx,transfer)?;}
        o::provenance(&tx,&c.sticker_id,"pack_opened",Some(&h.title),&now())?;
        if queue {crate::daily::ensure_today_in(&tx,date,crate::ids::random_unit())?;Database::confirm_in(&tx,date,&c.sticker_id,SourceType::Pack,&now())?;}else{tx.execute("INSERT INTO sticker_events(date,sticker_id,source_type) VALUES (?1,?2,'pack') ON CONFLICT DO NOTHING",params![date,c.sticker_id])?;}
        sticker_id=Some(c.sticker_id.clone());
    }else if kind=="material" {
        let material=prize.as_deref().ok_or_else(||invalid("Missing material prize."))?;
        tx.execute("INSERT INTO material_stock VALUES (?1,1) ON CONFLICT(material_id) DO UPDATE SET count=count+1",[material])?;
        tx.execute("INSERT OR IGNORE INTO material_unlocks VALUES (?1,?2)",params![material,now()])?;
    }else if kind=="tag" {
        tx.execute("INSERT INTO meta VALUES (?1,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1",[crate::link_tag::OWNED_KEY])?;
    }else{return Err(invalid("Unknown prize kind."));}
    tx.execute("UPDATE pack_items SET opened_at=?2,sticker_id=?3 WHERE id=?1",params![row,now(),sticker_id])?;
    if free {tx.execute("INSERT INTO meta VALUES (?1,?2)",params![format!("pack.free_item.{row}"),id])?;}
    let remaining=tx.query_row("SELECT COUNT(*) FROM pack_items WHERE pack_id=?1 AND opened_at IS NULL",[id],|r|r.get(0))?;tx.commit()?;
    Ok(Award{kind,sticker_id,material_id:prize,name:metadata.name,rarity:metadata.rarity,remaining})
}

#[cfg(test)] mod tests {
    use super::*;
    fn lib()->Library {Library::open(&std::env::temp_dir().join(crate::ids::new_gift_id())).unwrap()}
    fn fixture(n:usize,copies:u32)->(Library,Vec<Selection>) {
        let mut lib=lib();lib.db_mut().set_display_name("Maker").unwrap();let mut selections=Vec::new();
        let mut image=image::RgbaImage::new(24,20);for y in 3..17 {for x in 3..21 {image.put_pixel(x,y,image::Rgba([100,80,40,255]));}}
        let mut png=Vec::new();image.write_to(&mut std::io::Cursor::new(&mut png),image::ImageFormat::Png).unwrap();let rendered=crate::pack::render_pack_sticker(&png).unwrap();
        for no in 0..n {let s=lib.add_made(&rendered,b"source","png",None,"kraft").unwrap();selections.push(Selection{sticker_id:s.id,name:format!("Design {no}"),copies});}
        (lib,selections)
    }
    fn export(lib:&mut Library,selection:&[Selection],prizes:&[Prize])->Vec<u8> {let mut bytes=Vec::new();press(lib,"Editions","kraft",selection,prizes,&Dress::default(),false,&o::NoReferee,|_,b|{bytes=b.to_vec();Ok(())}).unwrap();bytes}
    #[test] fn a_commit_failure_restores_the_external_file_and_press_inventory() {
        let (mut mine,selection)=fixture(3,1);let path=mine.root().join("output.peta");std::fs::write(&path,b"previous file").unwrap();let root=mine.root().to_owned();
        mine.db().conn.execute_batch("CREATE TABLE failed_export(id TEXT REFERENCES stickers(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER fail_commit AFTER INSERT ON packs_made BEGIN INSERT INTO failed_export VALUES ('missing'); END;").unwrap();
        let mut publication=None;
        let result=press(&mut mine,"Export","kraft",&selection,&[],&Dress::default(),false,&o::NoReferee,|h,bytes|{publication=Some(crate::export::Export::publish(&root,&path,bytes,&h.pack_id)?);Ok(())});
        assert!(result.is_err());drop(publication);
        assert_eq!(std::fs::read(path).unwrap(),b"previous file");assert!(!mine.db().sticker(&selection[0].sticker_id).unwrap().unwrap().pressed);
        assert_eq!(mine.db().conn.query_row("SELECT COUNT(*) FROM packs_made",[],|r|r.get::<_,u32>(0)).unwrap(),0);
    }
    #[test] fn signatures_and_validation_bind_counts_prizes_and_numbered_proofs() {
        let (mine,selection)=fixture(3,2);let (_,bytes)=build(&mine,"Editions","kraft",&selection,&[Prize::Tag{count:2}],&Dress::default()).unwrap();assert_eq!(bytes[8],2);
        for needle in [b"\"copies\":2".as_slice(),b"\"count\":2".as_slice(),b"\"editionNo\":1".as_slice()] {let mut bad=bytes.clone();let at=bad.windows(needle.len()).position(|s|s==needle).unwrap()+needle.len()-1;bad[at]=b'3';assert!(creator_pack::decode(&bad).is_err());}
        for copies in [0,31] {let mut bad=selection.clone();bad[0].copies=copies;assert!(build(&mine,"Bad","kraft",&bad,&[],&Dress::default()).is_err());}
        for prizes in [vec![Prize::Tag{count:11}],vec![Prize::Tag{count:0}],vec![Prize::Material{material_id:"unknown".into(),count:1}]] {assert!(build(&mine,"Bad","kraft",&selection,&prizes,&Dress::default()).is_err());}
        let (mine,mut huge)=fixture(7,30);huge[6].copies=21;assert!(build(&mine,"Too many","kraft",&huge,&[],&Dress::default()).is_err());
        huge[6].copies=20;let (_,max)=build(&mine,"Maximum","kraft",&huge,&[],&Dress::default()).unwrap();assert_eq!(slots(creator_pack::decode(&max).unwrap().header()),200);
    }
    #[test] fn pressing_and_claiming_finite_slots_share_images_and_preserve_origins() {
        let (mut mine,selection)=fixture(3,2);let copy=mine.db_mut().seed_legacy_copies(&selection[0].sticker_id,1).unwrap().remove(0);
        mine.db_mut().add_material("kraft",4).unwrap();mine.db_mut().link_tag_add_stock(2).unwrap();
        let bytes=export(&mut mine,&selection,&[Prize::Material{material_id:"kraft".into(),count:2},Prize::Tag{count:1}]);
        assert_eq!(mine.db().material_count("kraft").unwrap(),2);assert_eq!(mine.db().link_tag_stock().unwrap().owned,1);
        assert_eq!(mine.db().sticker_count().unwrap(),4);assert!(mine.db().sticker(&copy.id).unwrap().is_some());
        for item in &selection {assert!(mine.db().sticker(&item.sticker_id).unwrap().unwrap().pressed);}
        assert!(matches!(build(&mine,"Another title","kraft",&selection,&[],&Dress::default()),Err(crate::Error::Invalid(e)) if e=="already_pressed"));
        let package=creator_pack::decode(&bytes).unwrap();let own_id=install(&mut mine,&package).unwrap();assert!(matches!(open(&mut mine,&own_id,0.0,false,"2026-10-11",false,&o::NoReferee),Err(crate::Error::Invalid(e)) if e=="your_own_pack"));
        let mut friend=lib();let id=install(&mut friend,&package).unwrap();assert_eq!(friend.db().packs().unwrap()[0].remaining,9);assert!(install(&mut friend,&package).is_err());
        let image_paths:u32=friend.db().conn.query_row("SELECT COUNT(DISTINCT png_path) FROM signed_pack_items WHERE kind='sticker'",[],|r|r.get(0)).unwrap();assert_eq!(image_paths,3);
        let mut ids=std::collections::HashSet::new();let mut editions=std::collections::BTreeMap::new();let mut prizes=0;
        for left in (0..9).rev() {let awarded=open(&mut friend,&id,0.0,false,"2026-10-11",false,&o::NoReferee).unwrap();assert_eq!(awarded.remaining,left);
            if let Some(sticker)=awarded.sticker_id {assert!(ids.insert(sticker.clone()));let s=friend.db().sticker(&sticker).unwrap().unwrap();assert_eq!(s.source_type,SourceType::Pack);assert_eq!(s.edition_total,Some(2));assert!(s.verified);assert!(!s.edition_verified);assert_eq!(s.lineage,"real");
                let key=crate::device_key::load_or_create(friend.root()).unwrap();let chain=o::chain_for(friend.db(),&s,&friend.read_rendered(&s.id).unwrap(),&key).unwrap();assert_eq!(chain.transfers.len(),2);
                *editions.entry(s.edition_number.unwrap()).or_insert(0)+=1;
            }else{prizes+=1;}
        }
        assert_eq!(ids.len(),6);assert_eq!(editions.get(&1),Some(&3));assert_eq!(editions.get(&2),Some(&3));assert_eq!(prizes,3);
        assert_eq!(friend.db().material_count("kraft").unwrap(),2);assert_eq!(friend.db().link_tag_stock().unwrap().owned,1);assert!(open(&mut friend,&id,0.5,false,"2026-10-11",false,&o::NoReferee).is_err());
        assert_eq!(friend.db().packs().unwrap()[0].total,9);
        // An edition keeps its proof and total when gifted onward.
        let sticker=ids.into_iter().next().unwrap();let (gift,file)=crate::gift::build_gift(&mut friend,&sticker,"Next",None).unwrap();let mut next=lib();crate::gift::receive_gift(&mut next,&file).unwrap();let forwarded=crate::gift::open_gift(&mut next,&gift).unwrap();assert_eq!(forwarded.edition_total,Some(2));
    }
    struct RejectSlot;
    impl Referee for RejectSlot {fn register(&self,_:&str,_:&str)->Result<()>{Ok(())}fn release(&self,_:&o::Transfer)->Result<()>{Ok(())}fn claim(&self,_:&o::Transfer)->Result<()>{Ok(())}fn claim_slot(&self,_:&str,_:u32,_:&str)->Result<()>{Err(invalid("slot refused"))}}
    #[test] fn press_and_award_failures_roll_back_every_resource_and_receipt() {
        let (mut mine,selection)=fixture(3,2);mine.db_mut().add_material("kraft",2).unwrap();mine.db_mut().link_tag_add_stock(1).unwrap();let prizes=[Prize::Material{material_id:"kraft".into(),count:1},Prize::Tag{count:1}];
        assert!(press(&mut mine,"Editions","kraft",&selection,&prizes,&Dress::default(),true,&o::NoReferee,|_,_|Err(invalid("disk full"))).is_err());
        assert_eq!(mine.db().material_count("kraft").unwrap(),2);assert_eq!(mine.db().link_tag_stock().unwrap().owned,1);assert!(mine.db().packs().unwrap().is_empty());assert!(!mine.db().sticker(&selection[0].sticker_id).unwrap().unwrap().pressed);
        let bytes=export(&mut mine,&selection,&prizes);let mut friend=lib();let id=install(&mut friend,&creator_pack::decode(&bytes).unwrap()).unwrap();
        assert!(open(&mut friend,&id,0.99,false,"2026-10-11",false,&RejectSlot).is_err());assert_eq!(friend.db().link_tag_stock().unwrap().owned,0);assert_eq!(friend.db().packs().unwrap()[0].remaining,8);
        assert!(open(&mut friend,&id,0.0,false,"2026-10-11",true,&RejectSlot).is_err());
        assert!(friend.db().daily_get("2026-10-11").unwrap().is_none());
        assert!(friend.db().next_print().unwrap().is_none());
        friend.db().conn.execute_batch("CREATE TRIGGER fail_award BEFORE UPDATE ON pack_items BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
        for roll in [0.0,0.8,0.99] {assert!(open(&mut friend,&id,roll,false,"2026-10-11",true,&o::NoReferee).is_err());}
        assert!(friend.db().daily_get("2026-10-11").unwrap().is_none());assert!(friend.db().next_print().unwrap().is_none());
        assert_eq!(friend.db().sticker_count().unwrap(),0);assert_eq!(friend.db().material_count("kraft").unwrap(),0);assert_eq!(friend.db().link_tag_stock().unwrap().owned,0);assert_eq!(friend.db().packs().unwrap()[0].remaining,8);
    }
    #[test] fn copies_foreign_multiplication_and_attached_prizes_are_rejected() {
        let (mut mine,mut selection)=fixture(3,1);let copy=mine.db_mut().seed_legacy_copies(&selection[0].sticker_id,1).unwrap().remove(0);let original=selection[0].sticker_id.clone();selection[0].sticker_id=copy.id;
        assert!(matches!(build(&mine,"Copies","kraft",&selection,&[],&Dress::default()),Err(crate::Error::Invalid(e)) if e=="copies_stay_home"));selection[0].sticker_id=original.clone();
        mine.db_mut().link_tag_add_stock(1).unwrap();mine.db_mut().link_tag_attach(&original,"website","https://example.com","Site",true).unwrap();
        assert!(press(&mut mine,"Prizes","kraft",&selection,&[Prize::Tag{count:1}],&Dress::default(),false,&o::NoReferee,|_,_|Ok(())).is_err());
        assert!(matches!(press(&mut mine,"Materials","kraft",&selection,&[Prize::Material{material_id:"gold".into(),count:1}],&Dress::default(),false,&o::NoReferee,|_,_|Ok(())),Err(crate::Error::Invalid(e)) if e=="not_enough_material"));
        let (mut author,other)=fixture(3,1);let (gift,file)=crate::gift::build_gift(&mut author,&other[0].sticker_id,"Maker",None).unwrap();crate::gift::receive_gift(&mut mine,&file).unwrap();let foreign=crate::gift::open_gift(&mut mine,&gift).unwrap();
        let foreign_copy=mine.db_mut().seed_legacy_copies(&foreign.id,1).unwrap().remove(0);selection[0].sticker_id=foreign.id.clone();selection[0].copies=2;
        assert!(build(&mine,"Foreign","kraft",&selection,&[],&Dress::default()).is_err());selection[0].copies=1;
        press(&mut mine,"Foreign","kraft",&selection,&[],&Dress::default(),true,&o::NoReferee,|_,_|Ok(())).unwrap();
        assert_eq!(mine.db().sticker(&foreign.id).unwrap().unwrap().state,"gone");assert!(mine.db().sticker(&foreign_copy.id).unwrap().is_none());
    }
    #[test] fn draws_are_uniform_reproducible_and_free_openings_consume_a_real_slot() {
        let (mut mine,selection)=fixture(3,5);let bytes=export(&mut mine,&selection,&[]);let mut friend=lib();let id=install(&mut friend,&creator_pack::decode(&bytes).unwrap()).unwrap();
        let first=pick(friend.db(),&id,0.0).unwrap().unwrap();assert_eq!(first,pick(friend.db(),&id,0.0).unwrap().unwrap());
        let mut choices=std::collections::HashSet::new();for i in 0..15 {choices.insert(pick(friend.db(),&id,(i as f64+0.5)/15.0).unwrap().unwrap().0);}assert_eq!(choices.len(),15);
        for _ in 0..10 {open(&mut friend,&id,0.0,false,"2026-10-11",false,&o::NoReferee).unwrap();}assert_eq!(friend.db().pack_free_openings(&id).unwrap(),1);
        open(&mut friend,&id,0.0,true,"2026-10-11",true,&o::NoReferee).unwrap();assert_eq!(friend.db().packs().unwrap()[0].remaining,4);assert_eq!(friend.db().packs().unwrap()[0].total,15);assert_eq!(friend.db().pack_free_openings(&id).unwrap(),0);assert!(friend.db().next_print().unwrap().is_some());
    }
}
