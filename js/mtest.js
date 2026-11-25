/* 寫字測驗, the writing test, run as a crash course: English and pinyin in, the character written on paper, then the
   learner sorts the word into one of six piles, from "never saw it" to "wrote it". Every pile but "wrote it" goes
   to the catch-up lane. */

/* the six piles, worst first; the number keys 1–6 follow this order */
const MT_GRADES=[
  {r:'h',k:'g1',t:'✗ Don’t know',iv:'never saw it · hard + paper',s:'✗ don’t know it'},
  {r:'s',k:'g1',t:'Learned a bit',iv:'hard list',s:'learned a little'},
  {r:'b',k:'g2',t:'Barely read',iv:'hard list',s:'barely recognize'},
  {r:'l',k:'g2',t:'~ Kind of read',iv:'can’t write',s:'~ kind of recognize'},
  {r:'r',k:'g3',t:'Read it',iv:'can’t write yet',s:'read it, can’t write'},
  {r:'m',k:'g4',t:'★ Wrote it',iv:'parked · 3 months',s:'★ wrote it'}];

/* The first learner's crash course runs from Book 1 Lesson 11 to the end of Book 2; a deck made by the clean first
   run keeps its own book so far. A test saved before v68 (three piles, no `cc`) is started again over that range,
   with its old results kept beside it in `was`. The saved test itself says whether that has happened, not a flag in
   the settings, so that a deck taken over from a device still on v67 is converted too (docs/decisions.md). */
function mtGet(){
  const T=S.mtest;if(T&&T.cc)return T;
  if(S.settings.born){S.mtest=T?Object.assign(T,{cc:1}):{lo:bookRange(bookOf(shLesson()))[0],hi:shLesson(),res:{},order:[],i:0,started:0,cc:1};return S.mtest;}
  S.mtest={lo:BOOKS[0].first+10,hi:BOOKS[1].first+BOOKS[1].count-1,res:{},order:[],i:0,started:0,cc:1};
  if(T&&T.res&&Object.keys(T.res).length)S.mtest.was={lo:T.lo,hi:T.hi,res:T.res};
  return S.mtest;}
function mtWords(){const T=mtGet();return WORDS.filter(w=>w.l>=T.lo&&w.l<=T.hi&&!isName(w)&&!/[+＋]|number|noun/i.test(w.t)).map(w=>w.id);}
function mtStart(lo,hi){const T=mtGet();if(lo)T.lo=lo;if(hi)T.hi=hi;T.order=mtWords();T.i=T.order.findIndex(id=>!T.res[id]);if(T.i<0)T.i=0;T.started=T.started||Date.now();save();drillMode='mtest';dq=null;MT.revealed=false;go('drill');}
function mtResume(){const T=mtGet();if(!T.order.length)return mtStart();T.i=T.order.findIndex(id=>!T.res[id]);if(T.i<0)T.i=T.order.length;drillMode='mtest';dq=null;MT.revealed=false;go('drill');}
function mtJump(ln){const T=mtGet();const i=T.order.findIndex(id=>byId[id].l===ln&&!T.res[id]);if(i>=0){T.i=i;MT.revealed=false;mtRender();}}
const MT={revealed:false,stack:[]};
/* what a pile does to the deck: "wrote it" parks the word; "read it" keeps the reading card and starts the writing
   card over; the rest start both over, the three that cannot be read go on the hard list, and the last on the paper */
