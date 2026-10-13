//! Friend Market (server S3). Packs are sealed on the maker's Mac and opened only by approved friends; a pull pays Scraps here and
//! the service records the slot, its edition and the sale together. The rules and durable records live in `peta_core::market`;
//! this module only moves bytes. The Library lock is never held during HTTP. Without the `server` feature every command answers
//! "unavailable" and nothing is sent.
use serde::Serialize;
use tauri::AppHandle;

use crate::store::Store;
use peta_core::market::{Listing, Seen};

#[cfg(not(feature = "server"))]
const UNAVAILABLE: &str = "Friends' packs need Peta's server, which this build does not include yet.";

impl peta_core::market::Locked for Store {
    fn with<T>(&self, f: impl FnOnce(&mut peta_core::Library) -> peta_core::Result<T>) -> peta_core::Result<T> { f(&mut self.lock()) }
}

/// What the Market shows from friends, and the state of my own listings.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FriendMarket {
    /// This build can talk to friends at all.
    pub enabled: bool,
    /// The list is the one saved last time, because the service could not be reached.
    pub offline: bool,
    pub has_friends: bool,
    pub listings: Vec<Seen>,
    pub mine: Vec<Listing>,
    pub balance: i64,
    pub price: u32,
}
/// A friend's card with how many of each design and prize are already taken.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardView { pub listing: Seen, pub taken: Vec<u32> }

