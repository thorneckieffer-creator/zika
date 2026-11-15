// cards: "wid:mode" -> {st:'learn'|'rev'|'relearn', S,D, due, last, reps, lapses, days, known, susp}
try{
  const raw=store.getItem(KEY);
  if(raw){const p=JSON.parse(raw); S={...S,...p, settings:{...S.settings,...(p.settings||{}), modes:{rec:true,prod:true,...((p.settings||{}).modes||{})}}};}
  else{
    const old=store.getItem('shida_b1_fsrs_v1');
    if(old){ // migrate v1 (hw/mean/pin) -> v2 (rec/prod)
      const p=JSON.parse(old);
      const cards={};
      for(const cid in (p.cards||{})){
        const parts=cid.split(':'), wid=parts[0], m=parts[1], c=p.cards[cid];
        if(m==='mean')cards[wid+':rec']=c;
        else if(m==='hw')cards[wid+':prod']=c;
        else if(m==='pin'){const k=wid+':prod'; if(!cards[k]||cards[k].st===undefined)cards[k]=(cards[k]&&cards[k].st!==undefined)?cards[k]:c;}
      }
      S.cards=cards; S.log=p.log||{}; S.intro={};
      const os=p.settings||{};
      S.settings.retention=os.retention||0.9;
      S.settings.maxRev=os.maxRev||200;
      S.settings.includeNames=!!os.includeNames;
      S.settings.ghost=os.ghost!==false;
      save();
    }
  }
}catch(e){}
// one-time audio tune-up migrations
if(!S.settings._a2){S.settings._a2=1;}
if(!S.settings._a3){S.settings._a3=1;S.settings.audioSpeed=0.9;S.pick=S.pick||[];}
S.pick=S.pick||[];
// _a4: known/mastered cards must never join the paper-practice list, and ★-mastered rests ~3 months
if(!S.settings._a4){
  S.settings._a4=1;
  try{for(const k in S.cards){const c=S.cards[k];
    if(c&&c.known){c.days=99;
      if(c.mastAt&&c.st==='rev'&&c.S<90){c.S=90;c.due=Math.max(c.due||0,(c.last||Date.now())+90*86400000);}
    }}}catch(e){}
}
// backfill mastery timestamps for cards from before this feature
try{for(const k in S.cards){const c=S.cards[k];if(c&&c.st==='rev'&&c.S>=MASTER_S&&!c.mastAt)c.mastAt=c.last||Date.now();}}catch(e){}
if(window.speechSynthesis){loadVoices();try{speechSynthesis.onvoiceschanged=loadVoices;}catch(e){}}
Object.keys(VOICE_PACKS).filter(v=>v!=='f').forEach(v=>{
  fetch('assets/'+VOICE_PACKS[v].file+'-index.json').then(r=>{VOICE_OK[v]=r.ok;}).catch(()=>{VOICE_OK[v]=false;})
    .then(()=>{try{if(VOICE_OK[v]&&view==='set')renderSet();}catch(e){}});
});
document.addEventListener('keydown',e=>{
  if(view!=='rev'||!cur||TC.host)return; if(e.repeat||e.metaKey||e.ctrlKey||e.altKey)return;
  if(e.code==='Space'&&!revealed){e.preventDefault();reveal();}
  else if(revealed&&['1','2','3','4'].includes(e.key)){grade(parseInt(e.key));}
});
S.hard = S.hard || [];
if(!S.settings.curLesson) S.settings.curLesson = 22; /* B2 L7 */
if(!S.settings._v11){ S.settings._v11=1; save(); }
/* ---------- keyboard ---------- */
document.addEventListener('keydown',e=>{
  if(e.target&&/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
  if(tri&&view==='lib'){
    const map={'1':'hard','2':'learn','3':'know','4':'mast','5':'skip'};
    if(map[e.key]){e.preventDefault();triageAct(map[e.key]);}
    else if(e.code==='Space'){e.preventDefault();const w=byId[tri.list[tri.i]];if(w)speakWord(w.id);}
    return;
  }
  if(view==='drill'&&dq&&dq.i<dq.qs.length){
    const q=dq.qs[dq.i];
    if(dq.state==='ask'&&q.opts&&['1','2','3','4'].includes(e.key)){e.preventDefault();drillPick(+e.key-1);}
    else if(dq.state==='ask'&&q.mode==='dict'&&e.code==='Space'){e.preventDefault();dq.state='reveal';renderDrill();}
    else if(dq.state==='done'&&(e.code==='Space'||e.key==='Enter')){e.preventDefault();drillNext();}
    else if(e.key==='r'&&q.w){e.preventDefault();speakWord(q.w.id);}
  }
});
/* flush on the way out */
['pagehide','beforeunload'].forEach(ev=>window.addEventListener(ev,()=>{clearTimeout(bkTimer);bkWrite();}));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){clearTimeout(bkTimer);bkWrite();}});
/* first real click of the session re-arms the file permission if Chrome dropped it */
document.addEventListener('click',function armOnce(){
  if(bkHandle&&bkNeedPerm&&S.settings.autoBackup)bkGrant();
},{capture:true,once:true});
/* restore the handle on load */
(async()=>{
  const h=await bkGet();
  if(h){ bkHandle=h;
    try{ const p=h.queryPermission?await h.queryPermission({mode:'readwrite'}):'granted';
         if(p==='granted'){bkWrite();} else {bkNeedPerm=true;} }catch(e){bkNeedPerm=true;}
  }
  snapshot();
  if(bkStale()){const b=document.getElementById('bkBanner');if(b){b.style.display='block';}}
})();
takeSnapshot(true);
applyTheme(S.settings.theme||(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
(()=>{const h=new Date().getHours();const g=h<5?'夜深了，加油':h<11?'早安':h<14?'午安':h<18?'下午好':'晚上好';const el=document.getElementById('greet');if(el)el.textContent=g+'，Thorne';})();
if('serviceWorker' in navigator&&/^https?:/.test(location.protocol)){try{navigator.serviceWorker.register('sw.js').catch(()=>{})}catch(e){}}
S.sib = S.sib || {};                              /* {dayKey:{wid:cid}} — who owns the word today */
if(S.settings.burySib===undefined) S.settings.burySib = true;
if(S.settings.newUnlimited===undefined) S.settings.newUnlimited = false;
if(S.settings.revUnlimited===undefined) S.settings.revUnlimited = false;
S.pick = S.pick || [];
/* keep S.sib from growing forever — only today and yesterday matter */
(function pruneSib(){
  const keep=[dkey(new Date()), dkey(new Date(Date.now()-864e5))];
  for(const k in S.sib) if(!keep.includes(k)) delete S.sib[k];
})();
if(!S.conf){ try{ save(); }catch(e){} }
(function(){
  try{const m=JSON.parse(store.getItem(FB_META_KEY)||'{}');SYNC.at=m.at||0;SYNC.dirty=!!m.dirty;SYNC.remoteDev=m.remoteDev||'';}catch(e){}
  SYNC.code=(store.getItem(FB_ROOM_KEY)||'').trim();
})();
window.addEventListener('online',()=>{SYNC.online=true;if(!SYNC.fb)fbLoad();else if(SYNC.dirty)fbSchedulePush();});
window.addEventListener('offline',()=>{SYNC.online=false;if(SYNC.status!=='off')syncUI('offline');});
/* periodic safety net: anything still dirty goes up every 30 s */
setInterval(()=>{if(SYNC.dirty&&SYNC.fb&&SYNC.code&&!SYNC.pushing)fbSchedulePush();},30000);
['pagehide','beforeunload'].forEach(ev=>window.addEventListener(ev,()=>{if(SYNC.dirty&&SYNC.fb&&SYNC.code&&SYNC.uid&&!SYNC.pushing){clearTimeout(SYNC.timer);fbPush();}}));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&SYNC.dirty){clearTimeout(SYNC.timer);fbPush();}});
(function mountSyncUI(){
  const mast=document.querySelector('.mast');
  if(mast&&!document.getElementById('syncPill')){
    const b=document.createElement('button'); b.id='syncPill'; b.className='syncpill'; b.dataset.state='off'; b.type='button';
    b.innerHTML='<i class="sdot"></i><span class="stxt"></span>'; b.title='Cloud sync';
    b.onclick=()=>{go('set');setTimeout(()=>{const c=document.getElementById('syncCard');if(c)c.scrollIntoView({behavior:'smooth',block:'start'});},30);};
    mast.appendChild(b);
  }
  if(!document.getElementById('toastHost')){const t=document.createElement('div');t.id='toastHost';document.body.appendChild(t);}
  if(!document.getElementById('syncModal')){const m=document.createElement('div');m.id='syncModal';m.className='modal';document.body.appendChild(m);}
  syncUI(fbConfig()?'connecting':'off');
})();
if(!S.settings._v18){S.settings._v18=1; if(S.settings.haptics===undefined)S.settings.haptics=true; if(!S.settings.theme)S.settings.theme='auto'; try{save();}catch(e){}}
try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if((S.settings.theme||'auto')==='auto'){applyTheme('auto');if(view==='brain')renderBrain();}});}catch(e){}
applyTheme(S.settings.theme||'auto');
/* drill answers: green/red flash on the chosen option */
document.addEventListener('click',e=>{const b=e.target.closest('.opts button');if(!b||!animOn())return;setTimeout(()=>{if(b.classList.contains('right')){b.classList.add('pop');haptic('good');}else if(b.classList.contains('wrong')){b.classList.add('shake');haptic('again');}},0);},true);
/* 口試 exam clock fades green → amber → red as the three minutes run out */
setInterval(()=>{const el=document.getElementById('examClock');if(!el||!examP)return;const f=Math.max(0,Math.min(1,examP.left/180));
  const hue=Math.round(f*120); el.style.color=`hsl(${hue} 60% ${curTheme()==='dark'?'62%':'36%'})`; el.classList.toggle('urgent',examP.started&&examP.left<=15&&examP.left>0);},250);
