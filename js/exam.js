/* 大考試: the exam tab. A range of lessons and a date, a pass through every word marked ✓ ~ ✗, and piles to drill or print. */

const EXAM_NOTION='https://app.notion.com/p/40d6bf9d399581b39b59dc3bd855a189';
/* the default is the first learner's exam; a deck made by the clean first run starts with its own book so far and no date */
function exGet(){S.exam=S.exam||(S.settings.born?{lo:bookRange(bookOf(shLesson()))[0],hi:shLesson(),date:'',name:'大考試',run:null}:{lo:21,hi:28,date:'2026-11-18',name:'大考試',run:null});return S.exam;}
function exRes(wid){return (mtGet().res||{})[wid];}
function exWords(ln){const X=exGet();return WORDS.filter(w=>w.l>=X.lo&&w.l<=X.hi&&(!ln||w.l===ln)&&!isName(w)&&!/[+＋]|number|noun/i.test(w.t));}
function exIds(kind,ln){const ws=exWords(ln);
  if(kind==='no')return ws.filter(w=>exRes(w.id)==='h').map(w=>w.id);
  if(kind==='sorta')return ws.filter(w=>exRes(w.id)==='l').map(w=>w.id);
  if(kind==='both')return ws.filter(w=>exRes(w.id)==='h').concat(ws.filter(w=>exRes(w.id)==='l')).map(w=>w.id);
  if(kind==='untested')return ws.filter(w=>!exRes(w.id)).map(w=>w.id);
  return ws.map(w=>w.id);}
