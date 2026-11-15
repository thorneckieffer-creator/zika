/* 寫字測驗, the writing mastery test: English and pinyin in, the character written on paper, marked ★ ~ ✗ by the
   learner; ✗ and ~ words go to the catch-up lane. */

function mtGet(){S.mtest=S.mtest||{lo:9,hi:21,res:{},order:[],i:0,started:0};return S.mtest;}
function mtWords(){const T=mtGet();return WORDS.filter(w=>w.l>=T.lo&&w.l<=T.hi&&!isName(w)&&!/[+＋]|number|noun/i.test(w.t)).map(w=>w.id);}
function mtStart(lo,hi){const T=mtGet();if(lo)T.lo=lo;if(hi)T.hi=hi;T.order=mtWords();T.i=T.order.findIndex(id=>!T.res[id]);if(T.i<0)T.i=0;T.started=T.started||Date.now();save();drillMode='mtest';dq=null;MT.revealed=false;go('drill');}
function mtResume(){const T=mtGet();if(!T.order.length)return mtStart();T.i=T.order.findIndex(id=>!T.res[id]);if(T.i<0)T.i=T.order.length;drillMode='mtest';dq=null;MT.revealed=false;go('drill');}
function mtJump(ln){const T=mtGet();const i=T.order.findIndex(id=>byId[id].l===ln&&!T.res[id]);if(i>=0){T.i=i;MT.revealed=false;mtRender();}}
const MT={revealed:false,stack:[]};
function mtApply(wid,r){
  if(r==='m'){markMastered(wid);S.hard=(S.hard||[]).filter(x=>x!==wid);}
  else{untrackWord(wid);trackWord(wid);S.hard=(S.hard||[]).filter(x=>x!==wid);
    if(r==='h'){addHard(wid);S.pick=S.pick||[];if(!S.pick.includes(wid))S.pick.push(wid);}}
}
function mtMark(r){
  {const T=mtGet(),wid=T.order[T.i];if(wid){MT.stack.push({wid,i:T.i,cards:JSON.parse(JSON.stringify(MODES.map(m=>S.cards[cardId(wid,m)]||null))),hard:isHard(wid),pick:(S.pick||[]).includes(wid),prev:T.res[wid]||null});if(MT.stack.length>50)MT.stack.shift();}}
  const T=mtGet(),wid=T.order[T.i];if(!wid)return;
  T.res[wid]=r;mtApply(wid,r);haptic(r==='h'?'again':'good');
  T.i++;MT.revealed=false;save();badge();
  if(T.i>=T.order.length||byId[T.order[T.i]].l!==byId[wid].l){/* lesson boundary: pause here */}
  mtRender();
}
function mtUndo(){const u=MT.stack.pop();if(!u)return;const T=mtGet();
  MODES.forEach((m,i)=>{const c=u.cards[i];if(c)S.cards[cardId(u.wid,m)]=c;else delete S.cards[cardId(u.wid,m)];});
  S.hard=(S.hard||[]).filter(x=>x!==u.wid);if(u.hard)S.hard.push(u.wid);
  S.pick=(S.pick||[]).filter(x=>x!==u.wid);if(u.pick)S.pick.push(u.wid);
  if(u.prev)T.res[u.wid]=u.prev;else delete T.res[u.wid];
  T.i=u.i;MT.revealed=false;save();badge();mtRender();}
