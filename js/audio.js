/* Audio: the bundled voice packs (one file of MP3 clips plus an index per voice), playAudio, and the device's own
   speech voice as the fallback for anything a pack does not hold. The packs and their builders: docs/voice.md. */

/* ============ AUDIO (speechSynthesis, best zh-TW voice) ============ */
let VOICES=[];
function loadVoices(){try{VOICES=(window.speechSynthesis?speechSynthesis.getVoices():[]).filter(v=>/^(zh|cmn)/i.test(v.lang)||/中文|國語|粵語|普通话/.test(v.name));}catch(e){VOICES=[];}}
function rankVoice(v){
  let s=0; const nm=v.name+' '+v.lang;
  if(/國語|臺灣|Taiwan/i.test(nm))s+=50;
  if(/zh[-_]TW/i.test(v.lang))s+=25;
  if(/Google/i.test(v.name))s+=30;
  const male=voiceId()!=='f';
  if(/Mei-?Jia|美佳|Yating|雅婷|Hsiao|曉|Ting-?Ting|婷|Xiaoxiao|Female|女/i.test(nm))s+=male?-30:40;
  if(/Liang|Aaron|YunJhe|雲哲|Kangkang|\bMale|男/i.test(nm))s+=male?40:-30;
  if(/zh[-_]CN|cmn/i.test(v.lang))s+=8;
  if(/粵|Cantonese|HK/i.test(nm))s-=40;
  if(!v.localService)s+=6;
  return s;
}
/* Bundled neural audio: one pack per voice (a single file of MP3 clips plus an index of offsets),
   with the system speech voice as the fallback for anything the pack does not hold. */
const VOICE_PACKS={f:{file:'audio-tw',name:'曉臻',who:'female'},m:{file:'audio-tw-m',name:'雲哲',who:'male'},me:{file:'audio-me',name:'我的聲音',who:'your own voice'}};
function voiceId(){return VOICE_PACKS[S.settings.voicePack]?S.settings.voicePack:'f';}
/* which packs this deployment actually carries — Settings only offers voices that exist */
const VOICE_OK={f:true};
const AUDIO_MISS={};
const AUDIO_SAID={};   /* audioKey → the voice that last said it on this page: a pack's key (f, m, me) or 'system' */
let curAudio=null;
function audioKey(t){t=String(t).split('（')[0];const h=t.replace(/[^㐀-鿿]/g,'');return h||t.replace(/[^A-Za-z0-9]/g,'');}
/* Words that share characters but not sound (了 le / liǎo, 得 de / děi) have one clip per reading, keyed 字@pinyin.
   tools/build_voice_pack_breezy.py builds the same string in py_id(). */
