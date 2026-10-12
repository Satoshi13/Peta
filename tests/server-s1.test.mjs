import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderBackCard} from '../src/back-card.js';
const ui=globalThis.PetaRefereeUI;
test('referee copy maps statuses and keeps codes in the developer edition',()=>{
 assert.equal(ui.label('checked'),'Checked by Peta');assert.equal(ui.label('pending'),'Waiting to check');for(const state of ['pre_server',undefined,null,'invalid'])assert.equal(ui.label(state),'Not checked');
 for(const [code,text] of Object.entries({offline:'Connect to the internet to do this. Nothing was changed.',already_claimed:'Someone already received this gift.',pending_cancel:"Peta is still taking back an earlier send. Try again when you're online.",clock_skew:"Check your Mac's date and time, then try again."})){assert.equal(ui.message(code),text);assert.equal(ui.message(code,true),`${text} [${code}]`);assert.ok(readFileSync(new URL('../src-tauri/crates/core/src/ownership.rs',import.meta.url),'utf8').includes(text));}
 assert.equal(ui.message('not_yours'),'Peta could not check this. Please try again.');
});
test('checked edition backs suppress the unchecked warning and copies omit a check',()=>{
 const old=globalThis.document;globalThis.document={createElement:tag=>({tag,dataset:{},children:[],textContent:'',append(...nodes){this.children.push(...nodes)}})};
 const texts=node=>[node.textContent,...node.children.flatMap(texts)].filter(Boolean);
 try {const checked=texts(renderBackCard({kind:'received',editionNumber:'0001',editionTotal:3,editionVerified:true,checked:'checked'}));assert.ok(checked.includes('Checked by Peta'));assert.ok(!checked.some(t=>t.includes('not checked by a server')));const pre=texts(renderBackCard({kind:'received',editionNumber:'0001',editionTotal:3,editionVerified:false,checked:'pre_server'}));assert.ok(pre.includes('Not checked'));assert.ok(pre.includes('Edition numbers are not checked by a server yet'));const copy=texts(renderBackCard({kind:'original',checked:null}));assert.ok(!copy.some(t=>['Not checked','Checked by Peta','Waiting to check'].includes(t)));}finally{globalThis.document=old;}
});
