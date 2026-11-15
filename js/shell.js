/* The shell: which view is showing (go), the tab badges, theme and look, toasts, the sheet for where you are in the
   course, icons, the keyboard map, the service worker and releases, the install hint, and the links out to Notion. */

/* ============ THEME ============ */
function curTheme(){return document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light';}
function applyTheme(t){
  if(!t||t==='auto')t=sysDark()?'dark':'light';
  if(t==='dark')document.documentElement.setAttribute('data-theme','dark');
  else document.documentElement.removeAttribute('data-theme');
  const b=document.getElementById('themeBtn'); if(b)b.textContent=t==='dark'?'☀':'☾';
  const m=document.querySelector('meta[name=theme-color]');if(m)m.setAttribute('content',cssVar('--bg')||'#faf9f7');
  try{shLook();}catch(e){}
}
function toggleTheme(){const t=curTheme()==='dark'?'light':'dark';S.settings.theme=t;save();applyTheme(t);
  if(view==='brain')renderBrain(); if(view==='home')renderHome();}
function cssVar(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim();}

/* ============ VIEWS ============ */
let view='home', openLessons={}, libFilter='all', libSearch='', libBook=1;
/* Show a view: stop what the view being left was doing (recording, the listening player), mark its tab, paint it. */
function go(v){
  if(v!=='my'&&typeof MY!=='undefined'){MY.mode='list';}
  const from=view;
  if(v!=='drill'){tcRelease();recKill();}
  if(v!=='rev')document.body.classList.remove('focus');
  if(view==='drill'&&v!=='drill'&&drillMode==='listen')lpStop();
  view=v;
  ['Home','Rev','Drill','Gram','Brain','Lib','Set'].forEach(x=>{document.getElementById('tab'+x).classList.toggle('on',v===x.toLowerCase());document.getElementById('v'+x).style.display=v===x.toLowerCase()?'':'none';});
  if(v==='home')renderHome(); if(v==='drill')renderDrill(); if(v==='gram')renderGram(); if(v==='brain')renderBrain(); if(v==='lib')renderLib(); if(v==='rev')startReview(); if(v==='set')renderSet();
  try{if(animOn()){const el=document.getElementById('v'+v.charAt(0).toUpperCase()+v.slice(1));if(el){el.classList.remove('view-in');void el.offsetWidth;el.classList.add('view-in');}}}catch(e){}
  /* the tabs added after the first seven: catch-up, the exam, My words */
  {const t=document.getElementById('tabCatch'), c=document.getElementById('vCatch');
   if(t)t.classList.toggle('on',v==='catch'); if(c)c.style.display=v==='catch'?'':'none';
   if(v==='catch')renderCatch();}
  {const t=document.getElementById('tabExam'),c=document.getElementById('vExam');if(t)t.classList.toggle('on',v==='exam');if(c)c.style.display=v==='exam'?'':'none';if(v==='exam')renderExam();}
  try{tabsSync();tabIntoView();}catch(e){}
  {const t=document.getElementById('tabMy'), c=document.getElementById('vMy');
   if(t)t.classList.toggle('on',v==='my'); if(c)c.style.display=v==='my'?'':'none';
   const sb=document.getElementById('setBtn'); if(sb)sb.classList.toggle('on',v==='set');
   if(v==='my'){renderMy(); try{if(animOn()){c.classList.remove('view-in');void c.offsetWidth;c.classList.add('view-in');}}catch(e){}}}
  try{tabsSync();if(from!==v)window.scrollTo(0,0);}catch(e){}   /* a new place starts at its top; re-rendering the same one keeps your position */
}
/* the counts on the tabs: cards ready now, catch-up cards, exam words still marked ✗ */
function badge(){
  {const n=dueCount();const b=document.getElementById('bDue');b.textContent=n;b.classList.toggle('zero',n===0);}
  try{const L=laneCounts();const n=L.catch.due+L.catch.fresh;const b=document.getElementById('bCatch');if(b){b.textContent=n;b.classList.toggle('zero',n===0);}}catch(e){}
  try{const n=exIds('no').length;const b=document.getElementById('bExam');if(b){b.textContent=n;b.classList.toggle('zero',n===0);}}catch(e){}
}
let toastTimer=null;
function toast(msg,o){
  o=o||{}; const host=document.getElementById('toastHost'); if(!host)return;
  host.innerHTML=`<div class="toast"><span>${msg}</span>${o.action?`<button class="tact">${esc(o.action)}</button>`:''}</div>`;
  const b=host.querySelector('.tact'); if(b)b.onclick=()=>{host.innerHTML='';if(o.onAction)o.onAction();};
  host.style.display='block'; clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{const t=host.querySelector('.toast');if(t){t.classList.add('out');setTimeout(()=>{host.innerHTML='';host.style.display='none';},260);}},o.ms||3500);
}

