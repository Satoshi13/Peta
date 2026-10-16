import { fail } from "./validation";
import { signHeader } from "./bundle";
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
