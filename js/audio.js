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
      a.play().catch(()=>{onFail();});
    }catch(e){onFail();}
  });
}
/* 'auto' and 'bundled' both play the bundled Taiwan voice first; 'system' always uses the device's speech voice */
function playAudio(text,py){
  if((S.settings.audioSrc||'auto')==='system'){speakText(text);return;}
  playBundled(text,()=>speakText(text),py);
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
