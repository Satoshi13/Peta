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
    /// Plain paper never runs out.
    #[serde(default)]
    pub unlimited: bool,
}

impl Material {
    /// Can a sticker be made with it right now?
    pub fn available(&self) -> bool {
        self.unlimited || self.count >= 1
    }
}

/// Always unlocked from the first launch, so there is something to make a sticker with on day one.
pub const DEFAULT_MATERIAL: &str = "matte";
/// The very first Today's Material is always this one (the Alpha story, spec §88).
pub const FIRST_DRAW_MATERIAL: &str = "holographic";

/// Plain paper is the one material that never runs out, so there is always something to make a sticker with.
/// Every other material is used up when a sticker is made with it.
pub fn is_unlimited(id: &str) -> bool {
    id == DEFAULT_MATERIAL
}

fn border(width: f64, style: &str) -> Option<Border> {
    Some(Border { enabled: true, width, style: style.into() })
}

/// The MVP materials (spec §18). More come with later phases / creators.
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
    let all = catalog();
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
    fn catalog_has_the_three_mvp_materials() {
        let ids: Vec<_> = catalog().into_iter().map(|m| m.id).collect();
        assert_eq!(ids, ["matte", "kraft", "holographic"]);
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
