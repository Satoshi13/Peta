// UI preferences are shared by the main shell and the existing transparent desktop layers.
const layerPrefs = JSON.parse(localStorage.getItem('peta.preferences') || '{}');
function applyLayerPreferences(p) { document.documentElement.dataset.motion=p.motion||'full'; Snd.on=p.sound??true; Haptic.on=p.haptics??true; window.dispatchEvent(new Event("layer-preferences")); if(reduced()) document.getAnimations().forEach(a=>{if(a.effect?.getTiming().iterations===Infinity)a.cancel();}); }
applyLayerPreferences(layerPrefs);
window.__TAURI__.event.listen('preferences-changed',e=>applyLayerPreferences(e.payload));
const nativeAnimate=Element.prototype.animate;
Element.prototype.animate=function(frames,options) { if(reduced()) options={...(typeof options==='number'?{duration:options}:options),duration:1,delay:0,iterations:1}; return nativeAnimate.call(this,frames,options); };
const assetStyle=document.createElement('style'); assetStyle.textContent=':root{'+Object.keys(A).map(k=>`--a-${k}:url("${new URL(A[k],location.href).href}");`).join('')+'}'; document.head.append(assetStyle);
let lastPetaTag=-1;
// Keep the prototype's four slots (en / pill / holo / stamp), replacing only their art.
const LAYER_TAGS=[()=>img('tagEn','peta-tag'),()=>img('tagRound','peta-tag v-round'),()=>img('tagHolo','peta-tag v-holo'),()=>img('tagStamp','peta-tag v-stamp')];
// Decode before the first paste: the brief success animation must not wait for its image.
for (const make of LAYER_TAGS) { const tag=make(); tag.decode().catch(console.error); }
function petaTag(x,y) { let i; do i=Math.floor(Math.random()*LAYER_TAGS.length); while(i===lastPetaTag && LAYER_TAGS.length>1); lastPetaTag=i; const tag=LAYER_TAGS[i](); tag.alt=''; tag.setAttribute('aria-hidden','true'); tag.dataset.art=tag.src.split('/').pop().replace('.png',''); tag.style.left=x+'px'; tag.style.top=y+'px'; document.getElementById('layer').append(tag); anim(tag,[{opacity:0,transform:'translate(-10%, -150%) rotate(-8deg) scale(.6)'},{opacity:1,transform:'translate(8%, -170%) rotate(-5deg) scale(1)',offset:.25},{opacity:1,transform:'translate(8%, -170%) rotate(-5deg) scale(1)',offset:.8},{opacity:0,transform:'translate(8%, -190%) rotate(-5deg) scale(1)'}],{duration:1300,easing:'ease-out'}).then(()=>tag.remove()); }
