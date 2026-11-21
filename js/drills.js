/* The Drill tab: the list of drills (DMODES), the full-screen ones that paint the tab themselves (DRILL_SCREENS),
   and the drills that live here: recognition, tones, dictation, sentences, speaking and recording, 口試, which-one,
   the reading sprint and sentence dictation. */

/* penalise a miss without inflating schedules on a hit */
function drillMiss(wid,mode){
  addHard(wid);
  const m = mode==='prod' ? 'prod' : 'rec';
  const c = S.cards[cardId(wid,m)];
  if(c && c.st!==undefined) rate(cardId(wid,m),1);
  save();
}

/* ---------- DRILL ---------- */
/* the drills, in the order their tiles are shown: [mode, name, what it is] */
const DMODES=[
  ['dict','聽寫 Dictation','audio → write it'],
  ['rec','認字 Recognition','see it · know it'],
  ['tone','聲調 Tones','hear the pattern'],
  ['mtest','寫字測驗 Mastery test','English + pinyin → write it · ★ ~ ✗'],
  ['wp','句型 Which pattern?','他十點＿＿來 · 就 or 才？ · the test that decides'],
  ['listen','聽力 Listening','dialogue lines read aloud · hide text · shadow'],
  ['sdict','句子聽寫 Sentence dictation','hear a sentence · write all of it'],
  ['read','閱讀 Reading sprint','ten sentences, tap what you don’t know'],
  ['sent','造句 Sentences','build with the grammar'],
  ['speak','口說 Speaking','say it · record it'],
  ['tcoach','聲調教練 Tone coach','record yourself · see your tones against a native speaker'],
  ['story','短文 Stories','short readings from the words you know · tap for meanings'],
  ['usage','用法 Phrases','pick a lesson · say the phrase each word lives in']];
let drillMode=null, drillScope='lesson', drillLesson=21, dq=null, recState=null;

function drillWords(){
  /* a pile from the exam set */
  if(drillScope==='examset')return EXAM_POOL.map(id=>byId[id]).filter(Boolean).filter(w=>S.settings.includeNames||!isName(w));
  /* a frequency tier */
  let pool;
  if(drillScope==='hard') pool=(S.hard||[]).map(id=>byId[id]).filter(Boolean);
  else if(drillScope==='due') pool=WORDS.filter(w=>MODES.some(m=>{const c=S.cards[cardId(w.id,m)];return c&&c.st!==undefined&&c.due<=Date.now();}));
  else if(drillScope==='deck') pool=WORDS.filter(w=>tracked(w.id));
  else pool=WORDS.filter(w=>w.l===drillLesson);
  return pool.filter(w=>S.settings.includeNames||!isName(w));
}
function drillPoints(){
  if(drillScope==='lesson') return (GRAMMAR[drillLesson]||[]);
  let out=[]; for(let l=1;l<=MAX_LN;l++) out=out.concat(GRAMMAR[l]||[]);
  return out;
}