function sysDark(){return !!(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);}

function haptic(kind){
  if(S.settings.haptics===false)return;
  try{if(navigator.vibrate&&(!navigator.userActivation||navigator.userActivation.hasBeenActive))navigator.vibrate(kind==='again'?[18,40,18]:kind==='done'?[10,30,10,30,30]:10);}catch(e){}
}
function animOn(){return S.settings.anim!==false&&!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);}
/* drills and grammar: confetti on a finished set */
function partyIfDone(host){const d=document.querySelector(host+' .card.done');if(d&&!d.dataset.party){d.dataset.party=1;if(animOn())confetti();haptic('done');}}

function confetti(){
  if(!animOn())return;
  let cv=document.getElementById('confettiCv');
  if(!cv){cv=document.createElement('canvas');cv.id='confettiCv';document.body.appendChild(cv);}
  const dpr=window.devicePixelRatio||1; cv.width=innerWidth*dpr; cv.height=innerHeight*dpr; cv.style.display='block';
  const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);
  const cols=[cssVar('--lant'),cssVar('--acc'),cssVar('--gold'),cssVar('--blue'),cssVar('--plum'),cssVar('--amber')];
  const P=[]; for(let i=0;i<140;i++)P.push({x:innerWidth/2+(Math.random()-.5)*160,y:innerHeight*0.35,vx:(Math.random()-.5)*14,vy:-Math.random()*13-4,r:Math.random()*Math.PI,vr:(Math.random()-.5)*.3,w:6+Math.random()*6,h:4+Math.random()*4,c:cols[i%cols.length]});
  const t0=performance.now();
  (function frame(t){
    const k=(t-t0)/1000; ctx.clearRect(0,0,innerWidth,innerHeight);
    P.forEach(p=>{p.vy+=0.35;p.vx*=0.985;p.x+=p.vx;p.y+=p.vy;p.r+=p.vr;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.r);ctx.globalAlpha=Math.max(0,1-Math.max(0,k-1.6)/0.8);ctx.fillStyle=p.c;ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);ctx.restore();});
    if(k<2.6)requestAnimationFrame(frame); else {cv.style.display='none';ctx.clearRect(0,0,innerWidth,innerHeight);}
  })(t0);
}
/* numbers that count up — small, fast, easing out */
function countUp(root){
  (root||document).querySelectorAll('[data-count]').forEach(el=>{
    const to=parseFloat(el.dataset.count)||0, suf=el.dataset.suf||'', t0=performance.now(), dur=650;
    if(!animOn()||to===0){el.textContent=to+suf;return;}
    (function f(t){const k=Math.min(1,(t-t0)/dur), e=1-Math.pow(1-k,3);el.textContent=Math.round(to*e)+suf;if(k<1)requestAnimationFrame(f);})(t0);
  });
}
function ringSvg(frac,size,stroke,cls){
  const r=(size-stroke)/2, C=2*Math.PI*r, off=C*(1-Math.max(0,Math.min(1,frac)));
  return `<svg class="ring ${cls||''}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle class="bg" cx="${size/2}" cy="${size/2}" r="${r}" stroke-width="${stroke}"/><circle class="fg" cx="${size/2}" cy="${size/2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-off="${off}"/></svg>`;
}
function ringArm(root){requestAnimationFrame(()=>requestAnimationFrame(()=>{(root||document).querySelectorAll('.ring .fg').forEach(c=>{c.style.strokeDashoffset=c.dataset.off;});}));}

