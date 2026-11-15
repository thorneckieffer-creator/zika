/* 聲調教練, the tone coach: who is speaking (the native voice and the learner's), the rounds, recording a take,
   the chart against the native speaker, and the quick check on a review card. */

/* ---------- who is speaking ---------- */
/* The native voice: mid pitch and spread measured once per voice pack from a hundred clips. */
const TC_NATIVE={};
async function tcDecode(buf){
  const C=window.OfflineAudioContext||window.webkitOfflineAudioContext; let ctx;
  try{ctx=new C(1,1,TC_SR);}catch(e){ctx=new C(1,1,44100);}        /* an older Safari refuses a 16 kHz context; tcResample brings any rate down */
  const audio=await new Promise((res,rej)=>{const pr=ctx.decodeAudioData(buf,res,rej); if(pr&&pr.then)pr.then(res,rej);});
  return {x:audio.getChannelData(0),sr:audio.sampleRate};
}
async function tcClip(key){ if(!(await loadPack())||!AIDX[key])return null; const [o,l]=AIDX[key]; return tcDecode(APACK.slice(o,o+l)); }
async function tcNativeStats(){
  const id=APACK_ID||'f'; if(TC_NATIVE[id])return TC_NATIVE[id];
  try{const c=JSON.parse(store.getItem('zika_tc_native2_'+id)||'null'); if(c&&c.sd){TC_NATIVE[id]=c;return c;}}catch(e){}
  const all=[], keys=WORDS.filter(w=>{const n=[...audioKey(w.t)].length;return n>=1&&n<=3;}).map(w=>audioKey(w.t)).filter((k,i,a)=>AIDX[k]&&a.indexOf(k)===i);
  for(let i=0;i<keys.length&&i<100;i++){const c=await tcClip(keys[Math.floor(i*keys.length/100)]); if(!c)continue; for(const v of tcTrack(c.x,c.sr).voiced)all.push(v);}
  if(all.length<200)return {base:14.5,sd:3.4};
  const mean=all.reduce((a,b)=>a+b,0)/all.length;
  const s={base:mean,sd:Math.sqrt(all.reduce((a,b)=>a+(b-mean)*(b-mean),0)/all.length)};
  TC_NATIVE[id]=s; try{store.setItem('zika_tc_native2_'+id,JSON.stringify(s));store.removeItem('zika_tc_native_'+id);}catch(e){} return s;
}
/* You: the app learns your mid pitch and your range from every recording, so "high" and "low" are judged
   against your own voice. Until it has heard about three seconds of you it leans on the current take. */
/* S.tone = what the recordings say about your tones; S.vp = the picture of your voice. Both carry the version of the
   analysis that made them (v:2 since v52): grades and pitch statistics from the first analysis are not comparable, so
   they start again — the marker travels with the data, so an older device syncing its copy back cannot revive them. */
function tcState(){
  if(!S.tone||S.tone.v!==2)S.tone={v:2,n:0,by:{},conf:{},pair:{},w:{}};
  if(!S.vp||S.vp.v!==2)S.vp={v:2,n:0,sum:0,sq:0};
  S.tone.pair=S.tone.pair||{};
  return S.tone;
}
function tcUserStats(utterMed){
  tcState(); const v=S.vp;
  if(v.n<300)return {base:utterMed,sd:3.2,learning:true};
  const mean=v.sum/v.n, sd=Math.sqrt(Math.max(0,v.sq/v.n-mean*mean));
  return {base:mean,sd:Math.min(5,Math.max(2,sd))};
}
function tcLearn(voiced){
  tcState(); const v=S.vp; for(const s of voiced){v.n++;v.sum+=s;v.sq+=s*s;}
  if(v.n>30000){v.n=Math.round(v.n/2);v.sum/=2;v.sq/=2;}        /* keep following the voice as it changes */
}

