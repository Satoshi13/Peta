//! Sticker ids like `PETA-A6F4-8Q21` (spec §33): Crockford-style base32, no I / L / O / U.

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).expect("OS random source unavailable");
    buf
}

pub fn new_sticker_id() -> String {
    let bytes = random_bytes::<8>();
    let chars: Vec<char> = bytes.iter().map(|b| ALPHABET[(*b & 31) as usize] as char).collect();
    format!(
        "PETA-{}-{}",
        chars[..4].iter().collect::<String>(),
        chars[4..].iter().collect::<String>()
    )
}

/// A gift's id, `GIFT-` + 12 characters: the same gift file can only be received once.
pub fn new_gift_id() -> String {
    let bytes = random_bytes::<12>();
    let chars: String = bytes.iter().map(|b| ALPHABET[(*b & 31) as usize] as char).collect();
    format!("GIFT-{chars}")
}

/// Uniform in 0..1.
pub fn random_unit() -> f64 {
    let b = random_bytes::<4>();
    u32::from_le_bytes(b) as f64 / (u32::MAX as f64 + 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_format() {
        let id = new_sticker_id();
        assert_eq!(id.len(), 14);
        assert!(id.starts_with("PETA-"));
        assert_eq!(id.as_bytes()[9], b'-');
        assert!(id[5..].chars().all(|c| c == '-' || ALPHABET.contains(&(c as u8))));
        assert_ne!(new_sticker_id(), new_sticker_id());
    }

    #[test]
    fn unit_range() {
        for _ in 0..100 {
            let v = random_unit();
            assert!((0.0..1.0).contains(&v));
        }
    }
}
