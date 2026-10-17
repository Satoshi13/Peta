//! PNG pictures for sharing: a finished sticker, or its saved cut-out without paper or shadow.
use crate::{Error, Library, Result, SourceType};
use image::{imageops::FilterType, RgbaImage};

fn invalid(s: &str) -> Error { Error::Invalid(s.into()) }

fn source(lib: &Library, id: &str) -> Result<crate::Sticker> {
    let s = lib.db().sticker(id)?.filter(|s| s.state == "held").ok_or_else(|| invalid("This sticker is no longer here."))?;
    let own_original = s.source_type == SourceType::Created && s.lineage == "real";
    let pack_cutout: bool = lib.db().conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM pack_items i LEFT JOIN signed_pack_items s ON s.item_id=i.id WHERE i.sticker_id=?1 AND (s.finished=0 OR (s.item_id IS NULL AND i.pack_id IN ('welcome','tokyo','coffee','plants','pixel','cats','night'))))", [id], |r| r.get(0))?;
    if !own_original && !pack_cutout { return Err(invalid("This sticker only has a finished picture. Its original cut-out isn't available.")); }
    Ok(s)
}

pub fn can_cutout(lib: &Library, id: &str) -> bool { source(lib, id).is_ok() }

pub fn png(lib: &Library, id: &str, cutout: bool) -> Result<Vec<u8>> {
    if !cutout {
        if !lib.db().sticker(id)?.is_some_and(|s| s.state == "held") { return Err(invalid("This sticker is no longer here.")); }
        // Sharing may repair old border artifacts without changing stored or signed sticker pixels.
        if let Ok(s) = source(lib, id) {
            if let Some(mask) = &s.mask_asset_path {
                let mut recipe = crate::materials::get(s.material_id.as_deref().unwrap_or(crate::materials::DEFAULT_MATERIAL))
                    .ok_or_else(|| invalid("This material isn't available."))?.recipe;
                let editor = if s.source_type == SourceType::Created { lib.original_for_edit(id)?.3 } else { None };
                if let Some(border) = recipe.border.as_mut() {
                    if s.source_type == SourceType::Created { border.width = editor.as_ref().map_or(20., |e|e.outline) as f64 / 520.; }
                }
                let params = crate::creator::Params { recipe, strength: crate::creator::DEFAULT_STRENGTH,
                    smooth: editor.as_ref().map_or(crate::creator::DEFAULT_SMOOTH, |e|e.smooth) };
                return Ok(crate::creator::render_saved_mask(&lib.read_asset(&s.original_asset_path)?, &lib.read_asset(mask)?, &params)?.sticker_png);
            }
        }
        return lib.read_rendered(id);
    }
    let s = source(lib, id)?;
    let (mut image, _) = crate::image_import::decode_oriented(&lib.read_asset(&s.original_asset_path)?)?;
    // Saved masks are at the creator's working size, after EXIF orientation and its fixed resize.
    let edge = image.width().max(image.height());
    if edge > crate::creator::WORK_EDGE {
        let scale = crate::creator::WORK_EDGE as f32 / edge as f32;
        image = image::imageops::resize(&image, (image.width() as f32 * scale).round().max(1.) as u32,
            (image.height() as f32 * scale).round().max(1.) as u32, FilterType::Lanczos3);
    }
    if let Some(path) = s.mask_asset_path {
        let mask = crate::image_limits::decode(&lib.read_asset(&path)?, None, crate::image_limits::STORED)?.to_luma8();
        if image.dimensions() != mask.dimensions() { return Err(invalid("The saved cut-out doesn't match this picture.")); }
        for (pixel, alpha) in image.pixels_mut().zip(mask.pixels()) { pixel[3] = pixel[3].min(alpha[0]); }
    } else if !image.pixels().any(|p| p[3] < 255) {
        return Err(invalid("This sticker has no saved cut-out."));
    }
    encode_cutout(image)
}