/* v25: class frontier moved to B2 L8 on 9/21; L8 grammar now the eight textbook points */
if(!S.settings._v25){S.settings._v25=1;if((S.settings.curLesson||0)<23)S.settings.curLesson=23;if(S.settings.examDay===5)S.settings.examDay=4;try{trackGram(23);}catch(e){}try{save();}catch(e){}}
/* boot */
fbLoad();
/* migration: the current lesson and the one before it get cloze cards on first run */
if(!S.settings._v22){S.settings._v22=1;if(S.settings.gramCards===undefined)S.settings.gramCards=true;if(!S.settings.newGramPerDay)S.settings.newGramPerDay=4;if(!S.settings.examDay)S.settings.examDay=4;
  try{const cl=S.settings.curLesson||22;trackGram(cl);if(cl>1)trackGram(cl-1);}catch(e){} try{save();}catch(e){}}
/* space: ask → hint → reveal */
document.addEventListener('keydown',e=>{
  if(view!=='drill'||!dq||dq.i>=dq.qs.length)return; const q=dq.qs[dq.i]; if(q.mode!=='dict')return;
  if(e.code==='Space'){e.preventDefault();e.stopImmediatePropagation();
    if(dq.state==='ask')dq.state=(S.settings.dictHint!=='late')?'reveal':'hint'; else if(dq.state==='hint')dq.state='reveal'; else return;
    renderDrill();}
},true);
if(!S.settings._v26){S.settings._v26=1;if(!S.settings.prodScope)S.settings.prodScope='current';try{save();}catch(e){}}
document.addEventListener('keydown',e=>{if(view!=='drill'||!dq||dq.i>=dq.qs.length)return;const q=dq.qs[dq.i];if(q.mode!=='sdict')return;if(e.code==='Space'&&dq.state==='ask'){e.preventDefault();e.stopImmediatePropagation();dq.state='reveal';renderDrill();}},true);
/* ---- 1. #sync=<code> on load ---- */
(function linkFromHash(){
  const m=(location.hash||'').match(/sync=([A-Za-z0-9-]+)/); if(!m)return;
  const c=normCode(decodeURIComponent(m[1]));
  try{history.replaceState(null,'',location.pathname+location.search);}catch(e){}
  if(!c||c.length<6)return;
  if(SYNC.code===c){toast('Already linked to '+esc(c));return;}
  fbSetCode(c);
  setTimeout(()=>{
    toast('☁️ Linked to '+esc(c)+' — pulling your progress…',{ms:4500});
    if(isIOS()&&!isStandalone())setTimeout(showInstallHint,1800);
  },300);
})();
if(!S.settings._v28){S.settings._v28=1;if((S.settings.curLesson||0)<26)S.settings.curLesson=26;try{trackGram(26);}catch(e){}try{save();}catch(e){}}
document.addEventListener('keydown',e=>{if(view!=='drill'||drillMode!=='mtest'||dq)return;const T=mtGet();if(!T.order[T.i])return;
  if(e.code==='Space'&&!MT.revealed){e.preventDefault();e.stopImmediatePropagation();MT.revealed=true;mtRender();}
  else if(MT.revealed&&['1','2','3'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();mtMark(e.key==='1'?'h':e.key==='2'?'l':'m');}
},true);
if(!S.settings._v30){S.settings._v30=1;if(!S.settings.newCatchPerDay)S.settings.newCatchPerDay=5;if(S.settings.newPerDay===9)S.settings.newPerDay=8;try{save();}catch(e){}}
if(!S.settings._v31){S.settings._v31=1;S.settings.newCatchPerDay=Math.max(S.settings.newCatchPerDay??0,12);if((S.settings.maxRev||0)<300)S.settings.maxRev=300;try{save();}catch(e){}}
/* tab + container */
(function(){
  const tabs=document.querySelector('.tabs'); if(tabs&&!document.getElementById('tabCatch')){
    const b=document.createElement('button'); b.id='tabCatch'; b.innerHTML='Catch-up<span id="bCatch" class="b zero">0</span>'; b.onclick=()=>go('catch');
    const drill=document.getElementById('tabDrill'); drill.insertAdjacentElement('afterend',b);
  }
  if(!document.getElementById('vCatch')){const d=document.createElement('div');d.id='vCatch';d.style.display='none';document.getElementById('vDrill').insertAdjacentElement('afterend',d);}
})();
document.addEventListener('keydown',e=>{
  if(e.metaKey||e.ctrlKey||e.altKey)return; const tg=e.target; if(tg&&(/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)||tg.isContentEditable))return;
  if(e.key==='?'){e.preventDefault();toggleKeyHelp();return;}
  if(e.key==='Escape'){const h=document.getElementById('keyHelp');if(h&&h.style.display!=='none'){h.style.display='none';return;}if(document.body.classList.contains('focus')){document.body.classList.remove('focus');return;}}
  if(e.key==='f'&&view==='rev'){e.preventDefault();document.body.classList.toggle('focus');return;}
  const v=KEYMAP[e.key]; if(v&&!e.shiftKey){e.preventDefault();go(v);}
});
/* a11y micro-pass: icon-only buttons announce their title; Han text is tagged zh-Hant for screen readers and font selection */
(function(){const mo=new MutationObserver(()=>{document.querySelectorAll('button[title]:not([aria-label]),a[title]:not([aria-label])').forEach(b=>{if(!b.textContent.trim()||/^[☾☀▶↻‹›←→✓✗★!＋−]+$/.test(b.textContent.trim()))b.setAttribute('aria-label',b.title);});document.querySelectorAll('.zh:not([lang])').forEach(el=>el.setAttribute('lang','zh-Hant'));});mo.observe(document.body,{childList:true,subtree:true});})();
normalizeState();
/* keyboard map: never while a drill is running, never a no-op restart of the same view */
document.addEventListener('keydown',e=>{ if(e.defaultPrevented)return; if(KEYMAP[e.key]&&!e.metaKey&&!e.ctrlKey&&!e.altKey){const tg=e.target;if(tg&&(/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)||tg.isContentEditable))return; if((view==='drill'&&dq)||(KEYMAP[e.key]===view)||(view==='drill'&&drillMode==='mtest'))e.stopImmediatePropagation();} },true);
/* ---- 1. audio ---- */
/* warm the pack early so the first card doesn't wait */
setTimeout(()=>{try{loadPack();}catch(e){}},1500);
/* ---- 2. swipe grading (touch only) ---- */
(function(){
  let sx=0,sy=0,t0=0,active=false;
  document.addEventListener('touchstart',e=>{if(view!=='rev'||!cur||e.touches.length!==1)return;const st=e.target.closest('#vRev .stage');if(!st||e.target.closest('.wqbox,button,a,input'))return;sx=e.touches[0].clientX;sy=e.touches[0].clientY;t0=Date.now();active=true;},{passive:true});
  document.addEventListener('touchend',e=>{if(!active)return;active=false;const t=e.changedTouches[0];const dx=t.clientX-sx,dy=t.clientY-sy,dt=Date.now()-t0;
    if(Math.abs(dx)<12&&Math.abs(dy)<12&&dt<400){if(!revealed){reveal();}return;}
    if(!revealed||Math.abs(dx)<70||Math.abs(dy)>60||dt>900)return;
    if(dx<0)grade(1); else grade(3);},{passive:true});
})();
document.addEventListener('keydown',e=>{if(view!=='rev'||!cur||e.repeat||e.metaKey||e.ctrlKey||e.altKey)return;const tg=e.target;if(tg&&/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))return;if(e.key==='u'){e.preventDefault();doUndo();}});
document.addEventListener('keydown',e=>{if(view!=='drill'||drillMode!=='extest'||dq)return;const R=exGet().run;if(!R||!R.ids[R.i])return;
  if(e.code==='Space'&&!EX.revealed){e.preventDefault();e.stopImmediatePropagation();EX.revealed=true;exRender();}
  else if(EX.revealed&&['1','2','3'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();exMark(e.key==='1'?'h':e.key==='2'?'l':'m');}
},true);
(function(){
  const tabs=document.querySelector('.tabs');if(tabs&&!document.getElementById('tabExam')){
    const b=document.createElement('button');b.id='tabExam';b.innerHTML='大考試<span id="bExam" class="b zero">0</span>';b.style.whiteSpace='nowrap';b.onclick=()=>go('exam');
    const after=document.getElementById('tabCatch')||document.getElementById('tabDrill');after.insertAdjacentElement('afterend',b);}
  if(!document.getElementById('vExam')){const d=document.createElement('div');d.id='vExam';d.style.display='none';document.getElementById('vDrill').insertAdjacentElement('afterend',d);}
})();
if(!S.settings._v38){S.settings._v38=1;exGet();try{save();}catch(e){}}
try{badge();if(view==='home')renderHome();}catch(e){}
/* version stamp */
(function(){const el=document.getElementById('appVer');if(el)el.textContent='v'+APP_VERSION;})();
/* drills open on the live lesson */
drillLesson=S.settings.curLesson||drillLesson;
(function(){
  const bar=document.querySelector('.tabs'); if(!bar||document.getElementById('tabMore'))return;
  ['tabCatch','tabGram','tabBrain','tabLib','tabSet'].forEach(id=>{const b=document.getElementById(id);if(b)b.classList.add('t2');});
  const m=document.createElement('button'); m.id='tabMore'; m.type='button'; m.textContent='More'; m.setAttribute('aria-label','more tabs');
  m.onclick=()=>bar.classList.toggle('more'); bar.appendChild(m);
  document.addEventListener('click',e=>{if(bar.classList.contains('more')&&!bar.contains(e.target))bar.classList.remove('more');});
})();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkForUpdate();});
/* pull down to refresh inside the Home Screen app, which has no reload button of its own */
(function(){
  if(!isStandalone())return;
  const tip=document.createElement('div'); tip.id='ptr'; document.body.appendChild(tip);
  let y0=null,pull=0;
  const rest=()=>{tip.style.opacity=0;tip.style.transform='translate(-50%,0)';};
  document.addEventListener('touchstart',e=>{pull=0;y0=(window.scrollY<=0&&e.touches.length===1&&!e.target.closest('.modal,.tabs'))?e.touches[0].clientY:null;},{passive:true});
  document.addEventListener('touchmove',e=>{if(y0===null)return;pull=e.touches[0].clientY-y0;if(pull<=0||window.scrollY>0){rest();return;}
    tip.textContent=pull>110?'↻ release to refresh':'↓ pull to refresh';tip.style.opacity=Math.min(1,pull/110);tip.style.transform='translate(-50%,'+Math.min(56,pull/2.2)+'px)';},{passive:true});
  document.addEventListener('touchend',()=>{if(y0!==null&&pull>110&&window.scrollY<=0){tip.textContent='Refreshing…';appRefresh();}else rest();y0=null;},{passive:true});
})();
try{tabsSync();tabIntoView();if(view==='set')renderSet();}catch(e){}
/* keyboard, for the Mac: Space records (and stops), Enter moves on, A tries again, L listens, Esc closes the sheet */
document.addEventListener('keydown',e=>{
  const on=TC.host||(view==='drill'&&drillMode==='tcoach'&&!dq&&TC.list.length&&TC.i<TC.list.length);
  if(!on||e.repeat||e.metaKey||e.ctrlKey||e.altKey||/^(INPUT|TEXTAREA|SELECT)$/.test((e.target&&e.target.tagName)||''))return;
  const st=TC.state;
  if(e.code==='Space'&&(st==='ask'||st==='rec'||st==='cal')){e.preventDefault();tcRecord();}
  else if(e.key==='Enter'&&st==='done'){e.preventDefault();tcNext();}
  else if((e.key==='a'||e.key==='A')&&st==='done'){tcAgain();}
  else if((e.key==='l'||e.key==='L')&&(st==='ask'||st==='done')){tcSay();}
  else if(e.key==='Escape'&&TC.host){tcQuickClose();}
  else return;
  e.stopImmediatePropagation();
},true);

