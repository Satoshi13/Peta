//! Gift (spec §34-36): a Peta given to someone, as a sealed envelope — a small file, not "an image to share".
//!
//! * You give a **copy**: your own sticker stays with you. The copy carries an **edition number** (#1 for the first
//!   copy you give away, #2 for the next, ...) and the whole chain of who made / gave / received it.
//! * The file holds the finished sticker and its provenance. The original photo is never sent.
//! * Where the file travels (AirDrop, a message, later an account server) is not this module's business.
//!   A gift can be received once per device; its contents stay hidden until the envelope is opened.
//!
//! File layout: PETAGIFT v2 signs the header and finished PNG/mask with a device key.
//! Legacy v1 is readable as unsigned. TOFU proves key continuity, not real-world identity.

use serde::{Deserialize, Serialize};

use crate::{
    db::now,
    error::{Error, Result},
    ids::new_gift_id,
    library::Library,
    models::{NewSticker, ProvenanceKind, SourceType, Sticker},
};

const MAGIC: &[u8; 8] = b"PETAGIFT";
const VERSION: u8 = 2;
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
    pub edition: i64,
    pub origin: Origin,
    pub png_len: usize,
    pub mask_len: usize,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub signer: Option<crate::sign::Signer>,
}

/// Seal a copy of one of your stickers for `to` (a label only you see: "Nao", "Mom"). Returns the gift id and the file.
pub fn build_gift(lib: &mut Library, sticker_id: &str, to: &str, note: Option<&str>) -> Result<(String, Vec<u8>)> {
    let sticker = lib.db().sticker(sticker_id)?.ok_or_else(|| Error::Invalid(format!("unknown sticker {sticker_id}")))?;
    let png = lib.read_rendered(sticker_id)?;
    let mask = match &sticker.mask_asset_path {
        Some(rel) => lib.read_asset(rel).unwrap_or_default(),
        None => Vec::new(),
    };
    let from = lib.db().display_name()?;
    let key=crate::device_key::load_or_create(lib.root())?;
    let edition = lib.db_mut().gift_next_edition(sticker_id)?;
    let gift_id = new_gift_id();
    let header = GiftHeader {
        gift_id: gift_id.clone(),
        from,
        note: note.map(str::trim).filter(|n| !n.is_empty()).map(|n| n.chars().take(140).collect()),
        sent_at: now(),
        edition,
        origin: Origin {
            sticker_id: sticker.id.clone(),
            creator_name: sticker.creator_name.clone(),
            created_at: sticker.created_at.clone(),
            material_id: sticker.material_id.clone(),
            aspect: sticker.aspect,
        },
        png_len: png.len(),
        mask_len: mask.len(),
        signer: Some(crate::sign::Signer::Device{public_key:crate::sign::public_key(&key)}),
    };
    let out=crate::sign::seal(MAGIC,VERSION,&header,&[png,mask].concat(),&key)?;

    lib.db_mut().gift_record_sent(&gift_id, sticker_id, edition, to)?;
    lib.db_mut().add_provenance(sticker_id, ProvenanceKind::Gifted, Some(to), &now())?;
    Ok((gift_id, out))
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
        let verified=crate::events::decode(bytes)?;let e=&verified.header;
        if e.kind!="grant_sticker" || verified.attachments.len()!=1 {return Err(bad("not a sticker event"));}
        let (_,png,mask)=&verified.attachments[0];
        // The original event remains the package; opening verifies its official signature again.
        let n=13+u32::from_be_bytes(bytes[9..13].try_into().unwrap()) as usize;
        let header=GiftHeader{gift_id:format!("GIFT-E-{}",e.event_id),from:"Peta".into(),note:Some(e.message.clone()),sent_at:e.issued_at.clone(),edition:1,
            origin:Origin{sticker_id:format!("EVENT-{}",e.event_id),creator_name:Some("Peta".into()),created_at:e.issued_at.clone(),material_id:Some("matte".into()),aspect:{let image=image::load_from_memory(png)?;image.width() as f64/image.height() as f64}},png_len:png.len(),mask_len:mask.len(),signer:Some(e.signer.clone())};
        return Ok(Decoded{header,png:&bytes[n..n+png.len()],mask:&bytes[n+png.len()..n+png.len()+mask.len()]});
    }
    if bytes.len() < 13 || &bytes[..8] != MAGIC {
        return Err(bad("wrong file"));
    }
    if bytes.len()>crate::sign::MAX_FILE {return Err(bad("unreasonable size"));}
    if bytes[8] != 1 && bytes[8] != VERSION {
        return Err(bad("made by a newer version of Peta"));
    }
    let json_len = u32::from_be_bytes([bytes[9], bytes[10], bytes[11], bytes[12]]) as usize;
    if json_len == 0 || json_len > MAX_HEADER || bytes.len() < 13 + json_len {
        return Err(bad("damaged header"));
    }
    let (header,body):(GiftHeader,&[u8])=if bytes[8]==VERSION {
        let (json,body)=crate::sign::unseal(bytes,MAGIC,VERSION)?;
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
    if !header.gift_id.starts_with("GIFT-") || !crate::events::safe_id(&header.gift_id) || header.gift_id.len()>40 || header.from.len()>200 || header.from.trim().is_empty() || header.edition<1 || !header.origin.aspect.is_finite() || header.origin.aspect<=0.0 {
        return Err(bad("damaged header"));
    }
    let (png, mask) = body.split_at(header.png_len);
    crate::events::validate_png(png,MAX_PNG)?;if !mask.is_empty(){crate::events::validate_png(mask,MAX_PNG)?;}
    Ok(Decoded { header, png, mask })
}

