/* The Brain: every word and character as a tile by how well it is known, the time-lapse of the deck, word types,
   and phonetic series. */

/* ============ TIME-LAPSE SNAPSHOTS ============ */
function stageString(){return WORDS.map(w=>wordStage(w.id)).join('');}
/* `quiet` is for the entry start-up adds by itself: it is stored on this device without the cloud push, so that
   merely opening the app never makes a device look as if it held unsent work */
function takeSnapshot(quiet){
  const write=quiet?saveLocal:save;
  try{
    if(!S.hist)S.hist={d:[],s:[]};
    const today=dkey(new Date()), s=stageString();
    const n=S.hist.d.length;
    if(n&&S.hist.d[n-1]===today){if(S.hist.s[n-1]!==s){S.hist.s[n-1]=s;write();}return;}
    S.hist.d.push(today);S.hist.s.push(s);
    if(S.hist.d.length>180){S.hist.d.shift();S.hist.s.shift();}
    write();
  }catch(e){}
}

/* ---- BRAIN ---- */
let brainView='chars', brainGroup='stage', brainSel=null, brainTime=null, brainScope=1;
const STAGE_NAMES=['Not started','Learning','Young','Solid','Mastered'];
const STAGE_DESC=['not yet studied','in short-step drilling (first days)','memory holds < 3 weeks','memory holds 3–6 weeks','memory holds 6+ weeks'];
function wordCards(wid){return MODES.filter(m=>S.settings.modes[m]).map(m=>S.cards[cardId(wid,m)]).filter(Boolean);}
function wordStage(wid){
  const cards=wordCards(wid); if(!cards.length)return 0;
  const started=cards.filter(c=>c.st!==undefined);
  if(!started.length)return 0;
  if(started.length<cards.length||started.some(c=>c.st==='learn'||c.st==='relearn'))return 1;
  const minS=Math.min(...started.map(c=>c.S));
  if(minS<7)return 1; if(minS<21)return 2; if(minS<MASTER_S)return 3; return 4;
}
function wordMem(wid){ // current recall probability (weakest card)
  const started=wordCards(wid).filter(c=>c.st!==undefined&&c.st==='rev');
  if(!started.length)return null;
  return Math.min(...started.map(c=>retrievability(Math.max(0.01,(Date.now()-c.last)/DAY),c.S)));
}
function wordDueNow(wid){return wordCards(wid).some(c=>c.st!==undefined&&c.due<=Date.now());}
function wordMastAt(wid){
  const cards=wordCards(wid); if(!cards.length)return null;
  if(!cards.every(c=>c.mastAt))return null;
  return Math.max(...cards.map(c=>c.mastAt));
}
function studyWords(){
  const ws=WORDS.filter(w=>!isName(w)||S.settings.includeNames);
  return (brainCat&&renderBrain._in)?ws.filter(w=>wordCat(w)===brainCat):ws;   /* inside the Brain, a chosen word type narrows everything */
}
function posGroup(w){
  if(isName(w))return 'Names';
  const p=w.pos;
  if(!p)return 'Proper nouns';
  if(/^Vs/.test(p))return 'Adjectives 形';
  if(/^V/.test(p))return 'Verbs 動';
  if(p==='N')return 'Nouns 名';
  if(p==='Adv')return 'Adverbs 副';
  if(p==='M')return 'Measure words 量';
  if(p==='Ptc')return 'Particles 助';
  if(p==='Det')return 'Determiners';
  if(p==='Prep')return 'Prepositions';
  if(p==='Conj')return 'Conjunctions';
  if(p==='Ph')return 'Phrases 語';
  return 'Other';
}
function fmtAgo(ts){const d=Math.floor((Date.now()-ts)/DAY);return d<=0?'today':d===1?'1d ago':d+'d ago';}
function fmtDueIn(c){
  if(!c||c.st===undefined)return 'not started';
  const ms=c.due-Date.now();
  if(ms<=0)return 'due now';
  if(ms<DAY)return 'due in '+Math.max(1,Math.round(ms/3600000))+'h';
  return 'due in '+Math.round(ms/DAY)+'d';
}
function stageCounts(items){const c=[0,0,0,0,0];items.forEach(i=>c[i.stage!==undefined?i.stage:wordStage(i.id)]++);return c;}
function tileTitle(label,stage,mem,due){
  let t=label+' · '+STAGE_NAMES[stage];
  if(mem!==null&&mem!==undefined)t+=' · memory now '+Math.round(mem*100)+'%';
  if(due)t+=' · due for review';
  return t;
}
function tlChart(){
  const H=S.hist,n=H.d.length; if(n<2)return '';
  const Wd=640,Hh=88;
  let maxTot=1; const layers=[];
  for(let i=0;i<n;i++){
    const c=[0,0,0,0,0];
    for(const d of H.s[i])c[+d]++;
    layers.push(c);
    maxTot=Math.max(maxTot,c[1]+c[2]+c[3]+c[4]);
  }
  const x=i=>n===1?0:i/(n-1)*Wd;
  const y=v=>Hh-4-(v/maxTot)*(Hh-10);
  // stack bottom→top: mastered, solid, young, learning
  const order=[4,3,2,1];
  const cum=layers.map(c=>{let a=0;const m={};order.forEach(st=>{a+=c[st];m[st]=a;});return m;});
  let polys='';
  order.forEach((st,k)=>{
    let top='',bot='';
    for(let i=0;i<n;i++)top+=(i?' ':'')+x(i).toFixed(1)+','+y(cum[i][st]).toFixed(1);
    for(let i=n-1;i>=0;i--)bot+=' '+x(i).toFixed(1)+','+(k===0?Hh-4:y(cum[i][order[k-1]])).toFixed(1);
    const cls='s'+st;
    const col=cssVar('--s'+st+'bg')||{4:'#0b5d54',3:'#2f9184',2:'#7fbfb3',1:'#dcebe7'}[st];
    polys+='<polygon points="'+top+bot+'" fill="'+col+'"><title>'+STAGE_NAMES[st]+'</title></polygon>';
  });
  return '<svg class="tl-chart" viewBox="0 0 '+Wd+' '+Hh+'" preserveAspectRatio="none">'+polys+'</svg>';
}
function renderBrain(){
  renderBrain._in=true;try{
  const el=document.getElementById('vBrain');
  takeSnapshot();
  const nSnap=S.hist.d.length;
  const past=brainTime!==null&&nSnap&&brainTime<nSnap-1;
  const snap=past?S.hist.s[brainTime]:null;
  let chars=charModel().sort((a,b)=>a.lesson-b.lesson||a.stage-b.stage);
  let words=studyWords().map(w=>({...w,stage:wordStage(w.id),due:wordDueNow(w.id),mem:wordMem(w.id),mastAt:wordMastAt(w.id)}));
  if(brainScope!=='all'){
    const [lo,hi]=bookRange(brainScope);
    words=words.filter(w=>w.l>=lo&&w.l<=hi);
    chars=chars.filter(c=>c.lesson>=lo&&c.lesson<=hi);
  }
  if(past){
    const idx={};WORDS.forEach((w,i)=>idx[w.id]=i);
    words=words.map(w=>({...w,stage:+(snap[idx[w.id]]||0),due:false,mem:null,mastAt:null}));
    const ws={};words.forEach(w=>ws[w.id]=w.stage);
    chars=chars.map(c=>({...c,stage:Math.max(0,...c.words.map(wid=>ws[wid]||0)),due:false,mem:null}));
  }
  const isChars=brainView==='chars';
  const items=isChars?chars:words;
  const counts=stageCounts(isChars?chars:words.map(w=>({stage:w.stage})));
  const total=items.length, mastered=counts[4];
  // ----- hero + stacked stage bar -----
  const totalSeen=total-counts[0];
  const segs=counts.map((n,i)=>({n,i})).filter(s=>s.n>0);
  const barHtml='<div class="stagebar">'+segs.map(s=>{
    const pct=s.n/total*100;
    return '<i class="s'+s.i+'" style="flex:'+s.n+'" title="'+STAGE_NAMES[s.i]+': '+s.n+'">'+(pct>7?s.n:'')+'</i>';
  }).join('')+'</div>'
  +'<div class="legend">'+counts.map((n,i)=>'<span><span class="sw s'+i+'"></span>'+STAGE_NAMES[i]+' · '+n+'</span>').join('')
  +'<span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--red);margin-right:5px;vertical-align:1px"></span>due now</span></div>';
  // ----- mastered ticker -----
  const masteredWords=words.filter(w=>w.mastAt).sort((a,b)=>b.mastAt-a.mastAt);
  const tickerHtml=masteredWords.length
    ? '<div class="ticker">'+masteredWords.slice(0,30).map(w=>'<div class="tchip" onclick="brainSel={type:\'word\',id:\''+w.id+'\'};renderBrain()"><span class="c zh">'+esc(w.t)+'</span><span class="d">'+fmtAgo(w.mastAt)+'</span></div>').join('')+'</div>'
    : '<div class="small muted">Nothing mastered yet — a word joins this shelf once both its cards hold for '+MASTER_S+'+ days. Keep reviewing; the first ones usually land after a few weeks.</div>';
  // ----- controls -----
  const groups=isChars?[['stage','Stage'],['lesson','Lesson'],['simp','Trad ≠ Simp']]:[['stage','Stage'],['lesson','Lesson'],['pos','Word type'],['tone','Tone']];
  if(!groups.some(g=>g[0]===brainGroup))brainGroup='stage';
  const ctrlHtml='<div class="segbar"><span class="cap">Scope</span>'
    +BOOKS.map(b=>[b.n,'Book '+b.n]).concat([['all','Everything']]).map(v=>'<button class="'+(brainScope===v[0]?'on':'')+'" onclick="brainScope='+(typeof v[0]==='string'?'\'all\'':v[0])+';brainSel=null;renderBrain()">'+v[1]+'</button>').join('')
    +'</div><div class="segbar"><span class="cap">View</span>'
    +[['chars','Characters'],['words','Words']].map(v=>'<button class="'+(brainView===v[0]?'on':'')+'" onclick="brainView=\''+v[0]+'\';brainSel=null;renderBrain()">'+v[1]+'</button>').join('')
    +'</div><div class="segbar"><span class="cap">Group</span>'
    +groups.map(g=>'<button class="'+(brainGroup===g[0]?'on':'')+'" onclick="brainGroup=\''+g[0]+'\';renderBrain()">'+g[1]+'</button>').join('')+'</div>';
  // ----- detail panel -----
  let detailHtml='';
  if(brainSel){
    if(brainSel.type==='char'){
      const e=chars.find(c=>c.ch===brainSel.id);
      if(e){
        const mem=e.mem!==null?Math.round(e.mem*100):null;
        detailHtml='<div class="detail"><div><div class="big zh">'+esc(e.ch)+'</div><div style="text-align:center;margin-top:6px"><button class="spk" title="pronounce" onclick="speakText(\''+esc(e.ch)+'\')">'+SPK_SVG+'</button></div></div>'
        +'<div id="bdStrokes" class="strokerow" style="align-self:center"></div><div class="body">'
        +'<div class="row" style="gap:8px"><span class="tag '+(e.stage>=3?'mat':e.stage>0?'ok':'')+'">'+STAGE_NAMES[e.stage]+'</span>'
        +(SIMP_CHAR[e.ch]?'<span class="tag simp">简 '+esc(SIMP_CHAR[e.ch])+'</span>':'<span class="tag">same in simplified</span>')
        +(e.due?'<span class="tag due">due now</span>':'')+'</div>'
        +(mem!==null?'<div class="kv"><span>memory right now <b>'+mem+'%</b></span><span>first met in <b>'+(typeof e.lesson==='number'?lnLabel(e.lesson):e.lesson)+'</b></span></div><div class="membar"><i style="width:'+mem+'%"></i></div>':'<div class="kv"><span>first appears in <b>Lesson '+e.lesson+'</b></span></div>')
        +'<div style="margin-top:10px">'+e.words.map(wid=>{const w=byId[wid];return '<span class="wchip zh" onclick="brainSel={type:\'word\',id:\''+wid+'\'};renderBrain()">'+esc(w.t)+' <span class="muted">'+esc(w.p)+'</span></span>';}).join('')+'</div>'
        +charStoryHtml(e.ch)
        +'</div><button class="close" onclick="brainSel=null;renderBrain()">✕</button></div>';
      }
    } else {
      const w=words.find(x=>x.id===brainSel.id);
      if(w){
        const mem=w.mem!==null?Math.round(w.mem*100):null;
        const cardLine=MODES.filter(m=>S.settings.modes[m]).map(m=>{
          const c=S.cards[cardId(w.id,m)];
          const nm=m==='rec'?'Recognize':'Recall';
          if(!c)return '<span>'+nm+' <b>—</b></span>';
          if(c.st===undefined)return '<span>'+nm+' <b>queued</b></span>';
          return '<span>'+nm+' <b>'+(c.S<1?'<1':Math.round(c.S))+'d hold</b> · '+fmtDueIn(c)+'</span>';
        }).join('');
        detailHtml='<div class="detail"><div class="big zh">'+esc(w.t)+'</div><div class="body">'
        +'<div class="row" style="gap:8px"><span class="pyline" style="font-size:18px">'+tonePinyin(esc(w.p))+'</span>'+spkBtn(w.id)+'</div>'
        +'<div class="small" style="margin-top:2px">'+esc(w.m)+'</div>'
        +'<div class="row" style="gap:8px;margin-top:8px"><span class="tag '+(w.stage>=3?'mat':w.stage>0?'ok':'')+'">'+STAGE_NAMES[w.stage]+'</span>'
        +(w.s?'<span class="tag simp">简 '+esc(w.s)+'</span>':'')
        +(w.mastAt?'<span class="tag known">mastered '+fmtAgo(w.mastAt)+'</span>':'')+'</div>'
        +'<div class="kv">'+cardLine+(mem!==null?'<span>memory now <b>'+mem+'%</b></span>':'')+'</div>'
        +(mem!==null?'<div class="membar"><i style="width:'+mem+'%"></i></div>':'')
        +(window.usBlock?usBlock(w,true):'')
        +'</div><button class="close" onclick="brainSel=null;renderBrain()">✕</button></div>';
      }
    }
  }
  // ----- grouped walls -----
  function tile(it){
    if(isChars){
      const sel=brainSel&&brainSel.type==='char'&&brainSel.id===it.ch;
      return '<div class="tile zh s'+it.stage+(sel?' sel':'')+'" title="'+esc(tileTitle(it.ch,it.stage,it.mem,it.due))+'" onclick="brainSel={type:\'char\',id:\''+it.ch+'\'};renderBrain()">'+esc(it.ch)+(it.due?'<span class="dot"></span>':'')+'</div>';
    }
    const sel=brainSel&&brainSel.type==='word'&&brainSel.id===it.id;
    return '<div class="tile zh s'+it.stage+(sel?' sel':'')+'" title="'+esc(tileTitle(it.t+' '+it.p,it.stage,it.mem,it.due))+'" onclick="brainSel={type:\'word\',id:\''+it.id+'\'};renderBrain()">'+esc(it.t)+(it.due?'<span class="dot"></span>':'')+'</div>';
  }
  function wall(list){return '<div class="wall'+(isChars?'':' words')+'">'+list.map(tile).join('')+'</div>';}
  let groupsHtml='';
  const grpHdr=(name,list,note)=>'<div class="grp"><span>'+name+(note?' <span class="gn">· '+note+'</span>':'')+'</span><span class="gn">'+list.length+'</span></div>';
  if(brainGroup==='stage'){
    [4,3,2,1,0].forEach(st=>{
      const list=items.filter(i=>i.stage===st);
      if(!list.length)return;
      groupsHtml+=grpHdr(STAGE_NAMES[st],list,STAGE_DESC[st])+wall(list);
    });
  } else if(brainGroup==='lesson'){
    for(let ln=1;ln<=MAX_LN;ln++){
      const list=isChars?items.filter(i=>i.lesson===ln):items.filter(i=>i.l===ln);
      if(!list.length)continue;
      groupsHtml+=grpHdr(lnLabel(ln),list,LESSON_TITLES[ln])+wall(list);
    }
  } else if(brainGroup==='simp'){
    const diff=items.filter(i=>SIMP_CHAR[i.ch]), same=items.filter(i=>!SIMP_CHAR[i.ch]);
    groupsHtml+=grpHdr('Different in simplified',diff,'your ongoing trad list')+wall(diff)+grpHdr('Same in both scripts',same,'')+wall(same);
  } else if(brainGroup==='pos'){
    const order=['Nouns 名','Verbs 動','Adjectives 形','Adverbs 副','Measure words 量','Particles 助','Phrases 語','Determiners','Prepositions','Conjunctions','Proper nouns','Names','Other'];
    const bins={}; items.forEach(w=>{const g=posGroup(w);(bins[g]=bins[g]||[]).push(w);});
    order.forEach(g=>{if(bins[g])groupsHtml+=grpHdr(g,bins[g],'')+wall(bins[g]);});
  } else if(brainGroup==='tone'){
    const names={1:'1st tone ˉ',2:'2nd tone ˊ',3:'3rd tone ˇ',4:'4th tone ˋ',0:'Neutral / other'};
    [1,2,3,4,0].forEach(t=>{
      const list=items.filter(w=>firstTone(w.p)===t);
      if(!list.length)return;
      groupsHtml+=grpHdr(names[t],list,'by first syllable')+wall(list);
    });
  }
  // ----- time-lapse card -----
  const chart=tlChart();
  const scrubVal=past?brainTime:nSnap-1;
  const tlHtml=`<div class="card"><div class="lab">Time-lapse</div>
    ${chart||'<div class="small muted">Recording started today — from now on the app snapshots your brain daily, and this becomes a scrubbable film of the wall filling in over the semester.</div>'}
    ${nSnap>=2?`<input type="range" class="tl-scrub" min="0" max="${nSnap-1}" value="${scrubVal}" onchange="brainTime=(+this.value===S.hist.d.length-1)?null:+this.value;renderBrain()">
    <div class="tl-cap"><span>${S.hist.d[0]}</span><span>${S.hist.d[nSnap-1]}</span></div>`:''}
    ${past?`<div class="tl-banner"><span>Viewing your brain on ${S.hist.d[brainTime]}</span><span class="link" onclick="brainTime=null;renderBrain()">back to today →</span></div>`:''}
  </div>`;
  el.innerHTML=`
  <div class="card">
    <div class="hero-row">
      <div class="hero-big"><div class="n">${mastered}<span class="of"> / ${total}</span></div><div class="l">${isChars?'characters':'words'} mastered${past?' · '+S.hist.d[brainTime]:''}</div></div>
      <div class="hero-sub">${totalSeen} ${isChars?'characters':'words'} in your head so far · a ${isChars?'character':'word'} counts as mastered once every card holds ${MASTER_S}+ days</div>
    </div>
    ${barHtml}
  </div>
  ${tlHtml}
  <div class="card"><div class="lab">Mastered shelf · newest first</div>${tickerHtml}</div>
  <div class="card">
    ${ctrlHtml}
    ${detailHtml}
    ${groupsHtml}
    <div class="small muted" style="margin-top:16px">Deeper teal = stronger memory. Tap any tile for its story — red dot means it's waiting in your review queue.</div>
  </div>`;
  if(brainSel&&brainSel.type==='char'&&S.settings.strokeAnim)renderStrokes('bdStrokes',brainSel.id,{});
  }finally{renderBrain._in=false;}
  try{const el=document.getElementById('vBrain'); const first=el.querySelector('.card'); if(first)first.insertAdjacentHTML('afterend',catPanel()); ringArm(el);
    if(brainCat){const c=WCATS.find(x=>x[0]===brainCat); const h=el.querySelector('.segbar'); if(h&&c)h.insertAdjacentHTML('beforebegin',`<div class="catnote">Showing <b>${esc(c[1])}</b> ${c[2]} only</div>`);}
  }catch(e){}
  try{const el=document.getElementById('vBrain');const cards=el.querySelectorAll(':scope > .card');const anchor=cards[1]||cards[0];if(anchor)anchor.insertAdjacentHTML('afterend',phoneticPanel());}catch(e){}
  try{const d=document.querySelector('#vBrain .detail .body');if(d&&brainSel&&!d.querySelector('.lookup')){const t=brainSel.type==='word'?(byId[brainSel.id]||{}).t:brainSel.id;if(t)d.insertAdjacentHTML('beforeend',lookupRow(t));}}catch(e){}
}

