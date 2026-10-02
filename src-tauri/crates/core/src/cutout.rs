//! Mask toolbox for the Sticker Creator: edge-snapping, clean-up, distance fields, die-cut silhouette.
//! Everything works on `f32` planes (0..1) so it is easy to test on tiny synthetic images.

/// Box blur with a (2r+1) window, clamped at the borders (the window shrinks, the average stays honest).
pub fn box_blur(src: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    if r == 0 {
        return src.to_vec();
    }
    let mut tmp = vec![0f32; w * h];
    let mut prefix = vec![0f64; w.max(h) + 1];
    for y in 0..h {
        let row = &src[y * w..(y + 1) * w];
        for x in 0..w {
            prefix[x + 1] = prefix[x] + row[x] as f64;
        }
        for x in 0..w {
            let lo = x.saturating_sub(r);
            let hi = (x + r + 1).min(w);
            tmp[y * w + x] = ((prefix[hi] - prefix[lo]) / (hi - lo) as f64) as f32;
        }
    }
    let mut out = vec![0f32; w * h];
    for x in 0..w {
        for y in 0..h {
            prefix[y + 1] = prefix[y] + tmp[y * w + x] as f64;
        }
        for y in 0..h {
            let lo = y.saturating_sub(r);
            let hi = (y + r + 1).min(h);
            out[y * w + x] = ((prefix[hi] - prefix[lo]) / (hi - lo) as f64) as f32;
        }
    }
    out
}

/// Gaussian-ish blur: three box blurs (error < 3% of a true Gaussian), O(N) at any sigma.
pub fn blur(src: &[f32], w: usize, h: usize, sigma: f32) -> Vec<f32> {
    if sigma < 0.3 {
        return src.to_vec();
    }
    // three passes of radius r approximate sigma^2 = 3 * (r^2 + r) / 3 = r^2 + r
    let r = (((4.0 * sigma * sigma + 1.0).sqrt() - 1.0) / 2.0).round().max(1.0) as usize;
    let a = box_blur(src, w, h, r);
    let b = box_blur(&a, w, h, r);
    box_blur(&b, w, h, r)
}

/// Guided filter (He et al.): snaps `src` (a soft mask) to the edges of `guide` (the photo's luminance).
pub fn guided_filter(guide: &[f32], src: &[f32], w: usize, h: usize, r: usize, eps: f32) -> Vec<f32> {
    let mean_i = box_blur(guide, w, h, r);
    let mean_p = box_blur(src, w, h, r);
    let ii: Vec<f32> = guide.iter().map(|v| v * v).collect();
    let ip: Vec<f32> = guide.iter().zip(src).map(|(i, p)| i * p).collect();
    let corr_i = box_blur(&ii, w, h, r);
    let corr_ip = box_blur(&ip, w, h, r);

    let n = w * h;
    let mut a = vec![0f32; n];
    let mut b = vec![0f32; n];
    for k in 0..n {
        let var = corr_i[k] - mean_i[k] * mean_i[k];
        let cov = corr_ip[k] - mean_i[k] * mean_p[k];
        a[k] = cov / (var + eps);
        b[k] = mean_p[k] - a[k] * mean_i[k];
    }
    let mean_a = box_blur(&a, w, h, r);
    let mean_b = box_blur(&b, w, h, r);
    (0..n).map(|k| (mean_a[k] * guide[k] + mean_b[k]).clamp(0.0, 1.0)).collect()
}

const INF: f32 = 1e20;

