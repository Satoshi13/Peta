// Everything here comes from /api/me, which the Worker answers only after Cloudflare Access. No release details are hard-coded.
(() => {
  const $ = (id) => document.getElementById(id);
  const MAC = { 13: 'Ventura', 14: 'Sonoma', 15: 'Sequoia', 26: 'Tahoe' };
  const size = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`;
  const macos = (v) => { const major = Number(v.split('.')[0]); return `macOS ${major}${MAC[major] ? ' ' + MAC[major] : ''} or later`; };
  const chips = (a) => a.includes('arm64') && a.includes('x86_64') ? 'Apple silicon and Intel' : a.includes('arm64') ? 'Apple silicon' : a.includes('x86_64') ? 'Intel' : '';
  const day = (t) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  function showRelease(r) {
    const button = $('download-button');
    if (!r) { $('download-status').textContent = 'The first build is on its way. Check back soon.'; return; }
    button.href = `/download/${encodeURIComponent(r.file)}`;
    button.removeAttribute('aria-disabled');
    button.setAttribute('download', r.file);
    $('release-meta').textContent = `Version ${r.version} · ${size(r.size)} · Private beta`;
    $('download-status').textContent = [macos(r.minimumSystemVersion), chips(r.architectures), 'Disk image'].filter(Boolean).join(' · ');
  }
  function showInvite(i) {
    if (i.paused) {
      $('download-status').textContent = 'Your invitation is paused. Ask in the Peta Discord if this is unexpected.';
      return;
    }
    $('invite').hidden = false;
    $('invite-code').textContent = i.code;
    $('invite-state').textContent = i.inUse ? `In use on your Mac since ${day(i.since)}.` : 'Not used yet.';
    $('invite-move').hidden = !i.inUse;
  }
  async function load() {
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const me = await r.json();
      showRelease(me.release);
      showInvite(me.invite);
      $('signed-in').append(document.createElement('br'), `Signed in as ${me.email}.`);
    } catch {
      $('download-status').textContent = 'Couldn’t reach Peta just now. Reload the page to try again.';
    }
  }
  $('invite-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('invite-code').textContent); $('invite-copy').textContent = 'Copied'; }
    catch { getSelection().selectAllChildren($('invite-code')); }
    setTimeout(() => { $('invite-copy').textContent = 'Copy'; }, 1600);
  });
  $('invite-move').addEventListener('click', async () => {
    if (!confirm('Get a new code for a new Mac?\n\nThe Mac using your current code stops connecting to friends until it gets a code again.')) return;
    const r = await fetch('/api/new-code', { method: 'POST', credentials: 'same-origin' });
    if (r.ok) showInvite(await r.json());
    else $('invite-state').textContent = 'Couldn’t make a new code. Reload the page to try again.';
  });
  load();
})();
