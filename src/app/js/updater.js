/* Rust owns verification and installation. Notices wait until the desk is quiet. */
const UpdateUI = {
  state:null, later:null, checking:false, retry:null,
  safe() { return S.windowOpen && !document.hidden && !Bridge.busy && !Bridge.dialogOpen && !Shell.editing && !S.pending && !document.querySelector('.cer,dialog[open],.invite-screen'); },
  async init() {
    this.state=await Bridge.invoke('update_status').catch(()=>null);
    if(!this.state?.enabled)return;
    this.monitor=setInterval(()=>{if(!this.safe())document.querySelector(".update-notice")?.remove();this.offer();},1500);
    await this.check(false);
  },
  async check(manual=false) {
    if(this.checking || !this.state?.enabled)return;
    this.checking=true;
    try {
      this.state=await Bridge.invoke('update_check',{manual});
      if(manual)this.later=null;
      if(this.state.ready)this.offer();
      else if(manual)Shell.toast("You're up to date.");
    } catch { if(manual)Shell.toast("Peta couldn't check for updates. Please try again later."); }
    finally {this.checking=false;this.paint();}
  },
  paint() {
    document.querySelectorAll('.update-version').forEach(el=>{el.textContent=this.state ? `Peta ${this.state.version}` : '';});
    document.querySelectorAll('.update-check').forEach(el=>{el.hidden=!this.state?.enabled;el.disabled=this.checking;el.textContent=this.checking ? 'Checking…' : 'Check for updates';});
  },
  offer() {
    clearTimeout(this.retry);this.retry=null;
    if(!this.state?.ready || this.later===this.state.ready || document.querySelector('.update-notice'))return;
    if(!this.safe()){this.retry=setTimeout(()=>this.offer(),1500);return;}
    const restart=h('button.btn.paper.small',{type:'button',on:{click:async()=>{
      if(!this.safe())return;
      restart.disabled=later.disabled=true;restart.textContent='Updating…';document.body.inert=true;
      try {await Bridge.invoke('update_install');}
      catch {document.body.inert=false;notice.remove();this.state.ready=null;Shell.toast("Peta couldn't install this update. Please check again later.");}
    }}},'Restart to update');
    const later=h('button.link',{type:'button',on:{click:()=>{this.later=this.state.ready;notice.remove();}}},'Later');
    const notice=h('section.setcard.update-notice',{role:'status','aria-label':'Peta update'},h('p',`Peta ${this.state.ready} is ready.`),h('div.row-btns',restart,later));
    document.body.append(notice);
  },
  supplyCard() {
    const detail=h('p.small.muted','Checking the last supply check…'),problem=h('p.small.bd-error');
    const card=h('section.setcard',h('h2','Daily supply'),detail,problem);
    queueMicrotask(()=>Bridge.invoke('daily_table_status').then(s=>{if(!card.isConnected)return;detail.textContent=s.lastAttempt ? `Last checked ${new Date(Number(s.lastAttempt)*1000).toLocaleString()}` : 'No supply table has been checked yet.';problem.textContent=s.problem||'';}).catch(()=>{detail.textContent='Supply status is unavailable.';}));
    return card;
  },
  card() {
    const card=h('div.update-controls',h('p.small.muted.update-version'),SupplyCheck.controls(),h('button.btn.paper.small.update-check',{type:'button',hidden:true,on:{click:()=>this.check(true)}},'Check for updates'));
    queueMicrotask(()=>{this.paint();if(!this.state)Bridge.invoke('update_status').then(s=>{this.state=s;this.paint();}).catch(()=>{});});
    return card;
  },
};

const SupplyCheck = {
  controls() {
    const status=h('p.small.muted',{role:'status'}), button=h('button.btn.paper.small',{type:'button'},'Check for new packs and news');
    const root=h('div.supply-check',{hidden:true},button,status); let until=0, busy=false, timer;
    const paint=()=>{const left=Math.max(0,Math.ceil((until-Date.now())/1000));button.disabled=busy||left>0;button.textContent=busy?'Checking…':left?`Check again in ${left}s`:'Check for new packs and news';if(!root.isConnected)clearInterval(timer);};
    button.onclick=async()=>{
      if(busy||until>Date.now())return;busy=true;paint();
      try {
        const result=await Bridge.invoke('supply_check');
        if(!S.developer)until=Date.now()+(result.retryAfter||60)*1000;
        status.textContent=result.retryAfter?`Please wait ${result.retryAfter}s.`:result.problem?"Couldn't connect.":result.newPacks?`${result.newPacks} new pack${result.newPacks===1?'':'s'} arrived.`:'Up to date.';
      } catch { if(!S.developer)until=Date.now()+60000;status.textContent="Couldn't connect."; }
      finally {busy=false;paint();}
    };
    queueMicrotask(()=>Bridge.invoke('daily_table_status').then(s=>{if(!root.isConnected)return;root.hidden=!s.enabled;if(!S.developer&&s.manualAttempt)until=Number(s.manualAttempt)*1000+60000;paint();if(s.enabled)timer=setInterval(paint,1000);}).catch(()=>{}));
    return root;
  },
};
