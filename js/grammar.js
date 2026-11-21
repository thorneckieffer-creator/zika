/* Grammar: the Grammar tab and its quiz, grammar points as cards in the review queue, families of patterns and
   the grasp map. */

/* ============ GRAMMAR DRILLS ============ */
let gramLesson=1, gq=null, gramOpen={};
const GPOOL=['嗎','呢','吧','的','得','都','也','很','不','沒','了','還是','或是','可以','會','能','想','要','先','再','就','比','跟','給','把','別','最','更','太','常','剛','已經','應該','打算','因為','所以','可是','不過','要是','一樣','每','只','又','從','到','在','離','當然','好像','需要','希望','一直','最好'];
const DICT=(()=>{const s=new Set(GPOOL);WORDS.forEach(w=>{const h=w.t.split('（')[0].replace(/[^㐀-鿿]/g,'');if(h)s.add(h);});return s;})();
function segZh(zh){
  const clean=zh.replace(/[。？！]/g,'');
  const parts=clean.split(/(，)/).filter(Boolean);
  const out=[];
  for(const part of parts){
    if(part==='，'){out.push('，');continue;}
    let i=0;
    while(i<part.length){
      let hit=null;
      for(let L=Math.min(5,part.length-i);L>=2;L--){
        if(DICT.has(part.substr(i,L))){hit=part.substr(i,L);break;}
      }
      if(hit){out.push(hit);i+=hit.length;}
      else{out.push(part[i]);i++;}
    }
  }
  // merge lone singles with a neighbor to keep chips meaningful
  const merged=[];
  for(const c of out){
    if(c.length===1&&c!=='，'&&merged.length&&merged[merged.length-1].length===1&&merged[merged.length-1]!=='，')merged[merged.length-1]+=c;
    else merged.push(c);
  }
  return merged;
}
function gStat(id){return S.gram&&S.gram[id]?S.gram[id]:{n:0,ok:0};}
function gMark(id,ok){S.gram=S.gram||{};const g=S.gram[id]=S.gram[id]||{n:0,ok:0};g.n++;if(ok)g.ok++;save();}
function gDots(id){const g=gStat(id);const d=g.n===0?0:(g.ok/g.n>=0.8&&g.n>=6)?3:(g.ok/g.n>=0.6&&g.n>=3)?2:1;return '<span class="gdots">'+[1,2,3].map(i=>'<span class="gdot'+(i<=d?' on':'')+'"></span>').join('')+'</span>';}
function tgtIn(p,zh){return p.tgt.find(t=>zh.includes(t));}
/* question builders — each returns {type,p,html-parts...} */
function buildQuestion(p,type){
  const hasT=p.tgt&&p.tgt.length&&p.s.some(x=>tgtIn(p,x.zh));
  if(!hasT&&(type==='fib'||type==='mc'))type=(p.s.length>1?'build':'create');
  const sents=p.s.filter(s=>tgtIn(p,s.zh));
  const s=(type==='fib'||type==='mc')&&sents.length?sents[Math.floor(Math.random()*sents.length)]:p.s[Math.floor(Math.random()*p.s.length)];
  if(type==='fib'){
    const t=tgtIn(p,s.zh)||p.tgt[0];
    const opts=shuf([t,...sample(p.alt.concat(GPOOL),3,[t,...p.tgt])]);
    return {type,p,s,t,opts,blanked:s.zh.replace(t,'⬚')};
  }
  if(type==='mc'){
    const t=tgtIn(p,s.zh)||p.tgt[0];
    const altTok=(p.alt[0]&&!s.zh.includes(p.alt[0]))?p.alt[0]:sample(GPOOL,1,[t])[0];
    const c1=s.zh.replace(t,altTok);
    const c2=s.zh.replace(t,'');
    const segs=segZh(s.zh);
    let c3=s.zh;
    if(segs.length>2){const sw=shuf(segs.slice());c3=sw.join('')+(s.zh.match(/[。？！]$/)||[''])[0];if(c3===s.zh)c3=segs.slice().reverse().join('');}
    const opts=shuf([...new Set([s.zh,c1,c2,c3])].slice(0,4));
    return {type,p,s,opts,correct:s.zh};
  }
  if(type==='build'){
    let chunks=segZh(s.zh);
    let sh=shuf(chunks);
    let guard=0; while(sh.join('')===chunks.join('')&&guard++<5)sh=shuf(chunks);
    return {type,p,s,chunks,shuffled:sh,picked:[]};
  }
  if(type==='finish'){
    const cut=Math.max(2,Math.floor(s.zh.length*0.45));
    return {type,p,s,head:s.zh.slice(0,cut)};
  }
  return {type:'create',p,s};
}
const GTYPES=[['fib','Fill in the blank'],['mc','Multiple choice'],['build','Build the sentence'],['finish','Finish the sentence'],['create','Create your own']];
function startGramQuiz(scope){ // scope: array of points
  const pts=(scope||[]).filter(p=>p.s&&p.s.length);
  if(!pts.length){toast('No grammar points for this lesson yet');return;}
  const qs=[];
  const types=GTYPES.map(t=>t[0]);
  const n=Math.min(12,Math.max(6,pts.length*2));
  for(let i=0;i<n;i++){
    const p=pts[i%pts.length];
    qs.push(buildQuestion(p,types[Math.floor(Math.random()*types.length)]));
  }
  gq={qs:shuf(qs),i:0,ok:0,state:'ask',chosen:null};
  renderGram();
}
function gramAnswer(ok){const q=gq.qs[gq.i];gMark(q.p.id,ok);if(ok)gq.ok++;gq.state='done';renderGram();}
function gramPick(idx){ // fib / mc click
  const q=gq.qs[gq.i];
  if(gq.state!=='ask')return;
  gq.chosen=idx;
  const ok=q.type==='fib'?q.opts[idx]===q.t:q.opts[idx]===q.correct;
  gramAnswer(ok);
}
function gramChunk(i){
  const q=gq.qs[gq.i]; if(gq.state!=='ask')return;
  if(q.picked.includes(i))return;
  q.picked.push(i);
  if(q.picked.length===q.shuffled.length){
    const built=q.picked.map(x=>q.shuffled[x]).join('');
    gramAnswer(built===q.chunks.join(''));
  } else renderGram();
}
function gramUnchunk(k){const q=gq.qs[gq.i];if(gq.state!=='ask')return;q.picked.splice(k,1);renderGram();}
function gramNext(){gq.i++;gq.state='ask';gq.chosen=null;renderGram();}
function gramPaint(){
  const el=document.getElementById('vGram');
  window.AUDS=window.AUDS||[];
  const aud=t=>{const i=AUDS.push(t)-1;return '<button class="spk" title="listen" onclick="event.stopPropagation();playAudio(AUDS['+i+'])">'+SPK_SVG+'</button>';};
  if(gq){ /* ---- quiz runner ---- */
    if(gq.i>=gq.qs.length){
      const pct=Math.round(gq.ok/gq.qs.length*100);
      el.innerHTML=`<div class="card done"><div class="zhd zh">${pct>=80?'太好了！':pct>=50?'不錯！':'加油！'}</div>
        <div style="font-weight:600;font-size:16px">${gq.ok} / ${gq.qs.length} correct · ${pct}%</div>
        <div class="muted small" style="margin-top:4px">every answer updates the mastery dots on the grammar points</div>
        <div class="qfoot" style="margin-top:16px"><button class="btn ghost" onclick="gq=null;renderGram()">Back to points</button><button class="btn" onclick="startGramQuiz(GRAMMAR[gramLesson]||[])">Drill again</button></div></div>`;
      return;
    }
    const q=gq.qs[gq.i], p=q.p, done=gq.state==='done';
    let body='';
    if(q.type==='fib'){
      body=`<div class="qzh zh">${esc(q.blanked).replace('⬚','<span class="blank">'+(done?esc(q.t):'&nbsp;&nbsp;')+'</span>')}</div>
      <div class="qen">${esc(q.s.en)}</div>
      <div class="opts">${q.opts.map((o,i)=>`<button class="zh ${done?(o===q.t?'right':(gq.chosen===i?'wrong':'')):''}" onclick="gramPick(${i})">${esc(o)}</button>`).join('')}</div>`;
    } else if(q.type==='mc'){
      body=`<div class="qen" style="font-size:15.5px;color:var(--ink)">Which one says: “${esc(q.s.en)}”</div>
      <div class="opts sm" style="grid-template-columns:1fr">${q.opts.map((o,i)=>`<button class="zh ${done?(o===q.correct?'right':(gq.chosen===i?'wrong':'')):''}" onclick="gramPick(${i})">${esc(o)}</button>`).join('')}</div>`;
    } else if(q.type==='build'){
      body=`<div class="qen">Build: “${esc(q.s.en)}”</div>
      <div class="answer-line">${q.picked.map((x,k)=>`<span class="zh" onclick="gramUnchunk(${k})">${esc(q.shuffled[x])}</span>`).join('')||'<span style="border:0;background:none;color:var(--mut2)">tap the pieces in order…</span>'}</div>
      <div class="chunks">${q.shuffled.map((c,i)=>`<button class="zh" ${q.picked.includes(i)?'disabled':''} onclick="gramChunk(${i})">${esc(c)}</button>`).join('')}</div>
      ${done?`<div class="qzh zh" style="font-size:20px">${esc(q.s.zh)} ${aud(q.s.zh)}</div>${q.s.py?`<div class="py2">${tonePinyin(esc(q.s.py))}</div>`:''}`:''}`;
    } else if(q.type==='finish'){
      body=`<div class="qen">Finish it: “${esc(q.s.en)}”</div>
      <div class="qzh zh">${esc(q.head)}<span class="blank">…</span></div>
      ${done?`<div class="qzh zh" style="color:var(--acc)">${esc(q.s.zh)} ${aud(q.s.zh)}</div>`
      :gq.state==='reveal'?(q.mine?`<div class="small muted" style="text-align:center;margin:6px 0">yours: <span class="zh">${esc(q.head+q.mine)}</span></div>`:'')
      :`<textarea class="gtxt zh" id="gramInp" placeholder="say it aloud or type the rest…"></textarea>
        <div class="qfoot"><button class="btn" onclick="gq.qs[gq.i].mine=(document.getElementById('gramInp')||{}).value||'';gq.state='reveal';renderGram()">Reveal</button></div>`}
      ${gq.state==='reveal'?`<div class="qzh zh" style="color:var(--acc)">${esc(q.s.zh)} ${aud(q.s.zh)}</div>
        <div class="qfoot"><button class="btn ghost" onclick="gramAnswer(false)">Missed it</button><button class="btn" onclick="gramAnswer(true)">Got it ✓</button></div>`:''}`;
    } else { // create
      body=`<div class="qen" style="font-size:15px;color:var(--ink)">${esc(p.cy||(p.tgt&&p.tgt.length?'Write your own sentence using 「'+p.tgt[0]+'」':'Write your own sentence with this pattern'))}</div>
      ${p.tgt&&p.tgt.length?`<div class="qen">pattern: <b class="zh" style="color:var(--acc)">${p.tgt.map(esc).join(' / ')}</b></div>`:''}
      ${gq.state==='ask'?`<textarea class="gtxt zh" id="gramInp" placeholder="寫你自己的句子…"></textarea>
        <div class="qfoot"><button class="btn" onclick="gq.qs[gq.i].mine=(document.getElementById('gramInp')||{}).value||'';gq.state='reveal';renderGram()">Compare with model</button></div>`:''}
      ${gq.state==='reveal'?`${q.mine?`<div class="small muted" style="text-align:center;margin:6px 0">yours: <span class="zh">${esc(q.mine)}</span></div>`:''}<div class="gsent" style="justify-content:center"><span class="z zh">${esc(q.s.zh)}</span>${aud(q.s.zh)}</div><div class="qen">${esc(q.s.en)}</div>
        <div class="qfoot"><button class="btn ghost" onclick="gramAnswer(false)">Needs work</button><button class="btn" onclick="gramAnswer(true)">Mine works ✓</button></div>`:''}`;
    }
    el.innerHTML=`
    <div class="rev-top"><span class="qtype">${GTYPES.find(t=>t[0]===q.type)[1]}</span><span class="qprog">${gq.i+1} / ${gq.qs.length} · ${esc(p.t)}</span></div>
    <div class="qbox">${body}</div>
    ${done?`${(q.type==='fib'||q.type==='mc')&&q.s.py?`<div class="py2" style="text-align:center;margin-top:8px">${tonePinyin(esc(q.s.py))} ${aud(q.s.zh)}</div>`:''}<div class="qfoot" style="margin-top:12px"><button class="btn" onclick="gramNext()">Next →</button></div>
    <div class="small muted" style="text-align:center;margin-top:8px">${esc(p.e)}</div>`:''}`;
    return;
  }
  /* ---- browse mode ---- */
  const pts=GRAMMAR[gramLesson]||[];
  const gBook=bookOf(gramLesson);
  el.innerHTML=`
  <div class="segbar"><span class="cap">Book</span>
    ${bookButtons(gBook,b=>'gramLesson='+b.first+';gramOpen={};renderGram()')}
  </div>
  <div class="filters" style="margin-bottom:14px">${lessonsOf(gBook).map(ln=>`<button class="${gramLesson===ln?'on':''}" onclick="gramLesson=${ln};gramOpen={};renderGram()">${lnInBook(ln)}</button>`).join('')}</div>
  <div class="card" style="padding:16px 20px">
    <div class="row spread">
      <div><b>${lnLabel(gramLesson)} · ${LESSON_TITLES[gramLesson]}</b><div class="small muted">${pts.length} grammar points · drills mix all five exercise types</div></div>
      <button class="btn" onclick="startGramQuiz(GRAMMAR[gramLesson]||[])">Drill this lesson</button>
    </div>
  </div>
  ${pts.map((p,i)=>{
    const open=!!gramOpen[i];
    return `<div class="gpt">
      <div class="gh" onclick="gramOpen[${i}]=!gramOpen[${i}];renderGram()">
        <span class="car" style="color:var(--mut2);font-size:11px">${open?'▼':'▶'}</span>
        <div><div class="gt">${esc(p.t)}${p.src?` <span class="tag mtc">MTC</span>`:''}</div>${open?'':`<div class="ge">${esc(p.e)}</div>`}</div>
        ${gDots(p.id)}
        <button class="btn sm ghost" style="flex:none" onclick="event.stopPropagation();startGramQuiz([GRAMMAR[gramLesson][${i}]])">Drill</button>
      </div>
      ${open?`<div class="gex"><div class="ge" style="margin-bottom:8px">${esc(p.e)}</div>
        ${p.pat?`<div class="patline">${esc(p.pat)}</div>`:''}
        ${p.s.map(s=>`<div class="gsent"><span class="z zh">${esc(s.zh)}</span>${aud(s.zh)}<span class="e">${esc(s.en)}</span>${S.settings.showPy!==false&&s.py?`<div class="py2" style="width:100%">${tonePinyin(esc(s.py))}</div>`:''}</div>`).join('')}
        ${p.tw?`<div class="notebox tw"><b>Taiwan</b> ${esc(p.tw)}</div>`:''}
        ${p.ov?`<div class="notebox ov"><b>Overlap</b> ${esc(p.ov)}</div>`:''}
      </div>`:''}
    </div>`;
  }).join('')}`;
}
function renderGram(){
  if(window.AUDS&&AUDS.length>1500)window.AUDS=[];
  gramPaint();
  partyIfDone('#vGram');
  if(gq)return;
  try{
  const el=document.getElementById('vGram'); const head=el.querySelector('.card');
  const n=gramTrackedCount(gramLesson), tot=gramClozableCount(gramLesson);
  const hrow=head&&head.querySelector('.row'); if(hrow){hrow.insertAdjacentHTML('beforeend',`<div class="row" style="gap:6px;flex-basis:100%;margin-top:8px"><span class="small muted">${n}/${tot} patterns in the review queue as cloze cards</span>${n<tot?`<button class="btn sm ghost" onclick="trackGram(${gramLesson});badge();renderGram()">+ Add ${tot-n} cloze card${tot-n>1?'s':''}</button>`:''}${n?`<button class="btn sm ghost" onclick="if(confirm('Remove this lesson\\'s grammar cards and their progress?')){untrackGram(${gramLesson});badge();renderGram();}">Remove</button>`:''}${notionLink(gramLesson,'Notion page ↗')}</div>`);}
  el.querySelectorAll('.gpt').forEach((g,i)=>{const p=(GRAMMAR[gramLesson]||[])[i];if(!p)return;const lv=gramGrasp(p.id);const c=S.cards[gramCid(p.id)];const dots=g.querySelector('.gdots');if(dots)dots.insertAdjacentHTML('beforebegin',`<span class="grasp s${lv}" title="${GRASP_T[lv]}${c?(c.susp?' · parked':''):' · no cloze card'}">${c?(c.susp?'parked':GRASP_T[lv]):'no card'}</span>`);
    if(c&&c.susp){const b=g.querySelector('.gh .btn');if(b)b.insertAdjacentHTML('beforebegin',`<button class="btn sm ghost" style="flex:none" onclick="event.stopPropagation();delete S.cards['${gramCid(p.id)}'].susp;save();badge();renderGram()">Un-park</button>`);}});
  el.insertAdjacentHTML('afterbegin',graspMap());
  }catch(e){}
}

