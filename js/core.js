/* The core: the app's version, books and lessons, storage, the state S and how it is saved, FSRS-5, cards and
   modes, the queue of what is ready to study, the hard list, lanes and leeches. No screen is painted here. */

const APP_VERSION=67;   /* keep in step with VERSION in sw.js — tools/check.mjs verifies it */
/* ============ DATA ============ */
const byId = {}; WORDS.forEach(w=>byId[w.id]=w);
const isName = w => /^a (woman|man) from/.test(w.m)||/name of a (girl|boy|man|woman)|, a (man|woman) from/.test(w.m);
const MAX_LN=BOOKS[BOOKS.length-1].first+BOOKS[BOOKS.length-1].count-1;
const bookAt=ln=>BOOKS.find(b=>ln>=b.first&&ln<b.first+b.count)||BOOKS[BOOKS.length-1];
const bookOf=ln=>bookAt(ln).n;
const bookRange=n=>{const b=BOOKS.find(x=>x.n===n)||BOOKS[0];return [b.first,b.first+b.count-1];};
const lessonsOf=n=>{const [a,z]=bookRange(n);return Array.from({length:z-a+1},(_,i)=>a+i);};
const lnInBook=ln=>ln-bookAt(ln).first+1;
const lnLabel=ln=>'B'+bookOf(ln)+' L'+lnInBook(ln);
const lnShort=ln=>(bookOf(ln)===1?'':bookAt(ln).zh)+lnInBook(ln);
/* Lessons are always chosen book by book: pick the book, then the lesson inside it.
   `js` runs with `v` = the chosen lesson (the internal lesson index never reaches the screen). */
function lessonPick(cur,js){
  const b=bookAt(cur);
  return '<span class="lpick"><select class="vsel" aria-label="Book" onchange="{const v=bookRange(+this.value)[0];'+js+'}">'
    +BOOKS.map(x=>'<option value="'+x.n+'"'+(x.n===b.n?' selected':'')+'>Book '+x.n+'</option>').join('')+'</select>'
    +'<select class="vsel" aria-label="Lesson" onchange="{const v=+this.value;'+js+'}">'
    +lessonsOf(b.n).map(l=>'<option value="'+l+'"'+(l===cur?' selected':'')+'>Lesson '+lnInBook(l)+'</option>').join('')+'</select></span>';
}
const bookButtons=(cur,onclick)=>BOOKS.map(b=>'<button class="'+(cur===b.n?'on':'')+'" data-bk="'+b.n+'"'+(onclick?' onclick="'+onclick(b)+'"':'')+'>'+b.zh+' Book '+b.n+'</button>').join('');

/* ============ SAFE STORAGE ============ */
const store = (()=>{try{const t='__t';localStorage.setItem(t,'1');localStorage.removeItem(t);return localStorage;}catch(e){document.addEventListener('DOMContentLoaded',()=>{document.getElementById('storageBanner').style.display='block'});const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}}})();
const KEY='shida_b1_fsrs_v2';

/* ============ THIS DEVICE ============ */
/* Who this device is: an id made once and kept in this browser's storage (zika_device_id), and a name the learner can
   change in Settings (zika_device); until one is chosen, a guess from what the browser says it is. */
const DEVICE_KEY='zika_device';
function guessDevice(){
  const ua=navigator.userAgent;
  const ipad=/iPad/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(ipad)return 'iPad'; if(/iPhone/.test(ua))return 'iPhone'; if(/Macintosh/.test(ua))return 'Mac';
  if(/Android/.test(ua))return 'Android'; if(/Windows/.test(ua))return 'PC'; return 'Web';
}
const DEVICE={
  id:(()=>{let id=store.getItem(DEVICE_KEY+'_id');if(!id){id=Math.random().toString(36).slice(2,10);store.setItem(DEVICE_KEY+'_id',id);}return id;})(),
  get name(){return store.getItem(DEVICE_KEY)||guessDevice();},
  set name(v){if(v)store.setItem(DEVICE_KEY,v);else store.removeItem(DEVICE_KEY);}
};