/// Squared 1-D distance transform (Felzenszwalb & Huttenlocher) of `f` in place.
fn edt_1d(f: &[f32], d: &mut [f32], v: &mut [usize], z: &mut [f32]) {
    let n = f.len();
    let mut k = 0usize;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for q in 1..n {
        let mut s;
        loop {
            let p = v[k];
            s = ((f[q] + (q * q) as f32) - (f[p] + (p * p) as f32)) / (2.0 * q as f32 - 2.0 * p as f32);
            if s <= z[k] && k > 0 {
                k -= 1;
            } else {
                break;
            }
        }
        if s <= z[k] {
            // k == 0 and the new parabola dominates everywhere
            v[0] = q;
            z[0] = -INF;
            z[1] = INF;
            continue;
        }
        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = INF;
    }
    k = 0;
    for q in 0..n {
        while z[k + 1] < q as f32 {
            k += 1;
        }
        let p = v[k];
        let dq = q as f32 - p as f32;
        d[q] = dq * dq + f[p];
    }
}

/// Euclidean distance from every pixel to the nearest pixel where `set` is true (0 on the set itself).
pub fn distance_to(set: &[bool], w: usize, h: usize) -> Vec<f32> {
    let mut grid: Vec<f32> = set.iter().map(|s| if *s { 0.0 } else { INF }).collect();
    let m = w.max(h);
    let (mut f, mut d, mut v, mut z) = (vec![0f32; m], vec![0f32; m], vec![0usize; m], vec![0f32; m + 1]);
    for x in 0..w {
        for y in 0..h {
            f[y] = grid[y * w + x];
        }
        edt_1d(&f[..h], &mut d[..h], &mut v[..h], &mut z[..h + 1]);
        for y in 0..h {
            grid[y * w + x] = d[y];
        }
    }
    for y in 0..h {
        f[..w].copy_from_slice(&grid[y * w..(y + 1) * w]);
        edt_1d(&f[..w], &mut d[..w], &mut v[..w], &mut z[..w + 1]);
        grid[y * w..(y + 1) * w].copy_from_slice(&d[..w]);
    }
    grid.iter().map(|g| if *g >= INF / 2.0 { f32::MAX } else { g.sqrt() }).collect()
}

/// 4-connected components of `mask`; returns (label per pixel, 0 = background; area per label starting at index 1).
pub fn components(mask: &[bool], w: usize, h: usize) -> (Vec<u32>, Vec<usize>) {
    let mut labels = vec![0u32; w * h];
    let mut areas = vec![0usize];
    let mut stack = Vec::new();
    for start in 0..w * h {
        if !mask[start] || labels[start] != 0 {
            continue;
        }
        let id = areas.len() as u32;
        let mut area = 0usize;
        labels[start] = id;
        stack.push(start);
        while let Some(i) = stack.pop() {
            area += 1;
            let (x, y) = (i % w, i / w);
            let mut visit = |j: usize| {
                if mask[j] && labels[j] == 0 {
                    labels[j] = id;
                    stack.push(j);
                }
            };
            if x > 0 {
                visit(i - 1);
            }
            if x + 1 < w {
                visit(i + 1);
            }
            if y > 0 {
                visit(i - w);
            }
            if y + 1 < h {
                visit(i + w);
            }
        }
        areas.push(area);
    }
    (labels, areas)
}

/// Background pixels (`!mask`) that cannot reach the image border = holes. Returns the hole mask.
pub fn holes(mask: &[bool], w: usize, h: usize) -> Vec<bool> {
    let inverse: Vec<bool> = mask.iter().map(|m| !m).collect();
    let (labels, _) = components(&inverse, w, h);
    let mut touches_border = vec![false; labels.iter().copied().max().unwrap_or(0) as usize + 1];
    for x in 0..w {
        touches_border[labels[x] as usize] = true;
        touches_border[labels[(h - 1) * w + x] as usize] = true;
    }
    for y in 0..h {
        touches_border[labels[y * w] as usize] = true;
        touches_border[labels[y * w + w - 1] as usize] = true;
    }
    (0..w * h).map(|i| inverse[i] && !touches_border[labels[i] as usize]).collect()
}

/// What the user painted over the cutout: erase = background, restore = subject.
#[derive(Clone, Debug, PartialEq)]
pub struct Edits {
    pub w: usize,
    pub h: usize,
    /// 0 = untouched, 1 = erase, 2 = restore
    pub data: Vec<u8>,
}

