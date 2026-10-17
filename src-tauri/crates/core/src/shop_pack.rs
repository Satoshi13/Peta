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

/* ---------- On this Mac: what the server lists, what is on sale, and buying a set (Step 2) ---------- */

/// At most this many shop packs are on sale at once (peta-api `MAX_LIVE`).
pub const MAX_LIVE: usize = 24;
const LISTED: &str = "shop.listed";

/// One pack on sale, as `/v1/config` lists it. The URL is used once to fetch the file and is never kept.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    pub pack_id: String,
    pub version: u32,
    pub size: u64,
    pub sha256: String,
    #[serde(default)]
    pub ends_at: Option<i64>,
    #[serde(default, skip_serializing)]
    pub url: Option<String>,
}

/// Keep the server's list of packs on sale, replacing the last one whole. A list outside the limits is refused and the last
/// one stays (a server that cannot be read never empties the shop, nor fills it with something odd).
/// Store the shop's list in place of the last one. Returns whether it differs from what was stored (so the page refreshes only then).
pub fn replace_listing(db: &mut crate::Database, listed: &[Listed]) -> Result<bool> {
    let mut ids = HashSet::new();
    if listed.len() > MAX_LIVE
        || !listed.iter().all(|l| valid_id(&l.pack_id) && ids.insert(l.pack_id.as_str()) && l.version >= 1 && l.size > 0 && l.size <= (MAX_TOTAL + 1024 * 1024) as u64
            && l.sha256.len() == 64 && l.sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
    {
        return Err(invalid("The shop's list of packs could not be read."));
    }
    let kept: Vec<Listed> = listed.iter().map(|l| Listed { url: None, ..l.clone() }).collect();
    let json = serde_json::to_string(&kept).map_err(|e| invalid(&e.to_string()))?;
    use rusqlite::OptionalExtension;
    let before: Option<String> = db.conn.query_row("SELECT value FROM meta WHERE key=?1", [LISTED], |r| r.get(0)).optional()?;
    if before.as_deref() == Some(json.as_str()) { return Ok(false); }
    db.set_setting(LISTED, &json)?;
    Ok(true)
}

fn listing(conn: &rusqlite::Connection) -> Vec<Listed> {
    use rusqlite::OptionalExtension;
    let raw: Option<String> = conn.query_row("SELECT value FROM meta WHERE key=?1", [LISTED], |r| r.get(0)).optional().ok().flatten();
    raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// Listed versions this Mac has not kept yet: the ones to fetch.
pub fn missing(db: &crate::Database, listed: &[Listed]) -> Result<Vec<Listed>> {
    let mut out = Vec::new();
    for l in listed {
        let have: bool = db.conn.query_row("SELECT EXISTS(SELECT 1 FROM shop_packs WHERE pack_id=?1 AND version=?2)", rusqlite::params![l.pack_id, l.version], |r| r.get(0))?;
        if !have { out.push(l.clone()); }
    }
    Ok(out)
}

/// Keep a fetched file only if it is the one listed (size, SHA-256, pack and version) and it verifies with an official key.
pub fn store_listed(lib: &mut crate::Library, listed: &Listed, bytes: &[u8]) -> Result<Stored> {
    if bytes.len() as u64 != listed.size || sha256(bytes) != listed.sha256 { return Err(invalid("This shop pack is not the one listed.")); }
    let v = verify(bytes)?;
    if v.pack.pack_id != listed.pack_id || v.pack.version != listed.version { return Err(invalid("This shop pack is not the one listed.")); }
    store_verified(lib, v, &listed.sha256)
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveItem { pub key: String, pub name: String, pub rarity: String }
/// A shop pack the Market shows now: listed, not ended, and kept here (so it verified).
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Live {
    pub id: String,
    pub pack_id: String,
    pub version: u32,
    pub title: String,
    pub by: String,
    pub blurb: String,
    pub pouch: String,
    pub color: Option<String>,
    /// The signed price; the shop setting may move it within 50–200% (`offer`).
    pub price: i64,
    pub items: Vec<LiveItem>,
}
#[derive(Deserialize)]
struct KeptItem { key: String, name: String, rarity: String, weight: u32, png: String }
struct Kept { title: String, by: String, blurb: String, pouch: String, color: Option<String>, price: i64, items: Vec<KeptItem> }
fn kept(conn: &rusqlite::Connection, pack_id: &str, version: u32) -> Option<Kept> {
    use rusqlite::OptionalExtension;
    let row: Option<(String, String, String, String, Option<String>, i64, String)> = conn.query_row(
        "SELECT title,by_name,blurb,pouch,color,price,items FROM shop_packs WHERE pack_id=?1 AND version=?2", rusqlite::params![pack_id, version],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))).optional().ok().flatten();
    let (title, by, blurb, pouch, color, price, items) = row?;
    Some(Kept { title, by, blurb, pouch, color, price, items: serde_json::from_str(&items).ok()? })
}

/// The shop packs on sale at `now` (seconds). Builds without the server never have a list, so they keep the six built-in packs.
pub fn live(conn: &rusqlite::Connection, now: i64) -> Vec<Live> {
    listing(conn).into_iter()
        .filter(|l| l.ends_at.is_none_or(|end| now < end))
        .filter_map(|l| {
            let k = kept(conn, &l.pack_id, l.version)?;
            Some(Live { id: local_id(&l.pack_id), pack_id: l.pack_id, version: l.version, title: k.title, by: k.by, blurb: k.blurb, pouch: k.pouch, color: k.color, price: k.price,
                items: k.items.into_iter().map(|i| LiveItem { key: i.key, name: i.name, rarity: i.rarity }).collect() })
        })
        .collect()
}

/// Where a kept picture of a pack on sale is, for the Market to show (only names the pack itself lists).
pub fn live_picture(db: &crate::Database, local: &str, key: &str) -> Option<String> {
    let pack_id = pack_id(local)?;
    let l = listing(&db.conn).into_iter().find(|l| l.pack_id == pack_id)?;
    kept(&db.conn, &l.pack_id, l.version)?.items.into_iter().find(|i| i.key == key).map(|i| i.png)
}

/// A shop pack's price and whether it is on sale, from the same function the Market shows and the exchange takes.
/// A shop setting's price applies only within 50–200% of the signed price; outside that, the signed price stays.
pub(crate) fn offer(conn: &rusqlite::Connection, local: &str) -> Option<(i64, bool)> {
    let now = chrono::Utc::now();
    let pack = live(conn, now.timestamp()).into_iter().find(|p| p.id == local)?;
    let shop = crate::signed_config::active_shop(conn, now);
    let entry = shop.as_ref().and_then(|c| c.packs.iter().find(|p| p.id == local));
    let (low, high) = ((pack.price * crate::signed_config::SHOP_PRICE_MIN_PERCENT + 99) / 100, pack.price * crate::signed_config::SHOP_PRICE_MAX_PERCENT / 100);
    let price = entry.and_then(|p| p.price).filter(|p| (low..=high).contains(p)).unwrap_or(pack.price);
    Some((price, entry.is_none_or(|p| p.on_sale)))
}

/// Put `quantity` sealed sets of the pack's listed version on the shelf, inside the exchange's transaction. The shelf shows the
/// newest wrapping, title and line; stickers already in the bag keep their own pictures.
pub(crate) fn add_sets(tx: &rusqlite::Transaction<'_>, local: &str, quantity: i64) -> Result<()> {
    use rusqlite::params;
    let pack_id = pack_id(local).ok_or_else(|| invalid("This pack is not available to exchange."))?;
    let l = listing(tx).into_iter().find(|l| l.pack_id == pack_id).ok_or_else(|| invalid("This pack is not on sale right now."))?;
    let k = kept(tx, &l.pack_id, l.version).ok_or_else(|| invalid("This pack is not on sale right now."))?;
    let left: i64 = tx.query_row("SELECT COUNT(*) FROM pack_items WHERE pack_id=?1 AND opened_at IS NULL", [local], |r| r.get(0))?;
    if left + k.items.len() as i64 * quantity > crate::scraps::MAX_SEALED_PER_PACK { return Err(invalid("This pack already holds as many sealed stickers as it can.")); }
    let now = crate::db::now();
    tx.execute("INSERT INTO packs(id,title,by_name,created_at) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET title=excluded.title,by_name=excluded.by_name", params![local, k.title, k.by, now])?;
    tx.execute("INSERT INTO pack_distributions VALUES (?1,?2,?3,NULL,NULL,'official',?4) ON CONFLICT(pack_id) DO UPDATE SET version=excluded.version,pouch=excluded.pouch", params![local, l.pack_id, l.version, k.pouch])?;
    tx.execute("INSERT INTO pack_dress(pack_id,cover,deco,blurb) VALUES (?1,NULL,NULL,?2) ON CONFLICT(pack_id) DO UPDATE SET blurb=excluded.blurb", params![local, (!k.blurb.is_empty()).then_some(&k.blurb)])?;
    crate::creator_pack::store_color(tx, local, k.color.as_deref().and_then(|c| serde_json::from_value(serde_json::json!(c)).ok()))?;
    for _ in 0..quantity {
        for item in &k.items {
            tx.execute("INSERT INTO pack_items(pack_id,item_key) VALUES (?1,?2)", params![local, item.key])?;
            let id = tx.last_insert_rowid();
            tx.execute("INSERT INTO signed_pack_items(item_id,png_path,mask_path,material_id,aspect,name,rarity,finished) VALUES (?1,?2,NULL,?3,1,?4,?5,0)",
                params![id, item.png, crate::materials::DEFAULT_MATERIAL, item.name, item.rarity])?;
            tx.execute("INSERT INTO pack_item_weights(item_id,weight) VALUES (?1,?2)", params![id, item.weight])?;
        }
    }
    Ok(())
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

    fn library() -> (crate::Library, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("peta-shop-live-{}", crate::ids::new_gift_id()));
        let lib = crate::Library::open(&dir).unwrap();
        lib.db().conn.execute("INSERT INTO meta(key,value) VALUES('scraps.balance','200') ON CONFLICT(key) DO UPDATE SET value='200'", []).unwrap();
        (lib, dir)
    }
    fn listed(bytes: &[u8], id: &str, version: u32, ends_at: Option<i64>) -> Listed {
        Listed { pack_id: id.into(), version, size: bytes.len() as u64, sha256: sha256(bytes), ends_at, url: Some("https://peta.test/v1/shop-pack/x".into()) }
    }
    fn buy(lib: &mut crate::Library, id: &str, n: i64, request: &str) -> Result<crate::scraps::Receipt> {
        lib.db_mut().scrap_trade(&crate::scraps::Trade { kind: crate::scraps::Kind::Pack, item_id: id.into(), quantity: n }, request)
    }

    #[test]
    fn a_listed_pack_is_fetched_once_kept_only_if_it_matches_and_shown_until_it_ends() {
        let (mut lib, dir) = library();
        let bytes = signed("autumn", 1);
        let now = chrono::Utc::now().timestamp();
        let entry = listed(&bytes, "autumn", 1, None);
        replace_listing(lib.db_mut(), std::slice::from_ref(&entry)).unwrap();
        assert!(live(&lib.db().conn, now).is_empty(), "listed but not fetched yet: not shown");
        assert_eq!(missing(lib.db(), std::slice::from_ref(&entry)).unwrap(), [entry.clone()]);
        // A file that is not the listed one (size, hash, or another pack) is refused.
        assert!(store_listed(&mut lib, &entry, &signed("autumn", 2)).is_err());
        let mut wrong = entry.clone(); wrong.pack_id = "winter".into();
        assert!(store_listed(&mut lib, &wrong, &bytes).is_err());
        assert_eq!(store_listed(&mut lib, &entry, &bytes).unwrap(), Stored::New);
        assert!(missing(lib.db(), std::slice::from_ref(&entry)).unwrap().is_empty());
        let shown = live(&lib.db().conn, now);
        assert_eq!(shown.len(), 1);
        assert_eq!((shown[0].id.as_str(), shown[0].title.as_str(), shown[0].price, shown[0].color.as_deref()), ("shop:autumn", "Autumn Walk", 12, Some("rose")));
        assert_eq!(shown[0].items.iter().map(|i| i.key.as_str()).collect::<Vec<_>>(), ["maple", "acorn", "chestnut"]);
        assert_eq!(live_picture(lib.db(), "shop:autumn", "acorn").as_deref(), Some("shop/autumn/1/acorn.png"));
        assert_eq!(live_picture(lib.db(), "shop:autumn", "../secret"), None);
        // The stored list never keeps the URL.
        assert!(!lib.db().setting(LISTED).unwrap().unwrap().contains("peta.test"));
        // It leaves the shop when its period ends, even offline.
        replace_listing(lib.db_mut(), &[listed(&bytes, "autumn", 1, Some(now - 1))]).unwrap();
        assert!(live(&lib.db().conn, now).is_empty());
        // A list outside the limits keeps the last one.
        for bad in [vec![Listed { sha256: "XYZ".into(), ..entry.clone() }], vec![entry.clone(), entry.clone()], vec![Listed { pack_id: "a.b".into(), ..entry.clone() }], vec![entry.clone(); MAX_LIVE + 1]] {
            assert!(replace_listing(lib.db_mut(), &bad).is_err());
        }
        assert_eq!(listing(&lib.db().conn)[0].ends_at, Some(now - 1));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn buying_puts_sealed_sets_on_the_shelf_at_the_shown_price_and_they_open_after_the_pack_leaves() {
        let (mut lib, dir) = library();
        let bytes = signed("autumn", 1);
        let entry = listed(&bytes, "autumn", 1, None);
        replace_listing(lib.db_mut(), std::slice::from_ref(&entry)).unwrap();
        store_listed(&mut lib, &entry, &bytes).unwrap();
        let status = lib.db().scrap_status().unwrap();
        let rate = status.packs.iter().find(|p| p.id == "shop:autumn").unwrap();
        assert_eq!((rate.exchange, rate.stickers, rate.on_sale), (12, 3, true));
        assert_eq!(status.shop_packs.len(), 1);
        let receipt = buy(&mut lib, "shop:autumn", 2, "two-sets").unwrap();
        assert_eq!((receipt.delta, receipt.balance), (-24, 176), "what the Market shows is what the exchange takes");
        let pack = lib.db().packs().unwrap().into_iter().find(|p| p.id == "shop:autumn").unwrap();
        assert_eq!((pack.title.as_str(), pack.by.as_str(), pack.total, pack.remaining, pack.pouch.as_deref()), ("Autumn Walk", "Peta", 6, 6, Some("matte")));
        assert_eq!(pack.color, Some(PackColor::Rose));
        assert_eq!(pack.blurb.as_deref(), Some("Leaves on the way home."));
        let weights: Vec<u32> = lib.db().conn.prepare("SELECT w.weight FROM pack_items i JOIN pack_item_weights w ON w.item_id=i.id WHERE i.pack_id='shop:autumn' ORDER BY i.id").unwrap()
            .query_map([], |r| r.get(0)).unwrap().map(|w| w.unwrap()).collect();
        assert_eq!(weights, [4, 2, 1, 4, 2, 1]);
        // The bag holds at most 100 sealed stickers; nothing is charged when a purchase would overflow it.
        assert!(buy(&mut lib, "shop:autumn", 32, "too-many").is_err());
        assert_eq!(lib.db().scrap_status().unwrap().balance, 176);
        // When it leaves the shop it can't be bought, but what is on the shelf still opens from the kept pictures.
        assert!(!replace_listing(lib.db_mut(), std::slice::from_ref(&entry)).unwrap(), "the same list again is not a change");
        replace_listing(lib.db_mut(), &[]).unwrap();
        assert!(lib.db().scrap_status().unwrap().packs.iter().all(|p| p.id != "shop:autumn"));
        assert!(buy(&mut lib, "shop:autumn", 1, "after-it-left").is_err());
        let (item, _) = crate::creator_pack::pick(lib.db(), "shop:autumn", 0.0, 0.0).unwrap().unwrap();
        let stored = crate::pack::stored_item(lib.db(), item).unwrap().unwrap();
        assert_eq!((stored.name.as_str(), stored.rarity.as_str(), stored.finished), ("Leaf 0", "common", false));
        assert_eq!(lib.read_asset(&stored.png_path).unwrap(), verify(&bytes).unwrap().pictures[0].1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_shop_setting_moves_the_price_only_within_half_to_double_of_the_signed_price() {
        let (mut lib, dir) = library();
        let bytes = signed("autumn", 1);
        let entry = listed(&bytes, "autumn", 1, None);
        replace_listing(lib.db_mut(), std::slice::from_ref(&entry)).unwrap();
        store_listed(&mut lib, &entry, &bytes).unwrap();
        let at = |d: i64| (chrono::Utc::now() + chrono::Duration::days(d)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        for (price, shown, on_sale) in [(serde_json::json!(20), 20, true), (serde_json::json!(5), 12, true), (serde_json::json!(25), 12, true), (serde_json::Value::Null, 12, false)] {
            let config = crate::signed_config::tests::signed("shop-x", crate::signed_config::SHOP_CONFIG, serde_json::json!({"configId":"shop-x","configKind":"default","featured":["shop:autumn"],"officialFirst":true,"order":["shop:autumn"],"packs":[{"id":"shop:autumn","onSale":!price.is_null(),"price":price,"blurb":null}]}), &at(-1), &at(30));
            crate::signed_config::replace_shop(lib.db_mut(), &[config]).unwrap();
            let rate = lib.db().scrap_status().unwrap().packs.into_iter().find(|p| p.id == "shop:autumn").unwrap();
            assert_eq!((rate.exchange, rate.on_sale), (shown, on_sale));
        }
        assert!(buy(&mut lib, "shop:autumn", 1, "not-on-sale").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn items_with_their_own_weights_are_drawn_by_weight() {
        let mut db = crate::Database::open_in_memory().unwrap();
        db.conn.execute("INSERT INTO packs VALUES ('shop:w','W','Peta','x')", []).unwrap();
        for (key, weight) in [("heavy", 7), ("mid", 2), ("light", 1)] {
            db.conn.execute("INSERT INTO pack_items(pack_id,item_key) VALUES ('shop:w',?1)", [key]).unwrap();
            let id = db.conn.last_insert_rowid();
            db.conn.execute("INSERT INTO signed_pack_items(item_id,png_path,mask_path,material_id,aspect,name,rarity,finished) VALUES (?1,'p.png',NULL,'matte',1,?2,'common',0)", rusqlite::params![id, key]).unwrap();
            db.conn.execute("INSERT INTO pack_item_weights VALUES (?1,?2)", rusqlite::params![id, weight]).unwrap();
        }
        db.conn.execute("INSERT INTO pack_distributions VALUES ('shop:w','w',1,NULL,NULL,'official','kraft')", []).unwrap();
        let drawn = |roll: f64| crate::creator_pack::pick(&db, "shop:w", roll, 0.0).unwrap().unwrap().1;
        assert_eq!((drawn(0.0), drawn(0.69), drawn(0.71), drawn(0.89), drawn(0.95)), ("heavy".into(), "heavy".into(), "mid".into(), "mid".into(), "light".into()));
        let _ = &mut db;
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
