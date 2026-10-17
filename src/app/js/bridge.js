/* Rust is the source of truth. S contains only the last command snapshot and UI selections. */
const prefs = readPreferences();
const S = { shell: prefs.shell || 'studio', sound: prefs.sound ?? true, haptics: prefs.haptics ?? true, appearance: ['day','night','auto'].includes(prefs.appearance) ? prefs.appearance : 'day', bookView: prefs.bookView === 'calendar' ? 'calendar' : 'list', motion: prefs.motion || 'full', closeOutside: prefs.closeOutside ?? false,
  developer:false, envelopeDeadline: null, name: '', iconStickerId: null, today: new Date(), todayMat: 'matte', dayState: 'arrived', chosen: 'matte', stock: {}, lib: [], desk: [], gifts: [], events: [], packOffer:null, packs: [],
  bonusEnvelopes: 0, extraEnvelope: false, pending: null, stuckToday: [], packAvailable: false, scraps: {balance:0, materials:[], packs:[]}, page: 'settings', bookMonth: null, pickMode: false, windowOpen: true, owned: {}, followed: {} };
const Bridge = (() => {
  const api = window.__TAURI__;
  const sharing = new Set(['gift_send', 'gift_send_friend', 'creator_pack_save', 'creator_pack_shelve', 'friend_code_copied', 'friend_add', 'friend_approve']);
  const invoke = async (cmd, args) => {
    if(sharing.has(cmd) && !S.name.trim() && !await ProfileName.request()) {
      const error=new Error("Sharing cancelled.");error.name="AbortError";error.handled=true;throw error;
    }
    return api.core.invoke(cmd, args);
  };
  const windowApi = api.window.getCurrentWindow();
  const assets = new Map();
  async function fileDialog(cmd,args) {
    const previous=!!Bridge.dialogOpen;Bridge.dialogOpen=true;
    try { return await invoke(cmd,args); }
    finally { Bridge.dialogOpen=previous || !!document.querySelector('dialog[open]'); }
  }
  const savePreferences = () => {
    const p = { shell:S.shell, sound:S.sound, haptics:S.haptics, appearance:S.appearance, bookView:S.bookView, motion:S.motion, closeOutside:S.closeOutside };
    try { localStorage.setItem('peta.preferences', JSON.stringify(p)); } catch {}
    document.documentElement.dataset.motion = S.motion;
    Appearance.apply();
    Snd.on = S.sound; Haptic.on = S.haptics;
    if(S.motion==='reduce') document.getAnimations().forEach(a=>{if(a.effect?.getTiming().iterations===Infinity)a.cancel();});
    api.event.emit('preferences-changed', p);
  };
  let reloadFlight = null, reloadAgain = false, changeFlight = null, lastChanges = new Set(), revision = 0;
  function reload() {
    if (reloadFlight) { reloadAgain = true; return reloadFlight; }
    reloadFlight = (async () => {
      const changed = new Set();
      do {
        reloadAgain = false;
        try { const commit = await loadSnapshot(); if (reloadAgain) continue; commit(); } catch (cause) {
          if (reloadAgain) continue;
          const error = new Error("Peta could not load the latest changes.", {cause});
          error.name = "PetaLoadError"; throw error;
        }
        for (const key of lastChanges) changed.add(key);
      } while (reloadAgain);
      lastChanges = changed;
    })().finally(()=>{ reloadFlight = null; });
    return reloadFlight;
  }
  async function loadSnapshot() {
    const [profile, daily, materials, months, inbox, packs, pending, scraps, events, packOffer, linkTags, boards] = await Promise.all([
      invoke('profile_get'), invoke('daily_status'), invoke('material_book'), invoke('book_index'), invoke('gift_inbox'), invoke('pack_status'), invoke('print_pending'), invoke('scrap_status'), invoke('event_inbox'), invoke('creator_pack_pending')
    , invoke('link_tag_status'), invoke('boards_status')]);
    const pages = await Promise.all(months.map(m => invoke('book_page', {year:m.year, month:m.month})));
    const next = {stock:{}, prizeStock:{}}, materialUpdates = [];
    next.boards=boards;
    next.inbox = await invoke('inbox_status').catch(() => S.inbox || ({ enabled:false, friends:[] }));   // friends and the Gift inbox (S2); local state only
    next.developer = !!profile.developer; next.name = profile.displayName; next.iconStickerId = profile.iconStickerId; next.today = new Date(daily.date + 'T12:00:00'); next.bonusEnvelopes = daily.bonusEnvelopes || 0; next.extraEnvelope = daily.materialOpened && next.bonusEnvelopes > 0; next.dayState = daily.materialOpened && !next.extraEnvelope ? 'opened' : 'arrived';
    next.linkTags = new Map(linkTags.tags.map(t => [t.stickerId, t])); next.tagStock = linkTags.stock; next.todayMat = daily.material?.id || 'matte'; next.packAvailable = packs.canOpen; next.packLimits=packs.limits; next.prizeStock={}; next.pending = pending; next.scraps = scraps; next.events = events; next.packOffer = packOffer;
    for (const { material:m, unlocked } of materials) {
      if (!MAT[m.id]) continue;
      materialUpdates.push([MAT[m.id], { name:m.name, rarity:m.rarity, locked:!unlocked, unlimited:m.unlimited, found:m.unlockedAt ? fmtDate(new Date(m.unlockedAt)) : '', }]);
      next.stock[m.id] = m.unlimited ? Infinity : m.count; next.prizeStock[m.id]=m.count;
    }
    const available = materials.filter(({material:m, unlocked}) => MAT[m.id] && unlocked && (m.unlimited || m.count > 0)).map(({material:m}) => m.id);
    next.materialState = materials.map(({material:m, unlocked})=>[m.id,m.name,m.rarity,unlocked,m.unlimited,m.unlockedAt]);
    next.lib = pages.flat().map(e => ({ id:e.stickerId, date:new Date(e.date+'T12:00:00'), createdAt:e.createdAt, no:e.originalNumber, material:e.materialId || 'matte', kind:(['gift','pack'].includes(e.sourceType) || (e.sourceType==='collection' && e.originalNumber==null)) ? 'received' : 'original', aspect:e.aspect, onDesktop:e.onDesktop, canManage:e.canManage, lineage:e.lineage, copyOf:e.copyOf, copyNo:e.copyNo, verified:e.verified, pressed:e.pressed,canPress:e.canPress,editionTotal:e.editionTotal, checked:e.checked, name:e.title || null, title:e.title || e.packName || 'Sticker' }));
    next.desk = next.lib.filter(e=>e.onDesktop).map(e=>({id:e.id}));
    next.stuckToday = next.lib.filter(e=>e.onDesktop && fmtDate(e.date)===fmtDate(next.today)).map(e=>e.id);
    next.gifts = inbox.map(g=>({id:g.giftId, from:g.from, note:g.note || '', opened:!!g.openedAt, material:g.materialId || 'matte', edition:g.edition, signatureStatus:g.signatureStatus, fingerprint:g.fingerprint, bag:BAGS[g.bag] ? g.bag : null, deco:g.deco || null, to:g.to || ''}));
    next.owned = Object.fromEntries(packs.packs.map(p=>[p.id,true]));
    next.packs = packs.packs.map(p=>({id:p.id, title:p.title, by:p.by, total:p.total, left:Array(p.remaining).fill(null), freeOpenings:p.freeOpenings || 0, daily:p.id==='welcome', signatureStatus:p.signatureStatus,own:p.signatureStatus==="mine", listed:!!p.listed, canList:!!p.editionPack && p.signatureStatus==="mine", fingerprint:p.fingerprint, kind:isPouch(p.pouch) ? p.pouch : (p.pouch && BAGS[p.pouch]) ? 'kraft' : p.pouch || ({coffee:'kraft',plants:'kraft',cats:'matte'})[p.id] || 'holo', bag:BAGS[p.pouch] ? p.pouch : null, color:packColor(p.pouch,p.color)?.id || null, cover:p.cover || null, deco:p.deco || null, layout:(() => { try { return p.layout ? JSON.parse(p.layout) : null; } catch { return null; } })(), blurb:p.blurb || '', signed:!!p.fingerprint, shop:p.id.startsWith('shop:'), hue:({tokyo:200,pixel:120,night:245})[p.id] || 0})).sort((a,b)=>(({'welcome':0,'tokyo':1,'coffee':2})[a.id]??3)-(({'welcome':0,'tokyo':1,'coffee':2})[b.id]??3));
    return () => {
      const groups = {profile:["name","iconStickerId"], daily:["today","todayMat","dayState","bonusEnvelopes"], materials:["stock","prizeStock","materialState"], collection:["lib"], gifts:["gifts"], packs:["packs","packAvailable","packLimits"], scraps:["scraps"], links:["linkTags","tagStock"], boards:["boards"], inbox:["inbox"], offers:["events","packOffer"]};
      const fingerprint = (obj, keys) => JSON.stringify(keys.map(k=>obj[k]), (_k,v)=>v instanceof Map ? [...v] : v);
      lastChanges = new Set(Object.entries(groups).filter(([_name,keys])=>fingerprint(S,keys)!==fingerprint(next,keys)).map(([name])=>name));
      // Commit only after every read and normalization succeeds.
      for (const [material, update] of materialUpdates) Object.assign(material, update);
      Object.assign(S, next); revision++;
      if (!(typeof CR !== 'undefined' && CR.editing) && !available.includes(S.chosen)) S.chosen = available[0] || null;
    };
  }
  async function asset(id) {
    if (!assets.has(id)) {
      const request=invoke('sticker_asset', {stickerId:id}).then(bytes => URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type:'image/png'})));
      assets.set(id,request);request.catch(()=>{if(assets.get(id)===request)assets.delete(id);});
    }
    return assets.get(id);
  }
  /* A smaller picture for lists (the Collection's tiles and calendar): about a tenth of the bytes to send and decode. At most a few are fetched
     at once, so opening a long list never queues a hundred pictures in front of the one you are waiting for. */
  const thumbs = new Map(); let thumbBusy = 0; const thumbWaiting = [];
  const thumbSlot = () => new Promise(go => { const run = () => { thumbBusy++; go(); }; if(thumbBusy < 4) run(); else thumbWaiting.push(run); });
  const thumbDone = () => { thumbBusy--; thumbWaiting.shift()?.(); };
  async function thumb(id, max = 384) {
    const key = id + ":" + max;
    if (!thumbs.has(key)) { const request=(async () => {
      await thumbSlot();
      try { const bytes = await invoke('sticker_thumb', {stickerId:id, max}); return URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type:'image/png'})); }
      catch { return asset(id); } // no thumbnail (an older core, an odd file): the full picture still works
      finally { thumbDone(); }
    })();thumbs.set(key,request);request.catch(()=>{if(thumbs.get(key)===request)thumbs.delete(key);}); }
    return thumbs.get(key);
  }
  function invalidateAsset(id) {
    const revoked=new Set(),revoke=p=>p?.then(url=>{if(!revoked.has(url)){revoked.add(url);URL.revokeObjectURL(url);}}).catch(()=>{});
    revoke(assets.get(id));assets.delete(id);
    for(const key of stickerResources.keys()) if(key.startsWith(id+":")) stickerResources.delete(key);
    for(const key of [...thumbs.keys()]) if(key.startsWith(id+":")) {revoke(thumbs.get(key));thumbs.delete(key);}
    Pages.studio?.invalidateAsset?.(id);
  }
  async function entry(id) {
    const back = await invoke('sticker_back', {stickerId:id});
    return { id, material:back.material?.id || 'matte', kind:back.kind, from:back.receivedFrom, no:back.originalNumber == null ? null : Number(back.originalNumber), edition:back.editionNumber == null ? null : Number(back.editionNumber), editionTotal:back.editionTotal, date:new Date(), back, title:'Sticker' };
  }
  async function packEntry(opened) {
    if(opened.kind && opened.kind !== "sticker") return {id:null,prize:true,prizeKind:opened.kind,material:opened.materialId || "matte",title:opened.name,rarity:opened.rarity || "common",aspect:1};
    const e=await entry(opened.stickerId);return {...e,rarity:opened.rarity,title:opened.name || e.title};
  }
  function changed() {
    const loaded = reload();
    if (changeFlight) return changeFlight;
    changeFlight = (async () => {
      try {
        await loaded;
        Shell.renderNav(); Shell.syncResources();
        if (typeof PackZoom !== 'undefined' && PackZoom.current) PackZoom.stale();
        else Shell.refresh({changes:lastChanges});
        if (S.packOffer) Distribution.offer(S.packOffer);
        Shell.clearProblem?.();
      } catch (error) { Shell.error(error, {retry:changed}); }
    })().finally(()=>{changeFlight = null;});
    return changeFlight;
  }
  async function refreshCommitted({after = () => Shell.refresh(), message = "Your change was saved, but the latest view could not be loaded."} = {}) {
    const retry = async () => { await reload(); Shell.renderNav(); await after(); };
    try { await retry(); return true; }
    catch (error) { Shell.error(error, {message, retry}); return false; }
  }
  function enterCeremony() {
    document.body.dataset.scene='ceremony';
    if(S.page==='today') Pages.today.suspend();
  }
  function leaveCeremony() {
    delete document.body.dataset.scene;
    Shell.flushRefresh?.();
    if(Distribution.pendingOffer) Distribution.offer(Distribution.pendingOffer);
    if(S.page==='today') Pages.today.resume();
  }
  async function printAction(cmd, args) {
    // Print changes focus through the native desktop layer, rather than an outside click.
    Bridge.printFocusTransfer=true;
    try { return await invoke(cmd, args); }
    catch(e) { Bridge.printFocusTransfer=false; throw e; }
  }
  let busy = false;
  return { get busy(){return busy;}, set busy(value){busy=!!value;if(!busy && typeof Shell!=="undefined")queueMicrotask(()=>Shell.flushRefresh?.());}, invoke, fileDialog, printAction, enterCeremony, leaveCeremony, window:windowApi, reload, refreshCommitted, asset, thumb, invalidateAsset, entry, packEntry, savePreferences, changed, get changes(){return lastChanges;}, get revision(){return revision;}, listen:api.event.listen };
})();
const stickerResources = new Map();
async function resOf(entry) {
  const key = entry.id + ":" + entry.material;
  if (!stickerResources.has(key)) {const request=(async () => {
    const url = await Bridge.asset(entry.id), i = await Stk.load(url);
    return { url, w:i.naturalWidth, h:i.naturalHeight, aspect:i.naturalWidth/i.naturalHeight, material:entry.material, mask:['holographic','gold'].includes(entry.material) ? url : null };
  })().catch(err => { if(stickerResources.get(key)===request)stickerResources.delete(key); throw err; });stickerResources.set(key,request);}
  return stickerResources.get(key);
}
/* The same as resOf, from the thumbnail: for tiles. */
async function thumbOf(entry) {
  const key = entry.id + ":" + entry.material + ":thumb";
  if (!stickerResources.has(key)) {const request=(async () => {
    const url = await Bridge.thumb(entry.id), i = await Stk.load(url);
    return { url, w:i.naturalWidth, h:i.naturalHeight, aspect:i.naturalWidth/i.naturalHeight, material:entry.material, mask:['holographic','gold'].includes(entry.material) ? url : null };
  })().catch(err => { if(stickerResources.get(key)===request)stickerResources.delete(key); throw err; });stickerResources.set(key,request);}
  return stickerResources.get(key);
}
// Desktop rendering and placement belong to the existing layer windows.
const Desktop = { hideArrival() {}, async print(...entries) { await Bridge.printAction("print_resume", { stickerIds: entries.flat().map(e => e?.id).filter(Boolean) }); }, async later() { await Bridge.invoke('print_later'); }, };

/* The Studio sidebar is translucent on macOS: Rust shows a sidebar material behind the transparent web view.
   The page only turns its own sidebar translucent once Rust says the material is really there. */
const Vibrancy = (() => {
  const lessTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
  async function sync() {
    const want = S.shell === 'studio' && !lessTransparency.matches;
    let shown = false;
    try { shown = !!(await Bridge.invoke('window_vibrancy', { enabled: want })); } catch {}
    document.documentElement.dataset.vibrancy = want && shown ? 'on' : 'off';
  }
  lessTransparency.addEventListener('change', sync);
  return { sync };
})();

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

function PrizeCard(entry,width=160) {return h("div.backing",{style:{width:width+"px",textAlign:"center"}},entry.prizeKind === "material" ? MatCard(MAT[entry.material],width) : LinkTagPic({size:width*.6}),h("b",entry.title),h("small","Added to your stock"));}
