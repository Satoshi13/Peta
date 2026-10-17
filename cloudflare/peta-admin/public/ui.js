export const $ = id => document.getElementById(id);
export const el = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
export function notice(message = "", error = false) { $("notice").textContent = message; $("notice").dataset.error = String(error); }
export async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Petaはこの操作を完了できませんでした。更新して状態を確認してください。");
  return data;
}
export const date = seconds => seconds == null ? "今すぐ" : new Date(seconds * 1000).toLocaleString("ja-JP", {timeZone:"Asia/Tokyo"});
export const itemsText = items => items.map(g => `${g.kind === "scraps" ? "Scraps" : g.kind === "envelope" ? "追加の封筒" : materialName(g.id) || ({tool:"ツール",pack:"パック"})[g.kind] || g.kind} ×${g.count}`).join(" · ");
export async function copy(text) { await navigator.clipboard.writeText(text); notice("コピーしました。"); }
export async function action(button, work) {
  button.disabled = true;
  try { await work(); } catch (error) { notice(error.message || "問題が発生しました。更新してもう一度試してください。", true); }
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

export const state = value => ({active:"適用中",live:"公開中",scheduled:"予定",stopped:"停止済み",ended:"終了",signed:"署名済み",removed:"整理済み",draft:"下書き",ready:"署名待ち","used up":"上限に到達","not yet":"開始前","on sale":"掲載中",open:"受付中",resolved:"解決済み"})[value] || value;
export const rarity = value => ({common:"通常",uncommon:"ときどき",rare:"レア",special:"特別",archive:"アーカイブ"})[value] || value;
export const materialName = value => ({matte:"マット",kraft:"クラフト",holographic:"ホログラム",gold:"金箔",riso:"リソグラフ",vintage:"ヴィンテージ",clear:"透明",pixel:"ピクセル",washi:"和紙",sakura:"さくら"})[value] || value;
