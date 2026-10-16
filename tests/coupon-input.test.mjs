import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/app/js/ui.js',import.meta.url),'utf8');
function fixture(){const ctx=vm.createContext({});vm.runInContext(source+';this.normalize=normalizeCouponCode;this.bind=couponCodeInput;',ctx);return ctx;}
test('coupon letters and fullwidth ASCII normalize without changing code grouping',()=>{
  const f=fixture();
  for(const [input,expected] of [['thankyou','THANKYOU'],['ｔｈａｎｋｙｏｕ','THANKYOU'],['ＰＥＴＡ１－ａｂｃｄ－１２３４','PETA1-ABCD-1234'],['aB-cD 12\n34','AB-CD 12\n34'],['　thankyou　',' THANKYOU ']])assert.equal(f.normalize(input),expected);
  assert.equal(f.normalize('ありがとう'),'ありがとう','unsupported text stays invalid instead of silently becoming another coupon');
});
test('IME composition stays intact until commit and normalizing keeps the cursor selection',()=>{
  const f=fixture(),events={},input={value:'',selectionStart:0,selectionEnd:0,selectionDirection:'forward',addEventListener:(name,fn)=>events[name]=fn,setSelectionRange(a,b,d){this.selectionStart=a;this.selectionEnd=b;this.selectionDirection=d;}};
  f.bind(input);events.compositionstart();input.value='ａｂｃ';input.selectionStart=1;input.selectionEnd=2;
  events.input({isComposing:true});assert.equal(input.value,'ａｂｃ');events.compositionend();assert.equal(input.value,'ABC');assert.deepEqual([input.selectionStart,input.selectionEnd],[1,2]);
  input.value='thankyou';events.input({isComposing:false});assert.equal(input.value,'THANKYOU');
});

test('Japanese text and invalid paste never remain in the coupon field',()=>{
  const f=fixture(),events={},input={value:'ABC',selectionStart:3,selectionEnd:3,selectionDirection:'none',addEventListener:(name,fn)=>events[name]=fn,setSelectionRange(a,b,d){this.selectionStart=a;this.selectionEnd=b;this.selectionDirection=d;}};
  f.bind(input);let prevented=false;events.beforeinput({data:'漢',preventDefault(){prevented=true;}});assert.equal(prevented,true);
  events.compositionstart();input.value='ABCありがとう';events.input({isComposing:true});events.compositionend();assert.equal(input.value,'ABC');
  input.value='thankyou漢字';events.input({isComposing:false});assert.equal(input.value,'ABC','reject the entire invalid edit, keeping the previous code');
});
test('physical letter keys produce ASCII caps with a Japanese IME and preserve shortcuts',()=>{
  const f=fixture(),events={},input={value:'',maxLength:4,selectionStart:0,selectionEnd:0,selectionDirection:'none',addEventListener:(name,fn)=>events[name]=fn,setSelectionRange(a,b,d){this.selectionStart=a;this.selectionEnd=b;this.selectionDirection=d;},setRangeText(text,a,b){this.value=this.value.slice(0,a)+text+this.value.slice(b);this.selectionStart=this.selectionEnd=a+text.length;}};
  f.bind(input);let prevented=0;const key=(code,extra={})=>events.keydown({code,key:'Process',preventDefault(){prevented++;},...extra});
  key('KeyT',{isComposing:true});key('KeyA');key('Digit2');key('Minus');key('KeyX');assert.equal(input.value,'TA2-');assert.equal(prevented,5);
  key('KeyV',{metaKey:true});assert.equal(prevented,5);
});