/* ---------- the drill ---------- */
const TC={list:[],items:{},kind:null,i:0,state:'ask',stream:null,rec:null,timer:0,res:null,ref:null,url:null,busy:false,err:''};
const TC_NAME={1:'high and level',2:'rising',3:'low',4:'falling'};
/* what to change, by the tone it should be and the tone it sounded like */
const TC_TIP={
 '12':'Start at the top and hold it there — don’t slide up into it.', '13':'Higher: hold it near the top of your voice.', '14':'Keep it up and flat to the very end — don’t let it drop.',
 '21':'Begin lower, so there is room to climb.', '23':'Climb straight away — don’t dip first.', '24':'This one goes up, like asking “what?”.',
 '31':'Lower: let it sink to the bottom of your voice.', '32':'Stay down: sink and keep it low — the rise at the end is optional.', '34':'Begin low, not high: the third tone has no drop from the top.',
 '41':'Start high and let it fall all the way.', '42':'This one goes down, like a firm “No!”.', '43':'Start higher: a sharp drop from the top of your voice.'};
/* what to lean on next: the tone pair, or the single tone, that the recordings show as weakest (after a few tries at it) */
function tcFocus(){
  const T=tcState(); let best=null;
  for(const k in T.pair){const ok=T.pair[k][0], n=T.pair[k][1]; if(n>=4&&ok/n<0.75&&(!best||ok/n<best.r))best={kind:'pair',k,r:ok/n,n};}
  for(const t of [1,2,3,4]){const b=T.by[t]; if(b&&b[1]>=6&&b[0]/b[1]<0.75&&(!best||b[0]/b[1]<best.r-0.1))best={kind:'tone',k:String(t),r:b[0]/b[1],n:b[1]};}
  return best;
}
function tcFocusName(f){return f.kind==='pair'?'tone '+f.k[0]+' + tone '+f.k[1]:'tone '+f.k;}
/* a word the coach can grade: one to four characters, a tone known for each, at least one of them not neutral */
function tcCan(w){const k=audioKey(w.t), n=[...k].length, t=tcExpected(w.p); return /^[㐀-鿿]+$/.test(k)&&n>=1&&n<=4&&t.length===n&&t.some(x=>x>0);}
function tcPool(src){return (src||drillWords()).filter(tcCan);}
/* ---------- from a review card: check this one word's tones without leaving the review ----------
   The same coach in a sheet (TC.host names the element it paints into; in the Drill tab it is null). */
const TC_MIC_SVG='<svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';
function tcMicBtn(wid){
  const w=byId[wid]; if(!w||!tcCan(w)||!navigator.mediaDevices||!window.MediaRecorder)return '';
  return '<button class="spk" title="check my tones" aria-label="check my tones" onclick="event.stopPropagation();tcQuick(\''+wid+'\')">'+TC_MIC_SVG+'</button>';
}
function tcQuick(wid){
  tcRelease(); TC.list=[wid]; TC.items={}; TC.kind=null; TC.i=0; TC.res=null; TC.err=''; TC.done=0; TC.right=0; TC.total=0; TC.focus=null; TC.cal=false;
  tcState(); TC.state=S.vp.n<300?'cal':'ask';
  const m=shHost();
  if(!m._tc){m._tc=1;m.addEventListener('click',e=>{if(e.target===m&&TC.host)tcQuickClose();});}      /* a tap outside the sheet lets go of the microphone too */
  m.innerHTML='<div class="modal-card tc-sheet"><div class="sheet-h"><b>Check my tones</b><button class="xbtn" onclick="tcQuickClose()" aria-label="close">✕</button></div><div id="tcQuick"></div></div>';
  m.style.display='flex'; TC.host='tcQuick'; tcRender();
}
function tcQuickClose(){ tcRelease(); TC.host=null; TC.list=[]; TC.res=null; shClose(); }
/* a round of ten words. With a tone pair ("24") the round is ten two-syllable words of that pair, taken from the
   chosen scope or, when it holds too few, from every lesson up to the learner's own. */
