/* ---- 1. config ---- */
/* Paste the web-app config from Firebase console → Project settings → Your apps here.
   Leave null to paste it in Settings → Cloud sync instead (stored in this browser). */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCIf0BwaqeRpraxEafWvQfGD1go06E1UKk",
  authDomain: "zika-sync.firebaseapp.com",
  databaseURL: "https://zika-sync-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "zika-sync",
  storageBucket: "zika-sync.firebasestorage.app",
  messagingSenderId: "804757392175",
  appId: "1:804757392175:web:6b37530a09b58e9317efda"
};
const FB_CFG_KEY='zika_fb_config', FB_ROOM_KEY='zika_sync_code', FB_DEV_KEY='zika_device', FB_META_KEY='zika_sync_meta';
const FB_SDK='https://www.gstatic.com/firebasejs/10.12.0/';
function fbConfig(){
  if(FIREBASE_CONFIG&&FIREBASE_CONFIG.databaseURL)return FIREBASE_CONFIG;
  try{const r=store.getItem(FB_CFG_KEY);if(r){const c=JSON.parse(r);if(c&&c.databaseURL)return c;}}catch(e){}
  return null;
}
function fbSaveConfig(txt){
  txt=String(txt||'').trim();
  if(!txt){store.removeItem(FB_CFG_KEY);toast('Firebase config cleared');return renderSet();}
  let c=null;
  try{c=JSON.parse(txt);}catch(e){
    /* accept the JS-object form the console shows: keys without quotes, trailing commas, a leading "const firebaseConfig =" */
    try{c=Function('"use strict";return ('+txt.replace(/^[^{]*/,'').replace(/;\s*$/,'')+')')();}catch(e2){}
  }
  if(!c||!c.databaseURL||!c.apiKey){alert('That does not look like a Firebase web config — it needs apiKey and databaseURL.');return;}
  store.setItem(FB_CFG_KEY,JSON.stringify(c));
  toast('Firebase config saved — connecting…');
  fbLoad(); renderSet();
}

/* ---- 2. device identity ---- */
function guessDevice(){
  const ua=navigator.userAgent;
  const ipad=/iPad/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(ipad)return 'iPad'; if(/iPhone/.test(ua))return 'iPhone'; if(/Macintosh/.test(ua))return 'Mac';
  if(/Android/.test(ua))return 'Android'; if(/Windows/.test(ua))return 'PC'; return 'Web';
}
const DEVICE={
  id:(()=>{let id=store.getItem(FB_DEV_KEY+'_id');if(!id){id=Math.random().toString(36).slice(2,10);store.setItem(FB_DEV_KEY+'_id',id);}return id;})(),
  get name(){return store.getItem(FB_DEV_KEY)||guessDevice();},
  set name(v){if(v)store.setItem(FB_DEV_KEY,v);else store.removeItem(FB_DEV_KEY);}
};

/* ---- 3. sync state ---- */
const SYNC={status:'off',code:'',at:0,remoteAt:0,remoteDev:'',dirty:false,timer:null,fb:null,unsub:null,uid:null,
  online:navigator.onLine,lastErr:'',pushing:false,again:false,revert:null,applying:false,first:true,retry:0,log:[],okTimer:null,quietTimer:null};
function syncMetaSave(){try{store.setItem(FB_META_KEY,JSON.stringify({at:SYNC.at,dirty:SYNC.dirty,remoteDev:SYNC.remoteDev}));}catch(e){}}
function normCode(c){return String(c||'').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,40);}
function fbPath(){return 'rooms/'+SYNC.code+'/study_state';}
/* nothing has been studied here: no started card, no hard list, no day with a review in it */
function localEmpty(){
  if(Object.values(S.cards||{}).some(c=>c&&c.st!==undefined))return false;
  if((S.hard||[]).length)return false;
  return !Object.keys(S.log||{}).some(k=>((S.log[k]||{}).rev||0)+((S.log[k]||{}).new||0)>0);
}
function fmtT(t){if(!t)return '—';const d=new Date(t);const today=dkey(new Date())===dkey(d);return (today?'':dkey(d)+' ')+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function ago(t){if(!t)return 'never';const s=Math.floor((Date.now()-t)/1000);if(s<8)return 'just now';if(s<60)return s+' s ago';if(s<3600)return Math.round(s/60)+' min ago';if(s<86400)return Math.round(s/3600)+' h ago';return Math.round(s/86400)+' d ago';}
function fbLogLocal(kind,extra){SYNC.log.unshift({at:Date.now(),kind,extra:extra||''});if(SYNC.log.length>40)SYNC.log.pop();}

/* the blob we write: the full state as JSON (Firebase drops empty objects and
   coerces numeric keys, so the state itself travels as a string) plus readable mirrors */
function fbPayload(at){
  const json=JSON.stringify(S);
  const conf={}; try{const w=(S.conf&&S.conf.words)||{};for(const k in w)conf[k.replace(/[.#$\[\]\/]/g,'_')]=w[k];}catch(e){}
  let due=0,started=0; try{const q=buildQueue();due=q.learn.length+q.rev.length+q.fresh.length;started=Object.values(S.cards).filter(c=>c.st!==undefined).length;}catch(e){}
  return {v:18,json,device:DEVICE.name,device_id:DEVICE.id,synced_at:at,bytes:json.length,
    conf,hard_list:(S.hard||[]).slice(),summary:{cards:Object.keys(S.cards).length,started,due,streak:streakCount()}};
}

/* ---- 4. SDK loading (module script injected at runtime; retried when we come back online) ---- */
let fbLoading=false;
function fbLoad(){
  if(SYNC.fb||fbLoading)return; if(!fbConfig()){syncUI('off');return;}
  if(window.__fbSDK){fbBoot();return;}
  fbLoading=true; syncUI('connecting');
  const s=document.createElement('script'); s.type='module';
  s.textContent=`import{initializeApp}from'${FB_SDK}firebase-app.js';
import{getDatabase,ref,set,get,onValue,push,serverTimestamp}from'${FB_SDK}firebase-database.js';
import{getAuth,signInAnonymously,onAuthStateChanged}from'${FB_SDK}firebase-auth.js';
window.__fbSDK={initializeApp,getDatabase,ref,set,get,onValue,push,serverTimestamp,getAuth,signInAnonymously,onAuthStateChanged};
window.fbBoot();`;
  s.onerror=()=>{fbLoading=false;SYNC.lastErr='Could not load the Firebase SDK';syncUI(navigator.onLine?'error':'offline');};
  document.head.appendChild(s);
  /* a module import failure does not fire onerror on the tag — poll instead */
  setTimeout(()=>{if(!window.__fbSDK&&fbLoading){fbLoading=false;SYNC.lastErr='Firebase SDK did not load (offline?)';syncUI(navigator.onLine?'error':'offline');}},8000);
}

window.fbBoot=async function(){
  fbLoading=false;
  const sdk=window.__fbSDK, cfg=fbConfig();
  if(!sdk||!cfg){syncUI('off');return;}
  if(SYNC.fb)return;
  try{
    const app=sdk.initializeApp(cfg), db=sdk.getDatabase(app), auth=sdk.getAuth(app);
    SYNC.fb=Object.assign({},sdk,{app,db,auth});
    syncUI('connecting');
    sdk.onAuthStateChanged(auth,u=>{if(u&&!SYNC.uid){SYNC.uid=u.uid;fbLogLocal('auth',u.uid.slice(0,6));fbStart();}});
    sdk.onValue(sdk.ref(db,'.info/connected'),s=>{
      const on=!!s.val(); SYNC.online=on;
      if(!on){if(SYNC.status!=='off')syncUI('offline');}
      else{ if(SYNC.status==='offline')syncUI(SYNC.dirty?'syncing':'ok'); if(SYNC.dirty&&SYNC.code)fbSchedulePush(); }
    });
    await sdk.signInAnonymously(auth);
  }catch(e){SYNC.lastErr=String(e&&e.message||e);fbLogLocal('error',SYNC.lastErr);syncUI('error');}
};
function fbStart(){
  if(!SYNC.fb||!SYNC.uid)return;
  if(!SYNC.code){syncUI('setup');return;}
  fbListen();
}
function fbListen(){
  if(SYNC.unsub){try{SYNC.unsub();}catch(e){}SYNC.unsub=null;}
  const f=SYNC.fb; SYNC.first=true; syncUI('connecting');
  SYNC.unsub=f.onValue(f.ref(f.db,fbPath()),snap=>{
    const r=snap.val();
    if(SYNC.first){SYNC.first=false;fbInitial(r);} else fbOnRemote(r);
  },err=>{SYNC.lastErr=String(err&&err.message||err);fbLogLocal('error',SYNC.lastErr);syncUI('error');});
}

/* ---- 5. reconcile ---- */
function fbInitial(r){
  fbLogLocal('connect',r?(r.device+' @ '+fmtT(r.synced_at)):'empty');
  if(!r||!r.json){ if(!localEmpty())fbPush(); else {syncUI('ok');} return; }
  const ours=r.device_id===DEVICE.id;
  if(ours){ if(SYNC.dirty)fbPush(); else {SYNC.remoteAt=r.synced_at;SYNC.remoteDev=r.device;syncUI('ok');} return; }
  /* another device wrote since we last synced */
  if(localEmpty()||(!SYNC.dirty&&SYNC.at>0)){ fbAdopt(r,'quiet'); return; }
  /* both sides hold something: this device has unsynced work, or it has never synced */
  fbConflict(r,SYNC.at?'unsynced':'first');
}
function fbOnRemote(r){
  if(!r||!r.json)return;
  if(r.device_id===DEVICE.id){SYNC.remoteAt=r.synced_at;SYNC.remoteDev=r.device;if(!SYNC.dirty)syncUI('ok');return;}
  if(SYNC.dirty){
    /* real-time clash: the other device saved while this one has unsent changes — this device's push wins (last write), offer the other side */
    SYNC.clash={r,at:Date.now()}; SYNC.remoteAt=Math.max(SYNC.remoteAt||0,r.synced_at||0);
    fbLogLocal('clash',r.device+' @ '+fmtT(r.synced_at));
    toast(`${esc(r.device)} also saved at ${fmtT(r.synced_at)} — ${esc(DEVICE.name)} wins`,{action:'Use '+r.device+"'s",onAction:()=>fbAdopt(r,'manual'),ms:7000});
    fbSchedulePush();
    return;
  }
  fbAdopt(r,'live');
}
const LOCAL_SETTINGS=['voiceName','audioSrc','theme','lastBackup','bkName','autoBackup','haptics','_bkWarned'];   /* kept when this device has a value */
const STRICT_LOCAL=['preloadedAt'];   /* facts about this device only: never inherited from another one */
function strictLocalGet(){const own={};STRICT_LOCAL.forEach(k=>{if(S.settings&&k in S.settings)own[k]=S.settings[k];});return own;}
function strictLocalPut(own){STRICT_LOCAL.forEach(k=>{if(k in own)S.settings[k]=own[k];else delete S.settings[k];});}
function fbAdopt(r,how){
  let p=null; try{p=JSON.parse(r.json);}catch(e){}
  if(!p||!p.cards){SYNC.lastErr='Cloud state unreadable';syncUI('error');try{shLook();}catch(e){}return;}
  const before=JSON.stringify(S), keep={}, prevFlags={}; for(const k in (S.settings||{}))if(/^_/.test(k))prevFlags[k]=S.settings[k];
  LOCAL_SETTINGS.forEach(k=>{if(S.settings&&k in S.settings)keep[k]=S.settings[k];});
  const own=strictLocalGet();
  SYNC.revert={json:before,dev:r.device,at:r.synced_at};
  SYNC.applying=true;
  try{
    S=p; S.settings=Object.assign({},S.settings||{},keep,prevFlags); strictLocalPut(own); S.settings.modes=Object.assign({rec:true,prod:true},S.settings.modes||{});
    S.pick=S.pick||[]; S.hard=S.hard||[]; S.log=S.log||{}; S.intro=S.intro||{}; S.hist=S.hist||{d:[],s:[]};
    try{store.setItem(KEY,JSON.stringify(S));}catch(e){}
    try{bkQueue();}catch(e){}
    SYNC.at=r.synced_at; SYNC.remoteAt=r.synced_at; SYNC.remoteDev=r.device; SYNC.dirty=false; SYNC.clash=null; syncMetaSave();
  }finally{SYNC.applying=false;}
  fbLogLocal('pull',r.device+' @ '+fmtT(r.synced_at));
  syncUI('ok');
  rerenderAfterSync();
  if(how!=='quiet')toast(`↓ synced from ${esc(r.device)} · ${fmtT(r.synced_at)}`,{action:'Undo',onAction:fbRevert,ms:6000});
  else toast(`↓ synced from ${esc(r.device)}`,{ms:2500});
  try{shLook();}catch(e){}   /* the adopted deck may carry another palette, accent or character face */
}
function fbRevert(){
  const rv=SYNC.revert; if(!rv)return;
  let p=null; try{p=JSON.parse(rv.json);}catch(e){return;}
  const keep={}, own=strictLocalGet(); LOCAL_SETTINGS.forEach(k=>{if(S.settings&&k in S.settings)keep[k]=S.settings[k];});
  S=p; S.settings=Object.assign({},S.settings||{},keep); strictLocalPut(own); SYNC.revert=null;
  save(); rerenderAfterSync(); toast('Reverted — this device\'s version is now the cloud version');
}
function rerenderAfterSync(){
  QV++;   /* the deck was replaced: the kept queue is out of date */
  try{
    undoStack.length=0;
    badge();
    if(view==='rev'){ if(rq){rq=buildQueue();['learn','rev','fresh'].forEach(k=>{rq[k]=rq[k].filter(c=>c!==cur);});} if(cur&&!S.cards[cur])nextCard(); else renderRev(); }
    else if(view==='set')renderSet(); else go(view);
  }catch(e){}
}
function fbConflict(r,why){
  const host=document.getElementById('syncModal'); if(!host)return;
  const mine=DEVICE.name, theirs=r.device||'the other device';
  const msg=why==='first'
    ?`The cloud already holds <b>${esc(theirs)}</b>'s progress (saved ${fmtT(r.synced_at)}), and this <b>${esc(mine)}</b> has its own. Which one should both devices use from now on?`
    :`<b>${esc(theirs)}</b> synced a newer version at ${fmtT(r.synced_at)}, but this <b>${esc(mine)}</b> has changes it never sent (last synced ${fmtT(SYNC.at)}).`;
  SYNC.blocked=true;
  host.innerHTML=`<div class="modal-card">
    <div class="lab">Sync conflict</div>
    <div style="font-size:14px;margin-bottom:14px">${msg}</div>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="btn" id="cfUse">Use ${esc(theirs)}'s version</button>
      <button class="btn ghost" id="cfKeep">Keep ${esc(mine)}'s version</button>
    </div>
    <div class="small muted" style="margin-top:10px">Whichever you pick becomes the cloud copy. The other is kept for one Undo in Settings → Cloud sync.</div>
  </div>`;
  host.style.display='flex';
  document.getElementById('cfUse').onclick=()=>{SYNC.blocked=false;host.style.display='none';fbAdopt(r,'manual');};
  document.getElementById('cfKeep').onclick=()=>{SYNC.blocked=false;host.style.display='none';SYNC.revert={json:r.json,dev:r.device,at:r.synced_at};SYNC.remoteAt=r.synced_at;fbPush();};
}

/* ---- 6. push ---- */
function fbSchedulePush(){
  if(SYNC.blocked)return;   /* no cloud writes while the conflict dialog is open */
  if(!SYNC.fb||!SYNC.code||!SYNC.uid)return;
  clearTimeout(SYNC.timer); SYNC.timer=setTimeout(fbPush,700); syncUI('syncing');
}
async function fbPush(){
  if(SYNC.blocked)return;
  clearTimeout(SYNC.timer);
  if(!SYNC.fb||!SYNC.code||!SYNC.uid)return;
  if(SYNC.pushing){SYNC.again=true;return;}
  SYNC.pushing=true; syncUI('syncing');
  const at=Math.max(Date.now(),(SYNC.remoteAt||0)+1);
  const f=SYNC.fb, p=fbPayload(at), gen0=SYNC.gen||0;
  try{
    await f.set(f.ref(f.db,fbPath()),p);
    SYNC.at=at; SYNC.remoteAt=at; SYNC.remoteDev=DEVICE.name; SYNC.dirty=(SYNC.gen||0)!==gen0; SYNC.retry=0; syncMetaSave(); if(SYNC.dirty)SYNC.again=true;
    fbLogLocal('push',Math.round(p.bytes/1024)+' KB');
    try{f.push(f.ref(f.db,'rooms/'+SYNC.code+'/sync_log'),{device:DEVICE.name,device_id:DEVICE.id,at,bytes:p.bytes,due:p.summary.due});}catch(e){}
    fbPruneLog();
    syncUI('ok');
  }catch(e){
    SYNC.lastErr=String(e&&e.message||e); fbLogLocal('error',SYNC.lastErr);
    if(/PERMISSION_DENIED|permission/i.test(SYNC.lastErr)){
      /* the rules rejected an older write — someone else is ahead; pull and ask */
      try{const snap=await f.get(f.ref(f.db,fbPath()));const r=snap.val();if(r&&r.json&&r.device_id!==DEVICE.id){fbConflict(r,'unsynced');}else syncUI('error');}catch(e2){syncUI('error');}
    } else {
      syncUI(SYNC.online?'error':'offline');
      SYNC.retry=Math.min(30000,Math.max(1000,SYNC.retry*2||1000));
      setTimeout(()=>{if(SYNC.dirty)fbSchedulePush();},SYNC.retry);
    }
  }finally{
    SYNC.pushing=false;
    if(SYNC.again){SYNC.again=false;fbSchedulePush();}
  }
}
/* the sync log is a diagnostic trail, not history: once per session it is trimmed to its last 50 entries */
async function fbPruneLog(){
  if(SYNC.pruned||!SYNC.fb||!SYNC.code)return; SYNC.pruned=true;
  try{
    const f=SYNC.fb, ref=f.ref(f.db,'rooms/'+SYNC.code+'/sync_log'), v=(await f.get(ref)).val(); if(!v)return;
    const keys=Object.keys(v).sort(); if(keys.length<=60)return;
    const keep={}; keys.slice(-50).forEach(k=>{keep[k]=v[k];});
    await f.set(ref,keep); fbLogLocal('trim',(keys.length-50)+' old log entries');
  }catch(e){}
}

/* ---- 7. sync code (the "room" both devices share) ---- */
function fbSetCode(c){
  c=normCode(c);
  if(!c){alert('Enter the sync code shown on your other device, or generate one.');return;}
  if(c.length<6){alert('Make the code at least 6 characters.');return;}
  SYNC.code=c; store.setItem(FB_ROOM_KEY,c);
  SYNC.at=0; SYNC.dirty=!localEmpty(); syncMetaSave();
  fbLogLocal('code',c);
  if(SYNC.fb&&SYNC.uid)fbListen(); else fbLoad();
  renderSet();
}
function fbNewCode(){
  const c='zika-'+Math.random().toString(36).slice(2,8);
  const el=document.getElementById('syncCodeInp'); if(el)el.value=c;
  fbSetCode(c);
}
function fbUnlink(){
  if(!confirm('Stop syncing this device? Progress stays on the device; the cloud copy is untouched.'))return;
  if(SYNC.unsub){try{SYNC.unsub();}catch(e){}SYNC.unsub=null;}
  SYNC.code=''; store.removeItem(FB_ROOM_KEY); SYNC.at=0; SYNC.dirty=false; syncMetaSave(); syncUI('setup'); renderSet();
}
async function fbPullNow(){
  if(!SYNC.fb||!SYNC.code)return;
  try{const snap=await SYNC.fb.get(SYNC.fb.ref(SYNC.fb.db,fbPath()));const r=snap.val();if(r&&r.json)fbAdopt(r,'manual');else toast('Nothing in the cloud yet');}catch(e){SYNC.lastErr=String(e&&e.message||e);syncUI('error');renderSet();}
}
function fbCopyCode(){const t=SYNC.code;if(!t)return;if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(()=>toast('Code copied'),()=>prompt('Copy this:',t));else prompt('Copy this:',t);}

/* ---- 8. sync indicator + toasts + modal ---- */
const SYNC_LABEL={off:'not syncing',setup:'needs a sync code',connecting:'connecting…',syncing:'syncing…',ok:'synced',offline:'offline — will sync when back',error:'sync error'};
function syncUI(st){
  SYNC.status=st;
  const pill=document.getElementById('syncPill'); if(!pill)return;
  pill.dataset.state=st; pill.classList.remove('quiet');
  const txt=pill.querySelector('.stxt'); if(txt)txt.textContent=DEVICE.name;
  pill.title=DEVICE.name+' · '+SYNC_LABEL[st]+(SYNC.at?' · last sync '+ago(SYNC.at):'')+(SYNC.lastErr&&st==='error'?' · '+SYNC.lastErr:'');
  clearTimeout(SYNC.okTimer); clearTimeout(SYNC.quietTimer);
  if(st==='ok'){ SYNC.quietTimer=setTimeout(()=>{pill.classList.add('quiet');},3000); }
  const el=document.getElementById('syncStatusLine'); if(el)el.innerHTML=syncStatusHtml();
  if(st==='ok'||st==='error'||st==='offline'){const l=document.getElementById('syncLogBox');if(l)l.innerHTML=syncLogHtml();}
}
function syncStatusHtml(){
  const st=SYNC.status;
  const dot=`<i class="sdot inline" data-state="${st}"></i>`;
  let s=`${dot} <b>${esc(SYNC_LABEL[st]||st)}</b>`;
  if(SYNC.at)s+=` · last sync ${esc(ago(SYNC.at))} (${esc(fmtT(SYNC.at))})`;
  if(SYNC.remoteDev&&SYNC.remoteDev!==DEVICE.name&&SYNC.remoteAt)s+=` · cloud copy from <b>${esc(SYNC.remoteDev)}</b> ${esc(fmtT(SYNC.remoteAt))}`;
  if(SYNC.dirty&&st!=='syncing')s+=` · <span style="color:var(--amber)">unsent changes</span>`;
  if(st==='error'&&SYNC.lastErr)s+=`<div class="small" style="color:var(--red);margin-top:3px">${esc(SYNC.lastErr)}</div>`;
  return s;
}
function syncLogHtml(){return SYNC.log.length?SYNC.log.slice(0,12).map(l=>`<div>${esc(fmtT(l.at))} · ${esc(l.kind)}${l.extra?' · '+esc(l.extra):''}</div>`).join(''):'<div class="muted">nothing yet</div>';}

/* ---- 9. settings card ---- */
function syncPanel(){
  const cfg=fbConfig(), hard=!!(FIREBASE_CONFIG&&FIREBASE_CONFIG.databaseURL);
  const dev=DEVICE.name;
  let h=`<div class="card" id="syncCard"><div class="lab">Cloud sync</div>
    <div id="syncStatusLine" class="small" style="margin-bottom:12px">${syncStatusHtml()}</div>
    ${!cfg?`<div class="set-row"><div><b>Firebase config</b><div class="d">Paste the web-app config from the Firebase console (Project settings → Your apps → the <code>firebaseConfig</code> object). It only names your project — the database rules do the protecting.</div></div></div>
      <textarea id="fbCfgInp" class="gtxt" style="max-width:none;font-size:12px;min-height:80px;margin-bottom:8px" placeholder='{ apiKey: "…", authDomain: "…", databaseURL: "…", projectId: "…", appId: "…" }'></textarea>
      <div class="row" style="margin-bottom:10px"><button class="btn sm" onclick="fbSaveConfig(document.getElementById('fbCfgInp').value)">Save config</button></div>`
    :`<div class="set-row"><div><b>Sync code</b><div class="d">${SYNC.code?`Both devices on <b>${esc(SYNC.code)}</b> share one deck. Type the same code on the other device.`:'Generate a code here, then type it on the other device. Anyone with the code can read the deck, so keep it private.'}</div></div>
        <div class="row" style="gap:6px">
          <input id="syncCodeInp" class="search" style="margin:0;width:150px;padding:7px 10px;font-size:13px" value="${esc(SYNC.code)}" placeholder="zika-xxxxxx" autocapitalize="off" autocorrect="off" spellcheck="false">
          ${SYNC.code?`<button class="btn ghost sm" onclick="fbCopyCode()">Copy</button><button class="btn ghost sm" onclick="fbSetCode(document.getElementById('syncCodeInp').value)">Change</button><button class="btn ghost sm" onclick="fbUnlink()">Unlink</button>`
          :`<button class="btn sm" onclick="fbSetCode(document.getElementById('syncCodeInp').value)">Link</button><button class="btn ghost sm" onclick="fbNewCode()">Generate</button>`}
        </div></div>
      <div class="set-row"><div><b>This device</b><div class="d">the badge other devices see when this one saves</div></div>
        <select class="vsel" onchange="DEVICE.name=this.value;syncUI(SYNC.status);renderSet()">
          ${['Mac','iPad','iPhone','PC','Android','Web'].map(n=>`<option ${dev===n?'selected':''}>${n}</option>`).join('')}
        </select></div>
      <div class="set-row"><div><b>Now</b><div class="d">Push sends this device's state up; Pull replaces it with the cloud copy${SYNC.revert?`; Undo restores what was here before the last pull (from ${esc(SYNC.revert.dev)}, ${esc(fmtT(SYNC.revert.at))})`:''}.</div></div>
        <div class="row" style="gap:6px"><button class="btn ghost sm" onclick="SYNC.dirty=true;fbPush()" ${SYNC.code?'':'disabled'}>Push</button><button class="btn ghost sm" onclick="fbPullNow()" ${SYNC.code?'':'disabled'}>Pull</button>${SYNC.revert?`<button class="btn ghost sm" onclick="fbRevert()">Undo pull</button>`:''}</div></div>
      ${hard?'':`<div class="set-row"><div><b>Firebase config</b><div class="d">stored in this browser · project <b>${esc(cfg.projectId||'?')}</b></div></div><button class="btn ghost sm" onclick="if(confirm('Forget the Firebase config on this device?'))fbSaveConfig('')">Forget</button></div>`}
      <details class="guide"><summary>Sync log ›</summary><div id="syncLogBox" class="gd small" style="font-variant-numeric:tabular-nums">${syncLogHtml()}</div></details>`}
  </div>`;
    if(!fbConfig())return h;
  let add='';
  if(SYNC.code){
    add=`<div class="set-row linkrow"><div><b>Link another device</b>
        <div class="d">On an iPhone or iPad: point the Camera at this code, tap the link, and the app opens already linked.
        Then <b>Share ↑ → Add to Home Screen</b>. The home-screen app keeps its own storage, so open it once and type <b>${esc(SYNC.code)}</b> when it asks — after that it stays linked.</div>
        <div class="row" style="gap:6px;margin-top:8px"><button class="btn ghost sm" onclick="fbCopyLink()">Copy link</button></div></div>
        <div class="qrbox" title="${esc(syncLink())}">${qrSvg(syncLink(),4)}</div></div>`;
  }else{
    add=`<div class="set-row"><div><b>Start here</b><div class="d">First device: tap <b>Generate</b>. Every other device: type that same code and tap <b>Link</b> — or open the link the first device shows.</div></div></div>`;
  }
  return h.replace(/(<details class="guide"><summary>Sync log)/,add+'$1');
}

/* =====================================================   v28 — one-scan device linking (Mac ⇄ iPad)
   1. A sync link: <app url>#sync=<code>. Opening it links the
      device to that code automatically, then the hash is removed.
   2. Settings → Cloud sync shows the link as a QR code + Copy link,
      with the iPad steps written next to it.
   3. Today shows a "Cloud sync is off" card with an inline code box
      whenever this device has no code (covers the iPad home-screen
      app, which keeps its own storage separate from Safari).
   4. iPad/iPhone Safari gets the Add to Home Screen hint once.
   ============================================================ */
/* a device that has never reviewed anything counts as empty, even though the
   app seeds a few unstarted cards on first open — so a fresh iPad adopts the
   Mac's deck quietly instead of asking which copy should win */
function syncLink(code){return location.origin+location.pathname.replace(/index\.html$/,'')+'#sync='+encodeURIComponent(code||SYNC.code);}
function qrSvg(text,cell){
  try{const q=window.qrcode(0,'M');q.addData(text);q.make();
    return q.createSvgTag({cellSize:cell||4,margin:2,scalable:true}).replace('<svg ','<svg class="qrsvg" ');}
  catch(e){return '';}
}
function fbCopyLink(){
  const t=syncLink(); if(!SYNC.code)return;
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(()=>toast('Link copied — open it on the other device'),()=>prompt('Copy this link:',t));
  else prompt('Copy this link:',t);
}
function fbPasteCode(id){
  const el=document.getElementById(id); if(!el)return;
  if(navigator.clipboard&&navigator.clipboard.readText)navigator.clipboard.readText().then(t=>{const m=String(t).match(/sync=([a-z0-9-]+)/i);el.value=m?m[1]:String(t).trim();}).catch(()=>el.focus());
  else el.focus();
}
