//! Official distributions are local and once per database. Clocks are trusted; codes can be
//! used on another device. Revocation only blocks future application, never undoes a receipt.
use chrono::{DateTime,Utc};
use ed25519_dalek::{SigningKey,VerifyingKey};
use rusqlite::{params,OptionalExtension};
use serde::{Deserialize,Serialize};
use crate::{db::now,error::{Error,Result},library::Library,materials,sign::{self,Signer}};
pub const MAGIC: &[u8;8]=b"PETAEVNT";
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Attachment {pub key:String,pub png_len:usize,#[serde(default)] pub mask_len:usize}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Event {
    pub event_id:String,pub kind:String,pub issued_at:String,
    pub not_before:Option<String>,pub not_after:Option<String>,pub title:String,pub message:String,
    pub payload:serde_json::Value,pub signer:Signer,#[serde(default)] pub attachments:Vec<Attachment>,
}
pub struct Verified {header:Event,attachments:Vec<(Attachment,Vec<u8>,Vec<u8>)>,bytes:Vec<u8>}
impl Verified {pub fn header(&self)->&Event {&self.header} pub(crate) fn attachments(&self)->&[(Attachment,Vec<u8>,Vec<u8>)] {&self.attachments}}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Receipt {pub event_id:String,pub kind:String,pub title:String,pub message:String,pub result:String}
pub fn invalid(text:&str)->Error {Error::Invalid(text.into())}
pub fn safe_id(id:&str)->bool {id.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric) && id.len()<=80 && id.bytes().all(|b|b.is_ascii_alphanumeric() || b"-_.".contains(&b))}
pub fn text(value:&str,max:usize)->bool {!value.trim().is_empty() && value.chars().count()<=max && !value.chars().any(char::is_control)}
/// Bound decoded dimensions too: a small compressed PNG must not allocate arbitrary memory.
pub fn validate_png(bytes:&[u8],limit:usize)->Result<()> {
    use image::{ImageDecoder,ImageFormat,ImageReader,Limits};
    if bytes.is_empty() || bytes.len()>limit {return Err(invalid("This picture is too large or empty."));}
    let mut reader=ImageReader::with_format(std::io::Cursor::new(bytes),ImageFormat::Png);
    let mut limits=Limits::default();limits.max_image_width=Some(4096);limits.max_image_height=Some(4096);limits.max_alloc=Some(64*1024*1024);reader.limits(limits);
    let mut decoder=reader.into_decoder().map_err(|_|invalid("This picture is not a valid PNG."))?;
    let mut limits=Limits::default();limits.max_image_width=Some(4096);limits.max_image_height=Some(4096);limits.max_alloc=Some(64*1024*1024);
    decoder.set_limits(limits).map_err(|_|invalid("This picture has unreasonable dimensions."))?;
    image::DynamicImage::from_decoder(decoder).map_err(|_|invalid("This picture is damaged."))?;Ok(())
}
pub fn encode(event:&Event,body:&[u8],key:&SigningKey)->Result<Vec<u8>> {sign::seal(MAGIC,1,event,body,key)}
pub fn decode_with(bytes:&[u8],trust:impl FnOnce(&Signer)->Result<VerifyingKey>)->Result<Verified> {
    let (header,body)=sign::unseal_with(bytes,MAGIC,1,trust)?;
    let header:Event=serde_json::from_value(header).map_err(|_|invalid("This event has a damaged header."))?;
    if !matches!(header.signer,Signer::Official{..}) {return Err(invalid("Only Peta can issue an official event."));}
    if !safe_id(&header.event_id) || !text(&header.title,120) || header.message.chars().count()>1000 || header.attachments.len()>24 {return Err(invalid("This event has an invalid header."));}
    DateTime::parse_from_rfc3339(&header.issued_at).map_err(|_|invalid("This event has an invalid issue date."))?;
    let mut rest=body;let mut attachments=Vec::new();let mut keys=std::collections::HashSet::new();
    for a in &header.attachments {
        if !safe_id(&a.key) || !keys.insert(&a.key) || a.png_len==0 || a.png_len>8*1024*1024 || a.mask_len>8*1024*1024 {return Err(invalid("This event has invalid attachments."));}
        let n=a.png_len.checked_add(a.mask_len).ok_or_else(||invalid("Invalid attachment length."))?;
        if rest.len()<n {return Err(invalid("This file is truncated."));}
        let (part,tail)=rest.split_at(n);rest=tail;let (png,mask)=part.split_at(a.png_len);
        validate_png(png,8*1024*1024)?;if !mask.is_empty(){validate_png(mask,8*1024*1024)?;}
        attachments.push((a.clone(),png.to_vec(),mask.to_vec()));
    }
    if !rest.is_empty() {return Err(invalid("This file has unexpected attachments."));}
    Ok(Verified{header,attachments,bytes:bytes.to_vec()})
}
pub fn decode(bytes:&[u8])->Result<Verified> {decode_with(bytes,sign::resolve)}
fn count(e:&Event,max:i64)->Result<i64> {let n=e.payload["count"].as_i64().unwrap_or(0);if !(1..=max).contains(&n){return Err(invalid("This event grants too many items."));}Ok(n)}
fn period(e:&Event,time:DateTime<Utc>)->Result<()> {
    for (bound,before) in [(&e.not_before,true),(&e.not_after,false)] {if let Some(v)=bound {
        let date=DateTime::parse_from_rfc3339(v).map_err(|_|invalid("This event has an invalid date."))?.with_timezone(&Utc);
        if (before && time<date) || (!before && time>=date) {return Err(invalid(if before {"This event is not available yet."} else {"This event has expired."}));}
    }}Ok(())
}
pub fn apply_event(lib:&mut Library,verified:&Verified,source:&str,time:DateTime<Utc>)->Result<Receipt> {
    let e=&verified.header;period(e,time)?;
    let conn=&lib.db().conn;
    if conn.query_row("SELECT 1 FROM applied_events WHERE event_id=?1",[&e.event_id],|_|Ok(())).optional()?.is_some(){return Err(invalid("This event was already received."));}
    if conn.query_row("SELECT 1 FROM revoked_events WHERE event_id=?1",[&e.event_id],|_|Ok(())).optional()?.is_some(){return Err(invalid("This event is no longer available."));}
    use sha2::{Digest,Sha256};
    let content_id=Sha256::digest(&verified.bytes).iter().map(|b|format!("{b:02x}")).collect::<String>();
    let mut paths=Vec::new();let result:String;
    match e.kind.as_str() {
        "extra_envelope"=>{count(e,3)?;result=format!("{} extra envelope(s) arrived.",count(e,3)?);},
        "grant_material"=>{count(e,10)?;let id=e.payload["materialId"].as_str().unwrap_or("");let m=materials::get(id).filter(|m|!m.unlimited).ok_or_else(||invalid("This material is not supported."))?;result=format!("{} ×{} arrived.",m.name,count(e,10)?);},
        "revoke"=>{if !safe_id(e.payload["eventId"].as_str().unwrap_or("")){return Err(invalid("Invalid revoked event ID."));}result="This event notice was saved.".into();},
        "grant_pack"=>{
            let id=e.payload["packId"].as_str().unwrap_or("");let title=e.payload["title"].as_str().unwrap_or("");let author=e.payload["author"].as_str().unwrap_or("");
            let items=e.payload["items"].as_array().ok_or_else(||invalid("This pack has no items."))?;
            if !safe_id(id) || !text(title,40) || !text(author,40) || !["kraft","matte","holo"].contains(&e.payload["pouch"].as_str().unwrap_or("")) || items.is_empty() || items.len()>24 || items.len()!=verified.attachments.len(){return Err(invalid("This pack has invalid details."));}
            for (i,(a,png,_)) in items.iter().zip(&verified.attachments){
                if i["key"].as_str()!=Some(&a.key) || !text(i["name"].as_str().unwrap_or(""),40) || !["common","uncommon","rare"].contains(&i["rarity"].as_str().unwrap_or("")) || a.mask_len!=0 {return Err(invalid("This pack has invalid items."));}
                let rel=format!("events/{content_id}/{}.png",a.key);lib.write_asset(&rel,png)?;paths.push(rel);
            }
            result=format!("{title} arrived on your shelf.");
        },
        "grant_sticker"=>{if verified.attachments.len()!=1 {return Err(invalid("A sticker event must contain one picture."));}let rel=format!("events/{content_id}.peta");lib.write_asset(&rel,&verified.bytes)?;paths.push(rel);result="A sealed gift from Peta arrived.".into();},
        _=>return Err(invalid("This event needs a newer Peta. Please update.")),
    }
    if !["grant_pack","grant_sticker"].contains(&e.kind.as_str()) && !verified.attachments.is_empty(){return Err(invalid("This event must not have attachments."));}
    let tx=lib.db_mut().conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if tx.query_row("SELECT 1 FROM applied_events WHERE event_id=?1",[&e.event_id],|_|Ok(())).optional()?.is_some(){return Err(invalid("This event was already received."));}
    if tx.query_row("SELECT 1 FROM revoked_events WHERE event_id=?1",[&e.event_id],|_|Ok(())).optional()?.is_some(){return Err(invalid("This event is no longer available."));}
    match e.kind.as_str() {
        "extra_envelope"=>{tx.execute("UPDATE meta SET value=CAST(value AS INTEGER)+?1 WHERE key='bonus_envelopes'",[count(e,3)?])?;},
        "grant_material"=>{let id=e.payload["materialId"].as_str().unwrap();tx.execute("INSERT OR IGNORE INTO material_unlocks VALUES (?1,?2)",params![id,now()])?;tx.execute("INSERT INTO material_stock VALUES (?1,?2) ON CONFLICT(material_id) DO UPDATE SET count=count+excluded.count",params![id,count(e,10)?])?;},
        "revoke"=>{tx.execute("INSERT OR IGNORE INTO revoked_events VALUES (?1,?2)",params![e.payload["eventId"].as_str().unwrap(),now()])?;},
        "grant_sticker"=>{
            let id=format!("GIFT-E-{}",e.event_id);tx.execute("INSERT INTO gifts_received(gift_id,from_name,note,sent_at,received_at,package) VALUES (?1,'Peta',?2,?3,?4,?5)",params![id,e.message,e.issued_at,now(),paths[0]])?;
            tx.execute("INSERT INTO gift_signers(gift_id,status) VALUES (?1,'official')",[id])?;
        },
        "grant_pack"=>{
            let id=format!("official:{}",e.payload["packId"].as_str().unwrap());
            tx.execute("INSERT INTO packs VALUES (?1,?2,?3,?4)",params![id,e.payload["title"].as_str().unwrap(),e.payload["author"].as_str().unwrap(),now()])?;
            tx.execute("INSERT INTO pack_distributions VALUES (?1,?2,1,NULL,NULL,'official',?3)",params![id,e.payload["packId"].as_str().unwrap(),e.payload["pouch"].as_str().unwrap()])?;
            for ((i,(a,_,_)),path) in e.payload["items"].as_array().unwrap().iter().zip(&verified.attachments).zip(paths.iter()) {
                tx.execute("INSERT INTO pack_items(pack_id,item_key) VALUES (?1,?2)",params![id,a.key])?;
                tx.execute("INSERT INTO signed_pack_items VALUES (?1,?2,NULL,'matte',1,?3,?4,0)",params![tx.last_insert_rowid(),path,i["name"].as_str().unwrap(),i["rarity"].as_str().unwrap()])?;
            }
        },_=>unreachable!(),
    }
    tx.execute("INSERT INTO meta(key,value) VALUES (?1,?2)",params![format!("event.receipt.{}",e.event_id),serde_json::to_string(&Receipt{event_id:e.event_id.clone(),kind:e.kind.clone(),title:e.title.clone(),message:e.message.clone(),result:result.clone()}).map_err(|e|invalid(&e.to_string()))?])?;
    tx.execute("INSERT INTO applied_events VALUES (?1,?2,?3,?4)",params![e.event_id,e.kind,now(),source])?;tx.commit()?;
    Ok(Receipt{event_id:e.event_id.clone(),kind:e.kind.clone(),title:e.title.clone(),message:e.message.clone(),result})
}

