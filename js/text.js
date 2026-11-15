/* Pinyin as text: tone marks, splitting into syllables, tone colouring, the tone sequence of a word.
   Touches neither the page nor the deck, so tools/check.mjs and tools/tone_lab.mjs load this file as it is. */

/* ============ TONE COLORING ============ */
/* Pinyin in the data is written word by word (huānyíng), so tones are read per syllable, not per token. */
const toneMarks={'ā':1,'á':2,'ǎ':3,'à':4,'ē':1,'é':2,'ě':3,'è':4,'ī':1,'í':2,'ǐ':3,'ì':4,'ō':1,'ó':2,'ǒ':3,'ò':4,'ū':1,'ú':2,'ǔ':3,'ù':4,'ǖ':1,'ǘ':2,'ǚ':3,'ǜ':4};
const PY_BASE={'ā':'a1','á':'a2','ǎ':'a3','à':'a4','ē':'e1','é':'e2','ě':'e3','è':'e4','ī':'i1','í':'i2','ǐ':'i3','ì':'i4','ō':'o1','ó':'o2','ǒ':'o3','ò':'o4','ū':'u1','ú':'u2','ǔ':'u3','ù':'u4','ǖ':'ü1','ǘ':'ü2','ǚ':'ü3','ǜ':'ü4','ń':'n2','ň':'n3','ǹ':'n4','ḿ':'m2'};
const PY_SYL=new Set(('a ai an ang ao e ei en eng er o ou '+
 'ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu '+
 'pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu '+
 'ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu '+
 'fa fan fang fei fen feng fo fou fu '+
 'da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo '+
 'ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo '+
 'na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nun nuo nü nüe '+
 'la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lü lüe '+
 'ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo '+
 'ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo '+
 'ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo '+
 'ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun '+
 'qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun '+
 'xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun '+
 'zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo '+
 'cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo '+
 'sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo '+
 'ra ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo '+
 'za zai zan zang zao ze zei zen zeng zi zong zou zu zuan zui zun zuo '+
 'ca cai can cang cao ce cen ceng ci cong cou cu cuan cui cun cuo '+
 'sa sai san sang sao se sen seng si song sou su suan sui sun suo '+
 'ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun '+
 'wa wai wan wang wei wen weng wo wu r m n ng hm').split(' '));
/* split one run of pinyin letters into syllables: [{text, tone}] ; want = expected count (0 = unknown) */
function pySplit(run,want){let strict=true;
  const chars=[...run], base=[], tones=[];
  for(const ch of chars){const lo=ch.toLowerCase(), m=PY_BASE[lo]; base.push(m?m[0]:lo); tones.push(m?+m[1]:0);}
  const n=base.length, memo=new Map();
  /* fewest-syllable segmentation that respects apostrophes; prefer exactly `want` syllables when possible */
  function seg(i,left){ /* returns array of end indices or null */
    if(i===n)return (left===0||left<0)?[]:null;
    if(left===0)return null;
    const key=i+'|'+left; if(memo.has(key))return memo.get(key);
    let best=null;
    for(let j=Math.min(n,i+6);j>i;j--){
      const s=base.slice(i,j).join('');
      if(s.includes("'")||s.includes('’'))continue;
      if(!PY_SYL.has(s))continue;
      /* orthography: a syllable starting with a, e or o inside a word is written with an apostrophe */
      if(strict&&i>0&&'aeo'.includes(base[i])&&base[i-1]!=="'"&&base[i-1]!=='’')continue;
      /* a syllable carries at most one tone mark */
      let marks=0; for(let k=i;k<j;k++)if(tones[k])marks++; if(marks>1)continue;
      let nx=j; if(base[nx]==="'"||base[nx]==='’')nx++;
      const rest=seg(nx,left>0?left-1:left);
      if(rest){best=[j].concat(rest);break;}
    }
    memo.set(key,best); return best;
  }
  let ends=want>0?seg(0,want):null;
  if(!ends){memo.clear();ends=seg(0,-1);}
  if(!ends){strict=false;memo.clear();ends=seg(0,-1);}
  if(!ends)return null;
  const out=[]; let i=0;
  for(const j of ends){let tone=0;for(let k=i;k<j;k++)if(tones[k])tone=tones[k];out.push({text:chars.slice(i,j).join(''),tone});i=j;if(base[i]==="'"||base[i]==='’'){out[out.length-1].text+=chars[i];i++;}}
  return out;
}
const PY_RUN=/(&[#\w]+;)|([A-Za-zÀ-ɏḿ'’]+)/g;
/* colour each syllable by its own tone; anything that is not pinyin passes through untouched */
function tonePinyin(p){
  return String(p).replace(PY_RUN,(m,ent,run)=>{
    if(ent)return ent;
    const syl=pySplit(run,0);
    if(!syl){let t=0;for(const ch of run){const k=toneMarks[ch.toLowerCase()];if(k){t=k;break;}}return '<span class="tone'+t+'">'+run+'</span>';}
    return syl.map(s=>'<span class="tone'+s.tone+'">'+s.text+'</span>').join('');
  });
}
/* tones of a word, one per syllable (first reading only when alternatives are listed) */
function toneSeq(p){
  const first=String(p).split(/[\/,;(（]/)[0], out=[];
  (first.match(/[A-Za-zÀ-ɏḿ'’]+/g)||[]).forEach(run=>{const syl=pySplit(run,0);if(syl)syl.forEach(s=>out.push(s.tone));});
  return out;
}
function firstTone(p){for(const ch of String(p)){const t=toneMarks[ch.toLowerCase()];if(t)return t;}return 0;}
const TONEMARK=['·','ˉ','ˊ','ˇ','ˋ'];
function toneLabel(seq){return seq.map(t=>TONEMARK[t]).join(' ')+'   ('+seq.join('-')+')';}