/* ---------- who and where: name, book and lesson ---------- */
/* Decks that existed before names were a setting belong to Thorne. Runs on every start (not behind a flag),
   so a deck adopted from a device that has not updated yet is named too. */
if(S.settings.userName===undefined&&Object.keys(S.cards||{}).length){S.settings.userName='Thorne';}
(function(){
  const rb=document.getElementById('refreshBtn'); if(rb)rb.innerHTML=SVG(ICON.refresh);
  const sb=document.getElementById('setBtn'); if(sb)sb.innerHTML=SVG(ICON.set);
  /* My words: its own tab (behind More on phones) and its own view */
  const tabs=document.querySelector('.tabs');
  if(tabs&&!document.getElementById('tabMy')){
    const b=document.createElement('button'); b.id='tabMy'; b.type='button'; b.className='t2';
    b.innerHTML='My words<span id="bMy" class="b zero">0</span>'; b.onclick=()=>go('my');
    (document.getElementById('tabLib')||tabs.lastElementChild).insertAdjacentElement('afterend',b);
    const v=document.createElement('div'); v.id='vMy'; v.style.display='none';
    document.getElementById('vSet').insertAdjacentElement('afterend',v);
  }
  shTabIcons();
  KEYMAP.m='my';
})();
document.addEventListener('keydown',e=>{
  if(view!=='my'||MY.mode!=='study'||e.metaKey||e.ctrlKey||e.altKey||e.repeat)return;
  const tg=e.target; if(tg&&/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))return;
  const sheet=document.getElementById('shSheet'); if(sheet&&sheet.style.display==='flex')return;
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();myStop();return;}
  if(!MY.cur)return;
  if(e.code==='Space'||e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();if(MY.shown)myGrade(3);else myReveal();return;}
  if(MY.shown&&/^[1-4]$/.test(e.key)){e.preventDefault();e.stopImmediatePropagation();myGrade(+e.key);}
},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const s=document.getElementById('shSheet');if(s&&s.style.display==='flex'){shClose();if(view==='my')renderMy();}}});
/* ---------- start ---------- */
try{shLook();myBadge();if(view==='home')renderHome();else if(view==='set')renderSet();}catch(e){console.error(e);}

document.addEventListener('keydown',e=>{
  if(view!=='drill'||drillMode!=='usage'||UQ.scr!=='quiz'||!UQ.q||UQ.i>=UQ.q.length||e.metaKey||e.ctrlKey||e.altKey||e.repeat)return;
  const tg=e.target; if(tg&&/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))return;
  const act=f=>{e.preventDefault();e.stopImmediatePropagation();f();};
  if(e.key==='Escape')return act(usHome);
  if(e.code==='Space'||e.key==='Enter')return act(()=>UQ.shown?usGrade(1):usShow());
  if(UQ.shown&&(e.key==='1'||e.key==='2'))return act(()=>usGrade(e.key==='2'?1:0));
},true);