function mtApply(wid,r){
  S.hard=(S.hard||[]).filter(x=>x!==wid);
  if(r==='m'){markMastered(wid);return;}
  if(r==='r'){trackWord(wid);if(S.settings.modes.prod)S.cards[cardId(wid,'prod')]={};return;}
  untrackWord(wid);trackWord(wid);
  if(r!=='l')addHard(wid);
  if(r==='h'){S.pick=S.pick||[];if(!S.pick.includes(wid))S.pick.push(wid);}
}
function mtMark(r){
  {const T=mtGet(),wid=T.order[T.i];if(wid){MT.stack.push({wid,i:T.i,cards:JSON.parse(JSON.stringify(MODES.map(m=>S.cards[cardId(wid,m)]||null))),hard:isHard(wid),pick:(S.pick||[]).includes(wid),prev:T.res[wid]||null});if(MT.stack.length>50)MT.stack.shift();}}
  const T=mtGet(),wid=T.order[T.i];if(!wid)return;
  T.res[wid]=r;mtApply(wid,r);haptic(r==='h'?'again':'good');
  T.i++;MT.revealed=false;save();badge();
  mtRender();
}
function mtUndo(){const u=MT.stack.pop();if(!u)return;const T=mtGet();
  MODES.forEach((m,i)=>{const c=u.cards[i];if(c)S.cards[cardId(u.wid,m)]=c;else delete S.cards[cardId(u.wid,m)];});
  S.hard=(S.hard||[]).filter(x=>x!==u.wid);if(u.hard)S.hard.push(u.wid);
  S.pick=(S.pick||[]).filter(x=>x!==u.wid);if(u.pick)S.pick.push(u.wid);
  if(u.prev)T.res[u.wid]=u.prev;else delete T.res[u.wid];
  T.i=u.i;MT.revealed=false;save();badge();mtRender();}
