// Pure layout and local-date calculations shared by the native pages and their tests.
export function nextLocalMidnight(now) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime();
}

export function envelopeClock(now, deadline = nextLocalMidnight(now)) {
  const seconds = Math.max(0, Math.ceil((deadline - Number(now)) / 1000));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return { seconds, minute: Math.floor(seconds / 60), text: [hours, minutes, seconds % 60].map(n => String(n).padStart(2, '0')).join(':'), label: `Next envelope in ${hours} hours ${minutes} minutes` };
}

export const bookMonthKey = date => date.getFullYear() * 12 + date.getMonth();
export const bookDateKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
export function newestBookEntries(entries) {
  return [...entries].sort((a, b) => b.date - a.date || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || (b.no || 0) - (a.no || 0) || a.id.localeCompare(b.id));
}
/* The words a sticker can be found by: its name, material, where it came from, its number and when it was made. */
const fold = text => String(text ?? '').normalize('NFKC').toLowerCase();
export function bookSearchText(entry, materialName = entry.material) {
  const d = entry.date, pad = n => String(n).padStart(2, '0');
  const words = [entry.title, materialName, entry.material, entry.kind === 'received' ? 'received gift pack' : 'original', entry.onDesktop ? 'on desktop' : '',
    entry.no == null ? '' : `no ${pad4(entry.no)} ${entry.no}`,
    d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }), bookDateKey(d)];
  return fold(words.join(' '));
}
const pad4 = n => String(n).padStart(4, '0');
/* Search (every word must match), one material or all (or 'desktop': only what is stuck on the desktop), and an order. Newest first is the default and the tie-break of every other order. */
export function filterBookEntries(entries, { query = '', material = 'all', sort = 'newest', materialIds = [], nameOf = id => id } = {}) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const kept = entries.filter(e => (material === 'all' || (material === 'desktop' ? !!e.onDesktop : e.material === material)) && (!words.length || words.every(w => bookSearchText(e, nameOf(e.material)).includes(w))));
  const newest = newestBookEntries(kept);
  if (sort === 'oldest') return newest.reverse();
  const rank = new Map(newest.map((e, i) => [e.id, i]));
  const byNewest = (a, b) => rank.get(a.id) - rank.get(b.id);
  if (sort === 'name') return newest.sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? ''), undefined, { numeric: true, sensitivity: 'base' }) || byNewest(a, b));
  if (sort === 'material') {
    const order = id => { const i = materialIds.indexOf(id); return i < 0 ? materialIds.length : i; };
    return newest.sort((a, b) => order(a.material) - order(b.material) || byNewest(a, b));
  }
  return newest;
}
export function calendarTilt(date) {
  return [...bookDateKey(date)].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 997, 0) % 13 - 6;
}
export function calendarMonth(entries, key, today, weekStart = 0) {
  const year = Math.floor(key / 12), month = key % 12, days = new Date(year, month + 1, 0, 12).getDate();
  const offset = (new Date(year, month, 1, 12).getDay() - weekStart + 7) % 7;
  const byDay = new Map();
  for (const entry of newestBookEntries(entries)) {
    if (bookMonthKey(entry.date) !== key) continue;
    const day = entry.date.getDate(), group = byDay.get(day) || [];
    if (!group.some(e => e.id === entry.id)) group.push(entry);
    byDay.set(day, group);
  }
  const todayKey = bookDateKey(today);
  const cells = Array.from({length: days}, (_, i) => {
    const date = new Date(year, month, i + 1, 12), dateKey = bookDateKey(date);
    return {day:i + 1, date, entries:byDay.get(i + 1) || [], tilt:calendarTilt(date), state:dateKey === todayKey ? 'today' : dateKey < todayKey ? 'past' : 'future'};
  });
  const daysStuck = byDay.size, petas = [...byDay.values()].reduce((n, group) => n + group.length, 0);
  const elapsed = key < bookMonthKey(today) || key === bookMonthKey(today) && today.getDate() === days;
  return {days, offset, cells, daysStuck, petas, complete:elapsed && daysStuck === days};
}

export function fitMaterialCard({stageWidth, stageHeight, cardWidth, cardHeight, hintBottom, infoTop, gap = 12, maxWidth = 300}) {
  const top = Math.max(0, Math.min(stageHeight, hintBottom + gap));
  const bottom = Math.max(top, Math.min(stageHeight, infoTop - gap));
  // Reserve room for the existing 1.08× flight overshoot, rotation and pointer tilt.
  const margin = 1.18;
  const scale = cardWidth > 0 && cardHeight > 0 ? Math.max(0, Math.min(maxWidth / cardWidth, stageWidth * .5 / cardWidth, (bottom - top) / (cardHeight * margin))) : 0;
  const halfHeight = cardHeight * scale * margin / 2;
  const cy = Math.max(top + halfHeight, Math.min(bottom - halfHeight, stageHeight * .42));
  return {cx:stageWidth / 2, cy, scale, top, bottom};
}

