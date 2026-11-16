/* Characters: components and etymology, the anatomy line on a card's answer side, links to look a word up
   elsewhere, and stroke order drawn with Hanzi Writer from assets/strokes.json. A tap on a character or one of
   its parts opens its dictionary entry (js/dict.js). */

/* ============ CHARACTER STORIES (components & etymology) ============ */
const BCHARS=(()=>{const s=new Set();WORDS.forEach(w=>{for(const ch of w.t)if(/\p{Script=Han}/u.test(ch))s.add(ch);});return [...s];})();
const CIDX=(()=>{const m={};BCHARS.forEach(ch=>{new Set((COMPONENTS[ch]||{}).d||[]).forEach(c=>{(m[c]=m[c]||[]).push(ch);});});return m;})();
const ETYPE={pictophonetic:'form + sound 形聲',ideographic:'meaning + meaning 會意',pictographic:'a picture 象形'};
function compChip(c){
  const i=COMPONENTS[c]||{};
  return '<span class="cchip zh" onclick="dcOpen(\''+c+'\')">'+esc(c)+'<i>'+(i.p?esc(i.p)+(i.g?' · ':''):'')+esc(i.g||'')+'</i></span>';
}
function charExpl(ch){ // one-line "why it looks this way"
  const e=COMPONENTS[ch]; if(!e)return'';
  if(e.t==='pictophonetic'&&(e.s||e.ph)){
    const sg=(COMPONENTS[e.s]||{}).g||e.h||'';
    const pp=(COMPONENTS[e.ph]||{}).p||'';
    return (e.s?e.s+(sg?' ('+sg+')':'')+' carries the meaning':'')+(e.ph?(e.s?' · ':'')+e.ph+(pp?' '+pp:'')+' lends the sound':'');
  }
  return e.h||'';
}
function charStoryHtml(ch){ // how a character is built, for its dictionary entry: its parts, why, its sound family, where else each part turns up
  const e=COMPONENTS[ch]; if(!e)return'';
  const kids=(e.d||[]).filter(c=>COMPONENTS[c]), to=c=>'<span class="link zh" onclick="dcOpen(\''+c+'\')">'+esc(c)+'</span>';
  let html='';
  if(kids.length)html+='<div class="row" style="gap:2px">'+kids.map(c=>compChip(c)).join('<span class="muted" style="margin:0 3px">＋</span>')+'<span class="muted" style="margin:0 6px">→</span><span class="cchip zh on" style="cursor:default">'+esc(ch)+'</span></div>';
  const ex=charExpl(ch);
  if(ex)html+='<div class="small" style="margin-top:8px;color:var(--mut)">'+esc(ex)+'</div>';
  if(e.ph){
    const fam=BCHARS.filter(c2=>c2!==ch&&(COMPONENTS[c2]||{}).ph===e.ph).slice(0,8);
    if(fam.length)html+='<div class="small" style="margin-top:8px"><span class="muted">same sound-family ('+esc(e.ph)+'):</span> '+fam.map(to).join(' ')+'</div>';
  }
  html+=(e.d||[]).map(c=>{
    const sibs=(CIDX[c]||[]).filter(x=>x!==ch).slice(0,8);
    return sibs.length?'<div class="small" style="margin-top:5px"><span class="muted">you\'ve met '+esc(c)+' in:</span> '+sibs.map(to).join(' ')+'</div>':'';
  }).join('');
  return html;
}
function compLines(word){return anatomyHtml(word);}

