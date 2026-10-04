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

// ---- Direct manipulation (no on-screen handles) ----

/** Where the grab lands inside the sticker's own box: u,v in 0..1 (outside the box => <0 or >1). */
export function toLocalUV(px, py, box) {
  const dx = px - box.cx, dy = py - box.cy;
  const t = (box.rotation * Math.PI) / 180;
  const lx = dx * Math.cos(t) + dy * Math.sin(t);
  const ly = -dx * Math.sin(t) + dy * Math.cos(t);
  return { u: lx / box.w + 0.5, v: ly / box.h + 0.5 };
}

/** Fraction of the grab point's distance from the center vs. half the longer side. */
export function grabRadius(px, py, box) {
  return distance(box.cx, box.cy, px, py) / (0.5 * Math.max(box.w, box.h));
}

/** Grabbing out near the sticker's rim "pinches a corner": scale + rotate together. */
export const PIVOT_RADIUS = 0.6;
export const isPivotGrab = (px, py, box) => grabRadius(px, py, box) > PIVOT_RADIUS;

/** Corner-pinch result: width follows distance from the center, rotation follows the angle. */
export function pivotResult(start, px, py, layerW) {
  const r = distance(start.cx, start.cy, px, py);
  return {
    w: resizedWidth(start.w, start.r0, r, layerW),
    rotation: rotatedAngle(start.rotation, start.a0, pointerAngle(start.cx, start.cy, px, py)),
  };
}

// ---- Peel (Option + drag away): the trailing edge folds towards the hand ----

export const PEEL_DISTANCE = 0.45; // pull length (as a fraction of the longer side) for progress = 1
export const PEEL_COMMIT = 0.8;    // released beyond this => the sticker comes off
export const PEEL_MAX_ANGLE = 75;

/**
 * Pose of a half-lifted sticker for a screen-space pull vector (dx, dy).
 * Returns the pull in sticker-local coordinates, the leading attached edge and the lift angle.
 * peelCurl maps the trailing paper to a curve; the sticker's placement stays unchanged.
 */
export function peelPose(dx, dy, rotationDeg, w, h) {
  const len = Math.hypot(dx, dy);
  const progress = len / (PEEL_DISTANCE * Math.max(w, h));
  if (len < 1e-6) return { progress: 0, angle: 0, ax: 0, ay: 1, ox: w / 2, oy: h / 2, dlx: 1, dly: 0 };
  const t = (rotationDeg * Math.PI) / 180;
  // pull direction in the sticker's own (unrotated) frame
  const dlx = (dx * Math.cos(t) + dy * Math.sin(t)) / len;
  const dly = (-dx * Math.sin(t) + dy * Math.cos(t)) / len;
  const reach = Math.abs(dlx) * (w / 2) + Math.abs(dly) * (h / 2); // center -> far side, along the pull
  return {
    progress,
    angle: Math.min(PEEL_MAX_ANGLE, progress * 55),
    ax: -dly, ay: dlx,
    ox: w / 2 + dlx * reach, oy: h / 2 + dly * reach,
    dlx, dly,
  };
}

/** Peel from the trailing edge and fold towards the hand; the attached leading edge stays flat. */
export function peelCurl(pose, w, h) {
  const dlx = -pose.dlx, dly = -pose.dly, progress = clamp(pose.progress, 0, 1);
  const reach = (Math.abs(dlx) * w + Math.abs(dly) * h) / 2;
  const length = reach * 2 * progress, seam = reach - length;
  const projection = ([x, y]) => (x - w / 2) * dlx + (y - h / 2) * dly;
  const clip = (lo, hi) => {
    let points = [[0, 0], [w, 0], [w, h], [0, h]];
    for (const [limit, sign] of [[lo, 1], [hi, -1]]) {
      if (!Number.isFinite(limit)) continue;
      const out = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const qa = (projection(a) - limit) * sign, qb = (projection(b) - limit) * sign;
        if (qa >= 0) out.push(a);
        if ((qa >= 0) !== (qb >= 0)) { const t = qa / (qa - qb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
      }
      points = out;
    }
    return points;
  };
  const front = clip(-Infinity, seam), lifted = clip(seam, Infinity), strips = [];
  if (length > 1e-6) {
    const bend = Math.min(200, progress * 260) * Math.PI / 180, radius = length / bend, count = 64;
    for (let i = 0; i < count; i++) {
      const q = (i + .5) * length / count, angle = q / radius, origin = seam + q;
      const shift = radius * Math.sin(angle) - q;
      strips.push({
        clip: clip(seam + i * length / count, seam + (i + 1) * length / count),
        paintClip: clip(seam + i * length / count - .6, seam + (i + 1) * length / count + .6),
        ox: w / 2 + dlx * origin, oy: h / 2 + dly * origin,
        x: dlx * shift, y: dly * shift, z: radius * (1 - Math.cos(angle)),
        angle: angle * 180 / Math.PI, shade: .06 + .24 * (1 - Math.abs(Math.cos(angle))),
      });
    }
  }
  return { front, lifted, strips, length, dlx, dly };
}
