//! Feature-gated, bounded synchronous transport. Call only from blocking workers.
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::SigningKey;
use peta_core::{
    ownership::{Creation, PackRegistration, Referee, RefereeError, Status, Transfer},
    sign, Error, Result,
};
use serde::{de::DeserializeOwned, Serialize};
use std::{
    io::Read,
    sync::atomic::{AtomicI64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub const API_URL: &str = "https://peta-api-dev.peta-api.workers.dev";
static LAST_CONTACT: AtomicI64 = AtomicI64::new(0);
pub fn endpoint() -> String {
    #[cfg(feature = "developer")]
    if let Ok(url) = std::env::var("PETA_API_URL") {
        return url.trim_end_matches('/').into();
    }
    API_URL.into()
}
pub fn last_contact() -> Option<i64> {
    let time = LAST_CONTACT.load(Ordering::Relaxed);
    (time != 0).then_some(time)
}
pub struct HttpReferee {
    key: SigningKey,
    url: String,
    agent: ureq::Agent,
}
impl HttpReferee {
    pub fn new(root: &std::path::Path) -> Result<Self> {
        Self::with_url(peta_core::device_key::load_or_create(root)?, endpoint())
    }
    pub(crate) fn with_url(key: SigningKey, url: String) -> Result<Self> {
        // Production uses HTTPS. Loopback HTTP is allowed for developer test servers only.
        let secure = url.starts_with("https://");
        #[cfg(feature = "developer")]
        let secure =
            secure || url.starts_with("http://127.0.0.1:") || url.starts_with("http://localhost:");
        #[cfg(test)]
        let secure = secure || url.starts_with("http://127.0.0.1:");
        if !secure || url.contains(['?', '#', '@']) {
            return Err(Error::Invalid("Invalid Peta API URL.".into()));
        }
        Ok(Self {
            key,
            url,
            agent: ureq::AgentBuilder::new()
                .timeout(Duration::from_secs(10))
                .redirects(0)
                .build(),
        })
    }
    /// One signed exchange. `body` is sent as is (JSON or sealed bytes); at most `max` bytes are read back.
    pub(crate) fn exchange(&self, method: &str, path: &str, body: &[u8], content_type: &str, max: usize) -> Result<(u16, Vec<u8>)> {
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| RefereeError::Rejected("clock_skew".into()))?
            .as_secs()
            .to_string();
        let mut nonce = [0; 16];
        getrandom::fill(&mut nonce).map_err(|_| RefereeError::Offline)?;
        let nonce = STANDARD.encode(nonce);
        let signature = STANDARD.encode(sign::sign(
            &self.key,
            &peta_core::ownership::request_bytes(method, path, &time, &nonce, body),
        ));
        let r = self
            .agent
            .request(method, &format!("{}{path}", self.url))
            .set("Content-Type", content_type)
            .set("X-Peta-Key", &sign::public_key(&self.key))
            .set("X-Peta-Time", &time)
            .set("X-Peta-Nonce", &nonce)
            .set("X-Peta-Sig", &signature)
            .send_bytes(body);
        let (status, response) = match r {
            Ok(r) => (r.status(), r),
            Err(ureq::Error::Status(status, r)) => (status, r),
            Err(_) => return Err(RefereeError::Offline.into()),
        };
        let mut bytes = vec![];
        response
            .into_reader()
            .take(max as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| RefereeError::Offline)?;
        if bytes.len() > max || status >= 500 {
            return Err(RefereeError::Offline.into());
        }
        LAST_CONTACT.store(time.parse().unwrap_or(0), Ordering::Relaxed);
        Ok((status, bytes))
    }
    /// A failed status as the referee's error: 404 is Unknown, anything else carries the Worker's code.
    pub(crate) fn refused(status: u16, bytes: &[u8]) -> Error {
        if status == 404 {
            return RefereeError::Unknown.into();
        }
        let code = serde_json::from_slice::<serde_json::Value>(bytes)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_owned))
            .unwrap_or_else(|| "refused".into());
        RefereeError::Rejected(code).into()
    }
    pub(crate) fn request<T: DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        body: Option<&impl Serialize>,
    ) -> Result<T> {
        let body = body
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|e| Error::Invalid(e.to_string()))?
            .unwrap_or_default();
        let (status, bytes) = self.exchange(method, path, &body, "application/json", 64 * 1024)?;
        if !(200..300).contains(&status) {
            return Err(Self::refused(status, &bytes));
        }
        serde_json::from_slice(&bytes).map_err(|_| RefereeError::Offline.into())
    }
    fn post(&self, path: &str, body: &impl Serialize) -> Result<()> {
        let _: serde_json::Value = self.request("POST", path, Some(body))?;
        Ok(())
    }
    fn slots(&self, id: &str) -> Result<Vec<u32>> {
        #[derive(serde::Deserialize)]
        struct Slots {
            slots: Vec<u32>,
        }
        Ok(self
            .request::<Slots>("GET", &format!("/v1/packs/{id}/slots"), None::<&()>)?
            .slots)
    }
}
impl Referee for HttpReferee {
    fn register(&self, c: &Creation) -> Result<()> {
        self.post("/v1/stickers", c)
    }
    fn release(&self, t: &Transfer) -> Result<()> {
        self.post(&format!("/v1/stickers/{}/release", t.sticker_id), t)
    }
    fn cancel_release(&self, t: &Transfer) -> Result<()> {
        self.post(&format!("/v1/stickers/{}/cancel", t.sticker_id), t)
    }
    fn claim(&self, t: &Transfer) -> Result<()> {
        self.post(&format!("/v1/stickers/{}/claim", t.sticker_id), t)
    }
    fn register_pack(&self, p: &PackRegistration) -> Result<()> {
        self.post("/v1/packs", p)
    }
    fn cancel_pack(&self, p: &PackRegistration) -> Result<()> {
        self.post(&format!("/v1/packs/{}/cancel", p.pack_id), p)
    }
    fn claim_slot(&self, id: &str, slot: u32, t: Option<&Transfer>) -> Result<()> {
        self.post(
            &format!("/v1/packs/{id}/slots/{slot}/claim"),
            &serde_json::json!({"claim":t}),
        )
    }
    fn claimed_slots(&self, id: &str) -> Result<Vec<u32>> {
        self.slots(id)
    }
    fn pack_known(&self, id: &str) -> Result<bool> {
        match self.slots(id) {
            Ok(_) => Ok(true),
            Err(Error::Referee(RefereeError::Unknown)) => Ok(false),
            Err(e) => Err(e),
        }
    }
    fn status(&self, id: &str) -> Result<Status> {
        #[derive(serde::Deserialize)]
        struct Held {
            state: String,
            holder_key: String,
        }
        match self.request::<Held>("GET", &format!("/v1/stickers/{id}"), None::<&()>) {
            Ok(s) if s.state == "held" => Ok(Status::Held {
                holder: s.holder_key,
            }),
            Ok(_) => Ok(Status::Released),
            Err(Error::Referee(RefereeError::Unknown)) => Ok(Status::Unknown),
            Err(e) => Err(e),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transport_signs_exact_bytes_and_maps_server_errors() {
        use std::io::Write;
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let key = SigningKey::from_bytes(&[7; 32]);
        let public = sign::public_key(&key);
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = vec![];
            let mut byte = [0; 1];
            while !bytes.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                bytes.push(byte[0]);
            }
            let text = String::from_utf8(bytes).unwrap();
            let headers = std::collections::HashMap::<_, _>::from_iter(
                text.lines()
                    .skip(1)
                    .filter_map(|l| l.split_once(':'))
                    .map(|(k, v)| (k.to_lowercase(), v.trim().to_owned())),
            );
            assert_eq!(headers["x-peta-key"], public);
            let content_length = headers["content-length"].parse::<usize>().unwrap();
            let mut body = vec![0; content_length];
            stream.read_exact(&mut body).unwrap();
            let proof = peta_core::ownership::request_bytes(
                "POST",
                "/v1/stickers",
                &headers["x-peta-time"],
                &headers["x-peta-nonce"],
                &body,
            );
            sign::verify(
                &sign::parse_public(&public).unwrap(),
                &proof,
                &STANDARD.decode(&headers["x-peta-sig"]).unwrap(),
            )
            .unwrap();
            let response = r#"{"error":"clock_skew","message":"Check time."}"#;
            write!(stream,"HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",response.len()).unwrap();
        });
        let referee = HttpReferee::with_url(key, url).unwrap();
        let c = Creation::new("mock", None, "2026-01-01T00:00:00Z", b"png", &referee.key).unwrap();
        assert!(
            matches!(referee.register(&c),Err(Error::Referee(RefereeError::Rejected(c))) if c=="clock_skew")
        );
        thread.join().unwrap();
    }
    #[test]
    fn request_bytes_use_the_rust_vectors() {
        let v: serde_json::Value =
            serde_json::from_str(include_str!("../../cloudflare/peta-api/test/vectors.json"))
                .unwrap();
        for r in v["requests"].as_array().unwrap() {
            assert_eq!(
                STANDARD.encode(peta_core::ownership::request_bytes(
                    r["method"].as_str().unwrap(),
                    r["path"].as_str().unwrap(),
                    r["time"].as_str().unwrap(),
                    r["nonce"].as_str().unwrap(),
                    r["body"].as_str().unwrap().as_bytes()
                )),
                r["bytes"].as_str().unwrap()
            );
        }
    }
}
