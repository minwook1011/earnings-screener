/* us-re-macro.js — 미국 부동산 화면의 탭 전환 + 「주가×금리×경기」 차트(2026-11-04 사용자).
   자료: data/usre/macro.js 의 REM(build_us_re.py). 주가는 야후 주간 수정주가, 금리·실업률·PPI는 FRED.
   ① 업종별 대장주 주가(시작 주 = 100, 로그) ② 30년 모기지·10년물·기준금리 ③ 실업률 전년 차(%p)·PPI 전년 대비(%)
   빨강/파랑 띠 = 연준 인상/인하 구간, 회색 띠 = 경기침체(NBER), 점선 = 큰 사건. */
(function(){
"use strict";
/* ---------- 탭 ---------- */
const TABS=["scr","mac","dem"];
function showTab(t){
  if(!TABS.includes(t)) t="scr";
  document.querySelectorAll("#retab button[data-tab]").forEach(b=>b.setAttribute("aria-pressed", b.dataset.tab===t));
  TABS.forEach(k=>{ const v=document.getElementById("v-"+k); if(v) v.hidden = k!==t; });
  try{ localStorage.setItem("usre_tab",t); }catch(e){}
  try{ const u=new URL(location.href); if(t==="scr") u.searchParams.delete("tab"); else u.searchParams.set("tab",t); history.replaceState(null,"",u.pathname+u.search+u.hash); }catch(e){}
  if(t==="mac" && window.__remDraw) window.__remDraw();
  if(t==="dem" && window.__demDraw) window.__demDraw();   // 판매·매물·집값 탭(usre-demand.js)
  window.dispatchEvent(new Event("resize"));
}
document.querySelectorAll("#retab button[data-tab]").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));
let t0=null; try{ t0=new URL(location.href).searchParams.get("tab"); }catch(e){}
if(!t0){ try{ t0=localStorage.getItem("usre_tab"); }catch(e){} }
if(typeof REM==="undefined"){ showTab("scr"); return; }