/* ============ STROKE ORDER (Hanzi Writer) ============ */
let HWPromise=null;
function ensureHW(){
  if(window.HanziWriter)return Promise.resolve(true);
  if(HWPromise)return HWPromise;
  HWPromise=new Promise(res=>{
    const tryLoad=srcs=>{
      if(!srcs.length)return res(false);
      const s=document.createElement('script'); s.src=srcs[0];
      s.onload=()=>res(!!window.HanziWriter); s.onerror=()=>tryLoad(srcs.slice(1));
      document.head.appendChild(s);
    };
    tryLoad(['assets/hanzi-writer.min.js','https://cdn.jsdelivr.net/npm/hanzi-writer@3.5/dist/hanzi-writer.min.js','https://cdnjs.cloudflare.com/ajax/libs/hanzi-writer/3.5.0/hanzi-writer.min.js']);
  });
  return HWPromise;
}
let STROKES=null,STROKESP=null;
function loadStrokes(){
  if(STROKES)return Promise.resolve(STROKES);
  if(STROKESP)return STROKESP;
  STROKESP=fetch('assets/strokes.json?v=2')   /* bump ?v= whenever strokes.json changes, here and in sw.js */
    .then(r=>{if(!r.ok)throw 0;return r.json()}).then(d=>{STROKES=d;return d;}).catch(()=>{STROKES={};return STROKES;});
  return STROKESP;
}
function strokeDataLoader(char,onComplete,onErr){
  loadStrokes().then(d=>{
    if(d[char]){onComplete(d[char]);return;}
    fetch('https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/'+encodeURIComponent(char)+'.json').then(r=>{if(!r.ok)throw 0;return r.json()}).then(onComplete).catch(()=>onErr&&onErr());
  });
}
const STROKE_W={};   /* host id → the writers drawn in it, so that one set of boxes (a card) is not replayed by another (the dictionary sheet over it) */
function renderStrokes(hostId,text,opts){   /* opts.still: draw the finished characters and wait for Replay */
  opts=opts||{};
  const host=document.getElementById(hostId); if(!host)return;
  const chars=[...text].filter(ch=>/\p{Script=Han}/u.test(ch));
  if(!chars.length)return;
  const none=()=>{   /* no library or no stroke data: the boxes and their Replay button go, and the note for that host shows if it has one */
    host.style.display='none';
    const t=host.parentElement&&host.parentElement.querySelector('.stroketools'); if(t)t.style.display='none';
    const fb=document.getElementById(hostId+'-fb'); if(fb)fb.style.display='';
  };
  ensureHW().then(ok=>{
    if(!host.isConnected)return;
    if(!ok){none();return;}
    host.innerHTML=chars.map((c,i)=>'<div class="strokebox" id="'+hostId+'-c'+i+'"></div>').join('');
    const ws=STROKE_W[hostId]=[];
    const size=opts.size||102;
    chars.forEach((ch,i)=>{
      try{
        const wtr=HanziWriter.create(hostId+'-c'+i,ch,{
          width:size,height:size,padding:6,
          strokeColor:cssVar('--ink')||'#1d1c1a',outlineColor:cssVar('--line2')||'#e3dfd8',radicalColor:cssVar('--acc')||'#0e7266',
          strokeAnimationSpeed:1.05,delayBetweenStrokes:110,delayBetweenLoops:2500,
          showCharacter:!!opts.still,showOutline:true,
          charDataLoader:(c,onC)=>strokeDataLoader(c,onC,()=>{const b=document.getElementById(hostId+'-c'+i);if(b)b.style.display='none';})
        });
        ws.push(wtr);
      }catch(e){}
    });
    if(!opts.still)playStrokes(hostId);
    setTimeout(()=>{if(host.isConnected&&!host.querySelector('svg path'))none();},3500);   /* no stroke data ever arrived */
  });
}
function playStrokes(hostId){
  const ws=(STROKE_W[hostId]||[]).slice(); if(!ws.length)return;
  const next=i=>{ if(i>=ws.length)return; try{ws[i].animateCharacter({onComplete:()=>setTimeout(()=>next(i+1),260)});}catch(e){next(i+1);} };
  ws.forEach(w=>{try{w.hideCharacter({duration:0})}catch(e){}});
  next(0);
}
const SIMP_CHAR={}; WORDS.forEach(w=>{if(w.s&&w.s.length===w.t.length){for(let i=0;i<w.t.length;i++){if(w.t[i]!==w.s[i])SIMP_CHAR[w.t[i]]=w.s[i];}}});
function charModel(){
  const map=new Map();
  studyWords().forEach(w=>{
    for(const ch of w.t){
      if(!/\p{Script=Han}/u.test(ch))continue;
      if(!map.has(ch))map.set(ch,{ch,words:[],stage:0,due:false,lesson:99,mem:null,mastAt:null});
      const e=map.get(ch);
      e.words.push(w.id);
      e.lesson=Math.min(e.lesson,w.l);
      const st=wordStage(w.id);
      if(st>e.stage){e.stage=st;}
      if(wordDueNow(w.id))e.due=true;
      const m=wordMem(w.id); if(m!==null)e.mem=e.mem===null?m:Math.max(e.mem,m);
      const ma=wordMastAt(w.id); if(ma)e.mastAt=e.mastAt?Math.min(e.mastAt,ma):ma;
    }
  });
  return [...map.values()];
}
function lookupLinks(text){
  const t=String(text).split('（')[0].trim(); if(!t)return '';
  const enc=encodeURIComponent(t), mobile=(typeof isIOS==='function'&&isIOS())||isAndroidUA();
  const a=(href,label,title)=>`<a class="lk" href="${href}" target="_blank" rel="noopener" title="${title||''}" onclick="event.stopPropagation()">${label}</a>`;
  return `<div class="lookup"><span class="lk-cap">look up</span>
    ${a('https://www.moedict.tw/'+enc,'萌典','教育部國語辭典 — Taiwan, traditional, stroke order')}
    ${a('https://www.mdbg.net/chinese/dictionary?page=worddict&wdrst=1&wdqb='+enc,'MDBG','CC-CEDICT with character decomposition')}
    ${mobile?a('plecoapi://x-callback-url/s?q='+enc,'Pleco','opens the Pleco app'):''}
    <a class="lk" href="https://skritter.com/" target="_blank" rel="noopener" title="copies the word, then opens Skritter — paste it into Add Words" onclick="event.stopPropagation();try{navigator.clipboard&&navigator.clipboard.writeText('${t.replace(/'/g,'')}');toast('${t.replace(/'/g,'')} copied — paste it into Skritter');}catch(e){}">Skritter</a>
  </div>`;
}
function lookupRow(text){
  const h=lookupLinks(text); const t=String(text).split('（')[0]; const ch=[...t].find(c=>/\p{Script=Han}/u.test(c)); if(!ch)return h;
  return h.replace('</div>',`<a class="lk" href="https://hanziyuan.net/#${encodeURIComponent(ch)}" target="_blank" rel="noopener" title="Chinese Etymology — oracle bone to modern form" onclick="event.stopPropagation()">字源</a></div>`);
}
/* ---- C. anatomy: meaning part + sound part, with the sound part's own reading ---- */
function anatomyHtml(word){
  if(S.settings.showComp===false)return '';
  const chars=[...String(word).split('（')[0]].filter((c,i,a)=>/\p{Script=Han}/u.test(c)&&a.indexOf(c)===i);     /* a character said twice (慢慢來) is taken apart once */
  const rows=chars.map(ch=>{
    const e=COMPONENTS[ch]||{};
    const part=c=>{const i=COMPONENTS[c]||{};const role=c===e.s?'meaning':c===e.ph?'sound':'';return `<span class="apart ${role}" onclick="event.stopPropagation();dcOpen('${c}')" title="${c} in the dictionary"><b class="zh">${esc(c)}</b><i>${esc(i.p||'')}${i.g?(i.p?' · ':'')+esc(i.g.split(',')[0]):''}</i>${role?`<u>${role}</u>`:''}</span>`;};
    const fam=e.ph?BCHARS.filter(c2=>c2!==ch&&(COMPONENTS[c2]||{}).ph===e.ph).slice(0,6):[];
        return `<div class="arow"><span class="ahead zh" onclick="event.stopPropagation();dcOpen('${ch}')" title="${ch} in the dictionary">${esc(ch)}<i>${esc(e.p||'')}</i></span>${(e.d||[]).length?(e.d.map(part).join('<span class="aplus">＋</span>')):'<span class="small muted">single-part character</span>'}
      ${e.t&&ETYPE[e.t]?`<span class="atype">${esc(ETYPE[e.t])}</span>`:''}<button class="infobtn" onclick="event.stopPropagation();dcOpen('${ch}')" title="${ch} in the dictionary: strokes, parts, words, examples">ⓘ</button>
      ${fam.length?`<span class="afam">same sound part: ${fam.map(c=>`<b class="zh" onclick="event.stopPropagation();dcOpen('${c}')">${esc(c)}</b>`).join(' ')}</span>`:''}</div>`;
  });
  return rows.length?`<div class="anatomy">${rows.join('')}</div>`:'';
}

if(typeof zikaWhole==='function')zikaWhole();   /* the last line: this file arrived whole (index.html, js/boot.js) */