function startDrill(mode){
  /* a full-screen drill mode (DRILL_SCREENS) starts itself */
  const x=DRILL_SCREENS[mode];if(x)return x.start();
  /* the tone coach lets go of the microphone; its own mode starts itself */
  tcRelease();if(mode==='tcoach')return tcStart();
  /* speech and the microphone never outlive the screen that started them */
  recKill();if(mode!=='listen')try{lpStop();}catch(e){}
  /* the mastery test */
  if(mode==='mtest')return mtResume();
  /* sentence dictation */
  if(mode==='sdict')return startSdict();
  /* the listening player, on the lesson in scope */
  if(mode==='listen'){LP.ln=drillScope==='lesson'?drillLesson:(S.settings.curLesson||23);LP.src=DIALOGUES[LP.ln]?'dlg':'sent';return startListen();}
  /* the reading sprint */
  if(mode==='read')return startRead();
  /* rec / tone / dict / sent / speak: build the question list */
  drillMode=mode; dq=null; recState=null;
  const qs=[];
  if(mode==='rec'||mode==='tone'||mode==='dict'){
    let pool=drillWords();
    if(pool.length<2){renderDrill();return;}
    const bank=WORDS.filter(w=>!isName(w));
    const N=Math.min(20,Math.max(6,pool.length));
    const order=shuf(pool).slice(0,N);
    for(const w of order){
      if(mode==='dict'){qs.push({mode:'dict',w});continue;}
      if(mode==='tone'){
        const seq=toneSeq(w.p); if(!seq.length||seq.every(t=>t===0)){continue;}
        const opts=new Set([seq.join('-')]);
        let guard=0;
        while(opts.size<4&&guard++<40){
          const alt=seq.map(t=>Math.random()<0.6?(1+Math.floor(Math.random()*4)):t);
          if(alt.join('-')!==seq.join('-'))opts.add(alt.join('-'));
        }
        qs.push({mode:'tone',w,correct:seq.join('-'),opts:shuf([...opts])});
        continue;
      }
      const kind=['c2m','m2c','a2c'][Math.floor(Math.random()*3)];
      const seenT=new Set([w.t]), seenM=new Set([w.m]);
      const distinct=list=>shuf(list).filter(x=>x.id!==w.id&&!seenT.has(x.t)&&!seenM.has(x.m)&&seenT.add(x.t)&&seenM.add(x.m));
      let distr=distinct(bank.filter(x=>x.l===w.l)).slice(0,3);
      if(distr.length<3)distr=distr.concat(distinct(bank).slice(0,3-distr.length));
      qs.push({mode:'rec',kind,w,opts:shuf([w,...distr])});
    }
  } else if(mode==='sent'){
    const pts=drillPoints().filter(p=>p.s&&p.s.length);
    for(const p of shuf(pts).slice(0,10)) qs.push({mode:'sent',p});
  } else if(mode==='speak'){
    const pts=drillPoints().filter(p=>p.s&&p.s.length);
    const lines=[];
    for(const p of pts) for(const s of p.s) lines.push({p,s});
    for(const L of shuf(lines).slice(0,12)) qs.push({mode:'speak',p:L.p,s:L.s});
  }
  dq={qs:shuf(qs),i:0,ok:0,state:'ask',chosen:null};
  renderDrill();
}
function drillAnswer(ok){
  /* a miss comes back once at the end of the round */
  try{const q=dq&&dq.qs[dq.i];if(q&&!ok&&!q._requeued&&q.w){const c=Object.assign({},q,{_requeued:true,_played:0});dq.qs.push(c);}}catch(e){}
  const q=dq.qs[dq.i];
  if(ok)dq.ok++;
  if(!ok&&q.w)drillMiss(q.w.id,q.mode==='dict'?'prod':'rec');
  dq.state='done';renderDrill();
}
function drillPick(i){
  if(!dq||dq.state!=='ask')return;
  const q=dq.qs[dq.i];dq.chosen=i;
  const ok=q.mode==='tone'?q.opts[i]===q.correct:q.opts[i].id===q.w.id;
  drillAnswer(ok);
}
function drillNext(){recKill();dq.i++;dq.state='ask';dq.chosen=null;recState=null;renderDrill();}

/* recording */
let REC_ACTIVE=null;   /* the one live MediaRecorder, tracked apart from recState so it can always be stopped */
async function recStart(){
  recKill();
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const mr=new MediaRecorder(stream);const chunks=[];
    if(recState&&recState.url)URL.revokeObjectURL(recState.url);
    const mine={rec:mr,url:null};
    mr.ondataavailable=e=>chunks.push(e.data);
    mr.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());          /* release the microphone whatever happens next */
      if(REC_ACTIVE===mr)REC_ACTIVE=null;
      if(recState!==mine)return;                         /* the card moved on — this take belongs to nothing */
      recState={url:URL.createObjectURL(new Blob(chunks,{type:mr.mimeType||'audio/webm'})),rec:null};
      if(view==='drill')renderDrill();};
    recState=mine;REC_ACTIVE=mr;mr.start();renderDrill();
  }catch(e){recState={err:'Mic unavailable — check the browser permission.'};renderDrill();}
}
function recStop(){if(recState&&recState.rec)recState.rec.stop();}
function recPlay(){if(recState&&recState.url)new Audio(recState.url).play().catch(()=>{});}

