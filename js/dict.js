/* The dictionary. One entry sheet for any character or word (dcOpen), put together from what the app holds:
   the course's words, characters and components, stroke order, the course's own phrases and sentences, My words,
   and assets/dict.txt (CC-CEDICT) for everything the course does not teach. A tap on a character anywhere
   opens its entry (dcZh makes the characters of a text tappable); the Library's search also looks in the
   dictionary (dcFind); My words fills pinyin and meanings from it (dcLook). */

/* ---- the word list (v62): CC-CEDICT, CC BY-SA 4.0, cut down by tools/build_dict.py to one line per word:
   字<TAB>pinyin<TAB>gloss[<TAB>pinyin<TAB>gloss …] — the first pair is the everyday reading (Taiwan's where it differs), the rest are other readings.
   7 MB, about 3 MB over the air: fetched the first time it is needed, then kept by the service worker with the other assets. ---- */
const DC={url:'assets/dict.txt?v=1',map:null,wait:null,failed:false,warm:false,
  ix:null,ixWait:null};   /* ix: the same words by pinyin and by meaning, for the search (dcIndex) */
function dcLoad(){
  if(DC.map)return Promise.resolve(DC.map);
  if(!DC.wait)DC.wait=fetch(DC.url).then(r=>{if(!r.ok)throw new Error('dict '+r.status);return r.text();}).then(txt=>{
    const m=new Map(); let i=0;
    while(i<txt.length){const e=txt.indexOf('\n',i), end=e<0?txt.length:e, tab=txt.indexOf('\t',i); if(tab>i&&tab<end)m.set(txt.slice(i,tab),txt.slice(tab+1,end)); i=end+1;}
    DC.map=m; DC.failed=false; return m;
  }).catch(()=>{DC.wait=null;DC.failed=true;return null;});   /* offline before the first fetch: the next call tries again */
  return DC.wait;
}
function dcEntry(t){
  const v=DC.map&&DC.map.get(t); if(!v)return null;
  const f=v.split('\t'), out=[]; for(let i=0;i+1<f.length;i+=2)out.push({p:f[i],m:f[i+1]});
  return out.length?out:null;
}
/* what the dictionary knows about a word or phrase: the word itself, or failing that its parts by longest match (pinyin only) */
function dcLook(t){
  t=String(t||'').trim(); if(!t||!DC.map)return null;
  const han=[...t].filter(ch=>/\p{Script=Han}/u.test(ch)), whole=dcEntry(t)||dcEntry(han.join(''));
  if(whole)return {p:whole[0].p,m:whole[0].m,alts:whole.slice(1),parts:null};
  const parts=[]; let i=0;
  while(i<han.length){
    let hit=null;
    for(let n=Math.min(6,han.length-i);n>=1&&!hit;n--){     /* a part the course teaches is read the course's way: 吧 ba, 得 de */
      const w=han.slice(i,i+n).join(''), cw=myCourseWord(w), e=cw?[{p:cw.p,m:cw.m}]:dcEntry(w); if(e)hit={t:w,n,p:e[0].p,m:e[0].m};}
    if(!hit)return null;
    parts.push(hit); i+=hit.n;
  }
  /* 一 and 不 between parts are written with the tone they are spoken with, as the course and the dictionary write them inside a word: 不 + 見 bú jiàn */
  parts.forEach((x,k)=>{
    const nx=parts[k+1], tn=nx?toneSeq(nx.p)[0]:0; if(!tn)return;
    if(x.t==='不'&&x.p==='bù'&&tn===4)x.p='bú';
    else if(x.t==='一'&&x.p==='yī'&&!(k&&/[第十初]$/.test(parts[k-1].t)))x.p=tn===4?'yí':tn<=3?'yì':x.p;
  });
  return parts.length?{p:parts.map(x=>x.p).join(' '),m:'',alts:[],parts}:null;
}
/* Have the dictionary on the device before it is wanted offline: once, a while after start-up, and only where a
   service worker will keep it (it stores every asset the page fetches). Nothing is parsed here. */
