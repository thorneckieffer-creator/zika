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
  ['listen','聽力 Listening','dialogue lines read aloud · hide text · shadow'],
  ['sdict','句子聽寫 Sentence dictation','hear a sentence · write all of it'],
  ['confuse','辨析 Which one?','不／沒 · 就／才 · 在／到 …'],
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
  /* "which one?" and the reading sprint */
  if(mode==='confuse')return startConfuse(null);if(mode==='read')return startRead();
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
/* a "which one?" or reading-sprint question paints itself; anything else is the base screen, the confetti on a
   finished set, and the "which one?" panel under the menu. Its early returns come back to drillRenderScreens' last step. */
function drillRenderCard(){
  const el=document.getElementById('vDrill');
  if(dq&&dq.i<dq.qs.length){const q=dq.qs[dq.i];if(q.mode==='confuse'){renderConfuse(el);return;}if(q.mode==='read'){renderRead(el);return;}}
  drillRenderBase();
  partyIfDone('#vDrill');
  try{ if(!dq){el.insertAdjacentHTML('beforeend',confusePanel());} }catch(e){}
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
    if(done)body+=`<div class="revealbox"><span class="zh" style="font-size:28px">${esc(w.t)}</span> <span class="pyline" style="font-size:18px">${tonePinyin(esc(w.p))}</span> ${spkBtn(w.id)}<div class="small muted">${esc(w.m)}</div>${compLines(w.t)}</div>`;
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
      ${done?`<div class="bigzh zh" style="font-size:56px">${esc(w.t)}</div>
        <div class="row" style="justify-content:center;gap:9px"><span class="pyline">${tonePinyin(esc(w.p))}</span>${spkBtn(w.id)}</div>
        <div class="meaning">${esc(w.m)}</div>${compLines(w.t)}`
      :`<div class="qfoot"><button class="btn" onclick="dq.state='reveal';renderDrill()">Show the answer</button></div>`}
      ${dq.state==='reveal'?`<div class="bigzh zh" style="font-size:56px">${esc(w.t)}</div>
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
    const charBlock=`<div class="bigzh zh" style="font-size:56px">${esc(w.t)}</div>${w.s?`<div class="simpnote">简体 ${esc(w.s)}</div>`:''}${compLines(w.t)}`;
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

/* ---- "Which one?" — the confusable pairs from Notion, with the rule of thumb each time ---- */
const CONFUSE=[
 {k:'neg',t:'不 or 沒？',zh:'不／沒',rule:'不 = intention, habit, or a state/quality (不熱, 不好寫, 不去 = won’t go). 沒 = something that didn’t happen, or 有 (沒去 = didn’t go, 沒忘, 沒有錢).',opts:['不','沒'],q:[
  {zh:'我覺得今天⬚熱，不必多穿一點。',a:'不',en:'I don’t think it’s hot today, no need to wear more.',why:'熱 is a state → 不.'},
  {zh:'去年他來臺灣的時候太忙了，⬚去夜市。',a:'沒',en:'Last year he was too busy in Taiwan and didn’t go to the night market.',why:'It didn’t happen → 沒.'},
  {zh:'我⬚忘！我等一下要去圖書館念書。',a:'沒',en:'I didn’t forget! I’m going to the library to study in a bit.',why:'沒忘 — the forgetting didn’t happen.'},
  {zh:'中文很好學，可是中國字⬚好寫。',a:'不',en:'Chinese is easy to learn, but the characters aren’t easy to write.',why:'好寫 is a Vs (a quality) → 不.'},
  {zh:'昨天我⬚去學校上課。',a:'沒',en:'Yesterday I didn’t go to class.',why:'Past event that didn’t happen → 沒.'},
  {zh:'他明天⬚來，他要去台中。',a:'不',en:'He isn’t coming tomorrow, he’s going to Taichung.',why:'Intention / future → 不.'},
  {zh:'我還⬚吃早飯，有一點餓。',a:'沒',en:'I haven’t eaten breakfast yet, I’m a bit hungry.',why:'還沒 + V = not yet.'},
  {zh:'他⬚喜歡喝咖啡，每天都喝茶。',a:'不',en:'He doesn’t like coffee, he drinks tea every day.',why:'Habit / preference → 不.'}]},
 {k:'jiucai',t:'就 or 才？',zh:'就／才',rule:'就 = sooner, earlier, easier than expected (五歲就會了). 才 = later than expected, or merely / only (七歲才會, 才兩百塊).',opts:['就','才'],q:[
  {zh:'如玉五歲⬚會寫字了。',a:'就',en:'Ruyu could already write at five.',why:'Earlier than expected → 就.'},
  {zh:'安同七歲⬚會寫字。',a:'才',en:'Antong couldn’t write until he was seven.',why:'Later than expected → 才.'},
  {zh:'你看！我買的這件衣服⬚兩百塊。',a:'才',en:'Look! This shirt I bought was only 200.',why:'才 + amount = merely.'},
  {zh:'我以為垃圾車六點來，沒想到五點半⬚來了。',a:'就',en:'I thought the truck came at six; it turned out it came at 5:30.',why:'Sooner than expected → 就 … 了.'},
  {zh:'他每天很晚⬚睡覺，所以上課很累。',a:'才',en:'He doesn’t sleep until very late, so he’s tired in class.',why:'Late → 才.'},
  {zh:'我一到家⬚打電話給你。',a:'就',en:'I’ll call you as soon as I get home.',why:'一…就… = as soon as.'},
  {zh:'電影八點開始，他九點⬚到。',a:'才',en:'The film started at eight; he didn’t arrive until nine.',why:'Later than expected → 才.'},
  {zh:'下個星期⬚得準備考試了。',a:'就',en:'Next week we already have to prepare for the exam.',why:'Sooner than you’d like → 就.'}]},
 {k:'dian',t:'一點 or 有一點？',zh:'一點／有一點',rule:'有一點 + Vs = slightly, and always a complaint (有一點貴). Vs + 一點 = an instruction or a comparison (說慢一點, 冷一點). V + 一點 + N = a bit more of (多睡一點覺). 一點…也不 = not at all.',opts:['一點','有一點'],q:[
  {zh:'這個房間⬚小，我不太喜歡。',a:'有一點',en:'This room is a bit small, I don’t really like it.',why:'Complaint before a Vs → 有一點.'},
  {zh:'請你說慢⬚。',a:'一點',en:'Please speak a little slower.',why:'Instruction: Vs + 一點.'},
  {zh:'醫生要他多睡⬚覺。',a:'一點',en:'The doctor wants him to sleep a bit more.',why:'多 + V + 一點 + O.'},
  {zh:'我⬚餓了，我們去吃飯吧。',a:'有一點',en:'I’m a bit hungry, let’s go eat.',why:'Mild complaint → 有一點 餓.'},
  {zh:'今天比昨天冷⬚。',a:'一點',en:'Today is a little colder than yesterday.',why:'Comparison: Vs + 一點.'},
  {zh:'這件衣服⬚貴，可是很好看。',a:'有一點',en:'This shirt is a bit pricey, but it looks great.',why:'Complaint → 有一點 貴.'},
  {zh:'我⬚咖啡也不喝。',a:'一點',en:'I don’t drink coffee at all.',why:'一點 + N + 也不 = not at all.'}]},
 {k:'modal',t:'能 · 會 · 可以？',zh:'能／會／可以',rule:'會 = a learned skill, or "will / likely" (會說中文, 明天會下雨). 能 = circumstances allow it (感冒了不能來). 可以 = permission (可以抽菸嗎).',opts:['能','會','可以'],q:[
  {zh:'我⬚說中文，可是說得不好。',a:'會',en:'I can speak Chinese, but not well.',why:'Learned skill → 會.'},
  {zh:'這裡⬚抽菸嗎？',a:'可以',en:'Is smoking allowed here?',why:'Permission → 可以.'},
  {zh:'他感冒了，今天不⬚來上課。',a:'能',en:'He has a cold and can’t come to class today.',why:'Circumstances prevent it → 不能.'},
  {zh:'明天⬚下雨，你帶傘吧。',a:'會',en:'It will rain tomorrow, bring an umbrella.',why:'Likely / will → 會.'},
  {zh:'老師，我⬚早一點走嗎？',a:'可以',en:'Teacher, may I leave a little early?',why:'Asking permission → 可以.'},
  {zh:'我沒有錢，不⬚買機車。',a:'能',en:'I have no money, I can’t buy a scooter.',why:'Circumstance (no money) → 不能.'},
  {zh:'你⬚游泳嗎？',a:'會',en:'Can you swim?',why:'A skill you learned → 會.'},
  {zh:'圖書館裡不⬚吃東西。',a:'可以',en:'No eating in the library.',why:'A rule about permission → 不可以.'}]},
 {k:'cause',t:'因為 · 為了 · 要不然 · 如果？',zh:'因果',rule:'因為 looks backwards to a cause and drags 所以 with it. 為了 looks forwards to a goal and never takes 所以. 要不然 = "or else" (only the bad way). 如果…就 = a condition, either direction.',opts:['因為','為了','要不然','如果'],q:[
  {zh:'我⬚學中文來台灣。',a:'為了',en:'I came to Taiwan in order to study Chinese.',why:'A goal → 為了.'},
  {zh:'我⬚喜歡台灣，所以來台灣。',a:'因為',en:'I came to Taiwan because I like it.',why:'A cause, with 所以 → 因為.'},
  {zh:'⬚保護環境，台灣人天天做垃圾分類。',a:'為了',en:'To protect the environment, Taiwanese sort their rubbish every day.',why:'"In order to" fits → 為了.'},
  {zh:'⬚下雨，所以我們沒去。',a:'因為',en:'Because it rained, we didn’t go.',why:'Cause + 所以 → 因為.'},
  {zh:'你得把垃圾分類，⬚垃圾車不收。',a:'要不然',en:'You have to sort the rubbish, or else the truck won’t take it.',why:'"Or else" → 要不然.'},
  {zh:'⬚你搬家了，我就少了一個朋友。',a:'如果',en:'If you move, I’ll have one friend fewer.',why:'A condition with 就 → 如果.'},
  {zh:'快一點，⬚就追不到垃圾車了。',a:'要不然',en:'Hurry, or else you won’t catch the truck.',why:'Only the bad consequence → 要不然.'}]},
 {k:'zai',t:'在 or 到？',zh:'在／到',rule:'V + 到 + place: movement, the thing arrives somewhere (踢到, 搬到, 開到). V + 在 + place: placing, the thing stays there (放在, 寫在, 存在). 正在 + V = in progress right now.',opts:['在','到'],q:[
  {zh:'那張椅子，請你放⬚樓下。',a:'在',en:'That chair, please put it downstairs.',why:'Placing verb, stays there → 在.'},
  {zh:'我把球踢⬚學校外面了。',a:'到',en:'I kicked the ball outside the school.',why:'Movement, arrives somewhere → 到.'},
  {zh:'這些字，我要寫⬚本子上。',a:'在',en:'These characters, I’ll write them in my notebook.',why:'寫在 — they stay on the page.'},
  {zh:'他想把公司搬⬚台南。',a:'到',en:'He wants to move the company to Tainan.',why:'搬到 — moving to a destination.'},
  {zh:'我正⬚網站上找租房子的資料。',a:'在',en:'I’m looking for rental info online right now.',why:'正在 + V = in progress.'},
  {zh:'我們從台北開⬚台南。',a:'到',en:'We drove from Taipei to Tainan.',why:'從…V到… — arriving at the end point.'},
  {zh:'錢存⬚銀行比較安全。',a:'在',en:'Money is safer kept in the bank.',why:'存在 — placed and stays.'}]},
 {k:'cmp',t:'比 · 比較 · 一樣 · 更 · 沒有？',zh:'比較',rule:'比 names the thing you compare against (A 比 B Vs). 比較 never names it (比較好吃). 跟…一樣 = the same as. 更 = even more. A 沒有 B (這麼) Vs = not as … as.',opts:['比','比較','一樣','更','沒有'],q:[
  {zh:'台北的房租⬚台中貴。',a:'比',en:'Rent in Taipei is higher than in Taichung.',why:'B (台中) is named → 比.'},
  {zh:'這家的牛肉麵⬚好吃。',a:'比較',en:'This place’s beef noodles are better.',why:'No B named → 比較.'},
  {zh:'我的手機跟你的⬚。',a:'一樣',en:'My phone is the same as yours.',why:'跟…一樣.'},
  {zh:'今天比昨天⬚冷。',a:'更',en:'Today is even colder than yesterday.',why:'比 + 更 = even more.'},
  {zh:'他的中文⬚我這麼好。',a:'沒有',en:'His Chinese isn’t as good as mine.',why:'A 沒有 B 這麼 Vs = not as … as.'},
  {zh:'哥哥⬚我高一點。',a:'比',en:'My older brother is a little taller than me.',why:'B named, + 一點 for how much.'}]},
 {k:'le',t:'Where does 了 go?',zh:'了',pick:true,rule:'V了 + object = completed. Sentence-final 了 = the situation changed. V了 + duration + 了 = still going. 太…了 is a frame. 沒 never takes 了.',q:[
  {en:'I’ve been waiting for the bus for twenty minutes (and still am).',opts:['我等公車等了二十分鐘了。','我等了二十分鐘公車。','我等公車二十分鐘了。'],a:'我等公車等了二十分鐘了。',why:'V了 + duration + 了 = up to now, still going.'},
  {en:'He lived in Taipei for three years (and then left).',opts:['他在台北住了三年。','他在台北住了三年了。','他在台北住三年了。'],a:'他在台北住了三年。',why:'No final 了 → the three years are finished.'},
  {en:'Coffee got expensive.',opts:['咖啡貴了。','咖啡了貴。','咖啡很貴了。'],a:'咖啡貴了。',why:'Sentence-final 了 = change of state.'},
  {en:'He didn’t eat breakfast.',opts:['他沒吃早飯。','他沒吃了早飯。','他不吃了早飯。'],a:'他沒吃早飯。',why:'沒 cancels the action; 了 never follows it.'},
  {en:'It’s way too expensive!',opts:['太貴了！','太貴！','很太貴了！'],a:'太貴了！',why:'太…了 is one frame; the 了 belongs to it.'},
  {en:'I don’t drink coffee anymore.',opts:['我不喝咖啡了。','我不喝了咖啡。','我沒喝咖啡了。'],a:'我不喝咖啡了。',why:'不…了 = not anymore (a change).'},
  {en:'I bought two books.',opts:['我買了兩本書。','我買兩本書了。','我了買兩本書。'],a:'我買了兩本書。',why:'V了 + quantified object = completed action.'}]},
 {k:'laiqu',t:'來 or 去？',zh:'來／去',rule:'來 = toward where I am standing, 去 = away from it. Ask "am I inside or outside / upstairs or downstairs?" before you say it. Same test in 搬到樓上來／去 and 走出來／走進去.',opts:['來','去'],q:[
  {zh:'（我在樓上）你把書搬到樓上⬚吧。',a:'來',en:'(I’m upstairs) Bring the books up here.',why:'Toward me → 來.'},
  {zh:'（我在樓下）我把書搬到樓上⬚了。',a:'去',en:'(I’m downstairs) I took the books upstairs.',why:'Away from me → 去.'},
  {zh:'（我在房間裡）你進⬚吧！',a:'來',en:'(I’m in the room) Come in!',why:'I’m inside, you move toward me → 進來.'},
  {zh:'（我在外面）她拿著垃圾走出⬚了。',a:'來',en:'(I’m outside) She walked out with the rubbish.',why:'She comes toward where I stand → 出來.'},
  {zh:'把瓶子丟進⬚。',a:'去',en:'Throw the bottle in.',why:'Into the bin, away from you → 進去.'},
  {zh:'垃圾車開過⬚了，我們快下去。',a:'來',en:'The truck is coming over, let’s hurry down.',why:'Toward us → 過來.'},
  {zh:'他走過⬚跟他們聊天。',a:'去',en:'He walked over to chat with them.',why:'Away from the speaker → 過去.'}]},
 {k:'li',t:'離 or 從？',zh:'離／從',rule:'A 離 B 遠／近 = distance between two points (nothing moves). 從 = a starting point: 從…到…, 從…往…, 從早上八點.',opts:['離','從'],q:[
  {zh:'我家⬚學校很近。',a:'離',en:'My home is close to school.',why:'Distance → 離.'},
  {zh:'⬚這裡往前走，就有一家超商。',a:'從',en:'Go straight from here and there’s a convenience store.',why:'Starting point + 往 → 從.'},
  {zh:'師大⬚台北101不遠。',a:'離',en:'Shida isn’t far from Taipei 101.',why:'Distance → 離.'},
  {zh:'他⬚早上八點工作到晚上六點。',a:'從',en:'He works from 8 am to 6 pm.',why:'從…到… in time.'},
  {zh:'你家⬚捷運站遠不遠？',a:'離',en:'Is your place far from the MRT?',why:'Distance → 離.'},
  {zh:'我們⬚台北開到台南。',a:'從',en:'We drove from Taipei to Tainan.',why:'從…V到… in space.'}]},
 {k:'time',t:'又…又 or 一邊…一邊？',zh:'又／一邊',rule:'又…又… = two qualities or states at once, same subject (又大又亮). 一邊…一邊… = two actions at the same time (一邊看電視一邊吃飯).',opts:['又','一邊'],q:[
  {zh:'這個房間⬚大又亮。',a:'又',en:'This room is both big and bright.',why:'Two qualities → 又…又.'},
  {zh:'小美⬚看電視，一邊吃飯。',a:'一邊',en:'Xiaomei eats while watching TV.',why:'Two actions → 一邊…一邊.'},
  {zh:'他的女朋友⬚漂亮又聰明。',a:'又',en:'His girlfriend is both pretty and smart.',why:'Two Vs → 又…又.'},
  {zh:'我常常⬚走路一邊聽音樂。',a:'一邊',en:'I often listen to music while walking.',why:'Two verbs happening together → 一邊.'}]},
 {k:'q',t:'還是 or 或是？',zh:'還是／或是',rule:'還是 = "or" inside a question (茶還是咖啡？) and 還是…吧 = you’d better. 或是 = "or" inside a statement (茶或是咖啡都可以).',opts:['還是','或是'],q:[
  {zh:'你要喝茶⬚咖啡？',a:'還是',en:'Do you want tea or coffee?',why:'A question → 還是.'},
  {zh:'我週末喝茶⬚喝咖啡都可以。',a:'或是',en:'On weekends tea or coffee is fine with me.',why:'A statement → 或是.'},
  {zh:'我們⬚搭捷運去吧，開車太麻煩。',a:'還是',en:'Let’s take the MRT instead, driving is a hassle.',why:'還是…吧 = you’d better.'},
  {zh:'你可以坐公車⬚坐捷運去學校。',a:'或是',en:'You can take the bus or the MRT to school.',why:'Statement → 或是.'}]}
];

/* ---- 2. Which one? ---- */
function cfStat(k){return (S.cf||{})[k]||{n:0,ok:0};}
function cfMark(k,ok){S.cf=S.cf||{};const s=S.cf[k]=S.cf[k]||{n:0,ok:0};s.n++;if(ok)s.ok++;s.last=Date.now();save();}
function cfLevel(k){const s=cfStat(k);if(!s.n)return 0;const r=s.ok/s.n;return s.n<4?1:r>=0.9?4:r>=0.75?3:r>=0.6?2:1;}
function buildConfuse(fams,n){
  const pool=CONFUSE.filter(f=>!fams||fams.includes(f.k));
  const items=[];
  pool.forEach(f=>{const lv=cfLevel(f.k), wt=lv===0?3:lv===1?4:lv===2?2:1;f.q.forEach(q=>items.push({mode:'confuse',f,q,wt}));});
  const out=[]; let bag=items.slice();
  while(out.length<n&&bag.length){const tot=bag.reduce((a,x)=>a+x.wt,0);let r=Math.random()*tot,i=0;for(;i<bag.length;i++){r-=bag[i].wt;if(r<=0)break;}out.push(bag[i]);bag.splice(i,1);}
  return out;
}
function startConfuse(fams){drillMode='confuse';dq={qs:buildConfuse(fams,fams&&fams.length===1?Math.min(8,CONFUSE.find(f=>f.k===fams[0]).q.length):12),i:0,ok:0,state:'ask',chosen:null,fams};go('drill');}
function cfPick(i){
  /* a miss comes back once at the end of the round */
  try{const q=dq&&dq.qs[dq.i];if(q&&dq.state==='ask'){const opts=q.q.opts||q.f.opts;if(opts[i]!==q.q.a&&!q._requeued)dq.qs.push(Object.assign({},q,{_requeued:true}));}}catch(e){}
  const q=dq.qs[dq.i];if(dq.state!=='ask')return;dq.chosen=i;const opts=q.q.opts||q.f.opts;const ok=opts[i]===q.q.a;cfMark(q.f.k,ok);if(ok)dq.ok++;dq.state='done';haptic(ok?'good':'again');renderDrill();}
function renderConfuse(el){
  const q=dq.qs[dq.i], f=q.f, it=q.q, done=dq.state==='done', opts=it.opts||f.opts, pick=!!f.pick;
  const zh=pick?'':esc(it.zh).replace('⬚','<span class="blank">'+(done?esc(it.a):'&nbsp;&nbsp;&nbsp;')+'</span>');
  el.innerHTML=`<div class="rev-top"><span class="qtype">Which one? · ${esc(f.t)}</span><span class="qprog">${dq.i+1} / ${dq.qs.length}</span></div>
  <div class="qbox">
    ${pick?`<div class="qen" style="font-size:15.5px;color:var(--ink)">Which one says: “${esc(it.en)}”</div>`:`<div class="qzh zh">${zh}</div><div class="qen">${esc(it.en)}</div>`}
    <div class="opts ${pick?'sm':''}" ${pick?'style="grid-template-columns:1fr"':''}>${opts.map((o,i)=>`<button class="zh ${done?(o===it.a?'right':(dq.chosen===i?'wrong':'')):''}" onclick="cfPick(${i})">${esc(o)}</button>`).join('')}</div>
    ${done?`<div class="why ${opts[dq.chosen]===it.a?'ok':'bad'}"><b>${opts[dq.chosen]===it.a?'✓':'✗'}</b> ${esc(it.why)} <a class="nlink" href="${NOTION.index}#辨析" target="_blank" rel="noopener">rule ↗</a></div>`:''}
  </div>
  ${done?`<div class="qfoot" style="margin-top:12px"><button class="btn" onclick="drillNext()">Next →</button></div>`:''}`;
}
function confusePanel(){
  return `<div class="card"><div class="row spread" style="margin-bottom:6px"><div><div class="lab" style="margin:0">Which one? · 辨析</div><div class="small muted">weak families come up more often · rules are in the Grammar Index</div></div><button class="btn sm" onclick="startConfuse(null)">Mixed set · 12</button></div>
    <div class="cfgrid">${CONFUSE.map(f=>{const lv=cfLevel(f.k),s=cfStat(f.k);return `<button class="cftile s${lv}" onclick="startConfuse(['${f.k}'])"><b class="zh">${esc(f.zh)}</b><span>${esc(f.t)}</span><i>${s.n?Math.round(s.ok/s.n*100)+'% · '+s.n:'new'}</i></button>`;}).join('')}</div></div>`;
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
const DEMOTED=['listen','sdict','confuse','read','sent','speak'];
let moreDrills=false;
/* Full-screen drill modes register here instead of wrapping startDrill / renderDrill again:
   DRILL_SCREENS[mode] = {start, render}. start() sets drillMode and calls go('drill'); render() paints #vDrill while dq is null. */
const DRILL_SCREENS={};
