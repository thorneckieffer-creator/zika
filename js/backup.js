/* Backups: a file on disk the app keeps up to date (File System Access, where the browser has it), and a copy of
   the deck in the browser for each of the last three days. */

let bkHandle=null, bkTimer=null, bkNeedPerm=false, bkBusy=false;
const SNAPKEY='zika_snap_v1';

function bkIDB(){return new Promise((res,rej)=>{
  let r;try{r=indexedDB.open('zika-bk',1);}catch(e){return rej(e);}
  r.onupgradeneeded=()=>{try{r.result.createObjectStore('h');}catch(e){}};
  r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);});}
async function bkPut(h){try{const db=await bkIDB();return new Promise(res=>{const t=db.transaction('h','readwrite');t.objectStore('h').put(h,'file');t.oncomplete=()=>res(1);t.onerror=()=>res(0);});}catch(e){return 0;}}
async function bkGet(){try{const db=await bkIDB();return new Promise(res=>{const t=db.transaction('h','readonly');const q=t.objectStore('h').get('file');q.onsuccess=()=>res(q.result||null);q.onerror=()=>res(null);});}catch(e){return null;}}
async function bkDel(){try{const db=await bkIDB();return new Promise(res=>{const t=db.transaction('h','readwrite');t.objectStore('h').delete('file');t.oncomplete=()=>res(1);t.onerror=()=>res(0);});}catch(e){return 0;}}

/* rolling in-browser snapshots — cheap insurance against a bad import or a glitch */
/* a copy of the deck in the browser, one per day for three days, written at most every ten minutes */
let snapLast=0;
function snapshot(){
  const n=Date.now();if(n-snapLast<600000)return;snapLast=n;
  try{
    const k=dkey(new Date());
    let snaps={}; try{snaps=JSON.parse(store.getItem(SNAPKEY)||'{}');}catch(e){}
    snaps[k]=JSON.stringify(S);
    const keys=Object.keys(snaps).sort();
    while(keys.length>3){delete snaps[keys.shift()];}
    store.setItem(SNAPKEY,JSON.stringify(snaps));
  }catch(e){}
}
function snapList(){try{const s=JSON.parse(store.getItem(SNAPKEY)||'{}');return Object.keys(s).sort().reverse();}catch(e){return[];}}
function snapRestore(k){
  try{
    const s=JSON.parse(store.getItem(SNAPKEY)||'{}');
    if(!s[k])return;
    if(!confirm('Restore your progress as it was on '+k+'? This replaces what is in this browser now.'))return;
    S=JSON.parse(s[k]);normalizeState(); save(); alert('Restored '+k); renderSet(); badge();
  }catch(e){alert('Could not restore that snapshot.');}
}