/* ---- grammar families, in the order the Grammar Index tells the story ---- */
const GFAM=[
  {k:'q',   t:'Asking · 嗎 · 呢 · 是不是 · QW+都', zh:'問句', m:p=>/^(嗎|呢|是不是|都|什麼都|誰都|哪裡都)$/.test(p.tgt[0]||'')||/嗎|呢|是不是|QW/.test(p.t)},
  {k:'neg', t:'Negation · 不 · 沒', zh:'不／沒', m:p=>p.tgt.some(t=>/^(不|沒|沒有|不是)$/.test(t))||/不 vs 沒|不／沒|不\/沒/.test(p.t)},
  {k:'modal',t:'Modals · 能 · 會 · 可以', zh:'能／會／可以', m:p=>p.tgt.some(t=>/^(能|會|可以|應該|得)$/.test(t))},
  {k:'ba',  t:'把 · fronting the object', zh:'把', m:p=>p.tgt.includes('把')||/把/.test(p.t)},
  {k:'zai', t:'在 · 到 · 著 · 正在', zh:'在／到', m:p=>p.tgt.some(t=>/^(在|到|著|正在|V在|V到)$/.test(t))||/在|到/.test(p.t)&&!/現在/.test(p.t)},
  {k:'le',  t:'了 · six jobs, one character', zh:'了', m:p=>p.tgt.some(t=>/了/.test(t))||/了/.test(p.t)},
  {k:'time',t:'Time order · 以後 · 以前 · 的時候 · 先…再', zh:'時間', m:p=>p.tgt.some(t=>/^(以後|以前|的時候|先|再|然後|一邊|有時候)$/.test(t))||/duration|Time-When|時候|以後|以前/.test(p.t)},
  {k:'jiucai',t:'就 · 才 · 一…就', zh:'就／才', m:p=>p.tgt.some(t=>/^(就|才|一…就)$/.test(t))||/就|才/.test(p.t)},
  {k:'cmp', t:'Comparison · 比 · 比較 · 跟…一樣 · 更 · 差不多', zh:'比較', m:p=>p.tgt.some(t=>/^(比|比較|一樣|更|沒有|差不多|最)$/.test(t))||/比|一樣|compar/i.test(p.t)},
  {k:'dian',t:'一點 · 有一點 · 一點也不 · 多／少 V', zh:'一點', m:p=>p.tgt.some(t=>/一點|多|少/.test(t))&&!/多久|多少/.test(p.t)},
  {k:'redup',t:'Reduplication · VV · VV看 · AABB · ABAB', zh:'重疊', m:p=>/VV|AABB|ABAB|reduplic|V（一）V|一下/i.test(p.t)},
  {k:'laiqu',t:'來／去 · directions · 過', zh:'來／去', m:p=>p.tgt.some(t=>/^(來|去|過|出來|進去|過來|過去|往)$/.test(t))||/direction|來／去|來\/去|方向/i.test(p.t)},
  {k:'cause',t:'Cause & purpose · 因為 · 為了 · 要不然 · 如果 · 雖然', zh:'因果', m:p=>p.tgt.some(t=>/^(因為|所以|為了|要不然|如果|要是|雖然|可是|但是|而且)$/.test(t))},
  {k:'de',  t:'的 · 得 · 地 · clause + 的 + N', zh:'的／得／地', m:p=>p.tgt.some(t=>/^(的|得|地)$/.test(t))||/的|得/.test(p.t)&&!/覺得/.test(p.t)},
  {k:'m',   t:'Measure words & numbers', zh:'量詞', m:p=>/measure|量|個|張|塊|杯|支|種|輛|件|位/i.test(p.t)}
];
function famOf(p){for(const f of GFAM){try{if(f.m(p))return f.k;}catch(e){}}return 'other';}