const NOTION={
  index:'https://app.notion.com/p/3d36bf9d399581379b21fd2b3287d808',
  flow:'https://app.notion.com/p/3d96bf9d39958197bd8ac54df73c2cc5'
};
/* app lesson number → Notion lesson page (B1 L1–L9 have no page; the Grammar Index is their record) */
const NOTION_LESSON={10:'3d36bf9d399581b6b464cdeb1d51efb7',11:'3d36bf9d399581deb910ffd3acfb8a42',12:'3d36bf9d3995815a8dfdec362e430d6e',13:'3d36bf9d3995817fb37fcbf6235dcca7',14:'3d36bf9d399581159e3dde3fd2fecb56',15:'3d36bf9d399581edbeb5d6fa40271af8',16:'3d36bf9d399581a5a577d28e1299beb8',17:'3d36bf9d3995819ca642df9fcfbb22e9',18:'3d36bf9d39958158a7f0f97fdcfbdbc7',19:'3d36bf9d3995810ba90cd7782264a696',20:'3d36bf9d399581d78edfdca54d0a13de',21:'3d36bf9d399581488639c55d7dcff58c',22:'3d36bf9d39958192862fe0b3ce623643'};
function notionLesson(ln){return NOTION_LESSON[ln]?('https://app.notion.com/p/'+NOTION_LESSON[ln]):NOTION.index;}
function notionLink(ln,txt){return `<a class="nlink" href="${notionLesson(ln)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${txt||'Notion ↗'}</a>`;}
function isIOS(){return /iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);}
function isStandalone(){return !!(navigator.standalone||(window.matchMedia&&matchMedia('(display-mode: standalone)').matches));}

