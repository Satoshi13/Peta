#[path = "../src-tauri/src/platform/coordinates.rs"]
mod coordinates;
use coordinates::{Point,Size,Frame,cursor_to_layer};
fn frame(x:f64,y:f64,w:f64,h:f64)->Frame { Frame {origin:Point{x,y},size:Size{width:w,height:h}} }
#[test]
fn cocoa_bottom_left_becomes_webview_top_left() {
    assert_eq!(cursor_to_layer(Point{x:100.0,y:850.0},frame(0.0,0.0,1440.0,900.0)),(Point{x:100.0,y:50.0},true));
}
#[test]
fn monitors_left_above_and_below_the_main_screen_have_their_own_origin() {
    assert_eq!(cursor_to_layer(Point{x:-1500.0,y:1400.0},frame(-1920.0,900.0,1920.0,1080.0)),(Point{x:420.0,y:580.0},true));
    assert_eq!(cursor_to_layer(Point{x:300.0,y:-600.0},frame(0.0,-1080.0,1920.0,1080.0)),(Point{x:300.0,y:600.0},true));
}
#[test]
fn retina_points_are_not_multiplied_or_divided_again() {
    assert_eq!(cursor_to_layer(Point{x:1800.0,y:650.0},frame(1440.0,0.0,1280.0,720.0)),(Point{x:360.0,y:70.0},true));
}
#[test]
fn outside_and_boundary_are_explicit() {
    assert!(!cursor_to_layer(Point{x:-1.0,y:800.0},frame(0.0,0.0,1440.0,900.0)).1);
    assert!(!cursor_to_layer(Point{x:1440.0,y:800.0},frame(0.0,0.0,1440.0,900.0)).1);
    assert!(cursor_to_layer(Point{x:0.0,y:900.0},frame(0.0,0.0,1440.0,900.0)).1);
}
