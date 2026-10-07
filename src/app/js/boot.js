import * as PetaMath from "../../ui-math.js";
window.PetaMath = PetaMath;

async function boot() {
  const displayUnits = () => { document.documentElement.style.setProperty('--desktop-height',screen.height+'px'); document.documentElement.style.setProperty('--desktop-width',screen.width+'px'); };
  displayUnits(); window.addEventListener('resize',displayUnits);
  Shell.applyAssetVars(); Shell.initChrome(); Shell.setShell(S.shell); Bridge.savePreferences();
  await Bridge.listen('app-page', async e => { if(e.payload==='redeem') {await Shell.open('today');Distribution.redeem();} else await Shell.open(e.payload); });
  await Bridge.listen('distribution-result', async e => {await Bridge.reload(); Shell.refresh(); if(e.payload.pack) Distribution.offer(e.payload.pack);else Shell.toast(e.payload.result);});
  await Bridge.listen('daily-changed', Bridge.changed);
  await Bridge.listen('placements-changed', Bridge.changed);
  await Bridge.listen('sticker-updated', e => { Bridge.invalidateAsset(e.payload); Bridge.changed(); });
  await Bridge.listen('profile-changed', e => { S.iconStickerId=e.payload.iconStickerId; Shell.renderNav(); if(['settings','market'].includes(S.page)) Shell.refresh(); });
  await Bridge.window.onFocusChanged(async e => {
    if(e.payload) { Bridge.printFocusTransfer=false; if(await Bridge.window.isVisible() && !(await Bridge.window.isMinimized())) { S.windowOpen=true; Pages[S.page]?.resume?.(); } return; }
    if(S.page!=="today" || !(await Bridge.window.isVisible()) || await Bridge.window.isMinimized()) Pages[S.page]?.suspend?.();
    if(Bridge.printFocusTransfer) { Bridge.printFocusTransfer=false; return; }
    if(S.closeOutside && !Bridge.dialogOpen && !document.querySelector('.cer')) Shell.close();
  });
  document.addEventListener("visibilitychange", () => { if(document.hidden) Pages[S.page]?.suspend?.(); else Pages[S.page]?.resume?.(); });
  const page=new URLSearchParams(location.search).get('page') || 'today';
  await Shell.open(page==='redeem' ? 'today' : page); requestAnimationFrame(() => requestAnimationFrame(() => Vibrancy.sync()));if(page==='redeem') Distribution.redeem();if(S.packOffer)Distribution.offer(S.packOffer);
}
boot().catch(e => { console.error(e); document.getElementById('toast').textContent=String(e); document.getElementById('toast').classList.add('on'); });
