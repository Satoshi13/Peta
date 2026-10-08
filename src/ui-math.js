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
/* Search (every word must match), one material or all, and an order. Newest first is the default and the tie-break of every other order. */
export function filterBookEntries(entries, { query = '', material = 'all', sort = 'newest', materialIds = [], nameOf = id => id } = {}) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const kept = entries.filter(e => (material === 'all' || e.material === material) && (!words.length || words.every(w => bookSearchText(e, nameOf(e.material)).includes(w))));
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