function exStats(ln){const n={n:0,m:0,l:0,h:0,todo:0};exWords(ln).forEach(w=>{const r=exRes(w.id);n.n++;if(r)n[r]++;else n.todo++;});n.done=n.n-n.todo;return n;}
function exDays(){const X=exGet();if(!X.date)return -9999;const d=new Date(X.date+'T00:00:00'),t=new Date();t.setHours(0,0,0,0);return Math.round((d-t)/DAY);}
function exDateLabel(){const X=exGet();if(!X.date)return 'no date yet';const d=new Date(X.date+'T00:00:00');return ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][d.getDay()]+' '+(d.getMonth()+1)+'/'+d.getDate();}
/* ---- the run: a list of ids walked one by one, results written into the shared map ---- */
const EX={revealed:false,lastSpoken:null};
function exStart(kind,ln){
  const X=exGet();let ids=exIds(kind,ln),label;
  if(kind==='lesson'){ids=exIds('untested',ln);label=lnLabel(ln);if(!ids.length){ids=exIds('all',ln);label=lnLabel(ln)+' · re-test';}}
  else if(kind==='untested'){label='untested';}
  else if(kind==='no'){label='✗ hell-no pile';}
  else if(kind==='sorta'){label='~ sorta pile';}
  else if(kind==='both'){label='✗ + ~ piles';}
  else label='everything';
  if(!ids.length){toast('Nothing to test there');return;}
  X.run={ids,i:0,label,hist:[]};save();drillMode='extest';dq=null;EX.revealed=false;go('drill');
}
function exResume(){const X=exGet();if(X.run&&X.run.i<X.run.ids.length){drillMode='extest';dq=null;EX.revealed=false;go('drill');}else exStart('untested');}
function exMark(r){
  const X=exGet(),R=X.run;if(!R)return;const wid=R.ids[R.i];if(!wid)return;
  const T=mtGet();R.hist.push({wid,prev:T.res[wid]||null});
  T.res[wid]=r;mtApply(wid,r);if(r!=='h')S.pick=(S.pick||[]).filter(x=>x!==wid);
  haptic(r==='h'?'again':'good');R.i++;EX.revealed=false;save();badge();exRender();
}
function exUndo(){
  const X=exGet(),R=X.run;if(!R||!R.hist.length)return;const h=R.hist.pop();R.i=Math.max(0,R.i-1);
  const T=mtGet();if(h.prev){T.res[h.wid]=h.prev;mtApply(h.wid,h.prev);}else{delete T.res[h.wid];untrackWord(h.wid);S.hard=(S.hard||[]).filter(x=>x!==h.wid);S.pick=(S.pick||[]).filter(x=>x!==h.wid);}
  save();badge();EX.revealed=false;exRender();
}
function exRender(){
  const el=document.getElementById('vDrill'),X=exGet(),R=X.run;
  if(!R){go('exam');return;}
  const wid=R.ids[R.i],w=wid&&byId[wid];
  if(!w){const n={m:0,l:0,h:0};R.ids.forEach(id=>{const r=exRes(id);if(r)n[r]++;});const no=exIds('no').length,so=exIds('sorta').length;
    el.innerHTML=`<div class="card done"><div class="zhd zh">寫完了</div><div style="font-weight:600;font-size:16px">${esc(R.label)} · ${R.ids.length} words</div>
    <div class="sum" style="margin-top:14px"><div><b>${n.m}</b><span>✓ yes</span></div><div><b>${n.l}</b><span>~ sorta</span></div><div><b>${n.h}</b><span>✗ hell no</span></div></div>
    <div class="small muted" style="margin-top:12px">Across the whole range the piles now stand at <b>✗ ${no}</b> and <b>~ ${so}</b>. ✗ words are on the hard list and the 田字格 sheet; ~ words have a live write card; ✓ words are parked.</div>
    <div class="row" style="justify-content:center;gap:8px;margin-top:16px;flex-wrap:wrap"><button class="btn" onclick="exGet().run=null;save();go('exam')">Back to 大考試</button>${no?`<button class="btn ghost" onclick="exStart('no')">Re-test the ✗ pile (${no})</button>`:''}${exIds('untested').length?`<button class="btn ghost" onclick="exStart('untested')">Next untested lesson</button>`:''}</div></div>`;return;}
  const r=EX.revealed,s=exStats(w.l),lessons=[];for(let l=X.lo;l<=X.hi;l++)lessons.push(l);
  const strip=`<div class="lstrip" style="margin:8px 0 4px">${lessons.map(l=>{const st=exStats(l);const m={n:st.n,frac:st.n?st.m/st.n:0,lfrac:st.n?st.done/st.n:0};return `<div class="lmini ${w.l===l?'cur':''}" title="${esc(lnLabel(l))} · ✓${st.m} ~${st.l} ✗${st.h} · ${st.todo} left" onclick="exStart('lesson',${l})">${ring2(m,40,4)}<span class="lm-n">${lnShort(l)}</span><span class="lm-p">${st.done}/${st.n}</span></div>`;}).join('')}</div>`;
  el.innerHTML=`<div class="rev-top"><span class="qtype">大考試 · ${esc(R.label)}</span><span class="qprog">${esc(lnLabel(w.l))} · ${R.i+1} / ${R.ids.length}${exRes(wid)?` · was ${exRes(wid)==='m'?'✓':exRes(wid)==='l'?'~':'✗'}`:''}</span></div>
  ${strip}
  <div class="stage ${animOn()?(r?'flip-in':'slide-in'):''}" style="min-height:300px">
    <div class="hint">read it · write the 字 on paper · say the tones · then check</div>
    ${w.pos?`<div class="pos">${esc(w.pos)}</div>`:''}
    <div class="meaning" style="font-size:23px">${esc(w.m)}</div>
    <div class="row" style="justify-content:center;gap:9px"><span class="pyline" style="font-size:24px">${tonePinyin(esc(w.p))}</span>${spkBtn(w.id)}</div>
    ${r?`<div class="bigzh zh" style="font-size:56px;margin-top:4px">${dcZh(w.t)}</div>${S.settings.strokeAnim?`<div id="strokeHost" class="strokerow"></div>`:''}${w.s?`<div class="simpnote">简体 ${esc(w.s)}</div>`:''}${compLines(w.t)}`:''}
  </div>
  ${r?`<div class="grades mt3"><button onclick="exMark('h')"><span class="g1">✗ Hell no</span><span class="iv">✗ pile · hard list · 田字格</span></button><button onclick="exMark('l')"><span class="g2">~ Sorta</span><span class="iv">~ pile · write card live</span></button><button onclick="exMark('m')"><span class="g4">✓ Yes</span><span class="iv">parked · off the list</span></button></div>
    <div class="small muted" style="text-align:center;margin-top:10px"><kbd>1</kbd> hell no · <kbd>2</kbd> sorta · <kbd>3</kbd> yes${R.hist.length?` · <span class="link" onclick="exUndo()">← undo last</span>`:''} · <span class="link" onclick="go('exam')">pause</span></div>`
  :`<div style="margin-top:16px"><button class="btn big" onclick="EX.revealed=true;exRender()">Show the character</button></div><div class="small muted" style="text-align:center;margin-top:10px"><span class="kbh"><kbd>space</kbd> · </span>${R.hist.length?`<span class="link" onclick="exUndo()">← undo last</span> · `:''}<span class="link" onclick="go('exam')">pause — progress is saved</span></div>`}`;
  if(r&&S.settings.strokeAnim&&document.getElementById('strokeHost'))try{renderStrokes('strokeHost',w.t.split('（')[0],{});}catch(e){}
  if(!r&&S.settings.autoplayAudio&&EX.lastSpoken!==wid){EX.lastSpoken=wid;setTimeout(()=>speakWord(wid),200);}
}
/* ---- drilling and reviewing a pile ---- */
let EXAM_POOL=[];
function exDict(kind){EXAM_POOL=exIds(kind);if(EXAM_POOL.length<2){toast('Fewer than two words in that pile');return;}drillScope='examset';go('drill');startDrill('dict');}
function exReview(kind){const ids=new Set(exIds(kind));go('rev');if(!rq)return;['learn','rev','fresh'].forEach(x=>{rq[x]=rq[x].filter(c=>!isGram(c)&&ids.has(wordOf(c).id));});if(!(rq.learn.length+rq.rev.length+rq.fresh.length)){toast('Nothing in that pile is due right now');go('exam');return;}nextCard();}
function exPrint(kind,reps){
  const ids=exIds(kind);if(!ids.length){toast('That pile is empty');return;}reps=reps||10;
  const host=document.getElementById('printSheet');const X=exGet();
  let html='<h1>字卡 · '+esc(X.name)+' '+esc(X.date)+' · '+(kind==='no'?'✗ hell-no pile':kind==='sorta'?'~ sorta pile':'✗ + ~ piles')+' · ×'+reps+' each · '+dkey(new Date())+'</h1>';
  ids.forEach(id=>{const w=byId[id];const chars=[...w.t.split('（')[0]].filter(ch=>/\p{Script=Han}/u.test(ch));
    chars.forEach((ch,ci)=>{let boxes='';for(let i=0;i<reps;i++)boxes+='<div class="pbox">'+(i===0?ch:'')+'</div>';
      html+='<div class="prow"><div class="plab">'+ch+' <span class="pm">'+esc(lnLabel(w.l))+(ci===0?' · '+esc(w.p)+' · '+esc(w.m):'')+'</span></div><div class="pboxes">'+boxes+'</div></div>';});});
  host.innerHTML=html;window.print();
}
/* ---- tab + container ---- */

