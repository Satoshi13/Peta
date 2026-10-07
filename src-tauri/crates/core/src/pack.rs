//! Packs (spec §38-41), local only for now: a set of stickers you open one at a time, at random.
//! The Welcome Pack by Peta ships with the app (the twelve starter stickers); packs from other creators come
//! with the later phases (Market). Opening one item is how a Peta can arrive as today's Peta.

use crate::{
    creator::{self, Params, Rendered, Session},
    db::Database,
    error::Result,
    materials,
};

pub const WELCOME_PACK_ID: &str = "welcome";
pub const WELCOME_PACK_TITLE: &str = "Welcome Pack";
pub const PACK_AUTHOR: &str = "Peta";
pub const FREE_OPENING_EVERY: i64 = 10;

pub struct MarketPack {
    pub id: &'static str,
    pub title: &'static str,
    pub by: &'static str,
    pub keys: &'static [&'static str],
    pub free: bool,
}

/// Local catalog packs; purchases and empty-bag refills use the same shipped pictures.
pub fn market_pack(id: &str) -> Option<MarketPack> {
    let (id, title, by, keys): (_, _, _, &[&str]) = match id {
        "tokyo" => ("tokyo", "Tokyo Pack", "Peta", &["film-camera","coffee-cup","polaroid-mountain","cassette-tape","retro-computer","peta-bubble","good-day","fried-egg"]),
        "coffee" => ("coffee", "Coffee Club", "Nao", &["coffee-cup","fried-egg","good-day","film-camera","potted-plant","cat-skateboard"]),
        "plants" => ("plants", "Houseplants", "Mika", &["potted-plant","blue-flower","fried-egg","polaroid-mountain","coffee-cup"]),
        "pixel" => ("pixel", "Pixel Dream", "Ryo", &["retro-computer","cassette-tape","peta-bubble","purple-scribble","film-camera","good-day"]),
        "cats" => ("cats", "Cats", "Yuki", &["cat-skateboard","purple-scribble","coffee-cup","potted-plant","peta-bubble"]),
        "night" => ("night", "Night Market", "Ren", &["fried-egg","cassette-tape","good-day","polaroid-mountain","film-camera","peta-bubble"]),
        _ => return None,
    };
    Some(MarketPack { id, title, by, keys, free: matches!(id,"tokyo"|"coffee"|"plants") })
}

/// The Welcome Pack's items: file names (without extension) of the sample stickers shipped under `art/samples/`.
pub const WELCOME_ITEMS: [&str; 12] = [
    "cat-skateboard", "fried-egg", "good-day", "blue-flower", "polaroid-mountain", "retro-computer",
    "coffee-cup", "peta-bubble", "purple-scribble", "film-camera", "potted-plant", "cassette-tape",
];

/// Where a pack item's picture is shipped (relative to the app's frontend assets).
pub fn welcome_item_path(key: &str) -> String {
    format!("art/samples/{key}.png")
}

/// Register the Welcome Pack on first launch. Returns true if it was just added.
pub fn ensure_welcome_pack(db: &mut Database) -> Result<bool> {
    db.pack_install(WELCOME_PACK_ID, WELCOME_PACK_TITLE, PACK_AUTHOR, &WELCOME_ITEMS)
}

