/* Focus rings follow deliberate keyboard navigation, not the browser's initial autofocus. */
const FocusMode = {
  install() {
    const root=document.documentElement;root.dataset.focusMode="pointer";
    document.addEventListener("pointerdown",()=>{root.dataset.focusMode="pointer";},true);
    document.addEventListener("keydown",event=>{
      if(!event.metaKey && !event.ctrlKey && !event.altKey && ["Tab","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End"].includes(event.key))root.dataset.focusMode="keyboard";
    },true);
  },
};

// Codes use the same ASCII alphabet whether typed, pasted or committed by an IME.
function normalizeCouponCode(value) {
  return value.replace(/[\uFF01-\uFF5E]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/\u3000/g," ").replace(/[a-z]/g,c=>c.toUpperCase());
}
function couponCodeInput(input) {
  let composing=false,accepted="",selection=[0,0,"none"];
  const allowed=value=>/^[A-Z0-9\s-]*$/.test(value);
  const normalize=()=>{
    const value=input.value,next=normalizeCouponCode(value);
    if(!allowed(next)) {input.value=accepted;input.setSelectionRange(...selection);return;}
    const start=input.selectionStart,end=input.selectionEnd,direction=input.selectionDirection;
    input.value=next;accepted=next;
    if(start!=null){selection=[normalizeCouponCode(value.slice(0,start)).length,normalizeCouponCode(value.slice(0,end)).length,direction];input.setSelectionRange(...selection);}
  };
  // This field accepts physical letter/number keys directly, even with a Japanese IME active.
  // Do not change the system input source or interfere with shortcuts and paste.
  input.addEventListener("keydown",event=>{
    if(event.defaultPrevented || input.disabled || input.readOnly || event.metaKey || event.ctrlKey || event.altKey)return;
    const letter=/^Key([A-Z])$/.exec(event.code),digit=/^Digit([0-9])$/.exec(event.code);
    const text=letter?.[1] || digit?.[1] || (event.code==="Minus" ? "-" : null);
    if(!text)return;
    event.preventDefault();normalize();if(input.maxLength>0 && input.value.length-(input.selectionEnd-input.selectionStart)+text.length>input.maxLength)return;input.setRangeText(text,input.selectionStart,input.selectionEnd,"end");normalize();
  });
  input.addEventListener("beforeinput",event=>{
    if(!composing && !event.isComposing && event.data && !allowed(normalizeCouponCode(event.data)))event.preventDefault();
  });
  input.addEventListener("compositionstart",()=>{composing=true;});
  input.addEventListener("compositionend",()=>{composing=false;normalize();});
  input.addEventListener("input",event=>{if(!composing && !event.isComposing)normalize();});
  normalize();return normalize;
}

/* Shared interaction rules. Physical objects keep their own artwork; controls share behavior. */
const ViewState = {
  key(el, root) {
    if (!el || el === root) return "";
    const parts = [];
    for (let node = el; node && node !== root; node = node.parentElement) {
      if (node.id) { parts.unshift("#" + CSS.escape(node.id)); break; }
      let part = node.localName;
      const identity = ["data-resource", "data-action", "data-sticker", "data-screen", "data-board", "data-m", "data-page", "aria-label", "name"].find(a => node.hasAttribute(a));
      if (identity) part += `[${identity}=${JSON.stringify(node.getAttribute(identity))}]`;
      else {
        part += [...node.classList].map(c => "." + CSS.escape(c)).join("");
        const peers = node.parentElement ? [...node.parentElement.children].filter(n => n.localName === node.localName) : [];
        if (peers.length > 1) part += `:nth-of-type(${peers.indexOf(node) + 1})`;
      }
      parts.unshift(part);
    }
    return parts.join(" > ");
  },
  capture(root) {
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    const editable = active?.matches('textarea,input:not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="range"])');
    return {
      focus: active ? this.key(active, root) : null,
      value: editable ? active.value : null,
      selection: editable && typeof active.selectionStart === "number" ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null,
      scroll: [root, ...root.querySelectorAll(".page-in,.st-scroll,.st-grid,.nav-top,[data-preserve-scroll]")].map(el => ({key:this.key(el, root), top:el.scrollTop, left:el.scrollLeft}))
    };
  },
  restore(root, saved, {focus = true} = {}) {
    if (!saved) return;
    for (const s of saved.scroll) {
      const el = s.key ? root.querySelector(s.key) : root;
      if (el) { el.scrollTop = s.top; el.scrollLeft = s.left; }
    }
    const active = saved.focus && root.querySelector(saved.focus);
    if (focus && active && !active.disabled) {
      if (saved.value != null) active.value = saved.value;
      active.focus({preventScroll:true});
      if (saved.selection) active.setSelectionRange?.(...saved.selection);
    }
  }
};

const Dialogs = {
  open(dialog) {
    const opener = document.activeElement;
    const page = typeof Shell !== "undefined" ? Shell.current : null;
    const key = page?.contains(opener) ? ViewState.key(opener, page) : null;
    dialog.addEventListener("keydown", e => { if (e.key === "Escape") e.stopPropagation(); });
    dialog.addEventListener("close", () => {
      Bridge.dialogOpen = !!document.querySelector("dialog[open]");
      queueMicrotask(async () => {
        const parent=document.querySelector("dialog[open]");
        if(parent) {
          const target=opener?.isConnected && parent.contains(opener) && !opener.disabled ? opener : parent.querySelector('input:not(:disabled),textarea:not(:disabled),button:not(:disabled)');
          target?.focus({preventScroll:true});return;
        }
        if(Shell.navigating)await Shell.settled();
        if (document.querySelector("dialog[open]")) return;
        const replacement = page === Shell.current && key ? Shell.current?.querySelector(key) : null;
        const target = [page === Shell.current && opener?.isConnected ? opener : null, replacement, Shell.current?.querySelector(".ph h1")].find(el=>el?.isConnected && !el.disabled);
        target?.focus({preventScroll:true});
        Shell.flushRefresh?.();
      });
    }, {once:true});
    Bridge.dialogOpen = true;
    dialog.showModal();
    return dialog;
  }
};

function userError(error) {
  const raw = String(error?.message || error);
  if (/too large/i.test(raw)) return "This image is too large. Choose one smaller than 80 MB.";
  if (/unsupported|not a picture|decode|image format/i.test(raw)) return "This image could not be opened. Choose a PNG, JPEG or WebP image.";
  if (/offline|network|connection|timed? out/i.test(raw)) return "The connection could not be completed. Check your connection and try again.";
  if (/permission|denied|not permitted/i.test(raw)) return "Peta could not access this item. Check its permissions and try again.";
  if (/space|disk full/i.test(raw)) return "There is not enough disk space. Free some space and try again.";
  if (/^(Choose|You |No |Not |This |That |Cannot |Could not |Please |Saved, but )/.test(raw) && raw.length < 200 && !/[{}\n]|SQL|sqlite|os error|panic|stack/i.test(raw)) return raw;
  return "This action could not be completed. Please try again.";
}
