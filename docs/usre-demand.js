/* usre-demand.js — 미국 부동산 화면 「판매 · 매물 · 집값」 탭(2026-11-04 사용자).
   질문: 신규주택 판매·기존 매물·기존 판매가 금리가 오를 때와 내릴 때 어떻게 다른가,
         평균 수요가 고금리 때만 잠깐 둔화되는가, 집값은 얼마나 올랐나.
   자료: data/usre/demand.js 의 RED(build_usre.py build_demand). 월간.
   ① 거래 흐름(연간 페이스) ② 매물 재고 ③ 모기지 금리 ④ 집값(2000-01 = 100)
   빨강/파랑 띠 = 모기지 금리가 1년 전보다 높은/낮은 달. */
(function(){
"use strict";
if(typeof RED==="undefined") return;
const D=RED, M=D.months, N=M.length, S=D.s;
const fmt=(v,d=0)=>v==null?"–":(+v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
const sgn=(v,d=1)=>v==null?"–":(v>0?"+":"")+(+v).toFixed(d);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const sw=c=>`<i class="tv-sw" style="background:${c}"></i>`;
const COL={zs:"#4c8dff",zn:"#ff7a45",nhs:"#2fd3a0",zi:"#f2c14e",rl:"#e45bb3",mort:"#a78bfa",real:"#e8ecf3",pti:"#22d3ee"};
const RANGES=[
  {id:"all",label:"전체 2000~",start:"2000-01-01"},
  {id:"r08",label:"2008~ (Zillow 판매)",start:"2008-01-01"},
  {id:"r16",label:"2016~ (매물 자료)",start:"2016-01-01"},
  {id:"r19",label:"2019~",start:"2019-01-01"},
];
let cur="r08";
const lastIdx=a=>{ for(let i=a.length-1;i>=0;i--) if(a[i]!=null) return i; return -1; };
const lastOf=a=>{ const i=lastIdx(a); return i<0?null:{v:a[i],m:M[i].slice(0,7),i}; };
const ago=(a,i,k)=>i-k>=0?a[i-k]:null;

/* ---------- 타일 ---------- */
(function(){
  const z=lastOf(S.zs12), n=lastOf(S.nhs), zn=lastOf(S.zn12), zi=lastOf(S.zi), ms=lastOf(S.msa), P=D.price;
  const pct=(a,b)=>a==null||b==null?null:(a/b-1)*100;
  const tiles=[
    {k:"전체 판매(최근 12개월)",v:fmt(z&&z.v)+"천",d:`${z?z.m:""} · 2016~19 평균 ${fmt(D.base)}천`},
    {k:"신규주택 판매(연율)",v:fmt(n&&n.v)+"천",d:`${n?n.m:""} · 1년 전 ${fmt(n&&ago(S.nhs,n.i,12))}천`},
    {k:"신규 매물(최근 12개월)",v:fmt(zn&&zn.v)+"천",d:`${zn?zn.m:""} · 1년 전보다 ${sgn(pct(zn&&zn.v,zn&&ago(S.zn12,zn.i,12)))}%`},
    {k:"매물 재고(Zillow)",v:fmt(zi&&zi.v)+"천",d:`${zi?zi.m:""} · 1년 전보다 ${sgn(pct(zi&&zi.v,zi&&ago(S.zi,zi.i,12)))}%`},
    {k:"신규주택 재고 개월수",v:fmt(ms&&ms.v,1)+"개월",d:`${ms?ms.m:""} · 1년 전 ${fmt(ms&&ago(S.msa,ms.i,12),1)}개월`},
    {k:"실질 집값(물가 차감)",v:sgn(P.realPk)+"%",d:`${P.peak} 고점 대비 · 명목 ${sgn(P.nomPk)}%`},
  ];
  document.getElementById("d-tiles").innerHTML=tiles.map(x=>`<div class="mt"><div class="k">${x.k}</div><div class="v">${x.v}</div><div class="d">${x.d}</div></div>`).join("");
  document.getElementById("d-asof").textContent=M[N-1].slice(0,7);
})();

/* ---------- 핵심 요약(숫자는 데이터에서) ---------- */
(function(){
  const g=D.gap.filter(x=>x.y>="2023"), pull=D.gap.filter(x=>x.y<="2021").reduce((s,x)=>s+Math.max(0,x.gap),0);
  const def=g.filter(x=>!x.part).reduce((s,x)=>s+x.gap,0);
  const R=D.regime, nh=R.find(r=>r.name==="신규주택 판매"&&r.from==="1972"), zs=R.find(r=>r.name.indexOf("전체 판매")===0), cs=R.find(r=>r.name.indexOf("집값")===0);
  const best=r=>{ if(!r) return "–"; let k=0; r.lags.forEach((v,j)=>{ if(v<r.lags[k]) k=j; }); return [0,3,6,9,12][k]+"개월"; };
  const quick=D.episodes.filter(e=>e.recM!=null&&e.recM<=6).length, slow=D.episodes.filter(e=>e.recM==null||e.recM>6);
  const P=D.price, yrs=D.years, pti=k=>{ const y=yrs.find(x=>x.y===k); return y&&y.pti; };
  const lastPti=yrs.slice().reverse().find(y=>y.pti!=null);
  const items=[
    `<b>미뤄진 수요</b> — 전체 판매가 2016~19년 평균(${fmt(D.base)}천 건)보다 2023년부터 해마다 약 ${fmt(Math.abs(def/Math.max(1,g.filter(x=>!x.part).length)))}천 건 적었습니다(다 찬 해 합계 ${fmt(Math.abs(def))}천 건). 2020~21년 저금리 때 미리 당겨 산 ${fmt(pull)}천 건을 빼고 봐야 합니다.`,
    `<b>금리 반응</b> — 모기지가 1년 전보다 오른 달의 신규주택 판매는 전년 대비 중앙값 ${sgn(nh&&nh.up)}%, 내린 달은 ${sgn(nh&&nh.dn)}%(1972년~). 신축은 ${best(nh)} 시차로 가장 빨리, 전체 판매는 ${best(zs)} 뒤에 가장 크게 반응합니다.`,
    `<b>둔화는 보통 짧았다</b> — 1972년 이후 모기지가 1년 새 1%p 넘게 뛴 ${D.episodes.length}번 중 ${quick}번은 신규주택 판매가 6개월 안에 직전 수준을 되찾았습니다. 오래 걸린 경우: ${slow.map(e=>e.a.slice(0,4)+(e.recM==null?"(미회복)":`(${Math.round(e.recM/12*10)/10}년)`)).join(", ")}.`,
    `<b>집값</b> — 2019년 말 이후 명목 ${sgn(P.nom19,0)}%, 물가 차감 ${sgn(P.real19,0)}%. ${P.peak} 고점 이후로는 실질 ${sgn(P.realPk)}%. 소득 대비 집값(2000=100)은 2006년 ${fmt(pti("2006"))} → 2022년 ${fmt(pti("2022"))} → ${lastPti?lastPti.y+"년 "+fmt(lastPti.pti):""}. 금리가 오른 달에 집값은 오히려 더 올랐습니다(${sgn(cs&&cs.up)}% vs ${sgn(cs&&cs.dn)}%).`,
  ];
  document.getElementById("d-key").innerHTML=items.map(t=>`<li>${t}</li>`).join("");
})();

/* ---------- 차트 ---------- */
const rb=document.getElementById("d-rng");
rb.innerHTML=RANGES.map(r=>`<button data-id="${r.id}" aria-pressed="${r.id===cur}">${r.label}</button>`).join("");
rb.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;cur=b.dataset.id;rb.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x.dataset.id===cur));rebuild(true);});
let showBand=true;
document.getElementById("d-band").addEventListener("change",e=>{showBand=e.target.checked;rebuild();});
function bands(){
  if(!showBand) return [];
  const out=[]; let run=null;
  for(let i=0;i<N;i++){
    const d=S.dr[i], dir=d==null?0:(d>0?1:-1);
    if(run&&run.dir===dir){ run.b=M[i]; continue; }
    if(run&&run.dir) out.push(run);
    run={dir,a:M[i],b:M[i]};
  }
  if(run&&run.dir) out.push(run);
  return out.map(r=>({a:r.a,b:r.b,color:r.dir>0?"rgba(239,68,68,.085)":"rgba(59,130,246,.09)"}));
}
let G=null;
function rebuild(reset){
  if(!window.LightweightCharts) return;
  let keep=null;
  if(G&&!reset){ try{ keep=G.panes[0].chart.timeScale().getVisibleLogicalRange(); }catch(e){} }
  if(G) G.destroy();
  const R=RANGES.find(r=>r.id===cur); let i0=M.findIndex(m=>m>=R.start); if(i0<0) i0=0;
  G=TV.group(document.getElementById("d-bar"),{sync:true});
  const B=bands(), mo=i=>M[i].slice(0,7);
  const lg=(t,i,rows)=>`<b>${t}</b><span class="d">${mo(i)}</span>`+rows.filter(Boolean).join("");
  const row=(c,name,v,u)=>v==null?"":`<span>${sw(c)}${esc(name)} <b>${v}</b>${u||""}</span>`;
  const pf0={type:"price",precision:0,minMove:1}, pf1={type:"price",precision:1,minMove:0.1}, pf2={type:"price",precision:2,minMove:0.01};
  const P1=G.pane(document.getElementById("d-p1"),{key:"dem1",times:M,height:300,timeVisible:false,margins:{top:.14,bottom:.06},
    legend:i=>lg("① 거래 흐름 (천 건, 연간 페이스)",i,[row(COL.zs,"전체 판매(12개월 합)",fmt(S.zs12[i])),row(COL.zn,"신규 매물(12개월 합)",fmt(S.zn12[i])),row(COL.nhs,"신규주택 판매(연율)",fmt(S.nhs[i]))])});
  P1.add("line",{color:COL.zs,lineWidth:2.4,priceFormat:pf0},S.zs12);
  P1.add("line",{color:COL.zn,lineWidth:1.8,priceFormat:pf0},S.zn12);
  P1.add("line",{color:COL.nhs,lineWidth:2,priceFormat:pf0},S.nhs);
  P1.bands(B);
  const P2=G.pane(document.getElementById("d-p2"),{key:"dem2",times:M,height:210,timeVisible:false,bandLabels:false,margins:{top:.16,bottom:.06},
    legend:i=>lg("② 매물 재고 (천 건)",i,[row(COL.zi,"Zillow 매물",fmt(S.zi[i])),row(COL.rl,"Realtor.com 활성 매물",fmt(S.rl[i])),S.msa[i]!=null?`<span class="d">신규주택 재고 ${fmt(S.msa[i],1)}개월</span>`:""])});
  P2.add("line",{color:COL.zi,lineWidth:2,priceFormat:pf0},S.zi);
  P2.add("line",{color:COL.rl,lineWidth:1.8,priceFormat:pf0},S.rl);
  P2.bands(B);
  const P3=G.pane(document.getElementById("d-p3"),{key:"dem3",times:M,height:170,timeVisible:false,bandLabels:false,margins:{top:.16,bottom:.08},
    legend:i=>lg("③ 30년 모기지 금리 (%)",i,[row(COL.mort,"월평균",fmt(S.mort[i],2)+"%"),S.dr[i]!=null?`<span class="d">1년 전보다 ${sgn(S.dr[i],2)}%p</span>`:""])});
  P3.add("line",{color:COL.mort,lineWidth:2,priceFormat:pf2},S.mort);
  P3.bands(B);
  const P4=G.pane(document.getElementById("d-p4"),{key:"dem4",times:M,height:230,bandLabels:false,margins:{top:.16,bottom:.08},
    legend:i=>lg("④ 집값 (2000년 = 100)",i,[row(COL.real,"실질 집값(케이스-실러 ÷ CPI)",fmt(S.real[i],1)),row(COL.pti,"소득 대비 집값(연간)",fmt(S.pti[i],1)),S.csy[i]!=null?`<span class="d">명목 집값 전년 대비 ${sgn(S.csy[i])}%</span>`:""])});
  P4.add("line",{color:COL.real,lineWidth:2.2,priceFormat:pf1},S.real);
  P4.add("line",{color:COL.pti,lineWidth:1.8,lineType:1,priceFormat:pf1},S.pti);
  P4.bands(B);
  G.panes.forEach(P=>P.legend(null));
  const rng=keep||{from:i0-1,to:N-1+3};
  const setR=()=>G.panes.forEach(P=>P.chart.timeScale().setVisibleLogicalRange(rng));
  setR(); setTimeout(setR,0);
}
let built=false;
window.__demDraw=function(){
  if(document.getElementById("v-dem").hidden||built) return;
  built=true;
  TV.lib().then(()=>rebuild(true)).catch(()=>{ document.getElementById("d-key").insertAdjacentHTML("beforeend","<li>차트 라이브러리를 불러오지 못했습니다.</li>"); });
};