const GP={}; for(const l in GRAMMAR){GRAMMAR[l].forEach(p=>{GP[p.id]={p,l:+l};});}
function isGram(cid){return typeof cid==='string'&&cid.slice(0,2)==='g:';}
function gramClozable(p){return !!(p.tgt&&p.tgt.length&&p.s&&p.s.some(x=>tgtIn(p,x.zh)));}
function gramCid(id){return 'g:'+id;}
function gramTrackedCount(ln){return (GRAMMAR[ln]||[]).filter(p=>S.cards[gramCid(p.id)]).length;}
function gramClozableCount(ln){return (GRAMMAR[ln]||[]).filter(gramClozable).length;}
function trackGram(ln){let n=0;(GRAMMAR[ln]||[]).forEach(p=>{if(gramClozable(p)&&!S.cards[gramCid(p.id)]){S.cards[gramCid(p.id)]={};n++;}});save();return n;}
function untrackGram(ln){(GRAMMAR[ln]||[]).forEach(p=>{delete S.cards[gramCid(p.id)];});save();}
function gramStage(id){const c=S.cards[gramCid(id)];if(!c||c.st===undefined)return 0;if(c.st!=='rev'||c.S<7)return 1;if(c.S<21)return 2;if(c.S<MASTER_S)return 3;return 4;}
/* grasp: 0 not started · 1 shaky · 2 getting there · 3 solid · 4 mastered — the cloze card's memory, checked against quiz + Which-one history */
const GRASP_T=['not started','shaky','getting there','solid','mastered'];
function gramGrasp(id){
  const st=gramStage(id), q=gStat(id);
  let lv=st;
  if(q.n>=3){const r=q.ok/q.n; if(r>=0.8&&q.n>=6)lv=Math.max(lv,3); else if(r>=0.6)lv=Math.max(lv,2); else if(r<0.5)lv=Math.min(lv||1,1); else lv=Math.max(lv,1);}
  const p=GP[id]&&GP[id].p; if(p){const f=famOf(p), cf=(S.cf||{})[f]; if(cf&&cf.n>=4&&cf.ok/cf.n<0.6)lv=Math.min(lv,1);}
  return lv;
}