/* ---------- 차트 ---------- */
const DAY=864e5;
const T=s=>Date.parse(s+"T00:00:00Z");
const GROUPS=[
  {id:"hb",label:"홈빌더 5사",c:"--g1",stocks:[["DHI","D.R. 호튼"],["LEN","레나"],["PHM","펄티그룹"],["NVR","NVR"],["TOL","톨브라더스"]]},
  {id:"pf",label:"플랫폼 3사",c:"--g2",stocks:[["Z","질로우"],["COMP","컴퍼스"],["OPEN","오픈도어"]],
    note:"질로우는 2015-08(C주), 오픈도어는 2020-06(합병 전 스팩), 컴퍼스는 2021-04부터 자료가 있습니다."},
  {id:"rr",label:"주거용 리츠 3사",c:"--g3",stocks:[["VMRK","비브마크"],["ESS","에섹스"],["INVH","인비테이션 홈즈"]],
    note:"비브마크는 2026-08-18 AvalonBay·Equity Residential 합병 회사로, 그 전 주가는 Equity Residential(EQR)입니다. 인비테이션 홈즈는 2017-02 상장."},
  {id:"cr",label:"상업용 리츠 3사",c:"--g4",stocks:[["WELL","웰타워"],["PLD","프로로지스"],["EQIX","에퀴닉스"]],
    note:"에퀴닉스는 2000-08 상장. 웰타워=헬스케어(시니어하우징), 프로로지스=물류, 에퀴닉스=데이터센터."},
];
const SCOL=["--s1","--s2","--s3","--s4","--s5"];
const RECS=[
  {a:"2001-03-01",b:"2001-11-30",t:"닷컴버블 붕괴 침체",s:"닷컴"},
  {a:"2007-12-01",b:"2009-06-30",t:"글로벌 금융위기 침체",s:"금융위기"},
  {a:"2020-02-01",b:"2020-04-30",t:"코로나 침체",s:"코로나"},
];
const EVENTS=[
  {d:"2000-03-10",t:"나스닥 고점(닷컴버블 정점)"},
  {d:"2006-07-01",t:"미국 집값 고점(케이스-실러)"},
  {d:"2008-09-15",t:"리먼 브러더스 파산"},
  {d:"2020-03-23",t:"코로나 증시 바닥"},
];
const RANGES=[
  {id:"all",label:"전체 2000~",start:"2000-01-01"},
  {id:"r05",label:"2005~ (버블 붕괴)",start:"2005-01-01"},
  {id:"r12",label:"2012~ (회복기)",start:"2012-01-01"},
  {id:"r19",label:"2019~ (코로나·인상기)",start:"2019-01-01"},
  {id:"r22",label:"2022~",start:"2022-01-01"},
];
const D=REM, dates=D.dates, dT=dates.map(T), N=dates.length;
const mort=D.mort.map(r=>[T(r[0]),r[1],r[0]]), t10=D.t10.map(r=>[T(r[0]),r[1],r[0]]);
const urS=D.ur.map(r=>[T(r[0])+14*DAY,r[2],r[0],r[1]]).filter(r=>r[1]!=null);   // 월 자료는 그달 가운데에 찍는다
const ppS=D.ppi.map(r=>[T(r[0])+14*DAY,r[1],r[0]]);
const fedEv=D.fed.map(r=>({t:T(r[0]),d:r[0],from:r[1],to:r[2],bp:Math.round((r[2]-r[1])*100)}));
const RANGE_ERA=T("2008-12-16");
const endT=Math.max(dT[N-1],T(D.fedLast[0]),mort[mort.length-1][0],t10[t10.length-1][0]);
const fedPts=[[T("2000-01-01"),D.fedStart]]; fedEv.forEach(e=>fedPts.push([e.t,e.to]));
function fedAt(t){let v=D.fedStart;for(const e of fedEv){if(e.t<=t)v=e.to;else break;}return v;}
function lastAt(arr,t){let lo=0,hi=arr.length-1,ans=-1;while(lo<=hi){const m=(lo+hi)>>1;if(arr[m][0]<=t){ans=m;lo=m+1}else hi=m-1}return ans<0?null:arr[ans];}
const monthAt=(arr,t)=>{ const iso=new Date(t).toISOString().slice(0,7)+"-01"; let r=null; for(const x of arr){ if(x[2]<=iso) r=x; else break; } return r; };
const cycles=[];
fedEv.forEach(e=>{const dir=Math.sign(e.bp);const c=cycles[cycles.length-1];
  if(c&&c.dir===dir){c.t1=e.t;c.n++;c.bp+=e.bp}else cycles.push({dir,t0:e.t,t1:e.t,n:1,bp:e.bp});});
const fmt=(v,d=2)=>v==null?"–":(+v).toFixed(d);
const sgn=(v,d=1)=>v==null?"–":(v>0?"+":"")+(+v).toFixed(d);
const ymd=t=>new Date(t).toISOString().slice(0,10);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let cur="all", grp="hb", showRec=true, showUR=true, showPPI=true;

/* 그룹 지수: 시작 주 = 100. 상장 전 종목은 빼고 주간 수익률을 같은 비중으로 이어 붙인다(체인 연결).
   늦게 상장한 종목의 선은 상장 주의 그룹 평균에서 시작한다. */
function groupSeries(g,i0){
  const P=g.stocks.map(s=>D.px[s[0]]||[]);
  const A=new Array(N).fill(null);
  for(let i=i0;i<N;i++){
    if(i===i0||A[i-1]==null){ if(P.some(p=>p[i]!=null)) A[i]=100; continue; }
    let sum=0,n=0; P.forEach(p=>{ if(p[i]!=null&&p[i-1]!=null){ sum+=p[i]/p[i-1]; n++; } });
    A[i]=n?A[i-1]*sum/n:A[i-1];
  }
  const idx={};
  g.stocks.forEach((s,j)=>{ const p=P[j], arr=new Array(N).fill(null); let base=null,anc=null;
    for(let i=i0;i<N;i++){ if(p[i]==null) continue; if(base==null){ base=p[i]; anc=A[i]==null?100:A[i]; } arr[i]=p[i]/base*anc; }
    idx[s[0]]=arr; });
  const first=A.findIndex(v=>v!=null);
  return {A,idx,first};
}