/* 口試 exam prompt */
let examP=null, examT=null;
function makeExam(){
  recKill();
  const ln=drillLesson;
  const pts=(GRAMMAR[ln]||[]);
  const ws=WORDS.filter(w=>w.l===ln&&!isName(w));
  examP={title:LESSON_TITLES[ln]||'',ln,
    g:shuf(pts).slice(0,3),v:shuf(ws).slice(0,5),
    left:180,started:false,spoke:null};
  if(examT){clearInterval(examT);examT=null;}
  renderDrill();
}
/* The clock and the recording are one thing: they start together (every take gets its own three minutes),
   and they stop together — on Stop, when the time is up, and when the card is no longer on screen. */
function examStart(){
  if(!examP)return;examP.started=true;examP.left=180;examP.spoke=null;
  if(examT)clearInterval(examT);
  examT=setInterval(()=>{if(!examP){clearInterval(examT);examT=null;return;}
    examP.left--;
    const el=document.getElementById('examClock');
    if(el)el.textContent=String(Math.floor(examP.left/60))+':'+String(examP.left%60).padStart(2,'0');
    if(examP.left<=0||!el||view!=='drill'){examP.left=Math.max(0,examP.left);examStop();}},1000);
  recStart();renderDrill();
}
function examStop(){
  if(examT){clearInterval(examT);examT=null;}
  if(examP&&examP.started&&examP.spoke==null)examP.spoke=180-examP.left;
  if(recState&&recState.rec)recStop(); else if(view==='drill')renderDrill();
}

function renderDrill(){
  /* a full-screen drill mode (DRILL_SCREENS) paints the whole tab itself */
  const x=DRILL_SCREENS[drillMode];if(x&&!dq){x.render();return;}
  /* so does the tone coach while it has a list */
  if(drillMode==='tcoach'&&!dq&&TC.list.length){tcRender();return;}
  drillRenderInner();
  /* the drill menu (and only the menu) ends with the tone summary and the tone-pair map */
  try{const el=document.getElementById('vDrill');if(!dq&&el&&el.querySelector('.dgrid')&&!el.querySelector('.tc-panel'))el.insertAdjacentHTML('beforeend','<div class="tc-panel">'+tcPanel()+'</div>');}catch(e){}
}
/* renderDrill without the tone coach and the registered full-screen modes: the exam-set test, or the tab itself
   followed by the answer flash and the "More drills" fold. Its early return comes back to renderDrill's last step. */
function drillRenderInner(){
  if(drillMode==='extest'&&!dq){exRender();return;}
  drillRenderScreens();
  drillAnswerFlash();
  drillMenuDemote();
}
/* the mastery test, a sentence-dictation question and the listening player paint themselves; anything else is the
   card below followed by the dictation repaint. Its early returns come back to drillRenderInner's last two steps. */
function drillRenderScreens(){
  if(drillMode==='mtest'&&!dq){mtRender();return;}
  const el=document.getElementById('vDrill');if(dq&&dq.i<dq.qs.length&&dq.qs[dq.i].mode==='sdict'){renderSdict(el);return;}
  if(drillMode==='listen'&&!dq){lpRender();return;}
  drillRenderCard();
  drillDictCard();
}
/* a reading-sprint question paints itself; anything else is the base screen and the confetti on a finished set.
   Its early return comes back to drillRenderScreens' last step. */