pub const EDIT_ERASE: u8 = 1;
pub const EDIT_RESTORE: u8 = 2;

impl Edits {
    pub fn new(w: usize, h: usize) -> Self {
        Edits { w, h, data: vec![0; w * h] }
    }

    pub fn is_empty(&self) -> bool {
        self.data.iter().all(|v| *v == 0)
    }

    /// The same edits for an image `k` times smaller (an edit survives if any pixel of its block had one;
    /// restore beats erase inside a block).
    pub fn downscaled(&self, k: usize) -> Edits {
        let (w, h) = ((self.w / k).max(1), (self.h / k).max(1));
        let mut out = Edits::new(w, h);
        for y in 0..h {
            for x in 0..w {
                let mut v = 0u8;
                for dy in 0..k {
                    for dx in 0..k {
                        let (sx, sy) = ((x * k + dx).min(self.w - 1), (y * k + dy).min(self.h - 1));
                        let e = self.data[sy * self.w + sx];
                        if e == EDIT_RESTORE || (e == EDIT_ERASE && v == 0) {
                            v = e;
                        }
                    }
                }
                out.data[y * w + x] = v;
            }
        }
        out
    }

    /// Paint a round brush (coordinates and radius in pixels). Later strokes win.
    pub fn paint(&mut self, cx: f32, cy: f32, radius: f32, value: u8) {
        let x0 = ((cx - radius).floor().max(0.0)) as usize;
        let x1 = (((cx + radius).ceil()) as usize).min(self.w.saturating_sub(1));
        let y0 = ((cy - radius).floor().max(0.0)) as usize;
        let y1 = (((cy + radius).ceil()) as usize).min(self.h.saturating_sub(1));
        for y in y0..=y1 {
            for x in x0..=x1 {
                let (dx, dy) = (x as f32 - cx, y as f32 - cy);
                if dx * dx + dy * dy <= radius * radius {
                    self.data[y * self.w + x] = value;
                }
            }
        }
    }

    /// Paint a stroke as a chain of dabs so fast pointer movement leaves no gaps.
    pub fn stroke(&mut self, points: &[(f32, f32)], radius: f32, value: u8) {
        let step = (radius * 0.4).max(1.0);
        let mut prev: Option<(f32, f32)> = None;
        for &(x, y) in points {
            match prev {
                None => self.paint(x, y, radius, value),
                Some((px, py)) => {
                    let len = ((x - px).powi(2) + (y - py).powi(2)).sqrt();
                    let n = (len / step).ceil().max(1.0) as usize;
                    for i in 1..=n {
                        let t = i as f32 / n as f32;
                        self.paint(px + (x - px) * t, py + (y - py) * t, radius, value);
                    }
                }
            }
            prev = Some((x, y));
        }
    }
}