// Compact codes use an append-only official-key slot and UTC day + seconds fields. The
// 64-byte signature alone needs 103 Base32 characters; a complete grouped code is longer
// than the suggested 130-character target. No authenticated ID, date or payload is omitted.
const ALPHABET:&[u8;32]=b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_MATERIALS:&[&str]=&["kraft","holographic","gold","riso","vintage","clear","pixel","washi","sakura"];
fn base32(bytes:&[u8])->String {
    let mut out=String::new();let mut bits=0u32;let mut n=0;
    for b in bytes {bits=(bits<<8)|*b as u32;n+=8;while n>=5{n-=5;out.push(ALPHABET[((bits>>n)&31) as usize] as char);}}
    if n>0{out.push(ALPHABET[((bits<<(5-n))&31) as usize] as char);}out
}
fn unbase32(value:&str)->Result<Vec<u8>> {
    let mut out=Vec::new();let mut bits=0u32;let mut n=0;
    for b in value.bytes(){let i=ALPHABET.iter().position(|v|*v==b).ok_or_else(||invalid("This code has an invalid character."))?;bits=(bits<<5)|i as u32;n+=5;if n>=8{n-=8;out.push((bits>>n) as u8);}}
    if n>0 && (bits & ((1<<n)-1))!=0 {return Err(invalid("This code is damaged."));}Ok(out)
}
fn code_date(value:&str)->Result<[u8;6]> {
    let t=DateTime::parse_from_rfc3339(value).map_err(|_|invalid("Invalid code date."))?.timestamp();
    let days=u16::try_from(t.div_euclid(86400)-18262).map_err(|_|invalid("Code dates must be between 2020 and 2199."))?;
    let mut out=[0;6];out[..2].copy_from_slice(&days.to_be_bytes());out[2..].copy_from_slice(&(t.rem_euclid(86400) as u32).to_be_bytes());Ok(out)
}
fn read_code_date(bytes:&[u8])->Result<String> {
    let days=u16::from_be_bytes(bytes[..2].try_into().unwrap()) as i64+18262;let seconds=u32::from_be_bytes(bytes[2..].try_into().unwrap());
    if seconds>=86400 {return Err(invalid("Invalid code date."));}
    Ok(DateTime::from_timestamp(days*86400+seconds as i64,0).ok_or_else(||invalid("Invalid code date."))?.to_rfc3339())
}
pub fn as_code(event:&Event,key:&SigningKey)->Result<String> {
    let Signer::Official{key_id}=&event.signer else{return Err(invalid("Codes must be issued by Peta."));};
    let slot=crate::official_keys::KEYS.iter().position(|(id,_)|*id==key_id).ok_or_else(||invalid("Unknown official key ID."))?;
    if !event.attachments.is_empty() || event.event_id.len()>16 || !safe_id(&event.event_id){return Err(invalid("Codes need a short event ID (up to 16 bytes) and no pictures."));}
    let kind=match event.kind.as_str(){"extra_envelope"=>1,"grant_material"=>2,"revoke"=>3,_=>return Err(invalid("This event can only be sent as a file."))};
    let mut bytes=vec![1,kind,slot as u8,event.event_id.len() as u8];let mut id=[0;16];id[..event.event_id.len()].copy_from_slice(event.event_id.as_bytes());bytes.extend_from_slice(&id);
    let mut payload=[0;18];
    if kind==3{let target=event.payload["eventId"].as_str().unwrap_or("");if !safe_id(target) || target.len()>16{return Err(invalid("Revoked code IDs must be up to 16 bytes."));}payload[0]=target.len() as u8;payload[1..1+target.len()].copy_from_slice(target.as_bytes());}
    else {payload[0]=count(event,if kind==1{3}else{10})? as u8;if kind==2{payload[1]=CODE_MATERIALS.iter().position(|m|Some(*m)==event.payload["materialId"].as_str()).ok_or_else(||invalid("This material cannot be put in a code."))? as u8;}}
    bytes.extend_from_slice(&payload);bytes.extend_from_slice(&code_date(event.not_before.as_deref().unwrap_or("2020-01-01T00:00:00Z"))?);bytes.extend_from_slice(&code_date(event.not_after.as_deref().ok_or_else(||invalid("Codes need an expiry date."))?)?);
    bytes.extend_from_slice(&sign::sign(key,&bytes));let encoded=base32(&bytes);Ok(format!("PETA1-{}",encoded.as_bytes().chunks(4).map(|c|std::str::from_utf8(c).unwrap()).collect::<Vec<_>>().join("-")))
}
pub fn from_code_with(value:&str,trust:impl FnOnce(&Signer)->Result<VerifyingKey>)->Result<Verified> {
    if value.len()>1024{return Err(invalid("This code is too long."));}
    let normalized:String=value.chars().filter(|c|!c.is_whitespace() && *c!='-').map(|c|match c.to_ascii_uppercase(){'O'=>'0','I'|'L'=>'1',c=>c}).collect();
    let encoded=normalized.strip_prefix("PETA1").ok_or_else(||invalid("This is not a Peta code."))?;let bytes=unbase32(encoded)?;
    if bytes.len()!=114 || bytes[0]!=1{return Err(invalid("This code needs a newer Peta or is damaged."));}
    let id=crate::official_keys::KEYS.get(bytes[2] as usize).ok_or_else(||invalid("This signing key needs a newer Peta."))?.0;
    let signer=Signer::Official{key_id:id.into()};sign::verify(&trust(&signer)?,&bytes[..50],&bytes[50..])?;
    let n=bytes[3] as usize;if n==0 || n>16{return Err(invalid("Invalid code ID."));}
    let event_id=std::str::from_utf8(&bytes[4..4+n]).map_err(|_|invalid("Invalid code ID."))?.to_owned();if !safe_id(&event_id){return Err(invalid("Invalid code ID."));}
    let (kind,payload)=match bytes[1]{
        1=>("extra_envelope",serde_json::json!({"count":bytes[20]})),
        2=>("grant_material",serde_json::json!({"count":bytes[20],"materialId":CODE_MATERIALS.get(bytes[21] as usize).ok_or_else(||invalid("Unsupported material."))?})),
        3=>{let n=bytes[20] as usize;if n==0 || n>16{return Err(invalid("Invalid revoked ID."));}("revoke",serde_json::json!({"eventId":std::str::from_utf8(&bytes[21..21+n]).map_err(|_|invalid("Invalid revoked ID."))?}))},
        _=>return Err(invalid("This code needs a newer Peta. Please update.")),
    };
    let header=Event{event_id,kind:kind.into(),issued_at:"2020-01-01T00:00:00Z".into(),not_before:Some(read_code_date(&bytes[38..44])?),not_after:Some(read_code_date(&bytes[44..50])?),title:"From Peta".into(),message:String::new(),payload,signer,attachments:vec![]};
    Ok(Verified{header,attachments:vec![],bytes:vec![]})
}
pub fn from_code(value:&str)->Result<Verified> {from_code_with(value,sign::resolve)}

