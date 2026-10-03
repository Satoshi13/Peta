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
