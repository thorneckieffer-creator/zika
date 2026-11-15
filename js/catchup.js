/* The Catch-up tab: the shaky words from older lessons, lesson by lesson. */

function catchLessonCounts(ln){
  const now=Date.now(), T=mtGet(); const words=WORDS.filter(w=>w.l===ln&&!isName(w)&&!/[+＋]|number|noun/i.test(w.t));
  const n={n:words.length,m:0,l:0,h:0,todo:0,due:0,fresh:0,day:[0,0,0,0]};
  words.forEach(w=>{const r=T.res[w.id];if(r)n[r]++;else n.todo++;
    MODES.forEach(mm=>{const c=S.cards[cardId(w.id,mm)];if(!c||c.susp)return;if(mm==='prod'&&!prodInScope(w.id))return;if(c.st===undefined){if(r==='l'||r==='h')n.fresh++;}else if(c.due<=now&&!(c.known))n.due++;
      if(mm==='prod'&&c.st!==undefined&&!c.known&&(c.days||0)<=3&&c.last>new Date().setHours(0,0,0,0))n.day[c.days||0]++;});});
  return n;
}
function startCatchLesson(ln){REV_FILTER=c=>laneOf(c)==='catch'&&wordOf(c)&&wordOf(c).l===ln;go('rev');if(!cur){toast('Nothing due in '+lnLabel(ln)+' right now');go('catch');}}
function renderCatch(){
  const el=document.getElementById('vCatch'), T=mtGet(), L=laneCounts(), tot=mtStats();
  const lessons=[];for(let l=T.lo;l<=T.hi;l++)lessons.push(l);
  const pl=paperList().filter(it=>it.w.l<=T.hi&&it.w.l>=T.lo);
  el.innerHTML=`
  <div class="card hero" style="padding:22px 24px">
    <div class="hero-ring">${ringSvg(tot.n?tot.m/tot.n:0,112,9,'')}<div class="hero-n"><b data-count="${tot.m}">0</b><span>★ of ${tot.n}</span></div></div>
    <div class="hero-body"><div class="lab" style="margin-bottom:4px">追進度 · Catch-up · ${esc(lnLabel(T.lo))} → ${esc(lnLabel(T.hi))}</div>
      <div class="hero-line">${L.catch.due+L.catch.fresh?`${L.catch.due} due · ${L.catch.fresh} entering today`:(tot.todo?'Nothing due · keep testing':'All clear today')}</div>
      <div class="hero-meta"><span class="chip">${tot.done} tested</span><span class="chip">~ ${tot.l} shaky</span><span class="chip warn">✗ ${tot.h}</span><span class="chip">${tot.todo} untested</span></div>
      <div class="row" style="gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="btn ${L.catch.due+L.catch.fresh?'':'ghost'}" ${L.catch.due+L.catch.fresh?'':'disabled'} onclick="startLane('catch')">Review the shaky ones</button>
        <button class="btn ghost" onclick="mtResume()">${tot.done?'Continue the test':'Start the test'}</button>
      </div></div>
  </div>
  <div class="card"><div class="row spread" style="margin-bottom:8px"><div class="lab" style="margin:0">Lesson by lesson</div><div class="small muted">★ wrote it · ~ shaky · ✗ couldn’t · grey = untested</div></div>
    <div class="clist">${lessons.map(l=>{const c=catchLessonCounts(l);const m={n:c.n,frac:c.n?c.m/c.n:0,lfrac:c.n?(c.n-c.todo)/c.n:0};const active=c.due+c.fresh;
      return `<div class="crow ${c.todo===0&&c.l+c.h===0?'done':''}"><div class="lring">${ring2(m,44,4.5)}<span>${c.n?Math.round(c.m/c.n*100):0}<i>%</i></span></div>
        <div class="tier-b"><b>${esc(lnLabel(l))} · ${esc(LESSON_TITLES[l]||'')}</b><div class="small muted">${c.todo?`<b>${c.todo}</b> untested · `:''}★ ${c.m} · ~ ${c.l} · ✗ ${c.h}${active?` · <span style="color:var(--acc)">${c.due} due${c.fresh?', '+c.fresh+' new':''}</span>`:''}</div></div>
        <div class="tier-acts">${c.todo?`<button class="btn sm" onclick="mtResume();mtJump(${l})">Test</button>`:''}${active?`<button class="btn sm ghost" onclick="startCatchLesson(${l})">Review ${c.due+c.fresh}</button>`:''}<button class="btn sm ghost" onclick="drillScope='lesson';drillLesson=${l};go('drill');startDrill('dict')">聽寫</button>${notionLink(l)}</div></div>`;}).join('')}</div></div>
  ${pl.length?`<div class="card"><div class="row spread"><div class="lab" style="margin-bottom:0">Tonight’s paper · catch-up words</div><button class="btn sm ghost" onclick="printPaperSheet()">Print 田字格</button></div>
    <div class="paper-chips" style="margin-top:12px">${pl.map(it=>`<div class="pchip"><span class="tag2">${it.tag} ×${it.reps}</span><span class="c zh">${esc(it.w.t.split('（')[0])}</span><span class="p">${esc(it.w.p)}</span></div>`).join('')}</div></div>`:''}
  <div class="card"><div class="lab">How this lane works</div>
    <div class="small muted">Only words you marked ~ or ✗ in the test live here, plus the hard list. ${S.settings.newCatchPerDay} new ones enter each day on the day 1 ×20 → day 2 ×5 → day 3 ×1 paper taper, then FSRS spaces them out. Every grade button shows the return date; the Library row for any word says when it is back. Change the intake in Settings → Card strategy.</div></div>`;
  countUp(el); ringArm(el);
  renderCatchOwned();
}
/* a function of its own, so that its early return ends only this step */
function renderCatchOwned(){try{
  const el=document.getElementById('vCatch'),early=WORDS.filter(w=>w.l<=8&&!isName(w)),done=early.filter(w=>MODES.some(m=>(S.cards[cardId(w.id,m)]||{}).mastAt)).length;
  const first=el.querySelector('.card.hero'); if(!first)return;
  first.insertAdjacentHTML('afterend',`<div class="card"><div class="tier" style="border:0;padding:4px 0"><div class="lring">${ring2({n:early.length,frac:done/early.length,lfrac:done/early.length},44,4.5)}<span>${Math.round(done/early.length*100)}<i>%</i></span></div>
    <div class="tier-b"><b>B1 L1–L8 · already owned</b><div class="small muted">${done} of ${early.length} parked as mastered · they resurface in about three months as a check</div></div>
    <div class="tier-acts">${done<early.length?`<button class="btn sm ghost" onclick="mtOwnEarly()">Mark all mastered</button>`:''}</div></div></div>`);
  ringArm(el);
}catch(e){}}
if(typeof zikaWhole==='function')zikaWhole();   /* the last line: this file arrived whole (index.html, js/boot.js) */