/// Turn the (edge-snapped) model output into the subject mask.
///
/// * `strength` 0..1 is the "cutout adjust" slider: higher keeps more (looser), lower is tighter.
/// * Specks are dropped, small holes filled, the outline smoothed; user edits are applied last and win.
pub fn refine_mask(matte: &[f32], w: usize, h: usize, strength: f32, edits: Option<&Edits>) -> Vec<f32> {
    let strength = strength.clamp(0.0, 1.0);
    let threshold = 0.62 - 0.30 * strength;
    let soft = 0.10;
    let mut alpha: Vec<f32> =
        matte.iter().map(|p| ((p - threshold) / (2.0 * soft) + 0.5).clamp(0.0, 1.0)).collect();

    let edit_at = |i: usize| edits.map(|e| e.data[i]).unwrap_or(0);
    for i in 0..w * h {
        match edit_at(i) {
            EDIT_ERASE => alpha[i] = 0.0,
            EDIT_RESTORE => alpha[i] = 1.0,
            _ => {}
        }
    }

    let bin: Vec<bool> = alpha.iter().map(|a| *a > 0.5).collect();
    let (labels, areas) = components(&bin, w, h);
    let largest = areas.iter().skip(1).copied().max().unwrap_or(0);
    if largest > 0 {
        // keep every sizeable piece (a hand and an arm may be separate pieces), drop dust
        let keep_min = (largest as f32 * 0.04).max(24.0) as usize;
        let mut protected = vec![false; areas.len()];
        for i in 0..w * h {
            if edit_at(i) == EDIT_RESTORE && labels[i] != 0 {
                protected[labels[i] as usize] = true;
            }
        }
        for i in 0..w * h {
            let l = labels[i] as usize;
            if l != 0 && areas[l] < keep_min && !protected[l] {
                alpha[i] = 0.0;
            }
        }
    }

    // fill small enclosed holes (a gap between an arm and a body is a real hole; a speck is not)
    let kept: Vec<bool> = alpha.iter().map(|a| *a > 0.5).collect();
    let hole = holes(&kept, w, h);
    let (hole_labels, hole_areas) = components(&hole, w, h);
    let subject_area = kept.iter().filter(|k| **k).count().max(1);
    for i in 0..w * h {
        if hole[i] && (hole_areas[hole_labels[i] as usize] as f32) < subject_area as f32 * 0.02 && edit_at(i) != EDIT_ERASE {
            alpha[i] = 1.0;
        }
    }

    // smooth the outline: blur, then re-contrast around 0.5 so edges stay crisp but lose their jaggies
    let sigma = (w.max(h) as f32 / 700.0).max(0.8);
    let soft_edge = blur(&alpha, w, h, sigma);
    let mut out: Vec<f32> = soft_edge.iter().map(|b| ((b - 0.5) * 2.2 + 0.5).clamp(0.0, 1.0)).collect();
    for i in 0..w * h {
        match edit_at(i) {
            EDIT_ERASE => out[i] = 0.0,
            EDIT_RESTORE => out[i] = 1.0,
            _ => {}
        }
    }
    out
}

/// The die-cut shape around a subject.
pub struct Silhouette {
    /// Antialiased coverage 0..1 of subject + border.
    pub alpha: Vec<f32>,
    /// Distance (px) from each pixel inside the silhouette to the nearest outside pixel.
    pub inside_dist: Vec<f32>,
    /// Distance (px) from each pixel to the subject itself (0 on the subject).
    pub subject_dist: Vec<f32>,
}

