//! A fake server and disposable minisign keys. No app installation or restart is performed.
use std::{
    io::{Read, Write},
    path::PathBuf,
    process::Command,
};
use tauri_plugin_updater::UpdaterExt;
fn command(args: &[&str], dir: &std::path::Path) {
    let cli = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("node_modules/.bin/tauri");
    let result = Command::new(cli)
        .args(args)
        .current_dir(dir)
        .env("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "")
        .output()
        .unwrap();
    assert!(result.status.success(), "Disposable test signing failed");
}
#[test]
fn fake_server_signature_bytes_and_signed_version_are_verified() {
    let dir = std::env::temp_dir().join(format!(
        "peta-updater-test-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_micros()
    ));
    std::fs::create_dir(&dir).unwrap();
    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _cleanup = Cleanup(dir.clone());
    command(&["signer", "generate", "--ci", "--write-keys", "key"], &dir);
    let public = std::fs::read_to_string(dir.join("key.pub")).unwrap();
    let package = b"disposable updater bytes";
    std::fs::write(dir.join("package"), package).unwrap();
    command(
        &[
            "signer",
            "sign",
            "--private-key-path",
            "key",
            "--app-version",
            "0.2.0",
            "package",
        ],
        &dir,
    );
    let signature = std::fs::read_to_string(dir.join("package.sig")).unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let endpoint = format!("{origin}/check");
    let manifest=serde_json::json!({"version":"0.2.0","platforms":{"darwin-aarch64":{"url":format!("{origin}/file"),"signature":signature},"darwin-x86_64":{"url":format!("{origin}/file"),"signature":signature}}}).to_string();
    let server = std::thread::spawn(move || {
        for i in 0..2 {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(10)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                socket.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            let body = if i == 0 {
                manifest.as_bytes()
            } else {
                package.as_slice()
            };
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: {}\r\nConnection: close\r\n\r\n",body.len(),if i==0{"application/json"}else{"application/gzip"}).unwrap();
            socket.write_all(body).unwrap();
        }
    });
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert("updater".into(),serde_json::json!({"pubkey":public.trim(),"requireSignedVersion":true,"dangerousInsecureTransportProtocol":true}));
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    tauri::async_runtime::block_on(async {
        let updater = app
            .updater_builder()
            .endpoints(vec![endpoint.parse().unwrap()])
            .unwrap()
            .executable_path(dir.join("Peta.app/Contents/MacOS/Peta"))
            .timeout(std::time::Duration::from_secs(10))
            .configure_client(|c| c.redirect(reqwest::redirect::Policy::none()))
            .build()
            .unwrap();
        let update = updater.check().await.unwrap().unwrap();
        let bytes = update.download(|_, _| {}, || {}).await.unwrap();
        assert_eq!(bytes, package);
        assert!(update.verify(b"wrong bytes").is_err());
        let mut wrong_version = update.clone();
        wrong_version.version = "0.3.0".into();
        assert!(wrong_version.verify(&bytes).is_err());
        // A valid signature from a different disposable signing identity is never accepted.
        command(
            &["signer", "generate", "--ci", "--write-keys", "other"],
            &dir,
        );
        std::fs::remove_file(dir.join("package.sig")).unwrap();
        command(
            &[
                "signer",
                "sign",
                "--private-key-path",
                "other",
                "--app-version",
                "0.2.0",
                "package",
            ],
            &dir,
        );
        let mut wrong_key = update.clone();
        wrong_key.signature = std::fs::read_to_string(dir.join("package.sig")).unwrap();
        assert!(wrong_key.verify(&bytes).is_err());
        // Legacy signatures without a bound version are rejected too.
        std::fs::remove_file(dir.join("package.sig")).unwrap();
        command(
            &["signer", "sign", "--private-key-path", "key", "package"],
            &dir,
        );
        let mut unbound = update;
        unbound.signature = std::fs::read_to_string(dir.join("package.sig")).unwrap();
        assert!(unbound.verify(&bytes).is_err());
    });
    server.join().unwrap();
}
