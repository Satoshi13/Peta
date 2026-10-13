//! Integration tests compile the core without cfg(test), as the shipped app does.
use peta_core::{events::{self,Event},official_keys,sign::{self,Signer}};

#[test]
fn published_test_key_keeps_its_slot_but_is_not_trusted_in_release() {
    // Public RFC 8032 test vector, never a production secret.
    let hex="9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    let mut seed=[0u8;32];
    for (i,b) in seed.iter_mut().enumerate() {*b=u8::from_str_radix(&hex[i*2..i*2+2],16).unwrap();}
    let key=ed25519_dalek::SigningKey::from_bytes(&seed);
    let event=Event{event_id:"test-trust".into(),kind:"extra_envelope".into(),issued_at:"2026-10-14T00:00:00Z".into(),not_before:None,not_after:Some("2026-11-14T00:00:00Z".into()),title:"From Peta".into(),message:String::new(),payload:serde_json::json!({"count":1}),signer:Signer::Official{key_id:"k1".into()},attachments:vec![]};
    let file=events::encode(&event,&[],&key).unwrap();
    let code=events::as_code(&event,&key).unwrap();
    assert_eq!(official_keys::KEYS[0].0,"k1");
    for result in [events::decode(&file),events::from_code(&code)] {
        if cfg!(feature="developer") {assert!(result.is_ok());}
        else {assert_eq!(result.err().unwrap().to_string(),"This Peta code was made for testing and can't be used here.");}
    }
    assert_eq!(sign::public_key(&key),"11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=");
}
