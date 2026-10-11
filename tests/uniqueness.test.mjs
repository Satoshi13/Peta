import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
test('Studio excludes copies and restores only real draft selections',()=>{
 const src=read('src/app/js/studio.js'),ctx=vm.createContext({S:{lib:[{id:'real',lineage:'real'},{id:'copy',lineage:'copy'}]},PetaMath:{newestBookEntries:x=>x}});
 vm.runInContext(src.split('\n').find(l=>l.startsWith('const stEntries ='))+';this.result=stEntries();',ctx);
 assert.deepEqual(Array.from(ctx.result,x=>x.id),['real']);
 assert.match(src,/new Set\(S.lib.filter\(e => e.lineage !== "copy"\)/);
 assert.match(src,/stEntry\(sticker\)\?\.lineage !== "copy"/);
});
test('Duplicate exposes only the remaining allowance and copies stay local',()=>{
 const src=read('src/app/js/book.js'),ctx=vm.createContext({});
 vm.runInContext(src.split('\n').find(l=>l.startsWith('const copyRoom ='))+';this.room=copyRoom;',ctx);
 for(const [copies,room] of [[0,10],[3,7],[10,0],[12,0]])assert.equal(ctx.room({copies,copyLimit:10}),room);
 assert.match(src,/Array.from\(\{length:room\}/);assert.match(src,/Stays on this Mac/);assert.match(src,/e.lineage !== "copy" \? act\("det-link", "gift"/);
});
test('Gift requires an explicit transfer confirmation before invoking the command',()=>{
 const src=read('src/app/js/studio.js');assert.match(src,/This leaves your Collection\./);assert.match(src,/if\(!await stConfirmTransfer\(\)\) return null/);
});
