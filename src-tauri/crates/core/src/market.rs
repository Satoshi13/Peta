//! Friend Market: sealed content and durable purchases. The service never receives a content key.
use chacha20poly1305::{aead::{Aead, KeyInit, Payload}, ChaCha20Poly1305};
use rand_core::{OsRng, RngCore};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use crate::{creator_pack::{self, Header, Layout}, db::now, edition_pack::{self, Award, Prize}, ownership::{self as o, Chain, PurchaseAck, Referee, RefereeError, Transfer},
    scraps::{self, Kind}, sign, Database, Error, Library, Result};

pub const FRIEND_PULL_PRICE: u32 = 6;
pub const SELLER_CUT_PERMILLE: u32 = 700;
pub const MARKET_PULLS_PER_DAY: u32 = 20;
pub const MARKET_LISTINGS: u32 = 10;
pub const MARKET_CARD_MAX: usize = 1024 * 1024;
pub const MARKET_PACK_MAX: usize = 24 * 1024 * 1024;
pub const SEALED_OVERHEAD: usize = 36;
const MAGIC: &[u8; 8] = b"PETAMKT1";
fn invalid() -> Error { Error::Invalid("This Market package is damaged or was sealed for another listing.".into()) }
pub fn new_content_key() -> [u8; 32] { let mut key = [0; 32]; OsRng.fill_bytes(&mut key); key }
pub fn new_id() -> String {
    use base64::Engine;
    let mut bytes = [0; 16]; OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}
fn context(listing: &str, kind: &str) -> Result<Vec<u8>> {
    if listing.len() != 22 || !listing.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') || !matches!(kind, "card" | "pack") { return Err(invalid()); }
    Ok([b"peta.market.v1".as_slice(), listing.as_bytes(), kind.as_bytes()].concat())
}
fn seal_nonce(key: &[u8; 32], listing: &str, kind: &str, plain: &[u8], nonce: &[u8; 12]) -> Result<Vec<u8>> {
    let limit = if kind == "card" { MARKET_CARD_MAX } else { MARKET_PACK_MAX };
    if plain.len() > limit { return Err(invalid()); }
    let ct = ChaCha20Poly1305::new(key.into()).encrypt(nonce.into(), Payload { msg: plain, aad: &context(listing, kind)? }).map_err(|_| invalid())?;
    Ok([MAGIC.as_slice(), nonce, &ct].concat())
}
pub fn seal(key: &[u8; 32], listing: &str, kind: &str, plain: &[u8]) -> Result<Vec<u8>> {
    let mut nonce = [0; 12]; OsRng.fill_bytes(&mut nonce); seal_nonce(key, listing, kind, plain, &nonce)
}
pub fn open(key: &[u8; 32], listing: &str, kind: &str, sealed: &[u8]) -> Result<Vec<u8>> {
    let limit = if kind == "card" { MARKET_CARD_MAX } else { MARKET_PACK_MAX };
    if sealed.len() < SEALED_OVERHEAD || sealed.len() > limit + SEALED_OVERHEAD || &sealed[..8] != MAGIC { return Err(invalid()); }
    ChaCha20Poly1305::new(key.into()).decrypt(sealed[8..20].into(), Payload { msg: &sealed[20..], aad: &context(listing, kind)? }).map_err(|_| invalid())
}
pub fn envelope(enc_key: &str, listing: &str, key: &[u8; 32]) -> Result<Vec<u8>> {
    context(listing, "card")?;
    crate::identity::seal(enc_key, &[b"peta.market.key.v1".as_slice(), listing.as_bytes()].concat(), key)
}
pub fn open_envelope(root: &std::path::Path, listing: &str, sealed: &[u8]) -> Result<[u8; 32]> {
    context(listing, "card")?;
    crate::identity::open(root, &[b"peta.market.key.v1".as_slice(), listing.as_bytes()].concat(), sealed)?.try_into().map_err(|_| invalid())
}


fn refused(message: &str) -> Error { Error::Invalid(message.into()) }
fn rejected(code: &str) -> Error { RefereeError::Rejected(code.into()).into() }
fn text(value: &impl Serialize) -> Result<String> { serde_json::to_string(value).map_err(|e| Error::Invalid(e.to_string())) }
fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> Result<()> {
    if let Some(dir) = path.parent() { std::fs::create_dir_all(dir)?; }
    let tmp = path.with_extension(format!("tmp-{}", new_id()));
    std::fs::write(&tmp, bytes)?; std::fs::rename(&tmp, path)?; Ok(())
}
fn outbox(lib: &Library, listing: &str, kind: &str) -> std::path::PathBuf { lib.root().join("market").join("outbox").join(format!("{listing}.{kind}")) }
fn card_file(lib: &Library, listing: &str) -> std::path::PathBuf { lib.root().join("market").join("cards").join(format!("{listing}.json")) }

/* ---------- The card: what friends see before they pull ---------- */

/// One design or prize line, in the signed header's slot order (designs first, then prizes).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CardLine { pub name: String, pub kind: String, pub rarity: Option<String>, pub material_id: Option<String>, pub total: u32 }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Peek { pub name: String, pub png: String }
/// Sealed with the listing's content key. It carries no author name: a friend's own name for the seller is shown instead.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Card {
    pub version: u32, pub external_id: String, pub pack_digest: String, pub title: String, pub blurb: Option<String>, pub pouch: String,
    pub cover: Option<String>, pub deco: Option<String>, pub layout: Option<Layout>, pub designs: Vec<CardLine>, pub prizes: Vec<CardLine>, pub peek: Vec<Peek>,
}
/// Up to three designs to peek at: by fewest editions, leaving out the very rarest when there are more than three (provisional rule).
fn peek_order(h: &Header) -> Vec<usize> {
    let mut order: Vec<usize> = (0..h.items.len()).collect();
    order.sort_by_key(|i| (h.items[*i].copies.unwrap_or(0), *i));
    if order.len() > 3 { order.remove(0); }
    order.truncate(3); order
}
pub(crate) fn build_card(h: &Header, items: &[(Vec<u8>, Vec<u8>)], pack_digest: &str) -> Result<Vec<u8>> {
    let designs = h.items.iter().map(|i| CardLine { name: i.name.clone(), kind: "sticker".into(), rarity: Some(i.rarity.clone()), material_id: Some(i.material_id.clone()), total: i.copies.unwrap_or(0) }).collect();
    let prizes = h.prizes.iter().map(|p| match p {
        Prize::Material { material_id, count } => CardLine { name: crate::materials::get(material_id).map(|m| m.name).unwrap_or_else(|| material_id.clone()), kind: "material".into(), rarity: None, material_id: Some(material_id.clone()), total: *count },
        Prize::Tag { count } => CardLine { name: "Link tag".into(), kind: "tag".into(), rarity: None, material_id: None, total: *count },
    }).collect();
    let mut card = Card { version: 1, external_id: h.pack_id.clone(), pack_digest: pack_digest.into(), title: h.title.clone(), blurb: h.blurb.clone(), pouch: h.pouch.clone(),
        cover: h.cover.clone(), deco: h.deco.clone(), layout: h.layout.clone(), designs, prizes, peek: vec![] };
    let mut bytes = serde_json::to_vec(&card).map_err(|e| Error::Invalid(e.to_string()))?;
    if bytes.len() > MARKET_CARD_MAX { return Err(refused("This pack's description is too large for Market.")); }
    // Peek pictures go in while they fit; a large picture is left out rather than making the card too big.
    for i in peek_order(h) {
        card.peek.push(Peek { name: h.items[i].name.clone(), png: STANDARD.encode(&items[i].0) });
        let next = serde_json::to_vec(&card).map_err(|e| Error::Invalid(e.to_string()))?;
        if next.len() > MARKET_CARD_MAX { card.peek.pop(); } else { bytes = next; }
    }
    Ok(bytes)
}
fn parse_card(bytes: &[u8]) -> Result<Card> {
    let card: Card = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    if card.version != 1 || card.peek.len() > 3 || card.designs.len() + card.prizes.len() > edition_pack::MAX_PACK_SLOTS as usize { return Err(invalid()); }
    for p in &card.peek { if STANDARD.decode(&p.png).map_err(|_| invalid())?.len() > MARKET_CARD_MAX { return Err(invalid()); } }
    Ok(card)
}
/// How many slots of each card line are taken, from the service's list of claimed slots (same order as `edition_pack::sales`).
pub fn card_taken(card: &Card, claimed: &[u32]) -> Vec<u32> {
    let claimed: std::collections::BTreeSet<u32> = claimed.iter().copied().collect();
    let mut next = 0u32;
    card.designs.iter().chain(&card.prizes).map(|l| { let n = claimed.range(next..next + l.total).count() as u32; next += l.total; n }).collect()
}

