/* The tone coach's ears: pitch tracking, cleaning the track, finding syllables, and naming the tone of each.
   Touches neither the page nor the deck, so tools/check.mjs and tools/tone_lab.mjs load this file as it is; TC_NET is
   fitted by `node tools/tone_lab.mjs fit --write`. How well it hears and why: docs/voice.md. */

const TC_SR=16000, TC_HOP=0.01, TC_FRAME=0.025, TC_FMIN=70, TC_FMAX=420;
/* mono Float32 at any rate → 16 kHz (box-filter decimation is plenty for pitch) */
function tcResample(x,sr){
  if(sr===TC_SR)return x;
  const ratio=sr/TC_SR, n=Math.floor(x.length/ratio), y=new Float32Array(n);
  for(let i=0;i<n;i++){const a=Math.floor(i*ratio), b=Math.min(x.length,Math.floor((i+1)*ratio)); let s=0; for(let j=a;j<b;j++)s+=x[j]; y[i]=s/Math.max(1,b-a);}
  return y;
}
/* YIN pitch tracker → Hz per 10 ms frame, 0 where unvoiced; the loudness of each frame rides along as f0.rms */
function tcPitch(x){
  const N=Math.round(TC_FRAME*TC_SR), H=Math.round(TC_HOP*TC_SR), tMin=Math.floor(TC_SR/TC_FMAX), tMax=Math.ceil(TC_SR/TC_FMIN);
  const frames=Math.max(0,Math.floor((x.length-N-tMax)/H)), f0=new Float32Array(frames), rms=new Float32Array(frames), d=new Float32Array(tMax+1);
  for(let f=0;f<frames;f++){ const o=f*H; let e=0; for(let j=0;j<N;j++)e+=x[o+j]*x[o+j]; rms[f]=Math.sqrt(e/N); }
  /* the gate follows the loud part of the take, not its single loudest click */
  const loud=Array.from(rms).sort((a,b)=>a-b)[Math.floor(frames*0.9)]||0, gate=Math.max(0.002,loud*0.1);
  f0.rms=rms;
  for(let f=0;f<frames;f++){
    if(rms[f]<gate)continue;
    const o=f*H; let run=0, best=0;
    for(let t=1;t<=tMax;t++){
      let s=0; for(let j=0;j<N;j++){const v=x[o+j]-x[o+j+t]; s+=v*v;}
      run+=s; d[t]=run?s*t/run:1;
    }
    for(let t=tMin;t<tMax;t++){ if(d[t]<0.14){ while(t+1<tMax&&d[t+1]<d[t])t++; best=t; break; } }
    if(!best){ let m=1; for(let t=tMin;t<tMax;t++)if(d[t]<m){m=d[t];best=t;} if(m>0.45)continue; }
    const a=d[best-1], b=d[best], c=d[best+1], den=a-2*b+c, shift=den?0.5*(a-c)/den:0;
    f0[f]=TC_SR/(best+(Math.abs(shift)<1?shift:0));
  }
  return f0;
}
/* clean a raw track → semitones re 100 Hz (NaN = unvoiced): octave slips put back, blips out, short gaps bridged.
   A slip is found by continuity, never by distance from the speaker's middle: a voice really does travel an octave
   inside one falling tone, and a creaky low tone flickers between a note and the octave under it. Each voiced frame
   may stay, or move an octave either way; the cheapest path is the one with no jump faster than a voice can glide. */
function tcClean(f0){
  const n=f0.length, st=new Float32Array(n).fill(NaN), ix=[];
  for(let i=0;i<n;i++)if(f0[i]>0){st[i]=Math.log2(f0[i]/100)*12;ix.push(i);}
  const m=ix.length; if(m<4)return st.fill(NaN);
  const SH=[0,12,-12], cost=[0,0.3,0.3], back=new Int8Array(m*3);
  for(let q=1;q<m;q++){
    const g=ix[q]-ix[q-1], d=st[ix[q]]-st[ix[q-1]], next=[0,0,0];
    for(let k=0;k<3;k++){ let best=Infinity, arg=0;
      for(let p=0;p<3;p++){const c=cost[p]+Math.max(0,Math.abs(d+SH[k]-SH[p])-1.5*g); if(c<best){best=c;arg=p;}}
      next[k]=best+(k?0.3:0); back[q*3+k]=arg; }
    cost[0]=next[0]; cost[1]=next[1]; cost[2]=next[2];
  }
  let k=cost[1]<cost[0]?1:0; if(cost[2]<cost[k])k=2;
  for(let q=m-1;q>=0;q--){ st[ix[q]]+=SH[k]; k=back[q*3+k]; }
  for(let i=0;i<n;i++){ if(!isNaN(st[i])&&(i===0||isNaN(st[i-1]))&&(i===n-1||isNaN(st[i+1])))st[i]=NaN; }          /* lone frames */
  for(let i=1;i<n-1;i++){ if(!isNaN(st[i])&&!isNaN(st[i-1])&&!isNaN(st[i+1])){const md=[st[i-1],st[i],st[i+1]].sort((a,b)=>a-b)[1]; if(Math.abs(st[i]-md)>3)st[i]=md;} }
  for(let i=0;i<n;i++){ if(!isNaN(st[i]))continue; let j=i; while(j<n&&isNaN(st[j]))j++; if(i>0&&j<n&&j-i<=4){for(let q=i;q<j;q++)st[q]=st[i-1]+(st[j]-st[i-1])*(q-i+1)/(j-i+1);} i=j; }
  return st;
}
/* voiced stretches → exactly `count` syllables. A short stray stretch well away from the rest (the hiss of an x or sh
   that the tracker took for a note) is dropped and close gaps are merged; a stretch that holds more than one syllable
   is cut into equal parts and each cut is moved to the nearest dip in loudness (the closure between two syllables).
   Each syllable then loses its quiet edges: the tone is carried by the loud middle, not by the dying tail. */
