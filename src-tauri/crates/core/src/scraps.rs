//! Local paper exchanges. Prices stay in Rust; stock, balance and receipts commit together.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use crate::{error::{Error, Result}, pack};

const BALANCE_KEY: &str = "scraps.balance";
const MAX_SAFE_COUNT: i64 = 9_007_199_254_740_991;
/// A pack never holds more than this many sealed stickers, so repeated purchases stay readable and in range.
pub const MAX_SEALED_PER_PACK: i64 = 100;

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
pub struct Status { pub balance: i64, pub materials: Vec<MaterialRate>, pub packs: Vec<PackRate>, pub tools: Vec<ToolRate> }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRate { pub id: &'static str, pub exchange: i64 }
/// The link tag's price is provisional (owner has not fixed it).
const TOOLS: [ToolRate; 1] = [ToolRate { id: "link-tag", exchange: 2 }];
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind { Dismantle, Material, Pack, Tool }
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
    Ok(Status { balance:balance(conn)?, materials:MATERIALS.to_vec(), packs:PACKS.iter().map(|(id,exchange)| PackRate { id, exchange:*exchange, stickers:pack::market_pack(id).unwrap().keys.len() }).collect(), tools:TOOLS.to_vec() })
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
            // Sets are bought together: one price per set, all added to the same bag in one transaction.
            -PACKS.iter().find(|(id,_)| *id==request.item_id).ok_or_else(|| invalid("This pack is not available to exchange."))?.1 * request.quantity
        }
        Kind::Tool => -TOOLS.iter().find(|t| t.id==request.item_id).ok_or_else(|| invalid("This tool is not available."))?.exchange * request.quantity,
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
        Kind::Tool => {
            let owned: i64 = tx.query_row("SELECT value FROM meta WHERE key=?1", [crate::link_tag::OWNED_KEY], |r| r.get::<_,String>(0)).optional()?.and_then(|v| v.parse().ok()).unwrap_or(0);
            let next_owned = owned.checked_add(request.quantity).filter(|v| *v<=1_000_000).ok_or_else(|| invalid("Link tag count is out of range."))?;
            tx.execute("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![crate::link_tag::OWNED_KEY,next_owned.to_string()])?;
        }
        Kind::Pack => {
            let own: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM packs WHERE id=?1)", [&request.item_id], |r| r.get(0))?;
            let p = pack::market_pack(&request.item_id).unwrap();
            if !own {
                if p.free { return Err(invalid("Get this pack for free before refilling it.")); }
                tx.execute("INSERT INTO packs(id,title,by_name,created_at) VALUES(?1,?2,?3,?4)", params![p.id,p.title,p.by,chrono::Utc::now().to_rfc3339()])?;
            }
            let left: i64 = tx.query_row("SELECT COUNT(*) FROM pack_items WHERE pack_id=?1 AND opened_at IS NULL", [&request.item_id], |r| r.get(0))?;
            if left+p.keys.len() as i64*request.quantity>MAX_SEALED_PER_PACK { return Err(invalid("This pack already holds as many sealed stickers as it can.")); }
            for _ in 0..request.quantity {
                for item in pack::market_pack(&request.item_id).unwrap().keys {
                    tx.execute("INSERT INTO pack_items(pack_id,item_key) VALUES(?1,?2)", params![request.item_id,item])?;
                }
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
    fn a_link_tag_is_bought_with_scraps_once_per_request_and_adds_to_stock() {
        let mut db=funded();let before=db.scrap_status().unwrap().balance;
        let r=db.scrap_trade(&request(Kind::Tool,"link-tag",2),"tags").unwrap();
        assert_eq!((r.delta,db.scrap_status().unwrap().balance,db.link_tag_stock().unwrap().owned),(-4,before-4,2));
        assert_eq!(db.scrap_trade(&request(Kind::Tool,"link-tag",2),"tags").unwrap(),r);assert_eq!(db.link_tag_stock().unwrap().owned,2); // a retry never buys twice
        assert!(db.scrap_trade(&request(Kind::Tool,"unknown",1),"x").is_err());
        let mut poor=Database::open_in_memory().unwrap();assert!(poor.scrap_trade(&request(Kind::Tool,"link-tag",1),"p").is_err());assert_eq!(poor.link_tag_stock().unwrap().owned,0);
        assert_eq!(db.scrap_status().unwrap().tools[0].exchange,2);
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
    fn funded_by(extra: i64) -> Database {
        let mut db=funded();
        db.add_material("holographic",extra).unwrap();
        db.scrap_trade(&request(Kind::Dismantle,"holographic",extra),"fund-more").unwrap();db
    }
    #[test]
    fn owned_packs_take_another_set_whether_or_not_stickers_are_left_and_keep_history_and_welcome_allowance() {
        let mut db=funded_by(60);pack::ensure_welcome_pack(&mut db).unwrap();
        let welcome=db.packs().unwrap().into_iter().find(|p|p.id=="welcome").unwrap().total;
        for (id,cost) in &PACKS[..3] {
            let p=pack::market_pack(id).unwrap();let req=request(Kind::Pack,id,1);let n=p.keys.len() as i64;
            assert!(db.scrap_trade(&req,&format!("missing-{id}")).is_err());
            db.pack_install(p.id,p.title,p.by,p.keys).unwrap();
            let before=db.scrap_status().unwrap().balance;
            db.scrap_trade(&req,&format!("full-{id}")).unwrap();
            assert_eq!(db.scrap_status().unwrap().balance,before-cost);
            let row=db.packs().unwrap().into_iter().find(|p|p.id==*id).unwrap();assert_eq!((row.total,row.remaining),(n*2,n*2));
            while let Some((item,_))=db.pack_pick(id,0.0).unwrap() { db.pack_mark_opened(item,"old-sticker").unwrap(); }
            let before=db.scrap_status().unwrap().balance;
            db.scrap_trade(&req,&format!("refill-{id}")).unwrap();
            assert_eq!(db.scrap_status().unwrap().balance,before-cost);
            let row=db.packs().unwrap().into_iter().find(|p|p.id==*id).unwrap();assert_eq!((row.total,row.remaining),(n*3,n));
            assert!(!db.pack_install(p.id,p.title,p.by,p.keys).unwrap());
        }
        assert!(db.welcome_available("2026-10-04").unwrap());assert_eq!(db.packs().unwrap().iter().find(|p|p.id=="welcome").unwrap().total,welcome);
    }
    #[test]
    fn a_pack_stops_taking_sets_at_the_sealed_cap_without_spending() {
        let mut db=funded_by(60);
        let p=pack::market_pack("plants").unwrap();let n=p.keys.len() as i64;db.pack_install(p.id,p.title,p.by,p.keys).unwrap();
        // fill to exactly one set short of the cap, then the next purchase fits and the one after it does not
        let target=MAX_SEALED_PER_PACK-n;
        let have: i64=db.conn.query_row("SELECT COUNT(*) FROM pack_items WHERE pack_id='plants' AND opened_at IS NULL",[],|r|r.get(0)).unwrap();
        for i in have..target { db.conn.execute("INSERT INTO pack_items(pack_id,item_key) VALUES('plants',?1)",[format!("extra-{i}")]).unwrap(); }
        let req=request(Kind::Pack,"plants",1);
        db.scrap_trade(&req,"fits").unwrap();
        assert_eq!(db.packs().unwrap().into_iter().find(|p|p.id=="plants").unwrap().remaining,MAX_SEALED_PER_PACK);
        let before=db.scrap_status().unwrap().balance;
        assert!(db.scrap_trade(&req,"over-the-cap").is_err());
        assert_eq!(db.scrap_status().unwrap().balance,before);
        assert_eq!(db.packs().unwrap().into_iter().find(|p|p.id=="plants").unwrap().remaining,MAX_SEALED_PER_PACK);
    }
    #[test]
    fn several_sets_are_bought_in_one_transaction_and_never_past_the_cap_or_the_balance() {
        let mut db=funded_by(60);
        let p=pack::market_pack("plants").unwrap();let n=p.keys.len() as i64;db.pack_install(p.id,p.title,p.by,p.keys).unwrap();
        let cost=PACKS.iter().find(|(id,_)| *id=="plants").unwrap().1;
        let before=db.scrap_status().unwrap().balance;
        db.scrap_trade(&request(Kind::Pack,"plants",3),"three-sets").unwrap();
        assert_eq!(db.scrap_status().unwrap().balance,before-cost*3);
        let row=db.packs().unwrap().into_iter().find(|p|p.id=="plants").unwrap();assert_eq!((row.total,row.remaining),(n*4,n*4));
        // a retry of the same request adds nothing and spends nothing
        db.scrap_trade(&request(Kind::Pack,"plants",3),"three-sets").unwrap();
        assert_eq!(db.packs().unwrap().into_iter().find(|p|p.id=="plants").unwrap().remaining,n*4);
        // more sets than the bag can hold: refused, nothing spent, nothing added
        let before=db.scrap_status().unwrap().balance;
        let too_many=(MAX_SEALED_PER_PACK/n)+1;
        assert!(db.scrap_trade(&request(Kind::Pack,"plants",too_many),"too-many").is_err());
        assert_eq!(db.scrap_status().unwrap().balance,before);
        assert_eq!(db.packs().unwrap().into_iter().find(|p|p.id=="plants").unwrap().remaining,n*4);
        // more sets than the balance pays for: refused as a whole
        let mut poor=funded();poor.pack_install(p.id,p.title,p.by,p.keys).unwrap();
        let sets=poor.scrap_status().unwrap().balance/cost+1;
        assert!(sets>1&&sets*n<=MAX_SEALED_PER_PACK);
        let before=poor.scrap_status().unwrap().balance;
        assert!(poor.scrap_trade(&request(Kind::Pack,"plants",sets),"cannot-afford").is_err());
        assert_eq!(poor.scrap_status().unwrap().balance,before);
        assert_eq!(poor.packs().unwrap().into_iter().find(|p|p.id=="plants").unwrap().remaining,n);
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

/* The faucets (docs/decisions.md 2026-10-13, Scraps economy). A day's first sticker made from a new picture earns MADE_BONUS; every
   STREAK_EVERY such days in a row earn STREAK_BONUS more. A re-cut of a picture seen before earns nothing, and so does a second new
   picture on the same day. Each grant is written with its receipt in one transaction and is keyed (by sticker, by day, or once), so a
   retry can never pay twice. "Day" is the app's own local day, passed in by the caller (the developer edition can move it forward). */
pub const WELCOME: i64 = 20;
pub const MADE_BONUS: i64 = 2;
pub const STREAK_EVERY: u32 = 7;
pub const STREAK_BONUS: i64 = 5;
const WELCOME_KEY: &str = "scraps.welcome";
const STREAK_KEY: &str = "scraps.streak";   // "YYYY-MM-DD:n": the last rewarded day and how many days in a row it ends

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reward { pub made: i64, pub streak: i64, pub streak_days: u32, pub balance: i64 }

fn day(value: &str) -> Result<chrono::NaiveDate> { chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| invalid("Invalid day.")) }
fn set(tx: &Connection, key: &str, value: &str) -> Result<()> {
    tx.execute("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,value])?; Ok(())
}
fn credit(tx: &Connection, amount: i64) -> Result<i64> {
    let next = balance(tx)?.checked_add(amount).filter(|n| *n<=MAX_SAFE_COUNT).ok_or_else(|| invalid("Scraps balance is out of range."))?;
    set(tx, BALANCE_KEY, &next.to_string())?; Ok(next)
}

/// The welcome gift, once per library (new and existing ones alike). Returns the amount when it was given now.
pub(crate) fn welcome(conn: &mut Connection) -> Result<Option<i64>> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if tx.query_row("SELECT EXISTS(SELECT 1 FROM meta WHERE key=?1)", [WELCOME_KEY], |r| r.get::<_,bool>(0))? { return Ok(None); }
    credit(&tx, WELCOME)?; set(&tx, WELCOME_KEY, &chrono::Utc::now().to_rfc3339())?; tx.commit()?;
    Ok(Some(WELCOME))
}

/// The daily mission for a sticker just made on `today`. Asking again for the same sticker returns the first answer.
pub(crate) fn reward_creation(conn: &mut Connection, sticker_id: &str, new_image: bool, today: &str) -> Result<Reward> {
    let date = day(today)?;
    let receipt = format!("scraps.reward.{sticker_id}");
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if let Some(saved) = tx.query_row("SELECT value FROM meta WHERE key=?1", [&receipt], |r| r.get::<_,String>(0)).optional()? {
        return serde_json::from_str(&saved).map_err(|_| invalid("Reward receipt could not be read."));
    }
    let made_day = format!("scraps.made.{today}");
    let first_today = new_image && !tx.query_row("SELECT EXISTS(SELECT 1 FROM meta WHERE key=?1)", [&made_day], |r| r.get::<_,bool>(0))?;
    let mut reward = Reward { balance: balance(&tx)?, ..Reward::default() };
    if first_today {
        let previous: Option<String> = tx.query_row("SELECT value FROM meta WHERE key=?1", [STREAK_KEY], |r| r.get(0)).optional()?;
        let (last, run) = previous.as_deref().and_then(|v| v.split_once(':')).and_then(|(d, n)| Some((day(d).ok()?, n.parse::<u32>().ok()?))).unzip();
        let days = if last.is_some_and(|l| l.succ_opt()==Some(date)) { run.unwrap_or(0).saturating_add(1) } else { 1 };
        reward.made = MADE_BONUS;
        reward.streak = if days % STREAK_EVERY == 0 { STREAK_BONUS } else { 0 };
        reward.streak_days = days;
        reward.balance = credit(&tx, reward.made + reward.streak)?;
        set(&tx, &made_day, sticker_id)?;
        set(&tx, STREAK_KEY, &format!("{today}:{days}"))?;
    }
    set(&tx, &receipt, &serde_json::to_string(&reward).map_err(|_| invalid("Reward receipt could not be saved."))?)?;
    tx.commit()?;
    Ok(reward)
}

/// Seam called by the creation transaction's caller with the exact input-file novelty. The grant itself is `reward_creation`,
/// made by the app with its own day once the sticker is fully made.
pub fn on_new_sticker(_db: &crate::Database, _sticker_id: &str, _new_image: bool) -> Result<()> {
    #[cfg(test)] NEW_STICKER_CALLS.with(|calls| calls.borrow_mut().push((_sticker_id.to_owned(),_new_image)));
    Ok(())
}
#[cfg(test)] thread_local! {pub(crate) static NEW_STICKER_CALLS:std::cell::RefCell<Vec<(String,bool)>>=const {std::cell::RefCell::new(Vec::new())};}

#[cfg(test)]
mod reward_tests {
    use super::*;
    use crate::Database;
    fn days(from: &str, n: i64) -> String { (chrono::NaiveDate::parse_from_str(from, "%Y-%m-%d").unwrap() + chrono::Duration::days(n)).to_string() }

    #[test]
    fn the_welcome_gift_is_given_once() {
        let mut db = Database::open_in_memory().unwrap();
        db.scrap_reward_creation("earlier", true, "2026-10-01").unwrap();
        assert_eq!(db.scrap_welcome().unwrap(), Some(WELCOME), "the amount given, also for a library that already holds Scraps");
        assert_eq!(db.scrap_welcome().unwrap(), None);
        assert_eq!(db.scrap_status().unwrap().balance, MADE_BONUS + WELCOME);
    }

    #[test]
    fn only_the_first_new_picture_of_a_day_earns_and_a_retry_never_pays_twice() {
        let mut db = Database::open_in_memory().unwrap();
        let first = db.scrap_reward_creation("a", true, "2026-10-13").unwrap();
        assert_eq!((first.made, first.streak, first.streak_days, first.balance), (MADE_BONUS, 0, 1, MADE_BONUS));
        assert_eq!(db.scrap_reward_creation("a", true, "2026-10-13").unwrap(), first, "same sticker: same receipt");
        assert_eq!(db.scrap_reward_creation("a", true, "2026-10-14").unwrap(), first, "a receipt is per sticker, whatever day is asked");
        let second = db.scrap_reward_creation("b", true, "2026-10-13").unwrap();
        assert_eq!((second.made, second.streak, second.balance), (0, 0, MADE_BONUS));
        let recut = db.scrap_reward_creation("c", false, "2026-10-14").unwrap();
        assert_eq!((recut.made, recut.balance), (0, MADE_BONUS), "a picture seen before earns nothing, and does not start the day");
        assert_eq!(db.scrap_reward_creation("d", true, "2026-10-14").unwrap().streak_days, 2);
        assert_eq!(db.scrap_status().unwrap().balance, 2 * MADE_BONUS);
    }

    #[test]
    fn every_seventh_day_in_a_row_adds_the_streak_bonus_and_a_gap_starts_again() {
        let mut db = Database::open_in_memory().unwrap();
        let start = "2026-10-01";
        let mut paid = vec![];
        for n in 0..14 { let r = db.scrap_reward_creation(&format!("s{n}"), true, &days(start, n)).unwrap(); paid.push((r.streak_days, r.streak)); }
        assert_eq!(paid[6], (7, STREAK_BONUS)); assert_eq!(paid[13], (14, STREAK_BONUS));
        assert!(paid.iter().enumerate().all(|(i, (_, s))| *s == if i == 6 || i == 13 { STREAK_BONUS } else { 0 }));
        assert_eq!(db.scrap_status().unwrap().balance, 14 * MADE_BONUS + 2 * STREAK_BONUS);
        let after_gap = db.scrap_reward_creation("late", true, &days(start, 15)).unwrap();
        assert_eq!((after_gap.streak_days, after_gap.streak), (1, 0));
    }

    #[test]
    fn a_bad_day_changes_nothing() {
        let mut db = Database::open_in_memory().unwrap();
        for bad in ["", "yesterday", "2026-13-01", "2026-10-13T00:00:00Z"] { assert!(db.scrap_reward_creation("a", true, bad).is_err()); }
        assert_eq!(db.scrap_status().unwrap().balance, 0);
        assert_eq!(db.scrap_reward_creation("a", true, "2026-10-13").unwrap().made, MADE_BONUS, "a refused ask leaves no receipt behind");
    }
}
