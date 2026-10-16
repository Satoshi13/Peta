//! All keys here are disposable test-only keys generated at runtime, never official signing secrets.
use std::{process::Command,path::Path};
fn run(args:&[&str])->std::process::Output{Command::new(env!("CARGO_BIN_EXE_peta-pass")).args(args).output().unwrap()}
#[test] fn owner_tool_roundtrip_does_not_print_or_overwrite_private_key() {
    let dir=std::env::temp_dir().join(format!("peta-pass-test-{}",peta_core::ids::new_sticker_id()));std::fs::create_dir_all(&dir).unwrap();
    let path=dir.join("test-only.key");let key=path.to_str().unwrap();let out=dir.join("event.peta");let file=out.to_str().unwrap();
    assert!(run(&["keygen","--out",key]).status.success());assert!(!run(&["keygen","--out",key]).status.success());
    let public=run(&["pubkey",key]);assert!(public.status.success());let public=String::from_utf8(public.stdout).unwrap();let public=public.lines().next().unwrap();
    let issue=run(&["event","--key",key,"--id","test-envelope","--kind","extra_envelope","--count","1","--not-after","2026-11-02T00:00:00+09:00","--out",file,"--as-code"]);assert!(issue.status.success(),"{}",String::from_utf8_lossy(&issue.stderr));assert!(String::from_utf8_lossy(&issue.stdout).contains("PETA1-"));
    assert!(run(&["verify",file,"--public-key",public]).status.success());
    let seed=std::fs::read(Path::new(key)).unwrap();use base64::Engine;assert!(!String::from_utf8_lossy(&issue.stdout).contains(&base64::engine::general_purpose::STANDARD.encode(seed)));
    let mut bytes=std::fs::read(file).unwrap();let n=bytes.len();bytes[n-65]^=1;std::fs::write(file,bytes).unwrap();assert!(!run(&["verify",file,"--public-key",public]).status.success());
    std::fs::remove_dir_all(dir).unwrap();
}
#[test] fn bundles_are_signed_from_simple_items_and_refuse_what_the_app_would() {
    let dir=std::env::temp_dir().join(format!("peta-pass-bundle-{}",peta_core::ids::new_sticker_id()));std::fs::create_dir_all(&dir).unwrap();
    let key=dir.join("test-only.key");let key=key.to_str().unwrap();assert!(run(&["keygen","--out",key]).status.success());
    let public=String::from_utf8(run(&["pubkey",key]).stdout).unwrap();let public=public.lines().next().unwrap().to_owned();
    let out=dir.join("bundle.peta");let file=out.to_str().unwrap();
    let ok=run(&["event","--key",key,"--id","cpn-test","--kind","bundle","--item","scraps=50","--item","envelope=1","--item","material:kraft=2","--item","tool:link-tag=1","--item","pack:cats=1","--not-after","2026-11-02T00:00:00+09:00","--out",file]);
    assert!(ok.status.success(),"{}",String::from_utf8_lossy(&ok.stderr));
    let shown=run(&["verify",file,"--public-key",&public]);assert!(shown.status.success());
    let text=String::from_utf8_lossy(&shown.stdout);assert!(text.contains("\"bundle\"") && text.contains("\"kraft\"") && text.contains("\"link-tag\""),"{text}");
    for bad in [&["--item","scraps=5000"][..],&["--item","material:matte=1"],&["--item","sticker=1"],&["--item","scraps"],&[]] {
        let extra=dir.join(format!("bad-{}.peta",peta_core::ids::new_sticker_id()));
        let mut args=vec!["event","--key",key,"--id","cpn-bad","--kind","bundle","--not-after","2026-11-02T00:00:00+09:00","--out",extra.to_str().unwrap()];args.extend_from_slice(bad);
        assert!(!run(&args).status.success(),"{bad:?}");assert!(!extra.exists());
    }
    // A bundle has no short PETA1 form: coupons carry the file.
    assert!(!run(&["event","--key",key,"--id","cpn-code","--kind","bundle","--item","scraps=1","--not-after","2026-11-02T00:00:00+09:00","--as-code"]).status.success());
    std::fs::remove_dir_all(dir).unwrap();
}
#[test] fn shop_packs_are_signed_from_a_folder_and_refuse_what_the_app_would() {
    let dir=std::env::temp_dir().join(format!("peta-pass-shop-{}",peta_core::ids::new_sticker_id()));std::fs::create_dir_all(&dir).unwrap();
    let key=dir.join("test-only.key");let key=key.to_str().unwrap();assert!(run(&["keygen","--out",key]).status.success());
    let public=String::from_utf8(run(&["pubkey",key]).stdout).unwrap();let public=public.lines().next().unwrap().to_owned();
    let png=|w:u32,h:u32,alpha:bool|{
        let mut px=Vec::new();for y in 0..h {for x in 0..w {let inside=(x as i64-w as i64/2).pow(2)+(y as i64-h as i64/2).pow(2)<(w.min(h) as i64/3).pow(2);px.extend_from_slice(&[180,90,60,if inside||!alpha {255} else {0}]);}}
        let mut out=Vec::new();peta_core::image_limits::encode_rgba_png(&mut out,&px,w,h).unwrap();out
    };
    let pack=dir.join("pack");std::fs::create_dir_all(&pack).unwrap();
    let json=serde_json::json!({"packId":"autumn-walk","version":1,"title":"Autumn Walk","by":"Peta","blurb":"Leaves on the way home.","pouch":"kraft","price":12,
        "items":[{"key":"maple","name":"Maple Leaf","rarity":"common","weight":4},{"key":"acorn","name":"Acorn","rarity":"uncommon"},{"key":"chestnut","name":"Chestnut","rarity":"rare"}]});
    std::fs::write(pack.join("pack.json"),serde_json::to_vec(&json).unwrap()).unwrap();
    for k in ["maple","acorn","chestnut"] {std::fs::write(pack.join(format!("{k}.png")),png(64,48,true)).unwrap();}
    let out=dir.join("autumn.peta");
    let made=run(&["shop-pack","--key",key,"--key-id","k1","--dir",pack.to_str().unwrap(),"--out",out.to_str().unwrap(),"--json"]);
    assert!(made.status.success(),"{}",String::from_utf8_lossy(&made.stderr));
    let summary:serde_json::Value=serde_json::from_slice(&made.stdout).unwrap();
    let bytes=std::fs::read(&out).unwrap();
    assert_eq!(summary["size"].as_u64().unwrap() as usize,bytes.len());assert_eq!(summary["sha256"],peta_core::shop_pack::sha256(&bytes));
    assert_eq!(summary["publicKey"],public);
    let verified=peta_core::shop_pack::verify_with(&bytes,|_|peta_core::sign::parse_public(&public)).unwrap();assert_eq!(verified.pack.items.len(),3);
    assert!(!String::from_utf8_lossy(&made.stdout).contains(&base64::Engine::encode(&base64::engine::general_purpose::STANDARD,std::fs::read(key).unwrap())));
    // --check reads no key and writes nothing; it tells the chances and refuses a version that is not newer.
    let checked=run(&["shop-pack","--check","--json","--dir",pack.to_str().unwrap(),"--previous-version","0"]);
    assert!(checked.status.success(),"{}",String::from_utf8_lossy(&checked.stderr));
    let report:serde_json::Value=serde_json::from_slice(&checked.stdout).unwrap();
    assert_eq!(report["items"][0]["weight"],4);assert_eq!(report["items"][1]["weight"],2);assert!((report["items"][2]["chance"].as_f64().unwrap()-1.0/7.0).abs()<1e-9);
    assert!(!run(&["shop-pack","--check","--dir",pack.to_str().unwrap(),"--previous-version","1"]).status.success());
    assert!(run(&["verify",out.to_str().unwrap(),"--public-key",&public]).status.success());
    // Never overwrites, never signs with a coupon key, and refuses an opaque picture or a missing one.
    assert!(!run(&["shop-pack","--key",key,"--key-id","k1","--dir",pack.to_str().unwrap(),"--out",out.to_str().unwrap()]).status.success());
    let other=|name:&str|dir.join(name).to_str().unwrap().to_owned();
    assert!(!run(&["shop-pack","--key",key,"--key-id","c1","--dir",pack.to_str().unwrap(),"--out",&other("coupon.peta")]).status.success());
    std::fs::write(pack.join("acorn.png"),png(64,48,false)).unwrap();
    assert!(!run(&["shop-pack","--key",key,"--key-id","k1","--dir",pack.to_str().unwrap(),"--out",&other("opaque.peta")]).status.success());
    std::fs::remove_file(pack.join("acorn.png")).unwrap();
    assert!(!run(&["shop-pack","--key",key,"--key-id","k1","--dir",pack.to_str().unwrap(),"--out",&other("missing.peta")]).status.success());
    assert!(!dir.join("coupon.peta").exists() && !dir.join("opaque.peta").exists() && !dir.join("missing.peta").exists());
    std::fs::remove_dir_all(dir).unwrap();
}