#[cfg(test)] mod tests {
    use super::*;
    fn lib()->Library {Library::open(&std::env::temp_dir().join(format!("peta-events-{}",crate::ids::new_sticker_id()))).unwrap()}
    fn event(id:&str,kind:&str,payload:serde_json::Value)->Event {Event{event_id:id.into(),kind:kind.into(),issued_at:"2026-10-04T00:00:00Z".into(),not_before:Some("2026-10-04T00:00:00Z".into()),not_after:Some("2026-11-04T00:00:00Z".into()),title:"From Peta".into(),message:String::new(),payload,signer:Signer::Official{key_id:"k1".into()},attachments:vec![]}}
    fn verified(e:Event)->Verified {let key=sign::generate().unwrap();decode_with(&encode(&e,&[],&key).unwrap(),|_|Ok(key.verifying_key())).unwrap()}
    fn time()->DateTime<Utc>{DateTime::parse_from_rfc3339("2026-10-05T00:00:00Z").unwrap().with_timezone(&Utc)}
    #[test] fn events_apply_once_and_revocation_only_blocks_unapplied() {
        let mut lib=lib();let e=verified(event("one","grant_material",serde_json::json!({"materialId":"kraft","count":2})));
        apply_event(&mut lib,&e,"file",time()).unwrap();assert_eq!(lib.db().material_count("kraft").unwrap(),2);assert!(apply_event(&mut lib,&e,"file",time()).is_err());
        let r=verified(event("revoke","revoke",serde_json::json!({"eventId":"two"})));apply_event(&mut lib,&r,"file",time()).unwrap();
        assert!(apply_event(&mut lib,&verified(event("two","extra_envelope",serde_json::json!({"count":1}))),"file",time()).is_err());assert_eq!(lib.db().bonus_envelopes().unwrap(),0);
        assert_eq!(lib.db().material_count("kraft").unwrap(),2);
    }
    #[test] fn limits_dates_unsupported_materials_and_atomic_rollback() {
        let mut lib=lib();
        for (kind,payload) in [("extra_envelope",serde_json::json!({"count":4})),("grant_material",serde_json::json!({"materialId":"kraft","count":11})),("grant_material",serde_json::json!({"materialId":"unknown","count":2})),("future",serde_json::json!({}))]{assert!(apply_event(&mut lib,&verified(event("bad",kind,payload)),"file",time()).is_err());}
        let paper=verified(event("paper","grant_material",serde_json::json!({"materialId":"matte","count":2})));
        apply_event(&mut lib,&paper,"file",time()).unwrap();
        assert!(apply_event(&mut lib,&paper,"file",time()).is_err());
        assert_eq!(lib.db().material_count("matte").unwrap(),2);
        let e=verified(event("good","grant_material",serde_json::json!({"materialId":"kraft","count":10})));
        assert!(apply_event(&mut lib,&e,"file",time()-chrono::Duration::days(2)).is_err());assert!(apply_event(&mut lib,&e,"file",time()+chrono::Duration::days(40)).is_err());
        lib.db().conn.execute_batch("CREATE TRIGGER fail_event BEFORE INSERT ON applied_events BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
        assert!(apply_event(&mut lib,&e,"file",time()).is_err());assert_eq!(lib.db().material_count("kraft").unwrap(),0);assert!(!lib.db().unlocked_material_ids().unwrap().contains(&"kraft".into()));
    }
    #[test] fn signed_pictures_install_atomically_and_png_is_checked_after_signature() {
        use image::{ImageFormat,Rgba,RgbaImage};
        let mut png=Vec::new();RgbaImage::from_pixel(8,8,Rgba([120,80,30,255])).write_to(&mut std::io::Cursor::new(&mut png),ImageFormat::Png).unwrap();
        let key=sign::generate().unwrap();let mut e=event("pack","grant_pack",serde_json::json!({"packId":"fall","title":"Fall","author":"Peta","pouch":"kraft","items":[{"key":"leaf","name":"Leaf","rarity":"rare"}]}));
        e.attachments.push(Attachment{key:"leaf".into(),png_len:png.len(),mask_len:0});
        let bytes=encode(&e,&png,&key).unwrap();let verified=decode_with(&bytes,|_|Ok(key.verifying_key())).unwrap();let mut lib=lib();
        lib.db().conn.execute_batch("CREATE TRIGGER fail_pack_event BEFORE INSERT ON applied_events BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
        assert!(apply_event(&mut lib,&verified,"file",time()).is_err());assert!(lib.db().packs().unwrap().is_empty());
        lib.db().conn.execute_batch("DROP TRIGGER fail_pack_event").unwrap();apply_event(&mut lib,&verified,"file",time()).unwrap();assert_eq!(lib.db().packs().unwrap()[0].remaining,1);
        let (id,_)=lib.db().pack_pick("official:fall",0.0).unwrap().unwrap();assert_eq!(crate::pack::stored_item(lib.db(),id).unwrap().unwrap().rarity,"rare");
        e.event_id="sticker".into();e.kind="grant_sticker".into();e.payload=serde_json::json!({});let verified=decode_with(&encode(&e,&png,&key).unwrap(),|_|Ok(key.verifying_key())).unwrap();apply_event(&mut lib,&verified,"file",time()).unwrap();assert_eq!(lib.db().gifts_received().unwrap()[0].from,"Peta");
        let mut damaged=bytes;let n=damaged.len();damaged[n-65]^=1;assert!(matches!(decode_with(&damaged,|_|Ok(key.verifying_key())),Err(Error::Invalid(e)) if e.contains("invalid_signature")));
    }

    #[test] fn new_material_codes_append_ids_and_share_one_receipt_with_signed_files() {
        assert_eq!(&CODE_MATERIALS[..5], &["kraft","holographic","gold","riso","vintage"]);
        let key=sign::generate().unwrap();let mut lib=lib();
        for id in ["gold","riso","vintage","clear","pixel","washi","sakura"] {
            let e=event(&format!("new-{id}"),"grant_material",serde_json::json!({"materialId":id,"count":2}));
            let code=as_code(&e,&key).unwrap();let v=from_code_with(&code,|_|Ok(key.verifying_key())).unwrap();
            assert_eq!(v.header.payload,e.payload);
            apply_event(&mut lib,&v,"code",time()).unwrap();
            assert_eq!(lib.db().material_count(id).unwrap(),2);
            assert!(lib.db().material_unlocked_at(id).unwrap().is_some());
            let file=decode_with(&encode(&e,&[],&key).unwrap(),|_|Ok(key.verifying_key())).unwrap();
            assert!(apply_event(&mut lib,&file,"file",time()).is_err());
            lib.db_mut().consume_material(id).unwrap();lib.db_mut().consume_material(id).unwrap();
            assert!(!lib.db().has_material(id).unwrap());
            assert!(lib.db_mut().consume_material(id).is_err());
        }
    }

    #[test] fn codes_normalize_verify_and_share_file_receipt_id() {
        let key=sign::generate().unwrap();let e=event("fall-envelope","extra_envelope",serde_json::json!({"count":2}));let code=as_code(&e,&key).unwrap();
        let changed=format!(" \n{} ",code.to_lowercase().replace('-',' '.to_string().as_str()).replace('0',"o").replace('1',"i"));
        let v=from_code_with(&changed,|_|Ok(key.verifying_key())).unwrap();assert_eq!(v.header.event_id,e.event_id);assert_eq!(v.header.payload,e.payload);
        let mut lib=lib();apply_event(&mut lib,&v,"code",time()).unwrap();let file=decode_with(&encode(&e,&[],&key).unwrap(),|_|Ok(key.verifying_key())).unwrap();assert!(apply_event(&mut lib,&file,"file",time()).is_err());
        assert!(from_code_with(&code,|_|Ok(sign::generate().unwrap().verifying_key())).is_err());
        let mut changed=code.into_bytes();changed[10]=if changed[10]==b'2'{b'3'}else{b'2'};assert!(from_code_with(std::str::from_utf8(&changed).unwrap(),|_|Ok(key.verifying_key())).is_err());
    }
}

pub fn current_time()->DateTime<Utc>{Utc::now()}
pub fn inbox(db:&crate::Database)->Result<Vec<Receipt>> {
    let mut stmt=db.conn.prepare("SELECT m.value FROM applied_events e JOIN meta m ON m.key='event.receipt.'||e.event_id WHERE e.kind!='grant_sticker' ORDER BY e.applied_at DESC,e.event_id")?;
    let rows=stmt.query_map([],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
    rows.iter().map(|s|serde_json::from_str(s).map_err(|_|invalid("An event receipt is damaged."))).collect()
}

pub fn validate_date(value:&str)->Result<()> {DateTime::parse_from_rfc3339(value).map_err(|_|invalid("Invalid event date."))?;Ok(())}
