//! Local paper exchanges. Prices stay in Rust; stock, balance and receipts commit together.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use crate::{error::{Error, Result}, pack};

const BALANCE_KEY: &str = "scraps.balance";
const MAX_SAFE_COUNT: i64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialRate { pub id: &'static str, pub dismantle: i64, pub exchange: Option<i64> }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackRate { pub id: &'static str, pub exchange: i64, pub stickers: usize }

const MATERIALS: [MaterialRate; 10] = [
    MaterialRate { id:"matte", dismantle:1, exchange:Some(1) },
    MaterialRate { id:"kraft", dismantle:1, exchange:Some(2) },
    MaterialRate { id:"holographic", dismantle:3, exchange:Some(6) },
    MaterialRate { id:"gold", dismantle:6, exchange:Some(12) },
    MaterialRate { id:"riso", dismantle:1, exchange:Some(2) },
    MaterialRate { id:"vintage", dismantle:4, exchange:Some(8) },
    MaterialRate { id:"clear", dismantle:3, exchange:Some(6) },
    MaterialRate { id:"pixel", dismantle:1, exchange:Some(2) },
    MaterialRate { id:"washi", dismantle:1, exchange:Some(2) },
    MaterialRate { id:"sakura", dismantle:4, exchange:None },
];
const PACKS: [(&str, i64); 6] = [("tokyo",16),("coffee",12),("plants",10),("pixel",12),("cats",10),("night",12)];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status { pub balance: i64, pub materials: Vec<MaterialRate>, pub packs: Vec<PackRate> }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind { Dismantle, Material, Pack }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Trade { pub kind: Kind, pub item_id: String, pub quantity: i64 }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt { pub request_id: String, pub trade: Trade, pub delta: i64, pub balance: i64 }

fn invalid(message: &str) -> Error { Error::Invalid(message.into()) }
fn balance(conn: &Connection) -> Result<i64> {
    let value: Option<String> = conn.query_row("SELECT value FROM meta WHERE key=?1", [BALANCE_KEY], |r| r.get(0)).optional()?;
    let n = value.map(|s| s.parse::<i64>()).transpose().map_err(|_| invalid("Scraps balance could not be read."))?.unwrap_or(0);
    if !(0..=MAX_SAFE_COUNT).contains(&n) { return Err(invalid("Scraps balance is out of range.")); }
    Ok(n)
}
pub(crate) fn status(conn: &Connection) -> Result<Status> {
    Ok(Status { balance:balance(conn)?, materials:MATERIALS.to_vec(), packs:PACKS.iter().map(|(id,exchange)| PackRate { id, exchange:*exchange, stickers:pack::market_pack(id).unwrap().keys.len() }).collect() })
}

