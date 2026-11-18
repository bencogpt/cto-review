document.querySelectorAll('.filters button').forEach(function(b){b.addEventListener('click',function(){
var f=b.dataset.f;document.querySelectorAll('.filters button').forEach(function(x){x.classList.toggle('on',x===b)});
document.querySelectorAll('.item').forEach(function(it){it.classList.toggle('hidden',f!=='all'&&it.dataset.tag!==f)});
document.querySelectorAll('.topic').forEach(function(s){s.classList.toggle('hidden',!s.querySelector('.item:not(.hidden)'))});});});
// print button on brief pages (no inline handlers: CSP script-src 'self')
document.querySelectorAll('[data-print]').forEach(function(b){b.addEventListener('click',function(){window.print()})});
// "שמירה כ-PDF": temporarily set a dated title so the browser's Save as PDF suggests CTO-Review-YYYY-MM-DD
document.querySelectorAll('[data-save-pdf]').forEach(function(b){
  b.addEventListener('click',function(){
    var date=b.getAttribute('data-date')||'';
    var want=date?('CTO-Review-'+date):'CTO-Review';
    var prev=document.title;
    document.title=want;
    function restore(){
      document.title=prev;
      window.removeEventListener('afterprint',restore);
    }
    window.addEventListener('afterprint',restore);
    window.print();
  });
});
// archive search: filters /archive/ by date, title, headlines and summaries using the small search.json index
(function(){
var box=document.getElementById('archive-groups'),q=document.getElementById('aq');if(!box||!q)return;
var cnt=document.getElementById('acnt'),empty=document.getElementById('aempty'),idx=null,t;
var rows=Array.prototype.slice.call(box.querySelectorAll('li[data-date]'));
function norm(s){return String(s||'').toLowerCase().replace(/[\u0591-\u05C7]/g,'').replace(/[״"׳']/g,'')}
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
function build(data){idx={};data.forEach(function(b){var p=b.date.split('-'),dm=(+p[2])+'.'+(+p[1])+'.'+p[0];
  idx[b.date]={head:norm([b.date,dm,(+p[2])+'/'+(+p[1])+'/'+p[0],b.he,b.title].join(' ')),
    items:b.items.map(function(it){return{id:it.id,h:it.h,q:norm(it.h+' '+it.s)}})}})}
function apply(){
  var terms=norm(q.value).trim().split(/\s+/).filter(Boolean),n=0;
  rows.forEach(function(r){var old=r.querySelector('.hits');if(old)r.removeChild(old);
    var e=(idx&&idx[r.dataset.date])||{head:norm(r.textContent),items:[]},ok=true,hits=[];
    if(terms.length){
      var all=e.head+' '+e.items.map(function(i){return i.q}).join(' ');
      ok=terms.every(function(w){return all.indexOf(w)>=0});
      if(ok)hits=e.items.filter(function(i){return terms.some(function(w){return i.q.indexOf(w)>=0})});
    }
    r.hidden=!ok;if(ok)n++;
    if(ok&&hits.length){var ul=el('ul','hits'),href=r.querySelector('a').getAttribute('href');
      hits.slice(0,6).forEach(function(i){var li=el('li'),a=el('a',null,'• '+i.h);a.href=href+'#'+(i.a||('item-'+encodeURIComponent(i.id)));li.appendChild(a);ul.appendChild(li)});
      if(hits.length>6)ul.appendChild(el('li',null,'ועוד '+(hits.length-6)+' ידיעות תואמות'));
      r.appendChild(ul)}
  });
  box.querySelectorAll('.agroup').forEach(function(g){g.hidden=!g.querySelector('li[data-date]:not([hidden])')});
  cnt.textContent=terms.length?('נמצאו '+n+' מתוך '+rows.length+' סקירות'):'';
  empty.classList.toggle('hidden',n>0);
  history.replaceState(null,'',q.value.trim()?'#q='+encodeURIComponent(q.value.trim()):location.pathname);
}
fetch(box.dataset.index,{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(d){build(d);apply()})
  .catch(function(){idx=null;apply()});
q.addEventListener('input',function(){clearTimeout(t);t=setTimeout(apply,80)});
if(location.hash.indexOf('#q=')===0)q.value=decodeURIComponent(location.hash.slice(3));
})();
// dark mode: persisted in localStorage; theme.js applies it before paint
(function(){
  var KEY="cto-review-theme";
  var btn=document.querySelector("[data-theme-toggle]");
  if(!btn)return;
  function cur(){return document.documentElement.getAttribute("data-theme")==="dark"?"dark":"light"}
  function paint(){
    var d=cur()==="dark";
    btn.setAttribute("aria-pressed",d?"true":"false");
    btn.setAttribute("aria-label",d?"Light mode":"Dark mode");
    btn.setAttribute("title",d?"Light mode":"Dark mode");
  }
  paint();
  btn.addEventListener("click",function(){
    var next=cur()==="dark"?"light":"dark";
    document.documentElement.setAttribute("data-theme",next);
    var meta=document.querySelector('meta[name="color-scheme"]');
    if(meta)meta.setAttribute("content",next);
    try{localStorage.setItem(KEY,next)}catch(e){}
    paint();
  });
})();

// Emerging-tech heat tooltip: CSS handles hover/focus; this adds tap toggle,
// Escape to dismiss, and click-outside to close (no inline handlers; CSP script-src 'self').
(function(){
  var wraps=document.querySelectorAll(".heat");
  if(!wraps.length)return;
  function setOpen(el,on){
    el.classList.toggle("is-open",!!on);
    if(!on)el.classList.remove("is-open");
    var b=el.querySelector(".heat-btn");
    if(b)b.setAttribute("aria-expanded",on?"true":"false");
  }
  function closeAll(except){
    wraps.forEach(function(el){
      if(el===except)return;
      setOpen(el,false);
      el.classList.remove("tip-dismissed");
    });
  }
  wraps.forEach(function(el){
    var btn=el.querySelector(".heat-btn");
    if(!btn)return;
    btn.addEventListener("click",function(e){
      e.preventDefault();
      e.stopPropagation();
      var on=!el.classList.contains("is-open");
      closeAll(el);
      el.classList.remove("tip-dismissed");
      setOpen(el,on);
    });
    el.addEventListener("mouseleave",function(){
      setOpen(el,false);
      el.classList.remove("tip-dismissed");
    });
    el.addEventListener("focusout",function(e){
      if(el.contains(e.relatedTarget))return;
      setOpen(el,false);
      el.classList.remove("tip-dismissed");
    });
  });
  document.addEventListener("click",function(){closeAll()});
  document.addEventListener("keydown",function(e){
    if(e.key!=="Escape")return;
    wraps.forEach(function(el){
      setOpen(el,false);
      if(el.contains(document.activeElement))el.classList.add("tip-dismissed");
    });
  });
})();

// ---- Floating UI: back-to-top + jump-to-section menu --------------------------------------
// Shown only after the masthead leaves the viewport (IntersectionObserver, no scroll listeners).
(function(){
  var head=document.querySelector(".masthead"),top=document.querySelector("[data-to-top]");
  var jumpBtn=document.querySelector("[data-jump-btn]"),menu=document.getElementById("jump-menu");
  var main=document.getElementById("main"),root=document.documentElement;
  var reduce=window.matchMedia("(prefers-reduced-motion: reduce)");
  function focusMain(){if(main)main.focus({preventScroll:true})}
  if(head&&top&&"IntersectionObserver" in window){
    new IntersectionObserver(function(es){
      var away=!es[es.length-1].isIntersecting;
      root.classList.toggle("is-scrolled",away);
      if(!away){
        // controls are about to hide: don't strand keyboard focus on an invisible button
        if(document.activeElement===top||document.activeElement===jumpBtn)focusMain();
        closeMenu();
      }
    }).observe(head);
  }
  if(top)top.addEventListener("click",function(){
    window.scrollTo({top:0,behavior:reduce.matches?"instant":"smooth"});
    focusMain();
  });
  // jump menu: native Popover API (popovertarget: Escape + light dismiss built in); small fallback otherwise
  var native=!!(menu&&Object.prototype.hasOwnProperty.call(HTMLElement.prototype,"popover"));
  function closeMenu(){
    if(!menu)return;
    if(native){try{if(menu.matches(":popover-open"))menu.hidePopover()}catch(e){}}
    else{menu.classList.remove("open");if(jumpBtn)jumpBtn.setAttribute("aria-expanded","false")}
  }
  if(menu&&jumpBtn){
    if(!native){
      jumpBtn.setAttribute("aria-expanded","false");jumpBtn.setAttribute("aria-controls","jump-menu");
      jumpBtn.addEventListener("click",function(e){e.stopPropagation();
        var on=!menu.classList.contains("open");menu.classList.toggle("open",on);jumpBtn.setAttribute("aria-expanded",on?"true":"false");
        if(on){var f=menu.querySelector("a");if(f)f.focus()}});
      document.addEventListener("click",function(e){if(!menu.contains(e.target))closeMenu()});
      document.addEventListener("keydown",function(e){if(e.key==="Escape"&&menu.classList.contains("open")){closeMenu();jumpBtn.focus()}});
    }else{
      menu.addEventListener("toggle",function(e){if(e.newState==="open"){var f=menu.querySelector("a");if(f)f.focus()}});
    }
    menu.querySelectorAll("a").forEach(function(a){a.addEventListener("click",function(){
      closeMenu();
      var t=document.getElementById(a.getAttribute("href").slice(1));
      if(t){var h=t.querySelector("h2");if(h){h.setAttribute("tabindex","-1");setTimeout(function(){h.focus({preventScroll:true})},0)}}
    })});
  }
})();

// ---- Reading progress bar: CSS scroll-driven animation; JS fallback only when unsupported ----
(function(){
  var bar=document.querySelector(".read-progress");
  if(!bar||(window.CSS&&CSS.supports&&CSS.supports("animation-timeline","scroll()")))return;
  var queued=false;
  function paint(){queued=false;var d=document.documentElement,max=d.scrollHeight-d.clientHeight;
    bar.style.transform="scaleX("+(max>0?Math.min(1,Math.max(0,d.scrollTop/max)):0)+")"}
  function req(){if(!queued){queued=true;requestAnimationFrame(paint)}}
  window.addEventListener("scroll",req,{passive:true});window.addEventListener("resize",req,{passive:true});paint();
})();

// ---- Per-item share: Web Share API on touch devices, clipboard elsewhere, manual-copy dialog as last resort ----
(function(){
  var btns=document.querySelectorAll("[data-share]");
  if(!btns.length)return;
  var toast=document.getElementById("toast"),tt=null,last="";
  function say(msg){
    if(!toast)return;
    if(msg===last)msg+="\u00A0"; // VoiceOver skips identical repeats
    last=msg;toast.textContent=msg;toast.classList.add("show");
    clearTimeout(tt);tt=setTimeout(function(){toast.classList.remove("show");toast.textContent=""},3200);
  }
  function legacyCopy(text){
    var f=document.createElement("textarea");f.value=text;f.setAttribute("readonly","");f.className="copy-buf";
    document.body.appendChild(f);f.select();
    try{return document.execCommand("copy")}catch(e){return false}finally{f.remove()}
  }
  var dlg=null;
  function manual(text){
    if(typeof HTMLDialogElement!=="function"){say("לא ניתן להעתיק אוטומטית");return}
    if(!dlg){
      dlg=document.createElement("dialog");dlg.className="share-dlg";dlg.setAttribute("aria-labelledby","share-dlg-h");
      dlg.innerHTML='<h2 id="share-dlg-h">העתקה ידנית</h2><p>ההעתקה האוטומטית נחסמה. הטקסט מסומן – העתיקו אותו (Ctrl+C / ⌘C).</p>'
        +'<textarea readonly rows="7" aria-labelledby="share-dlg-h"></textarea><form method="dialog"><button class="print-btn">סגירה</button></form>';
      document.body.appendChild(dlg);
    }
    var ta=dlg.querySelector("textarea");ta.value=text;dlg.showModal();ta.focus();ta.select();
  }
  var touch=window.matchMedia("(pointer: coarse)").matches;
  btns.forEach(function(b){b.addEventListener("click",function(){
    var title=b.getAttribute("data-share-title")||"",sum=b.getAttribute("data-share-text")||"";
    var url=new URL(b.getAttribute("data-share-url")||location.pathname,location.origin).href;
    var text=title+"\n"+sum+"\n"+url;
    var data={title:title,text:title+"\n"+sum,url:url};
    if(touch&&navigator.share&&(!navigator.canShare||navigator.canShare(data))){
      navigator.share(data).catch(function(e){if(e&&e.name==="AbortError")return;copy(text)});
      return;
    }
    copy(text);
  })});
  function copy(text){
    function ok(){say("הועתק – כותרת, תקציר וקישור")}
    function fail(){if(legacyCopy(text))ok();else manual(text)}
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(ok,fail);else fail();
  }
})();

// Glossary toggletips (build.py gl_html, 2026-11-18). Markup is declarative:
// <button class="term" popovertarget=ID popovertargetaction="show" interestfor=ID aria-expanded> + <span id=ID class="gl-note" popover="hint" role="tooltip">.
// Native: interestfor = hover/focus/long-press, popovertarget = click/tap/Enter, popover = Esc + light dismiss.
// Here: aria-expanded sync, hint->auto fallback, hover/focus fallback without interestfor, explicit anchor names
// (CSS anchor positioning puts the note in the left margin on desktop, under the term on narrow screens),
// coordinates for browsers without anchor positioning, and a class-based fallback without the Popover API.
(function(){
  var terms=document.querySelectorAll('.term[popovertarget]');if(!terms.length)return;
  var hasPopover=Object.prototype.hasOwnProperty.call(HTMLElement.prototype,'popover');
  var hasInterest='interestForElement' in HTMLButtonElement.prototype;
  var hasAnchor=!!(window.CSS&&CSS.supports&&CSS.supports('anchor-name: --a'));
  var wide=window.matchMedia('(min-width: 901px)');
  var main=document.querySelector('main');
  var openNote=null;
  if(hasPopover){
    var probe=document.createElement('div');probe.popover='hint';
    if(probe.popover!=='hint'){
      // popover="hint" unsupported: switch to auto before opening so it light-dismisses (must happen in beforetoggle)
      document.addEventListener('beforetoggle',function(e){var t=e.target;
        if(e.newState==='open'&&t.classList&&t.classList.contains('gl-note')&&t.getAttribute('popover')==='hint')t.popover='auto'},true);
    }
  }
  function place(btn,note){
    if(hasAnchor)return;
    var r=btn.getBoundingClientRect(),vh=window.innerHeight,h,top;
    note.style.inset='auto';note.style.margin='0';note.style.bottom='auto';
    if(wide.matches&&main){
      note.style.width='';note.style.right='auto';
      var mr=main.getBoundingClientRect(),w=note.offsetWidth;
      note.style.left=Math.max(8,mr.left-14-w)+'px';
      h=note.offsetHeight;top=Math.min(Math.max(8,r.top),vh-h-8);
    }else{
      note.style.left='12px';note.style.right='12px';note.style.width='auto';
      h=note.offsetHeight;top=r.bottom+6;
      if(top+h>vh-8&&r.top-h-6>8)top=r.top-h-6;
    }
    note.style.top=Math.max(8,top)+'px';
  }
  function isOpen(note){return hasPopover?note.matches(':popover-open'):note.classList.contains('open')}
  function show(btn,note){
    if(isOpen(note))return;
    if(hasPopover){try{note.showPopover({source:btn})}catch(e){try{note.showPopover()}catch(_){}}}
    else{if(openNote&&openNote!==note)hide(openNote._glBtn,openNote);
      note.classList.add('open');btn.setAttribute('aria-expanded','true');openNote=note;place(btn,note)}
  }
  function hide(btn,note){
    note._glPinned=false;
    if(hasPopover){try{if(note.matches(':popover-open'))note.hidePopover()}catch(e){}}
    else{note.classList.remove('open');btn.setAttribute('aria-expanded','false');if(openNote===note)openNote=null}
  }
  Array.prototype.forEach.call(terms,function(btn,i){
    var note=document.getElementById(btn.getAttribute('popovertarget'));if(!note)return;
    note._glBtn=btn;
    if(hasAnchor){btn.style.anchorName='--gl-'+i;note.style.positionAnchor='--gl-'+i;note.classList.add('gl-anchored')}
    btn.addEventListener('click',function(e){
      note._glPinned=true;
      if(!hasPopover){e.preventDefault();if(isOpen(note))hide(btn,note);else{show(btn,note);note._glPinned=true}}
    });
    if(hasInterest)return;
    // hover / focus fallback (WCAG 1.4.13: hoverable, dismissible with Esc, persistent while hovered or focused)
    var t=null;
    function later(fn,ms){clearTimeout(t);t=setTimeout(fn,ms)}
    btn.addEventListener('mouseenter',function(){later(function(){show(btn,note)},220)});
    btn.addEventListener('mouseleave',function(){later(function(){if(!note._glPinned)hide(btn,note)},200)});
    note.addEventListener('mouseenter',function(){clearTimeout(t)});
    note.addEventListener('mouseleave',function(){later(function(){if(!note._glPinned)hide(btn,note)},200)});
    btn.addEventListener('focus',function(){if(btn.matches(':focus-visible'))later(function(){show(btn,note)},0)});
    btn.addEventListener('blur',function(){later(function(){hide(btn,note)},120)});
  });
  // aria-expanded mirrors the popover state (toggle does not bubble: capture)
  document.addEventListener('toggle',function(e){var n=e.target;
    if(!n.classList||!n.classList.contains('gl-note')||!n._glBtn)return;
    var open=e.newState==='open';n._glBtn.setAttribute('aria-expanded',open?'true':'false');
    if(open){openNote=n;place(n._glBtn,n)}else{n._glPinned=false;if(openNote===n)openNote=null}
  },true);
  function reflow(){if(openNote&&!hasAnchor)place(openNote._glBtn,openNote)}
  window.addEventListener('scroll',reflow,{passive:true});window.addEventListener('resize',reflow);
  if(!hasPopover){
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&openNote){var b=openNote._glBtn;hide(b,openNote);b.focus()}});
    document.addEventListener('click',function(e){if(openNote&&!openNote.contains(e.target)&&e.target!==openNote._glBtn)hide(openNote._glBtn,openNote)});
  }
})();

// /glossary/ page: search, category filter, "latest brief only" (no network; data is in the page)
(function(){
  var list=document.getElementById('gl-list'),q=document.getElementById('gq');if(!list||!q)return;
  var cnt=document.getElementById('gcnt'),empty=document.getElementById('gempty'),only=document.getElementById('gl-latest-only');
  var cats=document.querySelectorAll('.gl-cats button'),cat='all',t;
  var rows=Array.prototype.slice.call(list.querySelectorAll('.gl-entry'));
  function norm(s){return String(s||'').toLowerCase().replace(/[\u0591-\u05C7]/g,'').replace(/\u05f4/g,'"').replace(/\s+/g,' ').trim()}
  function apply(){
    var terms=norm(q.value).split(' ').filter(Boolean),n=0,lat=!!(only&&only.checked);
    rows.forEach(function(r){var s=r.getAttribute('data-q')||'';
      var ok=(cat==='all'||r.getAttribute('data-cat')===cat)&&(!lat||r.getAttribute('data-latest')==='1')
        &&terms.every(function(w){return s.indexOf(w)>=0});
      r.hidden=!ok;if(ok)n++});
    list.querySelectorAll('.gl-group').forEach(function(g){g.hidden=!g.querySelector('.gl-entry:not([hidden])')});
    var filtered=terms.length||lat||cat!=='all';
    cnt.textContent=filtered?('נמצאו '+n+' מתוך '+rows.length+' מושגים'):'';
    empty.classList.toggle('hidden',n>0);
  }
  cats.forEach(function(b){b.addEventListener('click',function(){cat=b.getAttribute('data-gc');
    cats.forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false')});apply()})});
  if(only)only.addEventListener('change',apply);
  q.addEventListener('input',function(){clearTimeout(t);t=setTimeout(apply,80)});
  if(location.hash.indexOf('#q=')===0){q.value=decodeURIComponent(location.hash.slice(3));apply()}
})();
