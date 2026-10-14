import { $, el, api, date, copy, action, confirmAction, notice } from "./ui.js";
let revision = null, downloadPage = "";
export async function loadFriends() {
  const data = await api("/api/friends"); revision = data.revision; downloadPage = data.downloadPage;
  $("friend-list").replaceChildren();
  if (!data.friends.length) $("friend-list").append(el("p", "No friends yet. Add their email to invite them.", "empty"));
  for (const f of data.friends) {
    const card = el("article", undefined, "card"), controls = el("div", undefined, "actions"), heading = el("div", undefined, "card-head"), toggle = el("button", f.invite.state === "stopped" ? "Resume invite" : "Pause invite", f.invite.state === "stopped" ? "subtle" : "danger"), remove = el("button", "Remove friend", "danger");
    const states = { "not visited": "Hasn't opened the download page", unused: "Invite ready · Mac not connected", "in use": `Mac connected since ${date(f.invite.since)}`, stopped: "Invite stopped · Mac cannot connect" };
    heading.append(el("h3", f.email, "friend-email")); if (f.owner) heading.append(el("span", "owner", "tag"));
    card.append(heading, el("p", states[f.invite.state], "invite-status"), el("p", f.download ? `Last download: ${f.download.version} · ${date(f.download.at)}` : "No downloads yet", "hint"));
    toggle.type = remove.type = "button"; remove.disabled = f.owner;
    toggle.onclick = async () => {
      const resume = f.invite.state === "stopped";
      if (!await confirmAction(resume ? "Resume this invite?" : "Pause this invite?", resume ? "Their existing Mac can connect again." : "Their Mac will lose access to online features. Downloads will pause too.")) return;
      await action(toggle, async () => { await api(`/api/friends/${resume ? "resume" : "pause"}`, { email: f.email, revision }); notice(resume ? "Invite resumed." : "Invite stopped."); await loadFriends(); });
    };
    remove.onclick = async () => {
      if (!await confirmAction("Remove this friend?", `${f.email} will lose access to the download page. Their invite will also stop, so their Mac cannot connect to online features.`)) return;
      await action(remove, async () => { try { await api("/api/friends/remove", { email: f.email, revision, confirm: true }); notice("Friend removed and invite stopped."); } finally { await loadFriends(); } });
    };
    controls.append(toggle, remove); card.append(controls); $("friend-list").append(card);
  }
  $("add-friends").disabled = false;
}
export function setupFriends() {
  $("friend-form").onsubmit = event => {
    event.preventDefault();
    action($("add-friends"), async () => { await api("/api/friends/add", { emails: $("friend-emails").value, revision }); $("friend-emails").value = ""; $("friend-share").hidden = false; notice("Friends added. Copy the invitation to share it privately."); await loadFriends(); });
  };
  $("copy-invite").onclick = () => action($("copy-invite"), async () => {
    const url = new URL(downloadPage); if (url.protocol !== "https:") throw new Error("The download page address isn't configured.");
    await copy(`You're invited to Peta!\n${url.href}\n1. Sign in with the email you shared with me.\n2. Enter the six-digit PIN from your email.\n3. Download Peta and move it to Applications.\n4. Open Peta and enter the invite code shown on the page.\nEach invite connects one Mac.`);
  });
  $("refresh-friends").onclick = () => action($("refresh-friends"), loadFriends);
}
