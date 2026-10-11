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
test('existing copies remain selectable without a duplicate operation',()=>{
 const src=read('src/app/js/book.js'),ctx=vm.createContext({S:{lib:[{id:'old-copy',copyOf:'real',copyNo:2,date:'2026-10-11'},{id:'other-copy',copyOf:'other'}]},BK:{},PetaMath:{newestBookEntries:x=>x,bookDateKey:x=>x},h:(tag,...children)=>({tag,children}),paint:selectionOnly=>{ctx.painted=selectionOnly;}});
 const method=src.slice(src.indexOf('  existingCopies('),src.indexOf('  deleteForm('));
 vm.runInContext('this.book={'+method+'};this.row=book.existingCopies({id:"real"},paint);',ctx);
 const buttons=ctx.row.children[1];assert.equal(buttons.length,1);assert.equal(buttons[0].children[1],'Copy #2');
 buttons[0].children[0].on.click();assert.equal(ctx.BK.sel,'old-copy');assert.equal(ctx.BK.day,'2026-10-11');assert.equal(ctx.painted,true);
 assert.equal(ctx.book.existingCopies({id:'without-copies'},ctx.paint),null);
 for(const path of ['src/app/js/book.js','src-tauri/src/collection.rs','src-tauri/src/lib.rs','src-tauri/permissions/desktop-effects.toml'])assert.doesNotMatch(read(path),/sticker_duplicate/);
 assert.match(src,/Stays on this Mac/);assert.match(src,/e.lineage !== "copy" \? act\("det-link", "gift"/);
});
test('Gift requires an explicit transfer confirmation before invoking the command',()=>{
 const src=read('src/app/js/studio.js');assert.match(src,/This leaves your Collection\./);assert.match(src,/if\(!await stConfirmTransfer\(\)\) return null/);
});
test('Editions panel fixes foreign stickers to one and reports odds including prizes',()=>{
 const src=read('src/app/js/studio.js'),ctx=vm.createContext({S:{packLimits:{copiesPerDesign:30}}});
 const pick=n=>src.split('\n').find(l=>l.startsWith(`const ${n} =`));
 vm.runInContext(['stCopyMax','stSlots','stOdds'].map(pick).join('\n')+';this.out={stCopyMax,stSlots,stOdds};',ctx);
 assert.equal(ctx.out.stCopyMax({canPress:true}),30);assert.equal(ctx.out.stCopyMax({canPress:false}),1);
 assert.equal(ctx.out.stSlots({sel:[{copies:3},{copies:1}],prizes:[{count:2}]}),6);
 assert.deepEqual(Array.from(ctx.out.stOdds([{copies:3},{copies:1}],[{count:2}])),[.5,1/6]);
 assert.match(src,/Made by someone else: one sticker/);assert.match(src,/heading\("Editions"/);assert.match(src,/disabled:!!e.pressed/);assert.match(src,/ids = p.sel.filter\(x=>stEntry\(x.id\)\?\.canPress\)/);
});
test('own packs have no opening controls and prize awards never load a sticker asset',()=>{
 const src=read('src/app/js/packs.js');assert.match(src,/const one = p.own \? null/);assert.match(src,/Your own pack: friends open it/);
 assert.match(read('src/app/js/catalog.js'),/packOpenable = p => !p.own/);
 const bridge=read('src/app/js/bridge.js');assert.match(bridge,/opened.kind !== "sticker"/);assert.match(bridge,/id:null,prize:true/);
 assert.match(read('src/app/js/ceremony.js'),/if\(entry.prize\).*Added to your stock/s);
});
test('restored prize drafts respect current stock, duplicate types and remaining slots',()=>{
 const src=read('src/app/js/studio.js'),ctx=vm.createContext({S:{packLimits:{prizes:10,packSlots:200},prizeStock:{kraft:4},tagStock:{available:2}},MAT:{kraft:{}}});
 vm.runInContext(src.slice(src.indexOf('function stCleanPrizes('),src.indexOf('const stDraftKey'))+';this.clean=stCleanPrizes;',ctx);
 const draft=[{kind:'material',materialId:'kraft',count:20},{kind:'material',materialId:'kraft',count:4},{kind:'material',materialId:'unknown',count:1},{kind:'tag',count:8}];
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.clean(draft,197))),[{kind:'material',materialId:'kraft',count:3}]);
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.clean(draft,190))),[{kind:'material',materialId:'kraft',count:4},{kind:'tag',count:2}]);
 assert.equal(ctx.clean(draft,200).length,0);
});
