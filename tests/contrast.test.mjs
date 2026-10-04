import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../src/app/css/base.css',import.meta.url),'utf8');
const tokens=block=>Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*(#[\da-f]{6})/gi)].map(m=>[m[1],m[2]]));
export function contrast(a,b) {
  const luminance=hex=>{
    const c=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return .2126*c[0]+.7152*c[1]+.0722*c[2];
  };
  const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
const day=tokens(css.match(/:root\s*{([^}]+)}/)[1]);
function check(palette) {
  for(const bg of ['--w-surface','--w-surface2','--w-win','--w-side','--w-sunken'])
    for(const fg of ['--ink','--ink2','--muted','--w-ok'])
      assert.ok(contrast(palette[fg],palette[bg])>=4.5,`${fg} on ${bg}: ${contrast(palette[fg],palette[bg])}`);
  assert.ok(contrast(palette['--w-btnfg'],palette['--w-btn'])>=4.5);
}
test('WCAG formula handles black, white and identical colours',()=>{
  assert.equal(contrast('#000000','#ffffff'),21);assert.equal(contrast('#655e51','#655e51'),1);
});
test('day UI text, status and primary button meet AA',()=>check(day));