/* counts per pile, for the whole test or one lesson; w = can read but not write, x = cannot read yet */
function mtStats(ln){const T=mtGet();const ids=T.order.length?T.order:mtWords();const sub=ln?ids.filter(id=>byId[id].l===ln):ids;const n={m:0,r:0,l:0,b:0,s:0,h:0,todo:0};sub.forEach(id=>{const r=T.res[id];if(r)n[r]++;else n.todo++;});n.n=sub.length;n.done=n.n-n.todo;n.w=n.r+n.l;n.x=n.b+n.s+n.h;return n;}
function mtRender(){
  mtRenderBase();
  mtRenderLookup();
}
/* a function of its own, so that its early return ends only this step */
function mtRenderBase(){
  const el=document.getElementById('vDrill'),T=mtGet();
  const wid=T.order[T.i],w=wid&&byId[wid];
  const tot=mtStats(),lessons=[];for(let l=T.lo;l<=T.hi;l++)lessons.push(l);
  const strip=`<div class="lstrip" style="margin:8px 0 4px">${lessons.map(l=>{const s=mtStats(l);const m={n:s.n,frac:s.n?s.m/s.n:0,lfrac:s.n?s.done/s.n:0};const cur=w&&w.l===l;return `<div class="lmini ${cur?'cur':''}" title="${esc(lnLabel(l))} · ★${s.m} · can’t write ${s.w} · can’t read ${s.x} · ${s.todo} left" onclick="mtJump(${l})">${ring2(m,40,4)}<span class="lm-n">${lnShort(l)}</span><span class="lm-p">${s.done}/${s.n}</span></div>`;}).join('')}</div>`;
  if(!w){el.innerHTML=`<div class="card done"><div class="zhd zh">寫完了</div><div style="font-weight:600;font-size:16px">Crash course sorted · ${tot.n} words</div>
    <div class="sum" style="margin-top:14px">${MT_GRADES.slice().reverse().map(g=>`<div><b>${tot[g.r]}</b><span>${g.s}</span></div>`).join('')}</div>
    <div class="small muted" style="margin-top:12px">Every word but the ★ ones is in your deck and in the Catch-up tab. The ones you cannot read yet are on the hard list; the ones you did not know at all are on tonight’s paper too. ★ words are parked and resurface in about three months.</div>
    <div class="row" style="justify-content:center;gap:8px;margin-top:16px"><button class="btn" onclick="go('catch')">Open Catch-up</button><button class="btn ghost" onclick="if(confirm('Restart the whole test? Results stay applied to the deck.')){S.mtest.res={};mtStart();}">Restart</button></div></div>`;return;}
  const r=MT.revealed, s=mtStats(w.l);
  el.innerHTML=`<div class="rev-top"><span class="qtype">寫字測驗 · Crash course</span><span class="qprog">${esc(lnLabel(w.l))} · ${s.done+1} / ${s.n} · ${tot.done} of ${tot.n} overall</span></div>
  ${strip}
  <div class="stage ${animOn()?(r?'flip-in':'slide-in'):''}" style="min-height:300px">
    <div class="hint">read it · write the 字 on paper · say the tones · then check</div>
    ${w.pos?`<div class="pos">${esc(w.pos)}</div>`:''}
    <div class="meaning" style="font-size:23px">${esc(w.m)}</div>
    <div class="row" style="justify-content:center;gap:9px"><span class="pyline" style="font-size:24px">${tonePinyin(esc(w.p))}</span>${spkBtn(w.id)}</div>
    ${r?`<div class="bigzh zh" style="font-size:56px;margin-top:4px">${dcZh(w.t)}</div>${S.settings.strokeAnim?`<div id="strokeHost" class="strokerow"></div>`:''}${w.s?`<div class="simpnote">简体 ${esc(w.s)}</div>`:''}${compLines(w.t)}`:''}
  </div>
  ${r?`<div class="grades mt3">${MT_GRADES.map(g=>`<button onclick="mtMark('${g.r}')"><span class="${g.k}">${g.t}</span><span class="iv">${g.iv}</span></button>`).join('')}</div>
    <div class="small muted" style="text-align:center;margin-top:10px"><span class="kbh"><kbd>1</kbd>–<kbd>6</kbd> in the same order · </span>${T.i>0?`<span class="link" onclick="mtUndo()">← undo last</span> · `:''}<span class="link" onclick="go('home')">pause</span></div>`
  :`<div style="margin-top:16px"><button class="btn big" onclick="MT.revealed=true;mtRender()">Show the character</button></div><div class="small muted" style="text-align:center;margin-top:10px"><span class="kbh"><kbd>space</kbd> · </span>${T.i>0?`<span class="link" onclick="mtUndo()">← undo last</span> · `:''}<span class="link" onclick="go('home')">pause — progress is saved</span></div>`}`;
  if(r&&S.settings.strokeAnim&&document.getElementById('strokeHost'))try{renderStrokes('strokeHost',w.t.split('（')[0],{});}catch(e){}
  if(!r&&S.settings.autoplayAudio&&MT.lastSpoken!==wid){MT.lastSpoken=wid;setTimeout(()=>speakWord(wid),200);}
}
/* a function of its own, so that its early return ends only this step */
function mtRenderLookup(){
  try{if(!MT.revealed)return;const T=mtGet(),wid=T.order[T.i];const st=document.querySelector('#vDrill .stage');if(wid&&st&&!st.querySelector('.lookup'))st.insertAdjacentHTML('beforeend',lookupRow(byId[wid].t));}catch(e){}
}
/* one tap: B1 L1–L8 are owned */
function mtOwnEarly(){
  mtOwnEarlyBase();
  try{if(view==='catch')renderCatch();}catch(e){}
}
/* a function of its own, so that its early return ends only this step */
function mtOwnEarlyBase(){if(!confirm('Mark every B1 L1–L8 word as mastered? They leave the queue and resurface in about three months.'))return;let n=0;WORDS.filter(w=>w.l<=8&&!isName(w)).forEach(w=>{if(!(MODES.some(m=>(S.cards[cardId(w.id,m)]||{}).mastAt))){markMastered(w.id);n++;}});S.hard=(S.hard||[]).filter(x=>byId[x].l>8);save();badge();toast(n+' words parked');renderHome();}
if(typeof zikaWhole==='function')zikaWhole();   /* the last line: this file arrived whole (index.html, js/boot.js) */
