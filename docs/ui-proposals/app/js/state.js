/* The prototype's world. Everything is in memory; "Reset" rebuilds it. */
const MAT = {
  matte: { id: "matte", name: "Matte", rarity: "common", card: "cardMatte", sw: "swMatte", unlimited: true, recipe: "soft paper · white border", found: "Sep 1" },
  kraft: { id: "kraft", name: "Kraft", rarity: "uncommon", card: "cardKraft", sw: "swKraft", recipe: "kraft paper · fibre texture", found: "Sep 28" },
  holographic: { id: "holographic", name: "Holographic", rarity: "rare", card: "cardHolo", sw: "swHolo", recipe: "foil · rainbow reflection · glitter edge", found: "Oct 2" },
  gold: { id: "gold", name: "Gold Foil", rarity: "special", locked: true }, riso: { id: "riso", name: "Riso", rarity: "uncommon", locked: true },
  vintage: { id: "vintage", name: "Vintage", rarity: "archive", locked: true },
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
    shell: prev?.shell || "notebook", sound: prev?.sound ?? true, motion: prev?.motion || "full",
    name: prev?.name || "Satoshi",
    today: new Date(2026, 9, 3), dayState: "arrived", todayMat: "holographic", chosen: "holographic",
    stock: { matte: Infinity, kraft: 1, holographic: 0 },
    lib, nextNo: 13, desk: [{ id: "L12", x: 0.68, y: 0.5, rot: -5 }, { id: "L11", x: 0.2, y: 0.62, rot: 4 }],
    packs: [{ id: "welcome", title: "Welcome Pack", by: "Peta", total: 12, left: ["sBubble", "sComputer", "sScribble"], hue: 0 }],
    gifts: [
      { id: "G1", from: "Nao", note: "for your desk", src: "sCassette", material: "kraft", edition: 42, opened: false },
      { id: "G2", from: "Yuki", note: "", src: "sGoodDay", material: "matte", edition: 7, opened: false },
    ],
    pending: null, doneId: null, windowOpen: false, page: "today", pickMode: false, bookMonth: null,
  };
}
let S = freshState();
const titleOf = (e) => e.title || SAMPLE_TITLES[e.src] || "Sticker";
const dayLabel = () => fmtDate(S.today, { weekday: "short", month: "short", day: "numeric" });
const isDone = () => S.dayState === "done";
function rollMaterial() { const r = Math.random(); return r < .5 ? "matte" : r < .82 ? "kraft" : "holographic"; }
