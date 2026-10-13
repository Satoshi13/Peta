import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/app/js/packs.js',import.meta.url),'utf8');
const h=(tag,...args)=>{const props=args[0] && typeof args[0]==='object' && !Array.isArray(args[0]) && !args[0].tag ? args.shift():{};return {tag,props,children:args.flat(Infinity).filter(x=>x!=null),replaceChildren(...children){this.children=children.flat(Infinity).filter(x=>x!=null);}};};
const context=vm.createContext({h,S:{inbox:{friends:[]}},Bridge:{invoke:async()=>({status:'offline'})}});
vm.runInContext(source.slice(source.indexOf('const PackSales ='),source.indexOf('const PackListing ='))+';this.PackSales=PackSales;',context);
const sales=context.PackSales;
const all=e=>e?.tag?[e,...e.children.flatMap(all)]:[];
const text=e=>e?.tag?e.children.map(text).join(''):String(e??'');
test('sales lines show up to three drawer names and the remaining people count',()=>{
 const names=['Nao','Mika','Ren','Satoshi','Yuki','Someone'];
 const line=sales.line({name:'Cat',total:30,taken:8,drawers:names});
 const note=all(line).find(e=>e.tag==='small.pk-sale-drawers');
 assert.equal(text(note),'Nao, Mika, Ren · +3');
 assert.equal(note.props['aria-label'],'Drawn by '+names.join(', '));
 assert.ok(text(line).includes('8 / 30'));
});
test('empty and older server results do not add an empty drawer label',()=>{
 for(const drawers of [undefined,[]]) assert.ok(!all(sales.line({name:'Leaf',total:5,taken:0,drawers})).some(e=>e.tag==='small.pk-sale-drawers'));
 assert.equal(sales.drawerLabel(['Someone']),'Someone');
});
test('friend names stay literal text, including markup characters',()=>{
 const name='<img src=x onerror=alert(1)>';
 const note=all(sales.line({name:'Cat',total:2,taken:1,drawers:[name]})).find(e=>e.tag==='small.pk-sale-drawers');
 assert.equal(note.children[0],name); assert.equal(all(note).length,1);
});
test('blocking, removing or renaming a friend invalidates cached sales names',async()=>{
 const friend={publicKey:'key',name:'Nao',status:'friend'};context.S.inbox.friends=[friend];
 let calls=0;context.Bridge.invoke=async()=>{calls++;return {status:'live',drawers:[friend.status==='friend'?friend.name:'Someone']};};
 const pack={id:'cache-test'};
 assert.equal((await sales.get(pack)).drawers[0],'Nao');await sales.get(pack);assert.equal(calls,1);
 friend.status='blocked';assert.equal((await sales.get(pack)).drawers[0],'Someone');assert.equal(calls,2);
 friend.status='friend';friend.name='Mika';assert.equal((await sales.get(pack)).drawers[0],'Mika');assert.equal(calls,3);
 context.S.inbox.friends=[];await sales.get(pack);assert.equal(calls,4);
});
test('the panel renders the native flattened sales response with drawer names and prizes',async()=>{
 context.Bridge.invoke=async()=>({status:'live',taken:2,total:5,designs:[{name:'Cat',taken:1,total:3,drawers:['Nao']}],prizes:[{name:'Link tag',taken:1,total:2,drawers:['Someone']}]});
 const box=sales.panel({id:'panel-test'});await sales.cache.get('panel-test').request;await Promise.resolve();
 assert.match(text(box),/2 of 5 taken/);assert.match(text(box),/CatNao1 \/ 3/);assert.match(text(box),/Link tagSomeone1 \/ 2/);
});
