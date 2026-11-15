/* Today: the hero with the one button, the lanes, the plan for the weekday, the Up next queue, tonight's paper
   list, statistics and the heatmap. shHome() in shell.js lays the result out. renderHome still builds the page in the
   steps the versions added (docs/roadmap.md: build Today directly). */

/* ---- PAPER PRACTICE ---- */
function paperList(){
  // day 1 = full drilling (×writeTarget), day 2 = a few reps (×5), day 3 = one re-exposure (×1).
  // Words marked ✓known or ★mastered never appear here — you already own them.
  const d=new Date();d.setHours(0,0,0,0);const t0=d.getTime();
  const seen=new Set(),out=[];
  for(const cid in S.cards){
    if(!cid.endsWith(':prod'))continue;
    const c=S.cards[cid]; if(!c||c.st===undefined||c.last<t0||c.known)continue;
    const wid=cid.split(':')[0], w=byId[wid];
    if(!w||seen.has(wid))continue;
    const T=S.settings.writeTarget||20;
    if(c.st==='relearn'||c.lapses>0&&c.st!=='rev'){seen.add(wid);out.push({w,tag:'again',reps:10});}
    else if((c.days||0)<=1){seen.add(wid);out.push({w,tag:'day 1',reps:T});}
    else if((c.days||0)===2){seen.add(wid);out.push({w,tag:'day 2',reps:5});}
    else if((c.days||0)===3){seen.add(wid);out.push({w,tag:'day 3',reps:1});}
  }
  const ord={'again':0,'day 1':1,'day 2':2,'day 3':3};
  return out.sort((a,b)=>ord[a.tag]-ord[b.tag]);
}
function printPaperSheet(){
  const list=paperList(); if(!list.length)return;
  const host=document.getElementById('printSheet');
  let html='<h1>字卡 · paper practice — '+dkey(new Date())+' · day 1 ×'+(S.settings.writeTarget||20)+' · day 2 ×5 · day 3 ×1</h1>';
  list.forEach(it=>{
    const chars=[...it.w.t.split('（')[0]].filter(ch=>/\p{Script=Han}/u.test(ch));
    chars.forEach((ch,ci)=>{
      let boxes='';
      for(let i=0;i<it.reps;i++)boxes+='<div class="pbox">'+(i===0?ch:'')+'</div>';
      html+='<div class="prow"><div class="plab">'+ch+' <span class="pm">'+it.tag+' ×'+it.reps+(ci===0?' · '+esc(it.w.p)+' · '+esc(it.w.m):'')+'</span></div><div class="pboxes">'+boxes+'</div></div>';
    });
  });
  host.innerHTML=html;
  window.print();
}
/* ---- HOME ---- */
function renderHome(){
    {
  const q=buildQueue();
  const trackedWords=WORDS.filter(w=>tracked(w.id));
  const mature=Object.values(S.cards).filter(c=>c.st==='rev'&&c.S>=21).length;
  const totalCards=Object.keys(S.cards).length;
  const charSet=new Set(), tradDiff=new Set();
  trackedWords.forEach(w=>{ if(MODES.some(m=>(S.cards[cardId(w.id,m)]||{}).st!==undefined)){ const tr=[...w.t], si=w.s?[...w.s]:null; tr.forEach((ch,i)=>{ if(/\p{Script=Han}/u.test(ch)){charSet.add(ch); if(si&&(si.length!==tr.length||si[i]!==ch))tradDiff.add(ch);} }); } });
  let streak=0;const d=new Date();
  if(!S.log[dkey(d)])d.setDate(d.getDate()-1);
  while(S.log[dkey(d)]&&(S.log[dkey(d)].rev+S.log[dkey(d)].new)>0){streak++;d.setDate(d.getDate()-1);}
  const fc=[0,0,0,0,0,0,0];const now=Date.now();
  Object.values(S.cards).forEach(c=>{if(c.st===undefined||c.susp)return;const days=Math.floor((c.due-now)/DAY);if(days<0)fc[0]++;else if(days<7)fc[days]++;});
  const fmax=Math.max(1,...fc);
  const names=['today','+1','+2','+3','+4','+5','+6'];
  const total=q.learn.length+q.rev.length+q.fresh.length;
  document.getElementById('vHome').innerHTML=`
  <div class="card">
    <div class="row spread">
      <div>
        <div class="lab" style="margin-bottom:4px">Ready now</div>
        <div class="small muted">${q.rev.length} due · ${q.learn.length} learning · ${q.fresh.length} new</div>
      </div>
      <div style="font-size:38px;font-weight:700;font-variant-numeric:tabular-nums">${total}</div>
    </div>
    <div style="margin-top:16px"><button class="btn big" onclick="go('rev')" ${total===0?'disabled':''}>${total===0?'All caught up':'Start reviewing'}</button></div>
    ${totalCards===0?'<div class="small muted" style="margin-top:12px;text-align:center">Nothing in your deck yet — open <span class="link" onclick="go(\'lib\')">Library</span> and add Lesson 1.</div>':''}
  </div>
  ${qPanel()}
  ${(()=>{const pl=paperList();if(!pl.length)return '';
    return `<div class="card"><div class="row spread"><div class="lab" style="margin-bottom:0">Tonight's paper list · day 1 ×${S.settings.writeTarget} · day 2 ×5 · day 3 ×1</div>
    <button class="btn sm ghost" onclick="printPaperSheet()">Print 田字格 sheet</button></div>
    <div class="paper-chips" style="margin-top:12px">${pl.map(it=>`<div class="pchip"><span class="tag2">${it.tag} ×${it.reps}</span><span class="c zh">${esc(it.w.t.split('（')[0])}</span><span class="p">${esc(it.w.p)}</span></div>`).join('')}</div>
    <div class="small muted" style="margin-top:10px">Today's new characters get the full ×${S.settings.writeTarget} drilling; yesterday's come back for a few reps; day-3 characters get one re-exposure and graduate to FSRS. ✓ and ★ words never appear here — you already own them.</div>
    </div>`;})()}
  <div class="card">
    <div class="lab">Progress</div>
    <div class="stats">
      <div class="stat"><div class="n">${trackedWords.length}<span class="d">/${WORDS.length}</span></div><div class="l">words in deck</div></div>
      <div class="stat"><div class="n">${charSet.size}</div><div class="l">characters met</div></div>
      <div class="stat"><div class="n">${tradDiff.size}</div><div class="l">trad ≠ simp</div></div>
      <div class="stat"><div class="n">${mature}</div><div class="l">solid cards</div></div>
      <div class="stat"><div class="n">${streak}</div><div class="l">day streak</div></div>
    </div>
    <div class="fc">${fc.map((v,i)=>`<div class="bar ${i===0?'t':''}"><i style="height:${Math.round(v/fmax*44)+2}px"></i><span>${names[i]}</span><b>${v}</b></div>`).join('')}</div>
    <div class="small muted" style="margin-top:6px;text-align:center">cards coming due over the next week</div>
    <details class="guide"><summary>How this app works ›</summary><div class="gd">
      <p><b>Adding words.</b> In the Library, tap ＋ next to a word (or "Study lesson") to put it in your deck. Each word becomes two cards: <b>Recognize</b> — see the 字, recall its meaning, pinyin and tones — and <b>Write</b> — hear the word, write it on paper, then check. Nothing is drawn on screen; handwriting lives on paper and in Skritter. Already know a word from your simplified days? Tap ✓ instead: it skips the learning phase entirely and quietly resurfaces in ~3 weeks just to verify.</p>
      <p><b>Timing (FSRS).</b> Every grade feeds a memory model that estimates how long until you'd forget that exact card, and the next review lands just before that moment. Intervals stretch as a card gets stronger (minutes, then days, then weeks and months) and shrink when you miss. "Again" restarts a card through short steps, "Good" is the normal path, "Easy" jumps ahead. The small number under each button is the exact wait it will apply.</p>
      <p><b>Early reps &amp; paper.</b> New characters follow a taper on real paper: day 1 you write them ×${S.settings.writeTarget||20}, day 2 they return for ×5, day 3 one last re-exposure — then FSRS takes over. The "Tonight's paper list" card collects exactly which characters are at which day and prints a 田字格 sheet with the right number of boxes. Words you mark ✓ or ★ skip paper entirely.</p>
      <p><b>Grammar.</b> The Grammar tab holds the patterns for every lesson, each drilled five ways: fill-in-the-blank, multiple choice, build-the-sentence, finish-the-sentence, and create-your-own. Mastery dots fill as you drill.</p>
      <p><b>Daily flow.</b> ${S.settings.newPerDay??8} new words a day from the live lesson (Settings → Daily intake), plus whatever is due. Miss a day? Nothing is lost — cards simply wait.</p>
    </div></details>
  </div>`;
  badge();
  }
  /* heatmap */
  try{const fc=document.querySelector('#vHome .fc');if(fc){const cap=fc.nextElementSibling;(cap||fc).insertAdjacentHTML('afterend',heatmapHtml());}}catch(e){}
  /* Today hero */
  homeHero();
  /* the plan for the weekday */
  try{const hero=document.querySelector('#vHome .card.hero');if(hero){hero.insertAdjacentHTML('afterend',planPanel());ringArm(document.getElementById('vHome'));}}catch(e){}
  /* backlog card */
  homeBacklog();
  /* quick 20 */
  try{const b=document.querySelector('#vHome .card.hero .btn.big');if(b&&!b.classList.contains('ghost'))b.insertAdjacentHTML('afterend',`<div class="row" style="justify-content:center;margin-top:8px"><span class="link small" onclick="startQuick(20)">or a quick 20 · about 5 minutes</span></div>`);}catch(e){}
  /* link card */
  homeLinkCard();
  /* the three lanes */
  try{const v=document.getElementById('vHome'); const hero=v.querySelector('.card.hero'); if(hero)hero.insertAdjacentHTML('afterend',lanePanel());}catch(e){}
  /* the Catch-up lane's button opens the Catch-up tab */
  try{const lane=[...document.querySelectorAll('#vHome .lane')].find(x=>/Catch-up/.test(x.textContent)); if(lane){const b=lane.querySelector('.btn');if(b){b.textContent='Open';b.disabled=false;b.className='btn sm ghost';b.onclick=()=>go('catch');}}
}catch(e){}
  /* this week / last */
  try{const st=document.querySelector('#vHome .stats');if(st&&!st.querySelector('.wk')){const a=weekCards(0),b=weekCards(1);st.insertAdjacentHTML('beforeend',`<div class="stat wk"><div class="n">${a}<span class="d"> / ${b}</span></div><div class="l">this week / last</div></div>`);}}catch(e){}
  /* iPad card */
  homeIpadCard();
  /* lesson page chip */
  try{const meta=document.querySelector('#vHome .hero .hero-meta');if(meta&&!meta.querySelector('.nl')){const cl=S.settings.curLesson||26;meta.insertAdjacentHTML('beforeend',`<a class="chip nl" href="${notionLesson(cl)}" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:none">lesson page ↗</a>`);}}catch(e){}
  /* exam line */
  homeExamLine();
  /* shell: greeting, decks, fold */
  try{shHome();}catch(e){console.error(e);}
}