/* ============ STATE ============ */
let S = {cards:{}, settings:{retention:0.9, newPerDay:9, maxRev:200, modes:{rec:true,prod:true}, includeNames:false, ghost:true, earlyDrill:true, writeTarget:20, autoplayAudio:true, speechRate:0.85, voiceName:'', strokeAnim:true}, log:{}, intro:{}, hist:{d:[],s:[]} };
/* The saved deck is read here, the moment S exists, and not at start-up: the page's buttons work as soon as their
   script has loaded, so a tap in the gap before js/boot.js runs must never find (and then save) an empty deck.
   Cards are "w123:rec" / "w123:prod" / "g:n22-1" -> {st:'learn'|'rev'|'relearn', S, D, due, last, reps, lapses, days, known, susp}. */
function deckLoad(){
  try{
    const raw=store.getItem(KEY);
    if(raw){const p=JSON.parse(raw); S={...S,...p, settings:{...S.settings,...(p.settings||{}), modes:{rec:true,prod:true,...((p.settings||{}).modes||{})}}};}
    else{
      const old=store.getItem('shida_b1_fsrs_v1');
      if(old){ // migrate v1 (hw/mean/pin) -> v2 (rec/prod)
        const p=JSON.parse(old);
        const cards={};
        for(const cid in (p.cards||{})){
          const parts=cid.split(':'), wid=parts[0], m=parts[1], c=p.cards[cid];
          if(m==='mean')cards[wid+':rec']=c;
          else if(m==='hw')cards[wid+':prod']=c;
          else if(m==='pin'){const k=wid+':prod'; if(!cards[k]||cards[k].st===undefined)cards[k]=(cards[k]&&cards[k].st!==undefined)?cards[k]:c;}
        }
        S.cards=cards; S.log=p.log||{}; S.intro={};
        const os=p.settings||{};
        S.settings.retention=os.retention||0.9;
        S.settings.maxRev=os.maxRev||200;
        S.settings.includeNames=!!os.includeNames;
        S.settings.ghost=os.ghost!==false;
        store.setItem(KEY,JSON.stringify(S));   /* stored at once under the current key; nothing else is running yet */
      }
    }
  }catch(e){}
}
deckLoad();
/* The one place the deck is written to this device. Two refusals protect it from a page that is not really running:
   - nothing is written before start-up has loaded and migrated the deck (DECK_READY, set in js/boot.js);
   - a deck with no cards never replaces a stored one that has cards, unless the learner asked for exactly that
     (erase, import, restore, taking the cloud's copy: each sets DECK_EMPTY_OK). DECK_HELD says it was refused,
     and while it is set nothing goes to the cloud or the backup file either.
   A third way of not being stored is not the app's doing: the browser refuses the write (its storage is full, or has
   been switched off under the page). The deck in memory is then ahead of the one on the device and would be lost
   with the page, so it is said on screen (shSaveWarn, js/shell.js) from the first write that fails (DECK_UNSTORED, the
   time of it) until one succeeds. It answers true only when the deck is on the device. */
