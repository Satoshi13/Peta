/* Rust is the source of truth. S contains only the last command snapshot and UI selections. */
const prefs = JSON.parse(localStorage.getItem('peta.preferences') || '{}');
const S = { shell: prefs.shell || 'studio', sound: prefs.sound ?? true, haptics: prefs.haptics ?? true, appearance: ['day','night','auto'].includes(prefs.appearance) ? prefs.appearance : 'day', bookView: prefs.bookView === 'calendar' ? 'calendar' : 'list', motion: prefs.motion || 'full', closeOutside: prefs.closeOutside ?? true,
  developer:false, envelopeDeadline: null, name: '', iconStickerId: null, today: new Date(), todayMat: 'matte', dayState: 'arrived', chosen: 'matte', stock: {}, lib: [], desk: [], gifts: [], events: [], packOffer:null, packs: [],
  bonusEnvelopes: 0, extraEnvelope: false, pending: null, stuckToday: [], packAvailable: false, scraps: {balance:0, materials:[], packs:[]}, page: 'settings', bookMonth: null, pickMode: false, windowOpen: true, owned: {}, followed: {} };
const Bridge = (() => {
  const api = window.__TAURI__;
  const invoke = (cmd, args) => api.core.invoke(cmd, args);
  const windowApi = api.window.getCurrentWindow();
  const assets = new Map();
  const savePreferences = () => {
    const p = { shell:S.shell, sound:S.sound, haptics:S.haptics, appearance:S.appearance, bookView:S.bookView, motion:S.motion, closeOutside:S.closeOutside };
    localStorage.setItem('peta.preferences', JSON.stringify(p));
    document.documentElement.dataset.motion = S.motion;
    Appearance.apply();
    Snd.on = S.sound; Haptic.on = S.haptics;
    if(S.motion==='reduce') document.getAnimations().forEach(a=>{if(a.effect?.getTiming().iterations===Infinity)a.cancel();});
    api.event.emit('preferences-changed', p);
  };
  async function reload() {
    const [profile, daily, materials, months, inbox, packs, pending, scraps, events, packOffer] = await Promise.all([
      invoke('profile_get'), invoke('daily_status'), invoke('material_book'), invoke('book_index'), invoke('gift_inbox'), invoke('pack_status'), invoke('print_pending'), invoke('scrap_status'), invoke('event_inbox'), invoke('creator_pack_pending')
    ]);
    S.developer = !!profile.developer; S.name = profile.displayName; S.iconStickerId = profile.iconStickerId; S.today = new Date(daily.date + 'T12:00:00'); S.bonusEnvelopes = daily.bonusEnvelopes || 0; S.extraEnvelope = daily.materialOpened && S.bonusEnvelopes > 0; S.dayState = daily.materialOpened && !S.extraEnvelope ? 'opened' : 'arrived';
    S.todayMat = daily.material?.id || 'matte'; S.packAvailable = packs.canOpen; S.pending = pending; S.scraps = scraps; S.events = events; S.packOffer = packOffer;
    for (const { material:m, unlocked } of materials) {
      if (!MAT[m.id]) continue;
      Object.assign(MAT[m.id], { name:m.name, rarity:m.rarity, locked:!unlocked, unlimited:m.unlimited, found:m.unlockedAt ? fmtDate(new Date(m.unlockedAt)) : '', });
      S.stock[m.id] = m.unlimited ? Infinity : m.count;
    }
    if (!(typeof CR !== 'undefined' && CR.editing) && !usableMats().includes(S.chosen)) S.chosen = usableMats()[0] || null;
    const pages = await Promise.all(months.map(m => invoke('book_page', {year:m.year, month:m.month})));
    S.lib = pages.flat().map(e => ({ id:e.stickerId, date:new Date(e.date+'T12:00:00'), createdAt:e.createdAt, no:e.originalNumber, material:e.materialId || 'matte', kind:(['gift','pack'].includes(e.sourceType) || (e.sourceType==='collection' && e.originalNumber==null)) ? 'received' : 'original', aspect:e.aspect, onDesktop:e.onDesktop, canManage:e.canManage, title:e.packName || 'Sticker' }));
    S.desk = S.lib.filter(e=>e.onDesktop).map(e=>({id:e.id}));
    S.stuckToday = S.lib.filter(e=>e.onDesktop && fmtDate(e.date)===fmtDate(S.today)).map(e=>e.id);
    S.gifts = inbox.map(g=>({id:g.giftId, from:g.from, note:g.note || '', opened:!!g.openedAt, material:g.materialId || 'matte', edition:g.edition, signatureStatus:g.signatureStatus, fingerprint:g.fingerprint}));
    S.owned = Object.fromEntries(packs.packs.map(p=>[p.id,true]));
    S.packs = packs.packs.map(p=>({id:p.id, title:p.title, by:p.by, total:p.total, left:Array(p.remaining).fill(null), daily:p.id==='welcome', signatureStatus:p.signatureStatus, fingerprint:p.fingerprint, kind:p.pouch || ({coffee:'kraft',plants:'kraft',cats:'matte'})[p.id] || 'holo', hue:({tokyo:200,pixel:120,night:245})[p.id] || 0})).sort((a,b)=>(({'welcome':0,'tokyo':1,'coffee':2})[a.id]??3)-(({'welcome':0,'tokyo':1,'coffee':2})[b.id]??3));
  }
  async function asset(id) {
    if (!assets.has(id)) assets.set(id, invoke('sticker_asset', {stickerId:id}).then(bytes => URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type:'image/png'}))));
    return assets.get(id);
  }
  function invalidateAsset(id) { const old = assets.get(id); assets.delete(id); for(const key of stickerResources.keys()) if(key.startsWith(id+":")) stickerResources.delete(key); old?.then(URL.revokeObjectURL).catch(()=>{}); }
  async function entry(id) {
    const back = await invoke('sticker_back', {stickerId:id});
    return { id, material:back.material?.id || 'matte', kind:back.kind, from:back.receivedFrom, no:back.originalNumber == null ? null : Number(back.originalNumber), edition:back.editionNumber == null ? null : Number(back.editionNumber), date:new Date(), back, title:'Sticker' };
  }
  async function changed() { try { await reload(); Shell.renderNav(); if (!Bridge.busy && !document.querySelector('.cer') && S.page !== 'create') Shell.refresh(); if(S.packOffer) Distribution.offer(S.packOffer); } catch(e) { Shell.toast(String(e)); } }
  function enterCeremony() {
    document.body.dataset.scene='ceremony';
    if(S.page==='today') Pages.today.suspend();
  }
  function leaveCeremony() {
    delete document.body.dataset.scene;
    if(Distribution.pendingOffer) Distribution.offer(Distribution.pendingOffer);
    if(S.page==='today') Pages.today.resume();
  }
  async function printAction(cmd, args) {
    // Print changes focus through the native desktop layer, rather than an outside click.
    Bridge.printFocusTransfer=true;
    try { return await invoke(cmd, args); }
    catch(e) { Bridge.printFocusTransfer=false; throw e; }
  }
  return { invoke, printAction, enterCeremony, leaveCeremony, window:windowApi, reload, asset, invalidateAsset, entry, savePreferences, changed, listen:api.event.listen };
})();
const stickerResources = new Map();
async function resOf(entry) {
  const key = entry.id + ":" + entry.material;
  if (!stickerResources.has(key)) stickerResources.set(key, (async () => {
    const url = await Bridge.asset(entry.id), i = await Stk.load(url);
    return { url, w:i.naturalWidth, h:i.naturalHeight, aspect:i.naturalWidth/i.naturalHeight, material:entry.material, mask:['holographic','gold'].includes(entry.material) ? url : null };
  })().catch(err => { stickerResources.delete(key); throw err; }));
  return stickerResources.get(key);
}
// Desktop rendering and placement belong to the existing layer windows.
const Desktop = { hideArrival() {}, async print(entry) { await Bridge.printAction("print_resume"); }, async later() { await Bridge.invoke('print_later'); }, };

const Appearance = (() => {
  const media = matchMedia('(prefers-color-scheme: dark)');
  let following = false;
  const update = () => { document.documentElement.dataset.theme = PetaMath.resolveTheme(S.appearance, media.matches); };
  const apply = () => {
    const auto = S.appearance === 'auto';
    if(auto !== following) {
      auto ? media.addEventListener('change', update) : media.removeEventListener('change', update);
      following = auto;
    }
    update();
  };
  return {apply};
})();
