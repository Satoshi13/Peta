//! Public keys only. Keep older key IDs while their distributions are still supported.
use ed25519_dalek::VerifyingKey;
use crate::{error::{Error,Result},sign};
// TODO(owner): replace with the real official public key. This is a development placeholder.
pub const KEYS: &[(&str,&str)] = &[("k1","11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=")];
pub fn get(id: &str) -> Result<VerifyingKey> {
    let value=KEYS.iter().find(|(key,_)|*key==id).ok_or_else(|| Error::Invalid("unknown_key: This official signing key is not supported. Update Peta.".into()))?;
    sign::parse_public(value.1)
}
