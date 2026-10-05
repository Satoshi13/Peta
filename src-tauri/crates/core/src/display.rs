//! Resolve permanent display identities and conservative migration from name-based IDs.
use std::collections::HashMap;

#[derive(Debug, PartialEq)]
pub struct Assignment {
    pub ids: Vec<String>,
    pub aliases: Vec<(String, String)>,
    pub ambiguous_names: Vec<String>,
}

/// Preserve legacy IDs on platforms without a native adapter. A stable ID must be unique
/// in a snapshot; duplicates cannot safely identify two physical screens.
pub fn assign(names: &[String], native_ids: Option<&[String]>) -> crate::Result<Assignment> {
    let mut counts = HashMap::new();
    for name in names { *counts.entry(name).or_insert(0) += 1; }
    let ambiguous_names = counts.iter().filter(|(_, count)| **count > 1).map(|(name, _)| (*name).clone()).collect();
    if let Some(ids) = native_ids {
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        if ids.len() != names.len() || unique.len() != ids.len() || ids.iter().any(|id| id.is_empty()) {
            return Err(crate::Error::Invalid("displays do not have unique permanent identities".into()));
        }
        let aliases = names.iter().zip(ids).filter(|(name, _)| counts[name] == 1)
            .map(|(name, id)| (name.clone(), id.clone())).collect();
        return Ok(Assignment { ids: ids.to_vec(), aliases, ambiguous_names });
    }
    let mut seen = HashMap::new();
    let ids = names.iter().map(|name| {
        let n = seen.entry(name).or_insert(0);
        *n += 1;
        if *n == 1 { name.clone() } else { format!("{name}#{n}") }
    }).collect();
    Ok(Assignment { ids, aliases: vec![], ambiguous_names })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn strings(items: &[&str]) -> Vec<String> { items.iter().map(|s| s.to_string()).collect() }

    #[test]
    fn identical_monitors_keep_their_ids_when_order_and_names_change() {
        let first = assign(&strings(&["Monitor", "Monitor"]), Some(&strings(&["macos:A", "macos:B"]))).unwrap();
        let swapped = assign(&strings(&["Renamed", "Renamed"]), Some(&strings(&["macos:B", "macos:A"]))).unwrap();
        assert_eq!(first.ids[0], swapped.ids[1]);
        assert_eq!(first.ids[1], swapped.ids[0]);
        assert!(first.aliases.is_empty() && swapped.aliases.is_empty());
    }

    #[test]
    fn only_unambiguous_legacy_names_can_be_migrated() {
        let assignment = assign(&strings(&["Built-in", "External", "External"]), Some(&strings(&["macos:A", "macos:B", "macos:C"]))).unwrap();
        assert_eq!(assignment.aliases, vec![("Built-in".into(), "macos:A".into())]);
        assert!(assign(&strings(&["External", "External"]), Some(&strings(&["same", "same"]))).is_err());
        assert!(assign(&strings(&["External"]), Some(&[])).is_err());
    }

    #[test]
    fn unsupported_platforms_keep_legacy_ids() {
        assert_eq!(assign(&strings(&["Monitor", "Monitor"]), None).unwrap().ids, strings(&["Monitor", "Monitor#2"]));
    }
}

/// Tao reports a monitor's physical origin using that monitor's own scale factor.
/// Match a native snapshot exactly; never break ties by enumeration order.
pub fn match_native_origin(native: &[(u32, f64, f64)], physical: (i32, i32), scale: f64) -> crate::Result<u32> {
    let matches: Vec<_> = native.iter().filter(|(_, x, y)| {
        (*x * scale).round() as i32 == physical.0 && (*y * scale).round() as i32 == physical.1
    }).collect();
    if matches.len() != 1 {
        return Err(crate::Error::Invalid("could not uniquely match a monitor to its permanent identity".into()));
    }
    Ok(matches[0].0)
}

/// Temporary fallback rendering must not overwrite the stored home of a disconnected screen.
pub fn edited_home(saved: Option<&str>, edited_on: &str, present: &[String]) -> String {
    saved.filter(|id| !present.iter().any(|current| current == id)).unwrap_or(edited_on).to_owned()
}

#[cfg(test)]
mod geometry_tests {
    use super::*;
    #[test]
    fn native_matching_handles_negative_origins_and_mixed_retina_scales() {
        let native = [(10, 0.0, 0.0), (20, -1920.0, 0.0), (30, 0.0, -900.0)];
        assert_eq!(match_native_origin(&native, (-1920, 0), 1.0).unwrap(), 20);
        assert_eq!(match_native_origin(&native, (0, -1800), 2.0).unwrap(), 30);
        assert_eq!(match_native_origin(&native, (0, 0), 2.0).unwrap(), 10);
        assert!(match_native_origin(&native, (999, 0), 1.0).is_err());
        assert!(match_native_origin(&[(10, 0.0, 0.0), (20, 0.0, 0.0)], (0, 0), 1.0).is_err());
    }

    #[test]
    fn editing_a_fallback_does_not_forget_the_disconnected_home() {
        let present = vec!["macos:main".into()];
        assert_eq!(edited_home(Some("macos:external"), "macos:main", &present), "macos:external");
        assert_eq!(edited_home(Some("macos:main"), "macos:main", &present), "macos:main");
        assert_eq!(edited_home(None, "macos:main", &present), "macos:main");
    }
}
