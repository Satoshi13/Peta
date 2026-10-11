/* Peta's friends-only market: a small economy simulator (no dependencies).
   It answers "if we set the price, the seller's share, the edition size... like this, does the market stay alive, do sellers come out ahead, and does Scraps run away?"
   Open docs/economy-sim.html (served from the repo root) to move the numbers, or run:  node scripts/economy-sim.mjs [--price=10] [--sweep=price:6,8,10,12]

   The model (the rules we are thinking of; the numbers are the existing ones in docs/decisions.md where there are any):
   - Everyone gets the day's material sheet (the same for all; the mix and the dismantle values are the app's). A sheet is either used to make a sticker, dismantled for Scraps, or kept.
   - A seller who has made enough stickers presses an EDITION RUN: every design gets `editions` numbered copies, a few prize materials and link tags are added from their own stock,
     and all of it goes into one pack (the stickers MOVE in: nothing is copied). They list only when the expected income beats the cost by `minMargin`.
   - A pull costs `price` Scraps. `sellerShare` of it goes to the seller, the rest is burned. One slot is drawn without replacement, so the pack sells out.
   - A sticker is never dismantled. A prize material or tag is dismantled for Scraps at once (that is how Scraps comes back into the world).
   - Collectors may put what they pulled into a pack of their own (a resale: the same numbered sticker moves on, it is never copied).
   Everything is deterministic for a seed. */

export const MATERIALS = [   // id, chance of being the day's sheet, Scraps when dismantled, Scraps to buy one (the app's own numbers)
  { id: 'matte', p: .30, dismantle: 1, buy: 1 }, { id: 'kraft', p: .20, dismantle: 1, buy: 2 }, { id: 'riso', p: .10, dismantle: 1, buy: 2 },
  { id: 'pixel', p: .10, dismantle: 1, buy: 2 }, { id: 'washi', p: .10, dismantle: 1, buy: 2 }, { id: 'holographic', p: .08, dismantle: 3, buy: 6 },
  { id: 'clear', p: .05, dismantle: 3, buy: 6 }, { id: 'vintage', p: .04, dismantle: 4, buy: 8 }, { id: 'gold', p: .03, dismantle: 6, buy: 12 },
];
const avg = (key) => MATERIALS.reduce((s, m) => s + m.p * m[key], 0) / MATERIALS.reduce((s, m) => s + m.p, 0);
export const SHEET = { dismantle: avg('dismantle'), buy: avg('buy') };

export const DEFAULTS = {
  players: 8, days: 90, seed: 1, startScraps: 12,
  makeProb: .55,            // a day's sheet becomes a sticker with this chance (otherwise it is dismantled, or kept)
  makeBonus: 0,             // the daily mission: Scraps for making a new sticker that day (once a day; the leftovers of the cut-out are what Scraps are)
  streakEvery: 0, streakBonus: 0,   // and an extra bonus every this-many days in a row (0 = none)
  keepProb: .1,             // ...or kept as a sheet
  appetite: .6,             // chance per day that a player with enough Scraps pulls; and again for each extra pull
  maxPullsPerDay: 3,
  price: 10, sellerShare: .7,   // Scraps per pull; the seller's part of it (the rest is burned)
  designsPerPack: 4, editions: 5,   // designs in a pack, numbered copies of each
  copySheets: .2,           // extra sheets one more copy costs (a run of E copies costs 1 + copySheets*(E-1) sheets per design)
  prizeMaterials: 2, prizeTags: 1, tagCost: 2, tagDismantle: 1,
  minMargin: .15,           // a seller lists only if expected income >= cost * (1 + minMargin)
  resellProb: .15, resellMin: 3,   // a collector with this many stickers may put them into a pack of their own, with this chance per day
  horizon: 30,              // a seller judges a pack by what it could sell in this many days, from how much is being pulled lately and how many packs there already are
};

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pickMaterial = (r) => { let x = r(), tot = MATERIALS.reduce((s, m) => s + m.p, 0) * x; for (const m of MATERIALS) { tot -= m.p; if (tot <= 0) return m; } return MATERIALS[0]; };