function drillRenderCard(){
  const el=document.getElementById('vDrill');
  if(dq&&dq.i<dq.qs.length){const q=dq.qs[dq.i];if(q.mode==='read'){renderRead(el);return;}}
  drillRenderBase();
  partyIfDone('#vDrill');
}
/* the menu, the score card, or one question of a rec / tone / dict / sent / speak drill */
function drillRenderBase(){
  const el=document.getElementById('vDrill');
  /* the menu's only bar is where the words come from; the drills themselves are the tiles below it */
  const scopeBar=`
  <div class="segbar"><span class="cap">From</span>
    <button class="${drillScope==='lesson'?'on':''}" onclick="drillScope='lesson';dq=null;renderDrill()">A lesson</button>
    <button class="${drillScope==='hard'?'on':''}" onclick="drillScope='hard';dq=null;renderDrill()">My hard list (${(S.hard||[]).length})</button>
    <button class="${drillScope==='due'?'on':''}" onclick="drillScope='due';dq=null;renderDrill()">Due now</button>
    <button class="${drillScope==='deck'?'on':''}" onclick="drillScope='deck';dq=null;renderDrill()">Whole deck</button>
    ${drillScope==='lesson'?lessonPick(drillLesson,'drillLesson=v;dq=null;renderDrill()'):''}
  </div>`;

  if(!drillMode||!dq){
    el.innerHTML=scopeBar+`
    <div class="card"><div class="lab">Pick a drill</div>
      <div class="dgrid">${DMODES.map(m=>`<button class="dcard" onclick="startDrill('${m[0]}')"><b>${m[1]}</b><span>${m[2]}</span></button>`).join('')}</div>
      <div class="small muted" style="margin-top:14px">Scope: <b>${drillScope==='lesson'?esc(lnLabel(drillLesson)):drillScope==='hard'?'your hard list':drillScope==='due'?'cards due now':'whole deck'}</b> · ${drillWords().length} words, ${drillPoints().length} grammar points available. Misses pull the card back in your review queue; correct answers never inflate your schedule.</div>
    </div>
    <div class="card"><div class="lab">口試 · Exam simulator</div>
      <div class="small muted" style="margin-bottom:10px">Three minutes on the lesson topic, using at least 3 grammar points and 5 vocabulary words — the MTC oral format.</div>
      <button class="btn" onclick="makeExam()">Generate a prompt</button>
      ${examP?examCard():''}
    </div>`;
    return;
  }
  if(dq.i>=dq.qs.length){
    const scored=dq.qs.filter(q=>q.mode==='rec'||q.mode==='tone').length||dq.qs.length;
    const pct=Math.round(dq.ok/dq.qs.length*100);
    el.innerHTML=`<div class="card done">
      <div class="zhd zh">${pct>=80?'太好了！':pct>=50?'不錯！':'加油！'}</div>
      <div style="font-weight:600;font-size:16px">${dq.ok} / ${dq.qs.length} · ${pct}%</div>
      <div class="muted small" style="margin-top:4px">Missed words go onto your hard list and back into the review queue.</div>
      <div class="qfoot" style="margin-top:16px">
        <button class="btn ghost" onclick="dq=null;renderDrill()">Back</button>
        <button class="btn" onclick="startDrill('${drillMode}')">Again</button>
      </div></div>`;
    return;
  }
  const q=dq.qs[dq.i], done=dq.state==='done';
  let body='';
  if(q.mode==='rec'){
    const w=q.w;
    if(q.kind==='c2m'){
      body=`<div class="bigzh zh">${esc(w.t)}</div><div class="hint">what does it mean?</div>
      <div class="opts sm" style="grid-template-columns:1fr">${q.opts.map((o,i)=>`<button class="${done?(o.id===w.id?'right':(dq.chosen===i?'wrong':'')):''}" onclick="drillPick(${i})">${esc(o.m)}</button>`).join('')}</div>`;
    } else if(q.kind==='m2c'){
      body=`<div class="meaning" style="font-size:19px">${esc(w.m)}</div><div class="hint">which character?</div>
      <div class="opts">${q.opts.map((o,i)=>`<button class="zh" style="font-size:24px" onclick="drillPick(${i})">${esc(o.t)}</button>`).join('')}</div>`;
    } else {
      body=`<div class="hint">listen — which word is it?</div>
      <div style="text-align:center"><button class="spk lg" onclick="speakWord('${w.id}')">${SPK_SVG}</button></div>
      <div class="opts">${q.opts.map((o,i)=>`<button class="zh" style="font-size:24px" onclick="drillPick(${i})">${esc(o.t)}</button>`).join('')}</div>`;
    }
    if(done)body+=`<div class="revealbox"><span class="zh" style="font-size:28px">${dcZh(w.t)}</span> <span class="pyline" style="font-size:18px">${tonePinyin(esc(w.p))}</span> ${spkBtn(w.id)}<div class="small muted">${esc(w.m)}</div>${compLines(w.t)}</div>`;
  } else if(q.mode==='tone'){
    const w=q.w;
    body=`<div class="bigzh zh" style="font-size:56px">${esc(w.t)}</div>
      <div class="small muted">${esc(w.m)}</div><div class="hint">which tone pattern?</div>
      <div class="opts">${q.opts.map((o,i)=>`<button class="tonebtn ${done?(o===q.correct?'right':(dq.chosen===i?'wrong':'')):''}" onclick="drillPick(${i})">${esc(toneLabel(o.split('-').map(Number)))}</button>`).join('')}</div>
      ${done?`<div class="revealbox"><span class="pyline" style="font-size:24px">${tonePinyin(esc(w.p))}</span> ${spkBtn(w.id)}</div>`:''}`;
  } else if(q.mode==='dict'){
    const w=q.w;
    body=`<div class="hint">聽寫 — play it, write it on paper, then check</div>
      <div style="text-align:center;margin:6px 0"><button class="spk lg" onclick="speakWord('${w.id}')">${SPK_SVG}</button></div>
      ${done?`<div class="bigzh zh" style="font-size:56px">${dcZh(w.t)}</div>
        <div class="row" style="justify-content:center;gap:9px"><span class="pyline">${tonePinyin(esc(w.p))}</span>${spkBtn(w.id)}</div>
        <div class="meaning">${esc(w.m)}</div>${compLines(w.t)}`
      :`<div class="qfoot"><button class="btn" onclick="dq.state='reveal';renderDrill()">Show the answer</button></div>`}
      ${dq.state==='reveal'?`<div class="bigzh zh" style="font-size:56px">${dcZh(w.t)}</div>
        <div class="row" style="justify-content:center;gap:9px"><span class="pyline">${tonePinyin(esc(w.p))}</span>${spkBtn(w.id)}</div>
        <div class="meaning">${esc(w.m)}</div>${compLines(w.t)}
        <div class="qfoot"><button class="btn ghost" onclick="drillAnswer(false)">Missed it ✗</button><button class="btn" onclick="drillAnswer(true)">Wrote it right ✓</button></div>`:''}`;
  } else if(q.mode==='sent'){
    const p=q.p;
    body=`<div class="gp-head"><b>${esc(p.t)}</b>${p.src?`<span class="tag mtc">${esc(p.src)}</span>`:''}</div>
      ${p.pat?`<div class="patline">${esc(p.pat)}</div>`:`<div class="small muted">${esc(p.e||'')}</div>`}
      <div class="hint">造句 — write your own sentence with ${p.tgt&&p.tgt.length?`「<b class="zh">${esc(p.tgt[0])}</b>」`:'this pattern'}</div>
      ${dq.state==='ask'?`<textarea class="gtxt zh" placeholder="寫一個句子…"></textarea>
        <div class="qfoot"><button class="btn" onclick="dq.qs[dq.i].mine=(document.querySelector('#vDrill .gtxt')||{}).value||'';dq.state='reveal';renderDrill()">Compare with the models</button></div>`:''}
      ${dq.state!=='ask'&&q.mine?`<div class="revealbox" style="margin-bottom:8px"><div class="gsent"><span class="z zh">${esc(q.mine)}</span><span class="e">your sentence</span></div></div>`:''}
      ${dq.state!=='ask'?`<div class="revealbox">${p.s.slice(0,4).map(s=>`<div class="gsent"><span class="z zh">${esc(s.zh)}</span><button class="spk" onclick="playAudio('${esc(s.zh).replace(/'/g,"\\'")}')">${SPK_SVG}</button><span class="e">${esc(s.en)}</span>${s.py?`<div class="py2" style="width:100%">${tonePinyin(esc(s.py))}</div>`:''}</div>`).join('')}
        ${p.tw?`<div class="notebox tw"><b>Taiwan</b> ${esc(p.tw)}</div>`:''}
        ${p.ov?`<div class="notebox ov"><b>Overlap</b> ${esc(p.ov)}</div>`:''}</div>`:''}
      ${dq.state==='reveal'?`<div class="qfoot"><button class="btn ghost" onclick="drillAnswer(false)">Needs work</button><button class="btn" onclick="drillAnswer(true)">Mine works ✓</button></div>`:''}`;
  } else if(q.mode==='speak'){
    const s=q.s;
    body=`<div class="gp-head"><b>${esc(q.p.t)}</b></div>
      <div class="qzh zh" style="font-size:22px">${esc(s.zh)}</div>
      ${s.py?`<div class="py2">${tonePinyin(esc(s.py))}</div>`:''}
      <div class="small muted">${esc(s.en)}</div>
      <div class="qfoot" style="margin-top:10px">
        <button class="btn ghost" onclick="playAudio('${esc(s.zh).replace(/'/g,"\\'")}')">▶ Model</button>
        ${recState&&recState.rec?`<button class="btn rec-on" onclick="recStop()">■ Stop</button>`:`<button class="btn ghost" onclick="recStart()">● Record</button>`}
        ${recState&&recState.url?`<button class="btn ghost" onclick="recPlay()">▶ Mine</button>`:''}
      </div>
      ${recState&&recState.err?`<div class="small" style="color:var(--red)">${esc(recState.err)}</div>`:''}
      <div class="qfoot" style="margin-top:6px"><button class="btn ghost" onclick="drillAnswer(false)">Rough</button><button class="btn" onclick="drillAnswer(true)">Clean ✓</button></div>`;
  }
  el.innerHTML=`
  <div class="rev-top">
    <span class="mtag ${q.mode==='dict'||q.mode==='speak'?'prod':'rec'}">${esc((DMODES.find(m=>m[0]===drillMode)||['','Drill'])[1])}</span>
    <span>${dq.i+1} / ${dq.qs.length} · ${dq.ok} right · <span class="link" onclick="dq=null;renderDrill()">exit</span></span>
  </div>
  <div class="qbox">${body}</div>
  ${done?`<div class="qfoot" style="margin-top:12px"><button class="btn" onclick="drillNext()">Next →</button></div>`:''}`;
}
/* dictation question: audio → pinyin + meaning → write → character (repaints the .qbox the base screen just filled) */
function drillDictCard(){
  try{
    if(!dq||dq.i>=dq.qs.length)return; const q=dq.qs[dq.i]; if(q.mode!=='dict')return;
    const w=q.w, st=dq.state, box=document.querySelector('#vDrill .qbox'); if(!box)return;
    const hintOn=S.settings.dictHint!=='late'||st==='hint'||st==='reveal'||st==='done';
    const meta=`<div class="row" style="justify-content:center;gap:9px"><span class="pyline">${tonePinyin(esc(w.p))}</span></div><div class="meaning">${esc(w.m)}</div>`;
    const charBlock=`<div class="bigzh zh" style="font-size:56px">${dcZh(w.t)}</div>${w.s?`<div class="simpnote">简体 ${esc(w.s)}</div>`:''}${compLines(w.t)}`;
    box.innerHTML=`<div class="hint">聽寫 — listen, write it on paper, then check</div>
      <div style="text-align:center;margin:6px 0"><button class="spk lg" onclick="speakWord('${w.id}')">${SPK_SVG}</button></div>
      ${hintOn?meta:`<div class="qfoot"><button class="btn ghost" onclick="dq.state='hint';renderDrill()">Show pinyin · meaning</button></div>`}
      ${(st==='reveal'||st==='done')?charBlock:(hintOn?`<div class="qfoot"><button class="btn" onclick="dq.state='reveal';renderDrill()">Show the character</button></div>`:'')}
      ${st==='reveal'?`<div class="qfoot"><button class="btn ghost" onclick="drillAnswer(false)">Missed it ✗</button><button class="btn" onclick="drillAnswer(true)">Wrote it right ✓</button></div>`:''}`;
    if(st==='ask'&&!q._played){q._played=1;setTimeout(()=>speakWord(w.id),150);}
  }catch(e){}
}
/* answer flash, applied after the re-render, where the buttons actually are */
function drillAnswerFlash(){
  try{if(!dq||dq.state!=='done'||!animOn())return;const r=document.querySelector('#vDrill .opts button.right');const w=document.querySelector('#vDrill .opts button.wrong');if(r)r.classList.add('pop');if(w)w.classList.add('shake');}catch(e){}
}
/* the menu: characters up front, sentences under More */
function drillMenuDemote(){
  try{
  if(dq||drillMode==='listen'||drillMode==='mtest')return; const el=document.getElementById('vDrill');
  const grid=el.querySelector('.dgrid'); if(!grid)return;
  const dem=[...grid.querySelectorAll('.dcard')].filter(c=>DEMOTED.some(m=>(c.getAttribute('onclick')||'').includes("'"+m+"'")));
  if(!dem.length)return;
  const det=document.createElement('details'); det.className='guide'; det.open=moreDrills; det.innerHTML='<summary>More drills · sentences, listening, grammar ›</summary>'; const g2=document.createElement('div'); g2.className='dgrid'; g2.style.marginTop='10px'; dem.forEach(c=>g2.appendChild(c)); det.appendChild(g2); grid.insertAdjacentElement('afterend',det); det.addEventListener('toggle',()=>{moreDrills=det.open;});
}catch(e){}
}
function examCard(){
  const p=examP;if(!p)return'';
  return `<div class="examcard">
    <div class="row spread"><div><b>${esc(lnLabel(p.ln))} · ${esc(p.title)}</b><div class="small muted">${p.spoke!=null&&!examT?`You spoke for ${Math.floor(p.spoke/60)}:${String(p.spoke%60).padStart(2,'0')}${p.spoke>=180?' — the full three minutes':''}.`:'Talk for three minutes.'}</div></div>
      <div class="clock" id="examClock">${Math.floor(p.left/60)}:${String(p.left%60).padStart(2,'0')}</div></div>
    <div class="small" style="margin-top:10px"><b>Use these grammar points:</b></div>
    <ul class="exlist">${p.g.map(g=>`<li>${esc(g.t)}${g.tgt&&g.tgt.length?` <span class="zh">「${esc(g.tgt[0])}」</span>`:''}</li>`).join('')}</ul>
    <div class="small"><b>Use these words:</b> <span class="zh">${p.v.map(w=>esc(w.t)).join('、')}</span></div>
    <div class="qfoot" style="margin-top:12px">
      ${p.started?(examT?`<button class="btn rec-on" onclick="examStop()">■ Stop</button>`:`<button class="btn ghost" onclick="examStart()">● Record again</button>`)
        :`<button class="btn" onclick="examStart()">Start · record</button>`}
      ${recState&&recState.url?`<button class="btn ghost" onclick="recPlay()">▶ Play mine</button>`:''}
      <button class="btn ghost" onclick="makeExam()">New prompt</button>
    </div>
    ${recState&&recState.err?`<div class="small" style="color:var(--red)">${esc(recState.err)}</div>`:''}
  </div>`;
}