/* ---- Brain: word-type categories ---- */
const WCATS=[
  ['noun','Nouns','名詞',p=>p==='N'],
  ['verb','Action verbs','動作動詞',p=>/^(V|Vi|V-sep|Vpt)$/.test(p)],
  ['state','State verbs · adjectives','狀態動詞',p=>/^Vs/.test(p)||p==='Vst'],
  ['proc','Process verbs','變化動詞',p=>/^Vp/.test(p)],
  ['aux','Auxiliary verbs','助動詞',p=>p==='Vaux'],
  ['adv','Adverbs','副詞',p=>p==='Adv'],
  ['m','Measure words','量詞',p=>p==='M'],
  ['ptc','Particles','助詞',p=>p==='Ptc'],
  ['prep','Prepositions','介詞',p=>p==='Prep'],
  ['conj','Conjunctions','連詞',p=>p==='Conj'],
  ['det','Determiners','限定詞',p=>p==='Det'],
  ['ph','Phrases','短語',p=>p==='Ph'],
  ['name','Names & places','專有名詞',p=>true]];
function wordCat(w){ if(isName(w)||!w.pos)return 'name'; for(const c of WCATS){if(c[3](w.pos))return c[0];} return 'name'; }
let brainCat=null;
function catPanel(){
  const [lo,hi]=brainScope==='all'?[1,MAX_LN]:bookRange(brainScope);
  const ws=WORDS.filter(w=>(!isName(w)||S.settings.includeNames)&&w.l>=lo&&w.l<=hi);
  const bins={}; ws.forEach(w=>{const k=wordCat(w);(bins[k]=bins[k]||[]).push(w);});
  const tiles=WCATS.filter(c=>bins[c[0]]).map(c=>{
    const list=bins[c[0]]; let known=0,learn=0;
    list.forEach(w=>{const st=wordStage(w.id); if(st>=3)known++; else if(st>=1)learn++;});
    const m={n:list.length,frac:known/list.length,lfrac:(known+learn)/list.length};
    const on=brainCat===c[0];
    return `<div class="ctile ${on?'on':''} ${known?'':'none'}" onclick="brainCat=brainCat==='${c[0]}'?null:'${c[0]}';brainSel=null;renderBrain()">
      ${ring2(m,46,5)}<div class="ct-b"><b>${esc(c[1])}</b><span class="zh">${c[2]}</span><span class="ct-n">${known}<i>/${list.length}</i></span></div></div>`;
  }).join('');
  return `<div class="card"><div class="row spread" style="margin-bottom:10px"><div class="lab" style="margin:0">By word type${brainCat?' · <span class="link" onclick="brainCat=null;brainSel=null;renderBrain()">show all</span>':''}</div><div class="small muted">tap a type to focus the walls on it</div></div>
    <div class="cgrid">${tiles}</div></div>`;
}

