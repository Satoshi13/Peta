//! Friends and the Gift inbox (server S2): this device's sealing key, friend codes and links, sealed boxes, and the key backup.
//! The sealing key (X25519, HPKE) is separate from the signing key (Ed25519, `device_key`) and bound to it by a signature, so a friend
//! code proves which signing key may be written to. Nothing here is home-made cryptography: HPKE is RFC 9180 (`hpke`), the backup is
//! Argon2id + ChaCha20-Poly1305. Storage stays in this module so a Keychain implementation can replace it later.
use std::{fs::{self, OpenOptions}, io::{Read, Write}, path::Path};
use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine};
use ed25519_dalek::SigningKey;
use hpke::{aead::ChaCha20Poly1305, kdf::HkdfSha256, kem::X25519HkdfSha256, Deserializable, Kem as KemTrait, OpModeR, OpModeS, Serializable};
use rand_core::OsRng;
use crate::{error::{Error, Result}, sign};

type Kem = X25519HkdfSha256;
type SecretKey = <Kem as KemTrait>::PrivateKey;
type PublicKey = <Kem as KemTrait>::PublicKey;

const BOX_FILE: &str = "box.key";
const CODE_PREFIX: &str = "PETAF1";
const CODE_VERSION: u8 = 1;
pub const NAME_MAX_BYTES: usize = 24;
/// What a sealed box is for; one context can never be opened as another.
pub const GIFT: &[u8] = b"peta.gift.v1";
pub const REQUEST: &[u8] = b"peta.request.v1";
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

fn invalid(message: &str) -> Error { Error::Invalid(message.into()) }

/* ---------- the sealing key ---------- */

fn read_box(path: &Path) -> Result<SecretKey> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_file() || meta.file_type().is_symlink() { return Err(invalid("Sealing key must be a private regular file.")); }
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; if meta.permissions().mode() & 0o077 != 0 { return Err(invalid("Sealing key permissions must be 0600.")); } }
    let mut bytes = Vec::new(); fs::File::open(path)?.take(33).read_to_end(&mut bytes)?;
    if bytes.len() != 32 { return Err(invalid("Sealing key is damaged.")); }
    SecretKey::from_bytes(&bytes).map_err(|_| invalid("Sealing key is damaged."))
}
fn write_private(path: &Path, bytes: &[u8], create_new: bool) -> Result<()> {
    let mut opts = OpenOptions::new(); opts.write(true);
    if create_new { opts.create_new(true); } else { opts.create(true).truncate(true); }
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; opts.mode(0o600); }
    let mut file = opts.open(path)?; file.write_all(bytes)?; file.sync_all()?; Ok(())
}
/// The sealing key, made on first use.
pub fn sealing_key(root: &Path) -> Result<SecretKey> {
    let path = root.join(BOX_FILE);
    if fs::symlink_metadata(&path).is_ok() { return read_box(&path); }
    let (secret, _) = Kem::gen_keypair(&mut OsRng);
    match write_private(&path, &secret.to_bytes(), true) {
        Ok(()) => Ok(secret),
        Err(Error::Io(e)) if e.kind() == std::io::ErrorKind::AlreadyExists => read_box(&path),
        Err(e) => Err(e),
    }
}
fn public_of(secret: &SecretKey) -> PublicKey { <Kem as KemTrait>::sk_to_pk(secret) }
fn binding_bytes(enc: &[u8], name: &str) -> Vec<u8> { [b"peta.friend.v1".as_slice(), enc, name.as_bytes()].concat() }

