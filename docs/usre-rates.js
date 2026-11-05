/* usre-rates.js — 미국 부동산 「주가×금리×경기」 탭 아래 「10년물 분해」 (2026-11-05 사용자:
   "기대인플레이션이랑 실질금리, 기간 프리미엄 따로 볼 수 있게 사이트에 추가, 연도별로 모아서 표랑 차트로").
   자료: data/usre/rates.js 의 RTS(build_usre.py build_rates) — FRED DGS10·DGS2·DFII10·T10YIE·T5YIFR·THREEFYTP10·DFEDTAR(U).
   ① 10년물 = 실질금리(TIPS) + 기대인플레이션(BEI) — 시장 가격으로 맞아떨어진다.
   ② 10년물 = 단기금리 기대 경로 + 기간프리미엄(연준 Kim-Wright 모델 추정). 두 칼질은 서로 겹쳐 셋을 그냥 더하면 안 된다. */
(function(){
"use strict";
if(typeof RTS==="undefined") return;
const $=id=>document.getElementById(id);
if(!$("r-p1")) return;
const R=RTS, dates=R.dates, N=dates.length, W=R.w, Y=R.years;
const T=s=>Date.parse(s+"T00:00:00Z"), DAY=864e5;
const COL={t10:"#e8ecf3",re:"#4c8dff",be:"#f2c14e",f5:"#f59e0b",tp:"#ef4444",exp:"#2fd3a0",t2:"#a78bfa",fed:"#9aa3b4"};
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const f2=v=>v==null?"–":(+v).toFixed(2);
const pc=v=>v==null?"–":(+v).toFixed(2)+"%";
const dp=v=>v==null?"–":(v>0?"+":"")+(+v).toFixed(2)+"%p";
const cls=v=>v==null?"":v>0?"up":v<0?"dn":"";
const sw=c=>`<i class="tv-sw" style="background:${c}"></i>`;
const r2=v=>v==null?null:Math.round(v*100)/100;
// 기대 단기금리 경로 = 10년물 − 기간프리미엄
const EXP=W.t10.map((v,i)=>v==null||W.tp[i]==null?null:r2(v-W.tp[i]));
function idxAt(iso){ const t=T(iso); let k=-1; for(let i=0;i<N;i++){ if(T(dates[i])<=t) k=i; else break; } return k; }
function lastIdx(arr){ for(let i=N-1;i>=0;i--) if(arr[i]!=null) return i; return -1; }

/* ---------- 연준 인상·인하 띠(주가×금리 차트와 같은 색) ---------- */
function bandList(){
  if(typeof REM==="undefined"||!$("r-band").checked) return [];
  const ev=REM.fed.map(r=>({d:r[0],bp:Math.round((r[2]-r[1])*100)})), cy=[];
  ev.forEach(e=>{ const dir=Math.sign(e.bp), c=cy[cy.length-1]; if(c&&c.dir===dir) c.b=e.d; else cy.push({dir,a:e.d,b:e.d}); });
  return cy.map(c=>({a:c.a,b:c.b,color:c.dir>0?"rgba(239,68,68,.085)":"rgba(59,130,246,.09)"}));
}

/* ---------- 핵심 숫자 ---------- */
(function(){
  const L=lastIdx(W.t10), at=k=>{ const i=idxAt(k); return i<0?null:i; };
  const iY=Math.max(0,L-52), iCut=at("2024-09-16"), iLow=at("2026-01-05");
  const v=(k,i)=>i==null||i<0?null:(k==="exp"?EXP[i]:W[k][i]);
  const d=(k,i)=>v(k,L)==null||v(k,i)==null?null:v(k,L)-v(k,i);
  const row=(k,lab)=>`<b>${lab}</b> ${pc(v(k,L))} (1년 전보다 <span class="${cls(d(k,iY))}">${dp(d(k,iY))}</span>, 2024-09 첫 인하 때보다 <span class="${cls(d(k,iCut))}">${dp(d(k,iCut))}</span>)`;
  const items=[
    `<b>지금 10년물 ${pc(v("t10",L))}</b> = 실질금리 ${pc(v("re",L))} + 기대인플레이션 ${pc(v("be",L))} (${dates[L]} 주). 2024년 9월 첫 인하 뒤 10년물은 ${dp(d("t10",iCut))} 올랐는데, 그중 실질금리가 ${dp(d("re",iCut))}, 기대인플레이션이 ${dp(d("be",iCut))}입니다.`,
    row("be","기대인플레이션(10년 BEI)")+` · 5년 뒤 5년 ${pc(v("f5",L))}. 2003년 이후 대부분 2~2.5% 안이라, 시장은 장기 물가가 고착될 거라고 보지 않습니다.`,
    row("tp","기간프리미엄(Kim-Wright)")+`. 장기채를 들고 있는 데 대한 웃돈 — 물가·정책 불확실성과 국채 공급(재정적자)이 커질 때 오릅니다. 첫 인하 뒤 10년물 상승분 ${dp(d("t10",iCut))} 중 ${dp(d("tp",iCut))}가 이 몫으로 추정됩니다.`,
    row("exp","단기금리 기대 경로(10년물 − 기간프리미엄)")+` · 2년물 ${pc(v("t2",L))}, 기준금리 상단 ${pc(v("fed",L))}. 시장이 앞으로 10년 평균 정책금리를 얼마로 보는지에 가깝습니다.`,
  ];
  $("r-key").innerHTML=items.map(t=>`<li>${t}</li>`).join("");
})();

/* ---------- 주간 차트 ---------- */
const RG=[{id:"a",label:"전체 2000~",s:"2000-01-01"},{id:"b",label:"2008~",s:"2008-01-01"},{id:"c",label:"2019~",s:"2019-01-01"},{id:"d",label:"2022~",s:"2022-01-01"}];
let cur="c", G=null;
const rb=$("r-rng");
rb.innerHTML=RG.map(r=>`<button data-id="${r.id}" aria-pressed="${r.id===cur}">${r.label}</button>`).join("");
rb.addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return; cur=b.dataset.id; rb.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x.dataset.id===cur)); draw(true); });
$("r-band").addEventListener("change",()=>draw());
const pf={type:"price",precision:2,minMove:0.01};
const row=(c,name,v,u)=>v==null?"":`<span>${sw(c)}${esc(name)} <b>${f2(v)}${u||"%"}</b></span>`;
function draw(reset){
  if(!window.LightweightCharts) return;
  let keep=null;
  if(G&&!reset){ try{ keep=G.panes[0].chart.timeScale().getVisibleLogicalRange(); }catch(e){} }
  if(G) G.destroy();
  const B=bandList(), R0=RG.find(r=>r.id===cur); let i0=dates.findIndex(d=>d>=R0.s); if(i0<0) i0=0;
  G=TV.group($("r-bar"),{sync:true});
  const P1=G.pane($("r-p1"),{key:"rt1",times:dates,height:300,timeVisible:false,margins:{top:.14,bottom:.06},
    legend:i=>`<b>① 10년물 = 실질금리 + 기대인플레이션</b><span class="d">${dates[i]} 주</span>`+
      row(COL.t10,"10년물",W.t10[i])+row(COL.re,"실질금리(TIPS)",W.re[i])+row(COL.be,"기대인플레이션(BEI)",W.be[i])+row(COL.f5,"5년 뒤 5년 BEI",W.f5[i])});
  P1.add("line",{color:COL.t10,lineWidth:2.2,priceFormat:pf},W.t10);
  P1.add("line",{color:COL.re,lineWidth:2,priceFormat:pf},W.re);
  P1.add("line",{color:COL.be,lineWidth:2,priceFormat:pf},W.be);
  P1.add("line",{color:COL.f5,lineWidth:1.2,lineStyle:2,priceFormat:pf},W.f5);
  P1.bands(B);
  const P2=G.pane($("r-p2"),{key:"rt2",times:dates,height:260,margins:{top:.14,bottom:.08},
    legend:i=>`<b>② 10년물 = 단기금리 기대 경로 + 기간프리미엄</b><span class="d">${dates[i]} 주 · 기간프리미엄은 모델 추정</span>`+
      row(COL.exp,"단기금리 기대 경로(10년물 − 기간프리미엄)",EXP[i])+row(COL.tp,"기간프리미엄(Kim-Wright)",W.tp[i])+row(COL.t2,"2년물",W.t2[i])+row(COL.fed,"기준금리 상단",W.fed[i])});
  P2.add("line",{color:COL.exp,lineWidth:2,priceFormat:pf},EXP);
  const tp=P2.add("line",{color:COL.tp,lineWidth:2.2,priceFormat:pf},W.tp);
  P2.add("line",{color:COL.t2,lineWidth:1.4,priceFormat:pf},W.t2);
  P2.add("line",{color:COL.fed,lineWidth:1.4,lineType:1,priceFormat:pf},W.fed);
  tp.createPriceLine({price:0,color:"rgba(255,255,255,.3)",lineWidth:1,lineStyle:0,axisLabelVisible:false,title:""});
  P2.bands(B);
  G.panes.forEach(P=>P.legend(null));
  const rng=keep||{from:i0-1,to:N-1+4};
  const setR=()=>G.panes.forEach(P=>P.chart.timeScale().setVisibleLogicalRange(rng));
  setR(); setTimeout(setR,0);
}

