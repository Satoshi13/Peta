import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = (name) => fs.readFileSync(new URL(`../src/app/js/${name}.js`, import.meta.url), 'utf8');
class Element {
  constructor(tag, props, children) { this.tag = tag; this.value = tag.startsWith("textarea") ? children.join("") : ""; Object.assign(this, props); this.children = children.flat(Infinity).filter((x) => x != null && x !== false); this.classList = { add() {} }; }
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.children = c.flat(Infinity); }
  focus() {}
  addEventListener() {}
}
function h(tag, ...args) { const props = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && !(args[0] instanceof Element) ? args.shift() : {}; return new Element(tag, props, args); }
const text = (el) => el instanceof Element ? (el.textContent || el.children.map(text).join('')) : String(el ?? '');
const nodes = (el) => el instanceof Element ? [el, ...el.children.flatMap(nodes)] : [];
const friend = (name, status, extra = {}) => ({ publicKey: `${name}-key`, name, fingerprint: 'ABCD-EFGH', status, allowed: status === 'friend', note: null, addedAt: new Date().toISOString(), ...extra });
function load(inbox, gifts = [], reply = async () => ({})) {
  const calls = [];
  const context = vm.createContext({ h, S: { inbox, gifts }, PackZoom: { dispose() {} }, Shell: { toast() {}, refresh() {}, renderNav() {}, async open(page) { calls.push({ page }); } }, Bridge: { invoke: async (cmd, args) => { calls.push({ cmd, args }); return reply(cmd, args); }, reload: async () => {} }, CloseButton: () => h('button.close'), SegButton: (t, p) => h('button', p, t), document: { querySelector: () => null, body: { append() {} } }, Date });
  vm.runInContext(source('friends') + ';this.Friends=Friends;', context);
  return { Friends: context.Friends, calls, context };
}

test('nothing about friends shows in a build without the server', () => {
  const { Friends } = load({ enabled: false, friends: [friend('Nao', 'pending')] });
  assert.equal(Friends.settingsCard(), null);
  assert.equal(Friends.keyCard(), null);
  assert.equal(Friends.giftsSection(), null);
  assert.equal(Friends.waiting(), 0, 'no badge either');
});

test('friends fall into groups, and only requests waiting on me count for the badge', () => {
  const list = [friend('Nao', 'friend'), friend('Ren', 'pending'), friend('Mika', 'pending'), friend('Yuki', 'requested'), friend('Eve', 'blocked')];
  const { Friends } = load({ enabled: true, friends: list, myCode: 'PETAF1-AAAA', myLink: 'peta://friend/x', myFingerprint: 'ABCD-EFGH', auto: true, backedUp: false });
  const g = Friends.groups();
  assert.deepEqual([g.friends, g.pending, g.requested, g.blocked].map((x) => x.map((f) => f.name)), [['Nao'], ['Ren', 'Mika'], ['Yuki'], ['Eve']]);
  assert.equal(Friends.waiting(), 2);
  assert.equal(Friends.label(friend('Old', 'requested', { addedAt: new Date(Date.now() - 8 * 864e5).toISOString() })), 'No response');
  assert.equal(Friends.label(g.requested[0]), 'Request sent');
  const card = text(Friends.settingsCard());
  for (const words of ['Your friend code', 'Copy code', 'Copy link', 'Add a friend…', 'Wants to be friends', 'Approve', 'Blocked', 'Unblock', 'Check for gifts', 'Remove my data']) assert.ok(card.includes(words), words);
  assert.ok(text(Friends.keyCard()).includes('Not backed up yet'));
});

test('the Gifts page lists requests and friends’ gifts with a report link', async () => {
  const { Friends, calls } = load({ enabled: true, friends: [friend('Ren', 'pending', { note: 'hi from the café' })] }, [{ id: 'g1', from: 'Nao', opened: true, signatureStatus: 'known' }, { id: 'g2', from: 'File', opened: true, signatureStatus: 'new' }]);
  const section = Friends.giftsSection(), all = text(section);
  assert.ok(all.includes('Friend requests') && all.includes('hi from the café') && all.includes('Report…'));
  assert.ok(!all.includes('File'), 'only gifts from known friends offer a report here');
  const approve = nodes(section).find((n) => n.tag === 'button.btn.small' && text(n) === 'Approve');
  await approve.on.click();
  assert.equal(JSON.stringify(calls[0]), JSON.stringify({ cmd: 'friend_approve', args: { key: 'Ren-key' } }));
});

