/* ---- LIBRARY ---- */
function renderLib(){
  if(tri)return renderTriage();
  libEnsureChrome(); libSyncChrome(); renderLibResults();
}
function togglePick(wid){S.pick=S.pick||[];const i=S.pick.indexOf(wid);if(i>-1)S.pick.splice(i,1);else S.pick.push(wid);save();}
function wrowTagged(w,showLn){
  const st=wordStatus(w.id), kn=isKnown(w.id);
  const startable=!st||st.k==='new';
  const pi=(S.pick||[]).indexOf(w.id);
  const h=`<div class="wrow">
    <div class="tr zh">${esc(w.t)}</div>
    <div class="info">
      <div class="py">${tonePinyin(esc(w.p))}${w.pos?` <span class="tag">${esc(w.pos)}</span>`:''}${w.s?` <span class="tag simp">简 ${esc(w.s)}</span>`:''}</div>
      <div class="mn">${esc(w.m)}${showLn?` <span class="lnchip">${esc(lnLabel(w.l))}${dlgTag(w.id)}</span>`:''}</div>
    </div>
    ${st?`<span class="tag ${kn&&st.k!=='due'?'known':st.k}">${kn&&st.k!=='due'?'known':st.t}</span>`:''}
    ${spkBtn(w.id)}
    ${startable?`<button class="wbtn ${pi>-1?'on':''}" title="learn this next — jumps the textbook order" onclick="togglePick('${w.id}');if(!tracked('${w.id}'))trackWord('${w.id}');renderLib();badge()">${pi>-1?pi+1:'»'}</button>`:''}
    <button class="wbtn ${isHard(w.id)?'on':''}" title="hard — put it on the drill list" onclick="toggleHard('${w.id}');renderLib();badge()" style="${isHard(w.id)?'background:var(--lant);border-color:var(--lant);color:#fff':''}">!</button>
    <button class="wbtn kn ${wordMastAt(w.id)?'on':''}" title="Mastered — straight onto the shelf, resurfaces in ~3 months, no paper reps" onclick="markMastered('${w.id}');renderLib();badge()">★</button>
    <button class="wbtn kn ${kn?'on':''}" title="I know this — skip learning, verify in ~3 weeks" onclick="markKnown('${w.id}');renderLib();badge()">✓</button>
    <button class="wbtn ${st?'on':''}" title="${st?'remove from deck':'add to deck'}" onclick="${st?`if(confirm('Remove this word\\'s cards and progress?'))untrackWord('${w.id}')`:`trackWord('${w.id}')`};renderLib();badge()">${st?'−':'+'}</button>
  </div>`, l=confOf(w.id);
  if(!l)return h;
  return h.replace(/<span class="tag (?:known|new|due|ok|mat)">[^<]*<\/span>/, `<span class="tag ${CONF[l].c}" title="${CONF[l].d}">${CONF[l].t}</span>`);
}
function wrowHtml(w,showLn){
  let h=wrowTagged(w,showLn);const l=confOf(w.id);
  const prev=confSeen[w.id]; confSeen[w.id]=l;
  if(l&&prev!==undefined&&prev!==l&&animOn())h=h.replace(`class="tag ${CONF[l].c}"`,`class="tag ${CONF[l].c} pop"`);
  try{
  const cs=MODES.map(m=>S.cards[cardId(w.id,m)]).filter(Boolean); if(!cs.length)return h;
  const started=cs.filter(c=>c.st!==undefined); let txt;
  if(!started.length)txt='queued · not started'; else {const due=Math.min(...started.map(c=>c.due)); txt=due<=Date.now()?'due now':'back '+fmtDay(due);}
  h=h.replace(/(<div class="mn">[\s\S]*?<\/div>)/,'$1<div class="small muted" style="font-size:11px">'+txt+'</div>');
  }catch(e){}return h;
}

/* ---------- TRIAGE ---------- */
let tri=null;
function startTriage(ln,dlg){
  const list=WORDS.filter(w=>w.l===ln&&(S.settings.includeNames||!isName(w))
    &&(!dlg||dlgOf(w.id)===dlg)).map(w=>w.id);
  tri={ln,dlg:dlg||0,list,i:0,n:{hard:0,learn:0,know:0,mast:0,skip:0}};
  renderLib();
}
function endTriage(){tri=null;renderLib();badge();}
function triageBack(){if(tri&&tri.i>0){tri.i--;renderLib();}}
function triageAct(a){
  if(!tri)return;
  const wid=tri.list[tri.i];
  /* 'learn' on a word already marked known or hard starts it over as a new card */
  if(wid&&a==='learn'){ if(isHard(wid))S.hard=S.hard.filter(x=>x!==wid); if(confOf(wid)>=3)MODES.forEach(m=>{if(S.settings.modes[m])S.cards[cardId(wid,m)]={};}); }
  if(!wid)return;
  tri.acts=tri.acts||{}; if(tri.acts[wid])tri.n[tri.acts[wid]]--; tri.acts[wid]=['hard','learn','know','mast'].includes(a)?a:'skip';
  if(a==='hard'){trackWord(wid);addHard(wid);S.pick=S.pick||[];if(!S.pick.includes(wid))S.pick.push(wid);tri.n.hard++;}
  else if(a==='learn'){trackWord(wid);tri.n.learn++;}
  else if(a==='know'){markKnown(wid);tri.n.know++;}
  else if(a==='mast'){markMastered(wid);tri.n.mast++;}
  else tri.n.skip++;
  save();tri.i++;badge();renderLib();
}
function renderTriage(){
  const el=document.getElementById('vLib');
  const total=tri.list.length;
  if(tri.i>=total){
    el.innerHTML=`<div class="card done">
      <div class="zhd zh">分類完成</div>
      <div style="font-weight:600;font-size:16px;margin-bottom:6px">${lnLabel(tri.ln)} triaged</div>
      <div class="muted small">${tri.n.hard} hard · ${tri.n.learn} learning · ${tri.n.know} known · ${tri.n.mast} mastered · ${tri.n.skip} skipped</div>
      <div class="qfoot" style="margin-top:18px">
        <button class="btn ghost" onclick="endTriage()">Back to Library</button>
        ${tri.n.hard?`<button class="btn" onclick="const l=tri.ln;endTriage();drillScope='hard';drillLesson=l;go('drill')">Drill the hard ones →</button>`:''}
      </div></div>`;
    return;
  }
  const w=byId[tri.list[tri.i]];
  const st=wordStatus(w.id);
  el.innerHTML=`
  <div class="rev-top">
    <span class="mtag rec">Triage · ${esc(lnLabel(tri.ln))}</span>
    <span>${tri.i+1} / ${total}${tri.i?` · <span class="link" onclick="triageBack()">← back</span>`:''} · <span class="link" onclick="endTriage()">exit</span></span>
  </div>
  <div class="prog" style="margin-bottom:14px;border-radius:3px"><i style="width:${Math.round(tri.i/total*100)}%"></i></div>
  <div class="stage" style="min-height:300px">
    <div class="bigzh zh">${esc(w.t)}</div>
    <div class="row" style="justify-content:center;gap:9px"><span class="pyline">${tonePinyin(esc(w.p))}</span>${spkBtn(w.id)}</div>
    ${w.pos?`<div class="pos">${esc(w.pos)}</div>`:''}
    <div class="meaning">${esc(w.m)}</div>
    ${w.s?`<div class="simpnote">简体 ${esc(w.s)}</div>`:''}
    ${compLines(w.t)}
    ${st?`<div class="small muted">already in deck · ${esc(st.t)}</div>`:''}
  </div>
  <div class="tri-acts">
    <button class="tbn hard" onclick="triageAct('hard')"><b>1</b> Hard — drill it</button>
    <button class="tbn" onclick="triageAct('learn')"><b>2</b> Learning</button>
    <button class="tbn ok" onclick="triageAct('know')"><b>3</b> Know ✓</button>
    <button class="tbn ok" onclick="triageAct('mast')"><b>4</b> Mastered ★</button>
    <button class="tbn skip" onclick="triageAct('skip')"><b>5</b> Skip</button>
  </div>
  <div class="small muted kbh" style="text-align:center;margin-top:10px">keys <kbd>1</kbd>–<kbd>5</kbd> · <kbd>space</kbd> hear it again</div>`;
  if(S.settings.autoplayAudio)setTimeout(()=>speakWord(w.id),120);
}

var DLGSPLIT={}, DLG={};
(function(){for(const k in DLGMAP){const s=DLGMAP[k];DLGSPLIT[k]=(s.match(/1/g)||[]).length;
  WORDS.filter(w=>w.l===+k).forEach((w,i)=>{const d=+s[i];if(d)DLG[w.id]=d;});}})();
/* defensive: the app's first render runs before this block executes, so these
   must never throw on undefined — otherwise the rest of the script dies. */
function dlgOf(wid){return (typeof DLG!=='undefined'&&DLG&&DLG[wid])||0;}
function hasDlg(ln){return !!(typeof DLGSPLIT!=='undefined'&&DLGSPLIT&&DLGSPLIT[ln]);}
function dlgWords(ln,d){if(!hasDlg(ln))return [];return WORDS.filter(w=>w.l===ln&&(S.settings.includeNames||!isName(w))&&dlgOf(w.id)===d);}
function dlgTag(wid){const d=dlgOf(wid);return d?`<span class="dtag d${d}">聽寫${d===1?'一':'二'}</span>`:'';}

var LIBIDX=null, libTimer=null, libComposing=false, libShowAll=false, libPaintTok=0;
var LIB_PAGE=45;          /* rows painted synchronously */
var LIB_CHUNK=60;         /* rows appended per animation frame */

function libStrip(s){
  /* ā→a etc. so "lese"/"laji" both find 垃圾 and "nuli" finds 努力 */
  return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
}
/* Thorne learned mainland readings; he will type those. Taiwan reading stays
   primary everywhere in the UI — these are search aliases only. */
var READ_ALIAS={'垃圾':'laji','星期':'xingqi','法國':'faguo','網路':'wangluo','期':'qi',
  '和':'he','企業':'qiye','危險':'weixian'};
function buildLibIdx(){
  if(LIBIDX)return LIBIDX;
  LIBIDX=WORDS.map(w=>{
    const p=libStrip(w.p);
    const pn=p.replace(/[^a-z0-9]/g,'');
    const al=READ_ALIAS[w.t]||'';
    return {w, t:w.t, p, pn, alias:al, m:libStrip(w.m)};
  });
  return LIBIDX;
}
function libWordStart(hay,q){
  let i=hay.indexOf(q);
  while(i>-1){ if(i===0||!/[a-z0-9]/.test(hay[i-1]))return true; i=hay.indexOf(q,i+1); }
  return false;
}
/* higher = better. 0 means no match. */
function libScore(e,q,qn){
  if(e.t===q)return 100;
  if(e.t.indexOf(q)===0)return 92;
  if(e.t.indexOf(q)>-1)return 84;
  let py=0, en=0;
  if(qn){
    if(e.pn===qn)py=76;
    else if(e.alias&&e.alias===qn)py=74;
    else if(e.pn.indexOf(qn)===0)py=68;
    else if(e.alias&&e.alias.indexOf(qn)===0)py=66;
    else if(e.p.indexOf(qn)>-1||e.pn.indexOf(qn)>-1)py=52;
  }
  /* an English word that is the whole gloss, or one of its senses, outranks a pinyin fragment:
     "he" should find 他 before every word whose pinyin merely contains "he" */
  if(e.m===q)en=72;
  else if(libSense(e.m,q))en=70;
  else if(e.m.indexOf(q)===0)en=40;
  else if(libWordStart(e.m,q))en=32;
  else if(e.m.indexOf(q)>-1)en=18;
  return Math.max(py,en);
}
/* true when q is one complete sense of a gloss: "to eat; to have a meal" → "eat" */
function libSense(m,q){
  return String(m).split(/[,;\/()]/).some(s=>s.trim().replace(/^(to|a|an|the) /,'')===q);
}
function libPassesFilter(w){
  if(!S.settings.includeNames&&isName(w))return false;
  if(libFilter==='all')return true;
  const st=wordStatus(w.id);
  if(libFilter==='tracked')return !!st;
  if(libFilter==='untracked')return !st;
  if(libFilter==='due')return !!st&&st.k==='due';
  if(libFilter==='simp')return !!w.s;
  return true;
}
function libMatches(q){
  const idx=buildLibIdx();
  const qq=libStrip(q).trim();
  const qn=qq.replace(/[^a-z0-9]/g,'');
  /* one Latin letter matches 80% of the dictionary as a substring, which is noise
     and slow. Demand a real match: 字, pinyin prefix, or start of a meaning word. */
  const floor=(qq.length===1&&/^[a-z0-9]$/.test(qq))?66:1;
  const hits=[];
  for(let k=0;k<idx.length;k++){
    const e=idx[k];
    const s=libScore(e,qq,qn);
    if(s<floor)continue;
    if(!libPassesFilter(e.w))continue;
    hits.push({w:e.w,s:s,k:k});
  }
  hits.sort((a,b)=>b.s-a.s || a.w.l-b.w.l || a.k-b.k);
  return hits;
}

/* ---------- chrome: built once, never rebuilt while typing ---------- */
function libEnsureChrome(){
  const el=document.getElementById('vLib');
  if(document.getElementById('libChrome'))return;
  el.innerHTML=`<div id="libChrome"></div><div id="libResults"></div>`;
  document.getElementById('libChrome').innerHTML=`
    <div class="searchwrap">
      <input id="libQ" class="search" placeholder="Search 字 · pinyin · meaning — tones optional"
             autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(libSearch)}">
      <button id="libQx" class="searchx" title="clear" style="display:${libSearch?'':'none'}">✕</button>
    </div>
    <div class="segbar"><span class="cap">Book</span>
      ${bookButtons(libBook)}
    </div>
    <div class="filters">
      ${[['all','All'],['tracked','In deck'],['due','Due'],['untracked','Not started'],['simp','Trad ≠ Simp']]
        .map(([k,t])=>`<button data-f="${k}">${t}</button>`).join('')}
    </div>`;
  const inp=document.getElementById('libQ');
  inp.addEventListener('compositionstart',()=>{libComposing=true;});
  inp.addEventListener('compositionend',()=>{libComposing=false;libQueue(inp.value);});
  inp.addEventListener('input',()=>{ if(!libComposing) libQueue(inp.value); });
  inp.addEventListener('keydown',e=>{ if(e.key==='Escape'){inp.value='';libQueue('');} });
  document.getElementById('libQx').addEventListener('click',()=>{
    inp.value=''; libQueue(''); inp.focus();
  });
  document.getElementById('libChrome').addEventListener('click',e=>{
    const b=e.target.closest('button[data-bk],button[data-f]'); if(!b)return;
    if(b.dataset.bk){libBook=+b.dataset.bk;openLessons={};}
    else{libFilter=b.dataset.f;}
    libShowAll=false; libSyncChrome(); renderLibResults();
  });
}
function libSyncChrome(){
  const c=document.getElementById('libChrome'); if(!c)return;
  c.querySelectorAll('button[data-bk]').forEach(b=>b.classList.toggle('on',+b.dataset.bk===libBook));
  c.querySelectorAll('button[data-f]').forEach(b=>b.classList.toggle('on',b.dataset.f===libFilter));
  const x=document.getElementById('libQx'); if(x)x.style.display=libSearch?'':'none';
  const inp=document.getElementById('libQ');
  if(inp&&inp.value!==libSearch&&document.activeElement!==inp)inp.value=libSearch;
}
function libQueue(v){
  libSearch=v; libShowAll=false;
  const x=document.getElementById('libQx'); if(x)x.style.display=v?'':'none';
  clearTimeout(libTimer);
  libTimer=setTimeout(renderLibResults,90);
}

/* ---------- results ---------- */
function libResultsPaint(){
  const box=document.getElementById('libResults'); if(!box)return;
  const keepScroll=window.scrollY;                 /* row buttons re-render; don't jump */
  requestAnimationFrame(()=>{if(Math.abs(window.scrollY-keepScroll)>4)window.scrollTo(0,keepScroll);});
  const tok=++libPaintTok;                     /* cancels any in-flight chunked paint */
  const q=libSearch.trim();
  if(q){
    const hits=libMatches(q);
    if(!hits.length){
      box.innerHTML=`<div class="card"><div class="small muted" style="text-align:center;padding:18px 0">
        Nothing matches <b>${esc(q)}</b>${libFilter!=='all'?` in <b>${esc(libFilter)}</b>`:''}.
        ${libFilter!=='all'?`<div style="margin-top:8px"><span class="link" onclick="libFilter='all';libSyncChrome();renderLibResults()">search all words instead</span></div>`:''}
      </div></div>`;
      return;
    }
    const cap=libShowAll?hits.length:Math.min(hits.length,LIB_PAGE);
    box.innerHTML=`<div class="card">
      <div class="row spread" style="margin-bottom:4px">
        <div class="lab" style="margin-bottom:0">${hits.length} match${hits.length===1?'':'es'}</div>
        ${hits.length>LIB_PAGE&&!libShowAll?`<button class="btn sm ghost" onclick="libShowAll=true;renderLibResults()">Show all ${hits.length}</button>`:''}
      </div>
      <div class="wl" id="libRows"></div>
      <div class="small muted" id="libMore" style="margin-top:10px"></div>
    </div>`;
    const rows=document.getElementById('libRows');
    const first=Math.min(cap,LIB_PAGE);
    rows.innerHTML=hits.slice(0,first).map(h=>wrowHtml(h.w,true)).join('');
    if(cap>first){
      /* paint the rest across frames so the keystroke never blocks */
      let i=first;
      const step=()=>{
        if(tok!==libPaintTok)return;
        const end=Math.min(i+LIB_CHUNK,cap);
        rows.insertAdjacentHTML('beforeend',hits.slice(i,end).map(h=>wrowHtml(h.w,true)).join(''));
        i=end;
        if(i<cap)requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    const more=document.getElementById('libMore');
    if(more)more.textContent = hits.length>cap
      ? `Showing the ${cap} closest matches of ${hits.length}.`
      : (hits.length>6?`Ranked: exact 字 first, then pinyin, then meaning.`:'');
    return;
  }
  /* no query — the lesson accordions, unchanged in behaviour */
  const [lnStart,lnEnd]=bookRange(libBook);
  let html='';
  for(let ln=lnStart;ln<=lnEnd;ln++){
    const all=LESSON_WORDS[ln]||[];
    const ws=all.filter(libPassesFilter);
    if(!ws.length&&libFilter!=='all')continue;
    const nTracked=all.filter(w=>tracked(w.id)).length;
    const open=!!openLessons[ln]||libFilter!=='all';
    html+=`<div class="lesson ${open?'open':''}">
      <div class="head" onclick="openLessons[${ln}]=!openLessons[${ln}];renderLibResults()">
        <span class="car">▶</span>
        <div><div class="ttl">${lnLabel(ln)} · ${LESSON_TITLES[ln]}</div><div class="sub">${nTracked} of ${all.length} in deck</div></div>
        <div class="acts">
          <button class="btn sm" onclick="event.stopPropagation();startTriage(${ln})" title="step through this lesson word by word and sort it">Triage</button>
          ${hasDlg(ln)?`<button class="btn sm ghost" onclick="event.stopPropagation();startTriage(${ln},1)" title="only the Dialogue I words — the 聽寫一 set">Triage 聽寫一</button>
          <button class="btn sm ghost" onclick="event.stopPropagation();startTriage(${ln},2)" title="only the Dialogue II words — the 聽寫二 set">Triage 聽寫二</button>`:''}
          ${nTracked<all.length?`<button class="btn sm ghost" onclick="event.stopPropagation();(LESSON_WORDS[${ln}]||[]).forEach(w=>trackWord(w.id));renderLib();badge()">Study lesson</button>
          <button class="btn sm ghost" title="mark whole lesson as already known" onclick="event.stopPropagation();if(confirm('Mark all of ${lnLabel(ln)} as already known? They skip learning and re-check in about 3 weeks.')){(LESSON_WORDS[${ln}]||[]).forEach(w=>markKnown(w.id));renderLib();badge();}">Know it all</button>`
          :`<button class="btn sm ghost" onclick="event.stopPropagation();if(confirm('Remove all ${lnLabel(ln)} cards and their progress?')){(LESSON_WORDS[${ln}]||[]).forEach(w=>untrackWord(w.id));renderLib();badge();}">Remove</button>`}
        </div>
      </div>
      <div class="prog"><i style="width:${all.length?Math.round(nTracked/all.length*100):0}%"></i></div>
      ${open?`<div class="wl">${ws.map(w=>wrowHtml(w)).join('')}</div>`:''}
    </div>`;
  }
  box.innerHTML=html;
}
function renderLibResults(){
  libResultsPaint();
  try{
  if(libSearch.trim())return;
  const box=document.getElementById('libResults'); if(!box)return;
  const csm=charStageMap();
  const [lnStart,lnEnd]=bookRange(libBook);
  /* overview strip: one mini ring per lesson, tap to open it */
  let strip='', bookChars=new Set(), bookKnown=0;
  for(let ln=lnStart;ln<=lnEnd;ln++){
    const m=lessonMastery(ln,csm); lessonChars(ln).forEach(ch=>bookChars.add(ch));
    const cur=(S.settings.curLesson||0)===ln;
    strip+=`<div class="lmini ${cur?'cur':''} ${m.known?'':'none'}" title="${esc(lnLabel(ln))} · ${LESSON_TITLES[ln]||''} · ${m.known}/${m.n} characters known" onclick="openLessons[${ln}]=true;renderLibResults();setTimeout(()=>{const e=document.querySelector('.lesson[data-ln=&quot;${ln}&quot;]');if(e)e.scrollIntoView({behavior:'smooth',block:'start'});},40)">
      ${ring2(m,40,4)}<span class="lm-n">${lnInBook(ln)}</span><span class="lm-p">${m.n?Math.round(m.frac*100):0}%</span></div>`;
  }
  bookChars.forEach(ch=>{if((csm[ch]||0)>=3)bookKnown++;});
  const pct=bookChars.size?Math.round(bookKnown/bookChars.size*100):0;
  box.insertAdjacentHTML('afterbegin',`<div class="card lmap"><div class="row spread" style="margin-bottom:10px"><div class="lab" style="margin:0">Book ${(BOOKS.find(b=>b.n===libBook)||BOOKS[0]).zh} · characters you know</div><div class="small muted"><b data-count="${bookKnown}">0</b> of ${bookChars.size} · ${pct}%</div></div>
    <div class="lstrip">${strip}</div>
    <div class="small muted" style="margin-top:8px">Dark arc = characters that hold for 3 weeks or more. Pale arc = met and still learning. A character counts once you know it in any word, so later lessons fill in before you reach them.</div></div>`);
  /* per-lesson ring in each accordion head */
  box.querySelectorAll('.lesson').forEach(el=>{
    const head=el.querySelector('.head'); if(!head)return;
    const mm=(head.getAttribute('onclick')||'').match(/openLessons\[(\d+)\]/); if(!mm)return;
    const ln=+mm[1]; el.dataset.ln=ln;
    const m=lessonMastery(ln,csm);
    head.insertAdjacentHTML('afterbegin',`<div class="lring" title="${m.known} of ${m.n} characters known">${ring2(m,44,4.5)}<span>${m.n?Math.round(m.frac*100):0}<i>%</i></span></div>`);
    const sub=el.querySelector('.sub'); if(sub)sub.innerHTML+=` · <b style="color:var(--acc);font-weight:600">${m.known}</b>/${m.n} 字 known${m.learn?` · ${m.learn} learning`:''}`;
  });
  countUp(box); ringArm(box);
  }catch(e){}
}

const CONF=[null,
  {t:'Hard',     c:'c1', d:'on the hard list — drill it'},
  {t:'Learning', c:'c2', d:'in the deck, not yet stable'},
  {t:'Know',     c:'c3', d:'stable for 3 weeks or more'},
  {t:'Mastered', c:'c4', d:'stable for 2 months or more'}];
function confOf(wid){
  if(isHard(wid))return 1;
  const cs=MODES.map(m=>S.cards[cardId(wid,m)]).filter(Boolean);
  if(!cs.length)return 0;
  const real=cs.filter(c=>c.st!==undefined);
  if(!real.length||real.length<cs.length)return 2;
  const minS=Math.min(...real.map(c=>c.S||0));
  return minS>=60?4:minS>=21?3:2;
}
function confCounts(ln){
  const n=[0,0,0,0,0];
  for(const w of WORDS){ if(ln&&w.l!==ln)continue; if(!S.settings.includeNames&&isName(w))continue; n[confOf(w.id)]++; }
  return n;
}
function confSnapshot(){
  const words={};
  for(const w of WORDS){ const l=confOf(w.id); if(l) words[w.t+'|'+lnLabel(w.l)]=l; }
  return {v:1, at:new Date().toISOString(), scale:{1:'Hard',2:'Learning',3:'Know',4:'Mastered'}, words};
}
/* Library rows show the level instead of the old queued/learning/solid tag */
/* Settings card: counts + the sync file */
function confText(){ return JSON.stringify(confSnapshot()); }
function confCopy(){
  const t=confText();
  const done=()=>alert('Copied — paste it to Claude to update the Notion Confidence column.');
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done,()=>prompt('Copy this:',t));}
  else prompt('Copy this:',t);
}
function confDownload(){
  const blob=new Blob([confText()],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='zika-notion-sync-'+dkey(new Date())+'.json';a.click();
}
function confPanel(){
  const n=confCounts();
  return `<div class="card"><div class="lab">Confidence · shared with Notion</div>
    <div class="confrow">${[1,2,3,4].map(l=>`<div class="stat"><div class="n">${n[l]}</div><div class="l"><span class="tag ${CONF[l].c}">${l} · ${CONF[l].t}</span></div></div>`).join('')}</div>
    <div class="small muted" style="margin-bottom:10px">The same four levels as the <b>Confidence</b> column of the Notion Characters table. They come from your real card state — Triage sets them, and reviews move them: stable 3+ weeks → Know, 2+ months → Mastered, a lapse → back to Learning. Hard always wins while a word is on the hard list. Your automatic backup file carries these levels, so Claude can read it and update Notion.</div>
    <div class="set-row"><div><b>Sync file</b><div class="d">Just the levels, keyed by word and lesson. Copy or download it and hand it to Claude to update Notion right now.</div></div>
      <div class="row"><button class="btn ghost sm" onclick="confCopy()">Copy</button><button class="btn ghost sm" onclick="confDownload()">Download</button></div></div>
  </div>`;
}

/* confidence badges: pills that pop when a word's level changes */
const confSeen={};

/* character stage map: ch → best stage across every tracked word that contains it */
function charStageMap(){
  const m={};
  for(const cid in S.cards){
    const c=S.cards[cid]; if(!c||c.st===undefined)continue;
    const w=byId[cid.split(':')[0]]; if(!w)continue;
    const st=wordStage(w.id);
    for(const ch of w.t){ if(/\p{Script=Han}/u.test(ch)&&(m[ch]===undefined||st>m[ch]))m[ch]=st; }
  }
  return m;
}
function lessonChars(ln){const set=new Set();(LESSON_WORDS[ln]||[]).forEach(w=>{if(!S.settings.includeNames&&isName(w))return;for(const ch of w.t)if(/\p{Script=Han}/u.test(ch))set.add(ch);});return [...set];}
/* per lesson: how many of its characters are solid (stage ≥3), learning (1–2), untouched */
function lessonMastery(ln,csm){
  csm=csm||charStageMap();
  const chars=lessonChars(ln); let solid=0,learn=0,mast=0;
  chars.forEach(ch=>{const st=csm[ch]||0; if(st>=4)mast++; else if(st===3)solid++; else if(st>=1)learn++;});
  return {n:chars.length,mast,solid,learn,known:mast+solid,frac:chars.length?(mast+solid)/chars.length:0,lfrac:chars.length?(mast+solid+learn)/chars.length:0};
}
/* two-tone ring: outer solid arc (known) drawn over a paler arc (learning) */
function ring2(m,size,stroke){
  const r=(size-stroke)/2, C=2*Math.PI*r;
  const arc=(f,cls)=>`<circle class="${cls}" cx="${size/2}" cy="${size/2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-off="${C*(1-Math.max(0,Math.min(1,f)))}"/>`;
  return `<svg class="ring r2 ${m.frac>=0.999&&m.n?'full':''}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle class="bg" cx="${size/2}" cy="${size/2}" r="${r}" stroke-width="${stroke}"/>${arc(m.lfrac,'fg soft')}${arc(m.frac,'fg')}</svg>`;
}
