async function boot() {
  const displayUnits = () => { document.documentElement.style.setProperty('--desktop-height',screen.height+'px'); document.documentElement.style.setProperty('--desktop-width',screen.width+'px'); };
  displayUnits(); window.addEventListener('resize',displayUnits);
  Shell.applyAssetVars(); Shell.initChrome(); Shell.setShell(S.shell); Bridge.savePreferences();
  for (const n of NAV) if (!Pages[n.id]) Pages[n.id] = { build:()=>h('div.page-in', PageHead(n.label, ''), h('p.muted', 'TODO(owner): Port slice pending.')) };
  await Bridge.listen('app-page', async e => { await Shell.open(e.payload); });
  await Bridge.listen('daily-changed', Bridge.changed);
  await Bridge.listen('placements-changed', Bridge.changed);
  await Bridge.window.onFocusChanged(e => { if(!e.payload && S.closeOutside && !Bridge.dialogOpen && !document.querySelector('.cer')) Shell.close(); });
  await Shell.open(new URLSearchParams(location.search).get('page') || 'today');
}
boot().catch(e => { console.error(e); document.getElementById('toast').textContent=String(e); document.getElementById('toast').classList.add('on'); });