/// Turn a pack picture (a transparent PNG) into a finished sticker: plain paper with a white border, no model needed.
pub fn render_pack_sticker(bytes: &[u8]) -> Result<Rendered> {
    let session = Session::new(bytes, None)?;
    let recipe = materials::get(materials::DEFAULT_MATERIAL).expect("default material exists").recipe;
    session.render(&Params { strength: creator::DEFAULT_STRENGTH, smooth: creator::DEFAULT_SMOOTH, recipe })
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{ImageFormat, Rgba, RgbaImage};

    use super::*;
    use crate::{back, library::Library, models::SourceType};

    fn tiny_cutout() -> Vec<u8> {
        // a transparent canvas with an opaque disc: already cut out, so no model is needed
        let mut img = RgbaImage::new(160, 120);
        for y in 0..120i32 {
            for x in 0..160i32 {
                if (x - 80).pow(2) + (y - 60).pow(2) < 40 * 40 {
                    img.put_pixel(x as u32, y as u32, Rgba([220, 80, 60, 255]));
                }
            }
        }
        let mut out = Vec::new();
        img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png).unwrap();
        out
    }

    #[test]
    fn the_welcome_pack_is_installed_once_with_all_items_unopened() {
        let mut db = Database::open_in_memory().unwrap();
        assert!(ensure_welcome_pack(&mut db).unwrap());
        assert!(!ensure_welcome_pack(&mut db).unwrap(), "second launch adds nothing");
        let packs = db.packs().unwrap();
        assert_eq!(packs.len(), 1);
        assert_eq!((packs[0].total, packs[0].remaining), (12, 12));
        assert_eq!(packs[0].title, "Welcome Pack");
    }

    #[test]
    fn picking_is_by_roll_never_repeats_and_runs_out() {
        let mut db = Database::open_in_memory().unwrap();
        ensure_welcome_pack(&mut db).unwrap();
        let (first_id, first_key) = db.pack_pick("welcome", 0.0).unwrap().unwrap();
        assert_eq!(first_key, "cat-skateboard");
        let (_, last_key) = db.pack_pick("welcome", 0.999).unwrap().unwrap();
        assert_eq!(last_key, "cassette-tape");
        db.pack_mark_opened(first_id, "S1").unwrap();
        assert!(db.pack_mark_opened(first_id, "S2").is_err(), "an item is opened once");
        assert_ne!(db.pack_pick("welcome", 0.0).unwrap().unwrap().1, "cat-skateboard");
        assert_eq!(db.packs().unwrap()[0].remaining, 11);
        for _ in 0..11 {
            let (id, _) = db.pack_pick("welcome", 0.5).unwrap().unwrap();
            db.pack_mark_opened(id, "S").unwrap();
        }
        assert!(db.pack_pick("welcome", 0.5).unwrap().is_none());
        assert_eq!(db.packs().unwrap()[0].remaining, 0);
    }

    #[test]
    fn a_pack_sticker_is_rendered_stored_and_says_where_it_came_from() {
        let rendered = render_pack_sticker(&tiny_cutout()).unwrap();
        assert!(rendered.width > 80 && rendered.height > 80 && rendered.coverage > 0.1);

        let dir = std::env::temp_dir().join(format!("peta-pack-test-{}", crate::ids::new_sticker_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut lib = Library::open(&dir).unwrap();
        let sticker = lib.add_from_pack(&rendered, &tiny_cutout(), "png", "Welcome Pack", "Peta", "matte").unwrap();
        assert_eq!(sticker.source_type, SourceType::Pack);
        assert_eq!(sticker.original_number, None, "only your own creations get an ORIGINAL number");
        assert_eq!(sticker.creator_name.as_deref(), Some("Peta"));

        let back = back::sticker_back(lib.db(), &sticker.id, "Me", &|ts| Some(ts.chars().take(10).collect())).unwrap().unwrap();
        assert_eq!(back.kind, back::BackKind::Received);
        assert_eq!(back.received_from.as_deref(), Some("Welcome Pack"));
        assert_eq!(back.created_by, "Peta");
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// Signed item metadata lives outside the shipped catalog. Paths are generated locally after verification.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct StoredItem {pub png_path:String,pub mask_path:Option<String>,pub material_id:String,pub aspect:f64,pub name:String,pub rarity:String,pub finished:bool}
pub fn stored_item(db:&Database,id:i64)->Result<Option<StoredItem>> {
    use rusqlite::OptionalExtension;
    Ok(db.conn.query_row("SELECT png_path,mask_path,material_id,aspect,name,rarity,finished FROM signed_pack_items WHERE item_id=?1",[id],|r|Ok(StoredItem{png_path:r.get(0)?,mask_path:r.get(1)?,material_id:r.get(2)?,aspect:r.get(3)?,name:r.get(4)?,rarity:r.get(5)?,finished:r.get(6)?})).optional()?)
}

pub fn item_name(db:&Database,sticker_id:&str)->Result<Option<String>> {
    use rusqlite::OptionalExtension;
    Ok(db.conn.query_row("SELECT s.name FROM signed_pack_items s JOIN pack_items i ON i.id=s.item_id WHERE i.sticker_id=?1 LIMIT 1",[sticker_id],|r|r.get(0)).optional()?)
}
