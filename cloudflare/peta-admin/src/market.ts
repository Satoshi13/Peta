import { api, now, type Env } from "./index";
/* Friends' Market, counted only. No listing, seller, buyer, key hash or pack is ever named here, and the official
   shop is absent: its exchanges happen on each Mac and never reach the server. */
const DAY = 86400, DAYS = 30;
export async function market(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== "/api/market" || request.method !== "GET") return null;
  const today = Math.floor(now() / DAY) * DAY, from = today - (DAYS - 1) * DAY;
  const [listings, sales, days] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS open,COUNT(DISTINCT seller_hash) AS sellers FROM market_listings WHERE state='open'"),
    env.DB.prepare("SELECT COUNT(*) AS pulls,COALESCE(SUM(price),0) AS scraps,COALESCE(SUM(cut_milli),0) AS sellerMilli FROM market_sales"),
    env.DB.prepare("SELECT (at/86400)*86400 AS day,COUNT(*) AS pulls,COALESCE(SUM(price),0) AS scraps,COALESCE(SUM(cut_milli),0) AS sellerMilli FROM market_sales WHERE at>=? GROUP BY day ORDER BY day").bind(from),
  ]);
  const l = listings.results[0] as any, s = sales.results[0] as any, byDay = new Map((days.results as any[]).map(d => [d.day, d]));
  // Every day of the window is present, so quiet days read as zero rather than as a gap.
  const daily = Array.from({ length: DAYS }, (_, i) => {
    const day = from + i * DAY, d = byDay.get(day);
    return { day, pulls: Number(d?.pulls ?? 0), scraps: Number(d?.scraps ?? 0), sellerMilli: Number(d?.sellerMilli ?? 0) };
  });
  return api({ openListings: Number(l.open), sellers: Number(l.sellers), allTime: { pulls: Number(s.pulls), scraps: Number(s.scraps), sellerMilli: Number(s.sellerMilli) }, daily });
}
