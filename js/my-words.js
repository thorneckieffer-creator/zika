/* My words: a personal deck for words outside the course, kept apart from it, with topics, pinyin and meaning
   filled in from the dictionary (js/dict.js), and its own study sitting. Always reach the deck through myDeck(). */

const MY={mode:'list',cur:null,shown:false,done:0,q:'',edit:null,tab:'one',
  tp:null,      /* the list's topic filter: null = all, a topic id, or '-' = words with no topic */
  sel:[],       /* topics ticked in the add / edit sheet */
  auto:{p:'',m:''},   /* what the sheet last filled into Pinyin and Meaning by itself: a field still holding it follows the characters, one you typed in is left alone */
  scope:null};  /* the filter the running study session was started with */
/* The topics a deck starts with: parts of life, not parts of speech. Every device seeds the same ids in the same order, so two that seed apart still agree. */
const MY_TOPICS=['Food & drink','Getting around','Shopping & money','Home & daily life','School & study','Work','People & family','Health & body','Feelings & opinions','Free time','Travel & places','Slang & set phrases'];
function myDeck(){
  if(!S.my||typeof S.my!=='object')S.my={n:1,w:{},c:{},intro:{},log:{}};
  const d=S.my; d.w=d.w||{}; d.c=d.c||{}; d.intro=d.intro||{}; d.log=d.log||{}; d.n=d.n||1;
  if(!Array.isArray(d.tp))d.tp=MY_TOPICS.map((n,i)=>({id:'t'+(i+1),n}));
  if(!d.tn)d.tn=1+d.tp.reduce((m,t)=>Math.max(m,+String(t.id).slice(1)||0),MY_TOPICS.length);
  return d;
}
const myIds=()=>Object.keys(myDeck().w);
const myModes=()=>myDeck().both?['rec','prod']:['rec'];
const myWord=cid=>myDeck().w[cid.split(':')[0]];
function myAdd(t,p,m,g){
  t=String(t||'').trim(); if(!t)return null;
  const d=myDeck(); for(const id in d.w)if(d.w[id].t===t)return {id,dup:true};
  const id='u'+(d.n++); d.w[id]={t,p:String(p||'').trim(),m:String(m||'').trim(),at:Date.now()}; myTag(d.w[id],g);
  return {id};
}
/* ---- topics ---- */
const myTopic=id=>myDeck().tp.find(t=>t.id===id)||null;
function myTopicsOf(w){const d=myDeck();return ((w&&w.g)||[]).map(id=>d.tp.find(t=>t.id===id)).filter(Boolean);}
function myInTopic(w,f){if(!f)return true;const ts=myTopicsOf(w);return f==='-'?!ts.length:ts.some(t=>t.id===f);}
function myTag(w,ids){if(ids&&ids.length)w.g=[...new Set(ids)];else delete w.g;}
const myScopeName=f=>f==='-'?'No topic':f?(myTopic(f)||{}).n||'':'';
function myTopicAdd(name){
  name=String(name||'').replace(/\s+/g,' ').trim().slice(0,30); if(!name)return null;
  const d=myDeck(), had=d.tp.find(t=>t.n.toLowerCase()===name.toLowerCase()); if(had)return had.id;
  const id='t'+(d.tn++); d.tp.push({id,n:name}); return id;
}
function myTopicCounts(){
  const d=myDeck(), c={'-':0};
  for(const id in d.w){const ts=myTopicsOf(d.w[id]); if(!ts.length)c['-']++; ts.forEach(t=>{c[t.id]=(c[t.id]||0)+1;});}
  return c;
}
function myTopicPills(w,skip){const ts=myTopicsOf(w).filter(t=>t.id!==skip);return ts.length?'<div class="tp">'+ts.map(t=>'<span>'+esc(t.n)+'</span>').join('')+'</div>':'';}   /* skip: the topic the list is already filtered to */
/* The best guess at a word's pinyin and meaning: the course's own if it teaches the word, then the dictionary, then (pinyin only) character by character. */
function myCourseWord(t){return WORDS.find(w=>w.t===t||String(w.t).split('（')[0]===t)||null;}
function myGuess(t){
  t=String(t||'').trim(); const none={p:'',m:'',alts:[],parts:null,src:''}; if(!t)return none;
  const cw=myCourseWord(t); if(cw)return {p:cw.p,m:cw.m,alts:[],parts:null,src:'course'};
  const d=dcLook(t); if(d)return Object.assign(d,{src:'dict'});
  const out=[]; for(const ch of t){ if(!/\p{Script=Han}/u.test(ch))continue; const c=COMPONENTS[ch]; if(!c||!c.p)return none; out.push(String(c.p).split(/[,;/ ]/)[0]); }
  return out.length?{p:out.join(''),m:'',alts:[],parts:null,src:'chars'}:none;
}
const myMissing=()=>{const d=myDeck();return myIds().filter(id=>!d.w[id].p||!d.w[id].m);};
/* words added before the dictionary, or while it could not be reached */
function myFillMissing(){
  toast('Looking them up…');
  dcLoad().then(()=>{
    const d=myDeck(), was={}; let n=0;
    for(const id of myMissing()){const w=d.w[id], g=myGuess(w.t), p=w.p||g.p, m=w.m||g.m; if(p!==w.p||m!==w.m){was[id]={p:w.p,m:w.m};w.p=p;w.m=m;n++;}}
    if(!n){toast(DC.map?'The dictionary has nothing more for those words':'The dictionary could not be reached. It needs a connection the first time.');return;}
    save(); if(view==='my'&&MY.mode!=='study')renderMy();
    toast('Filled in '+n+' word'+(n===1?'':'s'),{action:'Undo',ms:7000,onAction:()=>{const dd=myDeck();for(const id in was)if(dd.w[id])Object.assign(dd.w[id],was[id]);save();if(view==='my'&&MY.mode!=='study')renderMy();}});
  });
}
function myQueue(f){   /* f: a topic filter as in MY.tp; the daily allowance of new cards is the deck's, whatever the filter */
  const d=myDeck(), now=Date.now(), learn=[], rev=[], fresh=[], ahead=[];
  for(const id in d.w){ if(f&&!myInTopic(d.w[id],f))continue; for(const m of myModes()){
    const cid=id+':'+m, c=d.c[cid];
    if(!c||c.st===undefined){fresh.push(cid);continue;}
    if(c.due<=now)(c.st==='rev'?rev:learn).push(cid); else if(c.st!=='rev')ahead.push(cid);
  }}
  const by=(a,b)=>d.c[a].due-d.c[b].due; learn.sort(by); rev.sort(by); ahead.sort(by);
  const left=Math.max(0,(d.perDay??10)-(d.intro[dkey(new Date())]||0));
  return {learn,rev,fresh:fresh.slice(0,left),waiting:fresh.length,ahead};
}
function myRate(cid,g){
  const d=myDeck(), now=Date.now(), today=dkey(new Date()); let c=d.c[cid];
  const sched=days=>{c.due=now+fuzz(days)*DAY;c.days=(c.days||0)+1;};
  if(!c||c.st===undefined){
    d.intro[today]=(d.intro[today]||0)+1;
    c=d.c[cid]={st:'learn',S:initS(g),D:initD(g),due:0,last:now,reps:1,lapses:0,days:0};
    if(g===1)c.due=now+MIN; else if(g===2)c.due=now+5*MIN; else if(g===3)c.due=now+10*MIN; else{c.st='rev';sched(nextIntervalDays(c.S));}
  }else if(c.st==='learn'||c.st==='relearn'){
    c.reps++;c.last=now;c.S=stabShort(c.S,g);c.D=updD(c.D,g);
    if(g===1)c.due=now+MIN; else if(g===2)c.due=now+5*MIN; else{c.st='rev';sched(Math.max(1,nextIntervalDays(c.S)));}
  }else{
    const t=Math.max(0.01,(now-c.last)/DAY), r=retrievability(t,c.S), d0=c.D;
    c.D=updD(d0,g);c.reps++;c.last=now;
    if(g===1){c.lapses++;c.S=stabForget(c.S,d0,r);c.st='relearn';c.due=now+5*MIN;}
    else{c.S=stabRecall(c.S,d0,r,g);sched(nextIntervalDays(c.S));}
  }
  d.log[today]=(d.log[today]||0)+1;
  for(const k of ['intro','log']){const ks=Object.keys(d[k]).sort(); while(ks.length>120)delete d[k][ks.shift()];}
  save();
}
function myBadge(){const q=myQueue(), n=q.learn.length+q.rev.length+q.fresh.length, b=document.getElementById('bMy');if(b){b.textContent=n;b.classList.toggle('zero',n===0);}}
function myState(id){
  const d=myDeck(), c=d.c[id+':rec'], now=Date.now();
  if(!c||c.st===undefined)return '<span class="tag">new</span>';
  if(c.due<=now)return '<span class="tag due">due</span>';
  if(c.st!=='rev')return '<span class="tag">learning</span>';
  const days=Math.max(1,Math.round((c.due-now)/DAY));
  return '<span class="tag ok">in '+days+'d</span>';
}
function mySpk(id){return '<button class="spk" title="pronounce" onclick="event.stopPropagation();mySay(\''+id+'\')">'+SPK_SVG+'</button>';}
function mySay(id){const w=myDeck().w[id];if(w)playAudio(w.t,w.p||undefined);}