/* ---------- 연도별 차트(연평균) ---------- */
let GY=null;
function drawYears(){
  if(!window.LightweightCharts) return;
  if(GY) GY.destroy();
  const ys=Y.map(y=>y.y+"-07-01"), g=k=>Y.map(y=>y[k]);
  const ex=Y.map(y=>y.t10==null||y.tp==null?null:r2(y.t10-y.tp));
  GY=TV.group($("r-ybar"),{sync:false});
  const P=GY.pane($("r-yp"),{key:"rty",times:ys,height:300,margins:{top:.16,bottom:.06},
    legend:i=>{ const y=Y[i]; return `<b>연평균</b><span class="d">${y.y}년${y.n<12?` (1~${y.n}월)`:""}</span>`+
      row(COL.t10,"10년물",y.t10)+row(COL.re,"실질금리",y.re)+row(COL.be,"기대인플레이션",y.be)+row(COL.tp,"기간프리미엄",y.tp)+row(COL.exp,"단기금리 기대 경로",ex[i]); }});
  const o=c=>({color:c,lineWidth:2,priceFormat:pf,pointMarkersVisible:true,pointMarkersRadius:3});
  P.add("line",o(COL.t10),g("t10")); P.add("line",o(COL.re),g("re")); P.add("line",o(COL.be),g("be"));
  const tp=P.add("line",o(COL.tp),g("tp")); P.add("line",Object.assign(o(COL.exp),{lineWidth:1.4,lineStyle:2}),ex);
  tp.createPriceLine({price:0,color:"rgba(255,255,255,.3)",lineWidth:1,lineStyle:0,axisLabelVisible:false,title:""});
  P.legend(null);
  const fit=()=>P.chart.timeScale().fitContent(); fit(); setTimeout(fit,0);
}

