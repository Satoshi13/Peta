import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toPixels, fromPixels, resizedWidth, pointerAngle, rotatedAngle, normalizeAngle, MIN_SCALE, MAX_SCALE,
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
