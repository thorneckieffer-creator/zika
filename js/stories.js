const RD={ln:0,i:-1,segs:[],unk:new Set(),sel:-1,en:false};
function rdLessons(){return Object.keys(READINGS).map(Number).sort((a,b)=>a-b);}
function rdState(){S.read=S.read||{};return S.read;}
/* longest known word first; everything else falls through one character at a time */
function rdSegment(text){
  const out=[]; let i=0;
  while(i<text.length){
    let hit=null;
    for(let L=Math.min(5,text.length-i);L>=1;L--){const s=text.substr(i,L); if(WORD_BY_T[s]){hit=s;break;}}
    if(hit){out.push({t:hit,w:WORD_BY_T[hit]});i+=hit.length;continue;}
    const ch=text[i]; out.push(/[㐀-鿿]/.test(ch)?{t:ch,w:null}:{t:ch,p:1}); i++;
  }
  return out;
}
function rdStart(){
  const have=rdLessons(); if(!have.length){toast('No stories yet');return;}
  const want=drillScope==='lesson'?drillLesson:(S.settings.curLesson||have[0]);
  RD.ln=have.includes(want)?want:(have.filter(l=>l<=want).pop()||have[0]); RD.i=-1;
  drillMode='story'; dq=null; go('drill');
}
function rdOpen(i){const p=READINGS[RD.ln][i]; RD.i=i; RD.segs=rdSegment(p.zh); RD.unk=new Set(); RD.sel=-1; RD.en=false; rdRender(); window.scrollTo(0,0);}
function rdTap(i){const s=RD.segs[i]; if(!s||s.p)return; RD.sel=i; if(s.w){if(RD.unk.has(i))RD.unk.delete(i);else RD.unk.add(i);} rdRender();}
function rdListen(){const p=READINGS[RD.ln][RD.i]; if(p)speakText(p.zh);}
function rdQuiet(){try{speechSynthesis.cancel();}catch(e){}}
function rdDone(){
  const R=rdState(), k=RD.ln+':'+RD.i; R[k]=(R[k]||0)+1;
  const ids=[...new Set([...RD.unk].map(i=>RD.segs[i].w&&RD.segs[i].w.id).filter(Boolean))]; ids.forEach(addHard);
  save(); if(ids.length)toast(ids.length+' word'+(ids.length>1?'s':'')+' → hard list');
  rdQuiet(); RD.i=-1; rdRender();
}
function rdRender(){
  const el=document.getElementById('vDrill'); if(!el||drillMode!=='story')return;
  const have=rdLessons(), list=READINGS[RD.ln]||[], R=rdState();
  const head=`<div class="rev-top"><span class="qtype">短文 · Stories</span><span class="qprog">${esc(lnLabel(RD.ln))}</span></div>`;
  if(RD.i<0){
    el.innerHTML=head+`<div class="card"><div class="lab">Pick a lesson</div>
        <div class="rd-lessons">${have.map(l=>`<button class="${l===RD.ln?'on':''}" onclick="RD.ln=${l};rdRender()">${esc(lnLabel(l))}</button>`).join('')}</div>
        <div class="small muted" style="margin-top:8px">Each story uses only characters you have met by the end of its lesson, so it is all review plus that lesson's new words.</div></div>
      <div class="card"><div class="lab">${esc(lnLabel(RD.ln))} · ${esc(LESSON_TITLES[RD.ln]||'')}</div>
        ${list.map((p,i)=>`<div class="rd-item" onclick="rdOpen(${i})"><div><b class="zh">${esc(p.t)}</b><div class="small muted">${esc(p.en)} · ${[...p.zh].filter(c=>/[㐀-鿿]/.test(c)).length} characters</div></div><span class="rd-go">${R[RD.ln+':'+i]?'✓ read '+R[RD.ln+':'+i]+'×':'Read →'}</span></div>`).join('')}</div>
      <div class="row" style="justify-content:center;margin-top:6px"><button class="btn ghost" onclick="drillMode=null;renderDrill()">Back to drills</button></div>`;
    return;
  }
  const p=list[RD.i], sel=RD.sel>=0?RD.segs[RD.sel]:null;
  const gloss=sel?(sel.w?`<b class="zh" style="font-size:20px">${esc(sel.t)}</b> <span class="pyline">${tonePinyin(esc(sel.w.p))}</span> ${spkBtn(sel.w.id)}<div>${esc(sel.w.m)} <span class="small muted">· ${esc(lnLabel(sel.w.l))}</span></div>`
      :`<b class="zh" style="font-size:20px">${esc(sel.t)}</b> <span class="small muted">a character you know from other words</span>`)
    :'<span class="small muted">tap any word for its reading and meaning · tapped words are marked to review</span>';
  el.innerHTML=head+`<div class="stage rd-stage">
      <div class="rd-title zh">${esc(p.t)}</div><div class="small muted" style="margin-bottom:12px">${esc(p.en)}</div>
      <div class="rd-text zh" lang="zh-Hant">${RD.segs.map((s,i)=>s.p?esc(s.t):`<span class="rd-w ${RD.unk.has(i)?'unk':''} ${RD.sel===i?'sel':''} ${s.w&&s.w.l===RD.ln?'new':''}" onclick="rdTap(${i})">${esc(s.t)}</span>`).join('')}</div>
      <div class="rd-gloss">${gloss}</div>
      ${RD.en?`<div class="rd-en">${esc(p.tr)}</div>`:''}
      <div class="row" style="justify-content:center;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn ghost sm" onclick="rdListen()">▶ Listen</button><button class="btn ghost sm" onclick="RD.en=!RD.en;rdRender()">${RD.en?'Hide':'Show'} English</button><button class="btn" onclick="rdDone()">Done ✓${RD.unk.size?' · '+RD.unk.size+' to review':''}</button></div>
      <div class="small muted" style="text-align:center;margin-top:10px">underlined = this lesson's new words · <span class="link" onclick="rdQuiet();RD.i=-1;rdRender()">back to the list</span></div></div>`;
}
DRILL_SCREENS.story={start:rdStart,render:rdRender};