function exPile(kind){
  const X=exGet(),ids=exIds(kind);if(!ids.length)return '';
  const byLn={};ids.forEach(id=>{const w=byId[id];(byLn[w.l]=byLn[w.l]||[]).push(w);});
  return Object.keys(byLn).sort((a,b)=>a-b).map(l=>`<div class="small muted" style="margin:10px 0 4px"><b>${esc(lnLabel(+l))}</b> · ${byLn[l].length}</div><div class="paper-chips">${byLn[l].map(w=>`<div class="pchip" style="cursor:pointer" title="${esc(w.m)} · tap to hear" onclick="speakWord('${w.id}')"><span class="c zh">${esc(w.t.split('（')[0])}</span><span class="p">${esc(w.p)}</span><span class="small muted" style="font-size:10.5px;max-width:110px;text-align:center;line-height:1.2">${esc(w.m.length>22?w.m.slice(0,21)+'…':w.m)}</span></div>`).join('')}</div>`).join('');
}
let EX_EDIT=false;
function exEdit(){EX_EDIT=!EX_EDIT;renderExam();}
function exSet(k,v){
  const X=exGet();
  if(k==='lo'){X.lo=v;if(X.hi<v)X.hi=v;}
  else if(k==='hi'){X.hi=v;if(X.lo>v)X.lo=v;}
  else if(k==='date'){if(!/^\d{4}-\d\d-\d\d$/.test(v))return;X.date=v;}
  X.run=null;save();badge();renderExam();
}
function renderExam(){
  const el=document.getElementById('vExam'),X=exGet(),tot=exStats(),days=exDays();
  const lessons=[];for(let l=X.lo;l<=X.hi;l++)lessons.push(l);
  const no=exIds('no').length,so=exIds('sorta').length,un=tot.todo;
  const live=X.run&&X.run.i<X.run.ids.length;
  el.innerHTML=`
  <div class="card hero" style="padding:22px 24px">
    <div class="hero-ring">${ringSvg(tot.n?tot.done/tot.n:0,112,9,'')}<div class="hero-n"><b data-count="${tot.done}">0</b><span>tested of ${tot.n}</span></div></div>
    <div class="hero-body"><div class="lab" style="margin-bottom:4px">🎯 ${esc(X.name)} · ${esc(lnLabel(X.lo))} → ${esc(lnLabel(X.hi))} · ${esc(exDateLabel())}</div>
      <div class="hero-line">${days>1?days+' days left':days===1?'Tomorrow':days===0?'Today':X.date?'Done':'No date set'}${un?` · ${un} words still untested`:' · every word tested'}</div>
      <div class="hero-meta"><span class="chip">✓ ${tot.m} yes</span><span class="chip">~ ${so} sorta</span><span class="chip warn">✗ ${no} hell no</span><span class="chip">${un} untested</span><a class="chip nl" href="${EXAM_NOTION}" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:none">plan page ↗</a></div>
      <div class="row" style="gap:8px;margin-top:14px;flex-wrap:wrap">
        ${un?`<button class="btn" onclick="exResume()">${live?'Continue the test':'Start the test'}</button>`:`<button class="btn ghost" onclick="exStart('all')">Re-test everything</button>`}
        ${no?`<button class="btn ${un?'ghost':''}" onclick="exStart('no')">Re-test ✗ (${no})</button>`:''}
        ${so?`<button class="btn ghost" onclick="exStart('sorta')">Re-test ~ (${so})</button>`:''}
      </div></div>
  </div>
  <div class="card"><div class="row spread" style="margin-bottom:8px"><div><div class="lab" style="margin:0">① Writing test · lesson by lesson</div><div class="small muted">English + pinyin facing you → write it on paper → ✓ yes · ~ sorta · ✗ hell no</div></div><span class="link small" onclick="exEdit()">${EX_EDIT?'done':'range · date'}</span></div>
    ${EX_EDIT?`<div class="row" style="gap:10px;flex-wrap:wrap;align-items:center;margin:2px 0 14px"><span class="small muted">from</span>${lessonPick(X.lo,"exSet('lo',v)")}<span class="small muted">to</span>${lessonPick(X.hi,"exSet('hi',v)")}<span class="small muted">exam date</span><input type="date" class="vsel" value="${esc(X.date)}" onchange="exSet('date',this.value)"></div>`:''}
    <div class="clist">${lessons.map(l=>{const c=exStats(l);const m={n:c.n,frac:c.n?c.m/c.n:0,lfrac:c.n?c.done/c.n:0};
      return `<div class="crow ${c.todo===0&&c.l+c.h===0?'done':''}"><div class="lring">${ring2(m,44,4.5)}<span>${c.n?Math.round(c.m/c.n*100):0}<i>%</i></span></div>
        <div class="tier-b"><b>${esc(lnLabel(l))} · ${esc(LESSON_TITLES[l]||'')}</b><div class="small muted">${c.todo?`<b>${c.todo}</b> untested · `:''}✓ ${c.m} · ~ ${c.l} · <span style="color:var(--red)">✗ ${c.h}</span></div></div>
        <div class="tier-acts"><button class="btn sm ${c.todo?'':'ghost'}" onclick="exStart('lesson',${l})">${c.todo?'Test':'Re-test'}</button><button class="btn sm ghost" onclick="drillScope='lesson';drillLesson=${l};go('drill');startDrill('dict')">聽寫</button>${notionLink(l)}</div></div>`;}).join('')}</div></div>
  <div class="card" style="border-left:3px solid var(--red)"><div class="row spread" style="flex-wrap:wrap;gap:8px"><div><div class="lab" style="margin:0">② ✗ Hell no · the queue${no?` · ${no}`:''}</div><div class="small muted">couldn’t write it. On the hard list and tonight’s 田字格 until a re-test moves it out</div></div>
      ${no?`<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn sm" onclick="exStart('no')">Re-test</button><button class="btn sm ghost" onclick="exDict('no')">聽寫</button><button class="btn sm ghost" onclick="exReview('no')">Review</button><button class="btn sm ghost" onclick="exPrint('no',10)">Print 田字格 ×10</button></div>`:''}</div>
    ${no?exPile('no'):`<div class="small muted" style="margin-top:8px">${un?'Empty so far — the test fills it.':'Empty. Nothing left you can’t write.'}</div>`}</div>
  <div class="card" style="border-left:3px solid var(--amber)"><div class="row spread" style="flex-wrap:wrap;gap:8px"><div><div class="lab" style="margin:0">③ ~ Sorta · the queue${so?` · ${so}`:''}</div><div class="small muted">got there, but shaky. Write card is live in the deck; re-test to promote it to ✓</div></div>
      ${so?`<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn sm" onclick="exStart('sorta')">Re-test</button><button class="btn sm ghost" onclick="exDict('sorta')">聽寫</button><button class="btn sm ghost" onclick="exReview('sorta')">Review</button><button class="btn sm ghost" onclick="exPrint('sorta',5)">Print 田字格 ×5</button></div>`:''}</div>
    ${so?exPile('sorta'):`<div class="small muted" style="margin-top:8px">Empty.</div>`}</div>
  <div class="card"><div class="lab">How this works</div>
    <div class="small muted">Night 1 is triage, not practice: run each lesson’s test cold and sort. Only the ✗ and ~ piles get time after that — ✓ words are parked and never come back before the exam. Re-test a pile whenever you have written it; a ✗ that becomes ~ or ✓ leaves the queue on the spot. Everything here shares the 寫字測驗 results, so the Catch-up tab and the review lanes see the same marks. <kbd>space</kbd> reveal · <kbd>1</kbd> hell no · <kbd>2</kbd> sorta · <kbd>3</kbd> yes.</div></div>`;
  countUp(el);ringArm(el);
}
if(typeof zikaWhole==='function')zikaWhole();   /* the last line: this file arrived whole (index.html, js/boot.js) */