/* ---- list ---- */
function renderMy(){
  const host=document.getElementById('vMy'); if(!host)return;
  if(MY.mode==='study'){myStudyRender();return;}
  const d=myDeck(), all=myIds();
  if(MY.tp&&!all.some(id=>myInTopic(d.w[id],MY.tp)))MY.tp=null;      /* the last word left that topic */
  const q=myQueue(MY.tp), name=myScopeName(MY.tp), inTopic=MY.tp?all.filter(id=>myInTopic(d.w[id],MY.tp)).length:all.length;
  const ready=q.learn.length+q.rev.length+q.fresh.length;
  /* words with a gap; once the dictionary is in memory, only those it can do something for */
  const gaps=myMissing().filter(id=>{if(!DC.map)return true;const w=d.w[id],g=myGuess(w.t);return (!w.p&&g.p)||(!w.m&&g.m);}).length;
  myBadge();
  /* have the dictionary on the device before it is needed offline; once it is here the line about gaps counts only what it can fill */
  if(!DC.map&&!DC.wait&&!DC.warm&&navigator.onLine!==false){DC.warm=true;setTimeout(()=>dcLoad().then(m=>{
    DC.warm=false; const sh=document.getElementById('shSheet'), at=document.activeElement;
    if(m&&view==='my'&&MY.mode==='list'&&!(sh&&sh.style.display==='flex')&&!(at&&at.id==='myQ'))renderMy();}),1200);}
  const head=`<div class="my-head"><div><h1>My words</h1><div class="sub">Your own deck for words outside class. It is scheduled like the course, and kept separate from it.</div></div>
    <button class="btn" onclick="myOpenAdd()">Add words</button></div>`;
  if(!all.length){
    host.innerHTML=head+`<div class="card my-empty"><div class="big">生詞</div><div style="font-weight:600;font-size:16px">Nothing here yet</div>
      <div class="small muted" style="max-width:380px;margin:6px auto 16px">A word from a menu, a sign, a show or a friend: add it here and it comes back on the same schedule as your class words, without touching the course deck.</div>
      <button class="btn" onclick="myOpenAdd()">Add your first word</button></div>`;
    return;
  }
  host.innerHTML=head+`<div class="card">
      <div class="row spread" style="margin-bottom:12px"><div><div class="lab" style="margin-bottom:2px">Ready now${name?' · '+esc(name):''}</div>
        <div class="small muted">${q.rev.length} due · ${q.learn.length} learning · ${q.fresh.length} new${q.waiting>q.fresh.length?' ('+(q.waiting-q.fresh.length)+' more waiting)':''}</div></div>
        <div style="font-size:34px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em">${ready}</div></div>
      <button class="btn big" ${ready||q.ahead.length?'':'disabled'} onclick="myStart(MY.tp)">${ready?'Study '+(name?esc(name):'my words'):q.ahead.length?'Keep going · '+q.ahead.length+' still learning':'All caught up'}</button>
      <div class="set-row" style="margin-top:8px"><div><b>New cards a day</b><div class="d">how many new cards this deck starts each day</div></div>
        <input type="number" min="0" max="100" value="${d.perDay??10}" onchange="const v=parseInt(this.value);myDeck().perDay=Math.max(0,isNaN(v)?10:v);save();renderMy()"></div>
      <div class="set-row"><div><b>Both directions</b><div class="d">also ask from the meaning back to the characters, to write on paper</div></div>
        <button class="tgl${d.both?' on':''}" aria-label="both directions" onclick="myDeck().both=!myDeck().both;save();renderMy()"><i></i></button></div>
    </div>
    <div class="card"><div class="lab">${MY.tp?inTopic+' of ':''}${all.length} word${all.length===1?'':'s'}</div>
      ${gaps?`<div class="small muted" style="margin:6px 0 2px">${gaps} word${gaps===1?' is':'s are'} missing pinyin or a meaning · <span class="link" onclick="myFillMissing()">Fill in from the dictionary</span></div>`:''}
      ${myTopicBar()}
      ${all.length>6?`<input class="search" id="myQ" placeholder="Search characters, pinyin, meaning or topic" value="${esc(MY.q).replace(/"/g,'&quot;')}" oninput="MY.q=this.value;myListOnly()">`:''}
      <div id="myList">${myRows(myShown())}</div></div>`;
}
/* the words the list shows: the topic filter, then the search box; newest first */
function myShown(){
  const d=myDeck(), f=MY.q.trim().toLowerCase(), plain=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  return myIds().filter(id=>myInTopic(d.w[id],MY.tp)).sort((a,b)=>d.w[b].at-d.w[a].at).filter(id=>{
    if(!f)return true; const w=d.w[id];
    return (w.t+' '+w.p+' '+w.m+' '+myTopicsOf(w).map(t=>t.n).join(' ')).toLowerCase().includes(f)||plain(w.p).includes(f);});
}
/* the row of topic filters above the list: only topics that hold a word, then the door to the topic editor */
function myTopicBar(){
  const d=myDeck(), c=myTopicCounts(), used=d.tp.filter(t=>c[t.id]);
  const b=(f,label,n)=>`<button class="${(MY.tp||'')===f?'on':''}" onclick="mySetTopic('${f}')">${esc(label)}<span class="n">${n}</span></button>`;
  if(!used.length)return `<div class="my-chips bar"><button class="add" onclick="myTopicsSheet()">Topics</button><span class="small muted" style="align-self:center">Sort words by the part of life they belong to: tap a word’s ✎.</span></div>`;
  return `<div class="my-chips bar">${b('','All',myIds().length)}${used.map(t=>b(t.id,t.n,c[t.id])).join('')}${c['-']?b('-','No topic',c['-']):''}<button class="add" onclick="myTopicsSheet()">Edit topics</button></div>`;
}
function mySetTopic(f){MY.tp=f||null;renderMy();}
function myRows(ids){
  const d=myDeck();
  if(!ids.length)return '<div class="small muted" style="padding:10px 0">No match.</div>';
  return ids.map(id=>{const w=d.w[id];return `<div class="my-row"><div class="tr">${dcZh(w.t)}</div>
    <div class="info dcl" onclick="dcOpen(myDeck().w['${id}'].t)" title="open its dictionary entry"><div class="py">${w.p?tonePinyin(esc(w.p)):'<span class="muted">no pinyin</span>'}</div><div class="mn">${esc(w.m)||'<span class="muted">no meaning yet</span>'}</div>${myTopicPills(w,MY.tp)}</div>
    ${myState(id)}${mySpk(id)}<button class="wbtn" title="edit" aria-label="edit" onclick="myOpenAdd('${id}')">✎</button></div>`;}).join('');
}
function myListOnly(){const el=document.getElementById('myList'); if(el)el.innerHTML=myRows(myShown());}

/* ---- add / edit ---- */
function myOpenAdd(id){
  MY.edit=id||null; if(id)MY.tab='one';
  const w=id?myDeck().w[id]:null;
  MY.sel=w?myTopicsOf(w).map(t=>t.id):(MY.tp&&MY.tp!=='-'?[MY.tp]:[]);   /* a new word starts in the topic being looked at */
  MY.auto={p:'',m:''};
  myAddRender();
}
/* the topic chips of the add / edit sheet. Ticking one changes MY.sel and the chip, never the sheet, so nothing typed is lost. */
function myChips(){
  return myDeck().tp.map(t=>`<button type="button" class="${MY.sel.includes(t.id)?'on':''}" aria-pressed="${MY.sel.includes(t.id)}" onclick="myPick(this,'${t.id}')">${esc(t.n)}</button>`).join('')
    +'<button type="button" class="add" onclick="myNewTopic(this)">+ New topic</button>';
}
function myPick(el,id){const i=MY.sel.indexOf(id); if(i<0)MY.sel.push(id); else MY.sel.splice(i,1); el.classList.toggle('on',i<0); el.setAttribute('aria-pressed',i<0);}
function myNewTopic(btn){
  const inp=document.createElement('input'); inp.className='myin'; inp.maxLength=30; inp.placeholder='Topic name'; inp.autocomplete='off'; inp.setAttribute('aria-label','new topic');
  const done=()=>{
    const id=myTopicAdd(inp.value); if(id){if(!MY.sel.includes(id))MY.sel.push(id);save();}
    const box=document.getElementById('myChips'); if(box)box.innerHTML=myChips();
  };
  inp.onkeydown=e=>{
    if(e.key==='Enter'){e.preventDefault();inp.onblur=null;done();}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();inp.value='';inp.blur();}
  };
  inp.onblur=done; btn.replaceWith(inp); inp.focus();
}
function myAddRender(){
  const m=shHost(), d=myDeck(), w=MY.edit?d.w[MY.edit]:null, q=s=>esc(s||'').replace(/"/g,'&quot;');
  const one=`<div class="frow"><label for="myT">Characters</label><input id="myT" class="myin zh" lang="zh-Hant" autocomplete="off" autocapitalize="off" value="${w?q(w.t):''}" placeholder="珍珠奶茶" oninput="myHint(event)" oncompositionend="myHint()" onblur="myFill()"></div>
    <div id="myHintBox"></div>
    <div class="frow"><label for="myP">Pinyin</label><input id="myP" class="myin" autocomplete="off" autocapitalize="off" spellcheck="false" value="${w?q(w.p):''}" placeholder="zhēnzhū nǎichá"></div>
    <div class="frow"><label for="myM">Meaning</label><input id="myM" class="myin" autocomplete="off" value="${w?q(w.m):''}" placeholder="bubble tea" onkeydown="if(event.key==='Enter'){event.preventDefault();mySaveOne();}"></div>
    <div class="frow"><label>Topics</label><div class="my-chips" id="myChips">${myChips()}</div></div>
    <div class="row" style="gap:8px"><button class="btn" style="flex:1" onclick="mySaveOne()">${w?'Save':'Add'}</button>
      ${w?`<button class="btn ghost" style="color:var(--red)" onclick="myDelete('${MY.edit}')">Delete</button>`:''}</div>`;
  const many=`<div class="frow"><label for="myBulk">One word per line: characters, pinyin, meaning</label>
      <textarea id="myBulk" class="myin" lang="zh-Hant" spellcheck="false" placeholder="珍珠奶茶, zhēnzhū nǎichá, bubble tea&#10;悠遊卡, EasyCard&#10;夜市"></textarea></div>
    <div class="small muted" style="margin:-4px 0 12px">Commas, tabs or semicolons all work. Pinyin and meaning are optional: what you leave out is filled in from the dictionary.</div>
    <div class="frow"><label>Topics for every word in the list</label><div class="my-chips" id="myChips">${myChips()}</div></div>
    <button class="btn" style="width:100%" onclick="mySaveMany()">Add all</button>`;
  m.innerHTML=`<div class="modal-card">
    <div class="sheet-h"><b>${w?'Edit word':'Add to My words'}</b><button class="xbtn" onclick="shClose();renderMy()" aria-label="close">✕</button></div>
    ${w?'':`<div class="seg" style="margin-bottom:14px"><button class="${MY.tab==='one'?'on':''}" onclick="MY.tab='one';myAddRender()">One word</button><button class="${MY.tab==='many'?'on':''}" onclick="MY.tab='many';myAddRender()">Paste a list</button></div>`}
    ${w||MY.tab==='one'?one:many}
    <div class="small muted" style="margin-top:12px;text-align:center">Pinyin and meanings from <a class="link" href="https://cc-cedict.org/wiki/" target="_blank" rel="noopener">CC-CEDICT</a> (CC BY-SA 4.0)</div></div>`;
  m.style.display='flex';
  myHint(); if(!DC.map)dcLoad().then(()=>myHint());
  const first=document.getElementById(w||MY.tab==='one'?'myT':'myBulk'); if(first&&!w)try{first.focus();}catch(e){}
}
/* Pinyin and Meaning follow the characters as they are typed. A field is filled only while it is empty or still holds what was filled in
   last time (MY.auto), so anything typed by hand stays. */
function myFill(){
  const g=id=>document.getElementById(id), T=g('myT'), P=g('myP'), M=g('myM'); if(!T||!P||!M)return;
  const a=MY.auto, x=myGuess(T.value);
  if(!P.value.trim()||P.value===a.p){P.value=x.p;a.p=x.p;}
  if(!M.value.trim()||M.value===a.m){M.value=x.m;a.m=x.m;}
  const eg=!T.value.trim(); P.placeholder=eg?'zhēnzhū nǎichá':''; M.placeholder=eg?'bubble tea':'';   /* the example belongs to the empty form, not to a word being typed */
}
function myHint(e){
  if(e&&e.isComposing)return;                      /* an input method still composing: wait for the characters */
  const T=document.getElementById('myT'), box=document.getElementById('myHintBox'); if(!T||!box)return;
  myFill();
  const t=T.value.trim(), d=myDeck(), cw=myCourseWord(t);
  const dup=Object.keys(d.w).find(id=>d.w[id].t===t&&id!==MY.edit);
  let h='';
  if(dup)h='Already in My words.';
  else if(cw)h='This is a course word (Book '+bookOf(cw.l)+' · Lesson '+lnInBook(cw.l)+'): '+esc(cw.m)+'. You can still add it here.';
  else if(/\p{Script=Han}/u.test(t)){
    const g=myGuess(t);
    if(!DC.map)h=DC.failed?'The dictionary could not be reached, so nothing is looked up. It needs a connection the first time.':'Looking it up…';
    else if(g.src==='dict'&&g.parts&&g.parts.length>1)h='Not in the dictionary as one word, so the pinyin is put together from its parts and the meaning is yours to write: '
      +g.parts.map(x=>'<span class="zh">'+esc(x.t)+'</span> '+esc(x.p)+' <i>'+esc(x.m.split('; ')[0])+'</i>').join(' · ');
    else if(g.src==='dict'&&g.alts.length)h='Also read '+g.alts.map((x,i)=>'<button type="button" class="my-alt" onclick="myUseAlt('+i+')"><b>'+esc(x.p)+'</b> '+esc(x.m)+'</button>').join('');
    else if(g.src!=='dict')h='Not in the dictionary. Type the pinyin and the meaning yourself.';
  }
  box.innerHTML=h?'<div class="my-hint">'+h+'</div>':'';
}
/* take another reading the dictionary lists for these characters. (The characters' blur only fills, it never repaints the hint box:
   a tap on one of these buttons begins with that blur, and a repaint would remove the button before the tap lands.) */
function myUseAlt(i){
  const g=id=>document.getElementById(id), T=g('myT'), P=g('myP'), M=g('myM'); if(!T||!P||!M)return;
  const x=myGuess(T.value).alts[i]; if(!x)return;
  P.value=x.p; M.value=x.m; MY.auto={p:x.p,m:x.m};
}
function mySaveOne(){
  const g=id=>((document.getElementById(id)||{}).value||'').trim(), t=g('myT');
  if(!t){toast('Type the characters first');return;}
  if((!g('myP')||!g('myM'))&&!DC.map&&!DC.failed){toast('Looking it up…');dcLoad().then(()=>{myFill();mySaveOne();});return;}   /* saved before the dictionary arrived */
  let p=g('myP'); const m=g('myM');
  if(!p)p=myGuess(t).p;
  const d=myDeck();
  if(MY.edit&&d.w[MY.edit]){
    Object.assign(d.w[MY.edit],{t,p,m}); myTag(d.w[MY.edit],MY.sel); save(); shClose(); renderMy(); toast('Saved'); return;
  }
  const r=myAdd(t,p,m,MY.sel);
  if(r&&r.dup){toast('“'+esc(t)+'” is already in My words');return;}
  save(); myBadge(); toast('Added '+esc(t));
  ['myT','myP','myM'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';}); MY.auto={p:'',m:''}; myHint();
  const el=document.getElementById('myT'); if(el)el.focus();
  if(view==='my')renderMyKeepSheet();
}
function renderMyKeepSheet(){const host=document.getElementById('vMy');if(host&&MY.mode!=='study'){const keep=document.activeElement;renderMy();try{if(keep&&keep.focus)keep.focus();}catch(e){}}}
const MY_PY=/^[a-zāáǎàēéěèīíǐìōóǒòūúǔùüǖǘǚǜ\s'’·\-0-5]+$/i;
function myParse(text){
  const out=[];
  String(text||'').split(/\n/).forEach(line=>{
    line=line.trim(); if(!line)return;
    let parts=line.split(/\t|[;；|｜]|[,，]/).map(s=>s.trim()).filter(Boolean);
    if(parts.length===1){const mm=line.match(/^([^\sA-Za-z]+)\s+(.+)$/); if(mm)parts=[mm[1],mm[2]];}
    const t=parts[0]; if(!t||!/\p{Script=Han}/u.test(t))return;
    let p='', m='';
    if(parts.length>=3){p=parts[1];m=parts.slice(2).join(', ');if(!MY_PY.test(p)){m=parts.slice(1).join(', ');p='';}}
    else if(parts.length===2){if(MY_PY.test(parts[1])&&/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ1-5]/i.test(parts[1]))p=parts[1];else m=parts[1];}
    const x=myGuess(t); out.push({t,p:p||x.p,m:m||x.m});
  });
  return out;
}
function mySaveMany(){
  if(!DC.map&&!DC.failed){toast('Looking them up…');dcLoad().then(mySaveMany);return;}
  const rows=myParse((document.getElementById('myBulk')||{}).value); if(!rows.length){toast('Nothing to add yet: one word per line, characters first');return;}
  const d=myDeck(); let added=0, dup=0;
  rows.forEach(r=>{
    const x=myAdd(r.t,r.p,r.m,MY.sel); if(!x)return;
    if(x.dup){dup++; if(MY.sel.length)myTag(d.w[x.id],(d.w[x.id].g||[]).concat(MY.sel));}   /* a word already in the deck joins the topics too */
    else added++;
  });
  save(); shClose(); if(view==='my')renderMy(); else myBadge();
  toast('Added '+added+' word'+(added===1?'':'s')+(dup?' · '+dup+' already there':''));
}
function myDelete(id){
  const d=myDeck(), w=d.w[id]; if(!w)return;
  const cards={}; for(const k in d.c)if(k.split(':')[0]===id){cards[k]=d.c[k];delete d.c[k];}
  delete d.w[id]; save(); shClose(); renderMy();
  toast('Deleted '+esc(w.t),{action:'Undo',ms:7000,onAction:()=>{const dd=myDeck();dd.w[id]=w;Object.assign(dd.c,cards);save();renderMy();}});
}

/* ---- the topic editor: rename, delete, add ---- */
function myTopicsSheet(){
  const m=shHost(), d=myDeck(), c=myTopicCounts(), q=s=>esc(s||'').replace(/"/g,'&quot;');
  m.innerHTML=`<div class="modal-card">
    <div class="sheet-h"><b>Topics</b><button class="xbtn" onclick="shClose()" aria-label="close">✕</button></div>
    <div class="small muted" style="margin:-6px 0 12px">The parts of life your words belong to. A word can sit in more than one: choose them when you add a word, or from its ✎.</div>
    <div class="my-tlist">${d.tp.map(t=>`<div class="my-trow"><input class="myin" maxlength="30" value="${q(t.n)}" aria-label="topic name" autocomplete="off" onchange="myTopicRename('${t.id}',this.value)">
      <span class="n">${c[t.id]||0}</span><button class="wbtn" title="delete topic" aria-label="delete topic" onclick="myTopicDelete('${t.id}')">✕</button></div>`).join('')||'<div class="small muted" style="padding:4px 0 8px">No topics yet.</div>'}</div>
    <div class="row" style="gap:8px;margin-top:12px;flex-wrap:nowrap"><input id="myNewT" class="myin" maxlength="30" placeholder="New topic" autocomplete="off" aria-label="new topic" onkeydown="if(event.key==='Enter'){event.preventDefault();myTopicNew();}"><button class="btn" style="flex:none" onclick="myTopicNew()">Add</button></div></div>`;
  m.style.display='flex';
}
/* after a change to the topics: repaint the list behind the sheet, and the sheet if it is the one open */
function myTopicsRefresh(){
  if(view==='my'&&MY.mode!=='study')renderMy();
  const s=document.getElementById('shSheet'); if(s&&s.style.display==='flex'&&s.querySelector('.my-tlist'))myTopicsSheet();
}
function myTopicRename(id,v){
  const d=myDeck(), t=myTopic(id); if(!t)return;
  v=String(v||'').replace(/\s+/g,' ').trim().slice(0,30);
  const clash=v&&d.tp.find(x=>x.id!==id&&x.n.toLowerCase()===v.toLowerCase());
  if(clash)toast('There is already a topic called “'+esc(clash.n)+'”');
  else if(v&&v!==t.n){t.n=v;save();}
  myTopicsRefresh();
}
function myTopicNew(){
  const el=document.getElementById('myNewT'), v=el?el.value:'', n=myDeck().tp.length, id=myTopicAdd(v);
  if(!id){if(el)el.focus();return;}
  if(myDeck().tp.length===n)toast('“'+esc(myTopic(id).n)+'” is already a topic'); else save();
  myTopicsRefresh();
  const again=document.getElementById('myNewT'), list=document.querySelector('#shSheet .my-tlist');
  if(list)list.scrollTop=list.scrollHeight; if(again)again.focus();
}
function myTopicDelete(id){
  const d=myDeck(), at=d.tp.findIndex(t=>t.id===id); if(at<0)return;
  const t=d.tp[at], had=[];
  d.tp.splice(at,1);
  for(const k in d.w){const w=d.w[k]; if(w.g&&w.g.includes(id)){had.push(k);myTag(w,w.g.filter(x=>x!==id));}}
  if(MY.tp===id)MY.tp=null;
  save(); myTopicsRefresh();
  toast('Deleted “'+esc(t.n)+'”'+(had.length?' · its '+(had.length===1?'word stays':had.length+' words stay')+' in My words':''),{action:'Undo',ms:7000,onAction:()=>{
    const dd=myDeck(); if(!dd.tp.some(x=>x.id===id))dd.tp.splice(Math.min(at,dd.tp.length),0,t);
    had.forEach(k=>{const w=dd.w[k]; if(w)myTag(w,(w.g||[]).concat(id));});
    save(); myTopicsRefresh();}});
}

/* ---- study ---- */
function myNext(){
  const q=myQueue(MY.scope);
  MY.cur=q.learn[0]||q.rev[0]||q.fresh[0]||q.ahead[0]||null; MY.shown=false;
}
function myStart(f){MY.mode='study';MY.done=0;MY.scope=f||null;myNext();renderMy();}
function myStop(){MY.mode='list';MY.cur=null;renderMy();if(view==='home')renderHome();}
function myReveal(){
  if(!MY.cur||MY.shown)return; MY.shown=true; myStudyRender();
  const w=myWord(MY.cur); if(w&&S.settings.autoplayAudio!==false&&MY.cur.endsWith(':rec'))playAudio(w.t,w.p||undefined);
}
function myGrade(g){
  if(!MY.cur||!MY.shown)return; try{haptic(g===1?'bad':'ok');}catch(e){}
  myRate(MY.cur,g); MY.done++; myNext(); myStudyRender(); myBadge();
}
function myStudyRender(){
  const host=document.getElementById('vMy'); if(!host)return;
  const q=myQueue(MY.scope), left=q.learn.length+q.rev.length+q.fresh.length, name=myScopeName(MY.scope);
  const top=`<div class="my-top"><span class="link" onclick="myStop()">← My words</span><span>${name?esc(name)+' · ':''}${MY.done} done · ${left} left</span></div>`;
  if(!MY.cur||!myWord(MY.cur)){
    /* a topic that is finished is not a dead end: the rest of the deck is one button away */
    const rest=name?(r=>r.learn.length+r.rev.length+r.fresh.length)(myQueue()):0;
    host.innerHTML=top+`<div class="stage"><div class="done"><div class="zhd zh">做完了</div><div style="font-weight:600;font-size:17px">${name?esc(name)+' is':'My words are'} done for now</div>
      <div class="small muted" style="margin-top:6px">${MY.done} card${MY.done===1?'':'s'} this session${q.waiting?' · '+q.waiting+' new card'+(q.waiting===1?'':'s')+' waiting for tomorrow':''}</div></div></div>
      <div class="row" style="gap:8px;margin-top:14px">${rest?`<button class="btn" style="flex:1" onclick="myStart()">Study the rest · ${rest}</button><button class="btn ghost" onclick="myStop()">My words</button>`
        :`<button class="btn" style="flex:1" onclick="myStop()">Back to My words</button><button class="btn ghost" onclick="go('home')">Today</button>`}</div>`;
    return;
  }
  const w=myWord(MY.cur), id=MY.cur.split(':')[0], prod=MY.cur.endsWith(':prod'), c=myDeck().c[MY.cur];
  const len=[...w.t].length, size=len<=2?78:len<=4?60:len<=6?44:32;
  const zh=`<div class="bigzh" style="font-size:${size}px">${MY.shown?dcZh(w.t):esc(w.t)}</div>`;   /* the answer side's characters open the dictionary */
  const py=w.p?`<div class="pyline">${tonePinyin(esc(w.p))}</div>`:'';
  const mean=`<div class="meaning" style="font-family:inherit">${esc(w.m)||'<span class="muted">no meaning yet</span>'}</div>`;
  const front=prod?`${mean}${py}<div class="hint">write it on paper, then check</div>`:`${zh}<div class="hint">say it and recall the meaning</div>`;
  const back=prod?`${zh}${py}${mean}`:`${zh}${py}${mean}`;
  const tag=`<div class="mtag ${prod?'prod':'rec'}" style="margin-bottom:6px">${prod?'Write':'Recognise'} · My words${!c||c.st===undefined?' · new':''}</div>`;
  host.innerHTML=top+`<div class="stage" ${MY.shown?'':'onclick="myReveal()" style="cursor:pointer"'}>${tag}${MY.shown?back+myTopicPills(w):front}
      ${MY.shown?`<div class="row" style="justify-content:center;gap:8px">${mySpk(id)}<button class="btn sm ghost" onclick="event.stopPropagation();myStrokes('${id}')">Strokes</button><button class="btn sm ghost" onclick="event.stopPropagation();MY.mode='list';myOpenAdd('${id}')">Edit</button></div><div id="myStrokeHost" class="strokerow"></div>`:''}</div>
    ${MY.shown?`<div class="grades">${[[1,'Again'],[2,'Hard'],[3,'Good'],[4,'Easy']].map(([g,l])=>`<button class="g${g}" onclick="myGrade(${g})">${l}<span class="iv">${previewIv(c,'x:rec',g)}</span></button>`).join('')}</div>`
      :`<button class="btn big" style="margin-top:14px" onclick="myReveal()">Show answer</button>`}
    <div class="small muted kbh" style="text-align:center;margin-top:10px"><kbd>space</kbd> show · <kbd>1</kbd>–<kbd>4</kbd> grade · <kbd>esc</kbd> stop</div>`;
}
function myStrokes(id){const w=myDeck().w[id];if(!w)return;try{renderStrokes('myStrokeHost',w.t,{});}catch(e){}}
if(typeof zikaWhole==='function')zikaWhole();   /* the last line: this file arrived whole (index.html, js/boot.js) */
