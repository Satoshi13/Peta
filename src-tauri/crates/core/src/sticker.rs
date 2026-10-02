//! Material rendering (spec §16-19, §23): turns a cutout + die-cut silhouette into a finished sticker.
//!
//! A material is a *recipe* (`MaterialRecipe`): what the sticker is printed on, what its border is made
//! of, how rough the print is. Everything here is procedural and deterministic (fixed seeds), so the
//! preview in the Cutting Mat is exactly what gets stuck on the desktop.
//!
//! Static look only. The living part of Holographic (reflection that follows light) is drawn by the
//! desktop layer on top of this image.

use image::{Rgba, RgbaImage};

use crate::{
    cutout::{blur, Silhouette},
    materials::MaterialRecipe,
};

type Rgb = [f32; 3];

const SEED: u32 = 0x7E7A;

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
fn mix(a: Rgb, b: Rgb, t: f32) -> Rgb {
    [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}
fn luma(c: Rgb) -> f32 {
    0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
}
fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn hsv(h: f32, s: f32, v: f32) -> Rgb {
    let h = h.rem_euclid(1.0) * 6.0;
    let (i, f) = (h.floor() as i32, h - h.floor());
    let (p, q, t) = (v * (1.0 - s), v * (1.0 - s * f), v * (1.0 - s * (1.0 - f)));
    match i % 6 {
        0 => [v, t, p],
        1 => [q, v, p],
        2 => [p, v, t],
        3 => [p, q, v],
        4 => [t, p, v],
        _ => [v, p, q],
    }
}

fn hash(x: i32, y: i32, seed: u32) -> f32 {
    let mut h = (x as u32).wrapping_mul(374_761_393) ^ (y as u32).wrapping_mul(668_265_263) ^ seed.wrapping_mul(2_246_822_519);
    h = (h ^ (h >> 13)).wrapping_mul(1_274_126_177);
    h ^= h >> 16;
    h as f32 / u32::MAX as f32
}

fn value_noise(x: f32, y: f32, seed: u32) -> f32 {
    let (xi, yi) = (x.floor(), y.floor());
    let (fx, fy) = (x - xi, y - yi);
    let (sx, sy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    let (xi, yi) = (xi as i32, yi as i32);
    let top = lerp(hash(xi, yi, seed), hash(xi + 1, yi, seed), sx);
    let bottom = lerp(hash(xi, yi + 1, seed), hash(xi + 1, yi + 1, seed), sx);
    lerp(top, bottom, sy)
}

/// Fractal noise in roughly -0.5..0.5.
fn fbm(x: f32, y: f32, seed: u32, octaves: u32) -> f32 {
    let (mut sum, mut amp, mut freq, mut norm) = (0.0, 1.0, 1.0, 0.0);
    for o in 0..octaves {
        sum += (value_noise(x * freq, y * freq, seed.wrapping_add(o * 977)) - 0.5) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    sum / norm
}

/// Pull colour away from the old background at the subject's rim (the classic green/white halo):
/// where the cutout is only partly opaque, borrow the colour of the nearby fully-opaque interior.
fn decontaminate(rgb: &RgbaImage, subject: &[f32], w: usize, h: usize) -> Vec<Rgb> {
    let mut planes = [vec![0f32; w * h], vec![0f32; w * h], vec![0f32; w * h]];
    let weight: Vec<f32> = subject.iter().map(|m| if *m > 0.98 { 1.0 } else { 0.0 }).collect();
    for (i, p) in rgb.pixels().enumerate() {
        for c in 0..3 {
            planes[c][i] = p.0[c] as f32 / 255.0 * weight[i];
        }
    }
    let norm = blur(&weight, w, h, 3.0);
    let inner: Vec<Vec<f32>> = planes.iter().map(|pl| blur(pl, w, h, 3.0)).collect();
    rgb.pixels()
        .enumerate()
        .map(|(i, p)| {
            let c = [p.0[0] as f32 / 255.0, p.0[1] as f32 / 255.0, p.0[2] as f32 / 255.0];
            if subject[i] > 0.98 || norm[i] < 1e-3 {
                return c;
            }
            let est = [inner[0][i] / norm[i], inner[1][i] / norm[i], inner[2][i] / norm[i]];
            mix(est, c, subject[i].clamp(0.0, 1.0).powi(2))
        })
        .collect()
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Substrate {
    Paper,
    Kraft,
    Holographic,
}

fn substrate_of(recipe: &MaterialRecipe) -> Substrate {
    match recipe.substrate.as_str() {
        "kraft_paper" => Substrate::Kraft,
        "holographic_film" => Substrate::Holographic,
        _ => Substrate::Paper,
    }
}

/// Fraction of the longer side of the subject that the die-cut border extends (from the recipe).
pub fn border_fraction(recipe: &MaterialRecipe) -> f32 {
    recipe.border.as_ref().filter(|b| b.enabled).map(|b| b.width as f32).unwrap_or(0.03)
}

/// Paint a finished sticker. All planes are `w * h`; `rgb` is the (opaque) photo, `subject` the cutout alpha.
pub fn render_sticker(rgb: &RgbaImage, subject: &[f32], sil: &Silhouette, recipe: &MaterialRecipe) -> RgbaImage {
    let (w, h) = (rgb.width() as usize, rgb.height() as usize);
    let colors = decontaminate(rgb, subject, w, h);
    let kind = substrate_of(recipe);
    let noise = recipe.noise.unwrap_or(0.15) as f32;
    let sheen = recipe.reflection.as_ref().filter(|r| r.enabled).map(|r| r.strength as f32).unwrap_or(0.0);
    let border_px = (w.max(h) as f32 * 0.03).max(1.0); // only used to scale textures

    let mut out = RgbaImage::new(w as u32, h as u32);
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let cover = sil.alpha[i];
            if cover <= 0.002 {
                out.put_pixel(x as u32, y as u32, Rgba([0, 0, 0, 0]));
                continue;
            }
            let (fx, fy) = (x as f32, y as f32);
            let m = smoothstep(0.30, 0.95, subject[i]); // trim the faint rim so no old background shows
            let photo = colors[i];

            let (border, subject_col, rim) = match kind {
                Substrate::Paper => paper(fx, fy, photo, noise),
                Substrate::Kraft => kraft(fx, fy, photo, noise),
                Substrate::Holographic => holographic(fx, fy, photo, noise, sheen, sil.subject_dist[i], border_px),
            };
            let mut col = mix(border, subject_col, m);
            // die-cut edge: the outermost couple of pixels catch a little shade
            let edge = 1.0 - (sil.inside_dist[i] / 2.5).clamp(0.0, 1.0);
            col = [col[0] * (1.0 - edge * rim), col[1] * (1.0 - edge * rim), col[2] * (1.0 - edge * rim)];

            let px = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
            out.put_pixel(x as u32, y as u32, Rgba([px(col[0]), px(col[1]), px(col[2]), px(cover)]));
        }
    }
    out
}

/// Matte: uncoated paper, white border, soft print with lifted blacks. Returns (border, subject, rim shade).
fn paper(x: f32, y: f32, photo: Rgb, noise: f32) -> (Rgb, Rgb, f32) {
    let grain = (fbm(x * 0.7, y * 0.7, SEED, 2) + (hash(x as i32, y as i32, SEED) - 0.5) * 0.6) * noise * 0.5;
    let paper = [0.965, 0.955, 0.925];
    let border = [paper[0] * (1.0 + grain * 0.5), paper[1] * (1.0 + grain * 0.5), paper[2] * (1.0 + grain * 0.5)];

    let gray = luma(photo);
    let desat = mix([gray; 3], photo, 0.90);
    let printed = [0.035 + desat[0] * 0.925, 0.035 + desat[1] * 0.925, 0.04 + desat[2] * 0.92]; // matte: blacks never reach black
    let subject = [printed[0] * (1.0 + grain), printed[1] * (1.0 + grain), printed[2] * (1.0 + grain)];
    (border, subject, 0.07)
}

/// Kraft: brown fibrous paper; desaturated, warm, rougher print.
fn kraft(x: f32, y: f32, photo: Rgb, noise: f32) -> (Rgb, Rgb, f32) {
    // long fibres (stretched noise on a slightly tilted axis) + cloudy blotches + pepper
    let (u, v) = (x * 0.9 + y * 0.12, y * 0.9 - x * 0.12);
    let fibres = fbm(u * 0.035, v * 0.9, SEED + 11, 3);
    let clouds = fbm(x * 0.012, y * 0.012, SEED + 23, 3);
    let pepper = (hash(x as i32, y as i32, SEED + 5) - 0.5) * 0.10;
    let paper_tone = 1.0 + fibres * 0.34 + clouds * 0.18 + pepper;
    let kraft = [0.77, 0.62, 0.45];
    let border = [kraft[0] * paper_tone, kraft[1] * paper_tone, kraft[2] * paper_tone];

    let gray = luma(photo);
    let muted = mix([gray; 3], photo, 0.55);
    let warm = mix(muted, [muted[0] * 1.0, muted[1] * 0.92, muted[2] * 0.78], 0.6);
    let rough = 1.0 + (hash(x as i32, y as i32, SEED + 31) - 0.5) * (0.10 + noise * 0.4);
    let ink = 0.55 + 0.45 * (paper_tone - 0.25).clamp(0.0, 1.2); // ink sits in the fibres
    let subject = [
        (0.08 + warm[0] * 0.84) * rough * ink.min(1.05),
        (0.07 + warm[1] * 0.84) * rough * ink.min(1.05),
        (0.06 + warm[2] * 0.84) * rough * ink.min(1.05),
    ];
    (border, subject, 0.12)
}

/// Holographic: white inner ring, pastel rainbow film outside, glitter; the print gets a faint rainbow sheen.
fn holographic(x: f32, y: f32, photo: Rgb, noise: f32, sheen: f32, dist_to_subject: f32, border_px: f32) -> (Rgb, Rgb, f32) {
    let phase = (x * 0.55 + y * 0.35) / (border_px * 5.5) + fbm(x * 0.008, y * 0.008, SEED + 41, 3) * 0.9;
    let film = mix(hsv(phase, 0.55, 1.0), [1.0, 1.0, 1.0], 0.22);
    let sparkle = {
        let s = hash(x as i32, y as i32, SEED + 77);
        if s > 0.986 { (s - 0.986) / 0.014 * 0.55 } else { 0.0 }
    };
    let grain = (hash(x as i32, y as i32, SEED + 3) - 0.5) * noise;

    // inner white ring ~ 38% of the border, outer rainbow film
    let ring_edge = border_px * 0.38;
    let t = smoothstep(ring_edge - 1.5, ring_edge + 1.5, dist_to_subject);
    let white = [0.975, 0.975, 0.985];
    let base = mix(white, film, t);
    let border = [base[0] + sparkle * t + grain * 0.4, base[1] + sparkle * t + grain * 0.4, base[2] + sparkle * t + grain * 0.4];

    // the print sits under a film: a touch more vivid, with a screened rainbow sheen
    let gray = luma(photo);
    let vivid = mix([gray; 3], photo, 1.06);
    let rainbow = hsv(phase * 1.3 + 0.1, 0.7, 1.0);
    let k = 0.10 * sheen;
    let subject = [
        1.0 - (1.0 - vivid[0]) * (1.0 - rainbow[0] * k) + sparkle * 0.08,
        1.0 - (1.0 - vivid[1]) * (1.0 - rainbow[1] * k) + sparkle * 0.08,
        1.0 - (1.0 - vivid[2]) * (1.0 - rainbow[2] * k) + sparkle * 0.08,
    ];
    (border, subject, 0.04)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{cutout::silhouette, materials};

    fn scene(w: usize, h: usize) -> (RgbaImage, Vec<f32>) {
        // a red disk "subject" on a green background
        let mut img = RgbaImage::new(w as u32, h as u32);
        let mut subject = vec![0f32; w * h];
        for y in 0..h {
            for x in 0..w {
                let inside = ((x as f32 - w as f32 / 2.0).powi(2) + (y as f32 - h as f32 / 2.0).powi(2)).sqrt() < w as f32 * 0.22;
                img.put_pixel(x as u32, y as u32, if inside { Rgba([200, 40, 40, 255]) } else { Rgba([40, 160, 60, 255]) });
                subject[y * w + x] = if inside { 1.0 } else { 0.0 };
            }
        }
        (img, subject)
    }

    fn render(id: &str) -> (RgbaImage, Vec<f32>) {
        render_at(id, 200)
    }

    fn render_at(id: &str, size: usize) -> (RgbaImage, Vec<f32>) {
        let (img, subject) = scene(size, size);
        let recipe = materials::get(id).unwrap().recipe;
        let sil = silhouette(&subject, size, size, border_fraction(&recipe) * size as f32);
        (render_sticker(&img, &subject, &sil, &recipe), sil.alpha)
    }

    fn avg(img: &RgbaImage, pts: &[(u32, u32)]) -> [f32; 3] {
        let mut s = [0f32; 3];
        for (x, y) in pts {
            let p = img.get_pixel(*x, *y).0;
            for c in 0..3 {
                s[c] += p[c] as f32 / pts.len() as f32;
            }
        }
        s
    }

    #[test]
    fn alpha_is_the_die_cut_silhouette_and_background_never_leaks() {
        for id in ["matte", "kraft", "holographic"] {
            let (img, sil) = render(id);
            assert_eq!(img.get_pixel(2, 2).0[3], 0, "{id}: far background is transparent");
            for (i, p) in img.pixels().enumerate() {
                assert!((p.0[3] as f32 / 255.0 - sil[i]).abs() < 0.01, "{id}: alpha is the silhouette");
            }
            // the green photo background must not show anywhere (it is replaced by the border material)
            for p in img.pixels().filter(|p| p.0[3] > 200) {
                assert!(!(p.0[1] > 130 && p.0[0] < 90 && p.0[2] < 110), "{id}: green background leaked");
            }
        }
    }

    #[test]
    fn matte_border_is_off_white_paper() {
        let (img, _) = render("matte");
        // border pixels just outside the disk (radius 44, border ~6px): radius 47 from the center (100,100)
        let b = avg(&img, &[(147, 100), (100, 147), (53, 100), (100, 53)]);
        assert!(b.iter().all(|c| *c > 215.0) && (b[0] - b[2]).abs() < 30.0, "{b:?}");
        let s = avg(&img, &[(100, 100), (95, 100), (105, 100)]);
        assert!(s[0] > s[1] + 60.0, "subject keeps its red: {s:?}");
    }

    #[test]
    fn kraft_border_is_brown_and_darker_than_matte() {
        let (kraft, _) = render("kraft");
        let (matte, _) = render("matte");
        let pts = [(147, 100), (100, 147), (53, 100), (100, 53)];
        let (k, m) = (avg(&kraft, &pts), avg(&matte, &pts));
        assert!(k[0] > k[1] && k[1] > k[2], "brown ordering R>G>B: {k:?}");
        assert!(luma([k[0], k[1], k[2]]) < luma([m[0], m[1], m[2]]) - 40.0);
    }

    #[test]
    fn holographic_border_has_a_white_ring_and_many_hues() {
        // realistic size: 600px -> disk radius 132, border 21px, white ring ~7px
        let (img, sil) = render_at("holographic", 600);
        let ring = avg(&img, &[(300 + 136, 300), (300 - 136, 300), (300, 300 + 136), (300, 300 - 136)]);
        assert!(ring.iter().all(|c| *c > 225.0), "white inner ring: {ring:?}");
        let mut hues = std::collections::HashSet::new();
        for (i, p) in img.pixels().enumerate() {
            if sil[i] > 0.99 && p.0[3] == 255 {
                let (r, g, b) = (p.0[0] as f32, p.0[1] as f32, p.0[2] as f32);
                let (mx, mn) = (r.max(g).max(b), r.min(g).min(b));
                if mx - mn > 30.0 && mx > 200.0 {
                    let hue = if mx == r { ((g - b) / (mx - mn)).rem_euclid(6.0) } else if mx == g { (b - r) / (mx - mn) + 2.0 } else { (r - g) / (mx - mn) + 4.0 };
                    hues.insert((hue as u32) % 6);
                }
            }
        }
        assert!(hues.len() >= 4, "rainbow film shows several hues, got {hues:?}");
    }

    #[test]
    fn rendering_is_deterministic() {
        let (a, _) = render("holographic");
        let (b, _) = render("holographic");
        assert_eq!(a.as_raw(), b.as_raw());
        assert_ne!(render("kraft").0.as_raw(), render("matte").0.as_raw());
    }

    #[test]
    fn border_comes_from_the_recipe() {
        assert!((border_fraction(&materials::get("matte").unwrap().recipe) - 0.03).abs() < 1e-6);
        assert!((border_fraction(&materials::get("holographic").unwrap().recipe) - 0.035).abs() < 1e-6);
    }
}
