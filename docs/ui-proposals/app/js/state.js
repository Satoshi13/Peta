/* The prototype's world. Everything is in memory; "Reset" rebuilds it. */
const MAT = {
  matte: { id: "matte", name: "Matte", rarity: "common", card: "cardMatte", sw: "swMatte", unlimited: true, recipe: "soft paper · white border", found: "Sep 1" },
  kraft: { id: "kraft", name: "Kraft", rarity: "uncommon", card: "cardKraft", sw: "swKraft", recipe: "kraft paper · fibre texture", found: "Sep 28" },
  holographic: { id: "holographic", name: "Holographic", rarity: "rare", card: "cardHolo", sw: "swHolo", recipe: "foil · rainbow reflection · glitter edge", found: "Oct 2" },
  gold: { id: "gold", name: "Gold Foil", rarity: "special", locked: true, recipe: "gold leaf · warm shimmer", price: "¥200" },
  riso: { id: "riso", name: "Riso", rarity: "uncommon", locked: true, recipe: "two-colour print · offset ink", price: "Free" },
  vintage: { id: "vintage", name: "Vintage", rarity: "archive", locked: true, recipe: "aged paper · speckle", price: "¥150" },
};
const SAMPLE_TITLES = {
  sCat: "Cat on a skateboard", sCoffee: "Latte", sBlueFlower: "Blue flower", sEgg: "Fried egg", sCamera: "Film camera", sPlant: "Monstera", sPolaroid: "Mountain polaroid",
  sGoodDay: "Good day", sCassette: "Cassette", sComputer: "Little computer", sScribble: "Purple scribble", sBubble: "Peta!",
};
const NAV = [
  { id: "today", label: "Today", tab: "tab1", icon: "envBack" },
  { id: "create", label: "Create", tab: "tab3", icon: "chCreate" },
  { id: "book", label: "Book", tab: "tab2", icon: "chCollection" },
  { id: "packs", label: "Packs", tab: "tab5", icon: "chPack" },
  { id: "gifts", label: "Gifts", tab: "tab4", icon: "chGift" },
  { id: "market", label: "Market", tab: "tab3", icon: "shop" },
  { id: "materials", label: "Materials", tab: "tab6", icon: "cardHolo" },
  { id: "settings", label: "Settings", tab: "tab6", icon: "gear" },
];
const RARITY_ORDER = ["common", "uncommon", "rare", "special", "archive"];

function freshState(prev) {
  const D = (m, d) => new Date(2026, m - 1, d);
  const lib = [
    { id: "L12", src: "sCat", date: D(10, 2), no: 12, material: "holographic", kind: "original" },
    { id: "L11", src: "sCoffee", date: D(10, 1), no: 11, material: "matte", kind: "original" },
    { id: "L10", src: "sBlueFlower", date: D(9, 28), no: 10, material: "kraft", kind: "original" },
    { id: "L09", src: "sEgg", date: D(9, 20), no: 9, material: "matte", kind: "original" },
    { id: "L08", src: "sCamera", date: D(9, 11), no: 8, material: "matte", kind: "original" },
    { id: "L07", src: "sPlant", date: D(8, 30), no: 7, material: "kraft", kind: "original" },
    { id: "L06", src: "sPolaroid", date: D(8, 14), no: 6, material: "holographic", kind: "original" },
    { id: "L05", src: "sGoodDay", date: D(8, 3), no: 5, material: "matte", kind: "original" },
  ];
  return {
    shell: prev?.shell || "studio", closeStyle: prev?.closeStyle || "stitch", sound: prev?.sound ?? true, motion: prev?.motion || "full",
    name: prev?.name || "Satoshi",
    today: new Date(2026, 9, 3), dayState: "arrived", todayMat: "holographic", chosen: "holographic",
    stock: { matte: Infinity, kraft: 1, holographic: 0 },
    lib, nextNo: 13, desk: [{ id: "L12", x: 0.68, y: 0.5, rot: -5 }, { id: "L11", x: 0.2, y: 0.62, rot: 4 }],
    packs: [{ id: "welcome", title: "Welcome Pack", by: "Peta", total: 12, left: ["sBubble", "sComputer", "sScribble"], hue: 0, kind: "holo", daily: true }],
    gifts: [
      { id: "G1", from: "Nao", note: "for your desk", src: "sCassette", material: "kraft", edition: 42, opened: false },
      { id: "G2", from: "Yuki", note: "", src: "sGoodDay", material: "matte", edition: 7, opened: false },
    ],
    pending: null, stuckToday: [], packsOpened: 0, followed: {}, owned: {}, hinted: false, closeOutside: prev?.closeOutside ?? true, windowOpen: false, page: "today", pickMode: false, bookMonth: null,
  };
}
let S = freshState();
const titleOf = (e) => e.title || SAMPLE_TITLES[e.src] || "Sticker";
const dayLabel = () => fmtDate(S.today, { weekday: "short", month: "short", day: "numeric" });
/* Rules (changed): one new material a day; stickers are limited only by the materials you hold (Matte never runs out).
   The Welcome Pack opens once a day; packs from the Market and Gifts open any time. */
const PACK_DAILY = 1;
const packsLeftToday = () => Math.max(0, PACK_DAILY - S.packsOpened);
/** Welcome Pack: once a day. Packs you got from the Market: any time, as often as you like, until they are empty. */
const packOpenable = (p) => p.left.length > 0 && (!p.daily || packsLeftToday() > 0);
function rollMaterial() { const r = Math.random(); return r < .5 ? "matte" : r < .82 ? "kraft" : "holographic"; }

/* two small inline icons that have no file in src/art yet */
const svgURI = (svg) => "data:image/svg+xml;utf8," + encodeURIComponent(svg);
A.gear = A.iconSettings;
A.shop = A.iconMarket;

/* Pack art per kind. cut = where the tear line is (% of height); xl / xr = the pack's left / right edge (fraction of width). */
const PACK_KINDS = {
  holo: { key: "packHolo", cut: 21, xl: .115, xr: .875, foil: true }, kraft: { key: "packKraft", cut: 23.5, xl: .105, xr: .895, foil: false }, matte: { key: "packMatte", cut: 23.5, xl: .10, xr: .90, foil: false },
};
const packVar = (kind) => `var(--a-${(PACK_KINDS[kind] || PACK_KINDS.holo).key})`;
