//! `cargo run --release -p peta-core --example make_sticker -- <photo> <material> <out.png> [strength]`
//! Runs the whole Creator pipeline on a photo and writes the finished sticker.
use peta_core::{creator::{self, Params, Session}, materials};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let model = concat!(env!("CARGO_MANIFEST_DIR"), "/../../models/u2netp.onnx");
    let seg = creator::load_segmenter(&[], &std::fs::read(model).unwrap()).unwrap();
    let t = std::time::Instant::now();
    let session = Session::new(&bytes, Some(&seg)).unwrap();
    let analyze = t.elapsed();
    let params = Params {
        strength: a.get(4).and_then(|s| s.parse().ok()).unwrap_or(creator::DEFAULT_STRENGTH),
        recipe: materials::get(&a[2]).unwrap().recipe,
    };
    let t = std::time::Instant::now();
    let r = session.render(&params).unwrap();
    eprintln!("{} {:>11}: analyze {:?}, render {:?} -> {}x{} coverage {:.0}%", a[1], a[2], analyze, t.elapsed(), r.width, r.height, r.coverage * 100.0);
    std::fs::write(&a[3], &r.sticker_png).unwrap();
}
