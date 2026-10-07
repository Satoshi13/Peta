/* Snapshot fixture for the real native UI; no user database or native commands run. */
(() => {
  window.reviewCalls=[]; window.reviewEvents={}; window.reviewOpened=true;
  localStorage.setItem('peta.preferences', JSON.stringify({shell:'studio',sound:false,haptics:false,motion:'full',closeOutside:false}));
  const ids=['matte','kraft','holographic','gold','riso','vintage','clear','pixel','washi','sakura'];
  const entries=Array.from({length:8},(_,i)=>({stickerId:'review-'+i,date:'2026-10-0'+(5+i%3),createdAt:'2026-10-07T12:00:00Z',originalNumber:i+1,materialId:ids[i%3],sourceType:'created',aspect:1,onDesktop:false,canManage:true,packName:'Sticker '+(i+1)}));
  const packs=[{id:'welcome',title:'Welcome Pack',by:'Peta',total:12,remaining:12,pouch:'holo'},{id:'pixel',title:'Pixel Dream',by:'Ryo',total:6,remaining:6,pouch:'holo'},{id:'coffee',title:'Coffee Club',by:'Nao',total:6,remaining:6,pouch:'kraft'},{id:'cats',title:'Cats',by:'Yuki',total:5,remaining:5,pouch:'matte'}];
  const win={onFocusChanged:async cb=>{window.reviewFocus=cb;},isVisible:async()=>window.reviewOpened,isMinimized:async()=>false,hide:async()=>{window.reviewOpened=false;},show:async()=>{window.reviewOpened=true;},minimize:async()=>{},toggleMaximize:async()=>{},startDragging:async()=>{},startResizeDragging:async()=>{}};
  const listen=async(name,cb)=>{(window.reviewEvents[name] ||= []).push(cb);return()=>{};};
  window.__TAURI__={window:{getCurrentWindow:()=>win},webview:{getCurrentWebview:()=>({onDragDropEvent:async()=>()=>{}})},event:{listen,emit:async(name,payload)=>{for(const cb of window.reviewEvents[name] || [])await cb({payload});}},core:{invoke:async(cmd,args)=>{
    window.reviewCalls.push({cmd,args});
    switch(cmd) {
      case 'profile_get':return {displayName:'Review',developer:true,iconStickerId:null};
      case 'daily_status':return {date:'2026-10-07',materialOpened:window.reviewMaterialOpened ?? true,material:{id:'holographic'},bonusEnvelopes:window.reviewBonus || 0};
      case 'material_book':return ids.map(id=>({material:{id,name:({holographic:'Holographic',gold:'Gold Foil'})[id] || id[0].toUpperCase()+id.slice(1),rarity:id==='holographic' ? 'rare' : 'common',count:5,unlimited:false},unlocked:true}));
      case 'book_index':return [{year:2026,month:10}];
      case 'book_page':return entries;
      case 'gift_inbox':case 'event_inbox':return [];
      case 'pack_status':return {canOpen:true,packs};
      case 'print_pending':case 'creator_pack_pending':return null;
      case 'scrap_status':return {balance:60,materials:ids.map(id=>({id,exchange:2,dismantle:1})),packs:packs.map(p=>({id:p.id,exchange:12,stickers:6}))};
      case 'sticker_asset':return [...new Uint8Array(await (await fetch('/src/art/samples/good-day.png')).arrayBuffer())];
      case 'redeem_code':if(window.reviewRedeemError)throw Error('invalid_signature: Example error');window.reviewBonus=1;return {result:'Code received.'};
      case 'window_vibrancy':return false;
      default:throw new Error('Unexpected fixture command: '+cmd);
    }
  }}};
})();