/* ---- 7. Phonetic series (Brain) ---- */
function phoneticPanel(){
  const csm=charStageMap(); const met=new Set(Object.keys(csm));
  const series={}; BCHARS.forEach(ch=>{const c=COMPONENTS[ch];if(c&&c.ph)(series[c.ph]=series[c.ph]||[]).push(ch);});
  const rows=Object.entries(series).map(([ph,chs])=>({ph,chs,met:chs.filter(c=>met.has(c)).length})).filter(r=>r.chs.length>=2&&r.met>=1).sort((a,b)=>b.met-a.met||b.chs.length-a.chs.length).slice(0,24);
  if(!rows.length)return '';
  return `<div class="card"><div class="lab">Sound families · 聲旁</div><div class="small muted" style="margin-bottom:10px">Characters that share a phonetic component usually share a sound. Know one, and the rest come cheap — the grey ones are the ones you haven’t met yet.</div>
    <div class="phgrid">${rows.map(r=>`<div class="ph"><span class="ph-k zh">${esc(r.ph)}</span>${r.chs.map(ch=>`<span class="tile s${csm[ch]||0} zh" style="font-size:16px;width:30px;height:30px;border-radius:7px" title="${esc(ch)}${COMPONENTS[ch]&&COMPONENTS[ch].p?' '+esc(COMPONENTS[ch].p):''}" onclick="brainSel={type:'char',id:'${esc(ch)}'};brainView='chars';renderBrain()">${esc(ch)}</span>`).join('')}</div>`).join('')}</div></div>`;
}