macro_rules! market_command {
    ($(#[$doc:meta])* $name:ident ( $($arg:ident : $ty:ty),* ) -> $out:ty => $body:path) => {
        $(#[$doc])*
        #[tauri::command]
        pub async fn $name(app: AppHandle $(, $arg: $ty)*) -> Result<$out, String> {
            #[cfg(feature = "server")]
            { tauri::async_runtime::spawn_blocking(move || $body(&app $(, $arg)*)).await.map_err(|e| e.to_string())? }
            #[cfg(not(feature = "server"))]
            { let _ = (&app $(, &$arg)*); Err(UNAVAILABLE.into()) }
        }
    };
}

/// Friends' listings. Without the server this is an empty, disabled Market (the shelf of bundled packs is unaffected).
#[tauri::command]
pub async fn market_friend_listings(app: AppHandle) -> Result<FriendMarket, String> {
    #[cfg(feature = "server")]
    { tauri::async_runtime::spawn_blocking(move || net::listings(&app)).await.map_err(|e| e.to_string())? }
    #[cfg(not(feature = "server"))]
    { let _ = app; Ok(FriendMarket { price: peta_core::market::FRIEND_PULL_PRICE, ..FriendMarket::default() }) }
}
market_command!(/// One friend's card, fetched if needed, with the slots taken so far.
    market_card(listing_id: String) -> CardView => net::card);
market_command!(/// Pay for one pull from a friend's pack and open it.
    market_pull(listing_id: String, queue: Option<bool>) -> crate::packs::Opened => net::pull);
market_command!(/// Show a finished own pack to friends (or open it again after a pause).
    market_list_pack(pack_id: String) -> Listing => net::list);
market_command!(/// Take a listing down for now; it stays on My shelf and can be shown again.
    market_pause_pack(pack_id: String) -> Listing => net::pause);
market_command!(/// Stop selling for good. Stickers already pulled stay with the friends who pulled them.
    market_close_pack(pack_id: String) -> Listing => net::close);
market_command!(/// Count Scraps earned from friends' pulls.
    market_payouts_sync() -> peta_core::market::Payout => net::payouts);

/// After launch, focus, or a change to friends: bring listings, envelopes, pending pulls and payouts up to date, in the background.
pub fn kickoff(app: &AppHandle) {
    #[cfg(feature = "server")]
    {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || { let _ = net::sync(&app, false); });
    }
    #[cfg(not(feature = "server"))]
    let _ = app;
}

#[cfg(feature = "server")]
mod net {
    use super::*;
    use crate::referee::HttpReferee;
    use peta_core::{market::{self as m, Progress, RemoteListing, Sale}, ownership::RefereeError, Error};
    use std::sync::Mutex;
    use tauri::{Emitter, Manager};

    /// One Market conversation at a time: a pull, a listing step or a sync.
    static BUSY: Mutex<()> = Mutex::new(());
    /// The background pass runs at most once a minute (focus changes come often); opening Market always syncs.
    static LAST_PASS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
    fn now() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) }
    const LIST_MAX: usize = 512 * 1024;
    fn text(e: Error) -> String { e.to_string() }
    fn client(app: &AppHandle) -> Result<HttpReferee, Error> {
        let store = app.state::<Store>(); let mut lib = store.lock();
        crate::referee_access::active(&mut lib)
    }
    fn offline(e: &Error) -> bool { matches!(e, Error::Referee(RefereeError::Offline)) }
    fn ok(status: u16, bytes: &[u8]) -> Result<(), Error> { if (200..300).contains(&status) { Ok(()) } else { Err(HttpReferee::refused(status, bytes)) } }
    fn done(c: &HttpReferee, method: &str, path: &str, body: Option<serde_json::Value>) -> Result<(), Error> { c.request::<serde_json::Value>(method, path, body.as_ref()).map(|_| ()) }
    /// Friends' packs are only talked about once there is a friend or a listing of mine: never otherwise.
    fn talks(app: &AppHandle) -> Result<bool, Error> {
        let store = app.state::<Store>(); let lib = store.lock();
        Ok(lib.db().friends_anyone()? || !m::listings(lib.db())?.is_empty() || !m::pending_pulls(lib.db())?.is_empty())
    }
    fn today(app: &AppHandle) -> String { app.state::<crate::today::Today>().date() }

    /* ---------- My listings ---------- */

    /// Push one listing as far as it can go: register, upload both sealed files, share envelopes with friends, and open it when asked.
    fn advance(app: &AppHandle, c: &HttpReferee, mut l: Listing, open: bool) -> Result<Listing, Error> {
        let store = app.state::<Store>();
        if l.state == "closed" { return Ok(l); }
        if !l.registered {
            done(c, "POST", "/v1/market/listings", Some(serde_json::to_value(l.registration()).map_err(|e| Error::Invalid(e.to_string()))?))?;
            l = m::record(&mut store.lock(), &l.listing_id, Progress::Registered)?;
        }
        for (kind, step, uploaded) in [("card", Progress::CardUploaded, l.card_uploaded), ("pack", Progress::PackUploaded, l.pack_uploaded)] {
            if uploaded { continue; }
            let bytes = m::upload_bytes(&store.lock(), &l.listing_id, kind)?;
            let (status, answer) = c.exchange_bulk("PUT", &format!("/v1/market/listings/{}/{kind}", l.listing_id), &bytes, "application/octet-stream", 64 * 1024)?;
            ok(status, &answer)?;
            l = m::record(&mut store.lock(), &l.listing_id, step)?;
        }
        envelopes(app, c, &l.listing_id)?;
        if open && l.state != "open" {
            done(c, "POST", &format!("/v1/market/listings/{}/open", l.listing_id), None)?;
            l = m::record(&mut store.lock(), &l.listing_id, Progress::Open)?;
        }
        Ok(l)
    }
    /// Approved friends get an envelope for the content key; removed and blocked people lose theirs.
    fn envelopes(app: &AppHandle, c: &HttpReferee, listing: &str) -> Result<(), Error> {
        let store = app.state::<Store>();
        for _ in 0..5 {
            let changes = m::envelope_changes(&store.lock(), listing)?;
            if changes.is_empty() { return Ok(()); }
            done(c, "PUT", &format!("/v1/market/listings/{listing}/envelopes"), Some(changes.body()))?;
            m::envelopes_sent(&mut store.lock(), listing, &changes)?;
        }
        Ok(())
    }
    pub fn list(app: &AppHandle, pack_id: String) -> Result<Listing, String> {
        let _one = BUSY.lock().unwrap_or_else(|e| e.into_inner());
        let l = { let store = app.state::<Store>(); let mut lib = store.lock(); m::prepare_listing(&mut lib, &pack_id).map_err(text)? };
        let c = client(app).map_err(text)?;
        let l = advance(app, &c, l, true).map_err(text)?;
        let _ = app.emit("market-changed", ()); Ok(l)
    }
    fn mine(app: &AppHandle, pack_id: &str) -> Result<Listing, String> {
        let store = app.state::<Store>(); let lib = store.lock();
        m::listing(lib.db(), pack_id).map_err(text)?.ok_or_else(|| "This pack isn't in Market.".into())
    }
    pub fn pause(app: &AppHandle, pack_id: String) -> Result<Listing, String> {
        let _one = BUSY.lock().unwrap_or_else(|e| e.into_inner());
        let l = mine(app, &pack_id)?;
        if l.state == "open" { done(&client(app).map_err(text)?, "POST", &format!("/v1/market/listings/{}/pause", l.listing_id), None).map_err(text)?; }
        let l = if l.state == "closed" { l } else { m::record(&mut app.state::<Store>().lock(), &l.listing_id, Progress::Paused).map_err(text)? };
        let _ = app.emit("market-changed", ()); Ok(l)
    }
    pub fn close(app: &AppHandle, pack_id: String) -> Result<Listing, String> {
        let _one = BUSY.lock().unwrap_or_else(|e| e.into_inner());
        let l = mine(app, &pack_id)?;
        // A draft the service never saw is closed here only; anything registered is closed there first.
        if l.registered && l.state != "closed" {
            match done(&client(app).map_err(text)?, "DELETE", &format!("/v1/market/listings/{}", l.listing_id), None) {
                Ok(()) | Err(Error::Referee(RefereeError::Unknown)) => {}
                Err(e) => return Err(text(e)),
            }
        }
        let l = m::record(&mut app.state::<Store>().lock(), &l.listing_id, Progress::Closed).map_err(text)?;
        let _ = app.emit("market-changed", ()); Ok(l)
    }

    /* ---------- Friends' listings ---------- */

    fn fetch_listings(app: &AppHandle, c: &HttpReferee) -> Result<(), Error> {
        let remote: Vec<RemoteListing> = c.request_max("GET", "/v1/market/listings", None::<&()>, LIST_MAX)?;
        let fetch = { let store = app.state::<Store>(); let mut lib = store.lock(); m::store_seen(&mut lib, &remote)? };
        for id in fetch { fetch_card(app, c, &id)?; }
        Ok(())
    }
    fn fetch_card(app: &AppHandle, c: &HttpReferee, listing: &str) -> Result<m::Card, Error> {
        let (status, bytes) = c.exchange_bulk("GET", &format!("/v1/market/listings/{listing}/card"), &[], "application/json", m::MARKET_CARD_MAX + m::SEALED_OVERHEAD)?;
        ok(status, &bytes)?;
        let store = app.state::<Store>(); let mut lib = store.lock();
        m::store_card(&mut lib, listing, &bytes)
    }
    fn view(app: &AppHandle, offline: bool) -> Result<FriendMarket, Error> {
        let store = app.state::<Store>(); let lib = store.lock();
        Ok(FriendMarket { enabled: true, offline, has_friends: lib.db().friends_anyone()?, listings: m::seen(&lib)?, mine: m::listings(lib.db())?,
            balance: lib.db().scrap_status()?.balance, price: m::FRIEND_PULL_PRICE })
    }
    pub fn listings(app: &AppHandle) -> Result<FriendMarket, String> {
        let offline = match sync(app, true) { Ok(()) => false, Err(e) if offline(&e) => true, Err(e) => return Err(text(e)) };
        view(app, offline).map_err(text)
    }
    fn seen_one(app: &AppHandle, listing: &str) -> Result<Seen, String> {
        let store = app.state::<Store>(); let lib = store.lock();
        m::seen(&lib).map_err(text)?.into_iter().find(|s| s.listing_id == listing).ok_or_else(|| Error::from(RefereeError::Rejected("listing_closed".into())).to_string())
    }
    pub fn card(app: &AppHandle, listing_id: String) -> Result<CardView, String> {
        let mut seen = seen_one(app, &listing_id)?;
        let c = client(app).map_err(text)?;
        let card = match seen.card.clone() { Some(card) => card, None => fetch_card(app, &c, &listing_id).map_err(text)? };
        let taken = match peta_core::ownership::Referee::claimed_slots(&c, &seen.external_id) {
            Ok(slots) => m::card_taken(&card, &slots),
            Err(e) if offline(&e) => vec![],
            Err(e) => return Err(text(e)),
        };
        seen.card = Some(card);
        Ok(CardView { listing: seen, taken })
    }
    /// The pull-only copy of a friend's pack, fetched once on the first pull.
    fn pack_for(app: &AppHandle, c: &HttpReferee, listing: &str) -> Result<String, Error> {
        if let Some(id) = { let store = app.state::<Store>(); let lib = store.lock(); m::market_pack(lib.db(), listing)? } { return Ok(id); }
        if seen_one(app, listing).map_err(Error::Invalid)?.card.is_none() { fetch_card(app, c, listing)?; }
        let (status, bytes) = c.exchange_bulk("GET", &format!("/v1/market/listings/{listing}/pack"), &[], "application/json", m::MARKET_PACK_MAX + m::SEALED_OVERHEAD)?;
        ok(status, &bytes)?;
        let store = app.state::<Store>(); let mut lib = store.lock();
        m::install_pack(&mut lib, listing, &bytes)
    }
    pub fn pull(app: &AppHandle, listing_id: String, queue: Option<bool>) -> Result<crate::packs::Opened, String> {
        let _one = BUSY.lock().unwrap_or_else(|e| e.into_inner());
        crate::referee_access::before_operation(app);
        let c = client(app).map_err(text)?;
        let pack = pack_for(app, &c, &listing_id).map_err(text)?;
        let queue = queue.unwrap_or(true);
        let award = m::pull(&*app.state::<Store>(), &c, &pack, cfg!(feature = "developer"), &today(app), queue).map_err(text)?;
        let title = { let store = app.state::<Store>(); let lib = store.lock(); m::pack_title(lib.db(), &pack).map_err(text)? };
        if queue { crate::today::announce(app); }
        let _ = app.emit("market-changed", ());
        Ok(crate::packs::Opened { sticker_id: award.sticker_id, kind: award.kind, material_id: award.material_id, pack_title: title, remaining: award.remaining, rarity: Some(award.rarity), name: Some(award.name) })
    }

    /* ---------- Payouts ---------- */

    pub fn payouts(app: &AppHandle) -> Result<m::Payout, String> { collect(app, &client(app).map_err(text)?).map_err(text) }
    fn collect(app: &AppHandle, c: &HttpReferee) -> Result<m::Payout, Error> {
        let mut total = 0;
        loop {
            let after = { let store = app.state::<Store>(); let lib = store.lock(); m::payout_cursor(lib.db())? };
            let sales: Vec<Sale> = c.request_max("GET", &format!("/v1/market/payouts?after={after}"), None::<&()>, LIST_MAX)?;
            let paid = { let store = app.state::<Store>(); let mut lib = store.lock(); m::apply_payouts(lib.db_mut(), &sales)? };
            // Counted here first, then acknowledged: a lost ack only means the same sales come back and are skipped.
            if paid.upto > after { done(c, "POST", "/v1/market/payouts/ack", Some(serde_json::json!({"upTo": paid.upto})))?; }
            total += paid.credited;
            if sales.len() < 200 { if total > 0 { let _ = app.emit("market-earned", total); } return Ok(m::Payout { credited: total, ..paid }); }
        }
    }

    /* ---------- The background pass ---------- */

    /// Listings, envelopes, the friends' list, pending pulls and payouts. `wait` blocks behind a running Market operation; the
    /// background pass skips instead. The first offline answer stops the pass.
    pub fn sync(app: &AppHandle, wait: bool) -> Result<(), Error> {
        let _one = if wait { BUSY.lock().unwrap_or_else(|e| e.into_inner()) } else { match BUSY.try_lock() { Ok(g) => g, Err(_) => return Ok(()) } };
        if !talks(app)? { return Ok(()); }
        if !wait && now() - LAST_PASS.load(std::sync::atomic::Ordering::Relaxed) < 60 { return Ok(()); }
        LAST_PASS.store(now(), std::sync::atomic::Ordering::Relaxed);
        let c = client(app)?;
        let mut first: Option<Error> = None;
        let mut note = |e: Error| -> Result<(), Error> { if offline(&e) { return Err(e); } if first.is_none() { first = Some(e); } Ok(()) };
        let mine = { let store = app.state::<Store>(); let lib = store.lock(); m::listings(lib.db())? };
        for l in mine.into_iter().filter(|l| l.state != "closed") {
            // A draft keeps going (it was asked to open); a paused listing only keeps its envelopes current.
            let open = l.state == "draft";
            if let Err(e) = advance(app, &c, l, open) { note(e)?; }
        }
        if let Err(e) = fetch_listings(app, &c) { note(e)?; }
        let pending = { let store = app.state::<Store>(); let lib = store.lock(); m::pending_pulls(lib.db())? };
        for p in pending {
            if let Err(e) = m::send(&*app.state::<Store>(), &c, p, &today(app), false) { note(e)?; }
        }
        if let Err(e) = collect(app, &c) { note(e)?; }
        // Opening Market waits for this pass and redraws itself; only the background pass tells the window something changed.
        if !wait { let _ = app.emit("market-changed", ()); }
        first.map_or(Ok(()), Err)
    }
}