test('Studio’s picker offers only friends who accepted', () => {
  const { Friends } = load({ enabled: true, friends: [friend('Nao', 'friend'), friend('Yuki', 'requested')] });
  let chosen = null;
  const picker = Friends.picker(null, (f) => { chosen = f.name; });
  const pills = nodes(picker).filter((n) => n.tag === 'button.fr-pill');
  assert.deepEqual(pills.map((p) => text(p).replace('ABCD-EFGH', '')), ['Nao']);
  pills[0].on.click(); assert.equal(chosen, 'Nao');
  const { Friends: none } = load({ enabled: true, friends: [] });
  assert.match(text(none.picker(null, () => {})), /Add one in Settings/);
});

function dialogForm(Friends, link) {
  let form;
  Friends.sheet = (_, ...children) => { form = children.find(x => x.tag === 'form.bd-form'); return { close() {} }; };
  Friends.addDialog(link);
  return form;
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('an OS link waits for boot, opens Settings with the prefill, and only previews', async () => {
  const links = ['peta-developer://friend/signed-code'];
  const { Friends, calls } = load({ enabled:true, backedUp:true }, [], async cmd => cmd === 'friend_link_take' ? links.shift() || null : { name:'Nao', status:'new', fingerprint:'ABCD-EFGH' });
  let form;
  Friends.sheet = (_, ...children) => { form = children.find(x => x.tag === 'form.bd-form'); return { close() {} }; };
  await Friends.openPendingLinks(); assert.equal(calls.length, 0, 'not consumed before boot is ready');
  Friends.linksReady = true; await Friends.openPendingLinks(); await flush();
  assert.ok(calls.some(x => x.page === 'settings'));
  assert.equal(nodes(form).find(x => x.tag === 'textarea.bd-input.fr-code').value, 'peta-developer://friend/signed-code');
  assert.ok(calls.some(x => x.cmd === 'friend_preview'));
  assert.ok(!calls.some(x => x.cmd === 'friend_add'), 'neither launch nor preview sends anything');
  const send = nodes(form).find(x => x.type === 'submit'); assert.equal(send.disabled, false);
  await form.on.submit({ preventDefault() {} });
  assert.equal(calls.filter(x => x.cmd === 'friend_add').length, 1, 'only the explicit submit sends');
});

test('self, blocked, existing and damaged links cannot submit a friend request', async () => {
  for (const status of ['self', 'blocked', 'friend', 'requested', 'pending', 'damaged']) {
    const { Friends, calls } = load({ enabled:true }, [], async () => { if(status === 'damaged') throw Error('This friend link is damaged.'); return {name:'Nao', status}; });
    const form = dialogForm(Friends, 'peta://friend/payload'); await flush();
    assert.equal(nodes(form).find(x => x.type === 'submit').disabled, true, status);
    await form.on.submit({ preventDefault() {} });
    assert.ok(!calls.some(x => x.cmd === 'friend_add'), status);
  }
});

test('a late preview of an edited link cannot enable sending', async () => {
  let finish;
  const { Friends, calls } = load({ enabled:true }, [], () => new Promise(resolve => { finish = resolve; }));
  const form = dialogForm(Friends, 'peta://friend/old');
  const input = nodes(form).find(x => x.tag === 'textarea.bd-input.fr-code');
  input.value = 'peta://friend/new';
  finish({ name:'Old friend', status:'new' }); await flush();
  assert.equal(nodes(form).find(x => x.type === 'submit').disabled, true);
  await form.on.submit({ preventDefault() {} }); assert.ok(!calls.some(x => x.cmd === 'friend_add'));
});

test('a warm link waits for an existing sheet and duplicate wakeups do not open it twice', async () => {
  const links = ['peta://friend/warm'];
  const { Friends, calls, context } = load({ enabled:true }, [], async cmd => cmd === 'friend_link_take' ? links.shift() || null : {name:'Nao',status:'new'});
  let closed, opened = 0;
  context.document.querySelector = () => ({ addEventListener(_, callback) { closed = callback; } });
  Friends.sheet = () => { opened++; return { close() {} }; };
  Friends.linksReady = true;
  const running = Friends.openPendingLinks(); await flush();
  assert.equal(opened, 0); assert.ok(!calls.some(x => x.page === 'settings'));
  await Friends.openPendingLinks(); assert.equal(opened, 0, 'wakeups share one consumer');
  context.document.querySelector = () => null; closed(); await running; await flush();
  assert.equal(opened, 1); assert.ok(calls.some(x => x.page === 'settings'));
  assert.ok(!calls.some(x => x.cmd === 'friend_add'));
});
