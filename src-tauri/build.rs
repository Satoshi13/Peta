fn main() {
    #[cfg(feature="beta")]
    {
        use base64::Engine;
        assert!(!cfg!(feature="developer"),"Build beta and Developer separately.");
        println!("cargo:rerun-if-changed=tauri.beta.conf.json");
        println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
        let beta:serde_json::Value=serde_json::from_str(&std::fs::read_to_string("tauri.beta.conf.json").expect("Beta configuration missing")).unwrap();
        let mut config:serde_json::Value=serde_json::from_str(&std::env::var("TAURI_CONFIG").unwrap_or_else(|_|"{}".into())).expect("Invalid beta config override");
        if config.pointer("/plugins/updater").is_none() {config["plugins"]["updater"]=beta["plugins"]["updater"].clone();}
        config["bundle"]["createUpdaterArtifacts"]=serde_json::json!(true);
        let key=config.pointer("/plugins/updater/pubkey").and_then(|k|k.as_str()).unwrap_or("");
        let valid=base64::engine::general_purpose::STANDARD.decode(key).ok().and_then(|b|String::from_utf8(b).ok()).is_some_and(|s| {
            let lines:Vec<_>=s.lines().collect();
            lines.len()==2 && lines[0].starts_with("untrusted comment:") && base64::engine::general_purpose::STANDARD.decode(lines[1]).is_ok_and(|b|b.len()==42 && b[..2]==*b"Ed")
        });
        assert!(valid,"Beta requires the owner updater PUBLIC key in tauri.beta.conf.json. No beta can be shipped without it.");
        assert_eq!(config.pointer("/plugins/updater/requireSignedVersion").and_then(|v|v.as_bool()),Some(true),"Signed updater versions are required.");
        let text=serde_json::to_string(&config).unwrap();
        std::env::set_var("TAURI_CONFIG",&text);
        println!("cargo:rustc-env=TAURI_CONFIG={text}");
    }
    tauri_build::build()
}