function dcWarm(){
  try{
    if(!('caches' in window)||!navigator.serviceWorker||!navigator.serviceWorker.controller||navigator.onLine===false||DC.map||DC.wait)return;
    caches.match(DC.url).then(hit=>{if(!hit)fetch(DC.url).catch(()=>{});}).catch(()=>{});
  }catch(e){}
}

/* ---- what the course itself holds, indexed once: its words by headword and by character, and every phrase and
   sentence it has (the usage phrases of each word, the examples of each grammar point) ---- */
let DCI=null;
const dcHan=s=>[...String(s||'')].filter(ch=>/\p{Script=Han}/u.test(ch));
const dcHead=t=>usHeads({t:String(t||'')})[0];   /* 公共汽車（公車） → 公共汽車 · 女 + noun → 女 */
function dcIdx(){
  if(DCI)return DCI;
  const byT=new Map(), byCh=new Map(), sents=[], seen=new Set(), put=(m,k,v)=>{const a=m.get(k); if(a)a.push(v); else m.set(k,[v]);};
  WORDS.forEach(w=>{const h=dcHead(w.t); if(!h)return; put(byT,h,w); new Set(dcHan(h)).forEach(ch=>put(byCh,ch,w));});
  const add=(zh,py,en,l,full)=>{if(!zh||seen.has(zh))return; seen.add(zh); sents.push({zh,py:py||'',en:en||'',l,full});};
  WORDS.forEach(w=>usOf(w.id).forEach(p=>add(p[0],p[1],p[2],w.l,usIsSent(p[0]))));
  Object.keys(GRAMMAR).forEach(ln=>(GRAMMAR[ln]||[]).forEach(g=>(g.s||[]).forEach(s=>add(s.zh,s.py,s.en,+ln,true))));
  return DCI={byT,byCh,sents};
}
/* one reading per character of a word, taken from the word's own pinyin (睡覺 → shuì · jiào, not 覺's other reading); null when they do not line up */
function dcSyl(p,n){
  const out=[];
  for(const run of (String(p||'').split(/[\/,;(（]/)[0].match(/[A-Za-zÀ-ɏḿ'’]+/g)||[])){const s=pySplit(run,0); if(!s)return null; s.forEach(x=>out.push(x.text.replace(/['’]/g,'').toLowerCase()));}
  return out.length===n?out:null;
}
/* the course's phrases and sentences that contain t, best first: whole sentences before phrases, lessons the learner has reached
   before later ones, the earliest (simplest) first; for a character, a different word in each where the course allows */
function dcSents(t,single){
  const I=dcIdx(), cur=S.settings.curLesson||1, rank=s=>(s.full?0:2)+(s.l<=cur?0:1);
  const hit=I.sents.filter(s=>s.zh.includes(t)).sort((a,b)=>rank(a)-rank(b)||a.l-b.l||a.zh.length-b.zh.length);
  if(!single)return hit.slice(0,12);
  const heads=[...new Set((I.byCh.get(t)||[]).map(w=>dcHead(w.t)))].filter(h=>h.length>1).sort((a,b)=>b.length-a.length);
  const groups=new Map(); hit.forEach(s=>{const k=heads.find(h=>s.zh.includes(h))||t; if(!groups.has(k))groups.set(k,[]); groups.get(k).push(s);});
  const out=[]; let more=true;
  while(more&&out.length<12){more=false; for(const g of groups.values()){const s=g.shift(); if(!s)continue; out.push(s); more=true; if(out.length>=12)break;}}
  return out.sort((a,b)=>rank(a)-rank(b));
}
/* everything known about t before the dictionary is asked */
function dcModel(t){
  const I=dcIdx(), han=dcHan(t), single=[...t].length===1&&han.length===1;
  const cws=(I.byT.get(t)||[]).slice().sort((a,b)=>a.l-b.l);
  const comp=single?(COMPONENTS[t]||null):null;
  const d=myDeck(), myId=Object.keys(d.w).find(id=>d.w[id].t===t)||null, my=myId?d.w[myId]:null;
  const dict=dcEntry(t), bare=!cws.length&&!my&&!(comp&&(comp.p||comp.g));
  const look=bare&&!dict?dcLook(t):null;
  const p=cws.length?cws[0].p:my&&my.p?my.p:comp&&comp.p?comp.p:dict?dict[0].p:look?look.p:'';
  return {t,han,single,cws,comp,my,myId,dict,bare,p};
}

