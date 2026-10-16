import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/app/js/today.js',import.meta.url),'utf8');
class Element {
  constructor(tag,props,children){this.tag=tag;this.props=props;Object.assign(this,props);this.children=children.flat(Infinity).filter(x=>x!=null);}
  append(...children){this.children.push(...children.flat(Infinity));}
  replaceChildren(...children){this.children=children.filter(x=>x!=null);}
}
function h(tag,...args){const props=args[0]&&typeof args[0]==='object'&&!Array.isArray(args[0])&&!(args[0] instanceof Element)?args.shift():{};return new Element(tag,props,args);}
const nodes=el=>el instanceof Element?[el,...el.children.flatMap(nodes)]:[];
const text=el=>el instanceof Element?el.children.map(text).join(''):String(el??'');
function fixture(answer){
  const calls=[];
  const context=vm.createContext({h,Pages:{},S:{},Snd:{tap(){}},Shell:{toast(){}},Bridge:{invoke:async(cmd,args)=>{calls.push({cmd,args});return answer(cmd,args);}}});
  vm.runInContext(source+';this.TodayNotice=TodayNotice;',context);
  return {notice:context.TodayNotice,calls};
}
const settle=()=>new Promise(r=>setTimeout(r));
test('the newest announcement shows as plain text with a built-in link, and closing it is remembered',async()=>{
  const f=fixture(cmd=>cmd==='announcement_current'?{id:'news-1',kind:'event',text:'<img src=x onerror=alert(1)> Autumn week',link:'download'}:undefined);
  const host=f.notice.host();await settle();
  const banner=host.children[0];
  assert.equal(banner.tag,'aside.t-notice');assert.equal(banner.data.kind,'event');
  assert.match(text(banner),/<img src=x onerror=alert\(1\)> Autumn week/);
  assert.ok(nodes(banner).every(n=>!('html' in n.props)),'never set as HTML');
  assert.match(text(banner),/Open the download page/);
  const link=nodes(banner).find(n=>n.tag==='button.link.t-notice-link');await link.on.click();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))),{cmd:'announcement_open',args:{link:'download'}});
  nodes(banner).find(n=>n.tag==='button.t-notice-x').on.click();
  assert.equal(host.children.length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))),{cmd:'announcement_dismiss',args:{id:'news-1'}});
  assert.equal(f.notice.data,null,'a rebuilt Today page does not show it again');
});
test('no announcement, builds without the server, unknown links and kinds show nothing extra',async()=>{
  let f=fixture(()=>null);let host=f.notice.host();await settle();assert.equal(host.children.length,0);
  f=fixture(()=>{throw new Error('Command not found');});host=f.notice.host();await settle();assert.equal(host.children.length,0);
  f=fixture(()=>({id:'n',kind:'party',text:'Hi',link:'https://example.com'}));host=f.notice.host();await settle();
  assert.equal(nodes(host).some(n=>n.tag==='button.link.t-notice-link'),false);
  assert.equal(host.children[0].data.kind,'info');
});
