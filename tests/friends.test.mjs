import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = (name) => fs.readFileSync(new URL(`../src/app/js/${name}.js`, import.meta.url), 'utf8');
class Element {
  constructor(tag, props, children) { this.tag = tag; Object.assign(this, props); this.children = children.flat(Infinity).filter((x) => x != null && x !== false); this.classList = { add() {} }; }
  append(...c) { this.children.push(...c); }
  addEventListener() {}
}
function h(tag, ...args) { const props = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && !(args[0] instanceof Element) ? args.shift() : {}; return new Element(tag, props, args); }
const text = (el) => el instanceof Element ? (el.textContent || el.children.map(text).join('')) : String(el ?? '');
const nodes = (el) => el instanceof Element ? [el, ...el.children.flatMap(nodes)] : [];
const friend = (name, status, extra = {}) => ({ publicKey: `${name}-key`, name, fingerprint: 'ABCD-EFGH', status, allowed: status === 'friend', note: null, addedAt: new Date().toISOString(), ...extra });
function load(inbox, gifts = []) {
  const calls = [];
  const context = vm.createContext({ h, S: { inbox, gifts }, Shell: { toast() {}, refresh() {}, renderNav() {} }, Bridge: { invoke: async (cmd, args) => { calls.push({ cmd, args }); return {}; }, reload: async () => {} }, CloseButton: () => h('button.close'), SegButton: (t, p) => h('button', p, t), document: { querySelector: () => null, body: { append() {} } }, Date });
  vm.runInContext(source('friends') + ';this.Friends=Friends;', context);
  return { Friends: context.Friends, calls };
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
