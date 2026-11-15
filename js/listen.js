/* The listening player: a lesson's dialogue lines or grammar sentences read aloud, with the text hidden until asked for. */

/* ---- 3. Listening player ---- */
const DIALOGUES={
 23:{t:'B2 L8 學功夫 · 對話 fragments (full dialogue pending)',lines:[
  {zh:'對不起，沒聽見你叫我。',en:'Sorry, I didn’t hear you calling me.'},
  {zh:'音樂那麼吵，你當然聽不見。',en:'The music is so loud, of course you couldn’t hear.'},
  {zh:'一到學校門口，就看見你推著腳踏車走過來。',en:'As soon as I got to the school gate I saw you pushing your bike over.'},
  {zh:'我學了三個多月了，才學會了一點。',en:'I’ve studied for over three months and only mastered a little.'},
  {zh:'腿也痛得走不了路。',en:'My legs hurt so much I can’t walk.'},
  {zh:'那你怎麼還學得下去？',en:'Then how can you keep going?'},
  {zh:'安同總是最後一個跑完，有的時候還跑不完。',en:'Antong is always the last to finish running, sometimes he can’t finish at all.'},
  {zh:'做完了功課，再去練習。',en:'Finish the homework, then go practise.'}]},
 22:{t:'B2 L7 垃圾車來了 · 口試 skeleton',lines:[
  {zh:'我剛來台北的時候，以為垃圾可以放在門口，沒想到這裡沒有垃圾桶，得自己拿下去。',en:'When I first came to Taipei I thought rubbish could be left at the door; turns out there are no bins, you carry it down yourself.'},
  {zh:'垃圾車有一定的時間和一定的地點，我家這邊是晚上七點半，在便利商店前面。',en:'The truck has a fixed time and place; mine is 7:30 pm in front of the convenience store.'},
  {zh:'為了保護環境，也為了利用資源，台灣人天天做垃圾分類。',en:'To protect the environment and use resources, Taiwanese sort their rubbish every day.'},
  {zh:'七點二十五我就拿著袋子走下去，垃圾車開過來的時候，我把一般垃圾丟進去，再把瓶子跟紙拿過去給後面的回收車。',en:'At 7:25 I carry the bag down; when the truck comes over I throw in the general waste, then take bottles and paper over to the recycling truck behind.'},
  {zh:'分類得做好，要不然他們不收；音樂一停車就開走了，要不然你就得等明天。',en:'Sorting has to be right or they won’t take it; when the music stops the truck leaves, or else you wait till tomorrow.'}]}
};
let LP={ln:23,src:'dlg',i:0,playing:false,hide:true,rate:0.85,gap:1.2,log:null,list:[]};
function lpList(){
  const d=DIALOGUES[LP.ln];
  if(LP.src==='dlg'&&d)return d.lines.map(l=>({zh:l.zh,en:l.en||'',py:''}));
  const out=[];(GRAMMAR[LP.ln]||[]).forEach(p=>p.s.forEach(s=>out.push({zh:s.zh,en:s.en,py:s.py||'',p:p.t})));
  return out;
}
function lpSpeak(text,cb){
  if(!window.speechSynthesis){if(cb)cb();return;}
  try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);const v=pickVoice();if(v){u.voice=v;u.lang=v.lang;}else u.lang='zh-TW';u.rate=LP.rate;u.onend=()=>{if(cb)cb();};u.onerror=()=>{if(cb)cb();};speechSynthesis.speak(u);}catch(e){if(cb)cb();}
}
function lpPlay(i){
  if(i!==undefined)LP.i=i; LP.playing=true; lpRender();
  const it=LP.list[LP.i]; if(!it){LP.playing=false;lpRender();return;}
  const tok=(LP.tok=(LP.tok||0)+1);
  lpSpeak(it.zh,()=>{ if(tok!==LP.tok||!LP.playing)return; setTimeout(()=>{ if(tok!==LP.tok||!LP.playing)return; if(LP.i<LP.list.length-1){LP.i++;lpPlay();} else {LP.playing=false;lpRender();} },LP.gap*1000); });
}
function lpStop(){LP.playing=false;LP.tok=(LP.tok||0)+1;try{speechSynthesis.cancel();}catch(e){}lpRender();}
function lpRepeat(){LP.playing=false;LP.tok=(LP.tok||0)+1;lpSpeak(LP.list[LP.i].zh);lpRender();}
function lpStep(d){lpStop();LP.i=Math.max(0,Math.min(LP.list.length-1,LP.i+d));LP.shown=false;lpRender();}
function lpMark(ok){S.listen=S.listen||{};const k=String(LP.ln);const L=S.listen[k]=S.listen[k]||{n:0,ok:0};L.n++;if(ok)L.ok++;save();haptic(ok?'good':'again');if(LP.i<LP.list.length-1){LP.i++;LP.shown=false;lpRender();lpSpeak(LP.list[LP.i].zh);}else{toast('Set done · '+L.ok+'/'+L.n+' understood this lesson');lpRender();}}
function startListen(){drillMode='listen';dq=null;LP.list=lpList();LP.i=0;LP.shown=false;LP.playing=false;go('drill');}
function lpRender(){
  const el=document.getElementById('vDrill'); if(drillMode!=='listen')return;
  const it=LP.list[LP.i]||{zh:'',en:''}, d=DIALOGUES[LP.ln], show=!LP.hide||LP.shown;
  const stat=(S.listen||{})[String(LP.ln)];
  el.innerHTML=`<div class="segbar"><span class="cap">Listen</span>
      ${lessonPick(LP.ln,"LP.ln=v;LP.src=DIALOGUES[LP.ln]?'dlg':'sent';startListen()")}
      <button class="${LP.src==='dlg'?'on':''}" ${d?'':'disabled'} onclick="LP.src='dlg';startListen()">對話</button>
      <button class="${LP.src==='sent'?'on':''}" onclick="LP.src='sent';startListen()">Sentences</button>
      <button class="${LP.hide?'on':''}" onclick="LP.hide=!LP.hide;lpRender()">Hide text</button>
      <span class="cap" style="margin-left:6px">Speed</span><input type="range" min="50" max="110" value="${Math.round(LP.rate*100)}" style="width:90px" oninput="LP.rate=this.value/100">
    </div>
    <div class="card" style="text-align:center">
      <div class="small muted" style="margin-bottom:8px">${d&&LP.src==='dlg'?esc(d.t):esc(lnLabel(LP.ln))+' · sentences from the grammar points'} · ${LP.i+1} / ${LP.list.length}${stat?` · understood ${stat.ok}/${stat.n}`:''}</div>
      <div class="sbar" style="margin:0 auto 14px;max-width:420px"><i style="width:${Math.round((LP.i+1)/Math.max(1,LP.list.length)*100)}%"></i></div>
      <div class="lpline zh ${show?'':'veil'}" onclick="LP.shown=true;lpRender()">${show?esc(it.zh):'tap to reveal · or answer first'}</div>
      ${show?`${it.py?`<div class="py2">${tonePinyin(esc(it.py))}</div>`:''}<div class="qen" style="margin-top:6px">${esc(it.en)}</div>${it.p?`<div class="small muted">pattern: ${esc(it.p)}</div>`:''}`:''}
      <div class="row" style="justify-content:center;gap:8px;margin-top:16px;flex-wrap:wrap">
        <button class="btn ghost sm" onclick="lpStep(-1)">‹ prev</button>
        <button class="btn sm" onclick="${LP.playing?'lpStop()':'lpPlay()'}">${LP.playing?'Pause':'Play all ▶'}</button>
        <button class="btn ghost sm" onclick="lpRepeat()">Repeat line ↻</button>
        <button class="btn ghost sm" onclick="lpStep(1)">next ›</button>
      </div>
      ${LP.hide?`<div class="row" style="justify-content:center;gap:8px;margin-top:14px"><span class="small muted">Did you get it?</span><button class="btn ghost sm" onclick="lpMark(false)">Missed</button><button class="btn sm" onclick="lpMark(true)">Understood ✓</button></div>`:''}
      <div class="small muted" style="margin-top:14px">Shadow it: play a line, say it back with the tones before the next one starts. Slow the slider for new material, then work back up to 1.0. Full 對話 texts get added as you send them.</div>
    </div>`;
}
if(typeof zikaWhole==='function')zikaWhole();   /* the last line: this file arrived whole (index.html, js/boot.js) */