/** One run. Returns the day-by-day series and a summary. */
export function simulate(over = {}) {
  const P = { ...DEFAULTS, ...over }, r = rng(P.seed);
  const players = Array.from({ length: P.players }, (_, i) => ({ i, scraps: P.startScraps, sheets: 0, designs: 0, stickers: 0, made: 0, streak: 0 }));
  const grant = P.players * P.startScraps;   // the welcome Scraps are part of what came in from the world
  const packs = [];   // { seller, slots: [{kind, id}], listedDay, soldOutDay, income, cost, relist }
  const led = { faucet: grant, mission: 0, faucet0: grant, sink: 0, minted: 0, listed: 0, relists: 0, pulls: 0, stickersPulled: 0, prizeMaterials: 0, prizeTags: 0, restocks: 0 };
  let nextSticker = 1; const owner = new Map();   // sticker id -> holder: one holder at a time (nothing is ever duplicated)
  const series = [];
  const avgRun = (E) => 1 + P.copySheets * (E - 1);

  let demand = Math.max(.3, P.players * P.appetite * .1);   // pulls per day lately (a moving average; a seller's first guess before there is any history)
  /** What a run would cost this seller (Scraps), and what they hope to take. */
  const quote = (designs, openPacks) => {
    const extraSheets = designs * (avgRun(P.editions) - 1), sheetsCost = extraSheets * SHEET.buy, prizes = P.prizeMaterials * SHEET.dismantle + P.prizeTags * P.tagCost;
    const design = designs * SHEET.dismantle;   // what the sheets that became the stickers could have been dismantled for
    const slots = designs * P.editions + P.prizeMaterials + P.prizeTags, cost = sheetsCost + prizes + design;
    const expectedSold = Math.min(slots, demand * P.horizon / (openPacks + 1));   // this pack's share of the pulls to come
    return { slots, cost, income: P.sellerShare * P.price * expectedSold, sheetsCost, prizes };
  };

  for (let day = 1; day <= P.days; day++) {
    const sheet = pickMaterial(r);
    for (const p of players) {
      const x = r();
      if (x < P.makeProb) {
        p.designs++; p.made++; p.streak++;
        let bonus = P.makeBonus; if (P.streakEvery > 0 && p.streak % P.streakEvery === 0) bonus += P.streakBonus;
        p.scraps += bonus; led.faucet += bonus; led.mission += bonus;
      } else {
        p.streak = 0;
        if (x < P.makeProb + P.keepProb) p.sheets++; else { p.scraps += sheet.dismantle; led.faucet += sheet.dismantle; }
      }
    }
    // sellers press a run when it pays
    for (const p of players) {
      if (p.designs < P.designsPerPack) continue;
      const q = quote(P.designsPerPack, packs.filter((k) => k.slots.length).length);
      if (q.income < q.cost * (1 + P.minMargin) || p.scraps < q.sheetsCost + P.prizeTags * P.tagCost) continue;
      p.designs -= P.designsPerPack; p.scraps -= q.sheetsCost + P.prizeTags * P.tagCost; led.sink += q.sheetsCost + P.prizeTags * P.tagCost;
      const slots = [];
      for (let d = 0; d < P.designsPerPack; d++) for (let e = 1; e <= P.editions; e++) { const id = nextSticker++; owner.set(id, 'pack'); slots.push({ kind: 'sticker', id }); led.minted++; }
      for (let k = 0; k < P.prizeMaterials; k++) slots.push({ kind: 'material', value: pickMaterial(r).dismantle });
      for (let k = 0; k < P.prizeTags; k++) slots.push({ kind: 'tag' });
      packs.push({ seller: p.i, slots, listedDay: day, soldOutDay: null, income: 0, cost: q.cost, relist: false, size: slots.length });
      led.listed++; if (packs.filter((x) => x.seller === p.i).length > 1) led.restocks++;
    }
    // collectors put some of what they pulled back on the market (the same numbered stickers move on)
    for (const p of players) {
      if (p.stickers < P.resellMin || r() > P.resellProb) continue;
      const mine = [...owner].filter(([, h]) => h === p.i).map(([id]) => id).slice(0, P.resellMin);
      if (mine.length < P.resellMin) continue;
      for (const id of mine) owner.set(id, 'pack'); p.stickers -= mine.length;
      packs.push({ seller: p.i, slots: mine.map((id) => ({ kind: 'sticker', id })), listedDay: day, soldOutDay: null, income: 0, cost: 0, relist: true, size: mine.length }); led.relists++;
    }
    // pulls
    let pullsToday = 0;
    for (const p of [...players].sort(() => r() - .5)) {
      for (let n = 0; n < P.maxPullsPerDay; n++) {
        if (p.scraps < P.price || r() > P.appetite) break;
        const open = packs.filter((k) => k.slots.length && k.seller !== p.i);
        if (!open.length) break;
        const pack = open[Math.floor(r() * open.length)], slot = pack.slots.splice(Math.floor(r() * pack.slots.length), 1)[0];
        p.scraps -= P.price; players[pack.seller].scraps += P.sellerShare * P.price; pack.income += P.sellerShare * P.price; led.sink += P.price * (1 - P.sellerShare);
        led.pulls++; pullsToday++;
        if (slot.kind === 'sticker') { owner.set(slot.id, p.i); p.stickers++; led.stickersPulled++; }
        else { const v = slot.kind === 'material' ? slot.value : P.tagDismantle; p.scraps += v; led.faucet += v; led[slot.kind === 'material' ? 'prizeMaterials' : 'prizeTags']++; }
        if (!pack.slots.length) pack.soldOutDay = day;
      }
    }
    demand = demand * .9 + pullsToday * .1;
    const total = players.reduce((s, p) => s + p.scraps, 0), openSlots = packs.reduce((s, k) => s + k.slots.length, 0);
    series.push({ day, scraps: total, openSlots, openPacks: packs.filter((k) => k.slots.length).length, pulls: pullsToday, listed: led.listed + led.relists });
  }

  const runs = packs.filter((k) => !k.relist), done = runs.filter((k) => k.soldOutDay), profit = runs.map((k) => k.income - k.cost);
  const sold = done.map((k) => k.soldOutDay - k.listedDay + 1), mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const week = (arr, i) => mean(arr.slice(Math.max(0, i - 7), i).map((s) => s.scraps));
  const liveDays = series.filter((s) => s.openSlots > 0).length, pullDays = series.filter((s) => s.pulls > 0).length;
  const first = week(series, 14) || 1, last = week(series, series.length);
  const holders = new Map(); for (const [, h] of owner) holders.set(h, (holders.get(h) || 0) + 1);
  const summary = {
    pulls: led.pulls, runs: runs.length, resales: led.relists, restocks: led.restocks, minted: led.minted,
    soldOut: done.length, soldOutShare: runs.length ? done.length / runs.length : 0, daysToSellOut: mean(sold),
    sellerNetPerRun: mean(profit), profitableShare: runs.length ? profit.filter((v) => v > 0).length / runs.length : 0,
    scrapsStart: 0, inflowPerPlayerDay: led.faucet / (P.players * P.days), missionShare: led.faucet ? led.mission / led.faucet : 0, scrapsEnd: series.at(-1).scraps, scrapsPerPlayer: series.at(-1).scraps / P.players,
    scrapsDrift: (last - first) / first,                       // how much the average pile grew between week 2 and the end (+ = it runs away)
    faucet: led.faucet, sink: led.sink, burnedPerPull: P.price * (1 - P.sellerShare),
    liveShare: liveDays / P.days, pullDaysShare: pullDays / P.days, openSlotsEnd: series.at(-1).openSlots,
    stickersHeld: players.reduce((t, p) => t + p.stickers, 0), stickersInPacks: packs.reduce((t, k) => t + k.slots.filter((x) => x.kind === 'sticker').length, 0), uniqueHolders: holders.size,
  };
  // the books must balance: Scraps now = Scraps at the start + what came in from the world - what was burned or spent
  summary.books = led.faucet - led.sink;   // the welcome Scraps are counted in faucet
  return { params: P, series, summary };
}

