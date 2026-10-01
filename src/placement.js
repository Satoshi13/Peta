// Pure placement math. No DOM, no Tauri — unit-tested with `node --test`.
//
// Stored form (display-independent, see spec §10):
//   relativeX / relativeY : sticker CENTER as a 0..1 fraction of the display
//   relativeScale         : sticker WIDTH as a fraction of the display width
//   rotation              : degrees, clockwise
// A sticker is square-boxed by its image aspect ratio (height = width / aspect).

export const MIN_SCALE = 0.03;
export const MAX_SCALE = 0.8;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Stored placement -> pixel box inside a layer of size (layerW, layerH). */
export function toPixels(p, layerW, layerH, aspect = 1) {
  const w = p.relativeScale * layerW;
  return { cx: p.relativeX * layerW, cy: p.relativeY * layerH, w, h: w / aspect, rotation: p.rotation };
}

/** Pixel center/width -> stored relative values (center clamped on-screen). */
export function fromPixels({ cx, cy, w }, layerW, layerH) {
  return {
    relativeX: clamp(cx / layerW, 0, 1),
    relativeY: clamp(cy / layerH, 0, 1),
    relativeScale: clamp(w / layerW, MIN_SCALE, MAX_SCALE),
  };
}

/** Uniform resize: scale width by how far the pointer is from the center now vs. at grab time. */
export function resizedWidth(startWidth, startDist, curDist, layerW) {
  if (startDist <= 0) return startWidth;
  return clamp((startWidth * curDist) / startDist, MIN_SCALE * layerW, MAX_SCALE * layerW);
}

export const distance = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

/** Angle (deg, clockwise, screen coords) of the pointer around the center. */
export function pointerAngle(cx, cy, px, py) {
  return (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
}

/** Wrap to (-180, 180]. */
export function normalizeAngle(deg) {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return a;
}

/** Rotation after dragging the rotate handle: start rotation + angular delta since grab. */
export function rotatedAngle(startRotation, startPointerAngle, curPointerAngle) {
  return normalizeAngle(startRotation + (curPointerAngle - startPointerAngle));
}
