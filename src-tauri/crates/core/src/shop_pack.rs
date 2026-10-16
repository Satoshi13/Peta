//! Official shop packs delivered without an app update (docs/official-packs-howto.md).
//!
//! The owner makes a pack in Pack Studio and signs it on their own Mac with an official key (`KEYS`, never a coupon key):
//! a `PETAEVNT` v1 file of kind `shop_pack` whose payload is the pack and whose attachments are its pictures. The server
//! only says which packs are on sale and when; it can never change what is in one. A file outside the limits below is
//! refused whole, never partly repaired.
use std::collections::HashSet;

use ed25519_dalek::{SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::{
    creator_pack::PackColor,
    error::{Error, Result},
    events::{self, Attachment, Event},
    official_keys,
    sign::Signer,
};

pub const KIND: &str = "shop_pack";
/// Wrappings a shop pack may use: the paper wrappings new packs keep to (`catalog.js` `PACK_BAG_IDS`).
pub const POUCHES: [&str; 4] = ["kraft", "matte", "holo", "glassine"];
/// Colors, besides none (ivory paper / silver foil). Only matte and holo take a color (`catalog.js` `PACK_COLORS`).
pub const COLORS: [&str; 4] = ["rose", "mint", "blue", "lavender"];
pub const RARITIES: [&str; 3] = ["common", "uncommon", "rare"];
pub const MIN_PRICE: i64 = 4;
pub const MAX_PRICE: i64 = 40;
pub const MIN_ITEMS: usize = 3;
pub const MAX_ITEMS: usize = 12;
pub const MAX_WEIGHT: u32 = 100;
pub const MAX_PICTURE: usize = 1536 * 1024;
pub const MAX_TOTAL: usize = 12 * 1024 * 1024;
pub const MAX_EDGE: u32 = 1024;
pub const TITLE_CHARS: usize = 40;
pub const BLURB_CHARS: usize = 120;
/// Packs that come with the app keep their ids; a shop pack never takes one of them.
const BUILT_IN: [&str; 7] = ["welcome", "tokyo", "coffee", "plants", "pixel", "cats", "night"];
/// A shop pack's id on this Mac (shelf, Market, Scraps exchange, shop setting), so it can never collide with a built-in or friend pack.
pub const LOCAL_PREFIX: &str = "shop:";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Item {
    pub key: String,
    pub name: String,
    pub rarity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShopPack {
    pub pack_id: String,
    pub version: u32,
    pub title: String,
    pub by: String,
    #[serde(default)]
    pub blurb: String,
    pub pouch: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<PackColor>,
    pub price: i64,
    pub items: Vec<Item>,
}

impl ShopPack {
    pub fn local_id(&self) -> String { local_id(&self.pack_id) }
    /// The weight each item is drawn with: its own, or what its rarity reads as.
    pub fn weight(item: &Item) -> u32 {
        item.weight.unwrap_or_else(|| crate::creator_pack::LEGACY_WEIGHTS.iter().find(|(r, _)| *r == item.rarity).map(|(_, w)| *w).unwrap_or(1))
    }
}

pub fn local_id(pack_id: &str) -> String { format!("{LOCAL_PREFIX}{pack_id}") }
/// The shop pack id inside a local id, if it is one.
pub fn pack_id(local: &str) -> Option<&str> { local.strip_prefix(LOCAL_PREFIX).filter(|id| valid_id(id)) }
/// A shop pack id or sticker key: letters, numbers, - and _, up to 40, starting with a letter or number (`idPattern`).
pub fn valid_id(id: &str) -> bool { events::safe_id(id) && id.len() <= 40 && !id.contains('.') }
/// The signed event's id: one per pack version.
pub fn event_id(pack_id: &str, version: u32) -> String { format!("shop-{pack_id}-v{version}") }

fn invalid(message: &str) -> Error { Error::Invalid(message.into()) }

/// The pack's own limits (§2). Pictures are checked separately.
pub fn validate(p: &ShopPack) -> Result<()> {
    if !valid_id(&p.pack_id) || BUILT_IN.contains(&p.pack_id.as_str()) {
        return Err(invalid("Pack IDs use letters, numbers, - and _ (up to 40), and never a built-in pack's ID."));
    }
    if p.version < 1 { return Err(invalid("Pack versions start at 1.")); }
    if !events::text(&p.title, TITLE_CHARS) || !events::text(&p.by, TITLE_CHARS) {
        return Err(invalid("A pack needs a title and an author, each up to 40 characters."));
    }
    if p.blurb.chars().count() > BLURB_CHARS || p.blurb.chars().any(char::is_control) {
        return Err(invalid("The pack's line is up to 120 characters on one line."));
    }
    if !POUCHES.contains(&p.pouch.as_str()) { return Err(invalid("Choose one of the paper wrappings: kraft, matte, holo or glassine.")); }
    if !crate::creator_pack::color_ok(&p.pouch, p.color) { return Err(invalid("Only matte and holo wrappings take a color.")); }
    if !(MIN_PRICE..=MAX_PRICE).contains(&p.price) { return Err(invalid("Shop packs cost 4 to 40 Scraps.")); }
    if !(MIN_ITEMS..=MAX_ITEMS).contains(&p.items.len()) { return Err(invalid("A shop pack holds 3 to 12 stickers.")); }
    let mut keys = HashSet::new();
    for item in &p.items {
        if !valid_id(&item.key) || !keys.insert(item.key.as_str()) {
            return Err(invalid("Each sticker needs its own key (letters, numbers, - and _)."));
        }
        if !events::text(&item.name, TITLE_CHARS) { return Err(invalid("Each sticker needs a name of up to 40 characters.")); }
        if !RARITIES.contains(&item.rarity.as_str()) { return Err(invalid("Rarity is common, uncommon or rare.")); }
        if item.weight.is_some_and(|w| !(1..=MAX_WEIGHT).contains(&w)) { return Err(invalid("Weights are 1 to 100.")); }
    }
    Ok(())
}

/// A sticker picture: a transparent PNG (the app adds the border and shadow), at most 1024 px on its long side and 1.5 MB.
pub fn check_picture(png: &[u8]) -> Result<()> {
    if png.is_empty() || png.len() > MAX_PICTURE { return Err(invalid("Each picture is at most 1.5 MB.")); }
    events::validate_png(png, MAX_PICTURE)?;
    let image = crate::image_limits::decode(png, Some(image::ImageFormat::Png), crate::image_limits::RECEIVED)?;
    if image.width().max(image.height()) > MAX_EDGE { return Err(invalid("Pictures are at most 1024 px on their long side.")); }
    if !image.color().has_alpha() { return Err(invalid("Pictures need a transparent background.")); }
    let rgba = image.to_rgba8();
    if !rgba.pixels().any(|p| p[3] < 255) { return Err(invalid("Pictures need a transparent background.")); }
    if !rgba.pixels().any(|p| p[3] > 0) { return Err(invalid("A picture is empty.")); }
    Ok(())
}

/// A verified shop pack: its contents and pictures, in the pack's order.
#[derive(Debug)]
pub struct Verified {
    pub pack: ShopPack,
    pub pictures: Vec<(String, Vec<u8>)>,
}

/// Only official keys sign shop packs; a coupon key (which lives on the server) never can.
fn official_only(signer: &Signer) -> Result<VerifyingKey> {
    match signer {
        Signer::Official { key_id } if !official_keys::is_coupon(key_id) => official_keys::get(key_id),
        _ => Err(invalid("Shop packs must be signed with an official key.")),
    }
}

/// Check a shop pack file against the built-in official keys.
pub fn verify(bytes: &[u8]) -> Result<Verified> { verify_with(bytes, official_only) }

/// Check a shop pack file with a chosen trust (peta-pass checks what it just signed with its own key).
pub fn verify_with(bytes: &[u8], trust: impl FnOnce(&Signer) -> Result<VerifyingKey>) -> Result<Verified> {
    if bytes.len() > MAX_TOTAL + 128 * 1024 { return Err(invalid("This shop pack is too large.")); }
    let verified = events::decode_with(bytes, |signer| match signer {
        Signer::Official { key_id } if official_keys::is_coupon(key_id) => Err(invalid("Shop packs must be signed with an official key.")),
        _ => trust(signer),
    })?;
    let e = verified.header();
    if e.kind != KIND { return Err(invalid("This is not a shop pack.")); }
    let pack: ShopPack = serde_json::from_value(e.payload.clone()).map_err(|_| invalid("This shop pack needs a newer Peta. Please update."))?;
    validate(&pack)?;
    if e.event_id != event_id(&pack.pack_id, pack.version) { return Err(invalid("This shop pack's ID does not match its contents.")); }
    let attachments = verified.attachments();
    if attachments.len() != pack.items.len() { return Err(invalid("Every sticker in a shop pack needs exactly one picture.")); }
    let mut total = 0usize;
    let mut pictures = Vec::with_capacity(attachments.len());
    for (item, (a, png, mask)) in pack.items.iter().zip(attachments) {
        if a.key != item.key || a.mask_len != 0 || !mask.is_empty() { return Err(invalid("Shop pack pictures must follow the stickers' order.")); }
        total += png.len();
        if total > MAX_TOTAL { return Err(invalid("A shop pack's pictures are at most 12 MB together.")); }
        check_picture(png)?;
        pictures.push((item.key.clone(), png.clone()));
    }
    Ok(Verified { pack, pictures })
}

/// Sign a shop pack (peta-pass, on the owner's Mac). `pictures` follow `pack.items`.
pub fn build(pack: &ShopPack, pictures: &[Vec<u8>], key_id: &str, key: &SigningKey) -> Result<Vec<u8>> {
    validate(pack)?;
    if official_keys::is_coupon(key_id) { return Err(invalid("Shop packs must be signed with an official key, not a coupon key.")); }
    if pictures.len() != pack.items.len() { return Err(invalid("Every sticker in a shop pack needs exactly one picture.")); }
    let mut total = 0usize;
    let mut body = Vec::new();
    let mut attachments = Vec::new();
    for (item, png) in pack.items.iter().zip(pictures) {
        check_picture(png)?;
        total += png.len();
        if total > MAX_TOTAL { return Err(invalid("A shop pack's pictures are at most 12 MB together.")); }
        attachments.push(Attachment { key: item.key.clone(), png_len: png.len(), mask_len: 0 });
        body.extend_from_slice(png);
    }
    let event = Event {
        event_id: event_id(&pack.pack_id, pack.version),
        kind: KIND.into(),
        issued_at: crate::db::now(),
        not_before: None,
        not_after: None,
        title: pack.title.clone(),
        message: pack.blurb.clone(),
        payload: serde_json::to_value(pack).map_err(|e| invalid(&e.to_string()))?,
        signer: Signer::Official { key_id: key_id.into() },
        attachments,
    };
    let bytes = events::encode(&event, &body, key)?;
    verify_with(&bytes, |_| Ok(key.verifying_key()))?;
    Ok(bytes)
}

/// What storing a received file did.
#[derive(Debug, PartialEq, Eq)]
pub enum Stored { New, Already }

/// Verify a shop pack file and keep it: pictures under `shop/<packId>/<version>/<key>.png`, the pack in `shop_packs`.
/// A file that does not verify is refused and nothing is written. Storing the same version twice changes nothing.
pub fn store(lib: &mut crate::Library, bytes: &[u8]) -> Result<Stored> { store_verified(lib, verify(bytes)?, &sha256(bytes)) }

pub(crate) fn store_verified(lib: &mut crate::Library, v: Verified, digest: &str) -> Result<Stored> {
    use rusqlite::{params, OptionalExtension};
    let p = &v.pack;
    let have: Option<String> = lib.db().conn.query_row("SELECT sha256 FROM shop_packs WHERE pack_id=?1 AND version=?2", params![p.pack_id, p.version], |r| r.get(0)).optional()?;
    if let Some(have) = have {
        // A different file under a version already kept is ignored: the owner raises the version to change a pack.
        return if have == digest { Ok(Stored::Already) } else { Err(invalid("This pack version is already here with different contents.")) };
    }
    let mut writes = crate::asset_writes::AssetWrites::new(lib);
    let mut items = Vec::with_capacity(p.items.len());
    for (item, (_, png)) in p.items.iter().zip(&v.pictures) {
        let path = picture_path(&p.pack_id, p.version, &item.key);
        writes.write(&path, png)?;
        items.push(serde_json::json!({"key":item.key,"name":item.name,"rarity":item.rarity,"weight":ShopPack::weight(item),"png":path}));
    }
    let color = p.color.and_then(|c| serde_json::to_value(c).ok().and_then(|v| v.as_str().map(str::to_owned)));
    let tx = lib.db_mut().conn.transaction()?;
    tx.execute("INSERT INTO shop_packs VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![p.pack_id, p.version, p.title, p.by, p.blurb, p.pouch, color, p.price, serde_json::Value::Array(items).to_string(), digest, crate::db::now()])?;
    writes.commit(tx)?;
    Ok(Stored::New)
}

/// Where a shop pack's picture is kept, relative to the library's assets.
pub fn picture_path(pack_id: &str, version: u32, key: &str) -> String { format!("shop/{pack_id}/{version}/{key}.png") }

/// The SHA-256 of a file, as the server lists it.
pub fn sha256(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use image::{codecs::png::PngEncoder, ExtendedColorType, ImageEncoder};

    /// The public RFC 8032 test key, which is k1 and c1 in test builds.
    pub fn test_key() -> SigningKey {
        SigningKey::from_bytes(&[0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c, 0xc4, 0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7f, 0x60])
    }
    pub fn disc(w: u32, h: u32, shade: u8) -> Vec<u8> {
        let mut px = vec![0u8; (w * h * 4) as usize];
        for y in 0..h { for x in 0..w {
            let (dx, dy) = (x as i64 - w as i64 / 2, y as i64 - h as i64 / 2);
            if dx * dx + dy * dy < (w.min(h) as i64 / 3).pow(2) { let i = ((y * w + x) * 4) as usize; px[i..i + 4].copy_from_slice(&[shade, 90, 60, 255]); }
        }}
        let mut out = Vec::new();
        PngEncoder::new(&mut out).write_image(&px, w, h, ExtendedColorType::Rgba8).unwrap();
        out
    }
    pub fn sample(id: &str, version: u32) -> (ShopPack, Vec<Vec<u8>>) {
        let items: Vec<Item> = ["maple", "acorn", "chestnut"].iter().enumerate().map(|(i, k)| Item { key: (*k).into(), name: format!("Leaf {i}"), rarity: RARITIES[i].into(), weight: None }).collect();
        let pictures = (0..items.len()).map(|i| disc(64, 48, 100 + i as u8 * 40)).collect();
        (ShopPack { pack_id: id.into(), version, title: "Autumn Walk".into(), by: "Peta".into(), blurb: "Leaves on the way home.".into(), pouch: "matte".into(), color: Some(PackColor::Rose), price: 12, items }, pictures)
    }
    pub fn signed(id: &str, version: u32) -> Vec<u8> {
        let (pack, pictures) = sample(id, version);
        build(&pack, &pictures, "k1", &test_key()).unwrap()
    }

    #[test]
    fn an_official_shop_pack_verifies_with_its_pictures_in_order() {
        let bytes = signed("autumn-walk", 2);
        let v = verify(&bytes).unwrap();
        assert_eq!(v.pack.pack_id, "autumn-walk");
        assert_eq!(v.pack.local_id(), "shop:autumn-walk");
        assert_eq!(v.pictures.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(), ["maple", "acorn", "chestnut"]);
        assert_eq!(ShopPack::weight(&v.pack.items[0]), 4);
        assert_eq!(ShopPack::weight(&v.pack.items[2]), 1);
        assert_eq!(pack_id("shop:autumn-walk"), Some("autumn-walk"));
        assert_eq!(pack_id("tokyo"), None);
    }

    #[test]
    fn a_changed_byte_an_unknown_key_or_a_coupon_key_is_refused() {
        let bytes = signed("autumn-walk", 1);
        for at in [20, bytes.len() / 2, bytes.len() - 1] { let mut bent = bytes.clone(); bent[at] ^= 1; assert!(verify(&bent).is_err()); }
        // Signed by a key the app does not carry.
        let (pack, pictures) = sample("autumn-walk", 1);
        let stranger = crate::sign::generate().unwrap();
        let theirs = build(&pack, &pictures, "k9", &stranger).unwrap();
        assert!(verify(&theirs).is_err());
        // The coupon key c1 is the same test key as k1, and still may not sign a shop pack.
        assert!(build(&pack, &pictures, "c1", &test_key()).is_err());
        let mut event: Event = serde_json::from_value(serde_json::json!({"eventId":event_id("autumn-walk",1),"kind":KIND,"issuedAt":crate::db::now(),"notBefore":null,"notAfter":null,"title":"Autumn Walk","message":"","payload":pack,"signer":{"kind":"official","keyId":"c1"},"attachments":[]})).unwrap();
        let mut body = Vec::new();
        for (item, png) in pack.items.iter().zip(&pictures) { event.attachments.push(Attachment { key: item.key.clone(), png_len: png.len(), mask_len: 0 }); body.extend_from_slice(png); }
        let coupon = events::encode(&event, &body, &test_key()).unwrap();
        assert!(verify(&coupon).is_err());
        assert!(events::decode(&coupon).is_err(), "the general event reader refuses a coupon-signed shop pack too");
    }

    #[test]
    fn packs_outside_the_limits_are_refused_whole() {
        let ok = sample("autumn-walk", 1).0;
        validate(&ok).unwrap();
        let cases: Vec<Box<dyn Fn(&mut ShopPack)>> = vec![
            Box::new(|p| p.pack_id = "tokyo".into()),
            Box::new(|p| p.pack_id = "a.b".into()),
            Box::new(|p| p.version = 0),
            Box::new(|p| p.title = "x".repeat(41)),
            Box::new(|p| p.by = " ".into()),
            Box::new(|p| p.blurb = "x".repeat(121)),
            Box::new(|p| p.pouch = "cotton".into()),
            Box::new(|p| { p.pouch = "kraft".into(); p.color = Some(PackColor::Mint); }),
            Box::new(|p| p.price = 3),
            Box::new(|p| p.price = 41),
            Box::new(|p| p.items.truncate(2)),
            Box::new(|p| { let more = p.items[0].clone(); for i in 0..10 { let mut m = more.clone(); m.key = format!("k{i}"); p.items.push(m); } }),
            Box::new(|p| p.items[1].key = "maple".into()),
            Box::new(|p| p.items[0].rarity = "special".into()),
            Box::new(|p| p.items[0].weight = Some(0)),
            Box::new(|p| p.items[0].weight = Some(101)),
        ];
        for (i, change) in cases.iter().enumerate() { let mut p = ok.clone(); change(&mut p); assert!(validate(&p).is_err(), "case {i}"); }
        assert!(serde_json::from_value::<ShopPack>(serde_json::json!({"packId":"a","version":1,"title":"t","by":"b","pouch":"kraft","price":5,"items":[],"extra":1})).is_err());
    }

    #[test]
    fn pictures_must_be_small_transparent_pngs() {
        check_picture(&disc(64, 64, 120)).unwrap();
        assert!(check_picture(&disc(1100, 20, 120)).is_err(), "longer than 1024 px");
        let mut opaque = Vec::new();
        PngEncoder::new(&mut opaque).write_image(&[200u8; 16 * 16 * 3], 16, 16, ExtendedColorType::Rgb8).unwrap();
        assert!(check_picture(&opaque).is_err(), "no transparency");
        let mut empty = Vec::new();
        PngEncoder::new(&mut empty).write_image(&[0u8; 16 * 16 * 4], 16, 16, ExtendedColorType::Rgba8).unwrap();
        assert!(check_picture(&empty).is_err(), "nothing drawn");
        assert!(check_picture(b"not a png").is_err());
    }

    #[test]
    fn a_verified_pack_is_kept_once_and_a_bad_file_writes_nothing() {
        let dir = std::env::temp_dir().join(format!("peta-shop-{}", crate::ids::new_gift_id()));
        let mut lib = crate::Library::open(&dir).unwrap();
        let bytes = signed("autumn-walk", 1);
        assert_eq!(store(&mut lib, &bytes).unwrap(), Stored::New);
        assert_eq!(store(&mut lib, &bytes).unwrap(), Stored::Already);
        let (items, price, color): (String, i64, Option<String>) = lib.db().conn.query_row("SELECT items,price,color FROM shop_packs WHERE pack_id='autumn-walk' AND version=1", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((price, color.as_deref()), (12, Some("rose")));
        let items: serde_json::Value = serde_json::from_str(&items).unwrap();
        assert_eq!(items[0]["png"], "shop/autumn-walk/1/maple.png");
        assert_eq!(items[0]["weight"], 4);
        assert_eq!(lib.read_asset("shop/autumn-walk/1/maple.png").unwrap(), verify(&bytes).unwrap().pictures[0].1);
        // Same version, different contents: refused, the kept one stays.
        let (mut other, pictures) = sample("autumn-walk", 1);
        other.title = "Changed".into();
        let changed = build(&other, &pictures, "k1", &test_key()).unwrap();
        assert!(store(&mut lib, &changed).is_err());
        // A tampered file writes nothing.
        let mut bent = signed("winter", 1); let at = bent.len() - 3; bent[at] ^= 1;
        assert!(store(&mut lib, &bent).is_err());
        assert!(!dir.join("assets/shop/winter").exists());
        assert_eq!(lib.db().conn.query_row("SELECT COUNT(*) FROM shop_packs", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_limits_match_the_shared_contract() {
        let c: serde_json::Value = serde_json::from_str(include_str!("../../../../cloudflare/shared/shop-pack-contract.json")).unwrap();
        let strings = |v: &serde_json::Value| v.as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_owned()).collect::<Vec<_>>();
        assert_eq!(c["kind"], KIND);
        assert_eq!(strings(&c["builtInIds"]), BUILT_IN);
        assert_eq!(strings(&c["pouches"]), POUCHES);
        assert_eq!(strings(&c["colors"]), COLORS);
        assert_eq!(strings(&c["colorPouches"]), ["matte", "holo"]);
        assert_eq!(strings(&c["rarities"]), RARITIES);
        for (rarity, weight) in crate::creator_pack::LEGACY_WEIGHTS { assert_eq!(c["rarityWeights"][rarity], weight); }
        assert_eq!((c["titleChars"].as_u64(), c["blurbChars"].as_u64()), (Some(TITLE_CHARS as u64), Some(BLURB_CHARS as u64)));
        assert_eq!((c["price"]["min"].as_i64(), c["price"]["max"].as_i64()), (Some(MIN_PRICE), Some(MAX_PRICE)));
        assert_eq!((c["items"]["min"].as_u64(), c["items"]["max"].as_u64()), (Some(MIN_ITEMS as u64), Some(MAX_ITEMS as u64)));
        assert_eq!((c["weight"]["min"].as_u64(), c["weight"]["max"].as_u64()), (Some(1), Some(MAX_WEIGHT as u64)));
        assert_eq!((c["picture"]["maxBytes"].as_u64(), c["picture"]["maxEdge"].as_u64()), (Some(MAX_PICTURE as u64), Some(MAX_EDGE as u64)));
        assert_eq!(c["totalBytes"].as_u64(), Some(MAX_TOTAL as u64));
        // The id pattern says the same as validate(): up to 40, letters, numbers, - and _, starting with a letter or number.
        let ok = |id: &str| { let mut p = sample(id, 1).0; p.pack_id = id.into(); validate(&p).is_ok() };
        assert_eq!(c["idPattern"], "^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$");
        for (id, valid) in [("autumn-walk", true), ("A_1", true), (&"a".repeat(40) as &str, true), (&"a".repeat(41) as &str, false), ("-a", false), ("a.b", false), ("a b", false), ("tokyo", false)] { assert_eq!(ok(id), valid, "{id}"); }
    }

    #[test]
    fn the_wrappings_and_colors_match_the_app() {
        let catalog = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../src/app/js/catalog.js")).unwrap();
        let line = catalog.lines().find(|l| l.starts_with("const PACK_BAG_IDS")).unwrap();
        let bags: Vec<&str> = line.split('"').skip(1).step_by(2).collect();
        assert_eq!(bags, POUCHES);
        for pouch in ["matte", "holo"] {
            let start = catalog.find(&format!("  {pouch}: [{{id:null")).unwrap();
            let block = &catalog[start..start + catalog[start..].find("}],").unwrap()];
            let ids: Vec<&str> = block.split("id:\"").skip(1).map(|s| &s[..s.find('"').unwrap()]).collect();
            assert_eq!(ids, COLORS, "{pouch}");
        }
        for color in COLORS { assert!(serde_json::from_value::<PackColor>(serde_json::json!(color)).is_ok()); }
    }
}