/* Today hero */
function homeHero(){try{
  const first=document.querySelector('#vHome .card'); if(!first)return;
  /* left = this week's lane; other = what the catch-up and maintenance lanes still hold. The day is only clear when both are empty. */
  const q=buildQueue(), all=[...q.learn,...q.rev,...q.fresh], left=all.filter(c=>typeof laneOf!=='function'||laneOf(c)==='live').length, other=all.length-left, done=todayDone(), total=done+left, clear=left===0&&other===0&&done>0;
  const frac=total?done/total:0, streak=streakCount(), hard=(S.hard||[]).length;
  const h=new Date().getHours();
  const line=left===0
    ?(other?(done?`This week’s cards are done · ${other} more in catch-up and maintenance`:`${other} waiting in catch-up and maintenance`)
      :done?`Deck cleared for today · ${nextDueText()||'nothing more due'}`:'Nothing due yet — pick words in the Library or wait for FSRS')
    :done?`${done} done · ${left} to go${left<=8?' · nearly there':''}`
    :h<11?`Fresh start · ${left} waiting`:h<18?`${left} waiting for you`:`Evening set · ${left} to close the day`;
  const ln=S.settings.curLesson||21;
  first.className='card hero';
  first.innerHTML=`
    <div class="hero-ring">${ringSvg(frac,112,9,clear?'full':'')}
      <div class="hero-n"><b data-count="${done}">0</b><span>${left===0&&done?'done':'of '+total}</span></div></div>
    <div class="hero-body">
      <div class="lab" style="margin-bottom:4px">${clear?'Today · complete':'Today'}</div>
      <div class="hero-line">${line}</div>
      <div class="hero-meta">
        <span class="chip ${streak?'hot':''}">${streak?'🔥 '+streak+'-day streak':'start a streak today'}</span>
        <span class="chip">${esc(lnLabel(ln))}</span>
        ${hard?`<span class="chip warn">${hard} hard</span>`:''}
        ${q.fresh.length?`<span class="chip">${q.fresh.length} new</span>`:''}
      </div>
      <div style="margin-top:14px"><button class="btn big ${left||other?'':'ghost'}" onclick="${left?'startLane(\'live\')':other?'go(\'rev\')':'go(\'lib\')'}">${left?(done?'Keep going':'Start today’s cards'):other?`Do the other ${other}`:'Browse the Library'}</button></div>
    </div>`;
  countUp(first); ringArm(first);
}catch(e){}}