/* ---------- 고정 요소: 타일·버튼 ---------- */
(function tiles(){
  const m=mort[mort.length-1], b=t10[t10.length-1], f=D.fedLast;
  const m1y=lastAt(mort,m[0]-365*DAY), b1y=lastAt(t10,b[0]-365*DAY);
  const lastEv=fedEv[fedEv.length-1];
  const u=D.ur[D.ur.length-1], p=D.ppi[D.ppi.length-1];
  const ym=s=>s.slice(0,7);
  const tiles=[
    {k:"30년 고정 모기지",v:fmt(m[1])+"%",d:`${m[2]} · 1년 전 ${fmt(m1y&&m1y[1])}%`},
    {k:"10년물 국채",v:fmt(b[1])+"%",d:`${b[2]} · 1년 전 ${fmt(b1y&&b1y[1])}%`},
    {k:"기준금리(목표 범위)",v:`${fmt(f[1]-0.25)}~${fmt(f[1])}%`,d:`최근 ${lastEv.d} ${lastEv.bp>0?"▲ 인상":"▼ 인하"} ${Math.abs(lastEv.bp)}bp`},
    {k:"모기지 − 10년물",v:fmt(m[1]-(lastAt(t10,m[0])||b)[1])+"%p",d:"평소 1.5~2%p 안팎"},
    {k:"실업률",v:fmt(u[1],1)+"%",d:`${ym(u[0])} · 1년 전보다 ${sgn(u[2])}%p`},
    {k:"PPI 전년 대비",v:sgn(p[1])+"%",d:`${ym(p[0])} · 최종수요 생산자물가`},
  ];
  document.getElementById("m-tiles").innerHTML=tiles.map(x=>`<div class="mt"><div class="k">${x.k}</div><div class="v">${x.v}</div><div class="d">${x.d}</div></div>`).join("");
  document.getElementById("m-asof").textContent=ymd(endT);
})();
let scaleMode="log", showFedB=true, custom=null;   // custom = [시작 위치, 끝 위치] — 사용자가 직접 정한 구간
const gb=document.getElementById("m-grp");
gb.innerHTML=GROUPS.map(g=>`<button data-g="${g.id}" aria-pressed="${g.id===grp}">${g.label}</button>`).join("")+`<button data-g="cmp" aria-pressed="false">4그룹 평균 비교</button>`;
gb.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;grp=b.dataset.g;gb.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x.dataset.g===grp));picker();rebuild();yearTable();});
const rb=document.getElementById("m-rng");
rb.innerHTML=RANGES.map(r=>`<button data-id="${r.id}" aria-pressed="${r.id===cur}">${r.label}</button>`).join("");
function pressPreset(id){ cur=id; rb.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x.dataset.id===id)); }
rb.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;custom=null;pressPreset(b.dataset.id);rebuild(true);});
/* 날짜로 직접 지정(2026-11-04 사용자) — 시작일 = 100 으로 다시 맞추고 그 구간만 보여 준다 */
const fIn=document.getElementById("m-from"), tIn=document.getElementById("m-to");
fIn.min=tIn.min=dates[0]; fIn.max=tIn.max=dates[N-1];
function setCustom(a,b){
  a=Math.max(0,Math.min(N-1,a)); b=Math.max(0,Math.min(N-1,b)); if(a>b){const t=a;a=b;b=t;}
  if(b-a<2){ document.getElementById("m-rsum").innerHTML='<span class="warn">구간이 너무 짧습니다. 2주 이상으로 지정하세요.</span>'; return; }
  custom=[a,b]; pressPreset(null); rebuild(true);
}
function applyDates(){
  if(!fIn.value||!tIn.value){ document.getElementById("m-rsum").innerHTML='<span class="warn">시작일과 끝날을 모두 넣으세요.</span>'; return; }
  setCustom(weekOf(T(fIn.value)), weekOf(T(tIn.value)));
}
document.getElementById("m-go").addEventListener("click",applyDates);
[fIn,tIn].forEach(x=>x.addEventListener("keydown",e=>{ if(e.key==="Enter") applyDates(); }));
const sb=document.getElementById("m-scale");
sb.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;scaleMode=b.dataset.s;sb.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x.dataset.s===scaleMode));rebuild();});
const chk=(id,fn)=>document.getElementById(id).addEventListener("change",e=>{fn(e.target.checked);rebuild();});
chk("m-rec",v=>showRec=v); chk("m-fedb",v=>showFedB=v); chk("m-ur",v=>showUR=v); chk("m-ppi",v=>showPPI=v);