function gramSentence(p,c){const sents=p.s.filter(x=>tgtIn(p,x.zh));const i=((c&&c.reps)||0)%Math.max(1,sents.length);return sents[i]||p.s[0];}
function gramBlank(p,s){const t=tgtIn(p,s.zh)||p.tgt[0];return {t,html:esc(s.zh).split(esc(t)).join('<span class="blank">'+'&nbsp;'.repeat(Math.max(2,t.length*2))+'</span>')};}
function renderGramCard(){
  const el=document.getElementById('vRev'), id=cur.slice(2), gp=GP[id]; if(!gp)return nextCard();
  const p=gp.p, c=S.cards[cur]||{}, isNew=c.st===undefined, s=gramSentence(p,c), b=gramBlank(p,s);
  const remaining=rq.learn.length+rq.rev.length+rq.fresh.length, tot=SES.n+remaining, frac=tot?SES.n/tot:0;
  const shown=s.zh.split(b.t).map(dcZh).join('<b class="hit">'+dcZh(b.t)+'</b>');
  const front=`<div class="qtype" style="margin-bottom:6px">語法 · ${esc(lnLabel(gp.l))}</div>
    <div class="bigzh zh cloze">${b.html}</div>
    <div class="meaning">${esc(s.en)}</div>
    <div class="hint">what fills the blank? say the whole sentence aloud</div>`;
  const back=`<div class="qtype" style="margin-bottom:6px">語法 · ${esc(lnLabel(gp.l))}</div>
    <div class="bigzh zh cloze">${shown}</div>
    ${s.py?`<div class="pyline" style="font-size:19px">${tonePinyin(esc(s.py))}</div>`:''}
    <div class="meaning">${esc(s.en)}</div>
    <div class="gcard-pt"><b>${esc(p.t)}</b>${p.pat?`<div class="patline" style="margin:6px auto 0">${esc(p.pat)}</div>`:''}
      <div class="row" style="justify-content:center;gap:8px;margin-top:8px">${spkBtnText(s.zh)}${notionLink(gp.l,'Notion ↗')}</div></div>`;
  el.innerHTML=`<div class="sbar"><i style="width:${Math.round(frac*100)}%"></i></div>
    <div class="srow"><span class="small muted">${SES.n} done · ${remaining} left</span>${SES.run>=3?`<span class="runchip">${SES.run} in a row</span>`:''}</div>
    <div class="rev-top"><span class="mtag gram">Grammar · 造句</span>
      <span>${undoStack.length?`<span class="link" onclick="doUndo()">← back</span> · `:''}${isNew?'<b style="color:var(--acc)">new</b> · ':''}${remaining} left · <span class="link" onclick="gramSuspend()" title="take this pattern out of the queue">skip pattern</span></span></div>
    <div class="stage gstage">${revealed?back:front}</div>
    ${revealed?`<div class="grades">
      <button onclick="grade(1)"><span class="g1">Again</span><span class="iv">${previewIv(isNew?null:c,cur,1)}</span></button>
      <button onclick="grade(2)"><span class="g2">Hard</span><span class="iv">${previewIv(isNew?null:c,cur,2)}</span></button>
      <button onclick="grade(3)"><span class="g3">Good</span><span class="iv">${previewIv(isNew?null:c,cur,3)}</span></button>
      <button onclick="grade(4)"><span class="g4">Easy</span><span class="iv">${previewIv(isNew?null:c,cur,4)}</span></button></div>
    <div class="small muted kbh" style="text-align:center;margin-top:10px"><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></div>`
    :`<div style="margin-top:16px"><button class="btn big" onclick="reveal()">Show answer</button></div><div class="small muted kbh" style="text-align:center;margin-top:10px"><kbd>space</kbd></div>`}`;
  if(animOn()){const st=el.querySelector('.stage');st.classList.add(revealed?'flip-in':'slide-in');if(lastGrade&&!revealed){st.classList.add(lastGrade===1?'from-again':lastGrade===2?'from-hard':'from-good');lastGrade=0;}st.addEventListener('animationend',()=>st.classList.remove('slide-in','flip-in'),{once:true});}
  if(revealed&&S.settings.autoplayAudio)setTimeout(()=>playAudio(s.zh),150);
}
function gramSuspend(){if(!cur||!isGram(cur))return;const c=S.cards[cur];if(c)c.susp=1;save();['learn','rev','fresh'].forEach(k=>{rq[k]=rq[k].filter(x=>x!==cur);});toast('Pattern parked — un-park it in the Grammar tab');nextCard();}
/* Settings: grammar cards */
function gramSetPanel(){const s=S.settings,n=Object.keys(S.cards).filter(isGram).length;
  return `<div class="card"><div class="lab">Grammar in the queue</div>
    <div class="set-row"><div><b>Cloze cards</b><div class="d">Every tracked grammar point becomes a fill-the-blank sentence card, scheduled by FSRS like a word. ${n} in the deck now — add lessons from the Grammar tab.</div></div>
      <button class="tgl ${s.gramCards!==false?'on':''}" onclick="S.settings.gramCards=S.settings.gramCards===false?true:false;save();renderSet();badge()"><i></i></button></div>
    <div class="set-row"><div><b>New grammar cards per day</b><div class="d">how many fresh patterns may start each day, on top of new words</div></div>
      <input type="number" min="0" max="30" value="${s.newGramPerDay??4}" onchange="S.settings.newGramPerDay=Math.max(0,parseInt(this.value)||0);save();badge()"></div></div>`;}

