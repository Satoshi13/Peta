// UI preferences are shared by the main shell and the existing transparent desktop layers.
const layerPrefs = JSON.parse(localStorage.getItem('peta.preferences') || '{}');
function applyLayerPreferences(p) { document.documentElement.dataset.motion=p.motion||'full'; Snd.on=p.sound??true; if(reduced()) document.getAnimations().forEach(a=>{if(a.effect?.getTiming().iterations===Infinity)a.cancel();}); }
applyLayerPreferences(layerPrefs);
window.__TAURI__.event.listen('preferences-changed',e=>applyLayerPreferences(e.payload));
const nativeAnimate=Element.prototype.animate;
Element.prototype.animate=function(frames,options) { if(reduced()) options={...(typeof options==='number'?{duration:options}:options),duration:1,delay:0,iterations:1}; return nativeAnimate.call(this,frames,options); };
const assetStyle=document.createElement('style'); assetStyle.textContent=':root{'+Object.keys(A).map(k=>`--a-${k}:url("${new URL(A[k],location.href).href}");`).join('')+'}'; document.head.append(assetStyle);
let lastPetaTag=-1;
const LAYER_TAGS=[()=>img('tagEn','peta-tag'),()=>h('div.peta-tag.v-pill',h('i.wm')),()=>h('div.peta-tag.v-holo',h('i.wm')),()=>h('div.peta-tag.v-stamp',h('i.wm'))];
function petaTag(x,y) { let i; do i=Math.floor(Math.random()*LAYER_TAGS.length); while(i===lastPetaTag); lastPetaTag=i; const tag=LAYER_TAGS[i](); tag.dataset.art='peta-tag-'+i; tag.style.left=x+'px'; tag.style.top=y+'px'; document.getElementById('layer').append(tag); anim(tag,[{opacity:0,transform:'translate(-10%, -150%) rotate(-8deg) scale(.6)'},{opacity:1,transform:'translate(8%, -170%) rotate(-5deg) scale(1)',offset:.25},{opacity:1,transform:'translate(8%, -170%) rotate(-5deg) scale(1)',offset:.8},{opacity:0,transform:'translate(8%, -190%) rotate(-5deg) scale(1)'}],{duration:1300,easing:'ease-out'}).then(()=>tag.remove()); }

async function syncArrival() {
    const primary=(await window.__TAURI__.core.invoke('layer_info')).isPrimary;
    if(!primary)return;
    const kind=await window.__TAURI__.core.invoke('arrival_status');
    let arrival=document.getElementById('arrival');
    if(!kind) {arrival?.remove();return;}
    if(!arrival){arrival=h('div#arrival',{role:'button',tabindex:0,'aria-label':'Open Peta arrival'});document.getElementById('layer').append(arrival);arrival.onclick=()=>window.__TAURI__.core.invoke('arrival_open');arrival.onkeydown=e=>{if(e.key==='Enter'||e.key===' ')arrival.click();};}
    if(arrival.dataset.kind===kind)return;
    arrival.dataset.kind=kind; arrival.dataset.art='arrival-envelope';
    arrival.replaceChildren(img(kind==='gift'?'arrGift':'arrMaterial'),h('span.arr-note',kind==='gift'?'A sealed gift':"Today's Material"));
    Snd.chime(2,660);anim(arrival,[{transform:'translateY(60px) rotate(6deg) scale(.7)',opacity:0},{transform:'translateY(-10px) rotate(-2deg) scale(1.04)',opacity:1,offset:.7},{transform:'none',opacity:1}],{duration:760,easing:EASE.out}).then(a=>a.cancel());
}
window.__TAURI__.event.listen('arrival-changed',syncArrival);syncArrival().catch(console.error);
