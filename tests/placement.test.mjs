import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toPixels, fromPixels, resizedWidth, pointerAngle, rotatedAngle, normalizeAngle, MIN_SCALE, MAX_SCALE,
  toLocalUV, grabRadius, isPivotGrab, pivotResult, peelPose, peelCurl, PEEL_MAX_ANGLE, PEEL_COMMIT,
} from "../src/placement.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("toPixels / fromPixels round-trip", () => {
  const p = { relativeX: 0.72, relativeY: 0.31, relativeScale: 0.12, rotation: -7 };
  const box = toPixels(p, 2560, 1440, 1);
  near(box.cx, 0.72 * 2560); near(box.cy, 0.31 * 1440); near(box.w, 0.12 * 2560);
  const back = fromPixels(box, 2560, 1440);
  near(back.relativeX, p.relativeX); near(back.relativeY, p.relativeY); near(back.relativeScale, p.relativeScale);
});

test("same relative placement scales with a different resolution (spec §10)", () => {
  const p = { relativeX: 0.5, relativeY: 0.5, relativeScale: 0.1, rotation: 0 };
  const a = toPixels(p, 1440, 900), b = toPixels(p, 3840, 2160);
  near(a.cx / 1440, b.cx / 3840); near(a.w / 1440, b.w / 3840);
});

test("aspect ratio drives height", () => {
  near(toPixels({ relativeX: 0, relativeY: 0, relativeScale: 0.1, rotation: 0 }, 1000, 1000, 2).h, 50);
});

test("fromPixels clamps center to the display and scale to limits", () => {
  const r = fromPixels({ cx: -50, cy: 5000, w: 1 }, 1000, 1000);
  assert.equal(r.relativeX, 0); assert.equal(r.relativeY, 1); assert.equal(r.relativeScale, MIN_SCALE);
  assert.equal(fromPixels({ cx: 0, cy: 0, w: 5000 }, 1000, 1000).relativeScale, MAX_SCALE);
});

test("resizedWidth is proportional to pointer distance and clamped", () => {
  near(resizedWidth(100, 50, 100, 2000), 200);
  near(resizedWidth(400, 50, 25, 2000), 200);
  near(resizedWidth(100, 50, 1, 2000), MIN_SCALE * 2000);
  assert.equal(resizedWidth(100, 0, 10, 2000), 100);
  near(resizedWidth(100, 1, 1e9, 2000), MAX_SCALE * 2000);
});

test("pointerAngle: clockwise in screen coordinates", () => {
  near(pointerAngle(0, 0, 10, 0), 0);
  near(pointerAngle(0, 0, 0, 10), 90);
  near(pointerAngle(0, 0, -10, 0), 180);
});

test("rotatedAngle adds the angular delta and wraps", () => {
  near(rotatedAngle(-7, 0, 30), 23);
  near(rotatedAngle(170, 0, 30), -160);
  near(normalizeAngle(540), 180);
  near(normalizeAngle(-190), 170);
});

test("toLocalUV: center is (0.5,0.5) and respects rotation", () => {
  const box = { cx: 500, cy: 400, w: 200, h: 100, rotation: 0 };
  const c = toLocalUV(500, 400, box); near(c.u, 0.5); near(c.v, 0.5);
  const tl = toLocalUV(400, 350, box); near(tl.u, 0); near(tl.v, 0);
  // rotated 90deg clockwise: the sticker's local +x axis points down the screen
  const r = toLocalUV(500, 500, { ...box, rotation: 90 }); near(r.u, 1); near(r.v, 0.5);
});

test("pivot grab = rim of the sticker, body = move", () => {
  const box = { cx: 0, cy: 0, w: 200, h: 100, rotation: 0 };
  assert.equal(isPivotGrab(10, 0, box), false);
  assert.equal(isPivotGrab(90, 0, box), true);
  near(grabRadius(100, 0, box), 1);
});

test("pivotResult: drag the rim outward and around => bigger and rotated at once", () => {
  const start = { cx: 0, cy: 0, w: 100, rotation: 10, r0: 50, a0: 0 };
  const out = pivotResult(start, 0, 100, 2000); // twice as far, 90deg clockwise
  near(out.w, 200); near(out.rotation, 100);
});

test("peelPose: pulling right hinges on the left edge, axis is vertical", () => {
  const p = peelPose(60, 0, 0, 200, 100);
  near(p.ox, 0); near(p.oy, 50); near(p.ax, 0); near(p.ay, 1);
  assert.ok(p.angle > 0 && p.progress > 0);
});

test("peelPose: pulling down hinges on the top edge", () => {
  const p = peelPose(0, 40, 0, 200, 100);
  near(p.ox, 100); near(p.oy, 0); near(p.ax, -1); near(p.ay, 0);
});

test("peelPose follows the sticker's rotation and caps the angle", () => {
  // sticker rotated 90deg cw: a screen-space pull downward is local +x => hinge on local left
  const p = peelPose(0, 40, 90, 200, 100);
  near(p.dlx, 1); near(p.dly, 0, 1e-9); near(p.ox, 0);
  assert.equal(peelPose(1e6, 0, 0, 200, 100).angle, PEEL_MAX_ANGLE);
  assert.equal(peelPose(0, 0, 0, 200, 100).progress, 0);
});

const area = points => Math.abs(points.reduce((sum, [x, y], i) => {
  const next = points[(i + 1) % points.length]; return sum + x * next[1] - y * next[0];
}, 0)) / 2;

test("curl keeps the attached part flat and covers the original silhouette without losing paper", () => {
  for (const [dx, dy] of [[60, 0], [0, -60], [-45, 60], [45, -60]]) {
    const curl = peelCurl(peelPose(dx, dy, 37, 240, 160), 240, 160);
    assert.ok(area(curl.front) > 0 && area(curl.front) < 240 * 160);
    near(area(curl.front) + curl.strips.reduce((sum, band) => sum + area(band.clip), 0), 240 * 160);
    for (const band of curl.strips) for (const [x, y] of band.clip) {
      assert.ok(x >= -1e-9 && x <= 240 + 1e-9 && y >= -1e-9 && y <= 160 + 1e-9);
    }
  }
});

test("curl reveals the underside before the unchanged release threshold, in every pull direction", () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [.6, -.8]]) {
    const pose = peelPose(dx * 90 * PEEL_COMMIT, dy * 90 * PEEL_COMMIT, 0, 200, 150);
    const curl = peelCurl(pose, 200, 150);
    assert.ok(curl.strips.some(band => band.angle > 90));
    assert.ok(curl.strips.every(band => band.z >= 0));
    assert.ok(area(curl.front) > 0); // A releasing finger completes the last attached part.
    const middle = curl.strips[5];
    near(middle.x * dy - middle.y * dx, 0);
  }
});

test("curl begins flat, ends fully released and stays finite for extreme/zero pulls", () => {
  const flat = peelCurl(peelPose(0, 0, 0, 200, 100), 200, 100);
  assert.equal(flat.strips.length, 0); near(area(flat.front), 20000);
  const full = peelCurl(peelPose(1e9, -1e9, -65, 200, 100), 200, 100);
  near(area(full.front), 0); near(full.strips.reduce((sum, band) => sum + area(band.clip), 0), 20000);
  assert.ok(full.strips.every(band => [band.ox, band.oy, band.x, band.y, band.z, band.angle, band.shade].every(Number.isFinite)));
  assert.equal(peelCurl({dlx:1,dly:0,progress:1}, 0, 0).strips.length, 0);
});