/* ---------- 연도별 표 ---------- */
(function(){
  const dd=(a,b)=>a==null||b==null?"":`<em class="${cls(a-b)}">${a-b>0?"+":""}${(a-b).toFixed(2)}</em>`;
  const rows=Y.slice().reverse().map((y,k,arr)=>{
    const p=arr[k+1]||{};
    const ex=y.t10==null||y.tp==null?null:y.t10-y.tp;
    return `<tr><td>${y.y}${y.n<12?` (1~${y.n}월)`:""}</td>`+
      `<td>${pc(y.t10)}</td><td>${pc(y.re)}</td><td>${pc(y.be)}</td><td>${pc(y.f5)}</td><td>${pc(y.tp)}</td><td>${pc(ex)}</td><td>${pc(y.t2)}</td>`+
      `<td>${pc(y.t10E)} ${dd(y.t10E,p.t10E)}</td><td>${pc(y.reE)} ${dd(y.reE,p.reE)}</td><td>${pc(y.beE)} ${dd(y.beE,p.beE)}</td><td>${pc(y.tpE)} ${dd(y.tpE,p.tpE)}</td><td>${pc(y.fedE)}</td></tr>`;
  }).join("");
  $("r-yTbl").innerHTML=`<thead><tr><th rowspan="2">연도</th><th colspan="7">연평균</th><th colspan="5">연말 (옆 작은 숫자는 전년 말 대비 %p)</th></tr>`+
    `<tr><th>10년물</th><th>실질금리</th><th>기대인플레</th><th>5년 뒤 5년</th><th>기간프리미엄</th><th>단기금리 기대</th><th>2년물</th><th>10년물</th><th>실질금리</th><th>기대인플레</th><th>기간프리미엄</th><th>기준금리 상단</th></tr></thead><tbody>${rows}</tbody>`;
})();

/* ---------- 탭이 보일 때 그리기 ---------- */
let built=false;
function ensure(){
  const v=$("v-mac"); if(!v||v.hidden||built) return; built=true;
  TV.lib().then(()=>{ draw(true); drawYears(); }).catch(()=>{});
}
const prev=window.__remDraw;
window.__remDraw=function(){ if(prev) prev(); ensure(); };
ensure();
})();