/* ---- tappable characters ---- */
/* A text with each of its characters a door to that character's entry. For an answer, never for a question. */
function dcZh(text){
  return [...String(text||'')].map(ch=>/\p{Script=Han}/u.test(ch)?'<span class="dcc" onclick="event.stopPropagation();dcOpen(\''+ch+'\')">'+ch+'</span>':esc(ch)).join('');
}

/* ---- the entry sheet ---- */
const DCV={stack:[],      /* the entries opened one from another; the last is on screen */
  links:[],sents:[],      /* what the rows of the entry on screen open and speak, by position */
  found:[],               /* the Library's dictionary results, by position */
  p:'',was:null};         /* the reading the speaker button says; where the focus was before the sheet opened */
const dcTop=()=>DCV.stack[DCV.stack.length-1]||'';
function dcHost(){let m=document.getElementById('dcSheet');if(!m){m=document.createElement('div');m.id='dcSheet';m.className='modal';
  m.addEventListener('click',e=>{if(e.target===m)dcClose();});document.body.appendChild(m);}return m;}
function dcIsOpen(){const m=document.getElementById('dcSheet');return !!m&&m.style.display==='flex';}
function dcOpen(t){
  t=dcHead(t); if(!t)return;
  if(!dcIsOpen()){DCV.stack=[];DCV.was=document.activeElement;}
  if(dcTop()!==t)DCV.stack.push(t);
  if(DCV.stack.length>40)DCV.stack.shift();
  dcRender();
}
function dcOpenWord(wid){const w=byId[wid]; if(w)dcOpen(w.t);}
function dcBack(){DCV.stack.pop(); if(DCV.stack.length)dcRender(); else dcClose();}
function dcClose(){
  const m=document.getElementById('dcSheet'); if(m){m.style.display='none';m.innerHTML='';}
  DCV.stack=[]; try{speechSynthesis.cancel();}catch(e){}
  const was=DCV.was; DCV.was=null; if(was&&was.isConnected&&was.focus)try{was.focus({preventScroll:true});}catch(e){}
}
function dcHear(){const t=dcTop(); if(t)playAudio(t,DCV.p||undefined);}
function dcSay(i){const s=DCV.sents[i]; if(s)speakText(s.zh);}
const dcGo=t=>'dcOpen(DCV.links['+(DCV.links.push(t)-1)+'])';
function dcWordRow(x){
  return `<div class="dc-w" onclick="${dcGo(x.t)}"><b class="zh" lang="zh-Hant">${esc(x.t)}</b>${x.p?`<span class="p">${tonePinyin(esc(x.p))}</span>`:''}<span class="m">${esc(x.m||'')}</span>${x.l?`<span class="lnchip">${esc(lnLabel(x.l))}</span>`:''}</div>`;
}
/* a list that shows its first n rows and keeps the rest one tap away, without repainting the sheet */
function dcFold(rows,n){
  if(rows.length<=n)return rows.join('');
  return rows.slice(0,n).join('')+`<div hidden>${rows.slice(n).join('')}</div><div class="dc-morelink"><span class="link" onclick="this.parentElement.previousElementSibling.hidden=false;this.parentElement.remove()">${rows.length-n} more</span></div>`;
}
function dcSentRow(s,t){
  const k=s.zh.indexOf(t), i=DCV.sents.push(s)-1;
  const zh=k<0?esc(s.zh):esc(s.zh.slice(0,k))+'<b>'+esc(t)+'</b>'+esc(s.zh.slice(k+t.length));
  return `<div class="us-row${s.full?' sent':''}" onclick="dcSay(${i})" title="tap to hear it"><div class="us-zh zh" lang="zh-Hant">${zh}</div><div class="us-sub">${S.settings.showPy!==false&&s.py?`<span class="us-py">${tonePinyin(esc(s.py))}</span>`:''}<span>${esc(s.en)}</span></div></div>`;
}
/* the My words line of an entry: its state there, or the button that adds it. Nothing for what the course teaches (a word, or a
   character of its words): that is studied in the course's own deck. */
