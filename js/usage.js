/* 用法, usage phrases: the short phrases and sentences each word lives in (data/usage.js), shown on card backs and
   drilled lesson by lesson. */

function usOf(wid){return USAGE[wid]||[];}
function usHeads(w){const m=w.t.match(/（([^）]+)）/);return [w.t.split('（')[0].replace(/\s*\+\s*[a-z]+|[a-z]+\s*\+\s*/g,'').trim()].concat(m?[m[1]]:[]);}
/* the phrase with its headword marked, or (cloze) replaced by a blank of the same length; null if the word is split up inside it */
function usMark(zh,w,cloze){
  const h=usHeads(w).find(x=>zh.includes(x));
  if(!h)return cloze?null:esc(zh);
  const i=zh.indexOf(h);
  return esc(zh.slice(0,i))+(cloze?'<span class="us-gap" aria-label="blank">'+'<i></i>'.repeat(h.length)+'</span>':'<b>'+esc(h)+'</b>')+esc(zh.slice(i+h.length));
}
function usIsSent(zh){return /[。？！][」』]?$/.test(zh);}
/* the order a card shows them in: a sentence first (the word at work), then the collocations, then the other sentences */
function usOrder(w){
  const l=usOf(w.id), ks=l.map((p,k)=>k), s=ks.find(k=>usIsSent(l[k][0]));
  return s===undefined?ks:[s].concat(ks.filter(k=>k!==s));
}
function usRow(w,i){
  const p=usOf(w.id)[i];
  return `<div class="us-row${usIsSent(p[0])?' sent':''}" onclick="event.stopPropagation();usSay('${w.id}',${i})" title="tap to hear it"><div class="us-zh zh" lang="zh-Hant">${usMark(p[0],w)}</div><div class="us-sub">${S.settings.showPy!==false?`<span class="us-py">${tonePinyin(esc(p[1]))}</span>`:''}<span>${esc(p[2])}</span></div></div>`;
}
/* the list for a card's answer side: a sentence and two phrases, the rest one tap away */
function usBlock(w,all){
  if(!w||S.settings.usageCards===false)return '';
  const ks=usOrder(w); if(!ks.length)return '';
  const n=all?ks.length:Math.min(3,ks.length);
  return `<div class="us-box" data-w="${w.id}"><div class="us-h">用法 · how it is used</div>${ks.slice(0,n).map(k=>usRow(w,k)).join('')}${n<ks.length?`<div class="us-more"><span class="link" onclick="event.stopPropagation();usExpand(this)">${ks.length-n} more</span></div>`:''}</div>`;
}
/* optional, on the question side of a write card: the word's sentence with the word left blank */
function usHint(w){
  if(!w||S.settings.usageHint!==true||S.settings.usageCards===false)return '';
  const l=usOf(w.id), k=usKs(w).find(x=>usIsSent(l[x][0])); if(k===undefined)return '';
  return `<div class="us-hint"><div class="zh" lang="zh-Hant">${usMark(l[k][0],w,true)}</div><div class="us-sub">${esc(l[k][2])}</div></div>`;
}
function usExpand(el){const box=el.closest('.us-box');const w=box&&byId[box.dataset.w];if(w)box.outerHTML=usBlock(w,true);}
function usSay(wid,i){const p=usOf(wid)[i];if(p)speakText(p[0]);}

/* ---------- the 用法 drill ----------
   Start screen: pick a lesson (or the hard list, or what is due), then a short quiz, the whole lesson, or
   just browse every word's phrases. A question gives the English and the phrase with the word blanked.
   S.us[wordId] = [times right, times missed, last answer 1/0]: it orders the quiz and draws the lesson's progress. */