/* ---------- friend codes and links ---------- */

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendCode {
    /// Base64 Ed25519 public key, as `sign::public_key` writes it.
    pub sign_key: String,
    /// Base64 X25519 public key.
    pub enc_key: String,
    pub name: String,
    /// The signing key's signature over the sealing key and the name.
    pub binding: String,
}
impl FriendCode {
    pub fn fingerprint(&self) -> Result<String> { Ok(sign::fingerprint(&sign::parse_public(&self.sign_key)?)) }
    fn bytes(&self) -> Result<Vec<u8>> {
        let sign = STANDARD.decode(&self.sign_key).map_err(|_| invalid("Damaged key."))?;
        let enc = STANDARD.decode(&self.enc_key).map_err(|_| invalid("Damaged key."))?;
        let sig = STANDARD.decode(&self.binding).map_err(|_| invalid("Damaged signature."))?;
        if sign.len() != 32 || enc.len() != 32 || sig.len() != 64 || self.name.len() > NAME_MAX_BYTES { return Err(invalid("Damaged friend code.")); }
        Ok([&[CODE_VERSION][..], &sign, &enc, &sig, &[self.name.len() as u8], self.name.as_bytes()].concat())
    }
    fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < 1 + 32 + 32 + 64 + 1 || bytes[0] != CODE_VERSION { return Err(invalid("This friend code is not one Peta can read.")); }
        let len = bytes[129] as usize;
        if len > NAME_MAX_BYTES || bytes.len() != 130 + len { return Err(invalid("This friend code is damaged.")); }
        let name = String::from_utf8(bytes[130..].to_vec()).map_err(|_| invalid("This friend code is damaged."))?;
        let code = Self { sign_key: STANDARD.encode(&bytes[1..33]), enc_key: STANDARD.encode(&bytes[33..65]), binding: STANDARD.encode(&bytes[65..129]), name };
        code.verify()?; Ok(code)
    }
    /// The binding signature must hold, so a code cannot point someone's signing key at another sealing key or name.
    pub fn verify(&self) -> Result<()> {
        let enc = STANDARD.decode(&self.enc_key).map_err(|_| invalid("Damaged key."))?;
        PublicKey::from_bytes(&enc).map_err(|_| invalid("Damaged key."))?;
        let sig = STANDARD.decode(&self.binding).map_err(|_| invalid("Damaged signature."))?;
        sign::verify(&sign::parse_public(&self.sign_key)?, &binding_bytes(&enc, &self.name), &sig).map_err(|_| invalid("This friend code does not match its key."))
    }
    /// `PETAF1-XXXX-XXXX-…`: Crockford base32 in groups of four, for pasting.
    pub fn to_code(&self) -> Result<String> {
        let text = base32(&self.bytes()?);
        Ok(std::iter::once(CODE_PREFIX.to_owned()).chain(text.as_bytes().chunks(4).map(|c| String::from_utf8_lossy(c).into_owned())).collect::<Vec<_>>().join("-"))
    }
    /// `peta://friend/<base64url>` (the developer edition uses its own scheme, so the two apps never take each other's links).
    pub fn to_link(&self, scheme: &str) -> Result<String> { Ok(format!("{scheme}://friend/{}", URL_SAFE_NO_PAD.encode(self.bytes()?))) }
    /// Pasted links must belong to this build; plain friend codes work in both editions.
    pub fn parse_for_scheme(text: &str, scheme: &str) -> Result<Self> {
        if let Some((actual, _)) = text.trim().split_once("://") {
            if actual != scheme {
                return Err(invalid(match actual {
                    "peta-developer" => "Open this friend link in Peta Developer, or paste their friend code.",
                    "peta" => "Open this friend link in Peta, or paste their friend code.",
                    _ => "This is not a Peta friend link.",
                }));
            }
        }
        Self::parse(text)
    }
    /// Reads a pasted code or link: spaces, case, hyphens and the look-alike letters I, L and O are forgiven.
    pub fn parse(text: &str) -> Result<Self> {
        let text = text.trim();
        if let Some((scheme, rest)) = text.split_once("://friend/") {
            if !matches!(scheme, "peta" | "peta-developer") { return Err(invalid("This is not a Peta friend link.")); }
            let raw = rest.trim_end_matches('/');
            return Self::from_bytes(&URL_SAFE_NO_PAD.decode(raw).map_err(|_| invalid("This friend link is damaged."))?);
        }
        let upper: String = text.chars().filter(|c| !c.is_whitespace() && *c != '-').map(|c| match c.to_ascii_uppercase() { 'I' | 'L' => '1', 'O' => '0', c => c }).collect();
        let body = upper.strip_prefix(CODE_PREFIX).ok_or_else(|| invalid("Paste a friend code that starts with PETAF1, or a friend link."))?;
        Self::from_bytes(&unbase32(body)?)
    }
}
/// This device's friend code under `name` (trimmed to 24 bytes on a character boundary).
pub fn my_code(root: &Path, signing: &SigningKey, name: &str) -> Result<FriendCode> { Ok(code_with(signing, &sealing_key(root)?, name)) }
fn code_with(signing: &SigningKey, sealing: &SecretKey, name: &str) -> FriendCode {
    let enc = public_of(sealing).to_bytes().to_vec();
    let mut name = name.trim().to_owned(); while name.len() > NAME_MAX_BYTES { name.pop(); }
    let binding = STANDARD.encode(sign::sign(signing, &binding_bytes(&enc, &name)));
    FriendCode { sign_key: sign::public_key(signing), enc_key: STANDARD.encode(&enc), name, binding }
}
/// This library's own friend code (loads the signing key from `root`).
pub fn code_here(root: &Path, name: &str) -> Result<FriendCode> { my_code(root, &crate::device_key::load_or_create(root)?, name) }
/// A backup of this library's keys (loads the signing key from `root`).
pub fn export_here(root: &Path, passphrase: &str) -> Result<Vec<u8>> { export(root, &crate::device_key::load_or_create(root)?, passphrase) }
/// How the server names a key in allow lists and reports: SHA-256 of the raw public key, in hex.
pub fn key_hash(key_b64: &str) -> Result<String> {
    use sha2::{Digest, Sha256};
    let raw = STANDARD.decode(key_b64).map_err(|_| invalid("Damaged key."))?;
    if raw.len() != 32 { return Err(invalid("Damaged key.")); }
    Ok(Sha256::digest(&raw).iter().map(|b| format!("{b:02x}")).collect())
}
/// A mailbox's address on the server: the first 16 bytes of SHA-256 of the signing public key, in the same base32 as friend codes.
pub fn mailbox_id(sign_key_b64: &str) -> Result<String> {
    use sha2::{Digest, Sha256};
    let raw = STANDARD.decode(sign_key_b64).map_err(|_| invalid("Damaged key."))?;
    if raw.len() != 32 { return Err(invalid("Damaged key.")); }
    Ok(base32(&Sha256::digest(&raw)[..16]))
}