function pyKey(p){return String(p||'').split('/')[0].toLowerCase().normalize('NFC').replace(/[\s'’\-·,，!！]/g,'');}
let APACK=null,APACKP=null,AIDX=null,AURL={},APACK_ID=null;
function loadPack(){
  const want=voiceId();
  if(APACKP&&APACKP.want===want)return APACKP;
  const get=v=>Promise.all([
    fetch('assets/'+VOICE_PACKS[v].file+'-index.json').then(r=>{if(!r.ok)throw 0;return r.json()}),
    fetch('assets/'+VOICE_PACKS[v].file+'.pack').then(r=>{if(!r.ok)throw 0;return r.arrayBuffer()})
  ]).then(([idx,buf])=>({v,idx,buf}));
  const pr=get(want).catch(e=>{if(want==='f')throw e;return get('f');})   /* a voice that is not on the server falls back to the default one */
    .then(got=>{
      if(APACKP!==pr)return APACKP||false;                                /* the voice changed while this one was loading */
      for(const k in AURL)URL.revokeObjectURL(AURL[k]); AURL={}; for(const k in AUDIO_MISS)delete AUDIO_MISS[k];
      AIDX=got.idx; APACK=got.buf; APACK_ID=got.v; return true;
    })
    .catch(()=>{if(APACKP===pr)APACKP=null;return false;});               /* a failed load is retried on the next play, not remembered */
  pr.want=want; APACKP=pr; return pr;
}
function playBundled(text,onFail,py){
  const base=audioKey(text);
  if(!base||AUDIO_MISS[base]){onFail();return;}
  loadPack().then(ok=>{
    if(!ok||!AIDX){onFail();return;}
    const exact=py?base+'@'+pyKey(py):'', k=exact&&AIDX[exact]?exact:base;
    if(!AIDX[k]){AUDIO_MISS[k]=1;onFail();return;}
    try{
      if(!AURL[k]){
        const[o,l]=AIDX[k];
        AURL[k]=URL.createObjectURL(new Blob([APACK.slice(o,o+l)],{type:'audio/mpeg'}));
      }
      if(curAudio){try{curAudio.pause();}catch(e){}}
      const a=new Audio(AURL[k]);
      a.playbackRate=Math.min(1.3,audioSpeed()/0.9); // clips are recorded slightly slow — the speed setting scales them
      curAudio=a;
      a.onerror=()=>{AUDIO_MISS[k]=1;onFail();};
      AUDIO_SAID[base]=APACK_ID;
      a.play().catch(()=>{onFail();});
    }catch(e){onFail();}
  });
}
/* 'auto' and 'bundled' both play the bundled Taiwan voice first; 'system' always uses the device's speech voice */
function playAudio(text,py){
  const system=()=>{AUDIO_SAID[audioKey(text)]='system';speakText(text);};
  if((S.settings.audioSrc||'auto')==='system'){system();return;}
  playBundled(text,system,py);
}
/* the voice that says `text` here: the one that last did on this page; before anything has played, the one that would */
function audioVoice(text){
  const k=audioKey(text); if(AUDIO_SAID[k])return AUDIO_SAID[k];
  if((S.settings.audioSrc||'auto')==='system')return 'system';
  return AIDX?(AIDX[k]&&!AUDIO_MISS[k]?APACK_ID:'system'):voiceId();
}
function setVoice(v){
  if(!VOICE_PACKS[v])return;
  S.settings.voicePack=v; save(); if(view==='set')renderSet();
  loadPack().then(ok=>{ if(ok&&APACK_ID===v)playAudio('謝謝'); else toast(VOICE_PACKS[v].name+' could not be loaded — check the connection and try again'); });
}
function pickVoice(){
  if(!VOICES.length)loadVoices();
  if(S.settings.voiceName){const m=VOICES.find(v=>v.name===S.settings.voiceName);if(m)return m;}
  return VOICES.slice().sort((a,b)=>rankVoice(b)-rankVoice(a))[0]||null;
}
function audioSpeed(){return S.settings.audioSpeed||0.9;}
function speakText(text){
  if(!window.speechSynthesis||!text)return;
  try{
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    const v=pickVoice(); if(v){u.voice=v;u.lang=v.lang;}else u.lang='zh-TW';
    u.rate=audioSpeed();
    speechSynthesis.speak(u);
  }catch(e){}
}
function speakWord(wid){
  const w=byId[wid]; if(!w)return;
  playAudio(w.t,w.p);
}
const SPK_SVG='<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a3.5 3.5 0 0 0-2-3.15v6.3a3.5 3.5 0 0 0 2-3.15zm-2-6.7v2.06A5 5 0 0 1 18 12a5 5 0 0 1-3.5 4.64v2.06A7 7 0 0 0 20 12a7 7 0 0 0-5.5-6.7z"/></svg>';
function spkBtn(wid,lg){return '<button class="spk'+(lg?' lg':'')+'" title="pronounce" onclick="event.stopPropagation();speakWord(\''+wid+'\')">'+SPK_SVG+'</button>';}
function spkBtnText(t){window.AUDS=window.AUDS||[];const i=AUDS.push(t)-1;return '<button class="spk" title="listen" onclick="playAudio(AUDS['+i+'])">'+SPK_SVG+'</button>';}

/* ---- "Sounds wrong" (Voice V0, docs/voice.md): the learner's note that a word was said wrongly ----
   A small text button beside the speaker on a card's answer side and in the dictionary entry; never on a question
   side. The list is kept on this device only, in a key of its own: it is not part of the deck, is not backed up
   with it and never syncs. One mark per word and voice, [{t, p, v, at}]: the word or character, its pinyin where
   the app has it, the voice that was saying it (a pack's key, or 'system'), and when. Pressing the button again for
   the same word and voice takes the mark off. Settings → Audio counts the marks, copies them and clears them. */
const AW_KEY='zika_sounds_wrong_v1';
function awList(){try{const a=JSON.parse(store.getItem(AW_KEY)||'[]');return Array.isArray(a)?a:[];}catch(e){return [];}}
function awPut(a){try{if(a.length)store.setItem(AW_KEY,JSON.stringify(a));else store.removeItem(AW_KEY);}catch(e){}}
const awWord=t=>String(t||'').split('（')[0].trim();          /* 故宮博物院（故宮）is said, and marked, as 故宮博物院 */
const awAttr=s=>esc(s||'').replace(/"/g,'&quot;');
function awHas(t){const w=awWord(t), v=audioVoice(w);return awList().some(x=>x.t===w&&x.v===v);}
function awVoiceName(v){return v==='system'?'system voice':VOICE_PACKS[v]?VOICE_PACKS[v].name+' ('+VOICE_PACKS[v].file+')':String(v);}
/* the tick has its room whether or not it shows, so marking a word never moves what is around the button */
function awBtn(t,p){
  const on=awHas(t);
  return '<button type="button" class="link small awb" data-t="'+awAttr(awWord(t))+'" data-p="'+awAttr(p)+'" aria-pressed="'+on+'" title="'+(on?'marked as sounding wrong · tap to take the mark off':'mark this recording as sounding wrong')+'" onclick="event.stopPropagation();awToggle(this)">Sounds wrong<i aria-hidden="true">✓</i></button>';
}
function awToggle(el){
  const t=el.dataset.t, v=audioVoice(t), a=awList(), i=a.findIndex(x=>x.t===t&&x.v===v);
  if(i>=0)a.splice(i,1); else a.push({t,p:el.dataset.p||'',v,at:Date.now()});
  awPut(a); awPaint();
}
/* every button on the page for a word says the same thing (a card can lie under its own dictionary entry), and so does the row in Settings */
function awPaint(){
  document.querySelectorAll('.awb').forEach(b=>{const on=awHas(b.dataset.t); b.setAttribute('aria-pressed',on); b.title=on?'marked as sounding wrong · tap to take the mark off':'mark this recording as sounding wrong';});
  const row=document.getElementById('awRow'); if(row)row.outerHTML=awRow();
}
function awRow(){
  const n=awList().length;
  return '<div class="set-row" id="awRow"><div><b>Sounds wrong · '+n+'</b><div class="d">Words you marked “Sounds wrong” on a card’s answer side or in a dictionary entry. Kept on this device only. Copy list gives one line a word: the word, its pinyin, the voice, the date.</div></div>'
    +'<div class="row" style="gap:6px"><button class="btn ghost sm" onclick="awCopy()" '+(n?'':'disabled')+'>Copy list</button><button class="btn ghost sm" onclick="awClear()" '+(n?'':'disabled')+'>Clear</button></div></div>';
}
function awText(){return awList().map(x=>[x.t,x.p||'',awVoiceName(x.v),dkey(new Date(x.at))].join('\t')).join('\n');}
function awCopy(){
  const a=awList(), txt=awText(); if(!a.length)return;
  const done=()=>toast('Copied '+a.length+' word'+(a.length===1?'':'s')), show=()=>awSheet(txt);
  try{ if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).then(done,show); else show(); }catch(e){show();}
}
/* where the browser will not copy for the page: the list in a box, to be selected and copied by hand */
function awSheet(txt){
  const m=shHost();
  m.innerHTML='<div class="modal-card"><div class="sheet-h"><b>Sounds wrong</b><button class="xbtn" onclick="shClose()" aria-label="close">✕</button></div>'
    +'<div class="small muted" style="margin:-4px 0 10px">Select all of it and copy.</div><textarea id="awBox" class="myin" readonly spellcheck="false" lang="zh-Hant"></textarea></div>';
  m.style.display='flex';
  const box=document.getElementById('awBox'); box.value=txt; try{box.focus();box.select();}catch(e){}
}
function awClear(){
  const a=awList(); if(!a.length)return;
  awPut([]); awPaint();
  toast('Cleared '+a.length+' word'+(a.length===1?'':'s'),{action:'Undo',ms:7000,onAction:()=>{awPut(a);awPaint();}});
}
if(typeof zikaWhole==='function')zikaWhole();   /* the last line: this file arrived whole (index.html, js/boot.js) */