/// Put a gift in the Inbox, still sealed. Receiving the same gift twice is refused.
pub fn receive_gift(lib: &mut Library, bytes: &[u8]) -> Result<crate::db::IncomingGift> {
    let d = decode_gift(bytes)?;
    if lib.db().gift_is_received(&d.header.gift_id)? {
        return Err(Error::GiftAlreadyReceived);
    }
    use sha2::{Digest,Sha256};
    let content_id=Sha256::digest(bytes).iter().map(|b|format!("{b:02x}")).collect::<String>();
    let rel = format!("gifts/{content_id}.peta");
    lib.write_asset(&rel, bytes)?;
    let tx=lib.db_mut().conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let identity=if let Some(crate::sign::Signer::Device{public_key})=&d.header.signer {Some(crate::friends::observe(&tx,public_key,&d.header.from)?)} else {None};
    tx.execute("INSERT INTO gifts_received(gift_id,from_name,note,sent_at,received_at,package) VALUES (?1,?2,?3,?4,?5,?6)",rusqlite::params![d.header.gift_id,identity.as_ref().map(|i|i.name.as_str()).unwrap_or(&d.header.from),d.header.note,d.header.sent_at,now(),rel])?;
    tx.execute("INSERT INTO gift_signers VALUES (?1,?2,?3,?4)",rusqlite::params![d.header.gift_id,identity.as_ref().map(|i|i.status.as_str()).unwrap_or("unsigned"),identity.as_ref().map(|i|&i.fingerprint),identity.as_ref().map(|i|&i.public_key)])?;
    tx.commit()?;
    lib.db()
        .gifts_received()?
        .into_iter()
        .find(|g| g.gift_id == d.header.gift_id)
        .ok_or_else(|| Error::Invalid("gift vanished after receiving".into()))
}