fn base32(bytes: &[u8]) -> String {
    let (mut out, mut acc, mut bits) = (String::new(), 0u32, 0u32);
    for b in bytes { acc = (acc << 8) | *b as u32; bits += 8; while bits >= 5 { bits -= 5; out.push(ALPHABET[((acc >> bits) & 31) as usize] as char); } }
    if bits > 0 { out.push(ALPHABET[((acc << (5 - bits)) & 31) as usize] as char); }
    out
}
fn unbase32(text: &str) -> Result<Vec<u8>> {
    let (mut out, mut acc, mut bits) = (Vec::new(), 0u32, 0u32);
    for c in text.chars() {
        let v = ALPHABET.iter().position(|a| *a as char == c).ok_or_else(|| invalid("This friend code has a letter Peta does not use."))? as u32;
        acc = (acc << 5) | v; bits += 5; if bits >= 8 { bits -= 8; out.push((acc >> bits) as u8); }
    }
    Ok(out)
}

/* ---------- sealed boxes ---------- */

/// Seal `plain` to a friend's sealing key. The result is the encapsulated key followed by the ciphertext.
pub fn seal(enc_key_b64: &str, context: &[u8], plain: &[u8]) -> Result<Vec<u8>> {
    let pk = PublicKey::from_bytes(&STANDARD.decode(enc_key_b64).map_err(|_| invalid("Damaged key."))?).map_err(|_| invalid("Damaged key."))?;
    let (encapped, ct) = hpke::single_shot_seal::<ChaCha20Poly1305, HkdfSha256, Kem, _>(&OpModeS::Base, &pk, context, plain, b"", &mut OsRng)
        .map_err(|_| invalid("Could not seal the gift."))?;
    Ok([encapped.to_bytes().as_slice(), &ct].concat())
}
/// Open a box sealed to this device for `context`.
pub fn open(root: &Path, context: &[u8], sealed: &[u8]) -> Result<Vec<u8>> {
    if sealed.len() < 32 + 16 { return Err(invalid("This box is damaged.")); }
    let encapped = <Kem as KemTrait>::EncappedKey::from_bytes(&sealed[..32]).map_err(|_| invalid("This box is damaged."))?;
    hpke::single_shot_open::<ChaCha20Poly1305, HkdfSha256, Kem>(&OpModeR::Base, &sealing_key(root)?, &encapped, context, &sealed[32..], b"")
        .map_err(|_| invalid("This box was not sealed for this Mac."))
}

