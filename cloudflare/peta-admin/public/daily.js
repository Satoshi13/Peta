import { state, rarity, materialName,$,el,api,notice,action,confirmAction,date} from './ui.js';
let contract;
function editor(parent,initial,save) {
  const rows=[],grid=el('div',undefined,'daily-grid'),error=el('p',undefined,'daily-error'),forecast=el('div',undefined,'daily-forecast');error.setAttribute('role','status');
  for(const m of contract.materials) {
    const row=el('div',undefined,'daily-row'),label=el('label'),check=el('input'),swatch=el('i',undefined,'daily-swatch'),name=el('span'),weight=el('input'),percent=el('output');
    check.type='checkbox';check.checked=initial.some(i=>i.id===m.id);check.setAttribute('aria-label',`${materialName(m.id)}を含める`);
    swatch.style.background=m.swatch;swatch.setAttribute('aria-hidden','true');name.append(el('span',materialName(m.id)),el('small',rarity(m.rarity)));label.append(check,swatch,name);
    weight.type='number';weight.min=1;weight.max=contract.limits.maxWeight;weight.step=1;weight.value=String(initial.find(i=>i.id===m.id)?.weight??1);weight.setAttribute('aria-label',`${materialName(m.id)}の重み`);
    percent.setAttribute('aria-label',`${materialName(m.id)}の確率`);row.append(label,weight,percent);grid.append(row);rows.push({m,check,weight,percent});check.onchange=weight.oninput=()=>refresh();
  }
  const items=()=>rows.filter(r=>r.check.checked).map(r=>({id:r.m.id,weight:Number(r.weight.value)}));
  function refresh() {
    const selected=items(),total=selected.reduce((s,i)=>s+i.weight,0);let message='';
    if(!selected.length || selected.length>contract.limits.maxItems)message="素材を1～20種類選んでください。";
    else if(selected.some(i=>!Number.isInteger(i.weight) || i.weight<1 || i.weight>contract.limits.maxWeight))message="重みは1～1000の整数で指定してください。";
    else if((selected.find(i=>i.id==='matte')?.weight??0)*100<total*contract.limits.matteMinPercent)message="マットは20%以上にしてください。";
    else if(rows.some(r=>r.check.checked && ['special','archive'].includes(r.m.rarity) && Number(r.weight.value)*100>total*contract.limits.limitedMaxPercent))message="SpecialまたはArchive素材は、それぞれ5%以下にしてください。";
    for(const r of rows){r.weight.disabled=!r.check.checked;r.percent.textContent=r.check.checked && total>0 ? `${(Number(r.weight.value)/total*100).toFixed(1)}%`:'—';}
    error.textContent=message;save.disabled=!!message || parent.dataset.pending==='true';forecast.replaceChildren();
    if(!message){
      forecast.append(el('p',"1週間で届く見込み",'hint'));
      const amounts=selected.map(i=>{const m=contract.materials.find(m=>m.id===i.id);return `${materialName(m.id)} ${(i.weight/total*7).toFixed(2)}枚`;});
      forecast.append(el('p',amounts.join(' · ')));
      const scraps=selected.reduce((s,i)=>s+i.weight/total*7*contract.materials.find(m=>m.id===i.id).dismantle,0);
      forecast.append(el('p',`7枚すべてをくずした場合は ${scraps.toFixed(2)} Scraps。`,'hint'));
    }
  }
  parent.append(grid,error,forecast);refresh();return {items,refresh};
}
const localInput=(seconds)=>{const d=new Date(seconds*1000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
export async function loadDaily() {
  const data=await api('/api/daily');contract=data.contract;
  const normal=data.tables.find(t=>t.kind==='default' && t.state==='active'),root=$('daily-content');root.replaceChildren();
  const fixed=el('article',undefined,'card');fixed.append(el('h3',"Peta内蔵設定"),el('p','マット 60% · クラフト 30% · ホログラム 10%'),el('p',"有効なテーブルがない場合に使用します。最初の封筒は常にホログラフィックです。",'hint'));root.append(fixed);
  for(const kind of ['default','event']) {
    const form=el('form',undefined,'card'),save=el('button',kind==='default'?"通常テーブルを保存":"イベントを予定");save.type='submit';form.append(el('h3',kind==='default'?"通常の確率表":"期間限定の配布"));
    let title,start,end;
    if(kind==='event') {
      const field=(name,type,value='')=>{const label=el('label',name),input=el('input');input.type=type;input.required=true;input.value=value;input.setAttribute('aria-label',name);label.append(input);form.append(label);return input;};
      title=field("イベント名",'text');title.maxLength=120;const now=Math.floor(Date.now()/1000);start=field("開始",'datetime-local',localInput(now));end=field("終了",'datetime-local',localInput(now+7*86400));form.append(el('p',`入力時刻：${Intl.DateTimeFormat().resolvedOptions().timeZone}。開始が後のイベントを優先します。`,'hint'));
    }
    const edit=editor(form,kind==='default' && normal?normal.items:contract.fixed,save);form.append(save);
    if(kind==='default' && normal) {const reset=el('button',"内蔵テーブルに戻す",'subtle');reset.type='button';reset.onclick=()=>stop(normal,reset);form.append(reset);}
    form.onsubmit=e=>{e.preventDefault();if(form.dataset.pending==='true')return;form.dataset.pending='true';edit.refresh();action(save,async()=>{await api('/api/daily',{kind,items:edit.items(),...(kind==='event'?{title:title.value,startsAt:Math.floor(new Date(start.value).getTime()/1000),endsAt:Math.floor(new Date(end.value).getTime()/1000)}:{})});notice("配布を保存しました。反映は友達の次の日の封筒からです。");await loadDaily();}).finally(()=>{delete form.dataset.pending;edit.refresh();});};root.append(form);
  }
  root.append(el('h3',"予定済み・最近のテーブル"));
  for(const t of data.tables) {
    const card=el('article',undefined,'card');card.append(el('h3',t.title),el('p',`${t.kind==='default'?"通常の確率表":"イベント"} · ${state(t.state)}`),el('p',`${date(t.startsAt)} – ${date(t.endsAt)}`,'hint'));
    const total=t.items.reduce((n,i)=>n+i.weight,0);
    if(total>0 && t.items.every(i=>contract.materials.some(m=>m.id===i.id))) {
      card.append(el('p',t.items.map(i=>`${materialName(i.id)} ${(i.weight/total*100).toFixed(1)}%`).join(' · ')));
      card.append(el('p',"1週間で届く見込み："+t.items.map(i=>`${materialName(i.id)} ${(i.weight/total*7).toFixed(2)}`).join(' · '),'hint'));
      const scraps=t.items.reduce((n,i)=>n+i.weight/total*7*contract.materials.find(m=>m.id===i.id).dismantle,0);
      card.append(el('p',`7枚すべてをくずした場合は ${scraps.toFixed(2)} Scraps。`,'hint'));
    }
    if(['active','scheduled'].includes(t.state)){const button=el('button',"停止",'subtle');button.type='button';button.onclick=()=>stop(t,button);card.append(button);}root.append(card);
  }
}
async function stop(table,button) {if(await confirmAction("この確率表を停止しますか？",table.kind==='default'?"次回の取得後、新しい日の封筒から内蔵の確率に戻ります。":"次回の取得後、通常の確率表に戻ります。"))await action(button,async()=>{await api('/api/daily/stop',{id:table.id});await loadDaily();notice("テーブルを停止しました。");});}
export function setupDaily() {$('refresh-daily').onclick=()=>action($('refresh-daily'),loadDaily);}