/// Round, smooth, hole-free outline `border` px out from the subject. Narrow gaps (between ears, legs)
/// are bridged like scissors would, by growing the shape and shrinking it back.
pub fn silhouette(subject: &[f32], w: usize, h: usize, border: f32) -> Silhouette {
    let subject_set: Vec<bool> = subject.iter().map(|a| *a > 0.5).collect();
    let subject_dist = distance_to(&subject_set, w, h);

    let bridge = border * 0.9;
    let grown: Vec<bool> = subject_dist.iter().map(|d| *d <= border + bridge).collect();
    let outside_dist = distance_to(&grown.iter().map(|g| !g).collect::<Vec<_>>(), w, h);
    let mut shape: Vec<bool> = outside_dist.iter().map(|d| *d > bridge).collect();
    for (s, sub) in shape.iter_mut().zip(&subject_set) {
        *s = *s || *sub;
    }
    let shape_holes = holes(&shape, w, h);
    for (s, hole) in shape.iter_mut().zip(shape_holes) {
        *s = *s || hole;
    }

    // smooth, antialiased outline
    let as_f: Vec<f32> = shape.iter().map(|s| if *s { 1.0 } else { 0.0 }).collect();
    let sigma = (border * 0.12).clamp(1.2, 4.0);
    let soft = blur(&as_f, w, h, sigma);
    let alpha: Vec<f32> = soft.iter().map(|b| ((b - 0.5) * 1.8 + 0.5).clamp(0.0, 1.0)).collect();
    let inside_set: Vec<bool> = alpha.iter().map(|a| *a > 0.5).collect();
    let inside_dist = distance_to(&inside_set.iter().map(|i| !i).collect::<Vec<_>>(), w, h);
    Silhouette { alpha, inside_dist, subject_dist }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disk(w: usize, h: usize, cx: f32, cy: f32, r: f32) -> Vec<bool> {
        (0..w * h)
            .map(|i| {
                let (x, y) = ((i % w) as f32, (i / w) as f32);
                (x - cx).powi(2) + (y - cy).powi(2) <= r * r
            })
            .collect()
    }

    #[test]
    fn box_blur_keeps_constants_and_total_mass_in_the_middle() {
        let flat = vec![0.7f32; 20 * 10];
        assert!(box_blur(&flat, 20, 10, 3).iter().all(|v| (v - 0.7).abs() < 1e-5));
        let mut dot = vec![0f32; 21 * 21];
        dot[10 * 21 + 10] = 1.0;
        let b = box_blur(&dot, 21, 21, 2);
        assert!((b.iter().sum::<f32>() - 1.0).abs() < 1e-4);
        assert!((b[10 * 21 + 10] - 1.0 / 25.0).abs() < 1e-5);
    }

    #[test]
    fn distance_transform_matches_brute_force() {
        let (w, h) = (23, 17);
        let set: Vec<bool> = (0..w * h).map(|i| (i * 7919) % 31 == 0).collect();
        let d = distance_to(&set, w, h);
        for i in 0..w * h {
            let (x, y) = ((i % w) as f32, (i / w) as f32);
            let brute = (0..w * h)
                .filter(|j| set[*j])
                .map(|j| (((j % w) as f32 - x).powi(2) + ((j / w) as f32 - y).powi(2)).sqrt())
                .fold(f32::MAX, f32::min);
            assert!((d[i] - brute).abs() < 1e-3, "pixel {i}: {} vs {}", d[i], brute);
        }
    }

    #[test]
    fn components_and_holes() {
        // a ring (with a hole) and a separate dot
        let (w, h) = (20, 20);
        let mut m = vec![false; w * h];
        for (i, v) in disk(w, h, 8.0, 8.0, 6.0).into_iter().enumerate() {
            m[i] = v;
        }
        for (i, v) in disk(w, h, 8.0, 8.0, 2.0).into_iter().enumerate() {
            if v {
                m[i] = false;
            }
        }
        m[18 * w + 18] = true;
        let (_, areas) = components(&m, w, h);
        assert_eq!(areas.len() - 1, 2);
        let hole = holes(&m, w, h);
        assert!(hole[8 * w + 8]);
        assert!(!hole[0]); // background connected to the border is not a hole
        assert_eq!(hole.iter().filter(|h| **h).count(), disk(w, h, 8.0, 8.0, 2.0).iter().filter(|d| **d).count());
    }

    #[test]
    fn guided_filter_pulls_a_misplaced_mask_edge_back_to_the_photo_edge() {
        let (w, h) = (64, 64);
        // photo: bright left half, dark right half, edge at x = 32
        let guide: Vec<f32> = (0..w * h).map(|i| if i % w < 32 { 0.9 } else { 0.1 }).collect();
        // the network's mask puts the edge 3 px too far right (x = 35), lightly blurred
        let mask: Vec<f32> = (0..w * h).map(|i| (1.0 - ((i % w) as f32 - 33.0) / 4.0).clamp(0.0, 1.0)).collect();
        let out = guided_filter(&guide, &mask, w, h, 6, 1e-3);
        let (m, o) = (|x: usize| mask[32 * w + x], |x: usize| out[32 * w + x]);
        assert!(m(33) > 0.99 && m(29) > 0.99);
        assert!(o(29) > 0.95, "bright side stays subject: {}", o(29));
        assert!(o(33) < 0.65, "dark side next to the edge is pulled out: {}", o(33));
        assert!(o(33) < m(33) - 0.35);
    }

    #[test]
    fn refine_drops_specks_fills_small_holes_and_keeps_big_pieces() {
        let (w, h) = (80, 80);
        let mut matte = vec![0f32; w * h];
        for (i, v) in disk(w, h, 40.0, 40.0, 25.0).into_iter().enumerate() {
            matte[i] = if v { 1.0 } else { 0.0 };
        }
        for (i, v) in disk(w, h, 40.0, 40.0, 2.0).into_iter().enumerate() {
            if v {
                matte[i] = 0.0; // small hole
            }
        }
        matte[3 * w + 3] = 1.0; // dust
        let m = refine_mask(&matte, w, h, 0.5, None);
        assert!(m[40 * w + 40] > 0.9, "hole filled");
        assert!(m[3 * w + 3] < 0.1, "dust removed");
        assert!(m[40 * w + 30] > 0.9);
    }

    #[test]
    fn cutout_adjust_is_monotonic() {
        let (w, h) = (50, 50);
        // a soft blob: probability falls from 1 at the center to 0 at radius 20
        let matte: Vec<f32> = (0..w * h)
            .map(|i| {
                let d = (((i % w) as f32 - 25.0).powi(2) + ((i / w) as f32 - 25.0).powi(2)).sqrt();
                (1.0 - d / 20.0).clamp(0.0, 1.0)
            })
            .collect();
        let area = |s: f32| refine_mask(&matte, w, h, s, None).iter().filter(|a| **a > 0.5).count();
        assert!(area(0.0) < area(0.5) && area(0.5) < area(1.0), "{} {} {}", area(0.0), area(0.5), area(1.0));
    }

    #[test]
    fn user_edits_win() {
        let (w, h) = (40, 40);
        let matte: Vec<f32> = disk(w, h, 20.0, 20.0, 10.0).into_iter().map(|b| if b { 1.0 } else { 0.0 }).collect();
        let mut e = Edits::new(w, h);
        e.stroke(&[(10.0, 20.0), (16.0, 20.0)], 3.0, EDIT_ERASE); // eat into the left of the disk
        e.paint(35.0, 5.0, 3.0, EDIT_RESTORE); // add something far away
        let m = refine_mask(&matte, w, h, 0.5, Some(&e));
        assert!(m[20 * w + 14] < 0.05, "erased");
        assert!(m[5 * w + 35] > 0.95, "restored");
        assert!(m[20 * w + 24] > 0.9, "rest untouched");
    }

    #[test]
    fn silhouette_is_round_hole_free_and_about_border_px_wide() {
        let (w, h) = (120, 120);
        let subject: Vec<f32> = disk(w, h, 60.0, 60.0, 25.0).into_iter().map(|b| if b { 1.0 } else { 0.0 }).collect();
        let s = silhouette(&subject, w, h, 10.0);
        for (a, sub) in s.alpha.iter().zip(&subject) {
            if *sub > 0.5 {
                assert!(*a > 0.99, "subject must be inside the shape");
            }
        }
        // along a radius the outline sits at ~ 25 + 10
        let row = 60 * w;
        let edge = (60..w).find(|x| s.alpha[row + x] < 0.5).unwrap();
        assert!((edge as f32 - (60.0 + 35.0)).abs() <= 2.0, "edge at {edge}");
        assert!(s.inside_dist[row + 60] > 30.0);
        assert!(s.subject_dist[row + 60] == 0.0 && s.subject_dist[row + 90] > 4.0);
    }

    #[test]
    fn silhouette_bridges_a_narrow_gap_like_scissors() {
        // two blobs 6px apart (a gap between two ears) -> the die-cut shape does not follow the gap
        let (w, h) = (100, 60);
        let mut subject = vec![0f32; w * h];
        for y in 10..50 {
            for x in 10..45 {
                subject[y * w + x] = 1.0;
            }
            for x in 51..86 {
                subject[y * w + x] = 1.0;
            }
        }
        let s = silhouette(&subject, w, h, 8.0);
        assert!(s.alpha[30 * w + 48] > 0.9, "gap bridged");
    }
}