function dcMine(M){
  if(M.my)return `<span class="small muted">In My words</span> ${myState(M.myId)}`;
  if(M.cws.length||(M.single&&dcIdx().byCh.has(M.t)))return '';
  if(!M.dict&&!DC.map)return '';   /* nothing to save with it yet: the button comes with the dictionary */
  return `<button class="btn sm ghost" onclick="dcAdd()">Add to My words</button>`;
}
/* where the learner stands with it: the stage, and the memory line the Brain used to show */
function dcStanding(M){
  let stage=null, due=false, mem=null, first=null, mast=null, simp='', cards='';
  if(M.cws.length){
    const w=M.cws.find(x=>tracked(x.id))||M.cws[0];
    stage=wordStage(w.id); due=wordDueNow(w.id); mem=wordMem(w.id); mast=wordMastAt(w.id); simp=w.s||'';
    cards=MODES.filter(m=>S.settings.modes[m]).map(m=>{
      const c=S.cards[cardId(w.id,m)], nm=m==='rec'?'Recognize':'Recall';
      if(!c)return '';
      return '<span>'+nm+' <b>'+(c.st===undefined?'queued':(c.S<1?'<1':Math.round(c.S))+'d hold')+'</b>'+(c.st===undefined?'':' · '+fmtDueIn(c))+'</span>';
    }).join('');
  }
  if(M.single){
    const e=charModel().find(c=>c.ch===M.t);
    if(e){first=e.lesson; if(!M.cws.length){stage=e.stage; due=e.due; mem=e.mem;}}
    simp=SIMP_CHAR[M.t]||simp;
  }
  if(stage===null&&!simp)return '';
  const pct=mem!==null?Math.round(mem*100):null;
  return `<div class="row dc-tags">${stage!==null?`<span class="tag ${stage>=3?'mat':stage>0?'ok':''}">${STAGE_NAMES[stage]}</span>`:''}${simp?`<span class="tag simp">简 ${esc(simp)}</span>`:''}${due?'<span class="tag due">due now</span>':''}${mast?`<span class="tag known">mastered ${fmtAgo(mast)}</span>`:''}</div>`
    +(pct!==null||first||cards?`<div class="kv">${pct!==null?`<span>memory right now <b>${pct}%</b></span>`:''}${first&&M.single?`<span>first met in <b>${esc(lnLabel(first))}</b></span>`:''}${cards}</div>`:'')
    +(pct!==null?`<div class="membar"><i style="width:${pct}%"></i></div>`:'');
}
function dcRender(){
  const t=dcTop(); if(!t)return;
  const m=dcHost(), M=dcModel(t), I=dcIdx(); DCV.links=[]; DCV.sents=[]; DCV.p=M.p;
  const names=w=>S.settings.includeNames||!isName(w);
  const n=[...t].length, size=n<=1?64:n<=2?50:n<=4?38:n<=7?28:22;
  /* meanings: the course's own first, each with its lesson; then My words; the dictionary's are filled in by dcFill */
  let senses=M.cws.map(w=>`<div class="dc-sense">${w.pos?`<span class="tag">${esc(w.pos)}</span> `:''}${M.cws.some(x=>x.p!==M.p)?`<span class="dc-rp">${tonePinyin(esc(w.p))}</span> `:''}${esc(w.m)}<span class="lnchip">${esc(lnLabel(w.l))}</span></div>`).join('');
  if(!M.cws.length&&M.comp&&M.comp.g)senses+=`<div class="dc-sense">${esc(M.comp.g)}</div>`;
  if(M.my&&!M.cws.length&&M.my.m)senses+=`<div class="dc-sense">${esc(M.my.m)}</div>`;
  const mine=dcMine(M);
  const head=`<div class="dc-head"><div class="dc-big zh" lang="zh-Hant" style="font-size:${size}px">${M.single?esc(t):dcZh(t)}</div>
      <div class="dc-id"><div class="row" style="gap:9px">${M.p?`<span class="pyline dc-py">${tonePinyin(esc(M.p))}</span>`:''}<button class="spk" title="pronounce" onclick="dcHear()">${SPK_SVG}</button>${awBtn(t,M.p)}</div>${dcStanding(M)}</div></div>
    <div class="dc-senses">${senses}<div id="dcDefs">${M.bare&&!M.dict&&!DC.map?'<div class="small muted">Looking it up…</div>':''}</div></div>
    ${M.han.length?`<div id="dcMy" class="row dc-my">${mine}</div>`:''}`;
  /* a word: its characters, each one tap from its own entry */
  let charsSec='';
  if(!M.single&&M.han.length){
    const syl=dcSyl(M.p,M.han.length), uniq=M.han.filter((c,i,a)=>a.indexOf(c)===i);
    charsSec=`<div class="dc-sec"><div class="dc-lab">Its characters</div>${uniq.map(ch=>{const c=COMPONENTS[ch]||{}, d=(dcEntry(ch)||[{p:'',m:''}])[0];   /* the dictionary, for a character the course does not teach */
      return dcWordRow({t:ch,p:syl?syl[M.han.indexOf(ch)]:(c.p||d.p),m:c.g||d.m});}).join('')}${uniq.length>4?'<div class="small muted" style="padding:4px 8px 0">Tap a character for its stroke order.</div>':''}</div>`;
  }
  const uniqHan=M.han.filter((c,i,a)=>a.indexOf(c)===i), strokeN=uniqHan.length;
  const strokes=strokeN&&strokeN<=4?`<div class="dc-sec"><div class="dc-lab">Stroke order<span id="dcStrokeN"></span></div>
      <div id="dcStrokes" class="strokerow"></div><div id="dcStrokes-fb" class="small muted" style="display:none;text-align:center">No stroke data for ${strokeN>1?'these characters':'this character'}.</div>
      <div class="stroketools"><button class="btn sm ghost" onclick="playStrokes('dcStrokes')">Replay strokes ▶</button></div></div>`:'';
  let built='';
  if(M.single&&M.comp){const story=charStoryHtml(t); if(story)built=`<div class="dc-sec"><div class="dc-lab">How it is built${M.comp.t&&ETYPE[M.comp.t]?' · '+ETYPE[M.comp.t]:''}</div>${story}</div>`;}
  /* the course's words that use it: one row per word, under the lesson that first teaches it */
  const seen=new Set([t]), using=[];
  (M.single?(I.byCh.get(t)||[]):WORDS.filter(w=>dcHead(w.t).includes(t))).filter(names).slice().sort((a,b)=>a.l-b.l).forEach(w=>{const h=dcHead(w.t); if(seen.has(h))return; seen.add(h); using.push({t:h,p:w.p,m:w.m,l:w.l});});
  const usingSec=using.length?`<div class="dc-sec"><div class="dc-lab">${M.single?'Words with '+esc(t)+' in your course':'Course words that contain it'}</div>${dcFold(using.map(dcWordRow),6)}</div>`:'';
  const ss=dcSents(t,M.single);
  const sentSec=ss.length?`<div class="dc-sec"><div class="dc-lab">Examples · tap to hear</div>${dcFold(ss.map(s=>dcSentRow(s,t)),3)}</div>`:'';
  m.innerHTML=`<div class="modal-card dc-card" tabindex="-1" role="dialog" aria-label="Dictionary">
    <div class="sheet-h"><div class="row" style="gap:8px;flex-wrap:nowrap">${DCV.stack.length>1?`<button class="xbtn" onclick="dcBack()" aria-label="back" title="back">‹</button>`:''}<b>Dictionary</b></div><button class="xbtn" onclick="dcClose()" aria-label="close">✕</button></div>
    ${head}${M.single?strokes+built:charsSec+strokes}${sentSec}${usingSec}<div id="dcMore"></div>
    ${M.han.length?`<div class="dc-sec">${lookupRow(t)}</div>`:''}
    <div class="small muted dc-credit">Outside the course: <a class="link" href="https://cc-cedict.org/wiki/" target="_blank" rel="noopener">CC-CEDICT</a> (CC BY-SA 4.0)</div></div>`;
  m.style.display='flex';
  const card=m.firstElementChild; card.scrollTop=0; try{card.focus({preventScroll:true});}catch(e){}
  if(strokes){
    renderStrokes('dcStrokes',uniqHan.join(''),{still:!S.settings.strokeAnim});
    if(M.single)loadStrokes().then(d=>{const el=document.getElementById('dcStrokeN'), x=d&&d[t]; if(!el||dcTop()!==t||!x||!x.strokes)return;
      el.textContent=' · '+x.strokes.length+' stroke'+(x.strokes.length===1?'':'s')+(x.radStrokes&&x.radStrokes.length?' · radical in green':'');});
  }
  dcFill();
}
/* the dictionary's part of the entry: its readings and meanings, and more words that contain this one. It is filled in when the
   dictionary is in memory; an entry that has nothing else to go on, or no reading, is painted again once it arrives. */
