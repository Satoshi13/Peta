//! `cargo run -p peta-core --example segment -- <in.jpg> <out.png>`
//! Measures Apple Vision and writes a transparent cutout.
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let (mut img, _) = peta_core::image_import::decode_oriented(&bytes).unwrap();
    for run in 0..3 {
        let t = std::time::Instant::now();
        let mask = peta_core::segment::foreground_mask(&img).unwrap();
        eprintln!("Vision run {}: {:?}, {}x{}", run + 1, t.elapsed(), mask.width(), mask.height());
        if run == 2 { for (x,y,p) in img.enumerate_pixels_mut() { p.0[3] = mask.get_pixel(x,y).0[0]; } }
    }
    img.save(&a[2]).unwrap();
}
