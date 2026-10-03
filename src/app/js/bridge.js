/* Rust is the source of truth. S contains only the last command snapshot and UI selections. */
const prefs = JSON.parse(localStorage.getItem('peta.preferences') || '{}');
const S = { shell: prefs.shell || 'studio', sound: prefs.sound ?? true, motion: prefs.motion || 'full', closeOutside: prefs.closeOutside ?? true,
  name: '', today: new Date(), todayMat: 'matte', dayState: 'arrived', chosen: 'matte', stock: {}, lib: [], desk: [], gifts: [], packs: [],
  pending: null, stuckToday: [], packAvailable: false, page: 'settings', bookMonth: null, pickMode: false, windowOpen: true, owned: {}, followed: {} };
const Bridge = (() => {
  const api = window.__TAURI__;
  const invoke = (cmd, args) => api.core.invoke(cmd, args);
  const windowApi = api.window.getCurrentWindow();
  const assets = new Map();
  const savePreferences = () => {
    const p = { shell:S.shell, sound:S.sound, motion:S.motion, closeOutside:S.closeOutside };
    localStorage.setItem('peta.preferences', JSON.stringify(p));
    document.documentElement.dataset.motion = S.motion;
    Snd.on = S.sound;
    api.event.emit('preferences-changed', p);
  };
  async function reload() {
    const [profile, daily, materials, months, inbox, packs, pending] = await Promise.all([
      invoke('profile_get'), invoke('daily_status'), invoke('material_book'), invoke('book_index'), invoke('gift_inbox'), invoke('pack_status'), invoke('print_pending')
    ]);
    S.name = profile.displayName; S.today = new Date(daily.date + 'T12:00:00'); S.dayState = daily.materialOpened ? 'opened' : 'arrived';
    S.todayMat = daily.material?.id || 'matte'; S.packAvailable = packs.canOpen; S.pending = pending;
    for (const { material:m, unlocked } of materials) {
      if (!MAT[m.id]) continue;
      Object.assign(MAT[m.id], { name:m.name, rarity:m.rarity, locked:!unlocked, unlimited:m.unlimited, found:m.unlockedAt ? fmtDate(new Date(m.unlockedAt)) : '', });
      S.stock[m.id] = m.unlimited ? Infinity : m.count;
    }
    if (!usableMats().includes(S.chosen)) S.chosen = usableMats()[0] || 'matte';
    const pages = await Promise.all(months.map(m => invoke('book_page', {year:m.year, month:m.month})));
    S.lib = pages.flat().map(e => ({ id:e.stickerId, date:new Date(e.date+'T12:00:00'), no:e.originalNumber, material:e.materialId || 'matte', kind:['gift','pack'].includes(e.sourceType) ? 'received' : 'original', aspect:e.aspect, onDesktop:e.onDesktop, title:'Sticker' }));
    S.desk = S.lib.filter(e=>e.onDesktop).map(e=>({id:e.id}));
    S.stuckToday = S.lib.filter(e=>e.onDesktop && fmtDate(e.date)===fmtDate(S.today)).map(e=>e.id);
    S.gifts = inbox.map(g=>({id:g.giftId, from:g.from, note:g.note || '', opened:!!g.openedAt, material:g.materialId || 'matte', edition:g.edition}));
    S.packs = packs.packs.map(p=>({id:p.id, title:p.title, by:p.by, total:p.total, left:Array(p.remaining).fill(null), daily:p.id==='welcome', kind:({coffee:'kraft',plants:'kraft',cats:'matte'})[p.id] || 'holo', hue:({tokyo:200,pixel:120,night:245})[p.id] || 0})).sort((a,b)=>(({'welcome':0,'tokyo':1,'coffee':2})[a.id]??3)-(({'welcome':0,'tokyo':1,'coffee':2})[b.id]??3));
  }
  async function asset(id) {
    if (!assets.has(id)) assets.set(id, invoke('sticker_asset', {stickerId:id}).then(bytes => URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type:'image/png'}))));
    return assets.get(id);
  }
  async function entry(id) {
    const back = await invoke('sticker_back', {stickerId:id});
    return { id, material:back.material?.id || 'matte', kind:back.kind, from:back.receivedFrom, no:Number(back.originalNumber), edition:Number(back.editionNumber), date:new Date(), back, title:'Sticker' };
  }
  async function changed() { try { await reload(); Shell.renderNav(); if (!Bridge.busy && !document.querySelector('.cer') && S.page !== 'create') Shell.refresh(); } catch(e) { Shell.toast(String(e)); } }
  let sceneWindow=null, sceneTask=Promise.resolve();
  function enterCeremony() {
    if(sceneWindow) return;
    const w=innerWidth,h=innerHeight,sw=screen.width,sh=screen.height;
    sceneWindow={w,h};
    const css=document.documentElement.style;
    css.setProperty('--scene-win-width',w+'px'); css.setProperty('--scene-win-height',h+'px');
    css.setProperty('--scene-win-x',((sw-w)/2)+'px'); css.setProperty('--scene-win-y',((sh-h-42)/2)+'px');
    document.body.dataset.scene='expanded';
    sceneTask=(async()=>{ const position=await windowApi.outerPosition(); if(sceneWindow) sceneWindow.position=position; await windowApi.setPosition(new api.dpi.LogicalPosition(0,0)); await windowApi.setSize(new api.dpi.LogicalSize(sw,sh)); })();
  }
  async function leaveCeremony() {
    await sceneTask;
    const prev=sceneWindow; if(!prev)return;
    await windowApi.setSize(new api.dpi.LogicalSize(prev.w,prev.h));
    if(prev.position) await windowApi.setPosition(prev.position);
    sceneWindow=null; delete document.body.dataset.scene;
  }
  return { invoke, enterCeremony, leaveCeremony, window:windowApi, reload, asset, entry, savePreferences, changed, listen:api.event.listen };
})();
async function resOf(entry) {
  const url = await Bridge.asset(entry.id), i = await Stk.load(url);
  return { url, w:i.naturalWidth, h:i.naturalHeight, aspect:i.naturalWidth/i.naturalHeight, material:entry.material, mask:['holographic','gold'].includes(entry.material) ? url : null };
}
// Desktop rendering and placement belong to the existing layer windows.
const Desktop = { hideArrival() {}, async print(entry) { await Shell.close(); await Bridge.invoke("print_resume"); }, async later() { await Bridge.invoke('print_later'); }, };