function dcFill(){
  const t=dcTop(), defs=document.getElementById('dcDefs'), more=document.getElementById('dcMore'); if(!t||!defs||!more)return;
  if(!DC.map){
    const M0=dcModel(t), bare=M0.bare;
    dcLoad().then(map=>{
      if(!dcIsOpen()||dcTop()!==t)return;
      /* the head and the character rows need the dictionary too when there is no reading yet (a word of My words saved without one) or a character the course does not teach */
      if(map){if(bare||!M0.p||(!M0.single&&M0.han.some(ch=>!COMPONENTS[ch])))dcRender(); else dcFill();}
      else if(bare)defs.innerHTML='<div class="small muted">The full dictionary needs a connection the first time it is used. After that it works offline.</div>';
    });
    return;
  }
  const M=dcModel(t), flat=s=>libStrip(s).replace(/[^a-z]/g,''), own=M.cws.length||(M.comp&&M.comp.g)||(M.my&&M.my.m);
  const mine=document.getElementById('dcMy'); if(mine)mine.innerHTML=dcMine(M);   /* the button waits for the dictionary: it saves the reading and meaning from it */
  if(M.dict)defs.innerHTML=(own?'<div class="dc-lab" style="margin:10px 0 2px">In the dictionary</div>':'')
    +M.dict.map(x=>`<div class="dc-sense">${M.dict.length>1||flat(x.p)!==flat(M.p)?`<span class="dc-rp">${tonePinyin(esc(x.p))}</span> `:''}${esc(x.m)}</div>`).join('');
  else defs.innerHTML=M.bare?`<div class="small muted">${M.han.length?'Not in the dictionary as one word.':'Not in the dictionary.'}</div>`:'';
  if(!M.han.length){more.innerHTML='';return;}
  const I=dcIdx(), known=new Set(BCHARS), hits=[];
  for(const k of DC.map.keys()){ if(k===t||k.indexOf(t)<0||I.byT.has(k))continue; hits.push(k); }
  const rows=hits.map((k,i)=>({k,i,r:dcRank(k,known)})).sort((a,b)=>a.r-b.r||a.i-b.i).slice(0,30).map(x=>{const e=dcEntry(x.k)||[{p:'',m:''}];return dcWordRow({t:x.k,p:e[0].p,m:e[0].m});});
  more.innerHTML=rows.length?`<div class="dc-sec"><div class="dc-lab">${M.single?'More words with '+esc(t):'Longer words and phrases'} · from the dictionary</div>${dcFold(rows,5)}</div>`:'';
}
/* The order the dictionary's own words are listed in, lower first. CC-CEDICT has no word frequencies, so this goes by what a learner
   can use: words written only with characters the course teaches, everyday senses before variants, surnames and labelled
   usages, short before long. */