fn encode_cutout(mut image: RgbaImage) -> Result<Vec<u8>> {
    let (mut x0, mut y0, mut x1, mut y1) = (image.width(), image.height(), 0, 0);
    for (x, y, p) in image.enumerate_pixels_mut() {
        if p[3] == 0 { p.0 = [0;4]; } else { x0=x0.min(x); y0=y0.min(y); x1=x1.max(x+1); y1=y1.max(y+1); }
    }
    if x1 <= x0 || y1 <= y0 { return Err(invalid("The cut-out is empty.")); }
    let cropped = image::imageops::crop_imm(&image, x0, y0, x1-x0, y1-y0).to_image();
    image = RgbaImage::new(cropped.width()+2, cropped.height()+2);
    image::imageops::overlay(&mut image, &cropped, 1, 1);
    if image.width().max(image.height()) > crate::shop_pack::MAX_EDGE {
        let scale = crate::shop_pack::MAX_EDGE as f64 / image.width().max(image.height()) as f64;
        let (w,h) = ((image.width() as f64*scale).round().max(1.) as u32, (image.height() as f64*scale).round().max(1.) as u32);
        // Resize premultiplied RGB to avoid carrying hidden photo colors into transparent edges.
        let mut linear = image::Rgba32FImage::from_fn(image.width(),image.height(),|x,y| {
            let p=image.get_pixel(x,y); let a=p[3] as f32/255.; image::Rgba([p[0] as f32/255.*a,p[1] as f32/255.*a,p[2] as f32/255.*a,a])
        });
        linear = image::imageops::resize(&linear,w,h,FilterType::Triangle);
        image = RgbaImage::from_fn(w,h,|x,y| { let p=linear.get_pixel(x,y); let a=(p[3]*255.).round() as u8;
            if a==0 { image::Rgba([0;4]) } else { image::Rgba([(p[0]/p[3]*255.).round() as u8,(p[1]/p[3]*255.).round() as u8,(p[2]/p[3]*255.).round() as u8,a]) }
        });
    }
    let mut bytes=Vec::new(); image.write_to(&mut std::io::Cursor::new(&mut bytes),image::ImageFormat::Png)?; Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transparent_pixels_carry_no_photo_and_long_edge_is_bounded() {
        let mut image=RgbaImage::from_pixel(2200,1400,image::Rgba([250,10,70,0]));
        for y in 100..1300 { for x in 100..2100 { image.put_pixel(x,y,image::Rgba([20,180,50,255])); } }
        // A hole proves alpha remains zero inside the cropped result too.
        for y in 500..900 { for x in 900..1300 { image.put_pixel(x,y,image::Rgba([250,10,70,0])); } }
        let png=encode_cutout(image).unwrap();let out=image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(out.width(),1024);assert!(out.pixels().any(|p|p[3]==0));
        assert!(out.pixels().filter(|p|p[3]==0).all(|p|p.0==[0;4]));
        assert!(out.pixels().filter(|p|p[3]>0).all(|p|p[0]<30 && p[1]>170));
    }
    #[test]
    fn created_photo_exports_only_the_saved_subject_without_a_border() {
        let dir=std::env::temp_dir().join(format!("peta-photo-export-{}",crate::ids::new_gift_id()));
        let mut lib=Library::open(&dir).unwrap();
        let mut photo=RgbaImage::from_pixel(100,80,image::Rgba([255,0,0,255]));
        let mut mask=image::GrayImage::new(100,80);
        for y in 20..60 { for x in 20..80 { photo.put_pixel(x,y,image::Rgba([0,180,50,255])); mask.put_pixel(x,y,image::Luma([255])); } }
        let mut original=Vec::new();photo.write_to(&mut std::io::Cursor::new(&mut original),image::ImageFormat::Png).unwrap();
        let mut mask_png=Vec::new();mask.write_to(&mut std::io::Cursor::new(&mut mask_png),image::ImageFormat::Png).unwrap();
        let finished=crate::shop_pack::tests::disc(64,48,120);
        let r=crate::creator::Rendered{sticker_png:finished,width:64,height:48,cutout_png:Vec::new(),mask_png,coverage:0.3};
        let sticker=lib.add_made(&r,&original,"png",None,"matte").unwrap();
        let out=image::load_from_memory(&png(&lib,&sticker.id,true).unwrap()).unwrap().to_rgba8();
        assert_eq!(out.dimensions(),(62,42));assert!(out.pixels().filter(|p|p[3]>0).all(|p|p.0==[0,180,50,255]));assert!(out.pixels().any(|p|p.0==[0;4]));
        let _=std::fs::remove_dir_all(dir);
    }
    #[test]
    fn a_finished_received_picture_cannot_be_mislabelled_as_a_cutout() {
        let dir=std::env::temp_dir().join(format!("peta-picture-{}",crate::ids::new_gift_id()));
        let mut lib=Library::open(&dir).unwrap();let bytes=crate::shop_pack::tests::disc(64,48,120);
        let s=lib.add_finished_from_pack(&bytes,&[],"Gift","Friend","matte").unwrap();
        assert!(!can_cutout(&lib,&s.id));assert!(png(&lib,&s.id,true).is_err());assert_eq!(png(&lib,&s.id,false).unwrap(),bytes);
        let _=std::fs::remove_dir_all(dir);
    }
}
