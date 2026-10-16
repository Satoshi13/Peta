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
pub struct PackRate { pub id: &'static str, pub exchange: i64, pub stickers: usize, pub on_sale: bool }
/// What the Market shows about the official shop, from the signed shop setting in effect (none: the built-in shop).
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopView { pub featured: Vec<String>, pub official_first: bool, pub order: Vec<String>, pub blurbs: std::collections::BTreeMap<String, String> }

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
pub fn material_rates()->Vec<MaterialRate> {MATERIALS.to_vec()}
const PACKS: [(&str, i64); 6] = [("tokyo",16),("coffee",12),("plants",10),("pixel",12),("cats",10),("night",12)];
pub fn default_pack_price(id: &str) -> Option<i64> { PACKS.iter().find(|(p,_)| *p==id).map(|(_,price)| *price) }
/// One price for both what the Market shows and what a trade takes: the signed shop setting's, else the built-in one.
pub(crate) fn pack_offer(conn: &Connection, id: &str) -> Option<(i64, bool)> {
    let base = default_pack_price(id)?;
    let shop = crate::signed_config::active_shop(conn, chrono::Utc::now());
    let entry = shop.as_ref().and_then(|c| c.packs.iter().find(|p| p.id==id));
    Some((entry.and_then(|p| p.price).unwrap_or(base), entry.is_none_or(|p| p.on_sale)))
}
fn shop_view(conn: &Connection) -> Option<ShopView> {
    let c = crate::signed_config::active_shop(conn, chrono::Utc::now())?;
    Some(ShopView { featured:c.featured, official_first:c.official_first, order:c.order, blurbs:c.packs.into_iter().filter_map(|p| Some((p.id, p.blurb?))).collect() })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status { pub balance: i64, pub materials: Vec<MaterialRate>, pub packs: Vec<PackRate>, pub tools: Vec<ToolRate>, pub shop: Option<ShopView> }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRate { pub id: &'static str, pub exchange: i64 }
/// The link tag's price is provisional (owner has not fixed it).
const TOOLS: [ToolRate; 2] = [ToolRate { id: "link-tag", exchange: 2 }, ToolRate { id: "board", exchange: 12 }];
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind { Dismantle, Material, Pack, Tool, Pull, Payout }
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
    Ok(Status { balance:balance(conn)?, materials:MATERIALS.to_vec(), packs:PACKS.iter().map(|(id,_)| { let (exchange,on_sale)=pack_offer(conn,id).expect("built-in pack"); PackRate { id, exchange, stickers:pack::market_pack(id).unwrap().keys.len(), on_sale } }).collect(), tools:TOOLS.to_vec(), shop:shop_view(conn) })
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
        // Friend Market money moves only through its verified pull and payout records.
        Kind::Pull | Kind::Payout => return Err(invalid("This exchange is not available here.")),
        Kind::Dismantle => rate.ok_or_else(|| invalid("This material cannot be dismantled."))?.dismantle * request.quantity,
        Kind::Material => -rate.and_then(|m| m.exchange).ok_or_else(|| invalid("This material is not available to exchange."))? * request.quantity,
        Kind::Pack => {
            // Sets are bought together: one price per set, all added to the same bag in one transaction.
            let (price, on_sale) = pack_offer(&tx, &request.item_id).ok_or_else(|| invalid("This pack is not available to exchange."))?;
            if !on_sale { return Err(invalid("This pack is not on sale right now.")); }
            -price * request.quantity
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
            let owned_key = if request.item_id=="board" { crate::boards::OWNED_KEY } else { crate::link_tag::OWNED_KEY };
            let raw: Option<String> = tx.query_row("SELECT value FROM meta WHERE key=?1", [owned_key], |r| r.get(0)).optional()?;
            let owned: i64 = if request.item_id == "board" {
                raw.as_deref().and_then(|v| v.parse().ok()).filter(|v| (2..=crate::boards::MAX_OWNED).contains(v)).ok_or_else(|| invalid("invalid_board_stock"))?
            } else { raw.and_then(|v| v.parse().ok()).unwrap_or(0) };
            let cap=if request.item_id=="board" { crate::boards::MAX_OWNED } else { 1_000_000 };
            let next_owned = owned.checked_add(request.quantity).filter(|v| *v<=cap).ok_or_else(|| invalid(if request.item_id=="board" { "You have all 12 boards." } else { "Link tag count is out of range." }))?;
            tx.execute("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![owned_key,next_owned.to_string()])?;
        }
        Kind::Pull | Kind::Payout => unreachable!(),
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
mod shop_tests {
    use super::*;
    use crate::{db::Database, signed_config::{self, tests::signed}};
    fn at(days: i64) -> String { (chrono::Utc::now() + chrono::Duration::days(days)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true) }
    fn config(id: &str, kind: &str, packs: serde_json::Value, from: i64, to: i64) -> crate::events::Verified {
        signed(id, signed_config::SHOP_CONFIG, serde_json::json!({"configId":id,"configKind":kind,"featured":["pixel","cats"],"officialFirst":true,"order":["night","pixel"],"packs":packs}), &at(from), &at(to))
    }
    fn funded() -> Database {
        let db=Database::open_in_memory().unwrap();
        db.conn.execute("INSERT INTO meta(key,value) VALUES('scraps.balance','500') ON CONFLICT(key) DO UPDATE SET value='500'",[]).unwrap();db
    }
    fn trade(db:&mut Database,id:&str,n:i64,request:&str)->Result<Receipt> { db.scrap_trade(&Trade{kind:Kind::Pack,item_id:id.into(),quantity:n},request) }
    #[test]
    fn the_shown_price_is_the_charged_price_with_and_without_a_shop_setting() {
        let mut db=funded();
        let shown=|db:&Database,id:&str| db.scrap_status().unwrap().packs.into_iter().find(|p| p.id==id).unwrap();
        assert_eq!((shown(&db,"pixel").exchange,shown(&db,"pixel").on_sale),(12,true));
        assert!(db.scrap_status().unwrap().shop.is_none());
        let r=trade(&mut db,"pixel",2,"built-in").unwrap();assert_eq!(r.delta,-2*shown(&db,"pixel").exchange);
        signed_config::replace_shop(&mut db,&[config("shop-a","default",serde_json::json!([{"id":"pixel","onSale":true,"price":20,"blurb":"Glow"},{"id":"cats","onSale":false,"price":null,"blurb":null}]),-1,30)]).unwrap();
        let status=db.scrap_status().unwrap();
        assert_eq!(shown(&db,"pixel").exchange,20);assert!(!shown(&db,"cats").on_sale);assert_eq!(shown(&db,"night").exchange,12);
        let view=status.shop.unwrap();assert_eq!((view.featured,view.official_first,view.order),(vec!["pixel".to_string(),"cats".into()],true,vec!["night".to_string(),"pixel".into()]));
        assert_eq!(view.blurbs.get("pixel").map(String::as_str),Some("Glow"));
        let before=status.balance;
        let r=trade(&mut db,"pixel",3,"configured").unwrap();assert_eq!(r.delta,-3*shown(&db,"pixel").exchange);assert_eq!(r.balance,before-60);
        assert_eq!(trade(&mut db,"cats",1,"off-sale").unwrap_err().to_string(),"This pack is not on sale right now.");
        assert_eq!(db.scrap_status().unwrap().balance,before-60);assert!(!db.shop_on_sale("cats"));assert!(db.shop_on_sale("tokyo"));
        // A retry keeps the receipt it was charged, even if the price changes afterwards.
        signed_config::replace_shop(&mut db,&[]).unwrap();assert_eq!(trade(&mut db,"pixel",3,"configured").unwrap(),r);
        assert_eq!(shown(&db,"pixel").exchange,12);
    }
    #[test]
    fn prices_outside_half_to_double_or_on_free_packs_void_the_whole_setting() {
        let mut db=funded();
        assert_eq!(signed_config::shop_price_range("pixel"),Some((6,24)));assert_eq!(signed_config::shop_price_range("tokyo"),None);
        for packs in [serde_json::json!([{"id":"pixel","onSale":true,"price":25,"blurb":null}]),serde_json::json!([{"id":"pixel","onSale":true,"price":5,"blurb":null}]),
            serde_json::json!([{"id":"tokyo","onSale":true,"price":8,"blurb":null}]),serde_json::json!([{"id":"pixel","onSale":true,"price":null,"blurb":"x".repeat(121)}]),
            serde_json::json!([{"id":"pixel","onSale":true,"price":null,"blurb":null},{"id":"pixel","onSale":false,"price":null,"blurb":null}]),
            serde_json::json!([{"id":"unknown","onSale":true,"price":null,"blurb":null}]),serde_json::json!([{"id":"pixel","onSale":false,"price":null,"blurb":null,"url":"x"}])] {
            signed_config::replace_shop(&mut db,&[config("shop-bad","default",packs,-1,30)]).unwrap();
            let status=db.scrap_status().unwrap();
            assert!(status.shop.is_none());assert!(status.packs.iter().all(|p| p.on_sale && Some(p.exchange)==default_pack_price(p.id)));
        }
        signed_config::replace_shop(&mut db,&[config("shop-edge","default",serde_json::json!([{"id":"pixel","onSale":true,"price":24,"blurb":null},{"id":"plants","onSale":false,"price":null,"blurb":null}]),-1,30)]).unwrap();
        assert_eq!(db.scrap_status().unwrap().packs.iter().find(|p| p.id=="pixel").unwrap().exchange,24);assert!(!db.shop_on_sale("plants"));
    }
    #[test]
    fn a_period_setting_beats_the_standing_one_only_while_it_runs() {
        let mut db=funded();
        let price=|db:&Database| db.scrap_status().unwrap().packs.into_iter().find(|p| p.id=="night").unwrap().exchange;
        let standing=||config("shop-standing","default",serde_json::json!([{"id":"night","onSale":true,"price":10,"blurb":null}]),-10,300);
        let week=config("shop-week","event",serde_json::json!([{"id":"night","onSale":true,"price":8,"blurb":null}]),-20,7);
        let later=config("shop-later","event",serde_json::json!([{"id":"night","onSale":true,"price":6,"blurb":null}]),2,9);
        let over=config("shop-over","event",serde_json::json!([{"id":"night","onSale":true,"price":7,"blurb":null}]),-30,-1);
        signed_config::replace_shop(&mut db,&[standing(),week,later,over]).unwrap();assert_eq!(price(&db),8);
        signed_config::replace_shop(&mut db,&[standing()]).unwrap();assert_eq!(price(&db),10);
    }
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
        // Open before spawning: a failed concurrent migration must not strand a worker at the barrier.
        let connections=(0..2).map(|_|Database::open(&path).unwrap()).collect::<Vec<_>>();
        let workers:Vec<_>=connections.into_iter().map(|mut db| { let barrier=barrier.clone();std::thread::spawn(move || {
            barrier.wait();db.scrap_trade(&request(Kind::Dismantle,"holographic",1),"same-request").unwrap()
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
/// One thing an official bundle (a coupon) gives, free. Caps keep a coupon a gift rather than a reset of the economy.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Grant { pub kind: GrantKind, #[serde(default)] pub id: String, pub count: i64 }
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GrantKind { Scraps, Envelope, Material, Tool, Pack }
pub const MAX_GRANTS: usize = 10;
/// The most one bundle may give of each thing.
pub fn grant_cap(kind: GrantKind, id: &str) -> Option<i64> {
    match kind {
        GrantKind::Scraps if id.is_empty() => Some(1000),
        GrantKind::Envelope if id.is_empty() => Some(3),
        GrantKind::Material if MATERIALS.iter().any(|m| m.id==id && id!="matte") => Some(50),
        GrantKind::Tool if id=="link-tag" => Some(20),
        GrantKind::Tool if id=="board" => Some(crate::boards::MAX_OWNED),
        GrantKind::Pack if PACKS.iter().any(|(p,_)| *p==id) => Some(5),
        _ => None,
    }
}
/// Check a bundle without touching the library: known things, within caps, each named once.
pub fn check_grants(items: &[Grant]) -> Result<()> {
    if items.is_empty() || items.len()>MAX_GRANTS { return Err(invalid("A bundle gives 1 to 10 things.")); }
    let mut seen = std::collections::HashSet::new();
    for g in items {
        let cap = grant_cap(g.kind, &g.id).ok_or_else(|| invalid("This bundle has something Peta doesn't know. Please update."))?;
        if !(1..=cap).contains(&g.count) { return Err(invalid("This bundle gives too many of something.")); }
        if !seen.insert((g.kind, g.id.as_str())) { return Err(invalid("This bundle names something twice.")); }
    }
    Ok(())
}
/// Give a checked bundle inside the caller's transaction and say what arrived. Boards and pack refills stop at what the
/// library can hold instead of failing the whole bundle; the words say what was left out.
pub(crate) fn apply_grants(tx: &Connection, items: &[Grant]) -> Result<String> {
    check_grants(items)?;
    let mut got = Vec::new();
    let mut notes = Vec::new();
    let plural = |n: i64, one: &str, many: &str| if n==1 { format!("1 {one}") } else { format!("{n} {many}") };
    for g in items {
        match g.kind {
            GrantKind::Scraps => {
                let next = balance(tx)?.checked_add(g.count).filter(|v| *v<=MAX_SAFE_COUNT).ok_or_else(|| invalid("Scraps balance is out of range."))?;
                tx.execute("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![BALANCE_KEY,next.to_string()])?;
                got.push(format!("{} Scraps", g.count));
            }
            GrantKind::Envelope => {
                tx.execute("UPDATE meta SET value=CAST(value AS INTEGER)+?1 WHERE key='bonus_envelopes'", [g.count])?;
                got.push(plural(g.count, "extra envelope", "extra envelopes"));
            }
            GrantKind::Material => {
                let held: i64 = tx.query_row("SELECT count FROM material_stock WHERE material_id=?1", [&g.id], |r| r.get(0)).optional()?.unwrap_or(0);
                if held>MAX_SAFE_COUNT-g.count { return Err(invalid("Material stock is out of range.")); }
                tx.execute("INSERT INTO material_stock(material_id,count) VALUES(?1,?2) ON CONFLICT(material_id) DO UPDATE SET count=count+excluded.count", params![g.id,g.count])?;
                tx.execute("INSERT OR IGNORE INTO material_unlocks(material_id,unlocked_at) VALUES(?1,?2)", params![g.id,chrono::Utc::now().to_rfc3339()])?;
                got.push(format!("{} ×{}", crate::materials::get(&g.id).map(|m| m.name).unwrap_or_else(|| g.id.clone()), g.count));
            }
            GrantKind::Tool => {
                let board = g.id=="board";
                let key = if board { crate::boards::OWNED_KEY } else { crate::link_tag::OWNED_KEY };
                let raw: Option<String> = tx.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0)).optional()?;
                let owned: i64 = if board {
                    raw.as_deref().and_then(|v| v.parse().ok()).filter(|v| (2..=crate::boards::MAX_OWNED).contains(v)).ok_or_else(|| invalid("invalid_board_stock"))?
                } else { raw.and_then(|v| v.parse().ok()).unwrap_or(0) };
                let add = if board { g.count.min(crate::boards::MAX_OWNED-owned) } else { g.count.min(1_000_000-owned) };
                if add<g.count { notes.push(if board { format!("you already have all {} boards", crate::boards::MAX_OWNED) } else { "you hold as many link tags as Peta keeps".into() }); }
                if add>0 {
                    tx.execute("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,(owned+add).to_string()])?;
                    got.push(if board { plural(add, "board", "boards") } else { plural(add, "link tag", "link tags") });
                }
            }
            GrantKind::Pack => {
                let p = pack::market_pack(&g.id).ok_or_else(|| invalid("This pack is not available."))?;
                let own: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM packs WHERE id=?1)", [&g.id], |r| r.get(0))?;
                if !own { tx.execute("INSERT INTO packs(id,title,by_name,created_at) VALUES(?1,?2,?3,?4)", params![p.id,p.title,p.by,chrono::Utc::now().to_rfc3339()])?; }
                let left: i64 = tx.query_row("SELECT COUNT(*) FROM pack_items WHERE pack_id=?1 AND opened_at IS NULL", [&g.id], |r| r.get(0))?;
                let room = (MAX_SEALED_PER_PACK-left).max(0) / p.keys.len() as i64;
                let sets = g.count.min(room);
                if sets<g.count { notes.push(format!("{} already holds as many sealed stickers as it can", p.title)); }
                for _ in 0..sets { for item in p.keys.iter() { tx.execute("INSERT INTO pack_items(pack_id,item_key) VALUES(?1,?2)", params![g.id,item])?; } }
                if sets>0 { got.push(if sets==1 { format!("a {} pack", p.title) } else { format!("{} {} packs", sets, p.title) }); }
            }
        }
    }
    let mut text = if got.is_empty() { "Nothing new arrived".to_string() } else { format!("{} arrived", got.join(", ")) };
    if !notes.is_empty() { text.push_str(&format!(" ({})", notes.join("; "))); }
    text.push('.');
    Ok(text)
}

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

/// A Friend Market movement inside the caller's transaction, with its receipt under `scraps.tx.{request_id}`: a pull's payment or
/// refund (`Pull`), or a seller's proceeds (`Payout`, never negative). Debits fail without
/// changing anything when the balance is short; the caller keeps the record that explains the movement in the same transaction.
pub(crate) fn market_move(tx: &Connection, kind: Kind, item_id: &str, request_id: &str, delta: i64) -> Result<Receipt> {
    if !matches!(kind, Kind::Pull | Kind::Payout) || (kind==Kind::Payout && delta<0) { return Err(invalid("Invalid Market exchange.")); }
    let key = format!("scraps.tx.{request_id}");
    if tx.query_row("SELECT EXISTS(SELECT 1 FROM meta WHERE key=?1)", [&key], |r| r.get::<_,bool>(0))? { return Err(invalid("This exchange request was already used.")); }
    let next = balance(tx)?.checked_add(delta).ok_or_else(|| invalid("Scraps balance is out of range."))?;
    if next<0 { return Err(invalid("Not enough Scraps.")); }
    if next>MAX_SAFE_COUNT { return Err(invalid("Scraps balance is out of range.")); }
    let receipt = Receipt { request_id:request_id.into(), trade:Trade { kind, item_id:item_id.into(), quantity:1 }, delta, balance:next };
    set(tx, BALANCE_KEY, &next.to_string())?;
    set(tx, &key, &serde_json::to_string(&receipt).map_err(|_| invalid("Exchange receipt could not be saved."))?)?;
    Ok(receipt)
}
pub(crate) fn balance_in(conn: &Connection) -> Result<i64> { balance(conn) }

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