const DC_RARE=/^\(|variant of|surname |abbr\. for|\bsee |used in |\((?:old|archaic|literary|dialect)\)/;
function dcRank(t,known){
  const v=DC.map.get(t)||'';
  return (dcHan(t).every(c=>known.has(c))?0:100)+(DC_RARE.test(v.slice(v.indexOf('\t')+1))?40:0)+[...t].length;
}
/* a word the course does not teach goes into My words with the reading and meaning the entry shows */
function dcAdd(){
  const t=dcTop(); if(!t)return;
  const g=myGuess(t), r=myAdd(t,g.p,g.m); if(!r)return;
  const paint=()=>{if(view==='my'&&MY.mode!=='study')renderMy(); else myBadge(); if(dcIsOpen()&&dcTop()===t){const box=document.getElementById('dcMy'); if(box)box.innerHTML=dcMine(dcModel(t));}};
  if(r.dup){paint();return;}
  save(); paint();
  toast('Added '+esc(t)+' to My words',{action:'Undo',ms:7000,onAction:()=>{const d=myDeck(); delete d.w[r.id]; for(const k in d.c)if(k.split(':')[0]===r.id)delete d.c[k]; save(); paint();}});
}

/* ---- the search (the Library's box): the dictionary by pinyin without tones and by meaning. Built once, in slices
   so that typing never waits for it; a search by characters needs only the word list. ---- */
function dcIndex(){
  if(DC.ix)return Promise.resolve(DC.ix);
  if(!DC.ixWait)DC.ixWait=dcLoad().then(map=>{
    if(!map){DC.ixWait=null;return null;}
    return new Promise(res=>{
      const t=[], pn=[], gl=[], it=map.entries();
      const step=()=>{
        for(let n=0;n<15000;n++){
          const r=it.next(); if(r.done){DC.ix={t,pn,m:gl};res(DC.ix);return;}
          const v=r.value[1], a=v.indexOf('\t');
          t.push(r.value[0]); pn.push(libStrip(v.slice(0,a)).replace(/[^a-z0-9]/g,'')); gl.push(v.slice(a+1).replace(/\t/g,'; ').toLowerCase());
        }
        setTimeout(step,0);
      };
      step();
    });
  });
  return DC.ixWait;
}
/* the dictionary's words for a search, without the ones the course teaches (the Library lists those itself). Scored as the Library
   scores its own (libScore); by pinyin or meaning only a real match counts: the whole reading or its start, or one whole sense. */
function dcFind(q,max){
  const ix=DC.ix; q=String(q||'').trim(); if(!ix||!q)return [];
  const I=dcIdx(), han=/\p{Script=Han}/u.test(q), qq=libStrip(q), qn=qq.replace(/[^a-z0-9]/g,''), e={t:'',p:'',pn:'',alias:'',m:''}, hits=[];
  for(let k=0;k<ix.t.length;k++){
    const t=ix.t[k]; let s=0;
    if(han){const i=t.indexOf(q); if(i<0)continue; s=t===q?100:i===0?92:84;}
    else{
      const pn=ix.pn[k], m=ix.m[k]; if(!(qn&&pn.indexOf(qn)===0)&&m.indexOf(qq)<0)continue;
      e.t=t; e.p=e.pn=pn; e.m=m; s=libScore(e,qq,qn); if(s<66)continue;
    }
    if(I.byT.has(t))continue;
    hits.push({k,s});
  }
  const known=new Set(BCHARS);
  hits.forEach(h=>{h.r=dcRank(ix.t[h.k],known);});
  /* the word itself first; then what the learner can read before what they cannot (xue: 學位 before 乴), each by how well it matches */
  const top=h=>h.s===100?0:h.r<100?1:2;
  return hits.sort((a,b)=>top(a)-top(b)||b.s-a.s||a.r-b.r||a.k-b.k).slice(0,max).map(h=>{const t=ix.t[h.k], d=dcEntry(t)||[{p:'',m:''}];return {t,p:d[0].p,m:d[0].m};});
}
if(typeof zikaWhole==='function')zikaWhole();   /* the last line: this file arrived whole (index.html, js/boot.js) */
