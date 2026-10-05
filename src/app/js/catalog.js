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
  { id: "today", label: "Today", tab: "tab1", icon: "envBack" },
  { id: "create", group:"Make", label: "Create", tab: "tab3", icon: "chCreate" },
  { id: "book", group:"Collect", label: "Collection", tab: "tab2", icon: "chCollection" },
  { id: "packs", label: "Packs", tab: "tab5", icon: "chPack" },
  { id: "gifts", label: "Gifts", tab: "tab4", icon: "chGift" },
  { id: "materials", label: "Materials", tab: "tab6", icon: "cardHolo" },
  { id: "market", group:"Discover", label: "Market", tab: "tab3", icon: "shop" },
  { id: "settings", label: "Settings", tab: "tab6", icon: "gear" },
];
const RARITY_ORDER = ["common", "uncommon", "rare", "special", "archive"];

const PACK_KINDS = {
  holo: { key: "packHolo", cut: 21, xl: .115, xr: .875, foil: true }, kraft: { key: "packKraft", cut: 23.5, xl: .105, xr: .895, foil: false }, matte: { key: "packMatte", cut: 23.5, xl: .10, xr: .90, foil: false },
};
const packVar = (kind) => `var(--a-${(PACK_KINDS[kind] || PACK_KINDS.holo).key})`;

A.gear = A.iconSettings; A.shop = A.iconMarket;
// TODO(owner): the current Rust library has no sticker-title field; display its neutral label until that schema is decided.
const titleOf = e => e.title || "Sticker";
const dayLabel = () => fmtDate(S.today, { weekday:"short", month:"short", day:"numeric" });
const packsLeftToday = () => S.packAvailable ? 1 : 0;
const packOpenable = p => p.left.length > 0 && (!p.daily || S.packAvailable);