/* ---- 4. Add to Home Screen hint (iOS Safari, shown once) ---- */
function showInstallHint(force){
  try{if(SYNC.code&&navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(SYNC.code).catch(()=>{});}catch(e){}
  if(!isIOS()||isStandalone())return;
  if(!force){try{if(store.getItem('zika_a2hs_seen'))return;store.setItem('zika_a2hs_seen','1');}catch(e){}}
  const host=document.getElementById('syncModal'); if(!host)return;
  host.innerHTML=`<div class="modal-card">
    <div class="lab">Put 字卡 on your Home Screen</div>
    <div style="font-size:14px;line-height:1.55;margin-bottom:12px">
      ① Tap <b>Share</b> (the square with the arrow, top right in Safari)<br>
      ② Tap <b>Add to Home Screen</b> → <b>Add</b><br>
      ③ Open 字卡 from the Home Screen. It starts with its own empty storage — type <b>${esc(SYNC.code||'your sync code')}</b> on the card it shows and tap <b>Link</b>.</div>
    <div class="small muted" style="margin-bottom:12px">After that the home-screen app works offline and syncs on its own. You can keep using Safari too — it is linked already.</div>
    <div class="row"><button class="btn" id="a2hsOk">Got it</button></div></div>`;
  host.style.display='flex';
  document.getElementById('a2hsOk').onclick=()=>{host.style.display='none';};
}

/* ---- B. lookups ---- */
function isAndroidUA(){return /Android/.test(navigator.userAgent);}
/* ---- D. keyboard: letters jump tabs, ? shows the map ---- */
const KEYMAP={t:'home',r:'rev',d:'drill',c:'catch',g:'gram',b:'brain',l:'lib',s:'set',e:'exam',m:'my'};
function toggleKeyHelp(){
  let h=document.getElementById('keyHelp');
  if(!h){h=document.createElement('div');h.id='keyHelp';h.className='modal';h.onclick=ev=>{if(ev.target===h)h.style.display='none';};document.body.appendChild(h);}
  if(h.style.display==='flex'){h.style.display='none';return;}
  h.innerHTML=`<div class="modal-card"><div class="lab">Keyboard</div>
    <div class="kgrid">
      <div><kbd>t</kbd> Today</div><div><kbd>r</kbd> Review</div><div><kbd>d</kbd> Drill</div><div><kbd>c</kbd> Catch-up</div><div><kbd>e</kbd> 大考試</div>
      <div><kbd>g</kbd> Grammar</div><div><kbd>b</kbd> Brain</div><div><kbd>l</kbd> Library</div><div><kbd>s</kbd> Settings</div>
      <div><kbd>space</kbd> reveal</div><div><kbd>1</kbd>–<kbd>4</kbd> grade</div><div><kbd>f</kbd> focus mode in review</div><div><kbd>esc</kbd> close</div>
      <div><kbd>1</kbd>–<kbd>3</kbd> writing test: ✗ · ~ · ✓</div><div><kbd>u</kbd> undo the last grade</div><div><kbd>?</kbd> this card</div>
    </div></div>`;
  h.style.display='flex';
}

Object.assign(NOTION_LESSON,{23:'3d36bf9d3995817cbba6f12b841383e2',24:'3d36bf9d399581e48357f83c2f6d18e9',25:'3d36bf9d39958168aa04ec4f28e18317',26:'3d36bf9d39958183aaefe3087ad4770f',27:'3d36bf9d3995818d8732d9ba819ad8f7',28:'3d36bf9d399581cd890bf32aff697ebb',29:'3d36bf9d399581b8a537c662338e6e85'});

/* e = 大考試 */
/* ---- phones: bottom bar with More ---- */

function tabsSync(){
  const bar=document.querySelector('.tabs'), m=document.getElementById('tabMore'); if(!bar||!m)return;
  bar.classList.remove('more'); m.classList.toggle('on',!!bar.querySelector('button.t2.on'));
}
/* ---- the service worker and releases ----
   sw.js keeps the whole app on the device and serves it from there, so a release reaches this page in two steps:
   the worker stores the new files in the background, then takes over and the page is loaded again. */
let SW_TOUCHED=false, SW_REFRESHING=false;
function swStart(){
  /* "touched" = the learner has done something since the app opened; a release is never loaded over that without asking */
  ['pointerdown','keydown'].forEach(ev=>document.addEventListener(ev,()=>{SW_TOUCHED=true;},{capture:true,once:true,passive:true}));
  if(!('serviceWorker' in navigator)||!/^https?:/.test(location.protocol))return;
  /* while developing on this machine the worker stays off, so an edit shows on reload; add ?sw to the address to try it.
     A worker left on this address by an earlier visit (with ?sw, or by an older version) is removed with what it stored. */
  if(/^(localhost|127\.0\.0\.1)$/.test(location.hostname)&&!/[?&]sw\b/.test(location.search)){
    try{navigator.serviceWorker.getRegistrations().then(rs=>{rs.forEach(r=>r.unregister());if(rs.length&&window.caches)caches.keys().then(ks=>ks.filter(k=>/^zika-(shell-|v\d)/.test(k)).forEach(k=>caches.delete(k)));}).catch(()=>{});}catch(e){}
    return;
  }
  const had=!!navigator.serviceWorker.controller;   /* false on the very first visit: the worker taking over then is not a release */
  try{
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(had)swUpdated();});
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }catch(e){}
}
/* a new release has taken over: load it at once if nothing has been touched since the app opened, otherwise offer it */
function swUpdated(){
  if(SW_REFRESHING)return;                          /* appRefresh() is already on its way to a reload */
  let last=0; try{last=+sessionStorage.getItem('zika_reloaded')||0;}catch(e){}
  if(!SW_TOUCHED&&Date.now()-last>10000){try{sessionStorage.setItem('zika_reloaded',String(Date.now()));}catch(e){} location.reload();return;}
  toast('A newer version of 字卡 is ready',{action:'Refresh',onAction:()=>location.reload(),ms:20000});
}
/* resolves when a release that is being stored has taken over or has failed, and after `ms` at the latest */
function swSettled(reg,ms){
  const w=reg.installing||reg.waiting; if(!w)return Promise.resolve();
  return new Promise(done=>{
    const t=setTimeout(done,ms), check=()=>{if(w.state==='activated'||w.state==='redundant'){clearTimeout(t);done();}};
    w.addEventListener('statechange',check); check();
  });
}
/* ---- refresh: push anything unsent, pick up the newest release, reload ---- */
async function appRefresh(){
  SW_REFRESHING=true;
  const b=document.getElementById('refreshBtn'); if(b)b.classList.add('spin');
  try{ if(SYNC.dirty&&SYNC.fb&&SYNC.code&&!SYNC.blocked)await fbPush(); }catch(e){}
  try{ if('serviceWorker' in navigator){const reg=await navigator.serviceWorker.getRegistration(); if(reg){await reg.update();await swSettled(reg,15000);}} }catch(e){}
  location.reload();
}
/* a copy left open for days (the Home Screen app especially) learns about a release when it comes back to the front */
let UPD_AT=0;
async function checkForUpdate(){
  if(Date.now()-UPD_AT<60000||!navigator.onLine)return; UPD_AT=Date.now();
  try{
    const r=await fetch('sw.js',{cache:'no-store'}); if(!r.ok)return;
    const m=(await r.text()).match(/const VERSION = 'zika-v(\d+)'/); if(!m||+m[1]<=APP_VERSION)return;
    /* never reload over something in progress (a drill, a card, a sheet being typed in): offer it instead */
    if(SW_TOUCHED)toast('A newer version of 字卡 is ready',{action:'Refresh',onAction:appRefresh,ms:20000}); else appRefresh();
  }catch(e){}
}
/* the active tab is always in view on a narrow screen (scrolls the bar only, never the page) */
function tabIntoView(){
  const t=document.querySelector('.tabs button.on'), bar=t&&t.parentElement; if(!bar||bar.scrollWidth<=bar.clientWidth)return;
  const left=bar.scrollLeft+t.getBoundingClientRect().left-bar.getBoundingClientRect().left-(bar.clientWidth-t.offsetWidth)/2;
  try{bar.scrollTo({left:Math.max(0,left),behavior:animOn()?'smooth':'auto'});}catch(e){bar.scrollLeft=Math.max(0,left);}
}

