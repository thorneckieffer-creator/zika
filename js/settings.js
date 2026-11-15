/* ---- SETTINGS ---- */
function renderSet(){
    const s=S.settings;
  document.getElementById('vSet').innerHTML=`
  ${bkPanel()}
  <div class="card"><div class="lab">Card types</div>
    ${MODES.map(m=>`<div class="set-row"><div><b>${MODE_LABEL[m]}</b><div class="d">${m==='rec'?'see the 字 → recall meaning + pinyin + tones':'see the English → recall the 字, its pinyin and its tones'}</div></div>
      <button class="tgl ${s.modes[m]?'on':''}" onclick="S.settings.modes.${m}=!S.settings.modes.${m};save();renderSet();badge()"><i></i></button></div>`).join('')}
    <div class="set-row"><div><b>Include names</b><div class="d">people like 陳月美 — off by default</div></div>
      <button class="tgl ${s.includeNames?'on':''}" onclick="S.settings.includeNames=!S.settings.includeNames;save();renderSet();badge()"><i></i></button></div>
  </div>
  <div class="card"><div class="lab">Schedule</div>
    <div class="set-row"><div><b>New words per day</b><div class="d">how many fresh words may start each day. Unlimited lets a whole lesson in at once — the Up next queue decides the order.</div></div>
      <div class="row" style="gap:7px">
        <input type="number" min="0" max="999" value="${s.newPerDay}" ${s.newUnlimited?'disabled':''} onchange="S.settings.newPerDay=Math.max(0,parseInt(this.value)||0);save();renderSet();badge()">
        <button class="btn sm ${s.newUnlimited?'':'ghost'}" onclick="S.settings.newUnlimited=!S.settings.newUnlimited;save();renderSet();badge()">∞</button>
      </div></div>
    <div class="set-row"><div><b>Early recall reps</b><div class="d">recall cards forced back on day 1, 2 and 3 before FSRS takes over</div></div>
      <button class="tgl ${s.earlyDrill?'on':''}" onclick="S.settings.earlyDrill=!S.settings.earlyDrill;save();renderSet()"><i></i></button></div>
    <div class="set-row"><div><b>Day-1 paper reps</b><div class="d">boxes per new character on the 田字格 sheet; day 2 tapers to 5, day 3 to 1</div></div>
      <input type="number" min="1" max="100" value="${s.writeTarget}" onchange="S.settings.writeTarget=Math.max(1,parseInt(this.value)||20);save()"></div>
    <div class="set-row"><div><b>Desired retention</b><div class="d">higher = more frequent reviews. 90% is the sweet spot.</div></div>
      <div class="row"><input type="range" min="80" max="97" value="${Math.round(s.retention*100)}" oninput="S.settings.retention=this.value/100;save();this.nextElementSibling.textContent=this.value+'%'"><b>${Math.round(s.retention*100)}%</b></div></div>
    <div class="set-row"><div><b>Max reviews per day</b><div class="d">a ceiling on due cards, so a backlog can't bury you. ∞ shows everything that's due.</div></div>
      <div class="row" style="gap:7px">
        <input type="number" min="10" max="9999" value="${s.maxRev}" ${s.revUnlimited?'disabled':''} onchange="S.settings.maxRev=Math.max(10,parseInt(this.value)||200);save();renderSet();badge()">
        <button class="btn sm ${s.revUnlimited?'':'ghost'}" onclick="S.settings.revUnlimited=!S.settings.revUnlimited;save();renderSet();badge()">∞</button>
      </div></div>
    <div class="set-row"><div><b>Separate the two cards of a word</b><div class="d">once you've done one direction today, its partner waits for tomorrow — so the second one is a real test, not a re-read. Day-1 pairs are exempt.</div></div>
      <button class="tgl ${s.burySib?'on':''}" onclick="S.settings.burySib=!S.settings.burySib;save();renderSet();badge()"><i></i></button></div>
  </div>
  <div class="card"><div class="lab">Audio & strokes</div>
    <div class="set-row"><div><b>Audio source</b><div class="d">Taiwanese voice = your device's zh-TW voice (Google 國語（臺灣）in Chrome, 美佳 Mei-Jia on Apple). Recording = bundled neural audio — works offline but mainland-accented.</div></div>
      <select class="vsel" onchange="S.settings.audioSrc=this.value;save()">
        <option value="auto" ${(s.audioSrc||'auto')==='auto'?'selected':''}>Auto — Taiwanese voice when available</option>
        <option value="system" ${s.audioSrc==='system'?'selected':''}>Taiwanese system voice only</option>
        <option value="bundled" ${s.audioSrc==='bundled'?'selected':''}>Bundled recording (offline)</option>
      </select></div>
    <div class="set-row"><div><b>Pronunciation voice</b><div class="d">in Chrome, pick “Google 國語（臺灣）” — Google-quality Taiwanese female Mandarin</div></div>
      <div class="row"><select class="vsel" onchange="S.settings.voiceName=this.value;save()">
        <option value="">Auto — best available</option>
        ${VOICES.slice().sort((a,b)=>rankVoice(b)-rankVoice(a)).map(v=>`<option value="${esc(v.name)}" ${S.settings.voiceName===v.name?'selected':''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}
      </select><button class="btn ghost sm" onclick="speakText('歡迎你來臺灣')">Test</button></div></div>
    <div class="set-row"><div><b>Auto-play on reveal</b><div class="d">hear every word when the answer shows</div></div>
      <button class="tgl ${s.autoplayAudio?'on':''}" onclick="S.settings.autoplayAudio=!S.settings.autoplayAudio;save();renderSet()"><i></i></button></div>
    <div class="set-row"><div><b>Audio speed</b><div class="d">applies to both the Taiwanese voice and the bundled recordings</div></div>
      <div class="row"><input type="range" min="60" max="120" value="${Math.round((s.audioSpeed||0.9)*100)}" oninput="S.settings.audioSpeed=this.value/100;save();this.nextElementSibling.textContent=this.value+'%'"><b>${Math.round((s.audioSpeed||0.9)*100)}%</b></div></div>
    <div class="set-row"><div><b>Stroke-order animations</b><div class="d">writing-card answers draw themselves stroke by stroke</div></div>
      <button class="tgl ${s.strokeAnim?'on':''}" onclick="S.settings.strokeAnim=!S.settings.strokeAnim;save();renderSet()"><i></i></button></div>
    <div class="set-row"><div><b>Pinyin under sentences</b><div class="d">tone-colored pinyin on grammar examples and drill answers</div></div>
      <button class="tgl ${s.showPy!==false?'on':''}" onclick="S.settings.showPy=S.settings.showPy===false?true:false;save();renderSet()"><i></i></button></div>
    <div class="set-row"><div><b>Character stories</b><div class="d">component breakdown (女＋馬＝媽) on card answers; full etymology in the Brain</div></div>
      <button class="tgl ${s.showComp!==false?'on':''}" onclick="S.settings.showComp=S.settings.showComp===false?true:false;save();renderSet()"><i></i></button></div>
    <div class="set-row"><div><b>Usage phrases</b><div class="d">short phrases and sentences that use the word, on card answers; tap one to hear it</div></div>
      <button class="tgl ${s.usageCards!==false?'on':''}" onclick="S.settings.usageCards=S.settings.usageCards===false?true:false;save();renderSet()"><i></i></button></div>
    <div class="set-row"><div><b>Sentence hint on write cards</b><div class="d">before you answer a write card, show its sentence with the word left blank (我下個月要＿到學校附近。)</div></div>
      <button class="tgl ${s.usageHint===true?'on':''}" onclick="S.settings.usageHint=S.settings.usageHint!==true;save();renderSet()"><i></i></button></div>
  </div>
  `;
  /* Confidence card first */
  try{ document.getElementById('vSet').insertAdjacentHTML('afterbegin',confPanel()); }catch(e){}
  /* Cloud sync card first, Look & feel card last */
  try{const v=document.getElementById('vSet');v.insertAdjacentHTML('afterbegin',syncPanel());v.insertAdjacentHTML('beforeend',polishPanel());}catch(e){}
  /* Grammar in the queue card last */
  try{document.getElementById('vSet').insertAdjacentHTML('beforeend',gramSetPanel());}catch(e){}
  /* Card strategy card after the second .card */
  try{const v=document.getElementById('vSet');const conf=v.querySelector('.card:nth-of-type(2)');(conf||v.firstElementChild).insertAdjacentHTML('afterend',cardStratPanel());}catch(e){}
  /* Leeches row, retention wording (helper: early return) */
  renderSetLeeches();
  /* Catch-up words per day row (helper: early return) */
  renderSetCatchUp();
  /* keyboard hint line last */
  try{document.getElementById('vSet').insertAdjacentHTML('beforeend',`<div class="small muted" style="text-align:center;margin:4px 0 10px">Press <kbd>?</kbd> anywhere for keyboard shortcuts · look-up links on every card back: 萌典 · MDBG · Pleco · Skritter</div>`);}catch(e){}
  /* Audio source wording, Bundled voice row (helper: early return) */
  renderSetVoices();
  /* iPad / Daily intake / Offline cards first, retire rows, drop empty cards, order */
  try{
  const v=document.getElementById('vSet');
  v.insertAdjacentHTML('afterbegin',ipadPanel()+intakePanel()+offlinePanel());
  /* retire the rows now covered by Daily intake */
  const kill=['New words per day','Max reviews per day','Desired retention','New grammar cards per day','Catch-up words per day'];
  [...v.querySelectorAll('.set-row')].forEach(r=>{const b=r.querySelector('b');if(b&&kill.includes(b.textContent.trim())&&!r.closest('#intakeCard'))r.remove();});
  /* cards with nothing left go too */
  [...v.querySelectorAll('.card')].forEach(c=>{if(!c.querySelector('.set-row')&&!c.querySelector('.istep')&&!c.querySelector('button')&&!c.querySelector('.confrow'))c.remove();});
  /* order */
  const cards=[...v.querySelectorAll(':scope > .card')];
  const rank=c=>{const l=c.querySelector('.lab');const t=l?l.textContent.trim():'';const i=SET_ORDER.findIndex(k=>t.startsWith(k));return i<0?SET_ORDER.length:i;};
  cards.sort((a,b)=>rank(a)-rank(b)).forEach(c=>v.appendChild(c));
  const tail=[...v.children].find(x=>x.className&&/small muted/.test(x.className)&&/keyboard/.test(x.textContent)); if(tail)v.appendChild(tail);
}catch(e){}
  /* version line last */
  try{
  document.getElementById('vSet').insertAdjacentHTML('beforeend',`<div class="small muted" style="text-align:center;margin:0 0 10px">字卡 v${APP_VERSION} · ${WORDS.length} words · ${BOOKS.length} books · this device: ${esc(DEVICE.name)}</div>`);
}catch(e){}
  /* Look rows, You card first */
  try{
  const v=document.getElementById('vSet'), ln=shLesson();
  const cards=[...v.querySelectorAll('.card')], look=cards.find(c=>/^Look & feel/.test(((c.querySelector('.lab')||{}).textContent||'').trim()));
  const a=ACCENTS[S.settings.accent]?S.settings.accent:'classic', z=S.settings.zhFont||'sans', pal=S.settings.palette==='clean'?'clean':'paper';
  const rows=`<div class="set-row"><div><b>Palette</b><div class="d">Paper is the warm original; Clean is neutral white and grey. Both have a day and a night side</div></div>
      <div class="seg">${Object.keys(PALETTES).map(k=>`<button class="${pal===k?'on':''}" onclick="shSetLook('palette','${k}')">${PALETTES[k]}</button>`).join('')}</div></div>
    <div class="set-row"><div><b>Accent colour</b><div class="d">buttons, links and the active tab. Classic is ink and tea green; follows you to your other devices</div></div>
      <div class="swatches">${Object.keys(ACCENTS).map(k=>`<button class="swatch${a===k?' on':''}" style="background:${ACCENTS[k]}" title="${k}" aria-label="${k}" onclick="shSetLook('accent','${k}')"></button>`).join('')}</div></div>
    <div class="set-row"><div><b>Character style</b><div class="d">the face study characters are shown in: a clean sans, the textbook’s 明體, or 楷體, which is closest to handwriting</div></div>
      <div class="seg">${Object.keys(ZH_FONTS).map(k=>`<button class="${z===k?'on':''}" onclick="shSetLook('zhFont','${k}')">${ZH_FONTS[k]}</button>`).join('')}</div></div>`;
  if(look)look.insertAdjacentHTML('beforeend',rows);
  v.insertAdjacentHTML('afterbegin',`<div class="card" id="youCard"><div class="lab">You</div>
    <div class="set-row"><div><b>${shName()?esc(shName()):'Your name'}</b><div class="d">Book ${bookOf(ln)} · Lesson ${lnInBook(ln)} · ${esc(LESSON_TITLES[ln]||'')}</div></div>
      <button class="btn sm ghost" onclick="shCourse()">Change</button></div>
    ${look?'':rows}</div>`);
}catch(e){console.error(e);}
}
/* a function of its own, so that its `if(!strat)return;` ends only this step */
function renderSetLeeches(){try{
  const v=document.getElementById('vSet'); const strat=[...v.querySelectorAll('.card')].find(c=>/Card strategy/.test(c.textContent)); if(!strat)return;
  const L=leechList();
  strat.insertAdjacentHTML('beforeend',`<div class="set-row"><div><b>Leeches</b><div class="d">A word missed 4 times goes to the hard list and tonight’s paper; missed 7 times it is parked here until you un-park it. ${L.length?'':'None parked.'}</div></div>
    <div class="row" style="gap:4px;flex-wrap:wrap;justify-content:flex-end">${L.map(c=>`<button class="btn ghost sm zh" onclick="leechUnpark('${c}')" title="un-park">${esc(byId[c.split(':')[0]].t)} ↩</button>`).join('')}</div></div>`);
  const ret=[...v.querySelectorAll('.set-row')].find(r=>/Desired retention/.test(r.textContent)); if(ret){const d=ret.querySelector('.d');if(d)d.textContent='85–90% is the sweet spot: going to 95% roughly doubles the daily load for a few points of recall.';}
}catch(e){}}
/* a function of its own, so that its `if(!strat)return;` ends only this step */
function renderSetCatchUp(){try{
  const v=document.getElementById('vSet'); const strat=[...v.querySelectorAll('.card')].find(c=>/Card strategy/.test(c.textContent)); if(!strat)return;
  strat.insertAdjacentHTML('beforeend',`<div class="set-row"><div><b>Catch-up words per day</b><div class="d">how many shaky / ✗ words from old lessons may start each day, separate from this week’s new words</div></div><input type="number" min="0" max="30" value="${S.settings.newCatchPerDay??5}" onchange="S.settings.newCatchPerDay=Math.max(0,parseInt(this.value)||0);save();badge()"></div>`);
}catch(e){}}
/* a function of its own, so that its `if(!sel)return;` ends only this step */
function renderSetVoices(){try{
  const sel=document.querySelector('#vSet select[onchange*="audioSrc"]'); if(!sel)return;
  sel.options[0].textContent='Auto — bundled Taiwan voice, system voice as fallback';
  sel.options[2].textContent='Bundled Taiwan voice only (offline)';
  const row=sel.closest('.set-row'), d=row.querySelector('.d');
  if(d)d.textContent='The bundled voices are Microsoft’s zh-TW neural voices, pre-rendered for every word and every character at a slightly slow pace — full tones, Taiwan readings (垃圾 lèsè). They work offline once stored on the device.';
  if(d)d.insertAdjacentHTML('beforeend',' <a href="voice.html" style="color:var(--blue);white-space:nowrap">Record your own voice ↗</a>');
  const voices=Object.keys(VOICE_PACKS).filter(v=>VOICE_OK[v]);
  if(voices.length>1)row.insertAdjacentHTML('beforebegin',`<div class="set-row"><div><b>Bundled voice</b><div class="d">Tap a voice to switch and hear a sample; the choice follows you to your other devices.</div></div>
    <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">${voices.map(v=>`<button class="btn sm ${voiceId()===v?'':'ghost'}" onclick="setVoice('${v}')">${VOICE_PACKS[v].name} · ${VOICE_PACKS[v].who}</button>`).join('')}</div></div>`);
}catch(e){}}
function exportData(){
  const blob=new Blob([JSON.stringify(S,null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='zika-progress-'+dkey(new Date())+'.json';a.click();
}
function importData(inp){
  const f=inp.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    let p=null; try{p=JSON.parse(r.result);}catch(e){}
    if(!p||!p.cards||typeof p.cards!=='object'){alert('That file does not look like a progress export.');return;}
    const linked=typeof SYNC!=='undefined'&&SYNC.code;
    if(!confirm('Replace the progress on this device with this file?'+(linked?' Cloud sync is on, so every linked device will receive it too.':'')))return;
    const keep={}; LOCAL_SETTINGS.concat(STRICT_LOCAL).forEach(k=>{if(S.settings&&k in S.settings)keep[k]=S.settings[k];});
    p.settings=Object.assign({},S.settings,p.settings||{},keep);   /* anything the file lacks keeps this device's value */
    delete p._app; delete p._savedAt;
    S=p; normalizeState(); undoStack.length=0; rq=null; cur=null;
    save(); alert('Imported ✓'); renderSet(); badge();
  };
  r.readAsText(f);
}
function polishPanel(){
  const s=S.settings, th=s.theme||'auto';
  return `<div class="card"><div class="lab">Look & feel</div>
    <div class="set-row"><div><b>Appearance</b><div class="d">Auto follows the system's light/dark setting; the ☾ button in the header picks one explicitly.</div></div>
      <select class="vsel" onchange="S.settings.theme=this.value;save();applyTheme(this.value);if(view==='brain')renderBrain();">
        <option value="auto" ${th==='auto'?'selected':''}>Auto (system)</option><option value="light" ${th==='light'?'selected':''}>Day</option><option value="dark" ${th==='dark'?'selected':''}>Night</option>
      </select></div>
    <div class="set-row"><div><b>Haptics</b><div class="d">a tap on correct, a double tap on Again. Android and desktop browsers with vibration; iPadOS does not expose vibration to web apps.</div></div>
      <button class="tgl ${s.haptics!==false?'on':''}" onclick="S.settings.haptics=S.settings.haptics===false?true:false;save();renderSet();haptic('good')"><i></i></button></div>
    <div class="set-row"><div><b>Animations</b><div class="d">card reveals, grade flashes, confetti when a session ends</div></div>
      <button class="tgl ${s.anim!==false?'on':''}" onclick="S.settings.anim=S.settings.anim===false?true:false;save();renderSet()"><i></i></button></div>
  </div>`;
}
/* settings rows */
function cardStratPanel(){
  const s=S.settings, sc=s.prodScope||'current';
  const nProd=Object.keys(S.cards).filter(c=>modeOf(c)==='prod').length, nLive=Object.keys(S.cards).filter(c=>modeOf(c)==='prod'&&prodInScope(c.split(':')[0])).length;
  return `<div class="card"><div class="lab">Card strategy</div>
    <div class="set-row"><div><b>Write cards (聽寫)</b><div class="d">The second card of a word is now audio-first: hear it, write it on paper, then check the character. <b>${nLive}</b> of ${nProd} are in play.</div></div>
      <select class="vsel" onchange="S.settings.prodScope=this.value;save();badge();renderSet()">
        <option value="current" ${sc==='current'?'selected':''}>Live lesson + previous + hard list</option>
        <option value="all" ${sc==='all'?'selected':''}>Every tracked word</option>
        <option value="off" ${sc==='off'?'selected':''}>Off — recognition only</option>
      </select></div>
    <div class="set-row"><div><b>Dictation drill order</b><div class="d">what appears after the audio, before the character</div></div>
      <select class="vsel" onchange="S.settings.dictHint=this.value;save();renderSet()">
        <option value="early" ${s.dictHint!=='late'?'selected':''}>Pinyin + meaning right away</option>
        <option value="late" ${s.dictHint==='late'?'selected':''}>Audio only, tap for pinyin + meaning</option>
      </select></div>
  </div>`;
}

/* ---- 2. preload ---- */
async function preloadOffline(btn){
  const say=t=>{if(btn)btn.textContent=t;const s=document.getElementById('preStat');if(s)s.textContent=t;};
  try{
    say('Loading voice pack…'); const ok=await loadPack(); if(!ok)throw new Error('voice pack');
    say('Loading stroke data…'); await loadStrokes(); await ensureHW();
    if('caches' in window){try{const c=await caches.open('zika-assets-v1'),f='assets/'+VOICE_PACKS[APACK_ID||'f'].file;await c.addAll([f+'.pack',f+'-index.json','assets/strokes.json?v=2','assets/hanzi-writer.min.js']);}catch(e){}}
    S.settings.preloadedAt=Date.now(); save(); say('Ready offline ✓'); toast('Voice pack and strokes are stored on this device');
  }catch(e){say('Could not preload — try on wifi');}
}
function offlinePanel(){
  const at=S.settings.preloadedAt;
  return `<div class="card" id="offlineCard"><div class="lab">Offline & audio</div>
    <div class="set-row"><div><b>Store the voice pack and strokes on this device</b><div class="d">About 22 MB once, on Wi-Fi. After that every word and character speaks, and stroke order plays, with no connection — including on the MRT. Switching the bundled voice needs one more download. <span id="preStat">${at?'Ready offline ✓ · '+ago(at):'Not stored yet'}</span></div></div>
      <button class="btn sm ${at?'ghost':''}" onclick="preloadOffline(this)">${at?'Refresh':'Download now'}</button></div></div>`;
}
/* ---- 1. iPad card ---- */
function ipadPanel(){
  const linked=!!SYNC.code, ios=(typeof isIOS==='function')&&isIOS(), standalone=(typeof isStandalone==='function')&&isStandalone();
  const step=(n,t,d,done)=>`<div class="istep ${done?'done':''}"><span class="in">${done?'✓':n}</span><div><b>${t}</b><div class="small muted">${d}</div></div></div>`;
  if(!ios){ /* the Mac side */
    return `<div class="card" id="ipadCard"><div class="lab">Set up your iPhone or iPad</div>
      ${step(1,'Generate a sync code on this Mac','Settings → Cloud sync → Generate. The code is just a room name; the Mac’s deck becomes the shared one.',linked)}
      ${step(2,'Scan the QR code with the iPhone or iPad camera','It opens the app in Safari already linked to this deck. If it asks which copy wins, pick <b>Mac</b>.',false)}
      ${step(3,'Add it to the Home Screen','In Safari: Share ↑ → Add to Home Screen. The Home Screen app keeps its own storage — open it once and tap <b>Paste</b> (the code is copied for you).',false)}
      ${step(4,'Download the voice pack on that device','Settings → Offline & audio → Download now, on Wi-Fi. Then it works on the MRT.',false)}
      ${linked?`<div class="row" style="gap:12px;align-items:flex-start;margin-top:10px;flex-wrap:wrap"><div class="qrbox">${qrSvg(syncLink(),4)}</div><div class="small muted" style="flex:1;min-width:200px">Code <b style="font-size:15px;color:var(--ink)">${esc(SYNC.code)}</b><br>Point the camera here, or <span class="link" onclick="fbCopyLink()">copy the link</span> and AirDrop it.<br><br>Status: ${esc(SYNC_LABEL[SYNC.status]||SYNC.status)}${SYNC.remoteDev&&SYNC.remoteDev!==DEVICE.name?` · last write from <b>${esc(SYNC.remoteDev)}</b> ${esc(ago(SYNC.remoteAt))}`:''}</div></div>`:`<div class="row" style="gap:6px;margin-top:10px"><button class="btn sm" onclick="fbNewCode();renderSet()">Generate the code</button></div>`}
    </div>`;
  }
  /* the iPad side */
  const kind=guessDevice();
  return `<div class="card" id="ipadCard"><div class="lab">This ${esc(kind)}</div>
    ${step(1,'Linked to the shared deck',linked?'Code <b>'+esc(SYNC.code)+'</b> · '+esc(SYNC_LABEL[SYNC.status]||SYNC.status):'Scan the QR code on the Mac (Settings → Set up your iPhone or iPad), or paste the code below.',linked)}
    ${linked?'':`<div class="row" style="gap:6px;margin:6px 0 10px"><input id="ipadCodeInp" class="search" style="margin:0;width:160px;padding:7px 10px;font-size:13px" placeholder="zika-xxxxxx" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn sm" onclick="fbSetCode(document.getElementById('ipadCodeInp').value)">Link</button><button class="btn ghost sm" onclick="fbPasteCode('ipadCodeInp')">Paste</button></div>`}
    ${step(2,'On the Home Screen',standalone?'You’re in the Home Screen app.':'In Safari: Share ↑ → Add to Home Screen. Open it from there; it keeps its own storage, so paste the code once more if it asks.',standalone)}
    ${step(3,'Voice pack stored for offline',S.settings.preloadedAt?'Ready ✓':'Settings → Offline & audio → Download now, on Wi-Fi.',!!S.settings.preloadedAt)}
    ${step(4,'Device name',DEVICE.name===kind?'Shows as '+esc(kind)+' on your other devices.':'Showing as '+esc(DEVICE.name)+' — set it to '+esc(kind)+' in Cloud sync → This device.',DEVICE.name===kind)}
  </div>`;
}
/* ---- 3. one intake card ---- */
function intakePanel(){
  const s=S.settings;
  const row=(t,d,ctrl)=>`<div class="set-row"><div><b>${t}</b><div class="d">${d}</div></div>${ctrl}</div>`;
  const num=(k,min,max,def,extra)=>`<input type="number" min="${min}" max="${max}" value="${s[k]??def}" onchange="const v=parseInt(this.value);S.settings.${k}=Math.max(${min},isNaN(v)?${def}:v);save();badge();${extra||''}">`;
  const free=(k,ctrl)=>`<div class="row" style="gap:10px">${s[k]?'':ctrl}<label class="small muted" style="display:flex;align-items:center;gap:5px;white-space:nowrap"><input type="checkbox" ${s[k]?'checked':''} onchange="S.settings.${k}=this.checked;save();badge();renderSet()">no limit</label></div>`;
  const cl=s.curLesson||MAX_LN;
  return `<div class="card" id="intakeCard"><div class="lab">Daily intake</div>
    ${row('Live lesson','the lesson your class is on now. It decides what counts as “this week”, which write cards are live, and the daily plan',lessonPick(cl,'S.settings.curLesson=v;save();badge();renderSet()'))}
    ${row('This week’s new words','per day, from the live lesson; both cards of a word may start the same day',free('newUnlimited',num('newPerDay',0,60,8)))}
    ${row('Catch-up words','per day, only words the mastery test marked shaky or ✗',num('newCatchPerDay',0,60,12))}
    ${row('Grammar cloze cards','per day; the Grammar tab decides which lessons are in',num('newGramPerDay',0,30,4))}
    ${row('Review cap','most cards shown per day across all lanes',free('revUnlimited',num('maxRev',10,9999,300)))}
    ${row('Desired retention','85–90% is the sweet spot; 95% roughly doubles the load',`<div class="row"><input type="range" min="80" max="97" value="${Math.round((s.retention||0.9)*100)}" onchange="S.settings.retention=this.value/100;save();this.nextElementSibling.textContent=this.value+'%'" oninput="this.nextElementSibling.textContent=this.value+'%'"><b>${Math.round((s.retention||0.9)*100)}%</b></div>`)}
    <div class="small muted" style="margin-top:6px">Rule of thumb: about ten reviews per new card in its first month. ${(s.newPerDay??8)+(s.newCatchPerDay??12)+(s.newGramPerDay??4)} new a day settles near ${((s.newPerDay??8)+(s.newCatchPerDay??12)+(s.newGramPerDay??4))*10} reviews a day.</div></div>`;
}
const SET_ORDER=['Set up your iPhone or iPad','This iPhone','This iPad','Cloud sync','Daily intake','Card strategy','Offline & audio','Audio & strokes','Backup','Look & feel','Card types','Schedule','Grammar in the queue','Confidence · shared with Notion'];