export function navShortcut(event, {input=false, dialog=false, busy=false, ceremony=false} = {}) {
  if(input || dialog || busy || ceremony || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return null;
  if(event.key === ',') return 'settings';
  return ({1:'today',2:'create',3:'book',4:'packs',5:'gifts',6:'materials',7:'market'})[event.key] || null;
}

export function resolveTheme(pref, systemDark) {
  return pref === 'night' || pref === 'auto' && systemDark ? 'night' : 'day';
}

/** Which of today's stickers have not landed on the Today stage yet. `saved` is the last stored record. */
export function landingState(saved, dateKey, ids) {
  const seen = saved && saved.date === dateKey && Array.isArray(saved.ids) ? saved.ids : [];
  return {fresh:ids.filter(id => !seen.includes(id)), next:{date:dateKey, ids:[...new Set([...seen, ...ids])].slice(-24)}};
}

/** Geometry of the month poster the Collection can save as a PNG (all values in image pixels). */
export function posterLayout(offset, days, {width = 1600, margin = 96, headerH = 330, weekdayH = 64, cellH = 224, footerH = 150} = {}) {
  const rows = Math.ceil((offset + days) / 7), cellW = (width - margin * 2) / 7, gridTop = headerH + weekdayH;
  const cell = day => { const i = offset + day - 1; return {x:margin + i % 7 * cellW, y:gridTop + Math.floor(i / 7) * cellH, w:cellW, h:cellH}; };
  return {width, height:gridTop + rows * cellH + footerH, rows, cellW, cellH, margin, gridTop, cell};
}
export function fitInside(w, h, boxW, boxH) {
  const k = Math.min(boxW / w, boxH / h);
  return {w:w * k, h:h * k};
}

/** Bounding box of the visible pixels in RGBA data (alpha above `threshold`), or null when nothing is visible. */
export function alphaBounds(rgba, width, height, threshold = 16) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rgba[(y * width + x) * 4 + 3] > threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : {x:x0, y:y0, w:x1 - x0 + 1, h:y1 - y0 + 1};
}

/** The last `count` local days ending today (oldest first), each marked when something was stuck on it. */
export function recentDays(stuckDates, today, count = 7) {
  const stuck = new Set(stuckDates);
  return Array.from({length:count}, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (count - 1 - i), 12), key = bookDateKey(date);
    return {key, filled:stuck.has(key), today:i === count - 1};
  });
}


/** How a pulled rarity shows itself. One table drives the daily envelope and the ten-at-once sheet.
 *  Rarity is expressed by how light behaves: `dim` is how far the room darkens (0..1), `pre` the held breath before the reveal (ms),
 *  `sweep` the band of light across the face (ms), `hold` how long the others wait while this one has the stage (ms),
 *  `aura` the edge light that wraps the window, `tint` the colour the room goes (RGB, multiplied over paper). */
const REVEAL = {
  common:   {dim:0,   pre:0,   sweep:700,  hold:0,    aura:null,    tint:null,           sparks:0,  ink:false, tell:null},
  uncommon: {dim:.14, pre:0,   sweep:800,  hold:0,    aura:null,    tint:'150,104,52',   sparks:0,  ink:false, tell:null},
  rare:     {dim:.48, pre:260, sweep:1100, hold:1000, aura:'prism', tint:'70,60,118',    sparks:30, ink:false, tell:'prism'},
  special:  {dim:.70, pre:560, sweep:1500, hold:1300, aura:'gold',  tint:'112,66,14',    sparks:34, ink:false, tell:'gold'},
  archive:  {dim:.56, pre:420, sweep:1300, hold:1400, aura:'sepia', tint:'112,84,44',    sparks:0,  ink:true,  tell:'sepia'},
};
export function revealPlan(rarity) {
  const plan = REVEAL[rarity] || REVEAL.common;
  return {rarity:REVEAL[rarity] ? rarity : 'common', ...plan, hot:plan.hold > 0, dark:plan.dim > .34};
}

/** The order a ten-at-once sheet turns over: left to right, row by row. Rares and above hold the wave while they have the stage. */
export function sheetWave(rarities) {
  return rarities.map((rarity, index) => ({index, rarity, hold:revealPlan(rarity).hold, hot:revealPlan(rarity).hot}));
}

/** Cell size for a sheet of `count` sleeves in a stage; the sleeve art is slightly wider than tall. */
export function sheetCell({stageWidth, stageHeight, footer, count, gap = 12, maxWidth = 150}) {
  const cols = Math.min(5, count), rows = Math.ceil(count / cols);
  const byWidth = (stageWidth - 40 - gap * (cols - 1)) / cols, byHeight = (stageHeight - footer - 54 - gap * (rows - 1)) / rows / 1.08;
  const width = Math.floor(Math.max(32, Math.min(maxWidth, byWidth, byHeight)));
  return {cols, rows, width, height:Math.round(width * 1.08), gap};
}