/* backlog card */
function homeBacklog(){try{
  buildQueue(); if(!BACKLOG)return; const hero=document.querySelector('#vHome .card.hero'); if(!hero)return;
  hero.insertAdjacentHTML('afterend',`<div class="card backlog"><div class="lab">Easing back in</div>
    <div style="font-size:14px"><b>${BACKLOG.due}</b> reviews piled up${BACKLOG.gap>=2?` over ${BACKLOG.gap} days away`:''}. Today shows <b>${BACKLOG.today}</b>: the live lesson and hard words first, then the cards you most likely still remember. New words pause until the pile is cleared.</div>
    <div class="small muted" style="margin-top:6px">This is the FSRS backlog order — clearing what you still hold before it slips beats grinding the ones already gone. Keep the pace and the queue is normal again in a few days.</div></div>`);
}catch(e){}}

/* link card */
/* a learner who came in through the welcome sheet and finished it is not asked again here: sync is in Settings */
function homeUnlinkedQuiet(){return !!S.settings.born&&!S.settings.welcome;}
function homeLinkCard(){try{
  if(!fbConfig()||SYNC.code||homeUnlinkedQuiet())return;
  const host=document.getElementById('vHome'); if(!host||document.getElementById('linkCard'))return;
  const first=localEmpty();
  const html=`<div class="card linkcard" id="linkCard"><div class="lab">☁️ Cloud sync is off on this ${esc(DEVICE.name)}</div>
    <div style="font-size:14px;margin-bottom:10px">${first
      ?'Nothing has been studied on this device yet. Type the sync code from your Mac (Settings → Cloud sync on the Mac) and tap <b>Link</b> — your whole deck comes across.'
      :'Your progress lives only on this device. Already linked another device? Type its code and tap <b>Link</b>. First device? Tap <b>Generate</b> — then link the other one from Settings → Cloud sync.'}</div>
    <div class="row" style="gap:6px;flex-wrap:wrap">
      <input id="homeCodeInp" class="search" style="margin:0;width:160px;padding:7px 10px;font-size:13px" placeholder="zika-xxxxxx" autocapitalize="off" autocorrect="off" spellcheck="false">
      <button class="btn sm" onclick="fbSetCode(document.getElementById('homeCodeInp').value);setTimeout(()=>go('home'),50)">Link</button>
      <button class="btn ghost sm" onclick="fbPasteCode('homeCodeInp')">Paste</button>
      ${first?'':`<button class="btn ghost sm" onclick="fbNewCode();go('set');setTimeout(()=>{const c=document.getElementById('syncCard');if(c)c.scrollIntoView({behavior:'smooth',block:'start'});},60)">Generate</button>`}
    </div></div>`;
  const hero=host.querySelector('.card.hero');
  if(hero)hero.insertAdjacentHTML(first?'beforebegin':'afterend',html); else host.insertAdjacentHTML('afterbegin',html);
}catch(e){}}

