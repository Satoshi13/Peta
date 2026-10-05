//! Cocoa screen points have a bottom-left origin; webviews use top-left logical points.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point { pub x: f64, pub y: f64 }
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Size { pub width: f64, pub height: f64 }
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Frame { pub origin: Point, pub size: Size }

pub fn cursor_to_layer(cursor: Point, frame: Frame) -> (Point, bool) {
    let point = Point { x: cursor.x - frame.origin.x, y: frame.origin.y + frame.size.height - cursor.y };
    let inside = point.x >= 0.0 && point.y >= 0.0 && point.x < frame.size.width && point.y < frame.size.height;
    (point, inside)
}