pub(crate) fn trade(conn: &mut Connection, request: &Trade, request_id: &str, unrestricted: bool) -> Result<Receipt> {
    if request_id.is_empty() || request_id.len()>128 || !request_id.bytes().all(|c| c.is_ascii_alphanumeric() || c==b'-') {
        return Err(invalid("Invalid exchange request."));
    }
    if !(1..=1000).contains(&request.quantity) { return Err(invalid("Choose between 1 and 1000 sheets.")); }
    let key = format!("scraps.tx.{request_id}");
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if let Some(saved) = tx.query_row("SELECT value FROM meta WHERE key=?1", [&key], |r| r.get::<_,String>(0)).optional()? {
        let receipt: Receipt = serde_json::from_str(&saved).map_err(|_| invalid("Exchange receipt could not be read."))?;
        if receipt.trade!=*request { return Err(invalid("This exchange request was already used.")); }
        return Ok(receipt);
    }
    let rate = MATERIALS.iter().find(|m| m.id==request.item_id);
    let delta = match request.kind {
        Kind::Dismantle => rate.ok_or_else(|| invalid("This material cannot be dismantled."))?.dismantle * request.quantity,
        Kind::Material => -rate.and_then(|m| m.exchange).ok_or_else(|| invalid("This material is not available to exchange."))? * request.quantity,
        Kind::Pack => {
            if request.quantity!=1 { return Err(invalid("Exchange for one pack at a time.")); }
            -PACKS.iter().find(|(id,_)| *id==request.item_id).ok_or_else(|| invalid("This pack is not available to exchange."))?.1
        }
    };
    let delta = if unrestricted && delta<0 { 0 } else { delta };
    let next = balance(&tx)?.checked_add(delta).ok_or_else(|| invalid("Scraps balance is out of range."))?;
    if next<0 { return Err(invalid("Not enough Scraps.")); }
    if next>MAX_SAFE_COUNT { return Err(invalid("Scraps balance is out of range.")); }
    match request.kind {
        Kind::Dismantle => {
            if !unrestricted && tx.execute("UPDATE material_stock SET count=count-?2 WHERE material_id=?1 AND count>=?2", params![request.item_id,request.quantity])?==0 {
                return Err(invalid("Not enough material sheets."));
            }
        }
        Kind::Material => {
            let held: i64 = tx.query_row("SELECT count FROM material_stock WHERE material_id=?1", [&request.item_id], |r| r.get(0)).optional()?.unwrap_or(0);
            if held>MAX_SAFE_COUNT-request.quantity { return Err(invalid("Material stock is out of range.")); }
            tx.execute("INSERT INTO material_stock(material_id,count) VALUES(?1,?2) ON CONFLICT(material_id) DO UPDATE SET count=count+excluded.count", params![request.item_id,request.quantity])?;
            tx.execute("INSERT OR IGNORE INTO material_unlocks(material_id,unlocked_at) VALUES(?1,?2)", params![request.item_id,chrono::Utc::now().to_rfc3339()])?;
        }
        Kind::Pack => {
            let own: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM packs WHERE id=?1)", [&request.item_id], |r| r.get(0))?;
            let p = pack::market_pack(&request.item_id).unwrap();
            if !own {
                if p.free { return Err(invalid("Get this pack for free before refilling it.")); }
                tx.execute("INSERT INTO packs(id,title,by_name,created_at) VALUES(?1,?2,?3,?4)", params![p.id,p.title,p.by,chrono::Utc::now().to_rfc3339()])?;
            }
            let left: i64 = tx.query_row("SELECT COUNT(*) FROM pack_items WHERE pack_id=?1 AND opened_at IS NULL", [&request.item_id], |r| r.get(0))?;
            if left!=0 { return Err(invalid("Open the remaining stickers before refilling this pack.")); }
            for item in pack::market_pack(&request.item_id).unwrap().keys {
                tx.execute("INSERT INTO pack_items(pack_id,item_key) VALUES(?1,?2)", params![request.item_id,item])?;
            }
        }
    }
    let receipt = Receipt { request_id:request_id.into(), trade:request.clone(), delta, balance:next };
    let saved = serde_json::to_string(&receipt).map_err(|_| invalid("Exchange receipt could not be saved."))?;
    tx.execute("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![BALANCE_KEY,next.to_string()])?;
    tx.execute("INSERT INTO meta(key,value) VALUES(?1,?2)", params![key,saved])?;
    tx.commit()?;
    Ok(receipt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db::Database, ids, materials};
    fn request(kind: Kind, id: &str, quantity: i64) -> Trade { Trade { kind, item_id:id.into(), quantity } }
    fn funded() -> Database {
        let mut db=Database::open_in_memory().unwrap();
        db.unlock_material("holographic").unwrap();db.add_material("holographic",20).unwrap();
        db.scrap_trade(&request(Kind::Dismantle,"holographic",20),"fund").unwrap();db
    }
    #[test]
    fn dismantling_preserves_discovery_and_cannot_spend_unowned_sheets() {
        let mut db=Database::open_in_memory().unwrap();
        db.unlock_material("kraft").unwrap();let found=db.material_unlocked_at("kraft").unwrap();db.add_material("kraft",2).unwrap();
        assert_eq!(db.scrap_trade(&request(Kind::Dismantle,"kraft",2),"one").unwrap().balance,2);
        assert_eq!(db.material_count("kraft").unwrap(),0);assert_eq!(db.material_unlocked_at("kraft").unwrap(),found);
        for id in ["kraft","matte","gold","unknown"] { assert!(db.scrap_trade(&request(Kind::Dismantle,id,1),id).is_err()); }
        assert_eq!(db.scrap_status().unwrap().balance,2);assert!(!db.has_material(materials::DEFAULT_MATERIAL).unwrap());
    }
    #[test]
    fn exchange_prices_cannot_create_scraps_and_unlocks_keep_their_original_date() {
        let mut db=funded();let found=db.material_unlocked_at("holographic").unwrap();
        db.scrap_trade(&request(Kind::Material,"kraft",3),"buy-kraft").unwrap();
        assert_eq!(db.material_count("kraft").unwrap(),3);assert!(db.material_unlocked_at("kraft").unwrap().is_some());
        db.scrap_trade(&request(Kind::Material,"holographic",2),"buy-holo").unwrap();
        assert_eq!(db.material_unlocked_at("holographic").unwrap(),found);
        db.scrap_trade(&request(Kind::Dismantle,"kraft",3),"sell-kraft").unwrap();
        db.scrap_trade(&request(Kind::Dismantle,"holographic",2),"sell-holo").unwrap();
        assert_eq!(db.scrap_status().unwrap().balance,51);
    }
    #[test]
    fn new_material_exchanges_are_atomic_finite_and_cannot_mint_scraps() {
        let mut db=funded();
        for m in &MATERIALS[3..] {
            if let Some(cost)=m.exchange {
                let before=db.scrap_status().unwrap().balance;
                let req=request(Kind::Material,m.id,1);
                let receipt=db.scrap_trade(&req,&format!("get-{}",m.id)).unwrap();
                assert_eq!(db.scrap_trade(&req,&format!("get-{}",m.id)).unwrap(),receipt);
                assert_eq!(db.material_count(m.id).unwrap(),1);
                assert!(db.material_unlocked_at(m.id).unwrap().is_some());
                db.scrap_trade(&request(Kind::Dismantle,m.id,1),&format!("dismantle-{}",m.id)).unwrap();
                assert_eq!(db.material_count(m.id).unwrap(),0);
                assert_eq!(db.scrap_status().unwrap().balance,before-cost+m.dismantle);
                assert!(cost>m.dismantle);
            }
        }
        let before=db.scrap_status().unwrap().balance;
        assert!(db.scrap_trade(&request(Kind::Material,"sakura",1),"seasonal").is_err());
        assert_eq!(db.scrap_status().unwrap().balance,before);
        db.unlock_material("sakura").unwrap();db.add_material("sakura",1).unwrap();
        assert_eq!(db.scrap_trade(&request(Kind::Dismantle,"sakura",1),"gifted-sakura").unwrap().balance,before+4);
    }

    #[test]
    fn retries_return_the_saved_receipt_without_spending_again_and_changed_requests_are_rejected() {
        let mut db=funded();let req=request(Kind::Material,"kraft",2);
        let receipt=db.scrap_trade(&req,"same-id").unwrap();
        db.scrap_trade(&request(Kind::Material,"holographic",1),"another").unwrap();
        assert_eq!(db.scrap_trade(&req,"same-id").unwrap(),receipt);
        assert_eq!(db.scrap_status().unwrap().balance,50);assert_eq!(db.material_count("kraft").unwrap(),2);
        assert!(db.scrap_trade(&request(Kind::Material,"kraft",1),"same-id").is_err());
    }
    #[test]
    fn invalid_quantities_products_ids_and_insufficient_balance_do_not_mutate_stock() {
        let mut db=Database::open_in_memory().unwrap();
        for q in [0,-1,1001,i64::MAX] { assert!(db.scrap_trade(&request(Kind::Material,"kraft",q),"bad-q").is_err()); }
        for id in ["sakura","unknown"] { assert!(db.scrap_trade(&request(Kind::Material,id,1),"bad-material").is_err()); }
        for id in ["welcome","unknown"] { assert!(db.scrap_trade(&request(Kind::Pack,id,1),"bad-pack").is_err()); }
        for id in ["","../bad","id with spaces"] { assert!(db.scrap_trade(&request(Kind::Material,"kraft",1),id).is_err()); }
        assert!(db.scrap_trade(&request(Kind::Material,"kraft",1),"no-funds").is_err());
        assert_eq!(db.material_count("kraft").unwrap(),0);assert_eq!(db.scrap_status().unwrap().balance,0);
    }
    #[test]
    fn empty_packs_refill_without_overwriting_opened_history_or_welcome_allowance() {
        let mut db=funded();pack::ensure_welcome_pack(&mut db).unwrap();
        for (id,cost) in &PACKS[..3] {
            let p=pack::market_pack(id).unwrap();let req=request(Kind::Pack,id,1);
            assert!(db.scrap_trade(&req,&format!("missing-{id}")).is_err());
            db.pack_install(p.id,p.title,p.by,p.keys).unwrap();assert!(db.scrap_trade(&req,&format!("full-{id}")).is_err());
            while let Some((item,_))=db.pack_pick(id,0.0).unwrap() { db.pack_mark_opened(item,"old-sticker").unwrap(); }
            let before=db.scrap_status().unwrap().balance;
            db.scrap_trade(&req,&format!("refill-{id}")).unwrap();
            assert_eq!(db.scrap_status().unwrap().balance,before-cost);
            let row=db.packs().unwrap().into_iter().find(|p|p.id==*id).unwrap();assert_eq!(row.total,p.keys.len() as i64*2);assert_eq!(row.remaining,p.keys.len() as i64);
            assert!(!db.pack_install(p.id,p.title,p.by,p.keys).unwrap());
        }
        assert!(db.welcome_available("2026-10-04").unwrap());assert_eq!(db.packs().unwrap().iter().find(|p|p.id=="welcome").unwrap().total,12);
    }
    #[test]
    fn paid_packs_are_installed_atomically_and_retries_do_not_add_items() {
        let mut db=funded();
        for (id,cost) in &PACKS[3..] {
            let req=request(Kind::Pack,id,1);
            let before=db.scrap_status().unwrap().balance;
            let receipt=db.scrap_trade(&req,&format!("buy-{id}")).unwrap();
            assert_eq!(receipt.balance,before-cost);
            assert_eq!(db.scrap_trade(&req,&format!("buy-{id}")).unwrap(),receipt);
            let p=pack::market_pack(id).unwrap();
            let row=db.packs().unwrap().into_iter().find(|p|p.id==*id).unwrap();
            assert_eq!((row.total,row.remaining),(p.keys.len() as i64,p.keys.len() as i64));
            assert!(db.scrap_trade(&req,&format!("full-{id}")).is_err());
        }
    }
    #[test]
    fn matte_exchange_and_consumption_use_real_stock_without_creating_scraps() {
        let mut db=funded();
        db.scrap_trade(&request(Kind::Material,"matte",2),"paper").unwrap();
        db.consume_material("matte").unwrap();
        assert_eq!(db.material_count("matte").unwrap(),1);
        db.scrap_trade(&request(Kind::Dismantle,"matte",1),"scrap-paper").unwrap();
        assert_eq!(db.scrap_status().unwrap().balance,59);
        assert!(!db.has_material("matte").unwrap());
    }
    #[test]
    fn balance_stock_receipts_and_schema_survive_restart_and_failed_receipt_rolls_everything_back() {
        let dir=std::env::temp_dir().join(format!("peta-scraps-{}",ids::new_sticker_id()));std::fs::create_dir_all(&dir).unwrap();let path=dir.join("test.db");
        let req=request(Kind::Dismantle,"holographic",2);
        let receipt={let mut db=Database::open(&path).unwrap();db.unlock_material("holographic").unwrap();db.add_material("holographic",3).unwrap();db.scrap_trade(&req,"persist").unwrap()};
        let conn=Connection::open(&path).unwrap();assert_eq!(conn.query_row("PRAGMA user_version",[],|r|r.get::<_,i64>(0)).unwrap(),crate::db::SCHEMA_VERSION);
        let schema:String=conn.query_row("SELECT group_concat(sql) FROM sqlite_master WHERE sql IS NOT NULL",[],|r|r.get(0)).unwrap();
        conn.execute_batch("CREATE TRIGGER fail_scrap_receipt BEFORE INSERT ON meta WHEN NEW.key='scraps.tx.fail' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END;").unwrap();
        {
            let mut db=Database::open(&path).unwrap();assert_eq!(db.scrap_trade(&req,"persist").unwrap(),receipt);
            assert!(db.scrap_trade(&request(Kind::Material,"kraft",2),"fail").is_err());
            assert_eq!(db.material_count("kraft").unwrap(),0);assert!(db.material_unlocked_at("kraft").unwrap().is_none());assert_eq!(db.scrap_status().unwrap().balance,6);
            assert_eq!(db.material_count("holographic").unwrap(),1);
        }
        conn.execute_batch("DROP TRIGGER fail_scrap_receipt;").unwrap();
        assert_eq!(conn.query_row("SELECT group_concat(sql) FROM sqlite_master WHERE sql IS NOT NULL",[],|r|r.get::<_,String>(0)).unwrap(),schema);
        assert_eq!(conn.query_row("PRAGMA user_version",[],|r|r.get::<_,i64>(0)).unwrap(),crate::db::SCHEMA_VERSION);
        drop(conn);std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn receipt_failure_rolls_back_dismantling_and_partial_pack_refills() {
        let dir=std::env::temp_dir().join(format!("peta-scraps-{}",ids::new_sticker_id()));std::fs::create_dir_all(&dir).unwrap();let path=dir.join("test.db");
        let mut db=Database::open(&path).unwrap();db.add_material("holographic",20).unwrap();
        db.scrap_trade(&request(Kind::Dismantle,"holographic",20),"fund").unwrap();db.add_material("kraft",2).unwrap();
        let p=pack::market_pack("plants").unwrap();db.pack_install(p.id,p.title,p.by,p.keys).unwrap();
        while let Some((item,_))=db.pack_pick(p.id,0.0).unwrap() { db.pack_mark_opened(item,"previous-sticker").unwrap(); }
        let conn=Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TRIGGER fail_scrap_receipt BEFORE INSERT ON meta WHEN NEW.key='scraps.tx.fail' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END;").unwrap();
        for req in [request(Kind::Dismantle,"kraft",2),request(Kind::Pack,"plants",1),request(Kind::Pack,"cats",1)] {
            assert!(db.scrap_trade(&req,"fail").is_err());assert_eq!(db.scrap_status().unwrap().balance,60);assert_eq!(db.material_count("kraft").unwrap(),2);
            let row=db.packs().unwrap().pop().unwrap();assert_eq!((row.total,row.remaining),(5,0));
        }
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM pack_items WHERE sticker_id='previous-sticker'",[],|r|r.get::<_,i64>(0)).unwrap(),5);
        drop(conn);drop(db);std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn simultaneous_retries_share_one_transaction() {
        let dir=std::env::temp_dir().join(format!("peta-scraps-{}",ids::new_sticker_id()));std::fs::create_dir_all(&dir).unwrap();let path=dir.join("test.db");
        { let mut db=Database::open(&path).unwrap();db.add_material("holographic",2).unwrap(); }
        let barrier=std::sync::Arc::new(std::sync::Barrier::new(2));
        let workers:Vec<_>=(0..2).map(|_| { let barrier=barrier.clone();let path=path.clone();std::thread::spawn(move || {
            let mut db=Database::open(&path).unwrap();barrier.wait();db.scrap_trade(&request(Kind::Dismantle,"holographic",1),"same-request").unwrap()
        }) }).collect();
        let receipts:Vec<_>=workers.into_iter().map(|w|w.join().unwrap()).collect();assert_eq!(receipts[0],receipts[1]);
        let db=Database::open(&path).unwrap();assert_eq!(db.scrap_status().unwrap().balance,3);assert_eq!(db.material_count("holographic").unwrap(),1);
        drop(db);std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn corrupt_balance_and_unsafe_totals_fail_without_resetting_the_balance() {
        let dir=std::env::temp_dir().join(format!("peta-scraps-{}",ids::new_sticker_id()));std::fs::create_dir_all(&dir).unwrap();let path=dir.join("test.db");
        let mut db=Database::open(&path).unwrap();db.add_material("kraft",1).unwrap();let conn=Connection::open(&path).unwrap();
        for value in ["broken","-1","9007199254740992","9007199254740991"] {
            conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES(?1,?2)",params![BALANCE_KEY,value]).unwrap();
            assert!(db.scrap_trade(&request(Kind::Dismantle,"kraft",1),"bad-balance").is_err());assert_eq!(db.material_count("kraft").unwrap(),1);
            assert_eq!(conn.query_row("SELECT value FROM meta WHERE key=?1",[BALANCE_KEY],|r|r.get::<_,String>(0)).unwrap(),value);
        }
        drop(conn);drop(db);std::fs::remove_dir_all(dir).unwrap();
    }
}
