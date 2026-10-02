//! Gift (spec §34-36): a Peta given to someone, as a sealed envelope — a small file, not "an image to share".
//!
//! * You give a **copy**: your own sticker stays with you. The copy carries an **edition number** (#1 for the first
//!   copy you give away, #2 for the next, ...) and the whole chain of who made / gave / received it.
//! * The file holds the finished sticker and its provenance. The original photo is never sent.
//! * Where the file travels (AirDrop, a message, later an account server) is not this module's business.
//!   A gift can be received once per device; its contents stay hidden until the envelope is opened.
//!
//! File layout: `PETAGIFT` · version(1) · u32 BE JSON length · JSON header · sticker PNG · mask PNG.

use serde::{Deserialize, Serialize};

use crate::{
    db::now,
    error::{Error, Result},
    ids::new_gift_id,
    library::Library,
    models::{NewSticker, ProvenanceKind, SourceType, Sticker},
};

const MAGIC: &[u8; 8] = b"PETAGIFT";
const VERSION: u8 = 1;
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
    };
    let json = serde_json::to_vec(&header).map_err(|e| Error::Invalid(e.to_string()))?;
    let mut out = Vec::with_capacity(13 + json.len() + png.len() + mask.len());
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
    out.extend_from_slice(&(json.len() as u32).to_be_bytes());
    out.extend_from_slice(&json);
    out.extend_from_slice(&png);
    out.extend_from_slice(&mask);

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
    if bytes.len() < 13 || &bytes[..8] != MAGIC {
        return Err(bad("wrong file"));
    }
    if bytes[8] != VERSION {
        return Err(bad("made by a newer version of Peta"));
    }
    let json_len = u32::from_be_bytes([bytes[9], bytes[10], bytes[11], bytes[12]]) as usize;
    if json_len == 0 || json_len > MAX_HEADER || bytes.len() < 13 + json_len {
        return Err(bad("damaged header"));
    }
    let header: GiftHeader = serde_json::from_slice(&bytes[13..13 + json_len]).map_err(|_| bad("damaged header"))?;
    if header.png_len == 0 || header.png_len > MAX_PNG || header.mask_len > MAX_PNG {
        return Err(bad("unreasonable size"));
    }
    let body = &bytes[13 + json_len..];
    if body.len() != header.png_len + header.mask_len {
        return Err(bad("damaged contents"));
    }
    if !header.gift_id.starts_with("GIFT-") || header.gift_id.len() > 40 || header.from.len() > 200 {
        return Err(bad("damaged header"));
    }
    let (png, mask) = body.split_at(header.png_len);
    image::load_from_memory_with_format(png, image::ImageFormat::Png).map_err(|_| bad("the picture is damaged"))?;
    Ok(Decoded { header, png, mask })
}

/// Put a gift in the Inbox, still sealed. Receiving the same gift twice is refused.
pub fn receive_gift(lib: &mut Library, bytes: &[u8]) -> Result<crate::db::IncomingGift> {
    let d = decode_gift(bytes)?;
    if lib.db().gift_is_received(&d.header.gift_id)? {
        return Err(Error::GiftAlreadyReceived);
    }
    let rel = format!("gifts/{}.peta", d.header.gift_id);
    lib.write_asset(&rel, bytes)?;
    lib.db_mut().gift_record_received(&d.header.gift_id, &d.header.from, d.header.note.as_deref(), &d.header.sent_at, &rel)?;
    lib.db()
        .gifts_received()?
        .into_iter()
        .find(|g| g.gift_id == d.header.gift_id)
        .ok_or_else(|| Error::Invalid("gift vanished after receiving".into()))
}

/// Break the seal: the sticker becomes yours (source Gift, a copy with its edition number and lineage).
pub fn open_gift(lib: &mut Library, gift_id: &str) -> Result<Sticker> {
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