/* what is on the card: a course word, or a short phrase made for this round (TC.items, ids "p:w12:0") */
function tcItem(id){return byId[id]||TC.items[id];}
/* short phrases from the usage lines of the words in scope: two to four characters, nothing but characters, more
   than the headword alone. They have no clip of their own, so there is no native curve and the system voice reads them. */
function tcPhrases(){
  const seen=new Set(), out=[];
  for(const w of drillWords())(typeof usOf==='function'?usOf(w.id):[]).forEach((x,i)=>{
    const it={id:'p:'+w.id+':'+i,t:x[0],p:x[1],m:x[2],phr:true};
    if(x[0]===audioKey(x[0])&&x[0]!==audioKey(w.t)&&[...x[0]].length>=2&&!seen.has(x[0])&&tcCan(it)){seen.add(x[0]);out.push(it);}
  });
  return out;
}
function tcSay(){const w=tcItem(TC.list[TC.i]); if(!w)return; if(w.phr)playAudio(w.t,w.p); else speakWord(w.id);}
function tcStart(pair){
  tcRelease(); TC.items={}; TC.kind=null;
  if(pair==='phr'){
    const ph=shuf(tcPhrases()).slice(0,10); if(ph.length<2){toast('No short phrases for that scope yet');return;}
    ph.forEach(x=>{TC.items[x.id]=x;}); TC.kind='phr'; TC.focus=null;
    TC.list=ph.map(x=>x.id); TC.i=0; TC.res=null; TC.err=''; TC.done=0; TC.right=0; TC.total=0;
    tcState(); TC.state=S.vp.n<300?'cal':'ask'; drillMode='tcoach'; dq=null; go('drill'); return;
  }
  const pool=tcPool(), manual=typeof pair==='string'&&/^[1-4]{2}$/.test(pair);
  if(!manual&&pool.length<2){toast('Not enough words in that scope for the tone coach');return;}
  /* otherwise up to six of the ten words practise the weakest tone or tone pair so far */
  const f=manual?null:tcFocus(); let pick=shuf(pool); TC.focus=null;
  if(manual){
    const hit=w=>tcExpected(w.p).join('')===pair; let hits=pool.filter(hit);
    if(hits.length<5)hits=tcPool(WORDS.filter(w=>w.l<=(S.settings.curLesson||MAX_LN))).filter(hit);
    if(hits.length<2){toast('No words with tone '+pair[0]+' + tone '+pair[1]+' in your lessons yet');return;}
    pick=shuf(hits); TC.focus={kind:'pair',k:pair,manual:true};
  }
  if(f){
    const hit=shuf(pool.filter(w=>{const t=tcExpected(w.p).join(''); return f.kind==='pair'?t===f.k:t.includes(f.k);})).slice(0,6), ids=new Set(hit.map(w=>w.id));
    if(hit.length>=2){pick=shuf(hit.concat(pick.filter(w=>!ids.has(w.id)).slice(0,10-hit.length))); TC.focus=f;}
  }
  TC.list=pick.slice(0,10).map(w=>w.id); TC.i=0; TC.res=null; TC.err=''; TC.done=0; TC.right=0; TC.total=0;
  tcState(); TC.state=S.vp.n<300?'cal':'ask';        /* first time: hear a sentence, to learn this voice's range */
  drillMode='tcoach'; dq=null; go('drill');
}
function tcRelease(){
  clearTimeout(TC.timer);
  try{if(TC.rec&&TC.rec.state!=='inactive')TC.rec.stop();}catch(e){}
  try{if(TC.stream)TC.stream.getTracks().forEach(t=>t.stop());}catch(e){}
  TC.stream=null; TC.rec=null;
}
const TC_CAL='大家好，我現在在臺灣學中文。我每天都練習聽、說、讀、寫。';
async function tcCalDone(blob){
  TC.busy=true; TC.state='think'; tcRender();
  try{
    const a=await tcDecode(await blob.arrayBuffer()), tr=tcTrack(a.x,a.sr), quiet=tcLoud(tr)<TC_QUIET;
    if(!quiet){tcLearn(tr.voiced); save();}
    if(quiet){TC.state='cal';TC.err='That was very quiet — hold the microphone closer and read it again.';}
    else if(S.vp.n>=300){TC.state='ask';TC.err='';toast('Got it — the coach now knows your voice range');}
    else{TC.state='cal';TC.err='I need a little more of your voice — read the whole sentence at a normal pace.';}
  }catch(e){TC.state='cal';TC.err='That recording could not be read. Try again.';}
  TC.busy=false; tcRender();
}
async function tcRecord(){
  if(TC.state==='rec'){tcStopRec();return;}
  const cal=TC.state==='cal', w=tcItem(TC.list[TC.i]); if(!w||TC.busy)return;
  try{ if(!TC.stream)TC.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}}); }
  catch(e){ TC.err='The microphone is blocked. Allow it for this site, then try again.'; tcRender(); return; }
  const chunks=[], rec=new MediaRecorder(TC.stream); TC.rec=rec; TC.err='';
  rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  rec.onstop=()=>{ if(TC.rec!==rec)return; const b=new Blob(chunks,{type:rec.mimeType||'audio/webm'}); if(cal)tcCalDone(b); else tcGrade(b); };
  rec.start(); TC.state='rec'; TC.cal=cal; tcRender();
  TC.timer=setTimeout(tcStopRec,cal?12000:1400+700*[...audioKey(w.t)].length);
}
function tcStopRec(){ clearTimeout(TC.timer); try{if(TC.rec&&TC.rec.state!=='inactive')TC.rec.stop();}catch(e){} }
/* grade one take. `input` is the recording (a Blob), or already-decoded audio {x, sr} */
async function tcGrade(input){
  const wid=TC.list[TC.i], w=tcItem(wid); if(!w)return;
  TC.busy=true; TC.state='think'; tcRender();
  try{
    const mine=input.x?input:await tcDecode(await input.arrayBuffer());
    if(TC.url)URL.revokeObjectURL(TC.url); TC.url=input.x?null:URL.createObjectURL(input);
    const want=tcExpected(w.p), n=want.length, written=toneSeq(w.p);
    const tr=tcTrack(mine.x,mine.sr);
    if(tr.voiced.length>=6&&tcLoud(tr)<TC_QUIET){ TC.err='That take was very quiet — hold the microphone closer, or speak up a little.'; TC.state='ask'; TC.busy=false; tcRender(); return; }
    const rough=tcAnalyse(null,0,n,null,tr);
    if(!rough||rough.syl.length!==n||rough.syl.some(s=>!s)){ TC.err=rough?'I could not find '+n+' clear syllable'+(n>1?'s':'')+' in that take — say it a little slower and closer to the microphone.':'I could not hear a voice in that take. Check the microphone and try again.'; TC.state='ask'; TC.busy=false; tcRender(); return; }
    const me=tcUserStats(rough.med), got=tcAnalyse(null,0,n,me,rough.tr);
    let ref=null; const clip=await tcClip(audioKey(w.t)); if(clip){const ns=await tcNativeStats(); ref=tcAnalyse(clip.x,clip.sr,n,ns);}
    const T=tcState(); let right=0, graded=0;
    const syl=got.syl.map((s,i)=>{const e=want[i]; if(!e)return {e:0,ok:null,s};
      const v=tcJudge(s,e), ok=v==='ok', close=v==='close'; graded++; if(ok)right++;
      T.by[e]=T.by[e]||[0,0]; T.by[e][1]++; if(ok)T.by[e][0]++; else {const k=e+'>'+s.tone;T.conf[k]=(T.conf[k]||0)+1;}
      return {e,ok,close,s,wr:written[i]};});
    if(n===2&&graded===2){const pr=T.pair[''+want[0]+want[1]]||[0,0]; pr[1]++; if(right===2)pr[0]++; T.pair[''+want[0]+want[1]]=pr;}
    T.n++; if(!w.phr){const rec=T.w[wid]||[0,0]; rec[0]++; rec[1]=Math.max(rec[1],Math.round(right/Math.max(1,graded)*100)); T.w[wid]=rec;}
    tcLearn(got.voiced);
    TC.res={syl,ref,right,graded,learning:!!me.learning}; TC.state='done'; TC.err=''; TC.total+=graded; TC.right+=right;
    haptic(right===graded?'good':'again'); save();
  }catch(e){ TC.err='That recording could not be read. Try again.'; TC.state='ask'; }
  TC.busy=false; tcRender();
}
function tcNext(){ TC.i++; TC.state='ask'; TC.res=null; TC.err=''; TC.done++; tcRender(); }
function tcAgain(){ TC.state='ask'; TC.res=null; TC.err=''; tcRender(); }
function tcPlayMine(){ if(TC.url)new Audio(TC.url).play().catch(()=>{}); }
/* two pitch curves per syllable: the native speaker's in grey, yours in colour, each drawn against its own voice's range */
function tcChart(res,chars){
  const n=res.syl.length, W=118, H=104, y=z=>Math.max(8,Math.min(H-8,H/2-z*(H/2-10)/2.6));
  const line=(pts,x0)=>pts.map((z,i)=>(i?'L':'M')+(x0+14+i*(W-28)/15).toFixed(1)+','+y(z).toFixed(1)).join('');
  let g='';
  for(let i=0;i<n;i++){
    const x0=i*W, s=res.syl[i], r=res.ref&&res.ref.syl[i];
    g+=`<rect x="${x0+3}" y="3" width="${W-6}" height="${H-6}" rx="10" class="tc-cell"/>`
      +`<line x1="${x0+10}" x2="${x0+W-10}" y1="${H/2}" y2="${H/2}" class="tc-mid"/>`
      +(r?`<path d="${line(r.z,x0)}" class="tc-ref"/>`:'')
      +`<path d="${line(s.s.z,x0)}" class="tc-me ${s.ok===null?'na':s.ok?'ok':s.close?'close':'no'}"/>`;
  }
  return `<svg class="tc-chart" viewBox="0 0 ${n*W} ${H}" style="max-width:${n*132}px" role="img" aria-label="pitch curves, yours against the native speaker">${g}</svg>`;
}
function tcRender(){
  const el=document.getElementById(TC.host||'vDrill'); if(!el||(!TC.host&&drillMode!=='tcoach'))return;
  if(TC.i>=TC.list.length){
    if(TC.host){tcQuickClose();return;}
    tcRelease();
    el.innerHTML=`<div class="card done"><div class="zhd zh">練完了</div><div style="font-weight:600;font-size:16px">${TC.total?Math.round(TC.right/TC.total*100):0}% of tones on target · ${TC.list.length} ${TC.kind==='phr'?'phrases':'words'}</div>
      <div class="small muted" style="margin-top:10px">${tcSummary()}</div>
      <div class="row" style="justify-content:center;gap:8px;margin-top:16px"><button class="btn" onclick="tcStart(${TC.kind==='phr'?"'phr'":''})">Another ten</button>${TC.kind==='phr'?'':`<button class="btn ghost" onclick="tcStart('phr')">Short phrases</button>`}<button class="btn ghost" onclick="drillMode=null;renderDrill()">Back to drills</button></div></div>`;
    return;
  }
  const w=tcItem(TC.list[TC.i]), chars=[...audioKey(w.t)], want=tcExpected(w.p), res=TC.res, st=TC.state;
  const head=TC.host?'':`<div class="rev-top"><span class="qtype">聲調教練 · Tone coach${TC.kind==='phr'?' · phrases':''} <span class="tc-beta">beta</span></span><span class="qprog">${TC.i+1} / ${TC.list.length}</span></div>`;
  if(st==='cal'||(TC.cal&&(st==='rec'||st==='think'))){
    el.innerHTML=head+`<div class="stage" style="min-height:300px"><div class="hint">first, let the coach hear your voice</div>
      <div class="zh" style="font-size:22px;line-height:1.7;margin:10px 0 6px">${esc(TC_CAL)}</div>
      <div class="small muted">Read it aloud at your normal pace. From this the coach learns how high and low your voice goes, so every tone is judged against your own range. It keeps learning with each recording.</div>
      ${TC.err?`<div class="tc-err">${esc(TC.err)}</div>`:''}
      <div class="row" style="justify-content:center;margin-top:16px"><button class="btn tc-rec ${st==='rec'?'on':''}" onclick="tcRecord()" ${st==='think'?'disabled':''}>${st==='rec'?'■ Stop':st==='think'?'Listening…':'● Record'}</button></div>
      <div class="small muted" style="text-align:center;margin-top:10px">${st==='rec'?'recording — press Stop when you finish':'<span class="link" onclick="TC.state=\'ask\';TC.cal=false;tcRender()">skip for now</span>'}</div></div>`;
    return;
  }
  const shown=st==='done'&&res;        /* the result is the tall state: the word shrinks to make room for it */
  const word=`<div class="bigzh zh" style="font-size:${shown?38:54}px${shown?';margin:0 0 2px':''}">${esc(w.t.split('（')[0])}</div>
    <div class="row" style="justify-content:center;gap:9px"><span class="pyline" style="font-size:${shown?19:23}px">${tonePinyin(esc(w.p))}</span>${w.phr?`<button class="spk" title="pronounce" onclick="tcSay()">${SPK_SVG}</button>`:spkBtn(w.id)}</div>
    ${shown?'':`<div class="meaning" style="font-size:15px;margin-top:2px">${esc(w.m)}</div>`}`;
  let body;
  if(st==='done'&&res){
    const cls=s=>s.ok===null?'na':s.ok?'ok':s.close?'close':'no';
    const lines=res.syl.map((s,i)=>s.ok===null?'':s.ok?'':`<div><b class="zh">${esc(chars[i])}</b> ${s.close?'was close, but leaned towards':'sounded like'} tone ${s.s.tone} (${TC_NAME[s.s.tone]}). <span class="tc-tip">${TC_TIP[''+s.e+s.s.tone]||''}</span></div>`).join('');
    body=`${tcChart(res,chars)}
      <div class="tc-chips">${res.syl.map((s,i)=>`<span class="tc-chip ${cls(s)}"><b class="zh">${esc(chars[i])}</b><i>${s.e?'tone '+s.e+(s.wr&&s.wr!==s.e?' (written '+s.wr+')':''):'neutral'}</i>${s.ok===null?'':s.ok?'✓':s.close?'≈':'✗'}</span>`).join('')}</div>
      <div class="tc-say">${res.right===res.graded?'Every tone on target.':lines}</div>
      <div class="tc-key">grey = the native speaker · colour = you${res.learning?' · still learning your voice range, so these first grades are rough':''}</div>
      <div class="tc-acts">${TC.url?`<button class="btn ghost sm" onclick="tcPlayMine()">▶ Mine</button>`:''}<button class="btn ghost sm" onclick="tcSay()">▶ Native</button><button class="btn ghost sm" onclick="tcAgain()">Again</button><button class="btn sm" onclick="tcNext()">${TC.host?'Done':'Next →'}</button></div>
      <div class="small muted kbh" style="text-align:center;margin-top:8px"><kbd>enter</kbd> ${TC.host?'done':'next'} · <kbd>A</kbd> again · <kbd>L</kbd> listen</div>`;
  }else{
    body=`<div class="hint" style="margin-top:10px">listen · then record yourself saying it${w.phr?' · the system voice reads phrases':''}</div>
      ${TC.focus&&TC.i===0?`<div class="small muted" style="text-align:center;margin-top:6px">${TC.focus.manual?`This round: ten words of ${tcFocusName(TC.focus)}.`:`This round leans on ${tcFocusName(TC.focus)} — your hardest so far.`}</div>`:''}
      ${TC.err?`<div class="tc-err">${esc(TC.err)}</div>`:''}
      <div class="row" style="justify-content:center;gap:10px;margin-top:14px"><button class="btn ghost" onclick="tcSay()">▶ Listen</button>
        <button class="btn tc-rec ${st==='rec'?'on':''}" onclick="tcRecord()" ${st==='think'?'disabled':''}>${st==='rec'?'■ Stop':st==='think'?'Listening…':'● Record'}</button></div>
      <div class="small muted" style="text-align:center;margin-top:10px">${st==='rec'?'recording — it stops by itself':TC.host?'':'<span class="link" onclick="tcNext()">skip this '+(w.phr?'phrase':'word')+'</span>'}</div>
      <div class="small muted kbh" style="text-align:center;margin-top:8px"><kbd>space</kbd> record · <kbd>L</kbd> listen</div>`;
  }
  el.innerHTML=head+`<div class="stage" style="min-height:300px">${word}${body}</div>`;
}
/* what the recordings so far say about your tones */
function tcSummary(){
  const T=tcState(), rows=[1,2,3,4].filter(t=>T.by[t]&&T.by[t][1]).map(t=>({t,ok:T.by[t][0],n:T.by[t][1]}));
  if(!rows.length)return 'No recordings yet.';
  const worst=Object.entries(T.conf).sort((a,b)=>b[1]-a[1])[0], f=tcFocus();
  return rows.map(r=>`tone ${r.t}: <b>${Math.round(r.ok/r.n*100)}%</b> of ${r.n}`).join(' · ')
    +(worst&&worst[1]>=3?`<br>Most often, your tone ${worst[0][0]} comes out as tone ${worst[0][2]} (${TC_NAME[worst[0][2]]} instead of ${TC_NAME[worst[0][0]]}).`:'')
    +(f?`<br>The next round leans on ${tcFocusName(f)} (${Math.round(f.r*100)}% of ${f.n} so far).`:'');
}
/* the sixteen two-syllable tone pairs as a 4 × 4 map: how often each came out right, and a tap to practise it.
   3 + 3 has no cell of its own: sandhi makes it 2 + 3, and it is counted there. */
