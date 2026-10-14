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