/* iPad card */
function homeIpadCard(){try{
  if(!fbConfig()||SYNC.code||homeUnlinkedQuiet())return; const host=document.getElementById('vHome'); const old=document.getElementById('linkCard');
  if((typeof isIOS==='function')&&isIOS()){const html=ipadPanel(); if(old)old.outerHTML=html; else host.insertAdjacentHTML('afterbegin',html);}
}catch(e){}}

/* exam line */
function homeExamLine(){try{
  const v=document.getElementById('vHome');if(v.querySelector('.card.examline'))return;const X=exGet(),days=exDays();if(days<-1)return;
  const no=exIds('no').length,so=exIds('sorta').length,un=exStats().todo;
  const hero=v.querySelector('.card.hero');if(!hero)return;
  hero.insertAdjacentHTML('afterend',`<div class="card examline" style="border-left:3px solid var(--red)"><div class="row spread" style="flex-wrap:wrap;gap:8px"><div><div class="lab" style="margin:0">🎯 ${esc(X.name)} · ${esc(exDateLabel())} · ${days>1?days+' days':days===1?'tomorrow':'today'}</div><div class="small muted">${esc(lnLabel(X.lo))} → ${esc(lnLabel(X.hi))} · <span style="color:var(--red)">✗ ${no}</span> · ~ ${so} · ${un} untested</div></div><button class="btn sm" onclick="go('exam')">Open</button></div></div>`);
}catch(e){}}
var qOpen=false;

