//! Public keys only. Keep older key IDs while their distributions are still supported.
use ed25519_dalek::VerifyingKey;
use crate::{error::{Error,Result},sign};
// Slots are part of PETA1 codes: never reorder or remove them. Append production keys.
pub const KEYS: &[(&str,Option<&str>)] = &[("k1", if cfg!(any(test, feature="developer")) {
    Some("11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=")
} else { None }), ("k2", Some("L4Lmk3kJn9Ne1SHxaqY5YhE6xJz9OQjMWtdY2N4waRQ="))];
// k2: the production official key (2026-10-17, Fingerprint: 8F50-F3A4). Its private key lives only on the owner's encrypted disk.
// Coupon keys never occupy a PETA1 slot. c1 is the public RFC 8032 test vector.
pub const COUPON_KEYS: &[(&str,Option<&str>)] = &[("c1", if cfg!(any(test, feature="developer")) {
    Some("11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=")
} else { None }), ("c2", Some("bnSW7bDoApbt1Gb5AgowuBXL441K0oqN/iOJea+Xy4I="))];
// c2: the production coupon key (2026-10-15). Its seed lives only in the peta-admin-prod secret COUPON_SIGNING_KEY.
pub fn is_coupon(id: &str) -> bool { COUPON_KEYS.iter().any(|(key,_)|*key==id) }
pub fn coupon(id: &str) -> Result<VerifyingKey> {
    let public=COUPON_KEYS.iter().find(|(key,_)|*key==id).and_then(|(_,value)|*value)
        .ok_or_else(|| Error::Invalid("This coupon signing key is not trusted by this Peta. Update Peta.".into()))?;
    sign::parse_public(public)
}
pub fn get(id: &str) -> Result<VerifyingKey> {
    let value=KEYS.iter().find(|(key,_)|*key==id).ok_or_else(|| Error::Invalid("unknown_key: This official signing key is not supported. Update Peta.".into()))?;
    let public=value.1.ok_or_else(|| Error::Invalid("This Peta code was made for testing and can't be used here.".into()))?;
    sign::parse_public(public)
}