/* ---- 6. Reading sprint ---- */
const WORD_BY_T=(()=>{const m={};WORDS.forEach(w=>{const k=w.t.split('（')[0];if(!m[k]||w.l<m[k].l)m[k]=w;});return m;})();
function readPool(){const cl=S.settings.curLesson||22, lo=Math.max(1,cl-4);const out=[];for(let l=lo;l<=cl;l++)(GRAMMAR[l]||[]).forEach(p=>p.s.forEach(s=>{if(s.zh.length>=8)out.push({p,s,l,wt:l===cl?3:l===cl-1?2:1});}));return out;}
function startRead(){const pool=readPool();const qs=[];let bag=pool.slice();while(qs.length<10&&bag.length){const tot=bag.reduce((a,x)=>a+x.wt,0);let r=Math.random()*tot,i=0;for(;i<bag.length;i++){r-=bag[i].wt;if(r<=0)break;}const it=bag[i];bag.splice(i,1);qs.push({mode:'read',p:it.p,s:it.s,l:it.l,segs:segZh(it.s.zh),unk:new Set()});}
  drillMode='read';dq={qs,i:0,ok:0,state:'ask',chosen:null};go('drill');}
function readTap(i){const q=dq.qs[dq.i];if(dq.state!=='ask')return;if(q.unk.has(i))q.unk.delete(i);else q.unk.add(i);renderDrill();}
function readReveal(){dq.state='reveal';renderDrill();}
function readMark(ok){const q=dq.qs[dq.i];if(ok)dq.ok++;q.unk.forEach(i=>{const w=WORD_BY_T[q.segs[i]];if(w){addHard(w.id);}});if(q.unk.size)toast(q.unk.size+' word'+(q.unk.size>1?'s':'')+' → hard list');dq.state='done';haptic(ok?'good':'again');drillNext();}
function renderRead(el){
  const q=dq.qs[dq.i], ask=dq.state==='ask';
  el.innerHTML=`<div class="rev-top"><span class="qtype">Reading sprint · ${esc(lnLabel(q.l))}</span><span class="qprog">${dq.i+1} / ${dq.qs.length}</span></div>
  <div class="qbox">
    <div class="readline">${q.segs.map((c,i)=>c==='，'?'<span class="pun">，</span>':`<button class="seg zh ${q.unk.has(i)?'unk':''} ${WORD_BY_T[c]?'':'nw'}" onclick="readTap(${i})">${esc(c)}</button>`).join('')}</div>
    <div class="qen">${ask?'read it aloud · tap any word you don’t know · then reveal':''}</div>
    ${!ask?`<div class="qen" style="color:var(--ink);font-size:15.5px">${esc(q.s.en)}</div>${q.s.py?`<div class="py2">${tonePinyin(esc(q.s.py))} ${spkBtnText(q.s.zh)}</div>`:''}<div class="small muted" style="margin-top:6px">pattern: <b>${esc(q.p.t)}</b> ${notionLink(q.l)}</div>`:''}
    <div class="qfoot">${ask?`<button class="btn" onclick="readReveal()">Reveal</button>`:`<button class="btn ghost" onclick="readMark(false)">Didn’t get it</button><button class="btn" onclick="readMark(true)">Understood ✓</button>`}</div>
  </div>`;
}