function tcPairMap(){
  const T=tcState(); let h='<div class="tc-map"><span></span>'+[1,2,3,4].map(b=>`<span class="tc-mh">+ tone ${b}</span>`).join('');
  for(const a of [1,2,3,4]){
    h+=`<span class="tc-mh">tone ${a}</span>`;
    for(const b of [1,2,3,4]){
      const k=''+a+b, p=T.pair[k], r=p&&p[1]?p[0]/p[1]:null;
      h+=k==='33'?'<span class="tc-mc na">said as 2 + 3</span>'
        :`<button class="tc-mc ${r===null?'':r>=0.8?'ok':r>=0.5?'mid':'no'}" onclick="tcStart('${k}')" aria-label="practise tone ${a} + tone ${b}">${r===null?'–':Math.round(r*100)+'%'}<i>${p&&p[1]?p[1]+(p[1]===1?' try':' tries'):'not tried'}</i></button>`;
    }
  }
  return h+'</div>';
}
function tcPanel(){
  const T=tcState();
  return `<div class="card"><div class="lab">Your tones${T.n?` · ${T.n} recordings`:''}</div>
    <div class="small muted">${T.n?tcSummary():'Record a few words in the tone coach and this fills in.'}</div>
    <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn sm" onclick="startDrill('tcoach')">Ten words</button><button class="btn sm ghost" onclick="tcStart('phr')">Ten short phrases</button></div>
    <div class="small muted" style="margin-top:12px">Two-syllable words by tone pair — the first tone down the side, the second across. Tap a pair to practise ten words of it.</div>${tcPairMap()}</div>`;
}
