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

export function fitMaterialCard({stageWidth, stageHeight, cardWidth, cardHeight, hintBottom, infoTop, gap = 12}) {
  const top = Math.max(0, Math.min(stageHeight, hintBottom + gap));
  const bottom = Math.max(top, Math.min(stageHeight, infoTop - gap));
  // Reserve room for the existing 1.08× flight overshoot, rotation and pointer tilt.
  const margin = 1.18;
  const scale = cardWidth > 0 && cardHeight > 0 ? Math.max(0, Math.min(300 / cardWidth, stageWidth * .5 / cardWidth, (bottom - top) / (cardHeight * margin))) : 0;
  const halfHeight = cardHeight * scale * margin / 2;
  const cy = Math.max(top + halfHeight, Math.min(bottom - halfHeight, stageHeight * .42));
  return {cx:stageWidth / 2, cy, scale, top, bottom};
}
