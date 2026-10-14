/* Private beta: the first start asks for the invite code from the download page (src-tauri/src/invite.rs).
   The same paper and ticket as Redeem code. There is no Cancel, only Quit: the server will not talk to this Mac without a code. */
const Invite = {
  open: false,
  async ensure() {
    Bridge.listen('invite-needed', () => { if(!this.open) this.ask(false); });
    let state;
    try { state = await Bridge.invoke('invite_status'); }
    catch(e) { console.error(e); return; }   // the server still refuses an uninvited key; never lock someone out over a local error
    if(state.needed) await this.ask(state.offline);
  },
  ask(offline) {
    this.open = true;
    return new Promise(resolve => {
      document.querySelector('dialog')?.close();
      const input=h("input", {type:"text",maxLength:40,required:true,placeholder:"XXXXX-XXXXX",autocapitalize:"characters",autocomplete:"off",spellcheck:false,"aria-label":"Invite code"});
      const status=h("p.small.rd-status",{role:"status"}, offline ? "Peta needs the internet the first time it starts." : "");
      const submit=h("button.btn.rd-go",{type:"submit"},"Start Peta");
      const quit=h("button.rd-cancel.link",{type:"button",on:{click:()=>Bridge.invoke('invite_quit')}},"Quit Peta");
      let pending=false;
      const form=h("form.rd-paper",{on:{submit:async e=>{
        e.preventDefault(); if(pending) return; pending=true; submit.disabled=true; input.disabled=true; status.textContent="";
        try { await Bridge.invoke('invite_redeem',{code:input.value}); dialog.close(); }
        catch(error) { status.textContent=String(error); input.disabled=false; input.focus(); input.select(); }
        finally { pending=false; submit.disabled=false; }
      }}}, h("h2","Welcome to Peta"), h("p.rd-sub","Enter the invite code from your download page."), h("div.rd-ticket",input), status, submit, quit,
        h("small.rd-note","Each code works on one Mac. Yours is on the Peta download page."));
      const dialog=h("dialog.rd-dialog",{"aria-label":"Peta invite code",on:{
        // Modal dialogs make the titlebar inert. The backdrop and paper can still move the window.
        mousedown:e=>{if(e.button===0 && !e.target.closest('input, textarea, select, button, a, [contenteditable]')){e.preventDefault();Bridge.window.startDragging();}},
        cancel:e=>{e.preventDefault();},keydown:e=>{if(e.key==="Escape")e.stopPropagation();},close:()=>{dialog.remove();Bridge.dialogOpen=false;this.open=false;resolve();}
      }},form);
      Bridge.dialogOpen=true; document.body.append(dialog); dialog.showModal(); input.focus();
    });
  },
};
