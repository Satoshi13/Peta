//! Friend Market: sealed content and durable purchases. The service never receives a content key.
use chacha20poly1305::{aead::{Aead, KeyInit, Payload}, ChaCha20Poly1305};
use rand_core::{OsRng, RngCore};
use crate::{Error, Result};

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