/* ---- 3. sentence dictation ---- */
function startSdict(){
  const ln=drillScope==='lesson'?drillLesson:(S.settings.curLesson||23);
  const pool=[];(GRAMMAR[ln]||[]).forEach(p=>p.s.forEach(s=>{if(s.zh.length>=6&&s.zh.length<=22)pool.push({mode:'sdict',zh:s.zh,en:s.en,py:s.py||'',p:p.t});}));
  if(!pool.length){toast('No sentences for that lesson yet');return;}
  drillMode='sdict';dq={qs:shuf(pool).slice(0,8),i:0,ok:0,state:'ask',chosen:null};go('drill');
}
function sdSpeak(){if(!dq||!dq.qs||!dq.qs[dq.i]||dq.qs[dq.i].mode!=='sdict')return;const q=dq.qs[dq.i];const r=LP.rate;LP.rate=Math.min(LP.rate,0.85);lpSpeak(q.zh);LP.rate=r;}
function sdMark(ok){if(ok)dq.ok++;haptic(ok?'good':'again');dq.state='done';drillNext();}
function renderSdict(el){
  const q=dq.qs[dq.i], st=dq.state;
  el.innerHTML=`<div class="rev-top"><span class="qtype">句子聽寫 · Sentence dictation</span><span class="qprog">${dq.i+1} / ${dq.qs.length}</span></div>
  <div class="qbox">
    <div class="hint">listen twice, write the whole sentence on paper, then check</div>
    <div style="text-align:center;margin:6px 0"><button class="spk lg" onclick="sdSpeak()">${SPK_SVG}</button></div>
    ${st==='ask'?`<div class="qen">${esc(q.en)}</div><div class="qfoot"><button class="btn" onclick="dq.state='reveal';renderDrill()">Show the sentence</button></div>`
    :`<div class="qzh zh">${esc(q.zh)}</div>${q.py?`<div class="py2">${tonePinyin(esc(q.py))}</div>`:''}<div class="qen">${esc(q.en)}</div><div class="small muted">pattern: ${esc(q.p)}</div>
      <div class="qfoot"><button class="btn ghost" onclick="sdMark(false)">Missed characters ✗</button><button class="btn" onclick="sdMark(true)">All correct ✓</button></div>`}
  </div>`;
  if(st==='ask'&&!q._played){q._played=1;setTimeout(sdSpeak,200);}
}
function recKill(){try{if(REC_ACTIVE&&REC_ACTIVE.state!=='inactive')REC_ACTIVE.stop();}catch(e){}}
/* ---- 4. drills: characters up front, sentences under More ---- */
const DEMOTED=['listen','sdict','read','sent','speak'];
let moreDrills=false;
/* Full-screen drill modes register here instead of wrapping startDrill / renderDrill again:
   DRILL_SCREENS[mode] = {start, render}. start() sets drillMode and calls go('drill'); render() paints #vDrill while dq is null. */
const DRILL_SCREENS={};
DRILL_SCREENS.wp={start:wpStart,render:wpRender};   /* 句型 Which pattern? (js/grammar.js) */
if(typeof zikaWhole==='function')zikaWhole();   /* the last line: this file arrived whole (index.html, js/boot.js) */