/* ---- Studio: where the label, the cover sticker and the accents sit on a wrapping ----
   Everything is in percent of the wrapping's picture, as centres. The same rules draw a pack everywhere and hold the maker's hand while dragging:
   the cover sticker stays wholly inside the wrapping's body, an accent's centre stays inside it (a clip may overhang an edge it is clipped to).
   The label is printed on the wrapping itself: it is always there, in the wrapping's own place, and cannot be moved or taken off. */
const mid = (lo, hi) => (lo + hi) / 2;
const clampTo = (v, lo, hi) => (lo > hi ? mid(lo, hi) : Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : mid(lo, hi))));
export const BAG_ACCENTS = ['clip', 'pin', 'tape'], BAG_MAX_ACCENTS = 2, BAG_COMPOSITIONS = ['center', 'corner', 'band'];
/** The size of a part in percent of the picture: {w, h}. */
export function bagPartSize(bag, part) {
  const square = s => ({ w: s, h: s * bag.W / bag.H });
  if (part === 'label') return { w: bag.lbl[2] - bag.lbl[0], h: bag.lbl[3] - bag.lbl[1] };
  if (part === 'cover') return square(bag.cover[2]);
  if (part === 'clip') return square(bag.clip[2]);
  if (part === 'pin') return square(bag.pin[2]);
  return { w: bag.tape[2], h: bag.tape[3] };
}
/** Where an accent of this kind goes when it is first added: the place the wrapping gives it. */
export function bagAccentDefault(bag, kind) {
  if (kind === 'tape') return [bag.tape[0] + bag.tape[2] / 2, bag.tape[1] + bag.tape[3] / 2];
  const at = kind === 'pin' ? bag.pin : bag.clip; return [at[0], at[1]];
}
/** Put a part's centre where it can be: the label and the cover wholly inside the body, an accent's centre inside it. */
export function bagClampPart(bag, part, [x, y]) {
  const [x0, y0, x1, y1] = bag.body, { w, h } = bagPartSize(bag, part);
  const inBody = (px, py) => [clampTo(px, x0 + w / 2, x1 - w / 2), clampTo(py, y0 + h / 2, y1 - h / 2)];
  if (part === 'label') return inBody(x, y);
  if (part !== 'cover') return [clampTo(x, x0 + 2, x1 - 2), clampTo(y, y0 + 2, y1 - 2)];
  /* the cover sticker never sits on the name: if it would, it goes to the nearest free side of the label (up, down, left or right) that is still on the wrapping */
  const [l, t, r, b] = bag.lbl, over = ([px, py]) => Math.max(0, Math.min(px + w / 2, r) - Math.max(px - w / 2, l)) * Math.max(0, Math.min(py + h / 2, b) - Math.max(py - h / 2, t));
  const at = inBody(x, y); if (over(at) <= 1e-9) return at;
  const options = [[at[0], t - h / 2], [at[0], b + h / 2], [l - w / 2, at[1]], [r + w / 2, at[1]]].map(c => inBody(c[0], c[1]));
  return options.sort((p, q) => over(p) - over(q) || Math.hypot(p[0] - at[0], p[1] - at[1]) - Math.hypot(q[0] - at[0], q[1] - at[1]))[0];
}
/** The cover's place for a composition, from the label that stays where the wrapping prints it (the maker's own place wins over it). */
export function bagComposition(bag, comp) {
  const lbl = bagPartSize(bag, 'label'), cov = bagPartSize(bag, 'cover'), home = [mid(bag.lbl[0], bag.lbl[2]), mid(bag.lbl[1], bag.lbl[3])], [x0, y0, x1, y1] = bag.body;
  let label = home, cover = [bag.cover[0], bag.cover[1]];
  if (comp === 'center') cover = [home[0], home[1] + lbl.h / 2 + cov.h / 2 - 3];
  else if (comp === 'band') cover = [home[0] + lbl.w / 2 - cov.w * .25, home[1]];
  return { label, cover: bagClampPart(bag, 'cover', cover) };
}
/** Everything the picture needs from a layout, every place clamped: {comp, label:[x,y], cover:[x,y], accents:[{kind,x,y}]}. */
export function bagResolveLayout(bag, layout = {}) {
  const comp = BAG_COMPOSITIONS.includes(layout.comp) || layout.comp === 'free' ? layout.comp : 'corner', base = bagComposition(bag, BAG_COMPOSITIONS.includes(comp) ? comp : 'corner');
  const accents = [], seen = new Set();
  for (const a of layout.accents || []) {
    if (accents.length >= BAG_MAX_ACCENTS || !BAG_ACCENTS.includes(a?.kind) || seen.has(a.kind)) continue;
    seen.add(a.kind); const [x, y] = bagClampPart(bag, a.kind, [a.x, a.y]); accents.push({ kind: a.kind, x, y });
  }
  return { comp, label: base.label, cover: bagClampPart(bag, 'cover', layout.cover || base.cover), accents };
}