function tcSyllables(st,count,rms){
  let runs=[]; const n=st.length;
  for(let i=0;i<n;i++){ if(isNaN(st[i]))continue; let j=i; while(j<n&&!isNaN(st[j]))j++; if(j-i>=4)runs.push([i,j]); i=j; }
  if(!runs.length||count<1)return [];
  while(runs.length>count){
    let k=0, g=Infinity; for(let i=0;i<runs.length-1;i++){const gap=runs[i+1][0]-runs[i][1]; if(gap<g){g=gap;k=i;}}
    const la=runs[k][1]-runs[k][0], lb=runs[k+1][1]-runs[k+1][0];
    if(g>=10&&Math.min(la,lb)<=6)runs.splice(la<lb?k:k+1,1);
    else runs.splice(k,2,[runs[k][0],runs[k+1][1]]);
  }
  const parts=runs.map(()=>1); let left=count-runs.length;
  while(left>0){ let k=-1, best=0; runs.forEach((r,i)=>{const v=(r[1]-r[0])/parts[i]; if(v>best){best=v;k=i;}}); if(best<8)break; parts[k]++; left--; }
  const out=[];
  runs.forEach(([a,b],i)=>{
    const p=parts[i], L=(b-a)/p; let prev=a;
    for(let j=1;j<p;j++){
      let cut=Math.round(a+j*L);
      if(rms){ const w=Math.max(2,Math.round(L*0.3)); let m=Infinity, c=cut;
        for(let t=Math.max(prev+4,cut-w);t<=Math.min(b-4,cut+w);t++){ const e=((rms[t-1]||0)+(rms[t]||0)+(rms[t+1]||0))*(1+0.5*Math.abs(t-cut)/w); if(e<m){m=e;c=t;} }
        cut=c; }
      out.push([prev,cut]); prev=cut;
    }
    out.push([prev,b]);
  });
  if(rms)for(const r of out){
    let mx=0; for(let t=r[0];t<r[1];t++)if(rms[t]>mx)mx=rms[t];
    while(r[1]-r[0]>6&&rms[r[1]-1]<mx*0.25)r[1]--;
    while(r[1]-r[0]>6&&rms[r[0]]<mx*0.25)r[0]++;
  }
  return out;
}
/* one syllable's contour as 16 evenly spaced points (semitones), with the unsteady edges trimmed */
function tcShape(st,a,b){
  const pts=[]; for(let i=a;i<b;i++)if(!isNaN(st[i]))pts.push(st[i]);
  const cut=Math.floor(pts.length*0.12), core=pts.slice(cut,pts.length-cut); if(core.length<3)return null;
  const out=new Array(16); for(let i=0;i<16;i++){const p=i*(core.length-1)/15, k=Math.floor(p), fr=p-k; out[i]=core[k]+(core[Math.min(core.length-1,k+1)]-core[k])*fr;}
  return out;
}
/* The tone of one syllable: a small network (17 inputs → 10 → 4 tones) over its 16 contour points, z-scored against
   the speaker's own range, and its length. Fitted in v52 on ten voices — two people (audio-cmn: Chen Wang's 1,660
   syllables, Yue Tan's HSK words), the bundled 曉臻, 雲哲, and six macOS voices — about 17,000 syllables, with
   the pitch and range estimates jittered so a rough picture of the speaker still works. Scored on a voice it was
   not fitted on it agrees with the written tone about 80% of the time (74–87% by voice). tools/tone_lab.mjs
   re-runs that test against this file and refits; refit whenever the analysis above changes. */
