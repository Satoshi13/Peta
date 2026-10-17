import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function fixture({developer=false,result={},failure=false,last=null}={}) {
 const calls=[],queue=[];let now=100000;
 const h=(tag,...args)=>{const props=typeof args[0]==='object'?args.shift():{};return {tag,...props,children:args,isConnected:true};};
 const c=vm.createContext({h,S:{developer},Date:class extends Date{static now(){return now;}},queueMicrotask:f=>queue.push(f),setInterval:()=>1,clearInterval(){},Bridge:{invoke:async cmd=>{calls.push(cmd);if(cmd==='daily_table_status')return {enabled:true,manualAttempt:last};if(failure)throw Error('offline');return result;}}});
 vm.runInContext(fs.readFileSync('src/app/js/updater.js','utf8')+';this.controls=()=>SupplyCheck.controls();',c);
 const root=c.controls(),[button,status]=root.children;
 return {calls,button,status,init:async()=>{for(const f of queue)await f();await Promise.resolve();},tick:n=>now+=n};
}
test('manual settings check reports success and prevents a second beta request for 60 seconds',async()=>{
 const f=fixture({result:{newPacks:2}});await f.init();await f.button.onclick();assert.equal(f.status.textContent,'2 new packs arrived.');assert.equal(f.button.textContent,'Check again in 60s');await f.button.onclick();assert.equal(f.calls.filter(c=>c==='supply_check').length,1);f.tick(60000);await f.button.onclick();assert.equal(f.calls.filter(c=>c==='supply_check').length,2);
});
test('Developer checks immediately again and connection failure has a short message',async()=>{
 const f=fixture({developer:true});await f.init();await f.button.onclick();await f.button.onclick();assert.equal(f.status.textContent,'Up to date.');assert.equal(f.calls.filter(c=>c==='supply_check').length,2);
 const bad=fixture({failure:true});await bad.init();await bad.button.onclick();assert.equal(bad.status.textContent,"Couldn't connect.");assert.equal(bad.button.disabled,true);
});