/* ---- 3. Grammar grasp map (Grammar tab) ---- */
function graspMap(){
  const cl=S.settings.curLesson||22;
  const rows=GFAM.map(f=>{const pts=[];for(let l=1;l<=cl;l++)(GRAMMAR[l]||[]).forEach(p=>{if(famOf(p)===f.k)pts.push({p,l});});return {f,pts};}).filter(r=>r.pts.length);
  const cfk=PAIRS.map(p=>p.k);
  return `<div class="card"><div class="row spread" style="margin-bottom:8px"><div><div class="lab" style="margin:0">Grasp · by family</div><div class="small muted">one dot per pattern · explanations live in Notion</div></div><a class="nlink" href="${NOTION.index}" target="_blank" rel="noopener">Grammar Index ↗</a></div>
  <div class="famlist">${rows.map(r=>{
    const lv=r.pts.map(x=>gramGrasp(x.p.id)); const solid=lv.filter(v=>v>=3).length, shaky=lv.filter(v=>v===1).length, none=lv.filter(v=>v===0).length;
    const hasCf=cfk.includes(r.f.k);
    return `<div class="fam"><div class="fam-h"><b>${esc(r.f.t)}</b><span class="small muted">${solid}/${r.pts.length} solid${shaky?` · <span style="color:var(--red)">${shaky} shaky</span>`:''}${none?` · ${none} untouched`:''}</span></div>
      <div class="fam-dots">${r.pts.map((x,i)=>`<i class="s${lv[i]}" title="${esc(x.p.t)} · ${esc(lnLabel(x.l))} · ${GRASP_T[lv[i]]}" onclick="gramLesson=${x.l};gramOpen={};renderGram();setTimeout(()=>{const g=document.querySelectorAll('#vGram .gpt')[${(GRAMMAR[x.l]||[]).indexOf(x.p)}];if(g)g.scrollIntoView({behavior:'smooth',block:'center'});},30)"></i>`).join('')}</div>
      <div class="fam-acts"><button class="btn sm ghost" onclick="startGramQuiz(famPoints('${r.f.k}'))">Drill</button>${hasCf?`<button class="btn sm ghost" onclick="wpGo('${r.f.k}')">Which one?</button>`:''}<button class="btn sm ghost" onclick="trackGramIds(famPoints('${r.f.k}').map(p=>p.id))" title="add these patterns as cloze cards">+ cards</button></div></div>`;}).join('')}</div></div>`;
}
function famPoints(k){const cl=S.settings.curLesson||22,out=[];for(let l=1;l<=cl;l++)(GRAMMAR[l]||[]).forEach(p=>{if(famOf(p)===k)out.push(p);});return out;}
function trackGramIds(ids){let n=0;ids.forEach(id=>{const gp=GP[id];if(gp&&gramClozable(gp.p)&&!S.cards[gramCid(id)]){S.cards[gramCid(id)]={};n++;}});save();badge();toast(n?n+' cloze card'+(n>1?'s':'')+' added':'already in the deck');renderGram();}

