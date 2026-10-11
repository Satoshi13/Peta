/* Native material labels. Recipes and stock come from Rust. */
const MAT = {
  matte: { id: "matte", name: "Matte", rarity: "common", card: "cardMatte", sw: "swMatte", unlimited: false, recipe: "soft paper · white border", found: "Sep 1" },
  kraft: { id: "kraft", name: "Kraft", rarity: "uncommon", card: "cardKraft", sw: "swKraft", recipe: "kraft paper · fibre texture", found: "Sep 28" },
  holographic: { id: "holographic", name: "Holographic", rarity: "rare", card: "cardHolo", sw: "swHolo", recipe: "foil · rainbow reflection · glitter edge", found: "Oct 2" },
  gold: { id: "gold", name: "Gold Foil", rarity: "special", card: "cardGold", locked: true, recipe: "gold leaf · warm shimmer" },
  riso: { id: "riso", name: "Riso", rarity: "uncommon", card: "cardRiso", locked: true, recipe: "two-colour print · offset ink" },
  vintage: { id: "vintage", name: "Vintage", rarity: "archive", card: "cardVintage", locked: true, recipe: "aged paper · speckle" },
  clear: { id: "clear", name: "Clear", rarity: "rare", locked: true, recipe: "frosted film · white ink" },
  pixel: { id: "pixel", name: "Pixel", rarity: "uncommon", locked: true, recipe: "pastel paper · pixel print" },
  washi: { id: "washi", name: "Washi", rarity: "uncommon", locked: true, recipe: "plant fibres · soft ink" },
  sakura: { id: "sakura", name: "Sakura", rarity: "archive", locked: true, recipe: "pink paper · pressed petals" },
};
const SAMPLE_TITLES = {
  sCat: "Cat on a skateboard", sCoffee: "Latte", sBlueFlower: "Blue flower", sEgg: "Fried egg", sCamera: "Film camera", sPlant: "Monstera", sPolaroid: "Mountain polaroid",
  sGoodDay: "Good day", sCassette: "Cassette", sComputer: "Little computer", sScribble: "Purple scribble", sBubble: "Peta!",
};
const NAV = [
  { id: "today", key: 1, label: "Today", tab: "tab1", icon: "envBack" },
  { id: "create", key: 2, group:"Make", label: "Create", tab: "tab3", icon: "chCreate" },
  { id: "studio", label: "Studio", tab: "tab5", icon: "bagGlassine" },
  { id: "book", key: 3, group:"Collect", label: "Collection", tab: "tab2", icon: "chCollection" },
  { id: "packs", key: 4, label: "Packs", tab: "tab5", icon: "chPack" },
  { id: "gifts", key: 5, label: "Gifts", tab: "tab4", icon: "chGift" },
  { id: "materials", key: 6, label: "Materials", tab: "tab6", icon: "cardHolo" },
  { id: "market", key: 7, group:"Discover", label: "Market", tab: "tab3", icon: "shop" },
  { id: "settings", label: "Settings", tab: "tab6", icon: "gear" },
];
const RARITY_ORDER = ["common", "uncommon", "rare", "special", "archive"];

const PACK_KINDS = {
  holo: { key: "packHolo", cut: 21, xl: .115, xr: .875, foil: true }, kraft: { key: "packKraft", cut: 23.5, xl: .105, xr: .895, foil: false }, matte: { key: "packMatte", cut: 23.5, xl: .10, xr: .90, foil: false },
};
/* Wrappings (Studio). A pack or a gift is dressed by ID: nothing here is chosen freely, every position is fixed per wrapping.
   cm      width of the object in centimetres: every wrapping is drawn at one scale
   body    the object's box inside its picture, % (alpha > 128): x0 y0 x1 y1
   lbl     where the paper label sits, % of the picture: left top right bottom
   cover   [x, y, size, tilt]   a cover sticker (x/y/size are % of the picture)
   clip / pin / tape   where each decoration goes on this wrapping's own edge or fold: [x, y, size, tilt] / [x, y, size] / [x, y, width, height, tilt]
   peek    where the stickers inside show: through the paper (alpha), out of a notch or pocket (cut), in an open drawer, or out of the mouth
   seal    how it is closed:  tape, seal, sweep, string, slide, press
   show    how a shop shows it: hang from the rail, or stand on a board */
