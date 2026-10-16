import {$,el,api,notice,action,confirmAction,date} from './ui.js';
let contract;
function editor(parent,initial,save) {
  const rows=[],grid=el('div',undefined,'daily-grid'),error=el('p',undefined,'daily-error'),forecast=el('div',undefined,'daily-forecast');error.setAttribute('role','status');
  for(const m of contract.materials) {
    const row=el('div',undefined,'daily-row'),label=el('label'),check=el('input'),swatch=el('i',undefined,'daily-swatch'),name=el('span'),weight=el('input'),percent=el('output');
    check.type='checkbox';check.checked=initial.some(i=>i.id===m.id);check.setAttribute('aria-label',`Include ${m.name}`);
    swatch.style.background=m.swatch;swatch.setAttribute('aria-hidden','true');name.append(el('span',m.name),el('small',m.rarity));label.append(check,swatch,name);
    weight.type='number';weight.min=1;weight.max=contract.limits.maxWeight;weight.step=1;weight.value=String(initial.find(i=>i.id===m.id)?.weight??1);weight.setAttribute('aria-label',`${m.name} weight`);
    percent.setAttribute('aria-label',`${m.name} chance`);row.append(label,weight,percent);grid.append(row);rows.push({m,check,weight,percent});check.onchange=weight.oninput=()=>refresh();
  }
  const items=()=>rows.filter(r=>r.check.checked).map(r=>({id:r.m.id,weight:Number(r.weight.value)}));
  function refresh() {
    const selected=items(),total=selected.reduce((s,i)=>s+i.weight,0);let message='';
    if(!selected.length || selected.length>contract.limits.maxItems)message='Choose 1 to 20 materials.';
    else if(selected.some(i=>!Number.isInteger(i.weight) || i.weight<1 || i.weight>contract.limits.maxWeight))message='Use whole weights from 1 to 1000.';
    else if((selected.find(i=>i.id==='matte')?.weight??0)*100<total*contract.limits.matteMinPercent)message='Matte must be at least 20%.';
    else if(rows.some(r=>r.check.checked && ['special','archive'].includes(r.m.rarity) && Number(r.weight.value)*100>total*contract.limits.limitedMaxPercent))message='Each Special or Archive material must be at most 5%.';
    for(const r of rows){r.weight.disabled=!r.check.checked;r.percent.textContent=r.check.checked && total>0 ? `${(Number(r.weight.value)/total*100).toFixed(1)}%`:'—';}
    error.textContent=message;save.disabled=!!message || parent.dataset.pending==='true';forecast.replaceChildren();
    if(!message){
      forecast.append(el('p','Expected in one week','hint'));
      const amounts=selected.map(i=>{const m=contract.materials.find(m=>m.id===i.id);return `${m.name} ${(i.weight/total*7).toFixed(2)}`;});
      forecast.append(el('p',amounts.join(' · ')));
      const scraps=selected.reduce((s,i)=>s+i.weight/total*7*contract.materials.find(m=>m.id===i.id).dismantle,0);
      forecast.append(el('p',`${scraps.toFixed(2)} Scraps if all seven sheets are dismantled.`,'hint'));
    }
  }
  parent.append(grid,error,forecast);refresh();return {items,refresh};
}
const localInput=(seconds)=>{const d=new Date(seconds*1000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
export async function loadDaily() {
  const data=await api('/api/daily');contract=data.contract;
  const normal=data.tables.find(t=>t.kind==='default' && t.state==='active'),root=$('daily-content');root.replaceChildren();
  const fixed=el('article',undefined,'card');fixed.append(el('h3','Built into Peta'),el('p','Matte 60% · Kraft 30% · Holographic 10%'),el('p','Used when no valid table is available. The first envelope is always Holographic.','hint'));root.append(fixed);
  for(const kind of ['default','event']) {
    const form=el('form',undefined,'card'),save=el('button',kind==='default'?'Save normal table':'Schedule event');save.type='submit';form.append(el('h3',kind==='default'?'Normal table':'A seasonal event'));
    let title,start,end;
    if(kind==='event') {
      const field=(name,type,value='')=>{const label=el('label',name),input=el('input');input.type=type;input.required=true;input.value=value;input.setAttribute('aria-label',name);label.append(input);form.append(label);return input;};
      title=field('Event name','text');title.maxLength=120;const now=Math.floor(Date.now()/1000);start=field('Starts','datetime-local',localInput(now));end=field('Ends','datetime-local',localInput(now+7*86400));form.append(el('p',`Times use ${Intl.DateTimeFormat().resolvedOptions().timeZone}. An event with a later start takes priority.`,'hint'));
    }
    const edit=editor(form,kind==='default' && normal?normal.items:contract.fixed,save);form.append(save);
    if(kind==='default' && normal) {const reset=el('button','Return to the built-in table','subtle');reset.type='button';reset.onclick=()=>stop(normal,reset);form.append(reset);}
    form.onsubmit=e=>{e.preventDefault();if(form.dataset.pending==='true')return;form.dataset.pending='true';edit.refresh();action(save,async()=>{await api('/api/daily',{kind,items:edit.items(),...(kind==='event'?{title:title.value,startsAt:Math.floor(new Date(start.value).getTime()/1000),endsAt:Math.floor(new Date(end.value).getTime()/1000)}:{})});notice('Daily supply saved. Today’s material stays the same.');await loadDaily();}).finally(()=>{delete form.dataset.pending;edit.refresh();});};root.append(form);
  }
  root.append(el('h3','Scheduled and recent tables'));
  for(const t of data.tables) {
    const card=el('article',undefined,'card');card.append(el('h3',t.title),el('p',`${t.kind==='default'?'Normal table':'Event'} · ${t.state}`),el('p',`${date(t.startsAt)} – ${date(t.endsAt)}`,'hint'));
    const total=t.items.reduce((n,i)=>n+i.weight,0);
    if(total>0 && t.items.every(i=>contract.materials.some(m=>m.id===i.id))) {
      card.append(el('p',t.items.map(i=>`${contract.materials.find(m=>m.id===i.id).name} ${(i.weight/total*100).toFixed(1)}%`).join(' · ')));
      card.append(el('p','Expected in one week: '+t.items.map(i=>`${contract.materials.find(m=>m.id===i.id).name} ${(i.weight/total*7).toFixed(2)}`).join(' · '),'hint'));
      const scraps=t.items.reduce((n,i)=>n+i.weight/total*7*contract.materials.find(m=>m.id===i.id).dismantle,0);
      card.append(el('p',`${scraps.toFixed(2)} Scraps if all seven sheets are dismantled.`,'hint'));
    }
    if(['active','scheduled'].includes(t.state)){const button=el('button','Stop','subtle');button.type='button';button.onclick=()=>stop(t,button);card.append(button);}root.append(card);
  }
}
async function stop(table,button) {if(await confirmAction('Stop this table?',table.kind==='default'?'New days will return to the built-in table after Peta checks in.':'Friends will return to the normal table after Peta checks in.'))await action(button,async()=>{await api('/api/daily/stop',{id:table.id});await loadDaily();notice('Table stopped.');});}
export function setupDaily() {$('refresh-daily').onclick=()=>action($('refresh-daily'),loadDaily);}