function mtStats(ln){const T=mtGet();const ids=T.order.length?T.order:mtWords();const sub=ln?ids.filter(id=>byId[id].l===ln):ids;const n={m:0,l:0,h:0,todo:0};sub.forEach(id=>{const r=T.res[id];if(r)n[r]++;else n.todo++;});n.n=sub.length;n.done=n.n-n.todo;return n;}
function mtRender(){
  mtRenderBase.apply(this,arguments);
  mtRenderLookup();
  try{const g=document.querySelectorAll('#vDrill .grades button');g.forEach(b=>{const s=b.querySelector('.g1,.g2,.g4');if(!s)return;if(/Couldn/.test(s.textContent))s.textContent='✗ Hell no';else if(/Shaky/.test(s.textContent))s.textContent='~ Sorta';else if(/Wrote/.test(s.textContent))s.textContent='★ Yes';});}catch(e){}
}
/* a function of its own, so that its early return ends only this step */
function mtRenderBase(){
  const el=document.getElementById('vDrill'),T=mtGet();
  const wid=T.order[T.i],w=wid&&byId[wid];
  const tot=mtStats(),lessons=[];for(let l=T.lo;l<=T.hi;l++)lessons.push(l);
  const strip=`<div class="lstrip" style="margin:8px 0 4px">${lessons.map(l=>{const s=mtStats(l);const m={n:s.n,frac:s.n?s.m/s.n:0,lfrac:s.n?s.done/s.n:0};const cur=w&&w.l===l;return `<div class="lmini ${cur?'cur':''}" title="${esc(lnLabel(l))} · ★${s.m} ~${s.l} ✗${s.h} · ${s.todo} left" onclick="mtJump(${l})">${ring2(m,40,4)}<span class="lm-n">${lnShort(l)}</span><span class="lm-p">${s.done}/${s.n}</span></div>`;}).join('')}</div>`;
  if(!w){el.innerHTML=`<div class="card done"><div class="zhd zh">寫完了</div><div style="font-weight:600;font-size:16px">Test complete · ${tot.n} words</div>
    <div class="sum" style="margin-top:14px"><div><b>${tot.m}</b><span>★ wrote it</span></div><div><b>${tot.l}</b><span>~ shaky</span></div><div><b>${tot.h}</b><span>✗ couldn’t</span></div></div>
    <div class="small muted" style="margin-top:12px">Shaky and ✗ words are in your deck with their write cards live; ✗ words are on the hard list and tonight’s paper. ★ words are parked and resurface in about three months.</div>
    <div class="row" style="justify-content:center;gap:8px;margin-top:16px"><button class="btn" onclick="go('home')">Back to Today</button><button class="btn ghost" onclick="if(confirm('Restart the whole test? Results stay applied to the deck.')){S.mtest.res={};mtStart();}">Restart</button></div></div>`;return;}
  const r=MT.revealed, s=mtStats(w.l);
  el.innerHTML=`<div class="rev-top"><span class="qtype">寫字測驗 · Writing mastery test</span><span class="qprog">${esc(lnLabel(w.l))} · ${s.done+1} / ${s.n} · ${tot.done} of ${tot.n} overall</span></div>
  ${strip}
  <div class="stage ${animOn()?(r?'flip-in':'slide-in'):''}" style="min-height:300px">
    <div class="hint">read it · write the 字 on paper · say the tones · then check</div>
    ${w.pos?`<div class="pos">${esc(w.pos)}</div>`:''}
    <div class="meaning" style="font-size:23px">${esc(w.m)}</div>
    <div class="row" style="justify-content:center;gap:9px"><span class="pyline" style="font-size:24px">${tonePinyin(esc(w.p))}</span>${spkBtn(w.id)}</div>
    ${r?`<div class="bigzh zh" style="font-size:56px;margin-top:4px">${esc(w.t)}</div>${S.settings.strokeAnim?`<div id="strokeHost" class="strokerow"></div>`:''}${w.s?`<div class="simpnote">简体 ${esc(w.s)}</div>`:''}${compLines(w.t)}`:''}
  </div>
  ${r?`<div class="grades mt3"><button onclick="mtMark('h')"><span class="g1">✗ Couldn’t</span><span class="iv">learning + hard + paper</span></button><button onclick="mtMark('l')"><span class="g2">~ Shaky</span><span class="iv">into the deck</span></button><button onclick="mtMark('m')"><span class="g4">★ Wrote it</span><span class="iv">parked · 3 months</span></button></div>
    <div class="small muted" style="text-align:center;margin-top:10px"><kbd>1</kbd> couldn’t · <kbd>2</kbd> shaky · <kbd>3</kbd> wrote it${T.i>0?` · <span class="link" onclick="mtUndo()">← undo last</span>`:''} · <span class="link" onclick="go('home')">pause</span></div>`
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
  mtOwnEarlyBase.apply(this,arguments);
  try{if(view==='catch')renderCatch();}catch(e){}
}
/* a function of its own, so that its early return ends only this step */
function mtOwnEarlyBase(){if(!confirm('Mark every B1 L1–L8 word as mastered? They leave the queue and resurface in about three months.'))return;let n=0;WORDS.filter(w=>w.l<=8&&!isName(w)).forEach(w=>{if(!(MODES.some(m=>(S.cards[cardId(w.id,m)]||{}).mastAt))){markMastered(w.id);n++;}});S.hard=(S.hard||[]).filter(x=>byId[x].l>8);save();badge();toast(n+' words parked');renderHome();}
/* Today card */
function mtPanel(){return '';}
/* mastery test: a real undo stack */