const BAGS = {
  kraft: { id: "kraft", name: "Kraft", classic: true, art: "packKraft", W: 3, H: 4, cm: 10, show: "hang", seal: "tape", body: [4, 5, 96, 97], lbl: [21, 39, 79, 65.5], cover: [72, 80, 30, 8], clip: [76, 6, 9, 16], pin: [50, 6, 7], tape: [12, 5.5, 76, 8, -1.5] },
  matte: { id: "matte", name: "Matte", classic: true, art: "packMatte", W: 3, H: 4, cm: 10, show: "hang", seal: "tape", body: [4, 5, 96, 97], lbl: [20, 47.8, 80.5, 72], cover: [72, 80, 30, 8], clip: [76, 6, 9, 16], pin: [50, 6, 7], tape: [12, 5.5, 76, 8, -1.5] },
  holo: { id: "holo", name: "Holographic", classic: true, art: "packHolo", W: 3, H: 4, cm: 10, show: "hang", seal: "press", body: [4, 5, 96, 97], lbl: [22.5, 38, 77.2, 62.6], cover: [72, 80, 30, 8], clip: [76, 6, 9, 16], pin: [50, 6, 7], tape: [12, 5.5, 76, 8, -1.5] },
  glassine: { id: "glassine", name: "Glassine", art: "bagGlassine", W: 1254, H: 1254, cm: 9, show: "hang", seal: "seal", disc: "#8fb0d6", see: 1, gloss: .55, body: [182, 147, 1098, 1214], lbl: [27, 67, 76, 88], hasLabel: 1, rot: -1,
    cover: [50, 26, 15, 0], clip: [72, 13, 8, 14], pin: [50, 25, 6.5], tape: [30, 11, 40, 4.5, -1], peek: { box: [26, 44, 50, 24], front: 1, alpha: .8, sz: 40 } },
  photo: { id: "photo", name: "Photo envelope", art: "bagPhoto", W: 1254, H: 1254, cm: 12, show: "stand", lean: -3, seal: "sweep", gloss: .12, body: [166, 220, 1093, 1140], lbl: [30, 56, 70, 80], hasLabel: 0, rot: 0,
    cover: [76, 74, 21, 6], clip: [73, 18, 8, 12], pin: [28, 22, 6], tape: [26, 15, 48, 4, -1], peek: { box: [37, 14, 26, 24], front: 1, cut: 1, sz: 82, spread: 70, sink: -12 } },
  "kraft-parcel": { id: "kraft-parcel", name: "Kraft parcel", art: "bagKraftParcel", W: 1254, H: 1254, cm: 11, show: "stand", seal: "tape", gloss: .1, body: [129, 169, 1132, 1146], lbl: [29, 41, 82, 59], hasLabel: 1, rot: 0,
    cover: [70, 70, 27, -4], clip: [80, 15, 8, 16], pin: [22, 20, 6.5], tape: [36, 12, 28, 4.5, -2] },
  pocket: { id: "pocket", name: "Library pocket", art: "bagPocket", W: 1254, H: 1254, cm: 12, show: "stand", seal: "tape", gloss: .1, body: [172, 125, 1113, 1167], lbl: [27, 58, 76, 83], hasLabel: 1, rot: 0,
    cover: [73, 80, 18, 5], clip: [28, 13, 8, 10], pin: [66, 16, 6], tape: [24, 39, 24, 4, -6], peek: { box: [26, 14, 48, 28], front: 1, cut: 1, sz: 40 } },
  airmail: { id: "airmail", name: "Airmail", art: "bagAirmail", W: 1536, H: 1024, cm: 16.5, show: "stand", lean: -4, seal: "sweep", gloss: .15, body: [95, 168, 1438, 876], lbl: [26, 39, 76, 64], hasLabel: 1, rot: 0,
    cover: [80, 66, 17, 6], clip: [72, 17, 7, 14], pin: [50, 18, 5], tape: [32, 15, 36, 6, -2] },
  wrap: { id: "wrap", name: "Folded wrap", art: "bagWrap", W: 1254, H: 1254, cm: 11, show: "stand", seal: "seal", disc: "#b9443b", see: 1, gloss: .45, body: [92, 131, 1174, 1157], lbl: [48, 63, 87, 78], hasLabel: 1, rot: 0,
    cover: [53, 54, 18, -6], clip: [82, 12, 8, 16], pin: [22, 16, 6.5], tape: [28, 11, 40, 4, -1], peek: { box: [24, 22, 52, 26], front: 1, alpha: .8, sz: 40 } },
  drawer: { id: "drawer", name: "Drawer box", art: "bagDrawer", W: 1536, H: 1024, cm: 10.5, show: "stand", seal: "slide", gloss: .12, body: [117, 204, 1456, 922], lbl: [16, 40, 56, 66], hasLabel: 0, rot: 0,
    cover: [56, 75, 18, -4], clip: [44, 21, 6, 14], pin: [20, 24, 4.5], tape: [14, 20, 32, 5, -1], peek: { box: [66, 30, 22, 42], front: 1, sz: 70, spread: 50 } },
  cotton: { id: "cotton", name: "Cotton pouch", art: "bagCotton", W: 1254, H: 1254, cm: 11, show: "hang", seal: "string", body: [70, 132, 1233, 1126], lbl: [32, 66, 68, 82], hasLabel: 0, rot: 0,
    cover: [50, 48, 28, 0], clip: [68, 14, 8, 16], pin: [50, 21, 6], tape: [34, 11, 32, 4.5, -2], peek: { box: [34, 2, 32, 16], sz: 50 } },
};
for (const b of Object.values(BAGS)) if (!b.classic) { b.gen = true; b.body = [b.body[0] / b.W * 100, b.body[1] / b.H * 100, b.body[2] / b.W * 100, b.body[3] / b.H * 100]; }
const PACK_BAG_IDS = ["kraft", "matte", "holo", "glassine", "kraft-parcel", "pocket", "drawer", "cotton"], GIFT_BAG_IDS = ["airmail", "photo", "kraft-parcel", "wrap", "cotton", "glassine"];
/* the classic pouches the opening ceremony can tear; every other wrapping opens by being lifted open instead */
const isPouch = (id) => id === "kraft" || id === "matte" || id === "holo";
const packVar = (kind) => `var(--a-${(PACK_KINDS[kind] || PACK_KINDS.holo).key})`;

A.gear = A.iconSettings; A.shop = A.iconMarket;
// TODO(owner): the current Rust library has no sticker-title field; display its neutral label until that schema is decided.
const titleOf = e => e.title || "Sticker";
const dayLabel = () => fmtDate(S.today, { weekday:"short", month:"short", day:"numeric" });
/* Mirrors MAX_SEALED_PER_PACK in scraps.rs: one bag never holds more sealed stickers than this. */
const PACK_SEALED_CAP = 100;
const packsLeftToday = () => S.packAvailable ? 1 : 0;
const packOpenable = p => !p.own && p.signatureStatus !== "mine" && p.left.length > 0 && (!p.daily || S.packAvailable);
const packHasFreeOpening = p => !p.own && p.signatureStatus !== "mine" && (p.freeOpenings || 0) > 0;
