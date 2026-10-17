import { $, el, api, date, copy, action, confirmAction, notice } from "./ui.js";
let revision = null, downloadPage = "";
export async function loadFriends() {
  const data = await api("/api/friends"); revision = data.revision; downloadPage = data.downloadPage;
  $("friend-list").replaceChildren();
  if (!data.friends.length) $("friend-list").append(el("p", "まだ友だちはいません。招待するメールアドレスを追加してください。", "empty"));
  for (const f of data.friends) {
    const card = el("article", undefined, "card"), controls = el("div", undefined, "actions"), heading = el("div", undefined, "card-head"), toggle = el("button", f.invite.state === "stopped" ? "招待を再開" : "招待を一時停止", f.invite.state === "stopped" ? "subtle" : "danger"), remove = el("button", "友だちを削除", "danger");
    const states = { "not visited": "ダウンロードページをまだ開いていません", unused: "招待の準備完了 · Mac未接続", "in use": `Mac 接続済み · ${date(f.invite.since)}から`, stopped: "招待停止中 · Macは接続できません" };
    heading.append(el("h3", f.email, "friend-email")); if (f.owner) heading.append(el("span", "オーナー", "tag"));
    card.append(heading, el("p", states[f.invite.state], "invite-status"), el("p", f.download ? `最終ダウンロード：${f.download.version} · ${date(f.download.at)}` : "ダウンロードはまだありません", "hint"));
    toggle.type = remove.type = "button"; remove.disabled = f.owner;
    toggle.onclick = async () => {
      const resume = f.invite.state === "stopped";
      if (!await confirmAction(resume ? "この招待を再開しますか？" : "この招待を停止しますか？", resume ? "登録済みのMacが再び接続できるようになります。" : "そのMacはオンライン機能を利用できなくなり、ダウンロードも停止します。")) return;
      await action(toggle, async () => { await api(`/api/friends/${resume ? "resume" : "pause"}`, { email: f.email, revision }); notice(resume ? "招待を再開しました。" : "招待を停止しました。"); await loadFriends(); });
    };
    remove.onclick = async () => {
      if (!await confirmAction("この友だちを削除しますか？", `${f.email} はダウンロードページを開けなくなります。招待も停止され、Mac のオンライン機能が使えなくなります。`)) return;
      await action(remove, async () => { try { await api("/api/friends/remove", { email: f.email, revision, confirm: true }); notice("友だちを削除し、招待を停止しました。"); } catch (error) { try { await loadFriends(); } catch { /* Keep the original partial-change message. */ } throw error; } await loadFriends(); });
    };
    controls.append(toggle, remove); card.append(controls); $("friend-list").append(card);
  }
  $("add-friends").disabled = false;
}
export function setupFriends() {
  $("friend-form").onsubmit = event => {
    event.preventDefault();
    action($("add-friends"), async () => { await api("/api/friends/add", { emails: $("friend-emails").value, revision }); $("friend-emails").value = ""; $("friend-share").hidden = false; notice("友達を追加しました。招待文をコピーして個別に送ってください。"); await loadFriends(); });
  };
  $("copy-invite").onclick = () => action($("copy-invite"), async () => {
    const url = new URL(downloadPage); if (url.protocol !== "https:") throw new Error("ダウンロードページのアドレスが設定されていません。");
    await copy(`Peta へようこそ！\n${url.href}\n1. 伝えてくれたメールアドレスでログインしてください。\n2. メールに届く6桁の PIN を入力します。\n3. Peta をダウンロードし、アプリケーションに移します。\n4. Peta を開き、ページの招待コードを入力します。\n招待1つにつき Mac 1台を接続できます。`);
  });
  $("refresh-friends").onclick = () => action($("refresh-friends"), loadFriends);
}