/* ---------- the Up-next queue panel ---------- */
function qToggle(){qOpen=!qOpen;renderHome();}
function qMove(i,d){
  const j=i+d; if(j<0||j>=S.pick.length)return;
  const a=S.pick[i]; S.pick[i]=S.pick[j]; S.pick[j]=a; save(); renderHome();
}
function qTop(i){const w=S.pick.splice(i,1)[0];S.pick.unshift(w);save();renderHome();}
function qDrop(i){S.pick.splice(i,1);save();renderHome();}
function qClear(){if(S.pick.length&&confirm('Clear the whole up-next list? The words stay in your deck — they just lose their priority.')){S.pick=[];save();renderHome();}}

/* bulk-load a lesson's not-yet-started words onto the end of the queue */
function qLoadLesson(ln,limit,dlg){
  const add=WORDS.filter(w=>w.l===ln)
    .filter(w=>S.settings.includeNames||!isName(w))
    .filter(w=>!dlg||dlgOf(w.id)===dlg)
    .filter(w=>!isKnown(w.id)&&!wordMastAt(w.id))
    .filter(w=>!wordStartedBefore(w.id))
    .map(w=>w.id)
    .filter(wid=>!S.pick.includes(wid));
  const take = limit?add.slice(0,limit):add;
  take.forEach(wid=>{if(!tracked(wid))trackWord(wid);S.pick.push(wid);});
  save(); renderHome(); badge();
  return take.length;
}
function qLoadHard(){
  const add=(S.hard||[]).filter(wid=>!wordStartedBefore(wid)&&!S.pick.includes(wid));
  add.forEach(wid=>{if(!tracked(wid))trackWord(wid);S.pick.push(wid);});
  save(); renderHome(); badge();
}

function qStartingToday(){
  const today=dkey(new Date());
  const used=S.intro[today]||0;
  if(S.settings.newUnlimited)return S.pick.length;
  return Math.max(0,Math.min(S.pick.length, S.settings.newPerDay-used));
}