/* ---------- Seller: listing a finished own pack ---------- */

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub pack_id: String, pub listing_id: String, pub external_id: String, pub price: u32, pub state: String,
    pub card_digest: String, pub card_size: u64, pub pack_digest: String, pub pack_size: u64,
    pub registered: bool, pub card_uploaded: bool, pub pack_uploaded: bool, pub earned: i64,
}
/// The registration body the service checks (`POST /v1/market/listings`).
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Registration { pub listing_id: String, pub pack_id: String, pub price: u32, pub card_digest: String, pub card_size: u64, pub pack_digest: String, pub pack_size: u64 }
impl Listing {
    pub fn registration(&self) -> Registration {
        Registration { listing_id: self.listing_id.clone(), pack_id: self.external_id.clone(), price: self.price, card_digest: self.card_digest.clone(), card_size: self.card_size, pack_digest: self.pack_digest.clone(), pack_size: self.pack_size }
    }
}
const LISTING_COLUMNS: &str = "l.pack_id,l.listing_id,l.external_id,l.state,l.card_digest,l.card_size,l.pack_digest,l.pack_size,l.registered,l.card_uploaded,l.pack_uploaded,COALESCE((SELECT cut_milli FROM market_earned e WHERE e.external_id=l.external_id),0)";
fn listing_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Listing> {
    Ok(Listing { pack_id: r.get(0)?, listing_id: r.get(1)?, external_id: r.get(2)?, price: FRIEND_PULL_PRICE, state: r.get(3)?, card_digest: r.get(4)?, card_size: r.get(5)?,
        pack_digest: r.get(6)?, pack_size: r.get(7)?, registered: r.get(8)?, card_uploaded: r.get(9)?, pack_uploaded: r.get(10)?, earned: r.get::<_, i64>(11)? / 1000 })
}
pub fn listing(db: &Database, pack_id: &str) -> Result<Option<Listing>> {
    Ok(db.conn.query_row(&format!("SELECT {LISTING_COLUMNS} FROM market_my_listings l WHERE l.pack_id=?1"), [pack_id], listing_row).optional()?)
}
pub fn listings(db: &Database) -> Result<Vec<Listing>> {
    let mut stmt = db.conn.prepare(&format!("SELECT {LISTING_COLUMNS} FROM market_my_listings l ORDER BY l.created_at"))?;
    let rows = stmt.query_map([], listing_row)?.collect::<std::result::Result<Vec<_>, _>>()?; Ok(rows)
}
fn listing_by_id(db: &Database, listing_id: &str) -> Result<Listing> {
    db.conn.query_row(&format!("SELECT {LISTING_COLUMNS} FROM market_my_listings l WHERE l.listing_id=?1"), [listing_id], listing_row).optional()?.ok_or_else(|| refused("Unknown listing."))
}
/// Start (or resume) selling a finished own pack to friends. The card and pack are sealed once with a fresh content key and kept in
/// this Library until uploaded, so a retry sends exactly the bytes that were registered. A closed listing is never reopened.
pub fn prepare_listing(lib: &mut Library, pack_id: &str) -> Result<Listing> {
    if let Some(existing) = listing(lib.db(), pack_id)? {
        if existing.state == "closed" { return Err(refused("This pack stopped selling. Make a new pack to sell again.")); }
        return Ok(existing);
    }
    let public = sign::public_key(&crate::device_key::load(&lib.root().join("device.key"))?);
    let row: Option<(String, String)> = lib.db().conn.query_row("SELECT f.header,d.public_key FROM packs p JOIN edition_pack_frames f ON f.pack_id=p.id JOIN pack_distributions d ON d.pack_id=p.id WHERE p.id=?1",
        [pack_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    let (json, owner) = row.ok_or_else(|| refused("Only finished packs on My shelf can be sold."))?;
    let header: Header = serde_json::from_str(&json).map_err(|_| refused("The finished pack metadata is damaged."))?;
    if owner != public || creator_pack::public(&header)? != public || creator_pack::internal_id(&header)? != pack_id { return Err(refused("Only your own finished packs can be sold.")); }
    let pre: bool = lib.db().conn.query_row("SELECT pre_server FROM server_pack_state WHERE pack_id=?1", [pack_id], |r| r.get(0)).optional()?.unwrap_or(false);
    if pre || crate::server::pending_cancel(lib.db(), &header.pack_id)? { return Err(refused("Peta hasn't checked this pack yet, so it can't be sold.")); }
    let bytes = edition_pack::archived_bytes(lib, pack_id)?;
    if bytes.len() > MARKET_PACK_MAX { return Err(refused("This pack is too large for Market.")); }
    let verified = creator_pack::decode(&bytes)?;
    let card = build_card(&verified.header, &verified.items, &o::digest(&bytes))?;
    let (listing_id, key) = (new_id(), new_content_key());
    let (sealed_card, sealed_pack) = (seal(&key, &listing_id, "card", &card)?, seal(&key, &listing_id, "pack", &bytes)?);
    write_atomic(&outbox(lib, &listing_id, "card"), &sealed_card)?; write_atomic(&outbox(lib, &listing_id, "pack"), &sealed_pack)?;
    lib.db().conn.execute("INSERT INTO market_my_listings(pack_id,listing_id,external_id,content_key,state,card_digest,card_size,pack_digest,pack_size,created_at,updated_at) VALUES (?1,?2,?3,?4,'draft',?5,?6,?7,?8,?9,?9)",
        params![pack_id, listing_id, header.pack_id, key.to_vec(), o::digest(&sealed_card), sealed_card.len() as u64, o::digest(&sealed_pack), sealed_pack.len() as u64, now()])?;
    listing(lib.db(), pack_id)?.ok_or_else(|| refused("The listing could not be saved."))
}
/// The exact sealed bytes registered for an upload.
pub fn upload_bytes(lib: &Library, listing_id: &str, kind: &str) -> Result<Vec<u8>> {
    let l = listing_by_id(lib.db(), listing_id)?;
    let bytes = std::fs::read(outbox(lib, listing_id, kind)).map_err(|_| refused("The sealed copy of this listing is missing. Stop selling and list a new pack."))?;
    let (digest, size) = if kind == "card" { (&l.card_digest, l.card_size) } else { (&l.pack_digest, l.pack_size) };
    if o::digest(&bytes) != *digest || bytes.len() as u64 != size { return Err(invalid()); }
    Ok(bytes)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Progress { Registered, CardUploaded, PackUploaded, Open, Paused, Closed }
/// Record a step the service confirmed. Open/pause/close also mirror the listing in this Mac's Market (`pack_market_listings`).
pub fn record(lib: &mut Library, listing_id: &str, step: Progress) -> Result<Listing> {
    let l = listing_by_id(lib.db(), listing_id)?;
    let tx = lib.db_mut().conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let set = |column: &str| tx.execute(&format!("UPDATE market_my_listings SET {column},updated_at=?2 WHERE listing_id=?1"), params![listing_id, now()]);
    match step {
        Progress::Registered => { set("registered=1")?; }
        Progress::CardUploaded => { set("card_uploaded=1")?; }
        Progress::PackUploaded => { set("pack_uploaded=1")?; }
        Progress::Open => { if l.state == "closed" { return Err(rejected("listing_closed")); } set("state='open'")?; tx.execute("INSERT INTO pack_market_listings(pack_id,listed_at) VALUES (?1,?2) ON CONFLICT(pack_id) DO NOTHING", params![l.pack_id, now()])?; }
        Progress::Paused => { if l.state == "closed" { return Err(rejected("listing_closed")); } set("state='paused'")?; tx.execute("DELETE FROM pack_market_listings WHERE pack_id=?1", [&l.pack_id])?; }
        Progress::Closed => { set("state='closed'")?; tx.execute("DELETE FROM pack_market_listings WHERE pack_id=?1", [&l.pack_id])?; tx.execute("DELETE FROM market_envelopes_sent WHERE listing_id=?1", [listing_id])?; }
    }
    tx.commit()?;
    if matches!(step, Progress::Open | Progress::Closed) { for kind in ["card", "pack"] { let _ = std::fs::remove_file(outbox(lib, listing_id, kind)); } }
    listing_by_id(lib.db(), listing_id)
}
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeAdd { pub to: String, pub sealed: String }
/// The service's envelope update for one listing, and the friends' keys it stands for.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EnvelopeChanges { pub add: Vec<EnvelopeAdd>, pub remove: Vec<String>, pub added_keys: Vec<String>, pub removed_keys: Vec<String> }
impl EnvelopeChanges {
    pub fn is_empty(&self) -> bool { self.add.is_empty() && self.remove.is_empty() }
    pub fn body(&self) -> serde_json::Value { serde_json::json!({"add": self.add, "remove": self.remove}) }
}
/// Approved friends get an envelope; anyone else loses theirs. At most 200 changes per call, like the service.
pub fn envelope_changes(lib: &Library, listing_id: &str) -> Result<EnvelopeChanges> {
    let key: Vec<u8> = lib.db().conn.query_row("SELECT content_key FROM market_my_listings WHERE listing_id=?1 AND state!='closed'", [listing_id], |r| r.get(0)).optional()?.ok_or_else(|| refused("Unknown listing."))?;
    let key: [u8; 32] = key.try_into().map_err(|_| invalid())?;
    let friends: Vec<(String, String)> = crate::friends::list(&lib.db().conn)?.into_iter().filter(|f| f.status == "friend").filter_map(|f| f.enc_key.map(|e| (f.public_key, e))).collect();
    let sent: Vec<String> = { let mut stmt = lib.db().conn.prepare("SELECT recipient_key FROM market_envelopes_sent WHERE listing_id=?1")?; let rows = stmt.query_map([listing_id], |r| r.get(0))?.collect::<std::result::Result<Vec<_>, _>>()?; rows };
    let mut changes = EnvelopeChanges::default();
    for (public, enc) in &friends {
        if changes.add.len() + changes.remove.len() >= 200 { break; }
        if sent.contains(public) { continue; }
        changes.add.push(EnvelopeAdd { to: crate::identity::key_hash(public)?, sealed: STANDARD.encode(envelope(enc, listing_id, &key)?) });
        changes.added_keys.push(public.clone());
    }
    for public in sent.iter().filter(|k| !friends.iter().any(|(f, _)| f == *k)) {
        if changes.add.len() + changes.remove.len() >= 200 { break; }
        changes.remove.push(crate::identity::key_hash(public)?); changes.removed_keys.push(public.clone());
    }
    Ok(changes)
}
pub fn envelopes_sent(lib: &mut Library, listing_id: &str, changes: &EnvelopeChanges) -> Result<()> {
    let tx = lib.db_mut().conn.transaction()?;
    for k in &changes.added_keys { tx.execute("INSERT OR IGNORE INTO market_envelopes_sent VALUES (?1,?2)", params![listing_id, k])?; }
    for k in &changes.removed_keys { tx.execute("DELETE FROM market_envelopes_sent WHERE listing_id=?1 AND recipient_key=?2", params![listing_id, k])?; }
    tx.commit()?; Ok(())
}

/* ---------- Buyer: friends' listings, their cards and pull-only packs ---------- */

/// One row of `GET /v1/market/listings`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteListing {
    pub listing_id: String, pub seller_hash: String, pub pack_id: String, pub price: u32, pub state: String, pub slot_count: u32, pub slots_left: u32,
    pub sealed: String, pub card_digest: String, pub pack_digest: String, pub updated_at: i64,
}
/// A friend's listing as this Mac last saw it. `card` is missing until it has been fetched.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Seen {
    pub listing_id: String, pub seller_key: String, pub seller_name: String, pub external_id: String, pub price: u32, pub state: String,
    pub slot_count: u32, pub slots_left: u32, pub card: Option<Card>, pub pack_id: Option<String>, pub fetched_at: String,
}
/// Replace the saved list with the service's. Only approved friends' listings are kept, and only those whose envelope opens here.
/// Returns the listings whose card must be fetched.
pub fn store_seen(lib: &mut Library, remote: &[RemoteListing]) -> Result<Vec<String>> {
    let friends: Vec<(String, String)> = crate::friends::list(&lib.db().conn)?.into_iter().filter(|f| f.status == "friend")
        .map(|f| Ok((crate::identity::key_hash(&f.public_key)?, f.public_key))).collect::<Result<Vec<_>>>()?;
    let mut keep = Vec::new(); let mut fetch = Vec::new();
    for r in remote {
        let Some((_, seller)) = friends.iter().find(|(h, _)| *h == r.seller_hash) else { continue };
        if r.price != FRIEND_PULL_PRICE || !matches!(r.state.as_str(), "open" | "paused") { continue; }
        let Ok(sealed) = STANDARD.decode(&r.sealed) else { continue };
        let Ok(key) = open_envelope(lib.root(), &r.listing_id, &sealed) else { continue };
        keep.push((r.clone(), seller.clone(), key));
    }
    let gone: Vec<String> = { let mut stmt = lib.db().conn.prepare("SELECT listing_id FROM market_listings_seen")?; let rows = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<std::result::Result<Vec<_>, _>>()?; rows }
        .into_iter().filter(|id| !keep.iter().any(|(r, _, _)| r.listing_id == *id)).collect();
    let tx = lib.db_mut().conn.transaction()?;
    for id in &gone { tx.execute("DELETE FROM market_listings_seen WHERE listing_id=?1", [id])?; }
    for (r, seller, key) in &keep {
        let old: Option<(String, Option<String>)> = tx.query_row("SELECT card_digest,card_path FROM market_listings_seen WHERE listing_id=?1", [&r.listing_id], |row| Ok((row.get(0)?, row.get(1)?))).optional()?;
        let card_path = old.and_then(|(d, p)| if d == r.card_digest { p } else { None });
        if card_path.is_none() { fetch.push(r.listing_id.clone()); }
        tx.execute("INSERT INTO market_listings_seen VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(listing_id) DO UPDATE SET seller_key=excluded.seller_key,external_id=excluded.external_id,price=excluded.price,state=excluded.state,slot_count=excluded.slot_count,slots_left=excluded.slots_left,card_digest=excluded.card_digest,pack_digest=excluded.pack_digest,content_key=excluded.content_key,card_path=excluded.card_path,fetched_at=excluded.fetched_at",
            params![r.listing_id, seller, r.pack_id, r.price, r.state, r.slot_count, r.slots_left, r.card_digest, r.pack_digest, key.to_vec(), card_path, now()])?;
    }
    tx.commit()?;
    for id in &gone { let _ = std::fs::remove_file(card_file(lib, id)); }
    Ok(fetch)
}
fn seen_key(db: &Database, listing_id: &str) -> Result<([u8; 32], String, String, String, String)> {
    let (key, digest, pack_digest, seller, external): (Option<Vec<u8>>, String, String, String, String) = db.conn.query_row(
        "SELECT content_key,card_digest,pack_digest,seller_key,external_id FROM market_listings_seen WHERE listing_id=?1", [listing_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).optional()?.ok_or_else(|| rejected("listing_closed"))?;
    Ok((key.ok_or_else(invalid)?.try_into().map_err(|_| invalid())?, digest, pack_digest, seller, external))
}
/// Check and keep a fetched card (`GET .../card`).
pub fn store_card(lib: &mut Library, listing_id: &str, sealed: &[u8]) -> Result<Card> {
    let (key, digest, _, _, external) = seen_key(lib.db(), listing_id)?;
    if o::digest(sealed) != digest { return Err(invalid()); }
    let plain = open(&key, listing_id, "card", sealed)?; let card = parse_card(&plain)?;
    if card.external_id != external { return Err(invalid()); }
    let path = card_file(lib, listing_id); write_atomic(&path, &plain)?;
    lib.db().conn.execute("UPDATE market_listings_seen SET card_path=?2 WHERE listing_id=?1", params![listing_id, path.to_string_lossy()])?;
    Ok(card)
}
pub fn seen(lib: &Library) -> Result<Vec<Seen>> {
    let names: std::collections::HashMap<String, String> = crate::friends::list(&lib.db().conn)?.into_iter().filter(|f| f.status == "friend").map(|f| (f.public_key, f.name)).collect();
    let mut stmt = lib.db().conn.prepare("SELECT s.listing_id,s.seller_key,s.external_id,s.price,s.state,s.slot_count,s.slots_left,s.card_path,s.fetched_at,m.pack_id FROM market_listings_seen s LEFT JOIN market_packs m ON m.listing_id=s.listing_id ORDER BY s.seller_key,s.listing_id")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, u32>(3)?, r.get::<_, String>(4)?, r.get::<_, u32>(5)?, r.get::<_, u32>(6)?, r.get::<_, Option<String>>(7)?, r.get::<_, String>(8)?, r.get::<_, Option<String>>(9)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows.into_iter().filter_map(|(listing_id, seller_key, external_id, price, state, slot_count, slots_left, card_path, fetched_at, pack_id)| {
        let seller_name = names.get(&seller_key)?.clone();
        let card = card_path.and_then(|p| std::fs::read(p).ok()).and_then(|b| parse_card(&b).ok());
        Some(Seen { listing_id, seller_key, seller_name, external_id, price, state, slot_count, slots_left, card, pack_id, fetched_at })
    }).collect())
}
pub fn is_market_pack(db: &Database, pack_id: &str) -> Result<bool> { Ok(db.conn.query_row("SELECT EXISTS(SELECT 1 FROM market_packs WHERE pack_id=?1)", [pack_id], |r| r.get(0))?) }
/// The title of a pull-only pack (those packs are not in `Database::packs`).
pub fn pack_title(db: &Database, pack_id: &str) -> Result<String> { Ok(db.conn.query_row("SELECT title FROM packs WHERE id=?1", [pack_id], |r| r.get(0))?) }
/// The local pack for a listing, once fetched.
pub fn market_pack(db: &Database, listing_id: &str) -> Result<Option<String>> { Ok(db.conn.query_row("SELECT pack_id FROM market_packs WHERE listing_id=?1", [listing_id], |r| r.get(0)).optional()?) }
/// Check and install a fetched pack (`GET .../pack`) as pull-only: never on the Packs shelf, never opened for free.
pub fn install_pack(lib: &mut Library, listing_id: &str, sealed: &[u8]) -> Result<String> {
    if let Some(existing) = market_pack(lib.db(), listing_id)? { return Ok(existing); }
    let (key, _, digest, seller, external) = seen_key(lib.db(), listing_id)?;
    let card_path: Option<String> = lib.db().conn.query_row("SELECT card_path FROM market_listings_seen WHERE listing_id=?1", [listing_id], |r| r.get(0))?;
    let card = parse_card(&std::fs::read(card_path.ok_or_else(invalid)?)?)?;
    if o::digest(sealed) != digest { return Err(invalid()); }
    let plain = open(&key, listing_id, "pack", sealed)?;
    if o::digest(&plain) != card.pack_digest { return Err(invalid()); }
    let verified = creator_pack::decode(&plain)?;
    if verified.header.pack_id != external || creator_pack::public(&verified.header)? != seller || !verified.header.items.iter().any(|i| i.copies.is_some()) { return Err(invalid()); }
    let listing = listing_id.to_owned();
    edition_pack::install_with(lib, &verified, |tx, id| { tx.execute("INSERT INTO market_packs VALUES (?1,?2,?3,?4)", params![id, listing, seller, now()])?; Ok(()) })
}

/* ---------- Buyer: one paid pull ---------- */

/// A paid pull waiting for (or being retried with) the service. The same pull id, slot and signature are always resent together.
#[derive(Clone, Debug, PartialEq)]
pub struct PullStart { pub pull_id: String, pub listing_id: String, pub pack_id: String, pub external_id: String, pub slot: u32, pub claim: Option<Transfer>, pub price: u32 }
fn start_row(db: &Connection, pull_id: &str) -> Result<Option<(PullStart, String)>> {
    Ok(db.query_row("SELECT p.pull_id,p.listing_id,p.pack_id,s.external_id,p.slot_no,p.claim,p.quoted_price,p.state FROM market_pulls p JOIN pack_distributions s ON s.pack_id=p.pack_id WHERE p.pull_id=?1",
        [pull_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, u32>(4)?, r.get::<_, Option<String>>(5)?, r.get::<_, u32>(6)?, r.get::<_, String>(7)?))).optional()?
        .map(|(pull_id, listing_id, pack_id, external_id, slot, claim, price, state)| Ok::<_, Error>((PullStart { pull_id, listing_id, pack_id, external_id, slot, claim: claim.map(|c| serde_json::from_str(&c)).transpose().map_err(|_| invalid())?, price }, state))).transpose()?)
}
pub fn pending_pulls(db: &Database) -> Result<Vec<PullStart>> {
    let ids: Vec<String> = { let mut stmt = db.conn.prepare("SELECT pull_id FROM market_pulls WHERE state='pending' ORDER BY created_at")?; let rows = stmt.query_map([], |r| r.get(0))?.collect::<std::result::Result<Vec<_>, _>>()?; rows };
    ids.iter().filter_map(|id| start_row(&db.conn, id).transpose()).map(|r| r.map(|(s, _)| s)).collect()
}
fn pending_for(db: &Database, pack_id: &str) -> Result<Option<PullStart>> {
    let id: Option<String> = db.conn.query_row("SELECT pull_id FROM market_pulls WHERE pack_id=?1 AND state='pending'", [pack_id], |r| r.get(0)).optional()?;
    Ok(match id { Some(id) => start_row(&db.conn, &id)?.map(|(s, _)| s), None => None })
}
/// Slots others already hold, from the service: they are never drawn here.
pub fn exclude_slots(lib: &mut Library, pack_id: &str, slots: &[u32]) -> Result<()> {
    let tx = lib.db_mut().conn.transaction()?;
    for slot in slots { tx.execute("INSERT OR IGNORE INTO pack_slot_exclusions VALUES (?1,?2)", params![pack_id, slot])?; }
    tx.commit()?; Ok(())
}
/// Draw a free slot and sign its claim (nothing is saved).
fn draw(lib: &Library, pack_id: &str, external: &str, roll: f64) -> Result<Option<(i64, u32, Option<Transfer>)>> {
    let Some((row, _)) = edition_pack::pick(lib.db(), pack_id, roll)? else { return Ok(None) };
    let (kind, slot, saved, png): (String, u32, Option<String>, String) = lib.db().conn.query_row(
        "SELECT s.kind,e.slot_no,e.chain,s.png_path FROM signed_pack_items s JOIN edition_pack_slots e ON e.item_id=s.item_id WHERE s.item_id=?1", [row], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
    let claim = if kind == "sticker" {
        let png = lib.read_asset(&png)?;
        let mut chain: Chain = serde_json::from_str(saved.as_deref().ok_or_else(invalid)?).map_err(|_| invalid())?;
        o::sticker_chain_verify(&chain, &png)?;
        let key = crate::device_key::load_or_create(lib.root())?;
        Some(o::append(&mut chain, "claim", &edition_pack::slot_ref(external, slot), &key)?)
    } else { None };
    Ok(Some((row, slot, claim)))
}
/// Pay for one pull and record it, in one transaction. A pull already waiting for this pack is resumed instead (it was paid).
/// `unrestricted` (developer edition) records the price but takes no Scraps.
pub fn prepare_pull(lib: &mut Library, pack_id: &str, roll: f64, unrestricted: bool) -> Result<PullStart> {
    if let Some(pending) = pending_for(lib.db(), pack_id)? { return Ok(pending); }
    let (listing_id, seller): (String, String) = lib.db().conn.query_row("SELECT listing_id,seller_key FROM market_packs WHERE pack_id=?1", [pack_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?.ok_or_else(|| refused("This pack isn't from a friend's Market."))?;
    let (state, price): (String, u32) = lib.db().conn.query_row("SELECT state,price FROM market_listings_seen WHERE listing_id=?1", [&listing_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?.ok_or_else(|| rejected("listing_closed"))?;
    if state != "open" { return Err(rejected("listing_closed")); }
    if seller == sign::public_key(&crate::device_key::load_or_create(lib.root())?) { return Err(rejected("own_pack")); }
    let external: String = lib.db().conn.query_row("SELECT external_id FROM pack_distributions WHERE pack_id=?1", [pack_id], |r| r.get(0))?;
    let (row, slot, claim) = draw(lib, pack_id, &external, roll)?.ok_or_else(|| rejected("sold_out"))?;
    let pull_id = new_id(); let debit = if unrestricted { 0 } else { i64::from(price) };
    let tx = lib.db_mut().conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    scraps::market_move(&tx, Kind::Pull, &listing_id, &format!("pull-{pull_id}"), -debit)?;
    tx.execute("INSERT INTO market_pulls(pull_id,listing_id,pack_id,slot_no,item_id,quoted_price,debited,claim,state,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending',?9)",
        params![pull_id, listing_id, pack_id, slot, row, price, debit, claim.as_ref().map(text).transpose()?, now()])?;
    tx.commit()?;
    Ok(PullStart { pull_id, listing_id, pack_id: pack_id.into(), external_id: external, slot, claim, price })
}
/// Give the Scraps back: the service said this pull never happened.
pub fn refund_pull(lib: &mut Library, pull_id: &str, code: &str) -> Result<()> {
    let tx = lib.db_mut().conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let row: Option<(String, i64, String)> = tx.query_row("SELECT state,debited,listing_id FROM market_pulls WHERE pull_id=?1", [pull_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
    let Some((state, debited, listing)) = row else { return Err(refused("Unknown pull.")) };
    if state != "pending" { return Ok(()); }
    scraps::market_move(&tx, Kind::Pull, &listing, &format!("refund-{pull_id}"), debited)?;
    tx.execute("UPDATE market_pulls SET state='refunded',failure=?2,finished_at=?3 WHERE pull_id=?1", params![pull_id, code, now()])?;
    tx.commit()?; Ok(())
}
/// After `slot_taken`: someone else holds that slot, so the same paid pull moves to another one. After three tries (or when no
/// slot is left) the pull is refunded and the reason returned.
pub enum Retry { Next(PullStart), Refunded(String) }
pub fn retry_pull(lib: &mut Library, pull_id: &str, roll: f64) -> Result<Retry> {
    let (start, state) = start_row(&lib.db().conn, pull_id)?.ok_or_else(|| refused("Unknown pull."))?;
    if state != "pending" { return Err(refused("This pull is already finished.")); }
    exclude_slots(lib, &start.pack_id, &[start.slot])?;
    let attempts: u32 = lib.db().conn.query_row("SELECT attempts FROM market_pulls WHERE pull_id=?1", [pull_id], |r| r.get(0))?;
    let next = if attempts >= 3 { None } else { draw(lib, &start.pack_id, &start.external_id, roll)? };
    let Some((row, slot, claim)) = next else {
        let code = if edition_pack::pick(lib.db(), &start.pack_id, 0.0)?.is_some() { "busy_pack" } else { "sold_out" };
        refund_pull(lib, pull_id, code)?; return Ok(Retry::Refunded(code.into()));
    };
    lib.db().conn.execute("UPDATE market_pulls SET slot_no=?2,item_id=?3,claim=?4,attempts=attempts+1 WHERE pull_id=?1 AND state='pending'", params![pull_id, slot, row, claim.as_ref().map(text).transpose()?])?;
    Ok(Retry::Next(PullStart { slot, claim, ..start }))
}
/// The service confirmed the sale: put the edition or prize in this Library. Finishing twice returns the first result.
pub fn finish_pull(lib: &mut Library, pull_id: &str, ack: &PurchaseAck, date: &str, queue: bool) -> Result<Award> {
    let (state, award, pack_id, row, claim): (String, Option<String>, String, i64, Option<String>) = lib.db().conn.query_row(
        "SELECT state,award,pack_id,item_id,claim FROM market_pulls WHERE pull_id=?1", [pull_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).optional()?.ok_or_else(|| refused("Unknown pull."))?;
    if state == "done" { return serde_json::from_str(award.as_deref().ok_or_else(invalid)?).map_err(|_| invalid()); }
    if state != "pending" { return Err(refused("This pull was refunded.")); }
    let metadata = crate::pack::stored_item(lib.db(), row)?.ok_or_else(|| refused("Missing slot."))?;
    let (kind, prize, saved): (String, Option<String>, Option<String>) = lib.db().conn.query_row("SELECT s.kind,s.prize_ref,e.chain FROM signed_pack_items s JOIN edition_pack_slots e ON e.item_id=s.item_id WHERE s.item_id=?1", [row], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    let chain = match (kind.as_str(), claim) {
        ("sticker", Some(claim)) => {
            let mut chain: Chain = serde_json::from_str(saved.as_deref().ok_or_else(invalid)?).map_err(|_| invalid())?;
            chain.transfers.push(serde_json::from_str(&claim).map_err(|_| invalid())?);
            o::sticker_chain_verify(&chain, &lib.read_asset(&metadata.png_path)?)?; Some(chain)
        }
        ("sticker", None) => return Err(invalid()),
        _ => None,
    };
    let title: String = lib.db().conn.query_row("SELECT title FROM packs WHERE id=?1", [&pack_id], |r| r.get(0))?;
    let tx = lib.db_mut().conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if !tx.query_row("SELECT EXISTS(SELECT 1 FROM pack_items WHERE id=?1 AND pack_id=?2 AND opened_at IS NULL)", params![row, pack_id], |r| r.get::<_, bool>(0))? { return Err(refused("That slot was already opened.")); }
    let award = edition_pack::award_in(&tx, &pack_id, row, &metadata, &kind, prize, chain, true, &title, false, date, queue)?;
    tx.execute("UPDATE market_pulls SET state='done',sale_id=?2,slots_left=?3,award=?4,finished_at=?5 WHERE pull_id=?1", params![pull_id, ack.sale_id, ack.slots_left, text(&award)?, now()])?;
    tx.execute("UPDATE market_listings_seen SET slots_left=?2 WHERE listing_id=(SELECT listing_id FROM market_pulls WHERE pull_id=?1)", params![pull_id, ack.slots_left])?;
    tx.commit()?; Ok(award)
}
/// Refusals that prove the sale never happened (the service accepts an exact resend of a confirmed sale even after
/// a friendship ends or a key is blocked). Anything else keeps the paid pull waiting to be resent.
fn refunds(e: &Error) -> Option<String> {
    match e {
        Error::Referee(RefereeError::Unknown) => Some("listing_closed".into()),
        Error::Referee(RefereeError::Rejected(code)) if matches!(code.as_str(), "not_friend" | "listing_closed" | "price_changed" | "sold_out" | "own_pack" | "too_many_pulls" | "blocked" | "invalid") => Some(code.clone()),
        _ => None,
    }
}
/// The Library behind its lock: HTTP happens between `with` calls, never inside one.
pub trait Locked { fn with<T>(&self, f: impl FnOnce(&mut Library) -> Result<T>) -> Result<T>; }
/// Send a paid pull until the service confirms it, moves it to another slot, or refuses it for good.
pub fn send(store: &impl Locked, referee: &dyn Referee, mut start: PullStart, date: &str, queue: bool) -> Result<Award> {
    loop {
        match referee.purchase(&start.listing_id, &start.pull_id, start.slot, start.claim.as_ref(), start.price) {
            Ok(ack) => return store.with(|lib| finish_pull(lib, &start.pull_id, &ack, date, queue)),
            Err(Error::Referee(RefereeError::Rejected(code))) if code == "slot_taken" => {
                let taken = referee.claimed_slots(&start.external_id)?;
                let pack = start.pack_id.clone();
                match store.with(|lib| { exclude_slots(lib, &pack, &taken)?; retry_pull(lib, &start.pull_id, crate::ids::random_unit()) })? {
                    Retry::Next(next) => start = next,
                    Retry::Refunded(code) => return Err(rejected(&code)),
                }
            }
            Err(e) => {
                if let Some(code) = refunds(&e) { store.with(|lib| refund_pull(lib, &start.pull_id, &code))?; }
                return Err(e);
            }
        }
    }
}
/// One pull from a friend's pack: sync the slots others hold, pay, then send.
pub fn pull(store: &impl Locked, referee: &dyn Referee, pack_id: &str, unrestricted: bool, date: &str, queue: bool) -> Result<Award> {
    let (pending, external) = store.with(|lib| {
        if !is_market_pack(lib.db(), pack_id)? { return Err(refused("This pack isn't from a friend's Market.")); }
        Ok((pending_for(lib.db(), pack_id)?, lib.db().conn.query_row("SELECT external_id FROM pack_distributions WHERE pack_id=?1", [pack_id], |r| r.get::<_, String>(0))?))
    })?;
    if pending.is_none() { let taken = referee.claimed_slots(&external)?; store.with(|lib| exclude_slots(lib, pack_id, &taken))?; }
    let start = match pending { Some(p) => p, None => store.with(|lib| prepare_pull(lib, pack_id, crate::ids::random_unit(), unrestricted))? };
    send(store, referee, start, date, queue)
}

/* ---------- Seller: payouts ---------- */

/// One row of `GET /v1/market/payouts`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sale { pub sale_id: i64, pub pack_id: String, pub slot: u32, pub cut_milli: i64, pub at: i64, pub buyer_hash: String }
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Payout { pub credited: i64, pub upto: i64, pub balance: i64 }
const UPTO_KEY: &str = "scraps.market.upto";
const REMAINDER_KEY: &str = "scraps.market.remainder_milli";
fn meta_i64(conn: &Connection, key: &str) -> Result<i64> {
    let v: Option<String> = conn.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0)).optional()?;
    v.map(|v| v.parse().map_err(|_| invalid())).transpose().map(|v| v.unwrap_or(0))
}
/// The last sale already counted here (the `after` of the next payout request).
pub fn payout_cursor(db: &Database) -> Result<i64> { meta_i64(&db.conn, UPTO_KEY) }
/// Count new sales once: whole Scraps go to the balance, the fraction is carried to the next sale (6 x 70% five times = 21).
pub fn apply_payouts(db: &mut Database, sales: &[Sale]) -> Result<Payout> {
    let tx = db.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let upto = meta_i64(&tx, UPTO_KEY)?;
    let fresh: Vec<&Sale> = sales.iter().filter(|s| s.sale_id > upto).collect();
    if fresh.iter().any(|s| !(0..=1_000_000).contains(&s.cut_milli)) { return Err(invalid()); }
    let Some(last) = fresh.iter().map(|s| s.sale_id).max() else { return Ok(Payout { credited: 0, upto, balance: scraps::balance_in(&tx)? }) };
    let total = meta_i64(&tx, REMAINDER_KEY)? + fresh.iter().map(|s| s.cut_milli).sum::<i64>();
    let credited = total / 1000;
    let balance = if credited > 0 { scraps::market_move(&tx, Kind::Payout, "market", &format!("payout-{last}"), credited)?.balance } else { scraps::balance_in(&tx)? };
    for s in &fresh { tx.execute("INSERT INTO market_earned VALUES (?1,?2,1) ON CONFLICT(external_id) DO UPDATE SET cut_milli=cut_milli+excluded.cut_milli,sales=sales+1", params![s.pack_id, s.cut_milli])?; }
    for (key, value) in [(UPTO_KEY, last), (REMAINDER_KEY, total % 1000)] {
        tx.execute("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, value.to_string()])?;
    }
    tx.commit()?;
    Ok(Payout { credited, upto: last, balance })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use crate::ownership::{Creation, Transfer, digest, request_bytes};
    use ed25519_dalek::SigningKey;
    use serde_json::{json, Value};
    use std::fs;
    const LISTING: &str = "AAAAAAAAAAAAAAAAAAAAAA";
    fn root() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("peta-market-vector-{}", new_id())); fs::create_dir_all(&d).unwrap();
        fs::write(d.join("box.key"), [5; 32]).unwrap();
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(d.join("box.key"), fs::Permissions::from_mode(0o600)).unwrap(); }
        d
    }
    fn claim(key: &SigningKey) -> Transfer {
        let mut t = Transfer { sticker_id: "market-edition".into(), seq: 1, kind: "claim".into(), actor_key: crate::sign::public_key(key), reference: "market-pack:slot-0".into(), at: "2026-01-01T00:00:02Z".into(), sig: String::new() };
        t.sig = STANDARD.encode(crate::sign::sign(key, &t.bytes().unwrap())); t
    }
    #[test]
    fn rust_market_vectors_match_worker_fixture_and_open_only_for_the_recipient() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../cloudflare/peta-api/test/vectors-s3.json");
        let maker = SigningKey::from_bytes(&[7; 32]); let buyer = SigningKey::from_bytes(&[8; 32]); let key = [3; 32];
        let dir = root(); let code = crate::identity::my_code(&dir, &buyer, "Buyer").unwrap();
        let card = br#"{"title":"Night Walk","headerDigest":"test-only"}"#;
        let pack = b"PETAPACK test-only vector payload";
        let sealed_card = seal_nonce(&key, LISTING, "card", card, &[1; 12]).unwrap();
        let sealed_pack = seal_nonce(&key, LISTING, "pack", pack, &[2; 12]).unwrap();
        let listing = json!({"listingId": LISTING, "packId": "market-pack", "price": FRIEND_PULL_PRICE,
            "cardDigest": digest(&sealed_card), "cardSize": sealed_card.len(), "packDigest": digest(&sealed_pack), "packSize": sealed_pack.len()});
        let creation = Creation::edition("market-edition", Some("Maker".into()), "2026-01-01T00:00:00Z", b"png", &maker, 1, 1).unwrap();
        let mut release = claim(&maker); release.seq = 0; release.kind = "release".into(); release.at = "2026-01-01T00:00:01Z".into(); release.sig = STANDARD.encode(crate::sign::sign(&maker, &release.bytes().unwrap()));
        let edition = json!({"slot":0,"claim":claim(&buyer),"price":FRIEND_PULL_PRICE});
        let prize = json!({"slot":1,"claim":null,"price":FRIEND_PULL_PRICE});
        let mut requests = Vec::new();
        for (path, body, signing) in [("/v1/market/listings".to_owned(), listing.clone(), &maker),
            (format!("/v1/market/listings/{LISTING}/pulls/BBBBBBBBBBBBBBBBBBBBBA"), edition.clone(), &buyer),
            (format!("/v1/market/listings/{LISTING}/pulls/CCCCCCCCCCCCCCCCCCCCCA"), prize.clone(), &buyer)] {
            let body = serde_json::to_string(&body).unwrap(); let time = "1767225602"; let nonce = STANDARD.encode([9; 16]);
            let bytes = request_bytes("POST", &path, time, &nonce, body.as_bytes());
            requests.push(json!({"method":"POST","path":path,"body":body,"time":time,"nonce":nonce,"bytes":STANDARD.encode(&bytes),"key":crate::sign::public_key(signing),"sig":STANDARD.encode(crate::sign::sign(signing,&bytes))}));
        }
        let writing = std::env::var("PETA_WRITE_VECTORS").as_deref() == Ok("1");
        let sealed = if writing { envelope(&code.enc_key, LISTING, &key).unwrap() } else {
            let committed: Value = serde_json::from_slice(&fs::read(&path).expect("Regenerate market vectors with PETA_WRITE_VECTORS=1")).unwrap();
            STANDARD.decode(committed["envelope"]["sealed"].as_str().unwrap()).unwrap()
        };
        let value = json!({"listing":listing,"editionPull":edition,"prizePull":prize,"creation":creation,"release":release,"requests":requests,
            "envelope":{"encKey":code.enc_key,"sealed":STANDARD.encode(&sealed)},
            "card":{"plain":STANDARD.encode(card),"sealed":STANDARD.encode(&sealed_card)},"pack":{"plain":STANDARD.encode(pack),"sealed":STANDARD.encode(&sealed_pack)}});
        if writing { fs::write(&path, serde_json::to_string_pretty(&value).unwrap() + "\n").unwrap(); }
        let committed: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap(); assert_eq!(value, committed);
        assert_eq!(open_envelope(&dir, LISTING, &sealed).unwrap(), key);
        assert_eq!(open(&key, LISTING, "card", &sealed_card).unwrap(), card);
        assert_eq!(open(&key, LISTING, "pack", &sealed_pack).unwrap(), pack);
        assert!(open(&[4;32], LISTING, "card", &sealed_card).is_err());
        assert!(open(&key, "DDDDDDDDDDDDDDDDDDDDDA", "card", &sealed_card).is_err());
        assert!(open(&key, LISTING, "pack", &sealed_card).is_err());
        let other = root(); fs::remove_file(other.join("box.key")).unwrap();
        assert!(open_envelope(&other, LISTING, &sealed).is_err());
        fs::remove_dir_all(dir).unwrap(); fs::remove_dir_all(other).unwrap();
    }
}

#[cfg(test)]
mod flow_tests {
    use super::*;
    use crate::edition_pack::{press, Selection};
    use std::{cell::RefCell, collections::{BTreeMap, VecDeque}};

    fn lib() -> Library { Library::open(&std::env::temp_dir().join(crate::ids::new_gift_id())).unwrap() }
    /// A seller with a finished own pack of `n` designs x `copies`, plus optional prizes.
    fn seller(n: usize, copies: u32, prizes: &[Prize]) -> (Library, String) {
        let mut lib = lib(); lib.db_mut().set_display_name("Maker").unwrap();
        let mut image = image::RgbaImage::new(24, 20); for y in 3..17 { for x in 3..21 { image.put_pixel(x, y, image::Rgba([100, 80, 40, 255])); } }
        let mut png = Vec::new(); image.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        let rendered = crate::pack::render_pack_sticker(&png).unwrap();
        let selection: Vec<Selection> = (0..n).map(|no| { let s = lib.add_made(&rendered, format!("source {no}").as_bytes(), "png", None, "kraft").unwrap(); Selection { sticker_id: s.id, name: format!("Design {no}"), copies: copies + no as u32 } }).collect();
        lib.db_mut().add_material("kraft", 4).unwrap();
        let id = press(&mut lib, "Night Walk", "kraft", &selection, prizes, &creator_pack::Dress::default(), true, &o::NoReferee, |_, _| Ok(())).unwrap();
        (lib, id)
    }
    fn befriend(a: &Library, b: &Library, name: &str) -> String {
        let code = crate::identity::code_here(b.root(), name).unwrap();
        a.db().conn.execute("INSERT INTO friends(public_key,name,first_seen_at,enc_public_key,status,allowed) VALUES (?1,?2,'x',?3,'friend',1) ON CONFLICT(public_key) DO UPDATE SET status='friend',enc_public_key=excluded.enc_public_key",
            params![code.sign_key, name, code.enc_key]).unwrap();
        code.sign_key
    }
    fn key(lib: &Library) -> String { sign::public_key(&crate::device_key::load_or_create(lib.root()).unwrap()) }
    /// List the pack, then hand the buyer what the service would: the row, the card and the pack.
    fn publish(seller: &mut Library, pack: &str, buyer: &Library) -> (Listing, RemoteListing, Vec<u8>, Vec<u8>) {
        let l = prepare_listing(seller, pack).unwrap();
        let changes = envelope_changes(seller, &l.listing_id).unwrap();
        let hash = crate::identity::key_hash(&key(buyer)).unwrap();
        let sealed = changes.add.iter().find(|e| e.to == hash).expect("an envelope for the friend").sealed.clone();
        envelopes_sent(seller, &l.listing_id, &changes).unwrap();
        let (card, pack_bytes) = (upload_bytes(seller, &l.listing_id, "card").unwrap(), upload_bytes(seller, &l.listing_id, "pack").unwrap());
        let l = record(seller, &l.listing_id, Progress::Open).unwrap();
        let slots: u32 = seller.db().conn.query_row("SELECT COUNT(*) FROM pack_items WHERE pack_id=?1", [pack], |r| r.get(0)).unwrap();
        let remote = RemoteListing { listing_id: l.listing_id.clone(), seller_hash: crate::identity::key_hash(&key(seller)).unwrap(), pack_id: l.external_id.clone(), price: FRIEND_PULL_PRICE,
            state: "open".into(), slot_count: slots, slots_left: slots, sealed, card_digest: l.card_digest.clone(), pack_digest: l.pack_digest.clone(), updated_at: 1 };
        (l, remote, card, pack_bytes)
    }
    /// Seller and buyer are friends; the buyer has the listing, its card and the pull-only pack.
    fn market(prizes: &[Prize]) -> (Library, Library, Listing, String) {
        let (mut s, pack) = seller(3, 1, prizes); let b = lib();
        befriend(&s, &b, "Buyer"); befriend(&b, &s, "Nao");
        let (l, remote, card, bytes) = publish(&mut s, &pack, &b);
        let mut b = b;
        assert_eq!(store_seen(&mut b, &[remote]).unwrap(), vec![l.listing_id.clone()]);
        store_card(&mut b, &l.listing_id, &card).unwrap();
        let local = install_pack(&mut b, &l.listing_id, &bytes).unwrap();
        (s, b, l, local)
    }
    fn balance(lib: &Library) -> i64 { lib.db().scrap_status().unwrap().balance }
    fn fund(lib: &Library, n: i64) { lib.db().conn.execute("INSERT INTO meta(key,value) VALUES('scraps.balance',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [n.to_string()]).unwrap(); }

    struct Store(RefCell<Library>);
    impl Locked for Store { fn with<T>(&self, f: impl FnOnce(&mut Library) -> Result<T>) -> Result<T> { f(&mut self.0.borrow_mut()) } }
    #[derive(Clone, Copy)]
    enum Next { Pass, Offline, Reject(&'static str), Steal, LoseResponse }
    /// A service that remembers who holds each slot and each sale, and can be told how to answer the next calls.
    #[derive(Default)]
    struct Fake { slots: RefCell<BTreeMap<u32, (String, String)>>, sales: RefCell<Vec<Sale>>, script: RefCell<VecDeque<Next>>, calls: RefCell<u32> }
    impl Fake {
        fn then(self, n: &[Next]) -> Self { self.script.borrow_mut().extend(n.iter().copied()); self }
        fn sell(&self, pull: &str, slot: u32, claim: Option<&Transfer>) -> Result<PurchaseAck> {
            let sig = claim.map(|c| c.sig.clone()).unwrap_or_default();
            if let Some((p, s)) = self.slots.borrow().get(&slot) {
                if p == pull && *s == sig { return Ok(PurchaseAck { sale_id: self.sales.borrow().iter().find(|x| x.slot == slot).unwrap().sale_id, slots_left: 0 }); }
                return Err(rejected("slot_taken"));
            }
            self.slots.borrow_mut().insert(slot, (pull.into(), sig));
            let id = self.sales.borrow().len() as i64 + 1;
            self.sales.borrow_mut().push(Sale { sale_id: id, pack_id: "x".into(), slot, cut_milli: 4200, at: 0, buyer_hash: "b".into() });
            Ok(PurchaseAck { sale_id: id, slots_left: 7 })
        }
    }
    impl Referee for Fake {
        fn claimed_slots(&self, _: &str) -> Result<Vec<u32>> { Ok(self.slots.borrow().keys().copied().collect()) }
        fn purchase(&self, _l: &str, pull: &str, slot: u32, claim: Option<&Transfer>, price: u32) -> Result<PurchaseAck> {
            assert_eq!(price, FRIEND_PULL_PRICE); *self.calls.borrow_mut() += 1;
            match self.script.borrow_mut().pop_front().unwrap_or(Next::Pass) {
                Next::Pass => self.sell(pull, slot, claim),
                Next::Offline => Err(RefereeError::Offline.into()),
                Next::Reject(code) => Err(rejected(code)),
                Next::Steal => { self.slots.borrow_mut().entry(slot).or_insert(("someone".into(), "x".into())); Err(rejected("slot_taken")) }
                Next::LoseResponse => { self.sell(pull, slot, claim)?; Err(RefereeError::Offline.into()) }
            }
        }
    }
    fn state(lib: &Library) -> Vec<(String, i64)> {
        let mut stmt = lib.db().conn.prepare("SELECT state,debited FROM market_pulls ORDER BY created_at").unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<std::result::Result<Vec<_>, _>>().unwrap()
    }

    #[test]
    fn listing_reaches_only_friends_and_installs_a_pull_only_pack() {
        let (mut s, pack) = seller(4, 1, &[Prize::Material { material_id: "kraft".into(), count: 1 }]);
        let (friend, stranger) = (lib(), lib());
        befriend(&s, &friend, "Friend");
        let pending_friend = crate::identity::code_here(stranger.root(), "Stranger").unwrap();
        s.db().conn.execute("INSERT INTO friends(public_key,name,first_seen_at,enc_public_key,status) VALUES (?1,'Stranger','x',?2,'requested')", params![pending_friend.sign_key, pending_friend.enc_key]).unwrap();
        let l = prepare_listing(&mut s, &pack).unwrap();
        assert_eq!(prepare_listing(&mut s, &pack).unwrap(), l, "a retry resumes the same sealed draft");
        assert_eq!((l.state.as_str(), l.price), ("draft", FRIEND_PULL_PRICE));
        let changes = envelope_changes(&s, &l.listing_id).unwrap();
        assert_eq!(changes.added_keys, vec![key(&friend)], "only approved friends get an envelope");
        // The card shows what is inside without the maker's name, and leaves the rarest design out of the peek.
        let card_bytes = upload_bytes(&s, &l.listing_id, "card").unwrap();
        let k: Vec<u8> = s.db().conn.query_row("SELECT content_key FROM market_my_listings", [], |r| r.get(0)).unwrap();
        let card = parse_card(&open(&k.try_into().unwrap(), &l.listing_id, "card", &card_bytes).unwrap()).unwrap();
        assert_eq!(card.designs.iter().map(|d| d.total).collect::<Vec<_>>(), vec![1, 2, 3, 4]);
        assert_eq!(card.peek.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), vec!["Design 1", "Design 2", "Design 3"]);
        assert!(!String::from_utf8_lossy(&card_bytes).contains("Maker"));
        assert_eq!(card_taken(&card, &[0, 1, 10]), vec![1, 1, 0, 0, 1]);
        envelopes_sent(&mut s, &l.listing_id, &changes).unwrap();
        assert!(envelope_changes(&s, &l.listing_id).unwrap().is_empty());
        s.db().conn.execute("UPDATE friends SET status='blocked' WHERE public_key=?1", [key(&friend)]).unwrap();
        assert_eq!(envelope_changes(&s, &l.listing_id).unwrap().removed_keys, vec![key(&friend)], "a removed friend loses the envelope");
        s.db().conn.execute("UPDATE friends SET status='friend' WHERE public_key=?1", [key(&friend)]).unwrap();
        let l = record(&mut s, &l.listing_id, Progress::Open).unwrap();
        assert!(s.db().packs().unwrap().iter().any(|p| p.id == pack && p.listed));
        assert!(upload_bytes(&s, &l.listing_id, "card").is_err(), "sealed copies are dropped once the listing is open");
        record(&mut s, &l.listing_id, Progress::Closed).unwrap();
        assert!(matches!(record(&mut s, &l.listing_id, Progress::Open), Err(Error::Referee(RefereeError::Rejected(c))) if c == "listing_closed"));
        assert!(prepare_listing(&mut s, &pack).is_err(), "a pack that stopped selling is not listed again");
    }

    #[test]
    fn buyer_checks_the_card_the_pack_and_the_maker() {
        let (mut s, pack) = seller(3, 1, &[]); let mut b = lib();
        befriend(&s, &b, "Buyer"); befriend(&b, &s, "Nao");
        let (l, remote, card, bytes) = publish(&mut s, &pack, &b);
        // Not a friend's listing: ignored.
        let mut stranger = remote.clone(); stranger.seller_hash = "0".repeat(64);
        assert!(store_seen(&mut b, &[stranger]).unwrap().is_empty());
        store_seen(&mut b, &[remote.clone()]).unwrap();
        let mut bad = card.clone(); let n = bad.len(); bad[n - 1] ^= 1;
        assert!(store_card(&mut b, &l.listing_id, &bad).is_err());
        store_card(&mut b, &l.listing_id, &card).unwrap();
        assert!(install_pack(&mut b, &l.listing_id, &card).is_err(), "a card is not a pack");
        // A pack signed by someone else under the same listing is refused.
        b.db().conn.execute("UPDATE market_listings_seen SET seller_key=?1", [key(&b)]).unwrap();
        assert!(install_pack(&mut b, &l.listing_id, &bytes).is_err());
        b.db().conn.execute("UPDATE market_listings_seen SET seller_key=?1", [key(&s)]).unwrap();
        let local = install_pack(&mut b, &l.listing_id, &bytes).unwrap();
        assert_eq!(install_pack(&mut b, &l.listing_id, &bytes).unwrap(), local);
        assert!(b.db().packs().unwrap().is_empty(), "pull-only packs stay off the Packs shelf");
        assert!(matches!(edition_pack::ensure_can_open(&b, &local), Err(Error::Referee(RefereeError::Rejected(c))) if c == "market_pack"));
        assert!(edition_pack::open(&mut b, &local, 0.0, true, "2026-10-13", false, &o::NoReferee).is_err());
        let shown = seen(&b).unwrap();
        assert_eq!((shown[0].seller_name.as_str(), shown[0].pack_id.as_deref(), shown[0].card.as_ref().map(|c| c.title.as_str())), ("Nao", Some(local.as_str()), Some("Night Walk")));
        // The friendship ends: the listing disappears from this Mac.
        b.db().conn.execute("UPDATE friends SET status='blocked'", []).unwrap();
        store_seen(&mut b, &[remote]).unwrap(); assert!(seen(&b).unwrap().is_empty());
    }

    #[test]
    fn a_pull_pays_once_and_lands_in_the_collection() {
        let (_s, b, _l, pack) = market(&[]); fund(&b, 20);
        let store = Store(RefCell::new(b)); let fake = Fake::default();
        let award = pull(&store, &fake, &pack, false, "2026-10-13", false).unwrap();
        let b = store.0.into_inner();
        assert_eq!(balance(&b), 14);
        assert_eq!(award.kind, "sticker");
        let id = award.sticker_id.clone().unwrap();
        assert_eq!(crate::server::checked(b.db(), &id).unwrap().as_deref(), Some("checked"));
        assert_eq!(b.db().held_sticker(&id).unwrap().unwrap().source_type, crate::SourceType::Pack);
        assert_eq!(state(&b), vec![("done".into(), 6)]);
        let pull_id: String = b.db().conn.query_row("SELECT pull_id FROM market_pulls", [], |r| r.get(0)).unwrap();
        let mut b = b;
        assert_eq!(finish_pull(&mut b, &pull_id, &PurchaseAck { sale_id: 1, slots_left: 0 }, "2026-10-13", false).unwrap(), award, "finishing twice returns the first award");
        assert_eq!(balance(&b), 14);
        // Not enough Scraps: nothing changes.
        fund(&b, 5); let store = Store(RefCell::new(b));
        assert!(pull(&store, &fake, &pack, false, "2026-10-13", false).is_err());
        let b = store.0.into_inner(); assert_eq!((balance(&b), state(&b).len()), (5, 1));
        // The developer edition records the price but takes nothing.
        let store = Store(RefCell::new(b));
        pull(&store, &fake, &pack, true, "2026-10-13", false).unwrap();
        let b = store.0.into_inner(); assert_eq!((balance(&b), state(&b)[1].clone()), (5, ("done".into(), 0)));
    }

    #[test]
    fn a_lost_answer_is_resent_exactly_and_never_paid_twice() {
        let (_s, b, _l, pack) = market(&[]); fund(&b, 20);
        let store = Store(RefCell::new(b)); let fake = Fake::default().then(&[Next::Offline, Next::LoseResponse]);
        assert!(matches!(pull(&store, &fake, &pack, false, "2026-10-13", false), Err(Error::Referee(RefereeError::Offline))));
        assert_eq!(state(&store.0.borrow()), vec![("pending".into(), 6)]);
        let first = pending_pulls(store.0.borrow().db()).unwrap();
        // The second try reaches the service but the answer is lost: still pending, the same pull is resent.
        assert!(pull(&store, &fake, &pack, false, "2026-10-13", false).is_err());
        assert_eq!(pending_pulls(store.0.borrow().db()).unwrap(), first, "same pull id, slot and signature");
        // A restart: the pending pull is sent again from its record and confirmed by the service's replay.
        let root = store.0.into_inner().root().to_owned(); let store = Store(RefCell::new(Library::open(&root).unwrap()));
        let start = pending_pulls(store.0.borrow().db()).unwrap().remove(0);
        send(&store, &fake, start, "2026-10-13", false).unwrap();
        let b = store.0.into_inner();
        assert_eq!((balance(&b), state(&b)), (14, vec![("done".into(), 6)]));
        assert_eq!(fake.sales.borrow().len(), 1);
    }

    #[test]
    fn a_taken_slot_moves_the_same_payment_and_three_misses_refund_it() {
        let (_s, b, _l, pack) = market(&[]); fund(&b, 20);
        let store = Store(RefCell::new(b)); let fake = Fake::default().then(&[Next::Steal]);
        pull(&store, &fake, &pack, false, "2026-10-13", false).unwrap();
        assert_eq!((balance(&store.0.borrow()), state(&store.0.borrow())), (14, vec![("done".into(), 6)]));
        assert_eq!(*fake.calls.borrow(), 2);
        let fake = Fake::default().then(&[Next::Steal, Next::Steal, Next::Steal]);
        assert!(matches!(pull(&store, &fake, &pack, false, "2026-10-13", false), Err(Error::Referee(RefereeError::Rejected(c))) if c == "busy_pack"));
        let b = store.0.into_inner();
        assert_eq!((balance(&b), state(&b)[1].0.as_str()), (14, "refunded"), "paid once, refunded once");
    }

    #[test]
    fn final_refusals_refund_and_others_keep_the_pull_waiting() {
        let (_s, b, _l, pack) = market(&[]); fund(&b, 20);
        let store = Store(RefCell::new(b));
        for code in ["not_friend", "listing_closed", "too_many_pulls"] {
            let fake = Fake::default().then(&[Next::Reject(code)]);
            assert!(pull(&store, &fake, &pack, false, "2026-10-13", false).is_err());
            assert_eq!(balance(&store.0.borrow()), 20, "{code} refunds");
        }
        let fake = Fake::default().then(&[Next::Reject("clock_skew")]);
        assert!(pull(&store, &fake, &pack, false, "2026-10-13", false).is_err());
        assert_eq!((balance(&store.0.borrow()), state(&store.0.borrow()).last().unwrap().0.as_str()), (14, "pending"));
    }

    #[test]
    fn failures_inside_the_local_transactions_change_nothing() {
        let (_s, b, _l, pack) = market(&[]); fund(&b, 20);
        b.db().conn.execute_batch("CREATE TEMP TRIGGER fail_pull BEFORE INSERT ON market_pulls BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
        let store = Store(RefCell::new(b)); let fake = Fake::default();
        assert!(pull(&store, &fake, &pack, false, "2026-10-13", false).is_err());
        assert_eq!((balance(&store.0.borrow()), state(&store.0.borrow()).len()), (20, 0), "the debit rolls back with the record");
        store.0.borrow().db().conn.execute_batch("DROP TRIGGER fail_pull; CREATE TEMP TRIGGER fail_done BEFORE UPDATE OF state ON market_pulls WHEN NEW.state='done' BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
        assert!(pull(&store, &fake, &pack, false, "2026-10-13", false).is_err());
        assert_eq!((balance(&store.0.borrow()), state(&store.0.borrow())), (14, vec![("pending".into(), 6)]), "confirmed remotely, still waiting here");
        let held: i64 = store.0.borrow().db().conn.query_row("SELECT COUNT(*) FROM stickers WHERE source_type='pack'", [], |r| r.get(0)).unwrap();
        assert_eq!(held, 0);
        store.0.borrow().db().conn.execute_batch("DROP TRIGGER fail_done;").unwrap();
        pull(&store, &fake, &pack, false, "2026-10-13", false).unwrap();
        assert_eq!((balance(&store.0.borrow()), state(&store.0.borrow())), (14, vec![("done".into(), 6)]));
        assert_eq!(fake.sales.borrow().len(), 1);
    }

    #[test]
    fn a_prize_slot_is_paid_and_given_like_an_edition() {
        let (_s, mut b, _l, pack) = market(&[Prize::Material { material_id: "kraft".into(), count: 1 }]); fund(&b, 20);
        let prize_slot: u32 = b.db().conn.query_row("SELECT e.slot_no FROM edition_pack_slots e JOIN signed_pack_items s ON s.item_id=e.item_id JOIN pack_items i ON i.id=e.item_id WHERE i.pack_id=?1 AND s.kind='material'", [&pack], |r| r.get(0)).unwrap();
        let others: Vec<u32> = (0..prize_slot).collect(); exclude_slots(&mut b, &pack, &others).unwrap();
        let kraft = b.db().material_count("kraft").unwrap();
        let store = Store(RefCell::new(b));
        let award = pull(&store, &Fake::default(), &pack, false, "2026-10-13", false).unwrap();
        let b = store.0.into_inner();
        assert_eq!((award.kind.as_str(), award.material_id.as_deref()), ("material", Some("kraft")));
        assert_eq!((b.db().material_count("kraft").unwrap(), balance(&b)), (kraft + 1, 14));
    }

    #[test]
    fn payouts_count_each_sale_once_and_carry_the_fraction() {
        let mut db = Database::open_in_memory().unwrap();
        let sale = |id: i64| Sale { sale_id: id, pack_id: "night".into(), slot: id as u32, cut_milli: 4200, at: 0, buyer_hash: "b".into() };
        let first = apply_payouts(&mut db, &[sale(1), sale(2)]).unwrap();
        assert_eq!((first.credited, first.upto), (8, 2));
        assert_eq!(apply_payouts(&mut db, &[sale(1), sale(2)]).unwrap().credited, 0, "the same sales again add nothing");
        let rest = apply_payouts(&mut db, &[sale(2), sale(3), sale(4), sale(5)]).unwrap();
        assert_eq!((rest.credited, rest.upto, payout_cursor(&db).unwrap()), (13, 5, 5));
        assert_eq!(db.scrap_status().unwrap().balance, 21, "five pulls of 6 at 70% are 21");
        let earned: (i64, i64) = db.conn.query_row("SELECT cut_milli,sales FROM market_earned WHERE external_id='night'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(earned, (21000, 5));
        assert!(apply_payouts(&mut db, &[Sale { cut_milli: -1, ..sale(6) }]).is_err());
        // Market money never moves through the ordinary exchange.
        for kind in [Kind::Pull, Kind::Payout] { assert!(db.scrap_trade(&scraps::Trade { kind, item_id: "market".into(), quantity: 1 }, "sneaky").is_err()); }
        assert_eq!(db.scrap_status().unwrap().balance, 21);
    }
}
