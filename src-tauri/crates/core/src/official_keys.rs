//! Public keys only. Keep older key IDs while their distributions are still supported.
use ed25519_dalek::VerifyingKey;
use crate::{error::{Error,Result},sign};
// Slots are part of PETA1 codes: never reorder or remove them. Append production keys.
pub const KEYS: &[(&str,Option<&str>)] = &[("k1", if cfg!(any(test, feature="developer")) {
    Some("11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=")
} else { None })];
pub fn get(id: &str) -> Result<VerifyingKey> {
    let value=KEYS.iter().find(|(key,_)|*key==id).ok_or_else(|| Error::Invalid("unknown_key: This official signing key is not supported. Update Peta.".into()))?;
    let public=value.1.ok_or_else(|| Error::Invalid("This Peta code was made for testing and can't be used here.".into()))?;
    sign::parse_public(public)
}