function qPanel(){
  const byId={}; WORDS.forEach(w=>byId[w.id]=w);
  const today=dkey(new Date());
  const used=S.intro[today]||0;
  const cap=S.settings.newUnlimited?'∞':S.settings.newPerDay;
  const willStart=qStartingToday();
  const n=S.pick.length;
  const ln=S.settings.curLesson||21;

  const rows=S.pick.map((wid,i)=>{
    const w=byId[wid]; if(!w)return '';
    const on = S.settings.newUnlimited || i < willStart;
    return `<div class="qrow ${on?'':'later'}">
      <span class="qn">${i+1}</span>
      <span class="zh qz">${esc(w.t.split('（')[0])}</span>
      <span class="qp">${esc(w.p)}</span>
      <span class="qm">${esc(w.m)}</span>
      <span class="qL">${esc(lnLabel(w.l))}${dlgTag(wid)}</span>
      <span class="qacts">
        <button class="qb" title="send to top" onclick="qTop(${i})">⤒</button>
        <button class="qb" title="up" onclick="qMove(${i},-1)">▲</button>
        <button class="qb" title="down" onclick="qMove(${i},1)">▼</button>
        <button class="qb x" title="remove" onclick="qDrop(${i})">✕</button>
      </span></div>`;
  }).join('');

  return `<div class="card">
    <div class="row spread">
      <div><div class="lab" style="margin-bottom:2px">Up next · ${n} queued</div>
        <div class="small muted">${S.settings.newUnlimited
          ? `<b style="color:var(--acc)">Unlimited</b> — all ${n} start today`
          : `${used} of ${cap} new words started today · <b style="color:var(--acc)">${willStart}</b> more will start now`}</div></div>
      <button class="btn sm ghost" onclick="qToggle()">${qOpen?'Hide':'Edit queue'}</button>
    </div>
    ${qOpen?`
    <div class="qload">
      ${lessonPick(ln,'S.settings.curLesson=v;save();renderHome()')}
      <span class="small muted">${WORDS.filter(y=>y.l===ln&&!isName(y)).length} words</span>
      <button class="btn sm ghost" onclick="qLoadLesson(${ln})">Load all</button>
      <button class="btn sm ghost" onclick="qLoadLesson(${ln},10)">+10</button>
      <button class="btn sm ghost" onclick="qLoadHard()">Hard list</button>
      ${hasDlg(ln)?`<span class="qdiv"></span>
      <button class="btn sm" onclick="qLoadLesson(${ln},0,1)">聽寫一 · D1 (${dlgWords(ln,1).length})</button>
      <button class="btn sm ghost" onclick="qLoadLesson(${ln},0,2)">聽寫二 · D2 (${dlgWords(ln,2).length})</button>`:''}
      ${n?`<button class="btn sm ghost" style="color:var(--red);border-color:#e8d5d2" onclick="qClear()">Clear</button>`:''}
    </div>
    ${n?`<div class="qlist">${rows}</div>
    <div class="small muted" style="margin-top:10px">Order is the order they'll be introduced. ${S.settings.newUnlimited?'':'Greyed rows are past the new-word cap for today — raise it, or switch to unlimited in Settings → Schedule.'} A word leaves this list the moment it starts.</div>`
    :`<div class="small muted" style="margin-top:12px">Nothing queued. Load a lesson above, or use <span class="link" onclick="go('lib')">Triage a lesson</span> — anything you mark <b>Hard</b> lands here automatically.</div>`}`
    :(n?`<div class="small" style="margin-top:10px"><span class="zh">${S.pick.slice(0,14).map(wid=>byId[wid]?esc(byId[wid].t.split('（')[0]):'').filter(Boolean).join('、')}</span>${n>14?` <span class="muted">+${n-14}</span>`:''}</div>`:'')}
  </div>`;
}

/* study heatmap + streak on the Today screen */
function streakCount(){let n=0;const d=new Date();if(!S.log[dkey(d)])d.setDate(d.getDate()-1);while(S.log[dkey(d)]&&(S.log[dkey(d)].rev+S.log[dkey(d)].new)>0){n++;d.setDate(d.getDate()-1);}return n;}
function heatmapHtml(){
  const weeks=16, today=new Date(); today.setHours(0,0,0,0);
  const start=new Date(today); start.setDate(start.getDate()-(weeks*7-1)-today.getDay());
  let cells='', total=0, days=0, best=0;
  const d=new Date(start);
  while(d<=today){
    const k=dkey(d), l=S.log[k], n=l?(l.rev||0)+(l.new||0):0;
    if(n){total+=n;days++;best=Math.max(best,n);}
    const lv=n===0?0:n<15?1:n<40?2:n<90?3:4;
    cells+=`<i class="hm${lv}" title="${k} · ${n} card${n===1?'':'s'}"></i>`;
    d.setDate(d.getDate()+1);
  }
  const streak=streakCount();
  return `<div class="heat"><div class="row spread" style="margin-bottom:8px"><div class="lab" style="margin:0">Last ${weeks} weeks</div><div class="small muted">${days} study days · ${total} cards · ${streak?`<span class="flame">🔥 ${streak}-day streak</span>`:'no streak yet'}</div></div>
    <div class="hmgrid">${cells}</div></div>`;
}
function todayDone(){const l=S.log[dkey(new Date())];return l?(l.rev||0)+(l.new||0):0;}
function nextDueText(){
  const now=Date.now(); let next=Infinity;
  for(const cid in S.cards){const c=S.cards[cid];if(!c||c.st===undefined||c.susp||!S.settings.modes[modeOf(cid)])continue;if(c.due>now&&c.due<next)next=c.due;}
  if(!isFinite(next))return '';
  const d=new Date(next), today=dkey(new Date())===dkey(d);
  const tm=new Date(new Date().getTime()+86400000);
  const m=Math.round((next-now)/60000);
  if(m<60)return 'next card in '+m+' min';
  if(today)return 'next cards at '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  if(dkey(tm)===dkey(d))return 'next cards tomorrow';
  return 'next cards '+dkey(d).slice(5).replace('-','/');
}

