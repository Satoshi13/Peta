FocusMode.install();
import * as PetaMath from "../../ui-math.js";
window.PetaMath = PetaMath;
import * as BoardState from "../../boards-state.js";
window.BoardState = BoardState;

async function boot() {
  document.body.inert=true;
  const displayUnits = () => { document.documentElement.style.setProperty('--desktop-height',screen.height+'px'); document.documentElement.style.setProperty('--desktop-width',screen.width+'px'); };
  displayUnits(); window.addEventListener('resize',displayUnits);
  Shell.applyAssetVars(); Shell.initChrome(); Shell.setShell(S.shell); Bridge.savePreferences();
  document.body.inert=false; await Invite.ensure(); document.body.inert=true;   // private beta: before any page reads the library
  await Bridge.listen('app-page', async e => {
    if(e.payload==='redeem') {
      PackZoom.dispose(true);
      if(!Shell.current) await Shell.open('today');
      else { $('#win').hidden=false; S.windowOpen=true; Pages[S.page]?.resume?.(); }
      Distribution.redeem();
    } else if(e.payload==='boards-save'){document.querySelector('dialog')?.close();await Shell.open('boards');Pages.boards.traySave();}
    else await Shell.open(e.payload);
  });
  await Bridge.listen('distribution-result', async e => {await Bridge.reload(); Shell.refresh(); if(e.payload.pack) Distribution.offer(e.payload.pack);else Shell.toast(e.payload.result);});
  await Bridge.listen('referee-synced', Bridge.changed);
  await Bridge.listen('inbox-changed', Bridge.changed);
  await Bridge.listen('gifts-returned', async e => { const names=[...new Set(e.payload||[])]; if(!names.length) return; await Bridge.changed(); const one=e.payload.length===1; Shell.toast(`${one ? 'A gift' : 'Gifts'} to ${names.join(', ')} ${one ? "wasn't" : "weren't"} opened in 7 days, so ${one ? 'it' : 'they'} came back to your Collection.`); });
  await Bridge.listen('market-changed', () => { FriendShop.stale(); return Bridge.changed(); });
  await Bridge.listen('market-earned', e => { Shell.toast(`You earned ${e.payload} Scraps from friends' pulls.`); });
  await Bridge.listen('friend-link-pending', () => { Friends.openPendingLinks().catch(e => Shell.toast(Friends.error(e))); });
  await Bridge.listen('referee-sync-failed', Bridge.changed);
  await Bridge.listen('daily-changed', Bridge.changed);
  await Bridge.listen('placements-changed', Bridge.changed);
  const boardNotes=async()=>{const notes=await Bridge.invoke('boards_take_notes');if(notes.length)Scraps.note(notes.join(' · '));};
  await Bridge.listen('boards-changed', async()=>{await Bridge.changed();await boardNotes();});
  await Bridge.listen('boards-location-changed',async()=>{await Bridge.changed();window.dispatchEvent(new Event('boards-location-updated'));});
  await Bridge.listen('sticker-updated', e => { Bridge.invalidateAsset(e.payload); Bridge.changed(); });
  await Bridge.listen('profile-changed', e => { S.iconStickerId=e.payload.iconStickerId; Shell.renderNav(); if(['settings','market'].includes(S.page)) Shell.refresh(); });
  await Bridge.window.onFocusChanged(async e => {
    if(e.payload) { UpdateUI.check(false); Bridge.printFocusTransfer=false; if(await Bridge.window.isVisible() && !(await Bridge.window.isMinimized())) { S.windowOpen=true; Pages[S.page]?.resume?.(); Scraps.flushNote(); await boardNotes(); if(S.inbox?.enabled) Bridge.invoke('inbox_check',{manual:false}).catch(()=>{}); } return; }
    if(S.page!=="today" || !(await Bridge.window.isVisible()) || await Bridge.window.isMinimized()) Pages[S.page]?.suspend?.();
    if(Bridge.printFocusTransfer) { Bridge.printFocusTransfer=false; return; }
    if(S.closeOutside && !Shell.editing && !Bridge.dialogOpen && !document.querySelector('.cer')) Shell.close();
  });
  document.addEventListener("visibilitychange", () => { if(document.hidden) Pages[S.page]?.suspend?.(); else Pages[S.page]?.resume?.(); });
  const page=new URLSearchParams(location.search).get('page') || 'today';
  const finish = async () => {
    const welcome=await Bridge.invoke('scrap_welcome').catch(()=>null);   // once per library, before the first numbers are read
    await Shell.open(page==='redeem' ? 'today' : page==='boards-save' ? 'boards' : page);
    if(page==='boards-save') Pages.boards.traySave();
    await boardNotes();
    await Bridge.invoke("move_bootstrap_done").catch(()=>{});
    UpdateUI.init();
    if(S.page==="settings") Shell.refresh();
    if(welcome!=null) Scraps.note(`A welcome gift: ${welcome} Scraps.`); requestAnimationFrame(() => requestAnimationFrame(() => Vibrancy.sync()));if(page==='redeem') Distribution.redeem();if(S.packOffer)Distribution.offer(S.packOffer);
    Friends.linksReady = true;
    // what the other pages show is fetched while nothing else is happening, so opening them later shows it at once
    setTimeout(() => { Pages.book.warm?.(); for (const p of S.packs) if (PackArt.decorated(p)) PackArt.cover(p); }, 1500);
    await Friends.openPendingLinks();
  };
  try { await finish(); } catch(error) { Shell.error(error, {retry:finish}); }

}
boot().finally(()=>{document.body.inert=false;}).catch(error => { Shell.error(error, {retry:async()=>{await Shell.open(S.page);}}); });