/* ---------- the key backup ---------- */

const BACKUP_MAGIC: &[u8; 8] = b"PETAKEY1";
pub const PASSPHRASE_MIN: usize = 12;
fn backup_key(passphrase: &str, salt: &[u8]) -> Result<chacha20poly1305::Key> {
    let mut key = [0u8; 32];
    argon2::Argon2::default().hash_password_into(passphrase.as_bytes(), salt, &mut key).map_err(|_| invalid("Could not use that passphrase."))?;
    Ok(key.into())
}
/// Both keys, sealed under a passphrase: `PETAKEY1 | salt(16) | nonce(12) | ciphertext(signing seed 32 + sealing key 32)`.
pub fn export(root: &Path, signing: &SigningKey, passphrase: &str) -> Result<Vec<u8>> {
    use chacha20poly1305::{aead::{Aead, KeyInit}, ChaCha20Poly1305 as Cipher};
    if passphrase.chars().count() < PASSPHRASE_MIN { return Err(invalid("Use a passphrase of at least 12 characters.")); }
    let mut salt = [0u8; 16]; let mut nonce = [0u8; 12];
    rand_core::RngCore::fill_bytes(&mut OsRng, &mut salt); rand_core::RngCore::fill_bytes(&mut OsRng, &mut nonce);
    let plain = [signing.to_bytes().as_slice(), sealing_key(root)?.to_bytes().as_slice()].concat();
    let ct = Cipher::new(&backup_key(passphrase, &salt)?).encrypt(&nonce.into(), plain.as_slice()).map_err(|_| invalid("Could not seal the backup."))?;
    Ok([BACKUP_MAGIC.as_slice(), &salt, &nonce, &ct].concat())
}
/// The keys in a backup (checked; nothing is written). `restore` puts them in place.
pub fn read_backup(bytes: &[u8], passphrase: &str) -> Result<(SigningKey, SecretKey)> {
    use chacha20poly1305::{aead::{Aead, KeyInit}, ChaCha20Poly1305 as Cipher};
    if bytes.len() != 8 + 16 + 12 + 64 + 16 || &bytes[..8] != BACKUP_MAGIC { return Err(invalid("This is not a Peta key backup.")); }
    let plain = Cipher::new(&backup_key(passphrase, &bytes[8..24])?).decrypt(bytes[24..36].into(), &bytes[36..])
        .map_err(|_| invalid("That passphrase does not open this backup."))?;
    let seed: [u8; 32] = plain[..32].try_into().unwrap();
    Ok((SigningKey::from_bytes(&seed), SecretKey::from_bytes(&plain[32..]).map_err(|_| invalid("This backup is damaged."))?))
}
/// Replace this library's keys with the backup's (moving to a new Mac). Each file is written beside its target and renamed over it.
pub fn restore(root: &Path, bytes: &[u8], passphrase: &str) -> Result<String> {
    let (signing, sealing) = read_backup(bytes, passphrase)?;
    for (name, data) in [("device.key", signing.to_bytes().to_vec()), (BOX_FILE, sealing.to_bytes().to_vec())] {
        let temp = root.join(format!("{name}.restore"));
        let _ = fs::remove_file(&temp);
        write_private(&temp, &data, true)?; fs::rename(&temp, root.join(name))?;
    }
    Ok(sign::public_key(&signing))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn dir(tag: &str) -> std::path::PathBuf { let d = std::env::temp_dir().join(format!("peta-id-{tag}-{}", crate::ids::new_sticker_id())); fs::create_dir_all(&d).unwrap(); d }

    #[test]
    fn friend_codes_and_links_round_trip_and_forgive_pasting() {
        let root = dir("code"); let key = sign::generate().unwrap();
        let code = my_code(&root, &key, "  Maker  ").unwrap();
        assert_eq!(code.name, "Maker");
        let text = code.to_code().unwrap(); assert!(text.starts_with("PETAF1-"));
        assert_eq!(FriendCode::parse(&text).unwrap(), code);
        let messy = format!("  {}\n", text.to_lowercase().replace('-', " ").replace('1', "l").replace('0', "o"));
        assert_eq!(FriendCode::parse(&messy).unwrap(), code, "case, spaces and look-alike letters are forgiven");
        for scheme in ["peta", "peta-developer"] { let link = code.to_link(scheme).unwrap(); assert!(link.starts_with(&format!("{scheme}://friend/"))); assert_eq!(FriendCode::parse(&link).unwrap(), code); }
        assert_eq!(my_code(&root, &key, "Maker").unwrap(), code, "the sealing key is kept, so the code is stable");
        let long = my_code(&root, &key, "あいうえおかきくけこさしすせそ").unwrap(); assert!(long.name.len() <= NAME_MAX_BYTES && long.name.chars().count() == 8);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn links_belong_to_their_build_but_codes_work_in_both() {
        let root = dir("schemes");
        let code = my_code(&root, &sign::generate().unwrap(), "Nao").unwrap();
        for scheme in ["peta", "peta-developer"] {
            let link = code.to_link(scheme).unwrap();
            assert_eq!(FriendCode::parse_for_scheme(&link, scheme).unwrap(), code);
            let other = if scheme == "peta" { "peta-developer" } else { "peta" };
            assert!(FriendCode::parse_for_scheme(&link, other).is_err());
            assert_eq!(FriendCode::parse_for_scheme(&code.to_code().unwrap(), scheme).unwrap(), code);
        }
        assert!(FriendCode::parse(&code.to_link("other").unwrap()).is_err());
        assert!(FriendCode::parse_for_scheme("peta://friend/!!!", "peta").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_changed_code_is_refused() {
        let root = dir("tamper"); let key = sign::generate().unwrap(); let code = my_code(&root, &key, "Nao").unwrap();
        let mut renamed = code.clone(); renamed.name = "Mallory".into(); assert!(renamed.verify().is_err());
        let other = my_code(&dir("other"), &sign::generate().unwrap(), "Nao").unwrap();
        let mut swapped = code.clone(); swapped.enc_key = other.enc_key; assert!(swapped.verify().is_err());
        let mut bytes = code.bytes().unwrap(); bytes[40] ^= 1; assert!(FriendCode::from_bytes(&bytes).is_err());
        for bad in ["", "PETAF2-AAAA", "PETAF1-UUUU", "peta://friend/!!!", "hello"] { assert!(FriendCode::parse(bad).is_err(), "{bad}"); }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sealed_boxes_open_only_for_their_mac_and_context() {
        let (alice, bob) = (dir("a"), dir("b"));
        let bob_code = my_code(&bob, &sign::generate().unwrap(), "Bob").unwrap();
        let sealed = seal(&bob_code.enc_key, GIFT, b"a gift").unwrap();
        assert_eq!(open(&bob, GIFT, &sealed).unwrap(), b"a gift");
        assert!(open(&bob, REQUEST, &sealed).is_err(), "a gift cannot be opened as a request");
        assert!(open(&alice, GIFT, &sealed).is_err(), "nor by another Mac");
        let mut bent = sealed.clone(); *bent.last_mut().unwrap() ^= 1; assert!(open(&bob, GIFT, &bent).is_err());
        assert!(open(&bob, GIFT, &sealed[..20]).is_err());
        fs::remove_dir_all(alice).unwrap(); fs::remove_dir_all(bob).unwrap();
    }

    #[test]
    fn a_backup_moves_both_keys_and_needs_its_passphrase() {
        let (old, new) = (dir("old"), dir("new"));
        let key = crate::device_key::load_or_create(&old).unwrap(); let code = my_code(&old, &key, "Maker").unwrap();
        assert!(export(&old, &key, "short").is_err());
        let backup = export(&old, &key, "correct horse battery").unwrap();
        assert!(read_backup(&backup, "wrong horse battery!").is_err());
        let mut bent = backup.clone(); bent[50] ^= 1; assert!(read_backup(&bent, "correct horse battery").is_err());
        assert!(read_backup(b"not a backup", "correct horse battery").is_err());
        crate::device_key::load_or_create(&new).unwrap();   // the new Mac already made its own keys
        assert_eq!(restore(&new, &backup, "correct horse battery").unwrap(), sign::public_key(&key));
        let moved = crate::device_key::load_or_create(&new).unwrap();
        assert_eq!(my_code(&new, &moved, "Maker").unwrap(), code, "same keys, same friend code");
        let sealed = seal(&code.enc_key, GIFT, b"hello").unwrap(); assert_eq!(open(&new, GIFT, &sealed).unwrap(), b"hello");
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; for f in ["device.key", BOX_FILE] { assert_eq!(fs::metadata(new.join(f)).unwrap().permissions().mode() & 0o777, 0o600); } }
        fs::remove_dir_all(old).unwrap(); fs::remove_dir_all(new).unwrap();
    }

    /// The Worker checks a mailbox's binding and address with the same bytes (cloudflare/peta-api/test/vectors-s2.json).
    #[test]
    fn rust_friend_code_vectors_match_committed_worker_fixture() {
        let signing = SigningKey::from_bytes(&[7; 32]); let sealing = SecretKey::from_bytes(&[5; 32]).unwrap();
        let codes: Vec<_> = ["Bob", "日本語 🌸", ""].iter().map(|name| {
            let c = code_with(&signing, &sealing, name);
            serde_json::json!({"code": c, "bindingBytes": STANDARD.encode(binding_bytes(&STANDARD.decode(&c.enc_key).unwrap(), &c.name)), "text": c.to_code().unwrap()})
        }).collect();
        let value = serde_json::json!({"signKey": sign::public_key(&signing), "mailboxId": mailbox_id(&sign::public_key(&signing)).unwrap(), "codes": codes});
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../cloudflare/peta-api/test/vectors-s2.json");
        if std::env::var("PETA_WRITE_VECTORS").as_deref() == Ok("1") { fs::write(&path, serde_json::to_string_pretty(&value).unwrap() + "\n").unwrap(); }
        let committed: serde_json::Value = serde_json::from_slice(&fs::read(&path).expect("Missing vectors; regenerate explicitly with PETA_WRITE_VECTORS=1")).unwrap();
        assert_eq!(committed, value, "Friend code bytes changed; review before regenerating vectors");
    }
}
