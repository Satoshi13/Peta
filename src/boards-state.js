// Pure projection of the native snapshot into the existing Boards page.
export const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const item = p => ({k:p.stickerId,x:p.relativeX*100,y:p.relativeY*100,w:p.relativeScale*100,a:p.rotation,z:p.z,aspect:p.aspect||1,state:p.state||'held',onDisplay:p.onDisplay||null});
const clock = n => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export function project(status) {
  const displays=new Map((status.displays||[]).map(d=>[d.id,d]));
  return {
    location:status.location||{status:'unknown',prompted:false},
    screens:status.screens.map(s=>({...s,...displays.get(s.id),name:displays.get(s.id)?.name||s.id,kind:displays.get(s.id)?.kind||'display',aspect:displays.get(s.id)?.aspect||16/9,items:s.items.map(item)})),
    boards:status.boards.map(b=>({...b,items:b.stickers.map(item)})),
    rules:status.rules.map(r=>({id:r.id,type:r.kind,days:DAYS.filter((_,i)=>r.days&(1<<i)),start:clock(r.startMin||0),end:clock(r.endMin||0),wifi:r.wifi||'',screen:r.displayId,board:r.boardId,on:r.enabled})),
    stock:status.stock.available,owned:status.stock.owned,limit:status.stock.limit,undo:status.undo?{...status.undo,screen:status.undo.displayId,text:`Restore the previous look on ${displays.get(status.undo.displayId)?.name||status.undo.displayId}.`}:null,
  };
}
export function blocked(it,screen) {return it.state!=='held'?'No longer yours':it.onDisplay && it.onDisplay!==screen?.id?'On another screen':'';}
export function same(a,b) {
  return a.length===b.length && a.every(p=>{const q=b.find(q=>q.k===p.k);return q && Math.abs(p.x-q.x)<=.5 && Math.abs(p.y-q.y)<=.5 && Math.abs(p.w-q.w)<=1 && Math.abs(((p.a-q.a+180)%360+360)%360-180)<=1;});
}
export function tool(status,scraps,developer=false) {
  const price=scraps.tools?.find(t=>t.id==='board')?.exchange;
  const capped=status?.owned>=status?.limit;
  return {price,capped,disabled:price==null || capped || !developer && scraps.balance<price,label:capped?'You have all 12 boards.':!developer && scraps.balance<price?'Not enough Scraps':'Get a board'};
}
export function toRule(d) {const minute=v=>{const [h,m]=v.split(':').map(Number);return h*60+m;};return {id:d.id||'',sort:0,kind:d.type,days:d.type==='time'?DAYS.reduce((n,v,i)=>n|(d.days.includes(v)?1<<i:0),0):0,startMin:d.type==='time'?minute(d.start):null,endMin:d.type==='time'?minute(d.end):null,wifi:d.type==='place'?d.wifi.trim():null,displayId:d.screen,boardId:d.board,enabled:d.on};}

export const locationOff = location => location?.status !== 'on';