const SVG=(d,c)=>'<svg'+(c?' class="'+c+'"':'')+' viewBox="0 0 24 24" aria-hidden="true">'+d+'</svg>';
const ICON={
  home:'<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  rev:'<rect x="3" y="7" width="14" height="13" rx="2.5"/><path d="M7 4h11a3 3 0 0 1 3 3v10"/>',
  drill:'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  catch:'<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  exam:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  gram:'<path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/>',
  brain:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  lib:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  set:'<path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  my:'<path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z"/>',
  more:'<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  refresh:'<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4v7h-7"/>',
  moon:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  down:'<path d="m6 9 6 6 6-6"/>'
};
const TAB_ICON={tabHome:'home',tabRev:'rev',tabDrill:'drill',tabCatch:'catch',tabExam:'exam',tabGram:'gram',tabBrain:'brain',tabLib:'lib',tabSet:'set',tabMy:'my',tabMore:'more'};

/* ---------- look: accent colour and the face study characters are set in ---------- */
const ACCENTS={classic:'#2a241c',blue:'#2563eb',green:'#0b8457',violet:'#6d4aff',rose:'#d6336c',orange:'#d9480f'};   /* classic = ink buttons, tea-green links */
const PALETTES={paper:'Paper',clean:'Clean'};
const ZH_FONTS={sans:'Sans 黑體',song:'Song 明體',kai:'Kai 楷體'};
function shLook(){
  const r=document.documentElement, a=S.settings.accent, z=S.settings.zhFont, pal=S.settings.palette;
  if(pal==='clean')r.dataset.pal='clean'; else delete r.dataset.pal;
  if(a&&a!=='classic'&&ACCENTS[a])r.dataset.accent=a; else delete r.dataset.accent;
  if(z&&z!=='sans'&&ZH_FONTS[z])r.dataset.zh=z; else delete r.dataset.zh;
  /* remembered outside the deck so the next start can paint the right look before the deck is parsed */
  try{store.setItem('zika_look',JSON.stringify({t:S.settings.theme||'auto',p:r.dataset.pal||'',a:r.dataset.accent||'',z:r.dataset.zh||''}));}catch(e){}
  if(linksOn())r.dataset.links='1'; else delete r.dataset.links;
  const tb=document.getElementById('themeBtn'); if(tb)tb.innerHTML=SVG(curTheme()==='dark'?ICON.sun:ICON.moon);
  const mc=document.querySelector('meta[name="theme-color"]'); if(mc)mc.setAttribute('content',cssVar('--bg')||'#f3edde');
}
function shSetLook(k,v){S.settings[k]=v;save();shLook();if(view==='set')renderSet();if(view==='brain')renderBrain();}

