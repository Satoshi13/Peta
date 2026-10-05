//! Material catalog (spec §16-21, §60-61). A Material is a manufacturing *recipe*, not an image filter.
//! This crate only describes recipes; rendering them is the Sticker Creator's job (Phase 3).

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Rarity {
    Common,
    Uncommon,
    Rare,
    Special,
    Archive,
}

impl Rarity {
    /// Relative chance in the daily draw. Special / Archive are never drawn (creator / seasonal / limited).
    /// Rarity is about how hard it is to get — never about power (spec §20).
    pub fn draw_weight(self) -> f64 {
        match self {
            Rarity::Common => 50.0,
            Rarity::Uncommon => 32.0,
            Rarity::Rare => 18.0,
            Rarity::Special | Rarity::Archive => 0.0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Border {
    pub enabled: bool,
    /// Fraction of the sticker's longer side.
    pub width: f64,
    pub style: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reflection {
    pub enabled: bool,
    #[serde(rename = "type")]
    pub kind: String,
    pub strength: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shadow {
    pub enabled: bool,
    pub strength: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MaterialRecipe {
    pub substrate: String,
    pub border: Option<Border>,
    pub texture: Option<String>,
    pub color_treatment: Option<String>,
    pub transparency: Option<f64>,
    pub reflection: Option<Reflection>,
    pub noise: Option<f64>,
    pub aging: Option<f64>,
    pub shadow: Option<Shadow>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Material {
    pub id: String,
    pub name: String,
    pub rarity: Rarity,
    pub recipe: MaterialRecipe,
    pub creator_id: Option<String>,
    pub unlocked_at: Option<String>,
    /// How many you hold (filled in from stock; 0 in the bare catalog). Materials are used up.
    #[serde(default)]
    pub count: i64,
    /// True only for an edition with unlimited manufacturing.
    #[serde(default)]
    pub unlimited: bool,
}

impl Material {
    /// Can a sticker be made with it right now?
    pub fn available(&self) -> bool {
        self.unlimited || self.count >= 1
    }
}

/// Plain paper is known from the first launch; making one still requires a sheet.
pub const DEFAULT_MATERIAL: &str = "matte";
/// The very first Today's Material is always this one (the Alpha story, spec §88).
pub const FIRST_DRAW_MATERIAL: &str = "holographic";

/// All manufacturing materials consume stock in the distribution edition.
pub fn is_unlimited(_id: &str) -> bool { false }

fn border(width: f64, style: &str) -> Option<Border> {
    Some(Border { enabled: true, width, style: style.into() })
}

/// Manufacturing recipes. Daily supply remains separate from the full catalog.
pub fn catalog() -> Vec<Material> {
    let base = |id: &str, name: &str, rarity: Rarity, recipe: MaterialRecipe| Material {
        id: id.into(),
        name: name.into(),
        rarity,
        recipe,
        creator_id: None,
        unlocked_at: None,
        count: 0,
        unlimited: is_unlimited(id),
    };
    let finish = |substrate: &str, style: &str, texture: &str, treatment: Option<&str>, transparency: Option<f64>, reflective: bool, aging: Option<f64>| MaterialRecipe {
        substrate: substrate.into(), border: border(0.03, style), texture: Some(texture.into()),
        color_treatment: treatment.map(str::to_owned), transparency,
        reflection: reflective.then(|| Reflection { enabled: true, kind: "gold".into(), strength: 0.65 }),
        noise: Some(0.15), aging, shadow: Some(Shadow { enabled: true, strength: 0.3 }),
    };
    vec![
        base(
            "matte",
            "Matte",
            Rarity::Common,
            MaterialRecipe {
                substrate: "paper".into(),
                border: border(0.03, "white"),
                texture: Some("soft_paper".into()),
                color_treatment: None,
                transparency: None,
                reflection: None,
                noise: Some(0.15),
                aging: None,
                shadow: Some(Shadow { enabled: true, strength: 0.3 }),
            },
        ),
        base(
            "kraft",
            "Kraft",
            Rarity::Uncommon,
            MaterialRecipe {
                substrate: "kraft_paper".into(),
                border: border(0.025, "kraft"),
                texture: Some("kraft_fiber".into()),
                color_treatment: Some("desaturate".into()),
                transparency: None,
                reflection: None,
                noise: Some(0.4),
                aging: Some(0.2),
                shadow: Some(Shadow { enabled: true, strength: 0.3 }),
            },
        ),
        base(
            "holographic",
            "Holographic",
            Rarity::Rare,
            MaterialRecipe {
                substrate: "holographic_film".into(),
                border: border(0.035, "translucent_white"),
                texture: Some("fine_glitter".into()),
                color_treatment: None,
                transparency: None,
                reflection: Some(Reflection { enabled: true, kind: "rainbow".into(), strength: 0.8 }),
                noise: Some(0.05),
                aging: None,
                shadow: Some(Shadow { enabled: true, strength: 0.4 }),
            },
        ),
        base("gold", "Gold Foil", Rarity::Special, finish("gold_foil", "gold", "gold_leaf", None, None, true, None)),
        base("riso", "Riso", Rarity::Uncommon, finish("riso_paper", "cream", "riso_grain", Some("two_colour"), None, false, None)),
        base("vintage", "Vintage", Rarity::Archive, finish("vintage_paper", "aged", "speckle", Some("faded"), None, false, Some(0.45))),
        base("clear", "Clear", Rarity::Rare, finish("clear_film", "frosted", "fine_frost", None, Some(0.28), false, None)),
        base("pixel", "Pixel", Rarity::Uncommon, finish("pixel_paper", "cream", "pastel_dither", Some("pixel_print"), None, false, None)),
        base("washi", "Washi", Rarity::Uncommon, finish("washi_paper", "deckled", "plant_fibre", Some("soft_ink"), None, false, None)),
        base("sakura", "Sakura", Rarity::Archive, finish("sakura_paper", "pink", "pressed_petals", Some("soft_ink"), None, false, None)),
    ]
}

pub fn get(id: &str) -> Option<Material> {
    catalog().into_iter().find(|m| m.id == id)
}

/// Pick the day's material. `roll` is uniform in 0..1 (injected so this is testable).
/// The weight of a rarity is shared evenly by the materials of that rarity.
pub fn draw(roll: f64, first_ever: bool) -> String {
    if first_ever {
        return FIRST_DRAW_MATERIAL.into();
    }
    let all: Vec<_> = catalog().into_iter().filter(|m| ["matte", "kraft", "holographic"].contains(&m.id.as_str())).collect();
    let weight_of = |m: &Material| {
        let same = all.iter().filter(|o| o.rarity == m.rarity).count() as f64;
        m.rarity.draw_weight() / same
    };
    let total: f64 = all.iter().map(weight_of).sum();
    let mut acc = 0.0;
    let target = roll.clamp(0.0, 0.999_999_999) * total;
    for m in &all {
        acc += weight_of(m);
        if target < acc {
            return m.id.clone();
        }
    }
    DEFAULT_MATERIAL.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_ten_distinct_manufacturing_recipes() {
        let ids: Vec<_> = catalog().into_iter().map(|m| m.id).collect();
        assert_eq!(ids, ["matte", "kraft", "holographic", "gold", "riso", "vintage", "clear", "pixel", "washi", "sakura"]);
        let substrates: std::collections::HashSet<_> = catalog().into_iter().map(|m| m.recipe.substrate).collect();
        assert_eq!(substrates.len(), ids.len());
        assert!(get("gold").unwrap().recipe.reflection.unwrap().enabled);
        assert_eq!(get("sakura").unwrap().rarity.draw_weight(), 0.0);
        assert!(get("holographic").unwrap().recipe.reflection.unwrap().enabled);
        assert!(get("nope").is_none());
    }

    #[test]
    fn first_draw_is_always_holographic() {
        for roll in [0.0, 0.5, 0.99] {
            assert_eq!(draw(roll, true), "holographic");
        }
    }

    #[test]
    fn draw_follows_rarity_weights() {
        // Prototype weights: matte 50, kraft 32, holographic 18.
        assert_eq!(draw(0.0, false), "matte");
        assert_eq!(draw(0.49, false), "matte");
        assert_eq!(draw(0.51, false), "kraft");
        assert_eq!(draw(0.81, false), "kraft");
        assert_eq!(draw(0.83, false), "holographic");
        assert_eq!(draw(1.0, false), "holographic"); // clamped
    }

    #[test]
    fn draw_distribution_roughly_matches() {
        let mut counts = std::collections::HashMap::new();
        for i in 0..1000 {
            *counts.entry(draw(i as f64 / 1000.0, false)).or_insert(0) += 1;
        }
        assert_eq!(counts["matte"], 500);
        assert_eq!(counts["kraft"], 320);
        assert_eq!(counts["holographic"], 180);
    }
}
