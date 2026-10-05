const arrival = document.getElementById('arrival');
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const entering = arrival.querySelector('.arrival-enter');
let exitAnimation = null;
function applyArrivalPreferences(p) {
    document.documentElement.dataset.motion = p.motion || 'full';
    Snd.on = p.sound ?? true;
    if (reduced()) {
        document.getAnimations().forEach(a => a.cancel());
        if (arrival.dataset.state === 'leaving') arrival.hidden = true;
    }
}
applyArrivalPreferences(JSON.parse(localStorage.getItem('peta.preferences') || '{}'));
function renderArrival(kind) {
    if (!kind) {
        if (arrival.hidden || arrival.dataset.state === 'leaving') return;
        arrival.disabled = true;
        arrival.dataset.hovered = 'false';
        arrival.dataset.state = 'leaving';
        if (reduced()) { arrival.hidden = true; return; }
        // Start from the current entry pose, including clicks while it is sliding in.
        const pose = getComputedStyle(entering);
        exitAnimation = entering.animate([
            {transform: pose.transform, opacity: pose.opacity},
            {transform: 'translateX(36px) scale(.97)', opacity: 0}
        ], {duration: 280, easing: 'cubic-bezier(.4,0,1,1)', fill: 'both'});
        exitAnimation.finished.then(() => {
            if (arrival.dataset.state === 'leaving') arrival.hidden = true;
        }).catch(() => {});
        return;
    }
    exitAnimation?.cancel();
    exitAnimation = null;
    arrival.hidden = false;
    arrival.disabled = false;
    arrival.dataset.state = 'ready';
    if (arrival.dataset.kind === kind) return;
    arrival.dataset.kind = kind;
    arrival.dataset.art = 'arrival-envelope';
    arrival.querySelector('.arrival-paper').style.backgroundImage = `url("${new URL(A[kind === 'gift' ? 'arrGift' : 'arrMaterial'], location.href).href}")`;
    const text = kind === 'gift' ? 'A sealed\ngift' : kind === 'extra' ? 'Extra\nMaterial' : "Today's\nMaterial";
    arrival.querySelector('.arrival-label').textContent = text;
    arrival.setAttribute('aria-label', 'Open ' + text.replace('\n', ' '));
    Snd.chime(2, 660);
}
arrival.addEventListener('click', async () => {
    if (arrival.disabled) return;
    arrival.disabled = true;
    try { await invoke('arrival_open'); }
    catch (error) { arrival.disabled = false; console.error(error); }
});
async function startArrival() {
    let hoverRevision = 0;
    await listen('arrival-hovered', e => { hoverRevision++; arrival.dataset.hovered = String(e.payload); });
    await listen('preferences-changed', e => applyArrivalPreferences(e.payload));
    let revision = 0;
    await listen('arrival-changed', e => { revision++; renderArrival(e.payload); });
    const initialRevision = revision;
    const initialHoverRevision = hoverRevision;
    const [kind, hovered] = await Promise.all([invoke('arrival_status'), invoke('arrival_hover_status')]);
    if (hoverRevision === initialHoverRevision) arrival.dataset.hovered = String(hovered);
    if (revision === initialRevision) renderArrival(kind);
}
startArrival().catch(console.error);