function shName(){return (S.settings.userName||'').trim();}
function shGreeting(){
  const h=new Date().getHours(), g=h<5?'夜深了':h<11?'早安':h<14?'午安':h<18?'下午好':'晚上好', n=shName();
  return g+(n?'，'+esc(n):'');
}
function shLesson(){return Math.min(MAX_LN,Math.max(1,S.settings.curLesson||MAX_LN));}
function shLessonProgress(ln){
  const ws=WORDS.filter(w=>w.l===ln&&!isName(w)); let started=0;
  ws.forEach(w=>{if(MODES.some(m=>{const c=S.cards[cardId(w.id,m)];return c&&c.st!==undefined;}))started++;});
  return {started,total:ws.length};
}
function shSetLesson(v){
  v=Math.min(MAX_LN,Math.max(1,v|0)); S.settings.curLesson=v; try{drillLesson=v;}catch(e){}
  save(); badge(); shCourse(); if(view==='home')renderHome(); if(view==='set')renderSet();
}
/* ---------- the first run: a device with no deck (js/boot.js, bootFresh) ---------- */
const WELCOME={ln:1,known:false,name:''};
function shWelcome(){
  const ln=WELCOME.ln, m=shHost();
  m.innerHTML=`<div class="modal-card" id="shWelcomeCard">
    <div class="sheet-h"><b>Welcome to 字卡</b></div>
    <div class="small muted" style="margin:-4px 0 14px">Flashcards for <i>A Course in Contemporary Chinese</i>, timed so that each word comes back just before you would forget it. Two things to set; both can be changed later.</div>
    <div class="frow"><label for="shWelName">Your name</label><input id="shWelName" class="myin" value="${esc(WELCOME.name).replace(/"/g,'&quot;')}" placeholder="Shown in the greeting" autocomplete="off" oninput="WELCOME.name=this.value"></div>
    <div class="frow"><label>Your class is on</label>${lessonPick(ln,'WELCOME.ln=v;shWelcome()')}</div>
    <div style="font-size:15px;font-weight:600;margin-bottom:14px">${esc(LESSON_TITLES[ln]||'')}</div>
    ${ln>1?`<div class="set-row" style="padding:0 0 14px"><div><b>I know the lessons before this one</b><div class="d">their words skip learning and come back for a check in about three weeks</div></div>
      <button class="tgl ${WELCOME.known?'on':''}" onclick="WELCOME.known=!WELCOME.known;shWelcome()" aria-label="I know the lessons before this one"><i></i></button></div>`:''}
    <button class="btn big" onclick="shWelcomeDone()">Start with Book ${bookOf(ln)} · Lesson ${lnInBook(ln)}</button>
    <div class="small muted" style="text-align:center;margin-top:12px"><span class="link" onclick="shWelcomeLink()">I already use 字卡 on another device</span></div>
  </div>`;
  m.style.display='flex';
}
/* the lesson's words and grammar go into the deck, so there is something to study at once */
function shWelcomeDone(){
  const ln=Math.min(MAX_LN,Math.max(1,WELCOME.ln|0)), name=WELCOME.name.trim();
  if(name)S.settings.userName=name;
  S.settings.curLesson=ln; try{drillLesson=ln;}catch(e){}
  if(WELCOME.known)for(let l=1;l<ln;l++)(LESSON_WORDS[l]||[]).forEach(w=>markKnown(w.id));
  delete S.settings.welcome;
  trackGram(ln); qLoadLesson(ln);
  shClose(); go('home');
}
/* someone with a deck on another device: straight to the sync code on Today */
function shWelcomeLink(){shClose();go('home');const i=document.getElementById('homeCodeInp');if(i){try{i.scrollIntoView({block:'center'});}catch(e){}i.focus();}}
/* the links to the first learner's own notes show only on decks from before the clean first run (no `born`), or where switched on */
function linksOn(){return !S.settings.born||!!S.settings.notion;}

function shHost(){let m=document.getElementById('shSheet');if(!m){m=document.createElement('div');m.id='shSheet';m.className='modal';
  m.addEventListener('click',e=>{if(e.target===m)shClose();});document.body.appendChild(m);}return m;}
function shClose(){const m=document.getElementById('shSheet');if(m){m.style.display='none';m.innerHTML='';}}
function shCourse(){
  const ln=shLesson(), b=bookAt(ln), p=shLessonProgress(ln), m=shHost();
  const pct=p.total?Math.round(100*p.started/p.total):0;
  m.innerHTML=`<div class="modal-card">
    <div class="sheet-h"><b>Where you are</b><button class="xbtn" onclick="shClose()" aria-label="close">✕</button></div>
    <div class="frow"><label>Your class is on</label>${lessonPick(ln,'shSetLesson(v)')}</div>
    <div style="font-size:15px;font-weight:600">${esc(LESSON_TITLES[ln]||'')}</div>
    <div class="small muted" style="margin:2px 0 8px">Book ${b.n} · Lesson ${lnInBook(ln)} · ${p.started} of ${p.total} words started</div>
    <div class="sbar" style="margin-bottom:14px"><i style="width:${pct}%"></i></div>
    <div class="row" style="gap:8px;margin-bottom:16px">
      <button class="btn sm ghost" ${ln<=1?'disabled':''} onclick="shSetLesson(${ln-1})">← Previous lesson</button>
      <button class="btn sm" ${ln>=MAX_LN?'disabled':''} onclick="shSetLesson(${ln+1})">Class moved on →</button>
    </div>
    <div class="small muted" style="margin-bottom:14px">This decides what counts as “this week”, which new words come first, and where drills open.${ln>=MAX_LN?' Book '+b.n+' · Lesson '+lnInBook(ln)+' is the last lesson in the app so far.':''}</div>
    <div class="frow"><label for="shNameIn">Your name</label><input id="shNameIn" class="myin" value="${esc(shName()).replace(/"/g,'&quot;')}" placeholder="Shown in the greeting" autocomplete="off"
      onchange="S.settings.userName=this.value.trim();save();if(view==='home')renderHome();"></div>
    <button class="btn big" onclick="shClose()">Done</button>
  </div>`;
  m.style.display='flex';
}

