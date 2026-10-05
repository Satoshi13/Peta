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
