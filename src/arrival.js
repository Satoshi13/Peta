const arrival = document.getElementById('arrival');
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
function applyArrivalPreferences(p) {
    document.documentElement.dataset.motion = p.motion || 'full';
    Snd.on = p.sound ?? true;
    if (reduced()) document.getAnimations().forEach(a => a.cancel());
}
applyArrivalPreferences(JSON.parse(localStorage.getItem('peta.preferences') || '{}'));
function renderArrival(kind) {
    arrival.hidden = !kind;
    if (!kind || arrival.dataset.kind === kind) return;
    arrival.dataset.kind = kind;
    arrival.dataset.art = 'arrival-envelope';
    arrival.querySelector('.arrival-paper').style.backgroundImage = `url("${new URL(A[kind === 'gift' ? 'arrGift' : 'arrMaterial'], location.href).href}")`;
    const text = kind === 'gift' ? 'A sealed\ngift' : kind === 'extra' ? 'Extra\nMaterial' : "Today's\nMaterial";
    arrival.querySelector('.arrival-label').textContent = text;
    arrival.setAttribute('aria-label', 'Open ' + text.replace('\n', ' '));
    Snd.chime(2, 660);
}
arrival.addEventListener('click', () => invoke('arrival_open').catch(console.error));
async function startArrival() {
    await listen('preferences-changed', e => applyArrivalPreferences(e.payload));
    let revision = 0;
    await listen('arrival-changed', e => { revision++; renderArrival(e.payload); });
    const initialRevision = revision;
    const kind = await invoke('arrival_status');
    if (revision === initialRevision) renderArrival(kind);
}
startArrival().catch(console.error);