let DECK_READY=false, DECK_EMPTY_OK=false, DECK_HELD=false, DECK_UNSTORED=0;
function deckStore(){
  if(!DECK_READY)return false;
  try{
    if(!DECK_EMPTY_OK&&!Object.keys(S.cards||{}).length){const old=store.getItem(KEY);if(old&&/"cards":\{"/.test(old)){DECK_HELD=true;return false;}}
    store.setItem(KEY,JSON.stringify(S)); DECK_HELD=false;
  }catch(e){
    if(!DECK_UNSTORED){DECK_UNSTORED=Date.now();try{shSaveWarn();}catch(e2){}}
    return false;
  }
  if(DECK_UNSTORED){DECK_UNSTORED=0;try{shSaveWarn();}catch(e){}}
  return true;
}
const MASTER_S=45; // days of stability = "mastered"
/* Every change to S ends in save(). Many changes in one tick make one write (saveNow): the state is stored, the
   backup file and the cloud push are queued, and whatever cached a view of the deck is told it is stale. */
let savePending=false;
function save(){
  if(!DECK_READY)return;                      /* start-up has not loaded the deck yet: nothing to save, nothing to send */
  SYNC.gen=(SYNC.gen||0)+1;                  /* a push that began before this change must not clear the dirty mark */
  if(savePending)return; savePending=true;
  queueMicrotask(()=>{savePending=false;try{saveNow();}catch(e){}});
}
/* store the deck on this device and queue the backup file; nothing else */
function saveLocal(){if(deckStore())bkQueue();}
function saveNow(){
  QV++;                                       /* the cached queue is out of date */
  try{S.conf=confSnapshot();}catch(e){}       /* the confidence snapshot travels with every copy of the deck */
  if(!DECK_READY)return;
  deckStore();
  if(DECK_HELD)return;                        /* an empty deck was refused: it does not go to the backup or the cloud either */
  bkQueue();
  if(SYNC.applying)return;                    /* taking the cloud's copy is not a change made here */
  SYNC.dirty=true;syncMetaSave();fbSchedulePush();
}

/* Settings that belong to this device and not to the deck. When a deck arrives from somewhere else (another device's
   copy, an imported file) these keep the value the device already has. New ones are added here (CLAUDE.md, rule 4). */
const LOCAL_SETTINGS=['voiceName','audioSrc','theme','lastBackup','bkName','autoBackup','haptics','_bkWarned'];   /* kept when this device has a value */
const STRICT_LOCAL=['preloadedAt'];   /* facts about this device only: never inherited from another one */
function strictLocalGet(){const own={};STRICT_LOCAL.forEach(k=>{if(S.settings&&k in S.settings)own[k]=S.settings[k];});return own;}
function strictLocalPut(own){STRICT_LOCAL.forEach(k=>{if(k in own)S.settings[k]=own[k];else delete S.settings[k];});}

/* ============ FSRS-5 ============ */
const W=[0.40255,1.18385,3.173,15.69105,7.1949,0.5345,1.4604,0.0046,1.54575,0.1192,1.01925,1.9395,0.11,0.29605,2.2698,0.2315,2.9898,0.51655,0.6621];
const DECAY=-0.5, FACTOR=19/81, DAY=86400000, MIN=60000;
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const retrievability=(t,s)=>Math.pow(1+FACTOR*t/s,DECAY);
function nextIntervalDays(s){const r=S.settings.retention;return clamp(Math.round(s/FACTOR*(Math.pow(r,1/DECAY)-1)),1,365);}
const initS=g=>W[g-1];
const initD=g=>clamp(W[4]-Math.exp(W[5]*(g-1))+1,1,10);
function updD(d,g){let nd=d-W[6]*(g-3)*((10-d)/9);nd=W[7]*initD(4)+(1-W[7])*nd;return clamp(nd,1,10);}
function stabRecall(s,d,r,g){const hard=g===2?W[15]:1, easy=g===4?W[16]:1;return s*(Math.exp(W[8])*(11-d)*Math.pow(s,-W[9])*(Math.exp(W[10]*(1-r))-1)*hard*easy+1);}
function stabForget(s,d,r){return Math.min(s, W[11]*Math.pow(d,-W[12])*(Math.pow(s+1,W[13])-1)*Math.exp(W[14]*(1-r)));}
function stabShort(s,g){return s*Math.exp(W[17]*(g-3+W[18]));}
function fuzz(days){if(days<3)return days;const f=days*0.05;return Math.round(days+(Math.random()*2-1)*f);}
// early-drill: force writing cards back on day 1, 2, 3 before FSRS takes over
function capEarly(c,cid,days){
  if(!S.settings.earlyDrill||modeOf(cid)!=='prod')return days;
  const d=(c&&c.days)||0;
  if(d===0)return Math.min(days,1);
  if(d===1)return Math.min(days,2);
  if(d===2)return Math.min(days,3);
  return days;
}
function previewIv(c,cid,g){
  const now=Date.now();
  const fmt=d=>d+'d';
  if(!c||c.st===undefined){
    if(g===1)return'1m'; if(g===2)return'5m'; if(g===3)return'10m';
    return fmt(capEarly(c,cid,nextIntervalDays(initS(4))));
  }
  if(c.st==='learn'||c.st==='relearn'){
    if(g===1)return'1m'; if(g===2)return'5m';
    return fmt(capEarly(c,cid,Math.max(1,nextIntervalDays(stabShort(c.S,g)))));
  }
  const t=Math.max(0.01,(now-c.last)/DAY), r=retrievability(t,c.S);
  if(g===1)return'5m';
  return fmt(capEarly(c,cid,nextIntervalDays(stabRecall(c.S,c.D,r,g))));
}
function wordStartedBefore(wid){return MODES.some(m=>{const c=S.cards[cardId(wid,m)];return c&&c.st!==undefined;});}
/* One answer on one card: `g` is 1 Again, 2 Hard, 3 Good, 4 Easy. Updates the card (FSRS-5), the day's counts,
   and which daily allowance a newly started word was taken from. */
function rate(cid,g){
  const now=Date.now(), today=dkey(new Date()), gram=isGram(cid);
  const fresh=!S.cards[cid]||S.cards[cid].st===undefined, introBefore=S.intro[today]||0;
  /* a word started for the first time counts against its lane's allowance; worked out before the card changes */
  const lane=!gram&&fresh&&!wordStartedBefore(cid.split(':')[0])?laneOf(cid):null;

  let c=S.cards[cid];
  S.log[today]=S.log[today]||{rev:0,new:0};
  const schedule=(days)=>{days=capEarly(c,cid,days);c.due=now+fuzz(days)*DAY;c.days=(c.days||0)+1;};
  if(fresh){
    const wid=cid.split(':')[0];
    if(!wordStartedBefore(wid)){S.intro[today]=(S.intro[today]||0)+1;if(S.pick)S.pick=S.pick.filter(x=>x!==wid);}
    c={st:'learn',S:initS(g),D:initD(g),due:0,last:now,reps:1,lapses:0,days:0};
    S.cards[cid]=c;
    S.log[today].new++;
    if(g===1)c.due=now+1*MIN; else if(g===2)c.due=now+5*MIN; else if(g===3)c.due=now+10*MIN;
    else {c.st='rev'; schedule(nextIntervalDays(c.S));}
  } else if(c.st==='learn'||c.st==='relearn'){
    S.log[today].rev++;
    c.reps++;c.last=now;c.S=stabShort(c.S,g);c.D=updD(c.D,g);
    if(g===1)c.due=now+1*MIN; else if(g===2)c.due=now+5*MIN;
    else {c.st='rev'; schedule(Math.max(1,nextIntervalDays(c.S)));}
  } else {
    S.log[today].rev++;
    const t=Math.max(0.01,(now-c.last)/DAY), r=retrievability(t,c.S);
    const d0=c.D;            /* FSRS-5: the new stability uses the difficulty the card had going in */
    c.D=updD(d0,g); c.reps++; c.last=now;
    if(g===1){c.lapses++;c.S=stabForget(c.S,d0,r);c.st='relearn';c.due=now+5*MIN;}
    else {c.S=stabRecall(c.S,d0,r,g);schedule(nextIntervalDays(c.S));}
  }
  /* mastery timestamps for the Brain view */
  if(c.st==='rev'&&c.S>=MASTER_S){if(!c.mastAt)c.mastAt=now;}
  else if(c.mastAt){delete c.mastAt;}
  save();

  sibClaim(cid);                                   /* the word is this card's for today: its sibling waits */
  /* a grammar card is not a word: it counts against the grammar allowance, never the word one */
  if(gram){S.intro[today]=introBefore;if(fresh){S.gintro=S.gintro||{};S.gintro[today]=(S.gintro[today]||0)+1;}save();}
  /* leeches: the 4th miss puts the word on the hard list, the 7th parks the card until it is un-parked in Settings */
  if(!gram&&g===1)try{
    const wid=cid.split(':')[0];
    if(c.lapses===LEECH_TAG){addHard(wid);toast('4th miss on '+esc(byId[wid].t)+' — on the hard list and tonight’s paper');}
    if(c.lapses>=LEECH_PARK&&!c.susp){c.susp=1;c.leech=1;save();addHard(wid);toast('Leech parked: '+esc(byId[wid].t)+' · un-park it in Settings → Card strategy',{ms:6000});
      if(rq){['learn','rev','fresh'].forEach(k=>{rq[k]=rq[k].filter(x=>x!==cid);});}}
  }catch(e){}
  if(lane==='catch'){S.intro[today]=introBefore;S.cintro=S.cintro||{};S.cintro[today]=(S.cintro[today]||0)+1;save();}
}

/* ============ CARDS / MODES ============ */
const MODES=['rec','prod'];
const MODE_LABEL={rec:'Recognize · 認字',prod:'Write · 聽寫'};
function cardId(wid,m){return wid+':'+m;}
function wordOf(cid){return byId[cid.split(':')[0]];}
function modeOf(cid){return cid.split(':')[1];}
function tracked(wid){return MODES.some(m=>S.cards[cardId(wid,m)]);}
function trackWord(wid){MODES.forEach(m=>{if(S.settings.modes[m]&&!S.cards[cardId(wid,m)])S.cards[cardId(wid,m)]={};});save();}
function untrackWord(wid){MODES.forEach(m=>{delete S.cards[cardId(wid,m)];});save();}
function markKnown(wid){ // "I already know this" — skip learning, verify in ~3 weeks
  if(isHard(wid))S.hard=S.hard.filter(x=>x!==wid);
  if(S.pick)S.pick=S.pick.filter(x=>x!==wid);
  MODES.forEach(m=>{
    if(!S.settings.modes[m])return;
    const k=cardId(wid,m), c=S.cards[k];
    if(c&&c.st==='rev'&&c.S>=21)return;
    S.cards[k]={st:'rev',S:21,D:4,due:Date.now()+fuzz(21)*DAY,last:Date.now(),reps:1,lapses:0,days:99,known:1};
  });
  save();
}
function markMastered(wid){ // "I've mastered this" — straight onto the shelf, resurface in ~3 months, NO paper reps
  if(isHard(wid))S.hard=S.hard.filter(x=>x!==wid);
  if(S.pick)S.pick=S.pick.filter(x=>x!==wid);
  MODES.forEach(m=>{
    if(!S.settings.modes[m])return;
    S.cards[cardId(wid,m)]={st:'rev',S:90,D:3,due:Date.now()+fuzz(90)*DAY,last:Date.now(),reps:1,lapses:0,days:99,known:1,mastAt:Date.now()};
  });
  save();
}
function isKnown(wid){return MODES.some(m=>(S.cards[cardId(wid,m)]||{}).known);}
function wordStatus(wid){
  let states=MODES.map(m=>S.cards[cardId(wid,m)]).filter(Boolean);
  if(!states.length)return null;
  const real=states.filter(c=>c.st!==undefined);
  if(!real.length)return{k:'new',t:'queued'};
  if(real.some(c=>c.due<=Date.now()))return{k:'due',t:'due'};
  if(real.length===states.length&&Math.min(...real.map(c=>c.S||0))>=21)return{k:'mat',t:'solid'};
  return{k:'ok',t:'learning'};
}
function dkey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
/* nothing has been studied here: no started card, no hard list, no day with a review in it */
function localEmpty(){
  if(Object.values(S.cards||{}).some(c=>c&&c.st!==undefined))return false;
  if((S.hard||[]).length)return false;
  return !Object.keys(S.log||{}).some(k=>((S.log[k]||{}).rev||0)+((S.log[k]||{}).new||0)>0);
}

/* ============ QUEUE ============ */
/* What is ready to study now: {learn, rev, fresh}, each a list of card ids in the order they are served.
   Built in steps (words, grammar cards, write cards out of scope, the backlog after days away, the per-lane
   allowance of new words) and kept for 400 ms, because one paint asks for it several times. `QV` moves on
   every save, which drops the kept copy. */
let QV=0, QCACHE=null;
function buildQueue(){
  const now=Date.now();
  if(QCACHE&&QCACHE.v===QV&&now-QCACHE.t<400){const q=QCACHE.q;return {learn:q.learn.slice(),rev:q.rev.slice(),fresh:q.fresh.slice()};}
  const q=queueLanes(queueBacklog(queueScope(queueGrammar(queueWords()))));
  QCACHE={v:QV,t:now,q:{learn:q.learn.slice(),rev:q.rev.slice(),fresh:q.fresh.slice()}};
  return q;
}
/* word cards: learning steps, due reviews (siblings kept apart), and the new ones the day still allows */
function queueWords(){
  const now=Date.now(), today=dkey(new Date());
  const introToday=S.intro[today]||0;
  const learn=[],rev=[],freshAll=[];
  for(const cid in S.cards){
    const c=S.cards[cid], w=wordOf(cid); if(!w)continue;
    if(c.susp)continue;
    if(!S.settings.includeNames&&isName(w))continue;
    if(!S.settings.modes[modeOf(cid)])continue;
    if(c.st===undefined){freshAll.push(cid);continue;}   /* new pairs are never buried */
    /* a write card that is out of scope is never served, so it must not hold the word ahead of its sibling */
    if(modeOf(cid)==='prod'&&typeof prodInScope==='function'&&!prodInScope(w.id))continue;
    if(c.st==='rev'&&sibBuried(cid))continue;            /* sibling already done today; learning steps always finish */
    if(c.due<=now){(c.st==='rev'?rev:learn).push(cid);}
  }
  learn.sort((a,b)=>S.cards[a].due-S.cards[b].due);
  rev.sort((a,b)=>S.cards[a].due-S.cards[b].due);

  /* both siblings due and neither claimed yet → keep the earlier one, defer the other */
  if(S.settings.burySib){
    const seen={};
    const thin=list=>list.filter(cid=>{
      const wid=cid.split(':')[0];
      if(seen[wid])return false;
      seen[wid]=cid; return true;
    });
    const L=thin(learn), R=thin(rev);
    learn.length=0; learn.push(...L);
    rev.length=0;   rev.push(...R);
  }

  const mOrd={rec:0,prod:1};
  const pickIdx=wid=>{const i=(S.pick||[]).indexOf(wid);return i===-1?9999:i;};
  freshAll.sort((a,b)=>{const wa=wordOf(a),wb=wordOf(b);return pickIdx(wa.id)-pickIdx(wb.id)||wa.l-wb.l||parseInt(wa.id.slice(1))-parseInt(wb.id.slice(1))||mOrd[modeOf(a)]-mOrd[modeOf(b)];});

  const allowance = S.settings.newUnlimited ? Infinity : Math.max(0,S.settings.newPerDay-introToday);
  const planned=new Set(); const fresh=[];
  for(const cid of freshAll){
    const wid=cid.split(':')[0];
    if(wordStartedBefore(wid)||planned.has(wid)){fresh.push(cid);continue;}
    if(planned.size<allowance){planned.add(wid);fresh.push(cid);}
  }
  const revCap = S.settings.revUnlimited ? rev.length : S.settings.maxRev;
  return {learn,rev:rev.slice(0,revCap),fresh};
}
/* grammar cards ride along with the word cards */
function queueGrammar(q){
  if(S.settings.gramCards===false)return q;
  const now=Date.now(), today=dkey(new Date());
  const fresh=[],learn=[],rev=[];
  for(const cid in S.cards){
    if(!isGram(cid))continue; const c=S.cards[cid]; if(!c||c.susp||!GP[cid.slice(2)])continue;
    if(c.st===undefined){fresh.push(cid);continue;}
    if(c.due<=now)(c.st==='rev'?rev:learn).push(cid);
  }
  const _cl=S.settings.curLesson||26; fresh.sort((a,b)=>((GP[b.slice(2)].l>=_cl-1)-(GP[a.slice(2)].l>=_cl-1))||(GP[b.slice(2)].l-GP[a.slice(2)].l));
  const allow=Math.max(0,(S.settings.newGramPerDay??4)-((S.gintro||{})[today]||0));
  q.learn=q.learn.concat(learn).sort((a,b)=>S.cards[a].due-S.cards[b].due);
  q.rev=q.rev.concat(rev.sort((a,b)=>S.cards[a].due-S.cards[b].due));
  q.fresh=q.fresh.concat(fresh.slice(0,allow));
  return q;
}
/* write cards are only served for words in scope (Settings → Card strategy) */
function queueScope(q){
  if((S.settings.prodScope||'current')==='all')return q;
  const keep=cid=>!(modeOf(cid)==='prod'&&!prodInScope(cid.split(':')[0]));
  q.learn=q.learn.filter(keep); q.rev=q.rev.filter(keep); q.fresh=q.fresh.filter(keep);
  return q;
}
/* after days away the pile of due reviews is served a quarter at a time, the live lesson and the cards most
   likely still remembered first, and new words wait; BACKLOG tells Today that this is happening */
function queueBacklog(q){
  BACKLOG=null;
  try{
    const now=Date.now(), maxRev=S.settings.revUnlimited?9999:(S.settings.maxRev||200), cl=S.settings.curLesson||23;
    const due=[];
    for(const cid in S.cards){const c=S.cards[cid],w=wordOf(cid);if(!w||!c||c.susp||c.st!=='rev'||c.due>now)continue;if(!S.settings.includeNames&&isName(w))continue;if(!S.settings.modes[modeOf(cid)])continue;if(modeOf(cid)==='prod'&&!prodInScope(w.id))continue;if(sibBuried(cid))continue;due.push(cid);}
    const gap=lastStudyGap();
    if(!(due.length>maxRev*1.25||(gap>=5&&due.length>40)))return q;
    const live=cid=>{const w=wordOf(cid);return w.l>=cl-1||isHard(w.id);};
    const R=cid=>{const c=S.cards[cid];return retrievability(Math.max(0.01,(now-c.last)/DAY),c.S);};
    due.sort((a,b)=>(live(b)-live(a))||(R(b)-R(a)));
    if(S.settings.burySib){const seen=new Set();for(let i=0;i<due.length;i++){const wid=due[i].split(':')[0];if(seen.has(wid))due.splice(i--,1);else seen.add(wid);}}
    const today=Math.min(maxRev,Math.max(60,Math.ceil(due.length/4)));
    const gram=q.rev.filter(isGram);
    q.rev=due.slice(0,today).concat(gram);
    q.fresh=q.fresh.filter(isGram);
    BACKLOG={due:due.length,today,gap,live:due.filter(live).length};
  }catch(e){}
  return q;
}
/* new words are let in lane by lane: this week's lessons and the catch-up lane each have their own daily allowance */
function queueLanes(q){
  try{
    const today=dkey(new Date()), now=Date.now();
    const allow={live:Math.max(0,(S.settings.newUnlimited?9999:(S.settings.newPerDay??8))-((S.intro||{})[today]||0)),catch:Math.max(0,(S.settings.newCatchPerDay??5)-((S.cintro||{})[today]||0)),maint:0};
    const all=[];
    for(const cid in S.cards){const c=S.cards[cid];if(!c||c.susp||c.st!==undefined||isGram(cid))continue;const w=wordOf(cid);if(!w)continue;if(!S.settings.includeNames&&isName(w))continue;if(!S.settings.modes[modeOf(cid)])continue;if(modeOf(cid)==='prod'&&!prodInScope(w.id))continue;all.push(cid);}
    const mOrd={rec:0,prod:1}, pickIdx=wid=>{const i=(S.pick||[]).indexOf(wid);return i===-1?9999:i;};
    all.sort((a,b)=>{const wa=wordOf(a),wb=wordOf(b);return pickIdx(wa.id)-pickIdx(wb.id)||wa.l-wb.l||parseInt(wa.id.slice(1))-parseInt(wb.id.slice(1))||mOrd[modeOf(a)]-mOrd[modeOf(b)];});
    const planned={live:new Set(),catch:new Set(),maint:new Set()}, fresh=[];
    for(const cid of all){const wid=cid.split(':')[0], k=laneOf(cid);
      if(wordStartedBefore(wid)||planned[k].has(wid)){fresh.push(cid);continue;}
      if(planned[k].size<allow[k]){planned[k].add(wid);fresh.push(cid);}}
    const gf=q.fresh.filter(isGram).sort((a,b)=>((laneOf(b)==='live')-(laneOf(a)==='live'))||(GP[b.slice(2)].l-GP[a.slice(2)].l));
    q.fresh=BACKLOG?gf:fresh.concat(gf);
  }catch(e){}
  return q;
}
function dueCount(){const q=buildQueue();return q.learn.length+q.rev.length+q.fresh.length;}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function shuf(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function sample(a,n,excl){const pool=a.filter(x=>!excl.includes(x));return shuf(pool).slice(0,n);}

function isHard(wid){return (S.hard||[]).includes(wid);}
function addHard(wid){S.hard=S.hard||[];if(!S.hard.includes(wid))S.hard.push(wid);if(!tracked(wid))trackWord(wid);save();}
function dropHard(wid){S.hard=(S.hard||[]).filter(x=>x!==wid);save();}
function toggleHard(wid){isHard(wid)?dropHard(wid):addHard(wid);}

function sibToday(){const t=dkey(new Date());S.sib[t]=S.sib[t]||{};return S.sib[t];}
/* claim a word for one card — called on every grade */
function sibClaim(cid){
  if(!S.settings.burySib)return;
  const wid=cid.split(':')[0], m=sibToday();
  if(!m[wid]) m[wid]=cid;
}
/* a started card is buried when its word is already owned today by its sibling */
function sibBuried(cid){
  if(!S.settings.burySib)return false;
  const wid=cid.split(':')[0], owner=sibToday()[wid];
  return !!owner && owner!==cid;
}

/* lesson buckets, built once — replaces 60 full WORDS scans per render */
var LESSON_WORDS={};
(function(){for(const w of WORDS){(LESSON_WORDS[w.l]=LESSON_WORDS[w.l]||[]).push(w);}})();

/* ---- 2. the production card: audio-first 聽寫 card, scoped to the live lesson + hard list ---- */
function prodInScope(wid){
  const r=(S.mtest&&S.mtest.res||{})[wid];if(r==='l'||r==='h')return true;
  const sc=S.settings.prodScope||'current'; if(sc==='all')return true; if(sc==='off')return false;
  const w=byId[wid]; if(!w)return false; const cl=S.settings.curLesson||23;
  return w.l>=cl-1||isHard(wid);
}

/* ---- 1. leeches ---- */
const LEECH_TAG=4, LEECH_PARK=7;
function leechList(){return Object.keys(S.cards).filter(c=>S.cards[c]&&S.cards[c].leech&&S.cards[c].susp);}
function leechUnpark(cid){const c=S.cards[cid];if(!c)return;delete c.susp;delete c.leech;c.lapses=Math.min(c.lapses||0,2);save();badge();renderSet();}

/* ---- 2. backlog mode ---- */
let BACKLOG=null;
function lastStudyGap(){const ks=Object.keys(S.log||{}).filter(k=>(S.log[k].rev||0)+(S.log[k].new||0)>0).sort();if(!ks.length)return 0;const d=new Date(ks[ks.length-1]);d.setHours(0,0,0,0);return Math.floor((Date.now()-d.getTime())/DAY);}

function laneOf(cid){
  const cl=S.settings.curLesson||26;
  if(isGram(cid)){const gp=GP[cid.slice(2)];return gp&&gp.l>=cl-1?'live':'maint';}
  const w=wordOf(cid); if(!w)return 'maint';
  if(w.l>=cl-1)return 'live';
  const r=(S.mtest&&S.mtest.res||{})[w.id];
  if(r==='l'||r==='h'||isHard(w.id))return 'catch';
  return 'maint';
}
function laneCounts(){
  const q=buildQueue(), out={live:{due:0,fresh:0},catch:{due:0,fresh:0},maint:{due:0,fresh:0}};
  q.learn.concat(q.rev).forEach(c=>out[laneOf(c)].due++); q.fresh.forEach(c=>out[laneOf(c)].fresh++);
  return out;
}
function fmtDay(ms){const d=new Date(ms),t=new Date();t.setHours(0,0,0,0);const dd=Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate())-t)/DAY);const wd=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];return dd<=0?'today':dd===1?'tomorrow':dd<7?wd:(wd+' '+(d.getMonth()+1)+'/'+d.getDate());}
/* a moment as text: the clock time (with the date when it is not today), and how long ago */
function fmtT(t){if(!t)return '—';const d=new Date(t);const today=dkey(new Date())===dkey(d);return (today?'':dkey(d)+' ')+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function ago(t){if(!t)return 'never';const s=Math.floor((Date.now()-t)/1000);if(s<8)return 'just now';if(s<60)return s+' s ago';if(s<3600)return Math.round(s/60)+' min ago';if(s<86400)return Math.round(s/3600)+' h ago';return Math.round(s/86400)+' d ago';}

/* one state shape, whatever path loaded it (import, snapshot restore, cloud adopt) */
function normalizeState(){
  S.settings=S.settings||{}; S.settings.modes=Object.assign({rec:true,prod:true},S.settings.modes||{});
  if(!S.settings.retention)S.settings.retention=0.9; if(S.settings.newPerDay==null)S.settings.newPerDay=8; if(!S.settings.maxRev)S.settings.maxRev=300; if(!S.settings.writeTarget)S.settings.writeTarget=20;
  S.cards=S.cards||{}; S.pick=S.pick||[]; S.hard=S.hard||[]; S.log=S.log||{}; S.intro=S.intro||{}; S.hist=S.hist||{d:[],s:[]}; S.sib=S.sib||{}; S.cf=S.cf||{}; S.gram=S.gram||{};
}
if(typeof zikaWhole==='function')zikaWhole();   /* the last line: this file arrived whole (index.html, js/boot.js) */
