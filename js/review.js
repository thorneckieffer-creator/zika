/* ---- REVIEW ---- */
let rq=null, cur=null, revealed=false, undoStack=[], sessionN=0, hintShown=false;
/* A review sitting. REV_FILTER and REV_CAP are set by whoever starts it (a lane, one catch-up lesson, a quick 20) and used once. */
function startReview(){
  sesReset(); undoStack.length=0; rq=buildQueue(); sessionN=0;
  if(REV_FILTER){['learn','rev','fresh'].forEach(k=>{rq[k]=rq[k].filter(REV_FILTER);});}
  if(REV_CAP){let left=REV_CAP-rq.learn.length;rq.learn=rq.learn.slice(0,REV_CAP);rq.rev=rq.rev.slice(0,Math.max(0,left));left-=rq.rev.length;rq.fresh=rq.fresh.slice(0,Math.max(0,left));}
  REV_FILTER=null; REV_CAP=0; nextCard();
}
function pickNext(){
  const now=Date.now();
  const learnDue=rq.learn.filter(cid=>S.cards[cid]&&S.cards[cid].st!==undefined&&S.cards[cid].due<=now);
  if(learnDue.length)return learnDue[0];
  if(rq.rev.length)return rq.rev[0];
  if(rq.fresh.length)return rq.fresh[0];
  if(rq.learn.length)return rq.learn[0];
  return null;
}
function nextCard(){cur=pickNext();revealed=false;hintShown=false;renderRev();}
function renderRev(){
  /* grammar cards take the whole card; L1–L3 run only for the others */
  if(cur&&isGram(cur))renderGramCard();
  else{
    renderRevBase();
    renderRevMotion();
    renderRevSession();
  }
  renderRevDictation();
  /* grade buttons: the actual return date */
  try{
  document.querySelectorAll('#vRev .grades button .iv').forEach(el=>{const m=el.textContent.match(/^(\d+)d$/);if(m){el.textContent=m[1]+'d · '+fmtDay(Date.now()+(+m[1])*DAY);}});
}catch(e){}
  renderRevLookup();
  /* the focus link */
  try{const row=document.querySelector('#vRev .srow');if(row&&!row.querySelector('.focuslink'))row.insertAdjacentHTML('beforeend',`<span class="link small focuslink" onclick="document.body.classList.toggle('focus')" title="hide the header and tabs (f)">${document.body.classList.contains('focus')?'exit focus':'focus'}</span>`);}catch(e){}
}
function renderRevBase(){
  const el=document.getElementById('vRev');
  badge();
  if(!cur){
    el.innerHTML=`<div class="card done">
      <div class="zhd zh">做得好</div>
      <div style="font-weight:600;font-size:16px;margin-bottom:4px">All caught up</div>
      <div class="muted small">${sessionN} card${sessionN===1?'':'s'} this session. FSRS will have the next batch waiting at the right moment.</div>
      <div style="margin-top:18px"><button class="btn ghost" onclick="go('home')">Back to Today</button></div>
    </div>`;return;
  }
  const w=wordOf(cur), m=modeOf(cur), c=S.cards[cur]||{};
  const isNew=c.st===undefined;
  const remaining=rq.learn.length+rq.rev.length+rq.fresh.length;
  let front='',back='';
  if(m==='rec'){
    front=`<div class="bigzh zh">${esc(w.t)}</div><div class="hint">meaning · pinyin · tones — say it aloud</div>`;
    back=`<div class="rv-main"><div class="bigzh zh" style="font-size:56px">${esc(w.t)}</div>
      ${w.pos?`<div class="pos">${esc(w.pos)}</div>`:''}
      <div class="meaning">${esc(w.m)}</div>
      <div class="row" style="justify-content:center;gap:9px"><span class="pyline">${tonePinyin(esc(w.p))}</span>${spkBtn(w.id)}${tcMicBtn(w.id)}</div>
      ${w.s?`<div class="simpnote">简体 ${esc(w.s)}</div>`:''}
      ${compLines(w.t)}</div>
      ${window.usBlock?usBlock(w):''}`;
  } else {
    front=`${w.pos?`<div class="pos">${esc(w.pos)}</div>`:''}
      <div class="meaning" style="font-size:23px">${esc(w.m)}</div>
      ${hintShown?`<div class="pyline" style="font-size:26px">${tonePinyin(esc(w.p))}</div>`:`<div class="hint"><span class="link" onclick="hintShown=true;renderRev()">show pinyin hint</span></div>`}
      ${window.usHint?usHint(w):''}
      <div class="hint">which 字? — say it aloud with the tones, then check</div>`;
    back=`<div class="rv-main"><div class="bigzh zh" style="font-size:56px">${esc(w.t)}</div>
      ${S.settings.strokeAnim?`<div id="strokeHost" class="strokerow"></div>
      <div class="stroketools"><button class="btn sm ghost" onclick="playStrokes()">Replay strokes ▶</button></div>`:''}
      <div class="pos" style="text-align:center">${esc(w.m)}</div>
      <div class="row" style="justify-content:center;gap:9px"><span class="pyline" style="font-size:21px">${tonePinyin(esc(w.p))}</span>${spkBtn(w.id)}${tcMicBtn(w.id)}</div>
      ${w.s?`<div class="simpnote">简体 ${esc(w.s)}</div>`:''}
      ${compLines(w.t)}</div>
      ${window.usBlock?usBlock(w):''}`;
  }
  el.innerHTML=`
  <div class="rev-top">
    <span class="mtag ${m}">${MODE_LABEL[m]}</span>
    <span>${undoStack.length?`<span class="link" onclick="doUndo()" title="step back through your last ${undoStack.length} answers">← back</span> · `:''}${isNew?'<b style="color:var(--acc)">new</b> · ':''}${remaining} left${isNew?` · <span class="link" onclick="skipKnown('k')">know ✓</span> · <span class="link" onclick="skipKnown('m')">mastered ★</span>`:''}</span>
  </div>
  <div class="stage">${revealed?back:front}</div>
  ${revealed?`<div class="grades">
      <button onclick="grade(1)"><span class="g1">Again</span><span class="iv">${previewIv(isNew?null:c,cur,1)}</span></button>
      <button onclick="grade(2)"><span class="g2">Hard</span><span class="iv">${previewIv(isNew?null:c,cur,2)}</span></button>
      <button onclick="grade(3)"><span class="g3">Good</span><span class="iv">${previewIv(isNew?null:c,cur,3)}</span></button>
      <button onclick="grade(4)"><span class="g4">Easy</span><span class="iv">${previewIv(isNew?null:c,cur,4)}</span></button>
    </div>
    <div class="small muted kbh" style="text-align:center;margin-top:10px"><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></div>`
  :`<div style="margin-top:16px"><button class="btn big" onclick="reveal()">Show answer</button></div>
    <div class="small muted kbh" style="text-align:center;margin-top:10px"><kbd>space</kbd></div>`}`;
  if(revealed){
    if(S.settings.autoplayAudio)setTimeout(()=>speakWord(w.id),120);
    if(m==='prod'&&S.settings.strokeAnim&&document.getElementById('strokeHost')){
      renderStrokes('strokeHost',w.t.split('（')[0],{});
    }
  }
}
/* review: card slides in; the grade you just gave colours the edge of the next card for a beat */
function renderRevMotion(){
  const done=document.querySelector('#vRev .card.done'); if(done&&sessionN>0&&!done.dataset.party){done.dataset.party=1;if(animOn())confetti();haptic('done');}
  if(!animOn())return;const st=document.querySelector('#vRev .stage');if(!st)return;
  st.classList.add(revealed?'flip-in':'slide-in'); if(lastGrade&&!revealed){st.classList.add(lastGrade===1?'from-again':lastGrade===2?'from-hard':'from-good');lastGrade=0;}
  st.addEventListener('animationend',()=>st.classList.remove('slide-in','flip-in'),{once:true});
}
/* progress bar + run counter + session summary */
function renderRevSession(){try{
  const el=document.getElementById('vRev');
  if(cur){
    const remaining=rq.learn.length+rq.rev.length+rq.fresh.length, tot=SES.n+remaining, frac=tot?SES.n/tot:0;
    const run=SES.run, show=run>=3, pop=show&&run!==SES.lastRun; SES.lastRun=run;
    el.insertAdjacentHTML('afterbegin',`<div class="sbar"><i style="width:${Math.round(frac*100)}%"></i></div>
      <div class="srow"><span class="small muted">${SES.n} done · ${remaining} left</span>${show?`<span class="runchip ${pop?'pop':''}">${run} in a row${run>=10?' ✦':''}</span>`:''}</div>`);
  } else if(SES.n>0){
    const done=el.querySelector('.card.done'); if(!done)return;
    const acc=Math.round((SES.g[3]+SES.g[4])/SES.n*100), mins=Math.max(1,Math.round((Date.now()-SES.t0)/60000)), streak=streakCount();
    const q=buildQueue(), soon=q.learn.length+q.rev.length+q.fresh.length;
    done.innerHTML=`<div class="zhd zh">${acc>=90?'太棒了':acc>=70?'做得好':'加油'}</div>
      <div style="font-weight:600;font-size:16px;margin-bottom:14px">${soon?'Session done — '+soon+' more ready':'All caught up'}</div>
      <div class="sum">
        <div><b data-count="${SES.n}">0</b><span>cards</span></div>
        <div><b data-count="${acc}" data-suf="%">0</b><span>recalled</span></div>
        <div><b data-count="${mins}">0</b><span>min</span></div>
        <div><b data-count="${SES.best}">0</b><span>best run</span></div>
        ${SES.newN?`<div><b data-count="${SES.newN}">0</b><span>new words</span></div>`:''}
      </div>
      <div class="hero-meta" style="justify-content:center;margin-top:14px">
        <span class="chip ${streak?'hot':''}">${streak?'🔥 '+streak+'-day streak':'streak starts tomorrow'}</span>
        ${nextDueText()?`<span class="chip">${esc(nextDueText())}</span>`:''}
        ${SES.g[1]?`<span class="chip warn">${SES.g[1]} to revisit</span>`:''}
      </div>
      <div class="row" style="justify-content:center;gap:8px;margin-top:20px">
        ${soon?`<button class="btn" onclick="startReview()">Keep going</button>`:''}
        <button class="btn ghost" onclick="go('home')">Back to Today</button>
      </div>`;
    countUp(done);
  }
}catch(e){}}
/* the production card: audio-first 聽寫 card */
function renderRevDictation(){
  try{
    if(!cur||isGram(cur)||modeOf(cur)!=='prod'||revealed||S.settings.prodAudio===false)return;
    const w=wordOf(cur), st=document.querySelector('#vRev .stage'); if(!w||!st)return;
    st.innerHTML=`<div class="hint">聽寫 · listen, then write it on paper</div>
      <div style="text-align:center;margin:4px 0"><button class="spk lg" onclick="speakWord('${w.id}')">${SPK_SVG}</button></div>
      ${w.pos?`<div class="pos">${esc(w.pos)}</div>`:''}
      <div class="meaning" style="font-size:21px">${esc(w.m)}</div>
      ${hintShown?`<div class="pyline" style="font-size:24px">${tonePinyin(esc(w.p))}</div>`:`<div class="hint"><span class="link" onclick="hintShown=true;renderRev()">show pinyin</span></div>`}
      ${window.usHint?usHint(w):''}
      <div class="hint">which 字? write it, say the tones, then check</div>`;
    const tag=document.querySelector('#vRev .mtag.prod'); if(tag)tag.textContent='聽寫 · Write';
    if(!renderRev._spoke||renderRev._spoke!==cur){renderRev._spoke=cur;setTimeout(()=>speakWord(w.id),200);}
  }catch(e){}
}
/* card backs get the lookup row */
function renderRevLookup(){
  try{if(!cur||isGram(cur)||!revealed)return;const st=document.querySelector('#vRev .stage');if(st&&!st.querySelector('.lookup'))st.insertAdjacentHTML('beforeend',lookupRow(wordOf(cur).t));}catch(e){}
}
function reveal(){revealed=true;renderRev();}
function skipKnown(level){if(!cur)return;const wid=cur.split(':')[0];(level==='m'?markMastered:markKnown)(wid);['learn','rev','fresh'].forEach(k=>{rq[k]=rq[k].filter(cid=>cid.split(':')[0]!==wid);});nextCard();}
/* One grade = one undo step. The snapshot holds everything a grade can touch, so undo is exact. */
function grade(g){
  lastGrade=g;haptic(g===1?'again':'good');
  if(animOn()){const st=document.querySelector('#vRev .stage');if(st){st.classList.add(g===1?'swipe-left':'swipe-right');}}
  if(!cur)return;
  const snap=o=>JSON.parse(JSON.stringify(o||{}));
  undoStack.push({cid:cur,card:snap(S.cards[cur]),log:snap(S.log),intro:snap(S.intro),cintro:snap(S.cintro),gintro:snap(S.gintro),sib:snap(S.sib),hard:(S.hard||[]).slice(),pick:(S.pick||[]).slice(),ses:snap(SES)});
  if(undoStack.length>25)undoStack.shift();
  const was=S.cards[cur]; if(!was||was.st===undefined)SES.newN++;
  SES.n++; SES.g[g]=(SES.g[g]||0)+1;
  if(g>=3){SES.run++;if(SES.run>SES.best)SES.best=SES.run;} else SES.run=0;
  rate(cur,g);sessionN++;
  ['learn','rev','fresh'].forEach(k=>{const i=rq[k].indexOf(cur);if(i>-1)rq[k].splice(i,1);});
  const c=S.cards[cur];
  /* still in its learning steps → back into this session, unless the grade just parked it as a leech */
  if(!c.susp&&c.due<=Date.now()+15*MIN&&(c.st==='learn'||c.st==='relearn'))rq.learn.push(cur);
  nextCard();
}
function doUndo(){ // step back through as many cards as the stack holds
  const u=undoStack.pop(); if(!u)return;
  const had=Object.keys(u.card).length;
  S.cards[u.cid]=had?u.card:{};
  S.log=u.log;S.intro=u.intro;
  if(u.sib){S.cintro=u.cintro;S.gintro=u.gintro;S.sib=u.sib;S.hard=u.hard;S.pick=u.pick;}
  if(u.ses)Object.assign(SES,u.ses);
  save();
  cur=u.cid;revealed=true;sessionN=Math.max(0,sessionN-1);renderRev();
}

/* review: card slides in; the grade you just gave colours the edge of the next card for a beat */
let lastGrade=0;

const SES={t0:0,n:0,g:[0,0,0,0,0],run:0,best:0,newN:0,lastRun:0};
function sesReset(){SES.t0=Date.now();SES.n=0;SES.g=[0,0,0,0,0];SES.run=0;SES.best=0;SES.newN=0;SES.lastRun=0;}

/* ---- 4. quick session ---- */
function startQuick(n){REV_CAP=n;go('rev');}
function startLane(k){REV_FILTER=c=>laneOf(c)===k;go('rev');}
/* review sessions can start filtered and capped without a stray first card */
let REV_FILTER=null, REV_CAP=0;