const UQ={scr:'start',ln:0,src:'lesson',q:null,i:0,shown:false,miss:[],added:false,whole:false};
const US_ROUND=12;
function usState(){S.us=S.us||{};return S.us;}
function usLessons(){const s=new Set();WORDS.forEach(w=>{if(USAGE[w.id])s.add(w.l);});return [...s].sort((a,b)=>a-b);}
function usKs(w){const l=usOf(w.id);return l.map((p,k)=>k).filter(k=>usMark(l[k][0],w,true)!==null);}
function usLessonWords(ln){return WORDS.filter(w=>w.l===ln&&USAGE[w.id]);}
function usDue(w){return MODES.some(m=>{const c=S.cards[cardId(w.id,m)];return c&&c.st!==undefined&&c.due<=Date.now();});}
function usSrcWords(src){
  const all=src==='hard'?(S.hard||[]).map(id=>byId[id]).filter(Boolean):src==='due'?WORDS.filter(usDue):WORDS.filter(w=>w.l===UQ.ln);
  return all.filter(w=>usKs(w).length);
}
function usSrcName(){return UQ.src==='hard'?'hard list':UQ.src==='due'?'due now':lnLabel(UQ.ln);}
function usProg(ws){const st=usState();let ok=0,seen=0;ws.forEach(w=>{const x=st[w.id];if(x){seen++;if(x[2])ok++;}});return {n:ws.length,ok,seen};}
function usSetLn(ln){UQ.ln=ln;UQ.src='lesson';drillScope='lesson';drillLesson=ln;usRender();}
function usStart(){
  drillMode='usage'; dq=null; UQ.scr='start'; UQ.q=null; UQ.src='lesson';
  const have=usLessons(), want=drillScope==='lesson'?drillLesson:(S.settings.curLesson||have[0]);
  if(!UQ.ln||drillScope==='lesson')UQ.ln=have.includes(want)?want:(have.filter(l=>l<=want).pop()||have[0]||want);
  go('drill');
}
/* never asked first, then the ones missed last time, then the rest; each group in a fresh order */
function usRank(ws){
  const st=usState(), g=w=>{const x=st[w.id];return !x?0:x[2]?2:1;};
  return shuf(ws).sort((a,b)=>g(a)-g(b));
}
function usBegin(src,whole){
  UQ.src=src;
  const pool=usSrcWords(src); if(!pool.length){toast('No phrases there yet');return;}
  const pick=whole?pool:usRank(pool).slice(0,US_ROUND);
  UQ.q=pick.map(w=>{const ks=usKs(w), sent=ks.filter(k=>usIsSent(usOf(w.id)[k][0])), from=(sent.length&&Math.random()<0.5)?sent:ks;return {w,k:from[Math.floor(Math.random()*from.length)]};});
  UQ.i=0; UQ.shown=false; UQ.miss=[]; UQ.added=false; UQ.whole=!!whole; UQ.scr='quiz';
  usRender(); window.scrollTo(0,0);
}
function usShow(){UQ.shown=true;usRender();const c=UQ.q[UQ.i];if(c&&S.settings.autoplayAudio)setTimeout(()=>usSay(c.w.id,c.k),120);}
function usGrade(ok){
  const c=UQ.q&&UQ.q[UQ.i]; if(!c)return;
  const st=usState(), x=st[c.w.id]||[0,0,0]; x[ok?0:1]++; x[2]=ok?1:0; st[c.w.id]=x; save();
  if(!ok&&!UQ.miss.includes(c.w.id))UQ.miss.push(c.w.id);
  UQ.i++; UQ.shown=false; usRender(); window.scrollTo(0,0);
}
function usAddHard(){UQ.miss.forEach(addHard);UQ.added=true;toast(UQ.miss.length+' word'+(UQ.miss.length>1?'s':'')+' → hard list');usRender();}
function usQuiet(){try{speechSynthesis.cancel();}catch(e){}}
function usHome(){usQuiet();UQ.scr='start';UQ.q=null;usRender();window.scrollTo(0,0);}
function usStop(){usQuiet();UQ.q=null;UQ.scr='start';drillMode=null;renderDrill();}
function usBrowse(){UQ.src='lesson';UQ.scr='browse';usRender();window.scrollTo(0,0);}
function usWordCard(w){
  const x=usState()[w.id];
  return `<div class="us-wcard"><div class="us-whead"><b class="zh" lang="zh-Hant">${esc(w.t)}</b><span class="us-wpy">${tonePinyin(esc(w.p))}</span>${spkBtn(w.id)}${x?`<span class="us-mark ${x[2]?'ok':'no'}" title="${x[2]?'right last time':'missed last time'}">${x[2]?'✓':'·'}</span>`:''}</div>
    <div class="us-wm">${w.pos?`<span class="us-pos">${esc(w.pos)}</span> `:''}${esc(w.m)}</div>${usOf(w.id).map((p,k)=>usRow(w,k)).join('')}</div>`;
}
function usRender(){
  const el=document.getElementById('vDrill'); if(!el||drillMode!=='usage')return;
  const top=r=>`<div class="rev-top"><span class="qtype">用法 · Phrases</span><span class="qprog">${r}</span></div>`;
  const ln=UQ.ln, title=LESSON_TITLES[ln]||'';
  if(UQ.scr==='browse'){
    const ws=usLessonWords(ln);
    el.innerHTML=top(esc(lnLabel(ln)))+`<div class="us-bar"><div><b>Book ${bookOf(ln)} · Lesson ${lnInBook(ln)}</b><div class="small muted">${esc(title)} · ${ws.length} words · tap a phrase to hear it</div></div>
        <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm" onclick="usBegin('lesson',false)">Quiz me</button><button class="btn ghost sm" onclick="usHome()">Back</button></div></div>
      <div class="us-browse">${ws.map(usWordCard).join('')}</div>
      <div class="row" style="justify-content:center;gap:8px;margin-top:14px"><button class="btn" onclick="usBegin('lesson',false)">Quiz me on these</button><button class="btn ghost" onclick="usHome()">Back</button></div>`;
    return;
  }
  if(UQ.scr==='start'||!UQ.q){
    const ws=usSrcWords('lesson'), all=usLessonWords(ln), nP=all.reduce((n,w)=>n+usOf(w.id).length,0), pr=usProg(ws);
    const hard=usSrcWords('hard').length, due=usSrcWords('due').length;
    el.innerHTML=top('')+`<div class="card us-start">
        <div class="us-pickrow"><span class="us-lab">Lesson</span>${lessonPick(ln,'usSetLn(v)')}</div>
        <div class="us-ltitle">Book ${bookOf(ln)} · Lesson ${lnInBook(ln)}${title?` <span>${esc(title)}</span>`:''}</div>
        ${ws.length?`<div class="small muted">${all.length} words · ${nP} phrases and sentences</div>
          <div class="us-prog"><div class="sbar"><i style="width:${Math.round(pr.ok/pr.n*100)}%"></i></div><span class="small muted">${pr.seen?`${pr.ok} of ${pr.n} words right the last time you met them`:'not practised yet'}</span></div>
          <div class="us-acts"><button class="btn" onclick="usBegin('lesson',false)">Quiz · ${Math.min(US_ROUND,ws.length)} phrases</button><button class="btn ghost" onclick="usBegin('lesson',true)">Whole lesson · ${ws.length} words</button><button class="btn ghost" onclick="usBrowse()">Browse the phrases</button></div>
          <div class="small muted" style="margin-top:12px">You get the English and the phrase with the word left out. Say the whole phrase, then check.</div>`
        :`<div class="small muted" style="margin-top:6px">No phrases for this lesson yet.</div>`}
      </div>
      ${hard||due?`<div class="card"><div class="us-lab" style="margin-bottom:10px">Or practise the words that need it</div><div class="us-acts" style="margin-top:0">
        ${hard?`<button class="btn ghost" onclick="usBegin('hard',false)">My hard list · ${hard} word${hard>1?'s':''}</button>`:''}${due?`<button class="btn ghost" onclick="usBegin('due',false)">Due now · ${due} word${due>1?'s':''}</button>`:''}</div></div>`:''}
      <div class="row" style="justify-content:center;margin-top:6px"><button class="btn ghost" onclick="usStop()">Back to drills</button></div>`;
    return;
  }
  const n=UQ.q.length;
  if(UQ.i>=n){
    const got=n-UQ.miss.length, miss=UQ.miss.map(id=>byId[id]).filter(Boolean);
    el.innerHTML=top(esc(usSrcName()))+`<div class="card done"><div class="zhd zh">${got===n?'太棒了':got>=n*0.7?'做得好':'加油'}</div>
        <div style="font-weight:600;font-size:16px;margin-bottom:6px">${got} of ${n} phrases</div>
        ${miss.length?`<div class="small muted" style="margin-bottom:8px">To go over again:</div><div class="us-missed">${miss.map(w=>`<span class="zh" lang="zh-Hant">${esc(w.t.split('（')[0])}</span>`).join('')}</div>
          <div style="margin-top:12px">${UQ.added?'<span class="small muted">Added to your hard list.</span>':`<button class="btn ghost sm" onclick="usAddHard()">Add ${miss.length===1?'it':'these '+miss.length} to my hard list</button>`}</div>`:'<div class="small muted">Every phrase came back.</div>'}
        <div class="row" style="justify-content:center;gap:8px;margin-top:18px;flex-wrap:wrap"><button class="btn" onclick="usBegin(UQ.src,false)">Another round</button><button class="btn ghost" onclick="usHome()">Pick a lesson</button><button class="btn ghost" onclick="usStop()">Back to drills</button></div></div>`;
    return;
  }
  const c=UQ.q[UQ.i], w=c.w, p=usOf(w.id)[c.k], others=usOrder(w).filter(k=>k!==c.k);
  el.innerHTML=top(`${UQ.i+1} / ${n} · ${esc(usSrcName())}`)+`<div class="sbar"><i style="width:${Math.round(UQ.i/n*100)}%"></i></div>
    <div class="stage us-stage"><div class="rv-main">
      <div class="hint">${UQ.shown?'did you say all of it?':'say it in Chinese, then check'}</div>
      <div class="us-en">${esc(p[2])}</div>
      <div class="us-big zh" lang="zh-Hant">${usMark(p[0],w,!UQ.shown)}</div>
      ${UQ.shown?`<div class="row" style="justify-content:center;gap:9px"><span class="pyline" style="font-size:19px">${tonePinyin(esc(p[1]))}</span><button class="spk" title="pronounce" onclick="usSay('${w.id}',${c.k})">${SPK_SVG}</button></div>
        <div class="us-word"><b class="zh" lang="zh-Hant">${esc(w.t)}</b> <span>${tonePinyin(esc(w.p))}</span> · ${esc(w.m)}</div>`:''}</div>
      ${UQ.shown&&others.length?`<div class="us-box"><div class="us-h">also</div>${others.map(k=>usRow(w,k)).join('')}</div>`:''}
    </div>
    ${UQ.shown?`<div class="grades us-grades"><button onclick="usGrade(0)"><span class="g1">Missed</span><span class="iv">go over it again</span></button><button onclick="usGrade(1)"><span class="g3">Got it</span><span class="iv">next phrase</span></button></div>
      <div class="small muted" style="text-align:center;margin-top:10px"><kbd>1</kbd> missed · <kbd>2</kbd> got it · <span class="link" onclick="usHome()">stop</span></div>`
    :`<div style="margin-top:16px"><button class="btn big" onclick="usShow()">Show answer</button></div>
      <div class="small muted" style="text-align:center;margin-top:10px"><span class="kbh"><kbd>space</kbd> · </span><span class="link" onclick="usHome()">stop</span></div>`}`;
}
DRILL_SCREENS.usage={start:usStart,render:usRender};