const TC_NET={
 W1:[
  [-0.54,0.45,0.17,-0.09,0.37,0.04,-0.19,-0.85,0.09,-0.24,-0.86,-0.01,0.78,0.19,-0.04,-0.61,0.62],
  [0.37,0.12,0.05,-0.7,-0.98,-1.53,-1.49,-0.83,0.65,1.41,1.16,0.32,0.3,0.34,-0.55,0.17,-0.06],
  [-0.76,-1.05,-2.16,-2,-1.34,-0.74,0.01,1.28,2.02,2.62,2.04,0.85,-0.03,-0.04,-0.02,-0.78,0.62],
  [-1.96,-0.24,0.42,0.89,1.16,1.25,1.59,0.54,0.57,0.28,-0.79,-0.51,-0.2,-0.19,-1.18,-1.01,3.09],
  [-1.68,-1.2,-0.46,0.31,0.52,1.12,1.43,1.76,1.52,0.25,-0.6,0.55,0,-0.71,-1.08,-2.08,-0.57],
  [0.64,-0.13,-0.47,-0.59,0.02,-0.02,0.36,0.8,0.53,0.37,-0.01,-0.32,-0.42,-0.12,0.05,0.96,2.11],
  [2.22,1.28,1.31,0.81,-0.21,-0.47,-0.2,0.05,-0.13,-0.59,-1.07,-1.58,-1.29,-0.32,-0.15,0.36,0.61],
  [0.5,0.17,-0.73,-1.27,-1.27,-1.34,-1.07,-0.55,-0.18,0.46,0.83,0.8,0.72,0.77,0.69,1.55,1.83],
  [-0.29,0.44,0.55,0.32,-0.56,-1.45,-1.52,-1.69,-1.24,-1.1,-0.22,0.06,0.76,1.48,1.86,2.85,2.05],
  [1.41,0.2,-0.33,-0.81,-0.02,0.41,-0.22,-0.41,-0.65,-1.3,-1.61,-1.33,-0.83,0.12,1.66,3.86,0.18]],
 b1:[-1.13,0.4,0.24,-0.8,-0.41,1.62,0.77,1.45,-0.48,-1.74],
 W2:[
  [-0.9,-0.46,1.16,0.85,-0.03,-1.18,1.41,0.14,1.91,-1.75],
  [0.13,1.06,0.25,-0.38,-0.23,0.83,-0.36,-0.65,0.39,0.81],
  [1.54,0.03,-1.25,0.44,-0.54,0.43,-0.46,0.87,-0.98,0.66],
  [-0.08,-0.82,-0.9,-0.97,0.83,-0.17,-0.78,-0.56,-0.37,0.08]],
 b2:[-1.75,0.52,-0.03,1.19]};
function tcClassify(shape,frames,sp){
  const sd=Math.min(5,Math.max(2,sp.sd)), x=shape.map(v=>(v-sp.base)/sd); x.push(Math.min(3,frames/30));
  const h=TC_NET.W1.map((w,i)=>{let s=TC_NET.b1[i];for(let j=0;j<w.length;j++)s+=w[j]*x[j];return Math.tanh(s);});
  const z=TC_NET.W2.map((w,k)=>{let s=TC_NET.b2[k];for(let j=0;j<w.length;j++)s+=w[j]*h[j];return s;}), m=Math.max(...z), e=z.map(v=>Math.exp(v-m)), sum=e.reduce((a,b)=>a+b,0), p=e.map(v=>v/sum);
  let k=0; for(let i=1;i<4;i++)if(p[i]>p[k])k=i;
  return {tone:k+1,p,z:x.slice(0,16)};
}
/* the verdict on one syllable, given the tone it should be. 'ok' when that tone is the likeliest or nearly so:
   a native speaker passes about nine times in ten, a wrong tone slips through about one time in twelve.
   'close' is a near miss, said in words and drawn in amber, and still counted as a miss. */
function tcJudge(s,e){ const p=s.p[e-1]; return (s.tone===e||p>=0.34)?'ok':p>=0.2?'close':'no'; }
/* the tones a listener should hear: pinyin as written, plus third-tone sandhi (3+3 → 2+3) */
function tcExpected(p){
  const t=toneSeq(p).slice();
  for(let i=0;i<t.length-1;i++)if(t[i]===3&&t[i+1]===3)t[i]=2;
  return t;
}
/* one utterance → its cleaned pitch track (the slow part: do it once per take) */
function tcTrack(x,sr){
  const f0=tcPitch(tcResample(x,sr)), st=tcClean(f0), voiced=[];
  for(const v of st)if(!isNaN(v))voiced.push(v);
  return {st,rms:f0.rms,voiced,med:voiced.length?voiced.slice().sort((a,b)=>a-b)[voiced.length>>1]:NaN};
}
/* how loud the loud part of a take is (95th percentile of the frame loudness). The human recordings, turned down
   until this fell to about 0.003, lost twelve points of accuracy; at 0.009 they lost none. Below TC_QUIET the
   coach asks for a louder take instead of guessing. */
function tcLoud(tr){const a=Array.from(tr.rms).sort((x,y)=>x-y);return a.length?a[Math.floor(a.length*0.95)]:0;}
const TC_QUIET=0.005;
/* a track → per syllable its contour and the tone it sounds like. `sp` is the speaker's {base, sd}; without it
   the take is judged against its own middle. Pass `tr` to reuse a track instead of analysing the audio again. */
function tcAnalyse(x,sr,count,sp,tr){
  tr=tr||tcTrack(x,sr); if(tr.voiced.length<6)return null;
  const who=sp||{base:tr.med,sd:3.2};
  const syl=tcSyllables(tr.st,count,tr.rms).map(([a,z])=>{const shape=tcShape(tr.st,a,z); return shape?Object.assign({a,z},tcClassify(shape,z-a,who)):null;});
  return {med:tr.med,voiced:tr.voiced,syl,sp:who,tr};
}