/* ---------- 표 ---------- */
(function(){
  const R=D.regime;
  document.getElementById("d-regTbl").innerHTML=`<thead><tr><th>지표</th><th>기간</th><th>금리 상승기 중앙값</th><th>금리 하락기 중앙값</th><th>상관계수</th><th>시차 0개월</th><th>3</th><th>6</th><th>9</th><th>12</th></tr></thead><tbody>`+
    R.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.from}~</td><td>${sgn(r.up)}% <span class="mute">(${r.nu}달)</span></td><td>${sgn(r.dn)}% <span class="mute">(${r.nd}달)</span></td><td>${sgn(r.corr,2)}</td>${r.lags.map(v=>`<td>${sgn(v,2)}</td>`).join("")}</tr>`).join("")+`</tbody>`;
  document.getElementById("d-epTbl").innerHTML=`<thead><tr><th>금리 급등 구간</th><th>모기지</th><th>직전 1년 평균 판매</th><th>저점</th><th>감소</th><th>직전 수준 회복</th></tr></thead><tbody>`+
    D.episodes.slice().reverse().map(e=>`<tr><td>${e.a}~${e.b}</td><td>${fmt(e.m0,1)}% → ${fmt(e.m1,1)}%</td><td>${fmt(e.base)}천</td><td>${fmt(e.low)}천 (${e.lowAt})</td><td>${sgn(e.chg,0)}%</td><td>${e.rec?`${e.rec} (${e.recM}개월)`:"아직"}</td></tr>`).join("")+`</tbody>`;
  const hh=y=>{ const r=D.years.find(x=>x.y===y); return r&&r.hh; };
  document.getElementById("d-gapTbl").innerHTML=`<thead><tr><th>연도</th><th>전체 판매(Zillow)</th><th>2016~19 평균 대비</th><th>가구 수</th><th>가구당 거래</th></tr></thead><tbody>`+
    D.gap.slice().reverse().map(x=>{ const h=hh(x.y); return `<tr><td>${x.y}${x.part?" (연율 환산)":""}</td><td>${fmt(x.zs)}천</td><td class="${x.gap<0?"dn":"up"}">${sgn(x.gap,0)}천</td><td>${h?fmt(h/1000,1)+"백만":"–"}</td><td>${h?(x.zs/h*100).toFixed(1)+"%":"–"}</td></tr>`; }).join("")+`</tbody>`;
  document.getElementById("d-yrTbl").innerHTML=`<thead><tr><th>연도</th><th>모기지</th><th>신규주택 판매</th><th>전체 판매</th><th>신규 매물</th><th>매물(Zillow)</th><th>매물(Realtor)</th><th>신규주택 재고</th><th>명목 집값 YoY</th><th>실질 집값</th><th>소득 대비 집값</th></tr></thead><tbody>`+
    D.years.slice().reverse().map(y=>`<tr><td>${y.y}${y.zsn&&y.zsn<12?" *":""}</td><td>${fmt(y.mort,2)}%</td><td>${fmt(y.nhs)}</td><td>${fmt(y.zs)}</td><td>${fmt(y.zn)}</td><td>${fmt(y.zi)}</td><td>${fmt(y.rl)}</td><td>${y.msa==null?"–":fmt(y.msa,1)+"개월"}</td><td>${sgn(y.csy)}%</td><td>${fmt(y.real,1)}</td><td>${fmt(y.pti,1)}</td></tr>`).join("")+`</tbody>`;
})();
})();
