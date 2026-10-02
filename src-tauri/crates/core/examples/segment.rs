//! `cargo run --release -p peta-core --example segment -- <model.onnx> <spec> <in.jpg> <out.png>`
//! Cuts the subject out of a photo with the given model (spec: u2netp | silueta | isnet).
use peta_core::segment::{Segmenter, ISNET, SILUETA, U2NETP};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let spec = match a[2].as_str() { "silueta" => SILUETA, "isnet" => ISNET, _ => U2NETP };
    let seg = Segmenter::from_onnx_bytes(&std::fs::read(&a[1]).unwrap(), spec).unwrap();
    let mut img = image::open(&a[3]).unwrap().to_rgba8();
    let t = std::time::Instant::now();
    let alpha = seg.matte(&img).unwrap();
    eprintln!("{} {:?} matte in {:?}", a[3], spec.name, t.elapsed());
    for (x, y, p) in img.enumerate_pixels_mut() { p.0[3] = alpha.get_pixel(x, y).0[0]; }
    img.save(&a[4]).unwrap();
}