/** The same settings over several seeds, averaged (one run of a small group is noisy). */
export function average(over = {}, seeds = 12) {
  const runs = Array.from({ length: seeds }, (_, i) => simulate({ ...over, seed: (over.seed || 1) + i }));
  const keys = Object.keys(runs[0].summary), summary = {};
  for (const k of keys) summary[k] = runs.reduce((s, x) => s + x.summary[k], 0) / runs.length;
  const series = runs[0].series.map((_, i) => { const o = { day: i + 1 }; for (const k of ['scraps', 'openSlots', 'openPacks', 'pulls', 'listed']) o[k] = runs.reduce((s, x) => s + x.series[i][k], 0) / runs.length; return o; });
  return { params: { ...DEFAULTS, ...over }, series, summary };
}

/** Plain words about what the numbers say. */
export function advise(s, P) {
  const out = [];
  if (s.runs === 0) return [{ tone: 'bad', text: '誰も出品しません。見込みの収入が費用に届かないので、開けるものがなく、Scraps がたまる一方です。1回の値段か売り手の取り分を上げるか、費用（1枚増やす素材・景品）を下げてください。' }];
  if (s.sellerNetPerRun < 0) out.push({ tone: 'bad', text: `売り手はパックごとに平均 ${(-s.sellerNetPerRun).toFixed(1)} Scraps の損です。値段か取り分が、費用に対して低すぎます。` });
  else out.push({ tone: s.profitableShare > .75 ? 'good' : 'warn', text: `売り手はパックごとに平均 ${s.sellerNetPerRun.toFixed(1)} Scraps の儲けで、${(s.profitableShare * 100).toFixed(0)}% のパックが黒字でした。` });
  if (s.scrapsDrift > .6) out.push({ tone: 'bad', text: `Scraps が増えすぎます（1人の平均が期間中に ${(s.scrapsDrift * 100).toFixed(0)}% 増加）。1回ごとに消える分を増やす（売り手の取り分を下げる）か、景品や分解の値を下げてください。` });
  else if (s.scrapsDrift < -.3) out.push({ tone: 'warn', text: `Scraps が減っていきます（1人の平均が ${(-s.scrapsDrift * 100).toFixed(0)}% 減少）。開ける人が止まるので、値段を下げるか、消える分を減らしてください。` });
  else out.push({ tone: 'good', text: `Scraps は安定しています（1人の平均の変化 ${(s.scrapsDrift * 100).toFixed(0)}%）。` });
  if (s.liveShare < .7) out.push({ tone: 'warn', text: `開けられるものがあった日は ${(s.liveShare * 100).toFixed(0)}% だけです。出品の合間に棚が空になります。出品者を増やすか、早く元が取れる条件にするか、転売を増やしてください。` });
  if (s.soldOutShare < .5) out.push({ tone: 'warn', text: `${P.days}日で売り切れたパックは ${(s.soldOutShare * 100).toFixed(0)}% だけです。人が払える以上に棚に並んでいます。出品を減らす・小さくする、値段を下げる、Scraps が入る量を増やす、のいずれかが要ります。` });
  if (s.soldOut >= 1 && s.daysToSellOut < 3) out.push({ tone: 'warn', text: `売り切れまで平均 ${s.daysToSellOut.toFixed(1)} 日で、多くの人が見る前になくなります。1種あたりの枚数（版）を増やしてください。` });
  if (s.soldOut >= 1 && s.daysToSellOut > 25) out.push({ tone: 'warn', text: `売り切れまで平均 ${s.daysToSellOut.toFixed(0)} 日と遅すぎます。枚数を減らすか、値段を下げてください。` });
  if (s.resales === 0 && P.resellProb > 0) out.push({ tone: 'info', text: '転売は起きませんでした。集める枚数が足りなかったので、「転売に要る枚数」を下げて試してください。' });
  return out;
}