/* ---------- 검정 차트 3칸(① 주가 ② 금리 ③ 경기·물가) — 시간축·십자선이 같이 움직인다 ---------- */
const PAL=["#4c8dff","#ff7a45","#2fd3a0","#f2c14e","#e45bb3"];
const GCOL={hb:"#4c8dff",pf:"#ff7a45",rr:"#2fd3a0",cr:"#b28cff"};
const COL={mort:"#a78bfa",t10:"#34d399",fed:"#e8ecf3",ur:"#fb923c",ppi:"#22d3ee",avg:"#f4f6fa",hike:"#ef4444",cut:"#3b82f6"};
const wk=arr=>dT.map(t=>{ const r=lastAt(arr,t+6*DAY); return r?r[1]:null; });
const W_MORT=wk(mort), W_T10=wk(t10), W_FED=dT.map(t=>fedAt(t+6*DAY));
const W_UR=wk(urS), W_PPI=wk(ppS);
const urRaw=dT.map(t=>{ const r=lastAt(urS,t+6*DAY); return r?r[3]:null; });
const r2=v=>v==null?null:Math.round(v*100)/100;
function weekOf(t){ let lo=0,hi=N-1; if(t<=dT[0]) return 0; while(lo<hi){const m=(lo+hi+1)>>1; if(dT[m]<=t) lo=m; else hi=m-1;} return lo; }
const sw=c=>`<i class="tv-sw" style="background:${c}"></i>`;
let G=null, curSeries=[];
function bandsList(){
  const out=[];
  if(showFedB) cycles.forEach(c=>out.push({a:ymd(c.t0),b:ymd(c.t1),color:c.dir>0?"rgba(239,68,68,.085)":"rgba(59,130,246,.09)"}));
  if(showRec) RECS.forEach(r=>out.push({a:r.a,b:r.b,color:"rgba(255,255,255,.075)",label:r.s}));
  return out;
}
function seriesList(i0){
  const out=[];
  const reb=(arr,base)=>arr.map(v=>v==null||!base?null:v*100/base);
  const baseOf=A=>{ for(let i=i0;i<N;i++) if(A[i]!=null) return A[i]; return null; };
  if(grp==="cmp"){
    GROUPS.forEach(g=>{ const s=groupSeries(g,0); out.push({id:g.id,name:g.label+" 평균",c:GCOL[g.id],v:reb(s.A,baseOf(s.A)),avg:1}); });
  }else{
    const g=GROUPS.find(x=>x.id===grp), s=groupSeries(g,0), base=baseOf(s.A);
    g.stocks.forEach((st,j)=>out.push({id:st[0],k:st[0],name:`${st[1]} (${st[0]})`,c:PAL[j],v:reb(s.idx[st[0]],base)}));
    out.push({id:"avg",name:`${g.label} 평균`,c:COL.avg,v:reb(s.A,base),avg:1,bold:1});
  }
  return out.filter(x=>!isOff(x.id));
}
/* 종목 고르기(2026-11-05 사용자: "기업 하나하나로 보게 선택해서 볼 수 있게") — 업종마다 따로 기억한다 */
const OFF={};
const isOff=id=>!!(OFF[grp]&&OFF[grp].has(id));
function pickItems(){
  if(grp==="cmp") return GROUPS.map(g=>({id:g.id,name:g.label+" 평균",c:GCOL[g.id]}));
  const g=GROUPS.find(x=>x.id===grp);
  return g.stocks.map((st,j)=>({id:st[0],name:`${st[1]} (${st[0]})`,c:PAL[j]})).concat([{id:"avg",name:`${g.label} 평균`,c:COL.avg}]);
}
const pk=document.getElementById("m-pick");
function picker(){
  const it=pickItems(), off=OFF[grp]||new Set();
  pk.innerHTML=it.map(x=>`<button type="button" data-id="${x.id}" aria-pressed="${!off.has(x.id)}" title="누르면 켜고 끄기, 두 번 누르면 이것만">${sw(x.c)}${esc(x.name)}</button>`).join("")+
    `<span class="gap"></span><button type="button" class="q" data-q="all">모두</button>`+(grp==="cmp"?"":`<button type="button" class="q" data-q="avg">평균만</button>`);
}
let pkTimer=null, pkLast=null;
pk.addEventListener("click",e=>{
  const b=e.target.closest("button"); if(!b) return;
  const ids=pickItems().map(x=>x.id);
  if(b.dataset.q==="all") OFF[grp]=new Set();
  else if(b.dataset.q==="avg") OFF[grp]=new Set(ids.filter(x=>x!=="avg"));
  else{
    const id=b.dataset.id, off=OFF[grp]||(OFF[grp]=new Set());
    if(pkLast===id && pkTimer){ clearTimeout(pkTimer); pkTimer=null; pkLast=null; OFF[grp]=new Set(ids.filter(x=>x!==id)); }   // 두 번 누름 = 이것만
    else{ off.has(id)?off.delete(id):off.add(id); pkLast=id; clearTimeout(pkTimer); pkTimer=setTimeout(()=>{pkTimer=null;pkLast=null;},350); }
  }
  picker(); rebuild();
});
function legendsSrc(){
  const G0=GROUPS.find(g=>g.id===grp);
  document.getElementById("m-gnote").textContent = grp==="cmp" ? "4개 그룹의 같은 비중 평균을 겹쳤습니다. 늦게 상장한 종목은 상장 주부터 평균에 들어갑니다. "+GROUPS.filter(g=>g.note).map(g=>g.note).join(" ") : (G0&&G0.note)||"";
  document.getElementById("m-src").innerHTML=
    `<span class="it">${sw("rgba(239,68,68,.5)")}연준 인상 구간</span><span class="it">${sw("rgba(59,130,246,.55)")}연준 인하 구간</span><span class="it">${sw("rgba(255,255,255,.35)")}경기침체(NBER)</span><span class="it">┆ 큰 사건</span>`+
    `<span class="it src">출처: 주가 야후 파이낸스 주간 수정주가 · 모기지 프레디맥 PMMS(FRED MORTGAGE30US) · 10년물 FRED DGS10 · 기준금리 FRED DFEDTAR·DFEDTARU · 실업률 미 노동통계국(FRED UNRATE) · PPI 최종수요(FRED PPIFIS), 2010-10 이전 완제품(WPUFD49207) · 침체 NBER</span>`;
}
function info(i){
  const el=document.getElementById("m-info");
  if(i==null){ el.innerHTML='<span class="mute">차트에 마우스를 올리면 그 주의 침체·사건·금리 결정이 여기 나옵니다.</span>'; return; }
  const ti=dT[i], tt=ti+6*DAY, out=[];
  const rec=RECS.find(r=>T(r.a)<=tt&&ti<=T(r.b));
  if(rec) out.push(`<span class="rec">■ ${esc(rec.t)} (${rec.a.slice(0,7)}~${rec.b.slice(0,7)})</span>`);
  EVENTS.filter(e=>T(e.d)>=ti-3*DAY&&T(e.d)<=tt).forEach(e=>out.push(`<span>┆ ${esc(e.t)} · ${e.d}</span>`));
  fedEv.filter(e=>e.t>=ti&&e.t<=tt).forEach(e=>out.push(`<span class="${e.bp>0?"up":"dn"}">${e.bp>0?"▲ 인상":"▼ 인하"} ${Math.abs(e.bp)}bp · ${e.d} (${fmt(e.from)}→${fmt(e.to)}%)</span>`));
  el.innerHTML=`<b>${dates[i]} 주</b>`+(out.length?out.join(""):'<span class="mute">이 주에는 표시할 사건이 없습니다.</span>');
}
function rebuild(resetRange){
  if(!window.LightweightCharts) return;
  const box1=document.getElementById("m-p1"), box2=document.getElementById("m-p2"), box3=document.getElementById("m-p3");
  let keep=null;
  if(G && !resetRange){ try{ keep=G.panes[0].chart.timeScale().getVisibleLogicalRange(); }catch(e){} }
  if(G) G.destroy();
  let i0, i1=N-1;
  if(custom){ i0=custom[0]; i1=custom[1]; }
  else { const R=RANGES.find(r=>r.id===cur)||RANGES[0]; i0=dT.findIndex(t=>t>=T(R.start)); if(i0<0) i0=0; }
  fIn.value=dates[i0]; tIn.value=dates[i1];
  G=TV.group(document.getElementById("m-bar"),{sync:true,onHover:info,
    onRange:(a,b)=>setCustom(a,b),
    onFit:()=>{ custom=null; pressPreset("all"); rebuild(true); }});
  const bands=bandsList(), evl=EVENTS.map(e=>({d:e.d,label:e.t}));
  curSeries=seriesList(i0);
  // ① 주가
  const P1=G.pane(box1,{key:"mac1:"+grp,times:dates,height:400,log:scaleMode==="log",timeVisible:false,margins:{top:.12,bottom:.06},
    legend:i=>`<b>① 주가</b><span class="d">${dates[i]} 주 · ${scaleMode==="log"?dates[i0]+" = 100, 로그":"보이는 첫 주 = 100"}</span>`+
      curSeries.map(s=>{ const v=s.v[i]; if(v==null) return ""; const raw=s.k&&D.px[s.k]&&D.px[s.k][i]!=null?` <em>$${D.px[s.k][i].toLocaleString(undefined,{maximumFractionDigits:2})}</em>`:"";
        return `<span>${sw(s.c)}${esc(s.name)} <b>${Math.round(v).toLocaleString()}</b>${raw}</span>`; }).join("")});
  const ordered=curSeries.slice().sort((a,b)=>(b.avg||0)-(a.avg||0));   // 평균선을 기준 시리즈로(선 긋기 기준)
  if(!ordered.length) P1.add("line",{color:"rgba(0,0,0,0)",lastValueVisible:false,crosshairMarkerVisible:false},new Array(N).fill(100));
  ordered.forEach(s=>P1.add("line",{color:s.c,lineWidth:s.bold?3:(s.avg?2.4:1.6),title:"",lastValueVisible:true,priceFormat:{type:"price",precision:0,minMove:1}},s.v.map(r2)));
  if(scaleMode==="idx") P1.chart.priceScale("right").applyOptions({mode:3});
  P1.bands(bands); P1.vlines(evl);
  // ② 금리
  const P2=G.pane(box2,{key:"mac2",times:dates,height:230,timeVisible:false,bandLabels:false,margins:{top:.14,bottom:.08},
    legend:i=>`<b>② 금리</b><span class="d">${dates[i]} 주</span><span>${sw(COL.mort)}30년 모기지 <b>${fmt(W_MORT[i])}%</b></span><span>${sw(COL.t10)}10년물 <b>${fmt(W_T10[i])}%</b></span><span>${sw(COL.fed)}기준금리 <b>${dT[i]>=RANGE_ERA?fmt(Math.max(W_FED[i]-0.25,0))+"~":""}${fmt(W_FED[i])}%</b></span>`});
  P2.add("line",{color:COL.mort,lineWidth:2,priceFormat:{type:"price",precision:2,minMove:0.01}},W_MORT);
  P2.add("line",{color:COL.t10,lineWidth:1.6,priceFormat:{type:"price",precision:2,minMove:0.01}},W_T10);
  const fs=P2.add("line",{color:COL.fed,lineWidth:2,lineType:1,priceFormat:{type:"price",precision:2,minMove:0.01}},W_FED);
  const mk={}; fedEv.forEach(e=>{ const w=weekOf(e.t); (mk[w]=mk[w]||[]).push(e); });
  fs.setMarkers(Object.keys(mk).map(Number).sort((a,b)=>a-b).map(w=>{ const bp=mk[w].reduce((s,e)=>s+e.bp,0), up=bp>0;
    return {time:dates[w],position:up?"aboveBar":"belowBar",color:up?COL.hike:COL.cut,shape:up?"arrowUp":"arrowDown",size:0.7}; }));
  P2.bands(bands); P2.vlines(EVENTS.map(e=>({d:e.d})));
  // ③ 경기·물가
  const P3=G.pane(box3,{key:"mac3",times:dates,height:230,bandLabels:false,margins:{top:.14,bottom:.08},
    legend:i=>`<b>③ 경기·물가</b><span class="d">${dates[i]} 주</span>`+
      (showUR?`<span>${sw(COL.ur)}실업률 1년 전 대비 <b>${sgn(W_UR[i])}%p</b>${urRaw[i]!=null?` <em>(실업률 ${fmt(urRaw[i],1)}%)</em>`:""}</span>`:"")+
      (showPPI?`<span>${sw(COL.ppi)}PPI 전년 대비 <b>${sgn(W_PPI[i])}%</b></span>`:"")});
  const pf={type:"price",precision:1,minMove:0.1};
  let s3=null;
  if(showUR){ s3=P3.add("line",{color:COL.ur,lineWidth:2,priceFormat:pf},W_UR); s3.createPriceLine({price:0.5,color:"rgba(251,146,60,.55)",lineWidth:1,lineStyle:2,axisLabelVisible:false,title:"실업률 +0.5%p"}); }
  if(showPPI){ const s=P3.add("line",{color:COL.ppi,lineWidth:1.7,priceFormat:pf},W_PPI); if(!s3) s3=s; }
  if(!s3) s3=P3.add("line",{color:"rgba(0,0,0,0)",lastValueVisible:false,crosshairMarkerVisible:false},W_UR);
  s3.createPriceLine({price:0,color:"rgba(255,255,255,.3)",lineWidth:1,lineStyle:0,axisLabelVisible:false,title:""});
  P3.bands(bands); P3.vlines(EVENTS.map(e=>({d:e.d})));
  G.panes.forEach(P=>{ P.defI=i1; P.legend(null); });
  const rng=keep||(custom?{from:i0-0.5,to:i1+0.5}:{from:i0-1,to:N-1+6});
  const setR=()=>G.panes.forEach(P=>P.chart.timeScale().setVisibleLogicalRange(rng));
  setR(); setTimeout(setR,0);   // 칸을 만들 때 기본 범위가 서로 덮어써서 한 번 더 맞춘다
  legendsSrc(); info(null); rsum(i0,i1);
}
/* 구간 요약: 시작 주 → 끝 주 변화 */
function rsum(i0,i1){
  const pct=(a,b)=>a==null||b==null?null:(b/a-1)*100;
  const cl=v=>v==null?"":v>=0?"up":"dn";
  const yrs=((dT[i1]-dT[i0])/(365.25*DAY)).toFixed(1);
  const st=curSeries.map(s=>{
    let a=i0; while(a<=i1&&s.v[a]==null) a++;
    if(a>i1||s.v[i1]==null) return "";
    const r=pct(s.v[a],s.v[i1]);
    return `<span>${sw(s.c)}${esc(s.name.replace(" 평균"," 평균"))} <b class="${cl(r)}">${sgn(r)}%</b>${a>i0?` <em>(${dates[a]}부터)</em>`:""}</span>`;
  }).join("");
  const d=(arr,lab,unit,dig)=>{ const a=arr[i0], b=arr[i1]; if(a==null||b==null) return ""; const x=b-a;
    return `<span>${lab} <b>${fmt(a,dig)}${unit} → ${fmt(b,dig)}${unit}</b> <em class="${x>0?"up":x<0?"dn":""}">${x>0?"+":""}${fmt(x,dig)}%p</em></span>`; };
  const el=document.getElementById("m-rsum");
  el.innerHTML=(
    `<div class="rh"><b>${dates[i0]} ~ ${dates[i1]}</b><em>${yrs}년 · ${i1-i0}주${custom?" · 직접 지정":""}</em></div>`+
    `<div class="rr"><i>주가</i>${st}</div>`+
    `<div class="rr"><i>금리</i>${d(W_MORT,"30년 모기지","%",2)}${d(W_T10,"10년물","%",2)}${d(W_FED,"기준금리(상단)","%",2)}</div>`+
    `<div class="rr"><i>경기·물가</i>${d(urRaw,"실업률","%",1)}${d(W_PPI,"PPI 전년 대비","%",1)}</div>`).replace(/style="background:([^"]+)"/g,'data-bg="$1"');
  el.querySelectorAll("[data-bg]").forEach(x=>x.style.background=x.dataset.bg);
}
let built=false;
function ensure(){
  if(document.getElementById("v-mac").hidden) return;
  if(built) return; built=true;
  TV.lib().then(()=>rebuild(true)).catch(()=>{ document.getElementById("m-info").textContent="차트 라이브러리를 불러오지 못했습니다."; });
}
window.__remDraw=ensure;