/* ---------- top bar and tab icons ---------- */
function shTabIcons(){
  document.querySelectorAll('.tabs button').forEach(b=>{
    if(b.querySelector('.ti'))return;
    b.insertAdjacentHTML('afterbegin',SVG(ICON[TAB_ICON[b.id]]||ICON.more,'ti'));
  });
}

/* ---------- Today: greeting, two decks, and the rest behind one fold ---------- */
function shOpenLesson(ln){try{libBook=bookOf(ln);openLessons[ln]=true;}catch(e){}go('lib');}
function shDecks(){
  const ln=shLesson(), p=shLessonProgress(ln), q=myQueue(), n=myIds().length, ready=q.learn.length+q.rev.length+q.fresh.length;
  return `<div class="decks">
    <button class="deck" onclick="shOpenLesson(${ln})"><span class="dk-t">Course · Book ${bookOf(ln)} Lesson ${lnInBook(ln)}</span>
      <span class="dk-n">${p.started}<small>of ${p.total} words</small></span><span class="dk-s">${esc(LESSON_TITLES[ln]||'')}</span><span class="dk-go">Open lesson →</span></button>
    <button class="deck" onclick="go('my')"><span class="dk-t">My words</span>
      <span class="dk-n">${n?ready:'+'}<small>${n?'ready':'start a deck'}</small></span><span class="dk-s">${n?n+' word'+(n===1?'':'s')+' outside class':'Words you meet outside class'}</span><span class="dk-go">${n?(ready?'Study →':'Add words →'):'Add words →'}</span></button>
  </div>`;
}
function shHome(){
  const host=document.getElementById('vHome'); if(!host||host.querySelector('.hello'))return;
  const ln=shLesson(), d=new Date();
  const date=d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
  host.insertAdjacentHTML('afterbegin',`<div class="hello"><div><h1>${shGreeting()}</h1><div class="sub">${date}</div></div>
    <button class="coursechip" onclick="shCourse()" title="change your book and lesson">Book ${bookOf(ln)} · Lesson ${lnInBook(ln)}<i>${esc(LESSON_TITLES[ln]||'')}</i>${SVG(ICON.down)}</button></div>`);
  const anchor=host.querySelector('.card.examline')||host.querySelector('.card.hero');
  if(anchor)anchor.insertAdjacentHTML('afterend',shDecks());
  /* everything below the lanes (plan, queue, statistics) folds away; the choice is remembered on this device */
  const lanes=[...host.children].find(el=>el.classList.contains('card')&&/^Three lanes/.test(((el.querySelector('.lab')||{}).textContent||'').trim()));
  if(lanes){
    const rest=[]; for(let el=lanes.nextElementSibling;el;el=el.nextElementSibling)rest.push(el);
    if(rest.length){
      let open=false; try{open=store.getItem('zika_home_more')==='1';}catch(e){}
      const f=document.createElement('details'); f.className='fold'; f.open=open;
      f.innerHTML='<summary>Plan, queue and progress'+SVG(ICON.down)+'</summary>';
      f.addEventListener('toggle',()=>{try{store.setItem('zika_home_more',f.open?'1':'0');}catch(e){}});
      lanes.insertAdjacentElement('afterend',f); rest.forEach(el=>f.appendChild(el));
    }
  }
}
if(typeof zikaWhole==='function')zikaWhole();   /* the last line: this file arrived whole (index.html, js/boot.js) */