if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const num = (v) => (v === undefined ? undefined : Number(v)), over = {}; for (const k of Object.keys(DEFAULTS)) if (arg[k] !== undefined) over[k] = num(arg[k]);
  const fmt = (s) => ({ pulls: s.pulls.toFixed(0), runs: s.runs.toFixed(1), 'sold out': (s.soldOutShare * 100).toFixed(0) + '%', 'days/sellout': s.daysToSellOut.toFixed(1), 'seller net': s.sellerNetPerRun.toFixed(1), 'profit packs': (s.profitableShare * 100).toFixed(0) + '%', 'scraps/player': s.scrapsPerPlayer.toFixed(1), drift: (s.scrapsDrift * 100).toFixed(0) + '%', 'live days': (s.liveShare * 100).toFixed(0) + '%', resales: s.resales.toFixed(1) });
  if (arg.sweep) { const [key, list] = arg.sweep.split(':'); console.log(`sweep ${key}\n`); console.table(Object.fromEntries(list.split(',').map((v) => [`${key}=${v}`, fmt(average({ ...over, [key]: Number(v) }).summary)]))); }
  else { const res = average(over); console.table({ 'average of 12 seeds': fmt(res.summary) }); for (const a of advise(res.summary, res.params)) console.log(`${a.tone.toUpperCase().padEnd(5)} ${a.text}`); }
}
