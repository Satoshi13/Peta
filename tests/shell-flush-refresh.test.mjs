import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Shell.flushRefresh, run on its own: a refresh that arrived during a navigation is replayed once the navigation ends.
const source=readFileSync(new URL('../src/app/js/shell.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('  function flushRefresh() {'),source.indexOf('  function settled() {'));
function fixture({full,changes=[],editing=false,dialog=false,busy=false}) {
  const calls=[];
  const ctx=vm.createContext({refreshPending:true,navigating:false,fullRefresh:full,refreshChanges:new Set(changes),refreshWaiters:[],
    editing:()=>editing,blockedRefresh:()=>busy,document:{querySelector:()=>dialog?{}:null},refresh:o=>{calls.push(o.changes);},error(){}});
  vm.runInContext(body,ctx);
  return {calls,flush:()=>vm.runInContext('flushRefresh()',ctx),get pending(){return vm.runInContext('refreshPending',ctx);}};
}

test("Create's own refresh is not dropped when it arrived during the navigation that opens Create",async()=>{
  // the native image chooser closes: app-page "create" navigates while the cutting state asks for a full refresh
  const f=fixture({full:true,editing:true});await f.flush();
  assert.deepEqual(f.calls,[null]);assert.equal(f.pending,false);
});

test('background changes still wait for an edit, a dialog or a ceremony',async()=>{
  for(const hold of [{editing:true},{dialog:true},{busy:true}]){
    const f=fixture({full:false,changes:['lib'],...hold});await f.flush();
    assert.deepEqual(f.calls,[]);assert.equal(f.pending,true);
  }
  const free=fixture({full:false,changes:['lib']});await free.flush();
  assert.deepEqual(free.calls.map(c=>[...c]),[['lib']]);
});
