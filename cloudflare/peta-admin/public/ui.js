export const $ = id => document.getElementById(id);
export const el = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
export function notice(message = "", error = false) { $("notice").textContent = message; $("notice").dataset.error = String(error); }
export async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Peta couldn't finish this action. Refresh to check its status.");
  return data;
}
export const date = seconds => seconds == null ? "Now" : new Date(seconds * 1000).toLocaleString();
export const itemsText = items => items.map(g => `${g.kind === "scraps" ? "Scraps" : g.kind === "envelope" ? "Extra envelopes" : g.id || g.kind} ×${g.count}`).join(" · ");
export async function copy(text) { await navigator.clipboard.writeText(text); notice("Copied. Ready to share."); }
export async function action(button, work) {
  button.disabled = true;
  try { await work(); } catch (error) { notice(error.message || "Something went wrong. Refresh and try again.", true); }
  finally { button.disabled = false; }
}
export function confirmAction(title, detail) {
  $("confirm-title").textContent = title; $("confirm-detail").textContent = detail;
  return new Promise(resolve => {
    const dialog = $("confirm");
    $("accept-confirm").onclick = () => { dialog.returnValue = "yes"; dialog.close(); };
    $("cancel-confirm").onclick = () => { dialog.returnValue = "no"; dialog.close(); };
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "yes"), { once: true });
    dialog.returnValue = "no"; dialog.showModal();
  });
}
