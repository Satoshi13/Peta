//! Local signatures authenticate bytes and keys, not real-world identities. They cannot revoke
//! delivered content, cap distribution, or prevent redeeming a code on another device.
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer as _, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use crate::error::{Error, Result};

pub type KeyId = String;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Signer {
    Official { #[serde(rename = "keyId")] key_id: KeyId },
    Device { #[serde(rename = "publicKey")] public_key: String },
}
pub fn generate() -> Result<SigningKey> {
    let mut seed = [0; 32];
    getrandom::fill(&mut seed).map_err(|_| Error::Invalid("could not generate a signing key".into()))?;
    Ok(SigningKey::from_bytes(&seed))
}
pub fn public_key(key: &SigningKey) -> String { STANDARD.encode(key.verifying_key().as_bytes()) }
pub fn parse_public(value: &str) -> Result<VerifyingKey> {
    let bytes = STANDARD.decode(value).map_err(|_| invalid_signature())?;
    let bytes: [u8;32] = bytes.try_into().map_err(|_| invalid_signature())?;
    VerifyingKey::from_bytes(&bytes).map_err(|_| invalid_signature())
}
pub fn fingerprint(key: &VerifyingKey) -> String {
    let hash = Sha256::digest(key.as_bytes());
    format!("{:02X}{:02X}-{:02X}{:02X}", hash[0], hash[1], hash[2], hash[3])
}
pub fn sign(key: &SigningKey, bytes: &[u8]) -> [u8;64] { key.sign(bytes).to_bytes() }
pub fn invalid_signature() -> Error { Error::Invalid("invalid_signature: This file was changed after it was made, or its signing key is not trusted.".into()) }
pub fn verify(key: &VerifyingKey, bytes: &[u8], signature: &[u8]) -> Result<()> {
    let sig = ed25519_dalek::Signature::from_slice(signature).map_err(|_| invalid_signature())?;
    key.verify_strict(bytes, &sig).map_err(|_| invalid_signature())
}
pub fn resolve(signer: &Signer) -> Result<VerifyingKey> {
    match signer {
        Signer::Official {key_id} => crate::official_keys::get(key_id),
        Signer::Device {public_key} => parse_public(public_key),
    }
}

pub const MAX_FILE: usize = 24 * 1024 * 1024;
pub const MAX_HEADER: usize = 64 * 1024;
pub fn seal(magic: &[u8;8], version: u8, header: &impl Serialize, body: &[u8], key: &SigningKey) -> Result<Vec<u8>> {
    let json = serde_json::to_vec(header).map_err(|e| Error::Invalid(e.to_string()))?;
    if json.is_empty() || json.len()>MAX_HEADER || 13+json.len()+body.len()+64>MAX_FILE {return Err(Error::Invalid("This Peta file is too large.".into()));}
    let mut bytes = Vec::with_capacity(13+json.len()+body.len()+64);
    bytes.extend_from_slice(magic); bytes.push(version); bytes.extend_from_slice(&(json.len() as u32).to_be_bytes()); bytes.extend_from_slice(&json); bytes.extend_from_slice(body);
    bytes.extend_from_slice(&sign(key,&bytes)); Ok(bytes)
}
/// Only parse bounded JSON before verification. Callers may decode attachments after this returns.
pub fn unseal_with<'a>(bytes: &'a [u8], magic: &[u8;8], version: u8, trust: impl FnOnce(&Signer)->Result<VerifyingKey>) -> Result<(serde_json::Value, &'a [u8])> {
    if bytes.len()<77 || bytes.len()>MAX_FILE || &bytes[..8]!=magic || bytes[8]!=version {return Err(Error::Invalid("This Peta file is damaged or needs a newer Peta.".into()));}
    let n=u32::from_be_bytes(bytes[9..13].try_into().unwrap()) as usize;
    if n==0 || n>MAX_HEADER || 13+n>bytes.len()-64 {return Err(Error::Invalid("This Peta file has a damaged header.".into()));}
    let header:serde_json::Value=serde_json::from_slice(&bytes[13..13+n]).map_err(|_| Error::Invalid("This Peta file has a damaged header.".into()))?;
    let signer:Signer=serde_json::from_value(header.get("signer").cloned().ok_or_else(invalid_signature)?).map_err(|_| invalid_signature())?;
    verify(&trust(&signer)?, &bytes[..bytes.len()-64], &bytes[bytes.len()-64..])?;
    Ok((header,&bytes[13+n..bytes.len()-64]))
}
pub fn unseal<'a>(bytes: &'a [u8], magic: &[u8;8], version: u8) -> Result<(serde_json::Value, &'a [u8])> {unseal_with(bytes,magic,version,resolve)}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn signatures_reject_changed_bytes_and_wrong_keys() {
        let a=generate().unwrap();let b=generate().unwrap();let sig=sign(&a,b"Peta");
        verify(&a.verifying_key(),b"Peta",&sig).unwrap();
        assert!(verify(&a.verifying_key(),b"peta",&sig).is_err());assert!(verify(&b.verifying_key(),b"Peta",&sig).is_err());
        assert!(crate::official_keys::get("unknown").is_err());
        assert_eq!(parse_public(&public_key(&a)).unwrap(),a.verifying_key());assert_eq!(fingerprint(&a.verifying_key()).len(),9);
    }
    #[test] fn framing_verifies_all_bytes_before_exposing_attachments() {
        let k=generate().unwrap();let header=serde_json::json!({"signer":Signer::Device{public_key:public_key(&k)}});
        let bytes=seal(b"PETAEVNT",1,&header,b"not even a PNG",&k).unwrap();
        assert_eq!(unseal(&bytes,b"PETAEVNT",1).unwrap().1,b"not even a PNG");
        for i in [0,8,12,20,bytes.len()-65,bytes.len()-1] {let mut changed=bytes.clone();changed[i]^=1;assert!(unseal(&changed,b"PETAEVNT",1).is_err());}
        assert!(unseal(&bytes[..bytes.len()-1],b"PETAEVNT",1).is_err());
    }
}
