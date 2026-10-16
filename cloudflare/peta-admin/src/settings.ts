import { fail } from "./validation";
import { signHeader } from "./bundle";
import vector from "../test/config-vector.json";
/* Owner settings signed with the coupon key. The app checks the same limits and ignores a setting outside them whole. */
export const NOTICE_KINDS = ["info", "event", "maintenance"] as const, NOTICE_LINKS = ["download", "discord"] as const;
export const NOTICE_MAX = 140, MAX_DAYS = 366;
export type Announcement = { id: string; issuedAt: string; startsAt: string; endsAt: string; kind: string; link: string | null; text: string };
const controls = /[\u0000-\u001f\u007f-\u009f]/;
export function checkAnnouncement(input: any): { kind: string; link: string | null; text: string } {
  const text = typeof input?.text === "string" ? input.text.trim() : "";
  if (!text || [...text].length > NOTICE_MAX || controls.test(text)) fail(400, "invalid", "Write up to 140 characters on one line.");
  if (!NOTICE_KINDS.includes(input.kind)) fail(400, "invalid", "Choose info, event or maintenance.");
  const link = input.link ?? null;
  if (link !== null && !NOTICE_LINKS.includes(link)) fail(400, "invalid", "Link to the download page or the Discord invite, or nothing.");
  return { kind: input.kind, link, text };
}
export function checkPeriod(start: unknown, end: unknown, t: number): [number, number] {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (start as number) < 0 || (end as number) <= (start as number) || (end as number) <= t || (end as number) - (start as number) > MAX_DAYS * 86400)
    fail(400, "invalid", "Choose an end after the start and after now, within a year.");
  return [start as number, end as number];
}
export function announcementHeader(a: Announcement, keyId: string) {
  const checked = checkAnnouncement(a);
  // serde_json::Value orders payload keys lexically; the Event header keeps Rust's field order.
  return { eventId: a.id, kind: "announcement", issuedAt: a.issuedAt, notBefore: a.startsAt, notAfter: a.endsAt, title: "Announcement", message: "",
    payload: { announcementId: a.id, kind: checked.kind, link: checked.link, text: checked.text }, signer: { kind: "official", keyId }, attachments: [] };
}
export const signAnnouncement = (a: Announcement, keyId: string, secret: string, publicKey: string) => signHeader(announcementHeader(a, keyId), keyId, secret, publicKey);
export const iso = (seconds: number) => new Date(seconds * 1000).toISOString().replace(".000Z", "Z");

/* The official shop. Packs and limits come from the contract the Rust tests check, so the form can't offer what the app refuses. */
export const shopCatalog = vector.shopCatalog;
export type ShopPack = { id: string; onSale: boolean; price: number | null; blurb: string | null };
export type ShopSetting = { featured: string[]; officialFirst: boolean; order: string[]; packs: ShopPack[] };
export type Shop = ShopSetting & { id: string; kind: "default" | "event"; issuedAt: string; startsAt: string; endsAt: string };
export function priceRange(id: string): [number, number] | null {
  const p = shopCatalog.packs.find(p => p.id === id);
  return p && !p.free ? [Math.ceil(p.price * shopCatalog.limits.minPercent / 100), Math.floor(p.price * shopCatalog.limits.maxPercent / 100)] : null;
}
export function checkShop(input: any): ShopSetting {
  const ids = (value: unknown) => {
    if (!Array.isArray(value) || value.length > shopCatalog.limits.maxPacks || new Set(value).size !== value.length || !value.every(id => shopCatalog.packs.some(p => p.id === id))) fail(400, "invalid", "Choose packs that come with Peta, each once.");
    return value as string[];
  };
  const featured = ids(input?.featured), order = ids(input?.order);
  if (typeof input?.officialFirst !== "boolean" || !Array.isArray(input?.packs)) fail(400, "invalid", "Check the form and try again.");
  ids(input.packs.map((p: any) => p?.id));
  const packs = input.packs.map((p: any): ShopPack => {
    if (typeof p.onSale !== "boolean") fail(400, "invalid", "Choose whether each pack is on sale.");
    const price = p.price ?? null, range = priceRange(p.id);
    if (price !== null && (!range || !Number.isSafeInteger(price) || price < range[0] || price > range[1])) fail(400, "invalid", range ? `Price ${p.id} between ${range[0]} and ${range[1]} Scraps.` : "Free packs can't be given a price.");
    const blurb = typeof p.blurb === "string" && p.blurb.trim() ? p.blurb.trim() : null;
    if (blurb !== null && ([...blurb].length > shopCatalog.limits.blurbMax || controls.test(blurb))) fail(400, "invalid", "Write each pack line in up to 120 characters on one line.");
    if (p.blurb !== undefined && p.blurb !== null && typeof p.blurb !== "string") fail(400, "invalid", "Check the form and try again.");
    return { id: p.id, onSale: p.onSale, price, blurb };
  });
  return { featured, officialFirst: input.officialFirst, order, packs };
}
export function shopHeader(s: Shop, keyId: string) {
  const c = checkShop(s);
  // Lexical payload keys, as serde_json::Value writes them, nested objects included.
  return { eventId: s.id, kind: "shop_config", issuedAt: s.issuedAt, notBefore: s.startsAt, notAfter: s.endsAt, title: "Shop", message: "",
    payload: { configId: s.id, configKind: s.kind, featured: c.featured, officialFirst: c.officialFirst, order: c.order, packs: c.packs.map(p => ({ blurb: p.blurb, id: p.id, onSale: p.onSale, price: p.price })) },
    signer: { kind: "official", keyId }, attachments: [] };
}
export const signShop = (s: Shop, keyId: string, secret: string, publicKey: string) => signHeader(shopHeader(s, keyId), keyId, secret, publicKey);