/// Break the seal: the sticker becomes yours (source Gift, a copy with its edition number and lineage).
pub fn open_gift(lib: &mut Library, gift_id: &str) -> Result<Sticker> {
    if lib.db().gifts_received()?.iter().any(|g|g.gift_id==gift_id && g.opened_at.is_some()){return Err(Error::Invalid("That gift was already opened.".into()));}
    let rel = lib.db().gift_package_path(gift_id)?.ok_or_else(|| Error::Invalid(format!("unknown gift {gift_id}")))?;
    let bytes = lib.read_asset(&rel)?;
    let d = decode_gift(&bytes)?;
    let h = d.header.clone();

    let id = loop {
        let id = crate::ids::new_sticker_id();
        if !lib.db().sticker_id_exists(&id)? {
            break id;
        }
    };
    let rendered_rel = format!("stickers/{id}/rendered.png");
    lib.write_asset(&rendered_rel, d.png)?;
    let mask_rel = if d.mask.is_empty() { None } else {
        let rel = format!("stickers/{id}/mask.png");
        lib.write_asset(&rel, d.mask)?;
        Some(rel)
    };
    let created = lib.db_mut().create_sticker(NewSticker {
        id: id.clone(),
        creator_id: None,
        creator_name: h.origin.creator_name.clone(),
        original_asset_path: rendered_rel.clone(), // the original photo is never sent: the finished sticker stands in
        rendered_asset_path: rendered_rel,
        mask_asset_path: mask_rel,
        material_id: h.origin.material_id.clone(),
        source_type: SourceType::Gift,
        aspect: h.origin.aspect,
    })?;
    let db = lib.db_mut();
    db.set_lineage(&created.id, &h.origin.sticker_id, h.edition, &h.origin.created_at)?;
    db.add_provenance(&created.id, ProvenanceKind::Gifted, Some(&h.from), &h.sent_at)?;
    db.add_provenance(&created.id, ProvenanceKind::Received, Some(&h.from), &now())?;
    db.gift_mark_opened(gift_id, &created.id)?;
    db.sticker(&created.id)?.ok_or_else(|| Error::Invalid("sticker vanished".into()))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{ImageFormat, Rgba, RgbaImage};

    use super::*;
    use crate::{back, pack};

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

    #[test]
    fn a_gift_goes_from_one_library_to_another_as_a_numbered_copy() {
        let (mut mine, sticker) = sender_with_sticker();
        let (id1, file1) = build_gift(&mut mine, &sticker.id, "Nao", Some("  for you  ")).unwrap();
        let (_, file2) = build_gift(&mut mine, &sticker.id, "Mom", None).unwrap();
        assert_ne!(decode_gift(&file1).unwrap().header.gift_id, decode_gift(&file2).unwrap().header.gift_id);
        assert_eq!(decode_gift(&file1).unwrap().header.edition, 1);
        assert_eq!(decode_gift(&file2).unwrap().header.edition, 2, "each copy given away gets the next number");
        assert_eq!(decode_gift(&file1).unwrap().header.note.as_deref(), Some("for you"));
        assert_eq!(mine.db().gifts_sent_count(&sticker.id).unwrap(), 2);
        assert!(mine.db().sticker(&sticker.id).unwrap().is_some(), "the sender keeps their own");

        // the other person
        let mut theirs = lib();
        let incoming = receive_gift(&mut theirs, &file1).unwrap();
        assert_eq!((incoming.gift_id.as_str(), incoming.from.as_str(), incoming.opened_at.is_none()), (id1.as_str(), "Satoshi", true));
        assert!(theirs.db().on_desktop().unwrap().is_empty() && theirs.db().sticker_count().unwrap() == 0, "still sealed: nothing in the library");
        assert!(matches!(receive_gift(&mut theirs, &file1), Err(Error::GiftAlreadyReceived)));

        let opened = open_gift(&mut theirs, &id1).unwrap();
        assert_eq!(opened.source_type, SourceType::Gift);
        assert_eq!(opened.edition_number, Some(1));
        assert_eq!(opened.parent_sticker_id.as_deref(), Some(sticker.id.as_str()));
        assert_eq!(opened.material_id.as_deref(), Some("holographic"));
        assert_eq!(opened.creator_name.as_deref(), Some("Satoshi"));
        assert_eq!(opened.created_at, sticker.created_at, "it remembers when the original was made");
        assert!(theirs.read_rendered(&opened.id).unwrap().starts_with(&[0x89, b'P', b'N', b'G']));

        let b = back::sticker_back(theirs.db(), &opened.id, "Me", &|ts| Some(ts.chars().take(10).collect())).unwrap().unwrap();
        assert_eq!(b.kind, back::BackKind::Received);
        assert_eq!(b.received_from.as_deref(), Some("Satoshi"));
        assert_eq!(b.edition_number.as_deref(), Some("0001"));
        assert!(open_gift(&mut theirs, &id1).is_err(), "a gift opens once");
    }

    #[test]
    fn signed_gifts_use_tofu_and_legacy_gifts_stay_unsigned() {
        let (mut mine,sticker)=sender_with_sticker();let mut theirs=lib();
        let (_,first)=build_gift(&mut mine,&sticker.id,"Nao",None).unwrap();assert_eq!(first[8],2);
        let one=receive_gift(&mut theirs,&first).unwrap();assert_eq!(one.signature_status,"new");assert_eq!(one.fingerprint.as_ref().unwrap().len(),9);
        let (_,second)=build_gift(&mut mine,&sticker.id,"Nao",None).unwrap();assert_eq!(receive_gift(&mut theirs,&second).unwrap().signature_status,"known");
        let (mut other,s)=sender_with_sticker();let (_,third)=build_gift(&mut other,&s.id,"Nao",None).unwrap();assert_eq!(receive_gift(&mut theirs,&third).unwrap().signature_status,"warning");
        let d=decode_gift(&first).unwrap();let mut header=d.header.clone();header.signer=None;header.gift_id=crate::ids::new_gift_id();let json=serde_json::to_vec(&header).unwrap();let mut legacy=b"PETAGIFT".to_vec();legacy.push(1);legacy.extend_from_slice(&(json.len() as u32).to_be_bytes());legacy.extend(json);legacy.extend(d.png);legacy.extend(d.mask);
        assert_eq!(receive_gift(&mut theirs,&legacy).unwrap().signature_status,"unsigned");
    }
    #[test]
    fn changing_sender_edition_or_png_is_rejected_before_any_receipt() {
        let (mut mine,sticker)=sender_with_sticker();let (_,good)=build_gift(&mut mine,&sticker.id,"Nao",None).unwrap();let mut theirs=lib();
        for changed in [
            {let mut b=good.clone();let at=b.windows(7).position(|s|s==b"Satoshi").unwrap();b[at]=b'N';b},
            {let mut b=good.clone();let at=b.windows(11).position(|s|s==b"\"edition\":1").unwrap();b[at+10]=b'2';b},
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