/* ---- the plan for the weekday ---- */
function planAct(k,arg){
  const cl=S.settings.curLesson||26;
  if(k==='paper'){go('home');setTimeout(()=>{const c=[...document.querySelectorAll('#vHome .card')].find(x=>/paper list/i.test(x.textContent));if(c)c.scrollIntoView({behavior:'smooth',block:'start'});else toast('Nothing on tonight\u2019s paper list yet');},60);return;}
  if(k==='dict'&&arg&&arg.hard){drillScope='hard';go('drill');startDrill('dict');return;}
  if(k==='mtest'){mtResume();return;}
  if(k==='test'){mtResume();if(arg&&arg.ln)mtJump(arg.ln);return;}if(k==='catchtab'){go('catch');return;}
  if(k==='listen'){drillScope='lesson';drillLesson=S.settings.curLesson||23;go('drill');startDrill('listen');return;}
  {
  const cl=S.settings.curLesson||22;
  const acts={
    dict:()=>{drillScope='lesson';drillLesson=cl;go('drill');startDrill('dict');},
    hardrec:()=>{drillScope='hard';go('drill');startDrill('rec');},
    hardtone:()=>{drillScope='hard';go('drill');startDrill('tone');},
    gram:()=>{gramLesson=cl;go('gram');startGramQuiz(GRAMMAR[cl]||[]);},
    sent:()=>{drillScope='lesson';drillLesson=cl;go('drill');startDrill('sent');},
    speak:()=>{drillScope='lesson';drillLesson=cl;go('drill');startDrill('speak');},
    exam:()=>{drillLesson=cl;go('drill');makeExam();setTimeout(()=>{const e=document.querySelector('.examcard');if(e)e.scrollIntoView({behavior:'smooth',block:'center'});},50);},
    triage:()=>{const ln=arg&&arg.ln||cl;libBook=bookOf(ln);go('lib');startTriage(ln,hasDlg(ln)?(arg&&arg.dlg):0);},
    confuse:()=>startConfuse(null), read:()=>startRead(), rev:()=>go('rev'),
    lib:()=>{const ln=arg&&arg.ln||cl;libBook=bookOf(ln);openLessons[ln]=true;go('lib');setTimeout(()=>{const e=document.querySelector('.lesson[data-ln="'+ln+'"]');if(e)e.scrollIntoView({behavior:'smooth',block:'start'});},60);}
  };
  if(acts[k])acts[k]();
  }
}
function planPanel(){
  const d=new Date(), wd=d.getDay(), cl=S.settings.curLesson||26, L=lnLabel(cl), E=S.settings.examDay||4;
  const A=(k,label,arg)=>`<button class="pact" onclick='planAct("${k}",${JSON.stringify(arg||null)})'>${label}</button>`;
  const N=(url,label)=>`<a class="pact nl" href="${url}" target="_blank" rel="noopener">${label}</a>`;
  const T={
    mon:{t:'聽寫一',items:[A('dict','聽寫 rehearsal · '+L+' 對話一'),A('paper','田字格 · tonight\u2019s paper'),A('hardrec','Hard list → 認字'),A('triage','After class: Triage 對話二',{dlg:2})]},
    d2:{t:'對話二 characters',items:[A('dict','聽寫 · '+L+' 對話二'),A('paper','田字格 · tonight\u2019s paper'),A('hardtone','Hard list → 聲調'),A('catchtab','Catch-up: shaky words')]},
    t2:{t:'two days out',items:[A('dict','聽寫 · hard list',{hard:1}),A('dict','聽寫 · '+L),A('hardrec','Hard list → 認字'),N(notionLesson(cl),'Grammar + 口試 prep in Notion ↗')]},
    t1:{t:'聽寫二',items:[A('dict','聽寫二 before class'),A('paper','田字格 · tonight\u2019s paper'),A('hardtone','Hard list → 聲調'),N(notionLesson(cl),'口試 spiel in Notion ↗')]},
    exam:{t:'課考試',items:[A('hardrec','Hard list → 認字'),A('hardtone','then 聲調'),A('dict','聽寫 · hard list',{hard:1}),N(notionLesson(cl),'After: log what it asked in 疑問 ↗')]},
    fri:{t:'new lesson opens',items:[A('triage','Triage 對話一 of the new lesson',{dlg:1}),A('paper','田字格 · the new characters ×20'),A('rev','Clear the queue')]},
    sat:{t:'weekend · catch-up',items:[A('rev','Clear the queue'),A('mtest','Mastery test · two lessons'),A('catchtab','Catch-up: review the shaky ones'),A('dict','聽寫 · hard list',{hard:1})]},
    sun:{t:'weekend · catch-up',items:[A('rev','Clear the queue'),A('mtest','Mastery test · two lessons'),A('paper','田字格 · tonight\u2019s paper'),A('catchtab','Catch-up: review the shaky ones')]}
  };
  const key=wd===0?'sun':wd===6?'sat':wd===1?'mon':wd===E?'exam':wd===E-1?'t1':wd===E-2?'t2':(wd===5&&E===4)?'fri':'d2';
  const p=T[key], names=['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
  return `<div class="card plan"><div class="row spread" style="margin-bottom:8px"><div><div class="lab" style="margin:0">Today’s plan · ${names[wd]} · ${esc(p.t)}</div><div class="small muted">${L} · 聽寫一 Mon · 聽寫二 ${names[E-1]} · 考試 <select class="vsel" style="padding:1px 4px;font-size:11.5px;max-width:none" onchange="S.settings.examDay=+this.value;save();renderHome()"><option value="4" ${E===4?'selected':''}>星期四</option><option value="5" ${E===5?'selected':''}>星期五</option></select> · grammar lives in Notion</div></div><a class="nlink" href="${NOTION.flow}" target="_blank" rel="noopener">Workflow ↗</a></div>
    <div class="pacts">${p.items.join('')}</div></div>`;
}
function lanePanel(){
  const L=laneCounts(), cl=S.settings.curLesson||26, sec=c=>Math.max(1,Math.round(c*8/60));
  const mt=S.mtest&&S.mtest.res?Object.values(S.mtest.res).filter(r=>r!=='m').length:0;
  const row=(k,t,sub,c)=>`<div class="lane"><div class="lane-b"><b>${t}</b><div class="small muted">${sub}</div></div>
    <div class="lane-n"><b>${c.due+c.fresh}</b><span>${c.due} due${c.fresh?` · ${c.fresh} new`:''} · ~${sec(c.due+c.fresh)} min</span></div>
    <button class="btn sm ${c.due+c.fresh?'':'ghost'}" ${c.due+c.fresh?'':'disabled'} onclick="startLane('${k}')">${c.due+c.fresh?'Start':'Clear'}</button></div>`;
  return `<div class="card"><div class="row spread" style="margin-bottom:4px"><div><div class="lab" style="margin:0">Three lanes · one queue</div><div class="small muted">same scheduler underneath; this is just where today’s cards come from</div></div></div>
    ${row('live','This week · '+(cl>1?esc(lnLabel(cl-1))+' – ':'')+esc(lnLabel(cl)),'new words at '+(S.settings.newPerDay??8)+'/day, 聽寫 write cards, this lesson’s grammar',L.live)}
    ${row('catch','Catch-up · the shaky ones',(mt?mt+' flagged by the mastery test':'flagged by the mastery test')+' + hard list · '+(S.settings.newCatchPerDay??5)+' enter per day',L.catch)}
    ${row('maint','Maintenance · everything else','long intervals, a few a day, never dropped',L.maint)}
    <div class="small muted" style="margin-top:8px">A card graded <b>Good</b> comes back on the date under the button. ~10 reviews per new word over its first month is the planning rule, so ${(S.settings.newPerDay??8)+(S.settings.newCatchPerDay??5)} new a day settles near ${((S.settings.newPerDay??8)+(S.settings.newCatchPerDay??5))*10} reviews a day; lower either intake in Settings if that’s too many.</div></div>`;
}
/* ---- E. this week vs last week ---- */
function weekCards(offset){const d=new Date();d.setHours(0,0,0,0);const dow=(d.getDay()+6)%7;const start=new Date(d);start.setDate(d.getDate()-dow-7*offset);let n=0;for(let i=0;i<7;i++){const k=dkey(new Date(start.getTime()+i*DAY));const l=S.log[k];if(l)n+=(l.rev||0)+(l.new||0);}return n;}