/* ---------- 표 ---------- */
(function(){
  const rows=fedEv.slice().reverse().map(e=>`<tr><td>${e.d}</td><td>${fmt(e.from)}%</td><td>${fmt(e.to)}%</td><td class="${e.bp>0?"up":"dn"}">${e.bp>0?"▲ +":"▼ "}${e.bp}bp</td></tr>`).join("");
  document.getElementById("m-fedTbl").innerHTML=`<thead><tr><th>날짜</th><th>이전(상단)</th><th>이후(상단)</th><th>변경</th></tr></thead><tbody>${rows}</tbody>`;
})();
function yearTable(){
  const gs = grp==="cmp" ? GROUPS : [GROUPS.find(g=>g.id===grp)];
  const tks=[].concat(...gs.map(g=>g.stocks));
  const yrs=[], y1=new Date(endT).getUTCFullYear();
  for(let y=2000;y<=y1;y++){
    const te=y===y1?endT:Date.UTC(y,11,31,23);
    let i=-1; for(let k=0;k<N;k++){ if(dT[k]<=te) i=k; else break; } if(i<0) continue;
    const m=lastAt(mort,te), b=lastAt(t10,te);
    const u=monthAt(D.ur.map(r=>[0,r[2],r[0],r[1]]),te), p=monthAt(D.ppi.map(r=>[0,r[1],r[0]]),te);
    yrs.push(`<tr><td>${y===y1?y+" (현재)":y}</td>${tks.map(s=>{const v=(D.px[s[0]]||[])[i];return `<td>${v==null?"–":v.toLocaleString(undefined,{maximumFractionDigits:2})}</td>`;}).join("")}<td>${fmt(m&&m[1])}%</td><td>${fmt(b&&b[1])}%</td><td>${fmt(fedAt(te))}%</td><td>${u?fmt(u[3],1)+"%":"–"}</td><td>${p?sgn(p[1])+"%":"–"}</td></tr>`);
  }
  document.getElementById("m-yrTbl").innerHTML=`<thead><tr><th>연말</th>${tks.map(s=>`<th>${s[0]} ($)</th>`).join("")}<th>모기지</th><th>10년물</th><th>기준(상단)</th><th>실업률</th><th>PPI YoY</th></tr></thead><tbody>${yrs.reverse().join("")}</tbody>`;
}
picker();
yearTable();
showTab(t0||"scr");
})();
