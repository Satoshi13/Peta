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
  if (!text || [...text].length > NOTICE_MAX || controls.test(text)) fail(400, "invalid", "お知らせは改行せず140文字以内で入力してください。");
  if (!NOTICE_KINDS.includes(input.kind)) fail(400, "invalid", "情報・イベント・メンテナンスから選んでください。");
  const link = input.link ?? null;
  if (link !== null && !NOTICE_LINKS.includes(link)) fail(400, "invalid", "リンクはダウンロードページ・Discord の招待・なしから選んでください。");
  return { kind: input.kind, link, text };
}
export function checkPeriod(start: unknown, end: unknown, t: number): [number, number] {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (start as number) < 0 || (end as number) <= (start as number) || (end as number) <= t || (end as number) - (start as number) > MAX_DAYS * 86400)
    fail(400, "invalid", "終了日時は開始と現在より後で、1年以内にしてください。");
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
export type CatalogPack = { id: string; title: string; price: number; free: boolean; shop?: boolean };
export type Catalog = { limits: typeof vector.shopCatalog.limits; shopPackPrefix: string; shopPackPrice: { min: number; max: number }; packs: CatalogPack[] };
export const shopCatalog: Catalog = vector.shopCatalog;
/** The built-in packs plus signed official shop packs (`shop:<packId>`), which the app learns from their files. */
export const withShopPacks = (extra: CatalogPack[]): Catalog => ({ ...shopCatalog, packs: [...shopCatalog.packs, ...extra] });
export type ShopPack = { id: string; onSale: boolean; price: number | null; blurb: string | null };
export type ShopSetting = { featured: string[]; officialFirst: boolean; order: string[]; packs: ShopPack[] };
export type Shop = ShopSetting & { id: string; kind: "default" | "event"; issuedAt: string; startsAt: string; endsAt: string };
export function priceRange(id: string, catalog: Catalog = shopCatalog): [number, number] | null {
  const p = catalog.packs.find(p => p.id === id);
  return p && !p.free ? [Math.ceil(p.price * catalog.limits.minPercent / 100), Math.floor(p.price * catalog.limits.maxPercent / 100)] : null;
}
export function checkShop(input: any, catalog: Catalog = shopCatalog): ShopSetting {
  const ids = (value: unknown) => {
    if (!Array.isArray(value) || value.length > catalog.limits.maxPacks || new Set(value).size !== value.length || !value.every(id => catalog.packs.some(p => p.id === id))) fail(400, "invalid", "公式パックを重複せず選んでください。");
    return value as string[];
  };
  const featured = ids(input?.featured), order = ids(input?.order);
  if (featured.length > catalog.limits.maxFeatured) fail(400, "invalid", `Featured は${catalog.limits.maxFeatured}個まで選べます。`);
  if (typeof input?.officialFirst !== "boolean" || !Array.isArray(input?.packs)) fail(400, "invalid", "入力内容を確認して、もう一度試してください。");
  ids(input.packs.map((p: any) => p?.id));
  const packs = input.packs.map((p: any): ShopPack => {
    if (typeof p.onSale !== "boolean") fail(400, "invalid", "各パックをショップに並べるか選んでください。");
    const price = p.price ?? null, range = priceRange(p.id, catalog);
    if (price !== null && (!range || !Number.isSafeInteger(price) || price < range[0] || price > range[1])) fail(400, "invalid", range ? `${p.id} の価格は${range[0]}〜${range[1]} Scraps にしてください。` : "無料パックに価格は付けられません。");
    const blurb = typeof p.blurb === "string" && p.blurb.trim() ? p.blurb.trim() : null;
    if (blurb !== null && ([...blurb].length > shopCatalog.limits.blurbMax || controls.test(blurb))) fail(400, "invalid", "各パックの説明は改行せず120文字以内で入力してください。");
    if (p.blurb !== undefined && p.blurb !== null && typeof p.blurb !== "string") fail(400, "invalid", "入力内容を確認して、もう一度試してください。");
    return { id: p.id, onSale: p.onSale, price, blurb };
  });
  return { featured, officialFirst: input.officialFirst, order, packs };
}
export function shopHeader(s: Shop, keyId: string, catalog: Catalog = shopCatalog) {
  const c = checkShop(s, catalog);
  // Lexical payload keys, as serde_json::Value writes them, nested objects included.
  return { eventId: s.id, kind: "shop_config", issuedAt: s.issuedAt, notBefore: s.startsAt, notAfter: s.endsAt, title: "Shop", message: "",
    payload: { configId: s.id, configKind: s.kind, featured: c.featured, officialFirst: c.officialFirst, order: c.order, packs: c.packs.map(p => ({ blurb: p.blurb, id: p.id, onSale: p.onSale, price: p.price })) },
    signer: { kind: "official", keyId }, attachments: [] };
}
export const signShop = (s: Shop, keyId: string, secret: string, publicKey: string, catalog: Catalog = shopCatalog) => signHeader(shopHeader(s, keyId, catalog), keyId, secret, publicKey);
