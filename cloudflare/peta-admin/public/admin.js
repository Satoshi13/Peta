import {setupDaily,loadDaily} from "./daily.js";
import { setupReports, loadReports, showCount } from "./reports.js";
import { setupRelease, loadRelease } from "./release.js";
import { setupFriends, loadFriends } from "./friends.js";
import { $, api, notice } from "./ui.js";
import { setupCoupons, loadCoupons } from "./coupons.js";
const tabs = [...document.querySelectorAll('[role="tab"]')];
async function activate(tab) {
  for (const t of tabs) { const active = t === tab; t.setAttribute("aria-selected", String(active)); t.tabIndex = active ? 0 : -1; $(t.getAttribute("aria-controls")).hidden = !active; }
  try { if (tab.id === "tab-coupons") await loadCoupons();
    if (tab.id === "tab-friends") await loadFriends();
    if (tab.id === "tab-daily") await loadDaily();
    if (tab.id === "tab-reports") await loadReports();
    if (tab.id === "tab-release") await loadRelease(); } catch (error) { notice(error.message, true); }
}
for (const tab of tabs) {
  tab.onclick = () => activate(tab);
  tab.onkeydown = e => { const index = tabs.indexOf(tab); const next = e.key === "ArrowRight" ? tabs[(index + 1) % tabs.length] : e.key === "ArrowLeft" ? tabs[(index + tabs.length - 1) % tabs.length] : e.key === "Home" ? tabs[0] : e.key === "End" ? tabs.at(-1) : null; if (next) { e.preventDefault(); next.focus(); activate(next); } };
}
setupDaily(); setupReports(); setupCoupons(); setupFriends(); setupRelease();
try { const me = await api("/api/me"); $("account").textContent = `Signed in as ${me.email}`; await loadFriends(); } catch (error) { notice(error.message, true); }
try { showCount((await api("/api/reports")).open); } catch { /* The count appears when the Reports tab opens. */ }