function bkSupported(){return typeof window!=='undefined'&&!!window.showSaveFilePicker;}
async function bkChoose(){
  if(!bkSupported()){alert('This browser can’t write backup files directly. Use Chrome or Edge on the desktop — or keep using Export.');return;}
  try{
    const h=await window.showSaveFilePicker({suggestedName:'zika-progress.json',
      types:[{description:'字卡 progress',accept:{'application/json':['.json']}}]});
    bkHandle=h; bkNeedPerm=false; await bkPut(h);
    S.settings.autoBackup=true; S.settings.bkName=h.name||'zika-progress.json'; save();
    await bkWrite(); renderSet();
  }catch(e){ /* user cancelled */ }
}
async function bkForget(){
  bkHandle=null; await bkDel();
  S.settings.autoBackup=false; delete S.settings.bkName; save(); renderSet();
}
async function bkWrite(){
  if(!bkHandle||bkBusy)return false;
  bkBusy=true;
  try{
    let p='granted';
    if(bkHandle.queryPermission) p=await bkHandle.queryPermission({mode:'readwrite'});
    if(p!=='granted'){ bkNeedPerm=true; bkBusy=false; return false; }
    const w=await bkHandle.createWritable();
    await w.write(JSON.stringify(Object.assign({},S,{_app:'zika',_savedAt:new Date().toISOString()}),null,1));
    await w.close();
    S.settings.lastBackup=Date.now();
    try{store.setItem(KEY,JSON.stringify(S));}catch(e){}   /* direct write — never re-enter save() */
    bkNeedPerm=false; bkBusy=false;
    const el=document.getElementById('bkStamp'); if(el)el.textContent=bkAgo();
    return true;
  }catch(e){ bkBusy=false; bkNeedPerm=true; return false; }
}
/* ask for the write permission on a real user gesture (Chrome requires one) */
async function bkGrant(){
  if(!bkHandle)return;
  try{
    const r=await bkHandle.requestPermission({mode:'readwrite'});
    if(r==='granted'){bkNeedPerm=false; await bkWrite(); renderSet();}
  }catch(e){}
}
function bkQueue(){
  snapshot();
  if(!bkHandle||!S.settings.autoBackup)return;
  clearTimeout(bkTimer);
  bkTimer=setTimeout(()=>{bkWrite();},4000);
}
function bkAgo(){
  const t=S.settings.lastBackup; if(!t)return 'not yet saved';
  const s=Math.floor((Date.now()-t)/1000);
  if(s<90)return 'saved just now';
  if(s<5400)return 'saved '+Math.round(s/60)+' min ago';
  if(s<172800)return 'saved '+Math.round(s/3600)+' h ago';
  return 'saved '+Math.round(s/86400)+' days ago';
}
function bkStale(){
  if(S.settings.autoBackup&&bkHandle&&!bkNeedPerm)return false;
  const t=S.settings.lastBackup||0;
  return (Date.now()-t)>7*86400000 && Object.values(S.cards).some(c=>c.st!==undefined);
}

function bkPanel(){
  const on=S.settings.autoBackup&&bkHandle;
  return `<div class="card"><div class="lab">Backup</div>
    ${!bkSupported()?`<div class="small muted" style="margin-bottom:10px">Automatic file backup needs desktop Chrome or Edge. On this browser, use Export below.</div>`:''}
    <div class="set-row"><div><b>Automatic backup</b><div class="d">${on?`Writing to <b>${esc(S.settings.bkName||'your file')}</b> after every session — nothing for you to do.`:'Pick a file once (put it in iCloud Drive or Dropbox). The app then saves your progress into it automatically, every session, forever.'}</div></div>
      ${on?`<button class="btn ghost sm" onclick="bkForget()">Turn off</button>`:`<button class="btn sm" onclick="bkChoose()" ${bkSupported()?'':'disabled'}>Choose file…</button>`}</div>
    ${on?`<div class="set-row"><div><b>Status</b><div class="d" id="bkStamp">${esc(bkAgo())}</div></div>
      ${bkNeedPerm?`<button class="btn sm" onclick="bkGrant()">Re-allow writing</button>`:`<button class="btn ghost sm" onclick="bkWrite().then(()=>renderSet())">Save now</button>`}</div>`:''}
    <div class="set-row"><div><b>In-browser snapshots</b><div class="d">Automatic daily copies kept inside this browser — a safety net, not a substitute for the file above.</div></div>
      <div class="row">${snapList().length?snapList().map(k=>`<button class="btn ghost sm" onclick="snapRestore('${k}')">${k.slice(5)}</button>`).join(''):'<span class="small muted">none yet</span>'}</div></div>
    <div class="set-row"><div><b>Manual copy</b><div class="d">A one-off file you can move to another device.</div></div>
      <div class="row">
        <button class="btn ghost sm" onclick="exportData()">Export</button>
        <button class="btn ghost sm" onclick="document.getElementById('impFile').click()">Import</button>
        <input id="impFile" type="file" accept=".json" style="display:none" onchange="importData(this)">
        <button class="btn ghost sm" style="color:var(--red);border-color:#e8d5d2" onclick="if(confirm('Really erase ALL progress?')){S={cards:{},settings:S.settings,log:{},intro:{},hist:{d:[],s:[]},hard:[],pick:[]};save();renderSet();badge();}">Reset</button>
      </div></div>
  </div>`;
}