/* ---- 句型 "which pattern?": pairs of patterns that both look as if they fit (data/pairs.js, installed by
   tools/check_pairs.py from tools/content/pairs.txt). A sentence with a blank and the pair as the choices; the answer
   side gives the test that decides it and the same frame with each choice used correctly. A tally is kept per pair
   in S.cf, and the grammar point the right answer belongs to gets its own (gMark), so the deck gains no field. ---- */
const WP={mode:'mine',book:1,lo:1,hi:1,qs:null,i:0,ok:0,state:'ask',chosen:null,ks:null};
const WP_NONE='∅';      /* the choice "nothing goes here" */
function wpStat(k){return (S.cf||{})[k]||{n:0,ok:0};}
function wpLevel(k){const s=wpStat(k);if(!s.n)return 0;const r=s.ok/s.n;return s.n<4?1:r>=0.9?4:r>=0.75?3:r>=0.6?2:1;}
function wpMark(p,q,ok){
  S.cf=S.cf||{};const s=S.cf[p.k]=S.cf[p.k]||{n:0,ok:0};s.n++;if(ok)s.ok++;s.last=Date.now();
  const id=p.pts&&(p.pts[q.a]||p.pts['*']);
  if(id&&GP[id])gMark(id,ok);else save();
}
/* the lessons in scope: up to the learner's own, one book, or a range chosen book by book */
function wpRange(){
  if(WP.mode==='book')return bookRange(WP.book);
  if(WP.mode==='range')return [WP.lo,Math.max(WP.lo,WP.hi)];
  return [1,S.settings.curLesson||22];
}
/* a pair is in scope when the lesson that makes it a real choice is; a sentence, when all its characters have been met */
function wpPairs(){const [lo,hi]=wpRange();return PAIRS.filter(p=>p.to>=lo&&p.to<=hi).map(p=>({p,qs:p.q.filter(q=>q.l<=hi)})).filter(x=>x.qs.length);}
function wpSet(mode,a,b){
  WP.mode=mode;
  if(mode==='book')WP.book=a;
  if(mode==='range'){if(a)WP.lo=a;if(b)WP.hi=b;if(WP.hi<WP.lo)WP.hi=WP.lo;}
  wpRender();
}
function wpStart(){
  try{tcRelease();recKill();lpStop();}catch(e){}
  drillMode='wp';dq=null;WP.qs=null;go('drill');
}
/* a round: one pair (up to eight of its sentences) or a mixed twelve, the weaker pairs more often */
function wpBegin(ks){
  let pool=wpPairs();
  if(ks){const cl=S.settings.curLesson||22;pool=PAIRS.filter(p=>ks.includes(p.k)).map(p=>({p,qs:p.q.filter(q=>q.l<=Math.max(cl,p.to,wpRange()[1]))}));}
  const items=[];
  pool.forEach(x=>{const lv=wpLevel(x.p.k),wt=lv===0?3:lv===1?4:lv===2?2:1;x.qs.forEach(q=>items.push({p:x.p,q,wt}));});
  if(!items.length){toast('No pairs in these lessons yet');return;}
  const n=ks&&ks.length===1?Math.min(8,items.length):Math.min(12,items.length), out=[];let bag=items.slice();
  while(out.length<n&&bag.length){const tot=bag.reduce((a,x)=>a+x.wt,0);let r=Math.random()*tot,i=0;for(;i<bag.length-1;i++){r-=bag[i].wt;if(r<=0)break;}out.push(bag[i]);bag.splice(i,1);}
  out.forEach(it=>{it.opts=it.q.pick?shuf(it.q.opts):(it.q.opts||it.p.opts);});
  drillMode='wp';dq=null;WP.ks=ks||null;WP.qs=out;WP.i=0;WP.ok=0;WP.state='ask';WP.chosen=null;
  if(view!=='drill')go('drill');else wpRender();
  window.scrollTo(0,0);
}
function wpGo(k){wpBegin([k]);}
function wpPick(i){
  const it=WP.qs&&WP.qs[WP.i];if(!it||WP.state!=='ask'||!it.opts[i])return;
  const ok=it.opts[i]===it.q.a;
  /* a miss comes back once at the end of the round */
  if(!ok&&!it.again)WP.qs.push({p:it.p,q:it.q,opts:it.q.pick?shuf(it.q.opts):it.opts,again:true});
  WP.chosen=i;WP.state='done';if(ok)WP.ok++;
  wpMark(it.p,it.q,ok);haptic(ok?'good':'again');wpRender();
}
function wpNext(){if(!WP.qs||WP.state!=='done')return;WP.i++;WP.state='ask';WP.chosen=null;wpRender();window.scrollTo(0,0);}
function wpHome(){WP.qs=null;wpRender();window.scrollTo(0,0);}
function wpStop(){WP.qs=null;drillMode=null;renderDrill();}
function wpOpt(o){return o===WP_NONE?'∅ nothing':esc(o);}
function wpRender(){
  const el=document.getElementById('vDrill');if(!el||drillMode!=='wp')return;
  const top=(l,r)=>`<div class="rev-top"><span class="qtype">句型 · Which pattern?${l?' · '+l:''}</span><span class="row" style="gap:10px"><span class="qprog">${r}</span></span></div>`;
  /* ---- the pairs ---- */
  if(!WP.qs){
    const [lo,hi]=wpRange(), list=wpPairs(), later=PAIRS.filter(p=>p.to>hi).length;
    el.innerHTML=top('',list.length+' pair'+(list.length===1?'':'s'))+`
    <div class="segbar"><span class="cap">Lessons</span>
      <button class="${WP.mode==='mine'?'on':''}" onclick="wpSet('mine')">Up to ${esc(lnLabel(S.settings.curLesson||22))}</button>
      ${BOOKS.map(b=>`<button class="${WP.mode==='book'&&WP.book===b.n?'on':''}" onclick="wpSet('book',${b.n})">Book ${b.n}</button>`).join('')}
      <button class="${WP.mode==='range'?'on':''}" onclick="wpSet('range',${lo},${hi})">From … to …</button>
      ${WP.mode==='range'?lessonPick(WP.lo,"wpSet('range',v,0)")+'<span class="small muted">to</span>'+lessonPick(WP.hi,"wpSet('range',0,v)"):''}
    </div>
    <div class="card"><div class="row spread" style="margin-bottom:6px"><div><div class="lab" style="margin:0">Pick a pair</div><div class="small muted">Both look as if they fit. One test decides. The weaker pairs come up more often.</div></div>${list.length?`<button class="btn sm" onclick="wpBegin(null)">Mixed set · ${Math.min(12,list.reduce((a,x)=>a+x.qs.length,0))}</button>`:''}</div>
      ${list.length?`<div class="cfgrid">${list.map(x=>{const lv=wpLevel(x.p.k),s=wpStat(x.p.k);return `<button class="cftile s${lv}" onclick="wpGo('${x.p.k}')"><b class="zh">${esc(x.p.zh)}</b><span>Book ${bookOf(x.p.to)} · Lesson ${lnInBook(x.p.to)}</span><i>${s.n?Math.round(s.ok/s.n*100)+'% · '+s.n:'new'}</i></button>`;}).join('')}</div>`
        :`<div class="small muted" style="margin-top:10px">No pair becomes a real choice in these lessons. Try a wider range.</div>`}
      ${later&&WP.mode==='mine'?`<div class="small muted" style="margin-top:12px">${later} more pair${later===1?'':'s'} come with later lessons.</div>`:''}
    </div>
    <div class="qfoot"><button class="btn ghost sm" onclick="wpStop()">← All drills</button></div>`;
    return;
  }
  /* ---- the round is over ---- */
  if(WP.i>=WP.qs.length){
    const n=WP.qs.length, pct=Math.round(WP.ok/n*100), by={};
    WP.qs.forEach(it=>{const b=by[it.p.k]=by[it.p.k]||{p:it.p,n:0};b.n++;});
    const missed=[...new Set(WP.qs.filter(it=>it.again).map(it=>it.p))];
    el.innerHTML=`<div class="card done"><div class="zhd zh">${pct>=80?'太好了！':pct>=50?'不錯！':'加油！'}</div>
      <div style="font-weight:600;font-size:16px">${WP.ok} / ${n} · ${pct}%</div>
      ${missed.length?`<div class="wp-side" style="margin-top:12px">${missed.map(p=>`<div class="wp-row"><b class="zh">${esc(p.zh)}</b><span class="e" style="font-size:13.5px;color:var(--ink)">${esc(p.test)}</span></div>`).join('')}</div>`:''}
      <div class="qfoot" style="margin-top:14px"><button class="btn" onclick="wpBegin(WP.ks)">Again</button><button class="btn ghost" onclick="wpHome()">Pairs</button></div></div>`;
    partyIfDone('#vDrill');
    return;
  }
  /* ---- one sentence ---- */
  const it=WP.qs[WP.i], p=it.p, q=it.q, done=WP.state==='done', pick=!!q.pick, right=done&&it.opts[WP.chosen]===q.a;
  window.AUDS=window.AUDS||[];
  const aud=t=>{const i=AUDS.push(t)-1;return '<button class="spk" title="listen" onclick="event.stopPropagation();playAudio(AUDS['+i+'])">'+SPK_SVG+'</button>';};
  const ans=q.a===WP_NONE?'':q.a;
  /* every choice's line, or with more than three choices the right one, the one picked and one more, in the pair's order */
  let sides=p.side;
  if(done&&sides.length>3){const keep=[...new Set([q.a,it.opts[WP.chosen]])];sides.forEach(x=>{if(keep.length<3&&!keep.includes(x[0]))keep.push(x[0]);});sides=sides.filter(x=>keep.includes(x[0])).slice(0,3);}
  let zh='';
  if(!pick){const [a,b]=q.zh.split('⬚');zh=done?dcZh(a)+'<span class="blank">'+(ans?dcZh(ans):'&nbsp;')+'</span>'+dcZh(b||''):esc(a)+'<span class="blank">&nbsp;&nbsp;&nbsp;</span>'+esc(b||'');}
  el.innerHTML=top(esc(p.zh),(WP.i+1)+' / '+WP.qs.length+(it.again?' · again':''))+`
  <div class="qbox wp">
    ${pick?`<div class="qen" style="font-size:15.5px;color:var(--ink)">Which one says: “${esc(q.en)}”</div>`:`<div class="qzh zh">${zh}${done?' '+aud(q.zh.replace('⬚',ans)):''}</div><div class="qen">${esc(q.en)}</div>`}
    <div class="opts ${pick?'sm':''}" ${pick?'style="grid-template-columns:1fr"':''}>${it.opts.map((o,i)=>`<button class="zh ${done?(o===q.a?'right':(WP.chosen===i?'wrong':'')):''}" onclick="wpPick(${i})">${done&&pick?dcZh(o):wpOpt(o)}</button>`).join('')}</div>
    ${done?`<div class="why ${right?'ok':'bad'}"><b>${right?'✓':'✗'}</b> ${esc(q.why)}</div>
    <div class="wp-test"><div class="lab">The test</div>${esc(p.test)}</div>
    <div class="wp-side">${sides.map(s=>`<div class="wp-row${s[0]===q.a?' on':''}"><b class="zh">${wpOpt(s[0])}</b><span class="z zh">${dcZh(s[1])}</span><span class="e">${esc(s[2])}</span></div>`).join('')}</div>`:''}
  </div>
  <div class="qfoot" style="margin-top:12px">${done?`<button class="btn" onclick="wpNext()">Next →</button>`:''}<button class="btn ghost sm" onclick="wpHome()">Stop</button></div>`;
}
if(typeof zikaWhole==='function')zikaWhole();   /* the last line: this file arrived whole (index.html, js/boot.js) */
