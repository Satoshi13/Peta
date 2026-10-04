/* Small helpers shared by everything. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const EASE = {
  out: "cubic-bezier(.2,.8,.2,1)", inOut: "cubic-bezier(.65,.05,.25,1)", spring: "cubic-bezier(.34,1.56,.64,1)",
  paper: "cubic-bezier(.5,.05,.2,1)", soft: "cubic-bezier(.3,.7,.3,1)",
};
const reduced = () => document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;

/** h("div.cls#id", {attrs, on:{click}}, ...children) */
function h(sel, props, ...kids) {
  const m = sel.match(/^([a-z0-9-]*)((?:[.#][\w-]+)*)$/i);
  const e = document.createElement(m[1] || "div");
  (m[2].match(/[.#][\w-]+/g) || []).forEach((t) => (t[0] === "." ? e.classList.add(t.slice(1)) : (e.id = t.slice(1))));
  if (props && (props.nodeType || typeof props === "string" || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === "style" && typeof v === "object") { for (const n in v) n.startsWith("--") ? e.style.setProperty(n, v[n]) : (e.style[n] = v[n]); }
    else if (k === "vars") for (const n in v) e.style.setProperty(n, v[n]);
    else if (k === "on") for (const n in v) e.addEventListener(n, v[n]);
    else if (k === "html") e.innerHTML = v;
    else if (k === "data") for (const n in v) e.dataset[n] = v[n];
    else if (k in e && k !== "list" && typeof v !== "object") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else e.append(c.nodeType ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return e;
}

/** Web Animations wrapper: resolves when done; respects reduced motion (jumps to the end). */
function anim(el, frames, o = {}) {
  const a = el.animate(frames, { duration: 400, easing: EASE.out, fill: "both", ...o, ...(reduced() ? { duration: 1, delay: 0, iterations: 1 } : {}) });
  return a.finished.catch(() => {}).then(() => a);
}
/** Apply the last keyframe permanently, then drop the animation. */
async function animCommit(el, frames, o = {}) {
  const a = await anim(el, frames, o);
  try { a.commitStyles(); a.cancel(); } catch {}
}

function img(key, cls, alt = "") { const i = new Image(); i.src = A[key]; i.alt = alt; i.draggable = false; if (cls) i.className = cls; return i; }

/** Pointer-follow helper: calls cb(x01, y01, ev) while the pointer moves over el. */
function onPointerFollow(el, cb, leave) {
  el.addEventListener("pointermove", (e) => {
    if (reduced()) { leave?.(); return; }
    const r = el.getBoundingClientRect();
    cb(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1), e);
  });
  if (leave) el.addEventListener("pointerleave", leave);
}

/** Drag helper with pointer capture. handlers: down(e)->bool|void, move(dx,dy,e), up(e,moved) */
function drag(el, { down, move, up, threshold = 3 }) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (down && down(e) === false) return;
    e.preventDefault(); // no text selection / native drag while we own the gesture
    const sx = e.clientX, sy = e.clientY; let moved = false;
    el.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < threshold) return;
      moved = true; move && move(dx, dy, ev);
    };
    const end = (ev) => {
      el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", end); el.removeEventListener("pointercancel", end);
      try { el.releasePointerCapture(e.pointerId); } catch {}
      up && up(ev, moved);
    };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  });
}

const fmtDate = (d, o = { month: "short", day: "numeric" }) => d.toLocaleDateString("en-US", o);
const pad4 = (n) => String(n).padStart(4, "0");
