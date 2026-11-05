/* usre-cycle.js — 미국 부동산 화면 「금리 사이클」 탭(2026-11-05 사용자).
   "인상·인하·동결 구간을 2000년부터 나눠 그 사이 기준금리·모기지가 몇 bp 움직였는지 보고,
    기업을 골라 주가를 겹치고, 구간을 고르면 그 구간만 확대, 그 구간 매출·영업이익과 전년 대비를 클릭해서 보게"
   자료: data/usre/cycle.js 의 CYC(구간·주간 기준금리·모기지·10년물) + data/usre/cyc/<티커>.js(주간 수정주가·분기 실적, 고를 때만 읽음).
   구간 나누기(build_usre.py): 같은 방향 결정이 400일 안에 다시 나오면 한 사이클(중간 쉼 포함), 코로나 긴급 인하(2020-03)는 따로. */
(function(){
"use strict";
if(typeof CYC==="undefined") return;
const DAY=864e5, T=s=>Date.parse(s+"T00:00:00Z");
const C=CYC, dates=C.dates, N=dates.length, dT=dates.map(T);
const VER=dates[N-1];
const ERA=C.rangeEra;
const COL={px:"#4c8dff",fed:"#e8ecf3",mort:"#a78bfa",t10:"#34d399",yoy:"#f2c14e",rev:"#2fd3a0",oi:"#ff9f43"};
const KIND={up:{t:"인상",c:"up",band:"rgba(239,68,68,.055)",bandOn:"rgba(239,68,68,.12)",lc:"rgba(255,150,150,.6)"},
            dn:{t:"인하",c:"dn",band:"rgba(59,130,246,.06)",bandOn:"rgba(59,130,246,.13)",lc:"rgba(150,185,255,.65)"},
            hold:{t:"동결",c:"hold",band:"rgba(255,255,255,0)",bandOn:"rgba(255,255,255,.05)",lc:"rgba(220,226,236,.5)"}};
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const f2=(v,d=2)=>v==null?"–":(+v).toFixed(d);
const sg=(v,d=1)=>v==null?"–":(v>0?"+":"")+(+v).toFixed(d);
const bp=v=>v==null?"–":(v>0?"+":v<0?"−":"±")+Math.abs(Math.round(v*100))+"bp";
const cls=v=>v==null?"":v>0?"up":v<0?"dn":"";
const ym=s=>s.slice(2,4)+"."+s.slice(5,7);
const usd=v=>v==null?"–":"$"+(+v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const eok=v=>{ if(v==null) return "–"; const x=v/100, a=Math.abs(x); return x.toLocaleString("en-US",{minimumFractionDigits:a>=100?0:a>=10?1:2,maximumFractionDigits:a>=100?0:a>=10?1:2}); };   // 백만달러 → 억달러
const sw=c=>`<i class="tv-sw" style="background:${c}"></i>`;
function wIdx(iso){ const t=T(iso); if(t<=dT[0]) return 0; let lo=0,hi=N-1; while(lo<hi){ const m=(lo+hi+1)>>1; if(dT[m]<=t) lo=m; else hi=m-1; } return lo; }
const fedTxt=(v,iso)=>v==null?"–":(iso>=ERA?f2(Math.max(v-0.25,0))+"~":"")+f2(v)+"%";

/* ---------- 구간 ---------- */
const PER=C.per.map((p,i)=>{
  const K=KIND[p.k], ia=wIdx(p.a), ib=wIdx(p.b);
  const mon=(T(p.b)-T(p.a))/DAY/30.44;
  const lab=p.k==="hold"?`${K.t} ${ym(p.a)}~${p.open?"현재":ym(p.b)}`:`${K.t} ${ym(p.a)}~${p.open?"현재":ym(p.b)} ${bp(p.f1-p.f0)}`;
  return Object.assign({},p,{i,K,ia,ib,mon,lab});
});
const curPer=PER.length-1;

/* ---------- 상태 ---------- */
let tk=null, sel=null, custom=null, finMode="off", ovRev=false, ovOi=false, scale="log", G=null, TK=null, PX=null, Q=[];
try{ tk=localStorage.getItem("usre_cyc_tk"); }catch(e){}
if(!tk||!C.tick.some(x=>x[0]===tk)) tk="DHI";
try{ const s=localStorage.getItem("usre_cyc_sel"); if(s!=null&&s!=="all"&&PER[+s]) sel=+s; }catch(e){}
const NAME=Object.fromEntries(C.tick.map(x=>[x[0],x[1]]));

/* ---------- 고정 요소 ---------- */
const $=id=>document.getElementById(id);
(function(){
  const sel0=$("c-tk"), cats=[...new Set(C.tick.map(x=>x[2]))];
  sel0.innerHTML=cats.map(c=>`<optgroup label="${esc(c)}">`+C.tick.filter(x=>x[2]===c).map(x=>`<option value="${x[0]}"${x[0]===tk?" selected":""}>${esc(x[1])} (${x[0]})</option>`).join("")+"</optgroup>").join("");
  sel0.addEventListener("change",()=>{ tk=sel0.value; try{ localStorage.setItem("usre_cyc_tk",tk); }catch(e){} load(); });
  $("c-asof").textContent=C.last.mort[0];
  const pb=$("c-per");
  pb.innerHTML=`<button data-p="all" class="all">전체 1999~</button>`+PER.map(p=>`<button data-p="${p.i}" class="${p.K.c}">${esc(p.lab)}</button>`).join("");
  pb.addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return; pick(b.dataset.p==="all"?null:+b.dataset.p); });
  $("c-fin").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return; finMode=b.dataset.f; pressSeg("c-fin","f",finMode); draw(true); });
  $("c-ov").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;   // 켰다 끄면 주가 차트에 꺾은선으로 겹친다
    if(b.dataset.o==="rev") ovRev=!ovRev; else ovOi=!ovOi; ovPress(); draw(true); });
  $("c-scale").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return; scale=b.dataset.s; pressSeg("c-scale","s",scale); draw(true); });
  $("c-qdet").addEventListener("toggle",()=>{ if($("c-qdet").open) qTable(); });
})();
function pressSeg(id,k,v){ $(id).querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x.dataset[k]===v)); }
function pressPer(){ $("c-per").querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",custom?false:(x.dataset.p==="all"?sel==null:+x.dataset.p===sel))); }

/* ---------- 종목 읽기 ---------- */
function loadTk(t){
  return new Promise((ok,no)=>{
    if(window.CYCT&&CYCT[t]) return ok(CYCT[t]);
    const s=document.createElement("script"); s.src=`data/usre/cyc/${encodeURIComponent(t)}.js?v=${VER}`;
    s.onload=()=>window.CYCT&&CYCT[t]?ok(CYCT[t]):no(new Error("no data")); s.onerror=()=>no(new Error("load")); document.head.appendChild(s);
  });
}
function load(){
  $("c-meta").textContent="불러오는 중…";
  loadTk(tk).then(d=>{
    TK=d; PX=new Array(N).fill(null); d.p.forEach((v,k)=>{ if(d.s+k<N) PX[d.s+k]=v; });
    Q=(d.q||[]).slice().sort((a,b)=>a[0]<b[0]?-1:1);
    $("c-meta").textContent=`${PX[d.s]!=null?dates[d.s].slice(0,7)+"부터 주가":""}${Q.length?` · 실적 ${Q[0][0].slice(0,7)}~${Q[Q.length-1][0].slice(0,7)} (SEC XBRL)`:" · SEC 실적 없음"}`;
    draw(false); table(); if($("c-qdet").open) qTable();
  }).catch(()=>{ $("c-meta").textContent="이 종목 자료를 불러오지 못했습니다."; });
}

/* ---------- 실적 계산 ---------- */
function qLabel(end){
  const fm=(TK&&TK.fm)||12, e=new Date(T(end)-15*DAY), y=e.getUTCFullYear(), m=e.getUTCMonth()+1;
  const k=((m-fm)%12+12)%12, qn=k===0?4:Math.floor(k/3), fy=m<=fm?y:y+1;
  return `${String(fy%100).padStart(2,"0")}Q${qn}`;
}
function yoy(k,ix){   // ix 1 = 매출, 2 = 영업이익. 전년 같은 분기(345~385일 전)와 비교
  const e=T(Q[k][0]), b=Q[k][ix];
  for(let j=k-1;j>=0&&j>=k-6;j--){
    const d=(e-T(Q[j][0]))/DAY;
    if(d>=345&&d<=385){ const a=Q[j][ix]; if(a==null||b==null) return null;
      if(a>0&&b>=0) return {v:(b/a-1)*100};
      return {t:a<=0&&b>0?"흑자 전환":a>0?"적자 전환":"적자 지속"}; }
  }
  return null;
}
function ttm(iso,ix){
  let j=-1; for(let k=0;k<Q.length;k++){ if(Q[k][0]<=iso) j=k; else break; }
  if(j<3) return null; const s=Q.slice(j-3,j+1);
  if((T(s[3][0])-T(s[0][0]))/DAY>300||s.some(x=>x[ix]==null)) return null;
  return {v:s.reduce((a,x)=>a+x[ix],0),end:s[3][0]};
}
function ttmS(a,b,ix){   // 구간 시작 시점 4분기 합. 구간이 실적 시작 전에 시작하면 구간 안의 첫 4분기 합으로(late 표시)
  const r=ttm(a,ix); if(r) return r;
  for(let k=3;k<Q.length;k++){ if(Q[k][0]>b) break; const x=ttm(Q[k][0],ix); if(x) return Object.assign(x,{late:1}); }
  return null;
}
const chg=(a,b)=>a==null||b==null?null:a.v>0&&b.v>=0?{v:(b.v/a.v-1)*100}:{t:a.v<=0&&b.v>0?"흑자 전환":a.v>0?"적자 전환":"적자 지속"};
const chgTxt=c=>c==null?"–":c.t?c.t:sg(c.v)+"%";
function pxStat(i0,i1){
  let a=i0; while(a<=i1&&PX[a]==null) a++;
  let b=i1; while(b>=a&&PX[b]==null) b--;
  if(a>i1||b<a) return null;
  let hi=a,lo=a,pk=PX[a],mdd=0;
  for(let i=a;i<=b;i++){ const v=PX[i]; if(v==null) continue; if(v>PX[hi]) hi=i; if(v<PX[lo]) lo=i; pk=Math.max(pk,v); mdd=Math.min(mdd,(v/pk-1)*100); }
  const yrs=(dT[b]-dT[a])/DAY/365.25;
  return {a,b,r:(PX[b]/PX[a]-1)*100,hi,lo,mdd,cagr:yrs>=1?(Math.pow(PX[b]/PX[a],1/yrs)-1)*100:null,late:a>i0};
}

/* ---------- 차트 ---------- */
function bands(){
  const out=[];
  PER.forEach(p=>{
    const on=sel===p.i&&!custom;
    if(p.k!=="hold"||on) out.push({a:p.a,b:p.b,color:on?p.K.bandOn:p.K.band,label:p.k==="hold"?"동결":bp(p.f1-p.f0),lc:p.K.lc});
    (p.pause||[]).forEach(q=>out.push({a:q[0],b:q[1],color:"rgba(13,16,22,.35)"}));   // 사이클 안의 쉼(4개월 이상)은 띠를 옅게
  });
  return out;
}
function finSeries(){
  const ix=finMode==="oi"?2:1, V=new Array(N).fill(null), Y=new Array(N).fill(null), QI=new Array(N).fill(-1);
  Q.forEach((q,k)=>{
    if(q[ix]==null) return;
    const e=T(q[0]), s=k>0&&(e-T(Q[k-1][0]))/DAY<120?T(Q[k-1][0]):e-91*DAY;
    const y=yoy(k,ix), c=y==null?"rgba(139,147,163,.25)":y.t?(y.t==="흑자 전환"?"rgba(255,107,107,.42)":"rgba(91,155,255,.42)"):y.v>=0?"rgba(255,107,107,.3)":"rgba(91,155,255,.3)";
    for(let i=wIdx(new Date(s+DAY).toISOString().slice(0,10));i<N&&dT[i]+3*DAY<=e;i++){
      if(dT[i]+3*DAY<=s) continue;
      V[i]={value:q[ix]/100,color:k%2?c:c.replace(/[\d.]+\)$/,m=>Math.min(1,parseFloat(m)+0.07)+")")};
      Y[i]=y&&y.v!=null?Math.max(-150,Math.min(300,Math.round(y.v*10)/10)):null; QI[i]=k;
    }
  });
  return {V,Y,QI,ix};
}
/* 분기 매출·영업이익 꺾은선 — 분기 끝 주에 점을 찍고 사이를 잇는다(120일 넘게 비면 끊음). 눈금은 숨기고 값은 범례에 */
function finLine(ix){
  const V=new Array(N).fill(null); let prev=null;
  Q.forEach(q=>{
    if(q[ix]==null){ prev=null; return; }
    const w=wIdx(q[0]), v=q[ix]/100;
    if(prev&&(T(q[0])-T(prev.d))/DAY<120&&w>prev.w){ for(let i=prev.w+1;i<w;i++) V[i]=prev.v+(v-prev.v)*(i-prev.w)/(w-prev.w); }
    V[w]=v; prev={w,v,d:q[0]};
  });
  return V;
}
function qAt(i){ const t=dT[i]+6*DAY; for(let j=Q.length-1;j>=0;j--){ if(T(Q[j][0])<=t) return t-T(Q[j][0])<200*DAY?j:-1; } return -1; }
function legend1(i){
  const p=PER.find(x=>i>=x.ia&&i<=x.ib&&!(x.k==="hold"&&false)), r=sel!=null&&!custom?PER[sel]:null;
  const base=r?r.ia:custom?custom[0]:null;
  let rel="";
  if(base!=null&&PX[i]!=null){ let a=base; while(a<i&&PX[a]==null) a++; if(PX[a]!=null&&a<=i) rel=` <em class="${cls(PX[i]/PX[a]-1)}">구간 시작 대비 ${sg((PX[i]/PX[a]-1)*100)}%</em>`; }
  return `<b>${esc(NAME[tk])} (${tk})</b><span class="d">${dates[i]} 주</span>`+
    `<span>${sw(COL.px)}주가 <b>${usd(PX[i])}</b>${rel}</span>`+
    `<span>${sw(COL.fed)}기준금리 <b>${fedTxt(C.fed[i],dates[i])}</b></span>`+
    `<span>${sw(COL.mort)}30년 모기지 <b>${f2(C.mort[i])}%</b></span>`+
    ((ovRev||ovOi)&&Q.length?(()=>{ const k=qAt(i); if(k<0) return `<span class="d">분기 실적 없음</span>`;
      const q=Q[k], yc=y=>y==null?"":` <em class="${y.v!=null?cls(y.v):""}">${y.t||"전년 대비 "+sg(y.v)+"%"}</em>`;
      return `<span class="d">${qLabel(q[0])}</span>`+
        (ovRev?`<span>${sw(COL.rev)}매출액 <b>${eok(q[1])}억달러</b>${yc(yoy(k,1))}</span>`:"")+
        (ovOi?`<span>${sw(COL.oi)}${esc(TK.oik||"영업이익")} <b>${eok(q[2])}억달러</b>${yc(yoy(k,2))}</span>`:""); })():"")+
    (p?`<span class="d">${p.K.t} 구간</span>`:"");
}
function draw(keepRange){
  if(!window.LightweightCharts||!TK) return;
  let keep=null;
  if(G&&keepRange){ try{ keep=G.panes[0].chart.timeScale().getVisibleLogicalRange(); }catch(e){} }
  if(G) G.destroy();
  const b1=$("c-p1"), b2=$("c-p2");
  G=TV.group($("c-bar"),{sync:true,onHover:info,onRange:(a,b)=>pickCustom(a,b),onFit:()=>pick(null)});
  const P1=G.pane(b1,{key:"cyc1:"+tk,times:dates,height:430,log:scale==="log",margins:{top:.08,bottom:.06},legend:legend1});
  P1.chart.applyOptions({leftPriceScale:{visible:true,borderColor:"#232833",minimumWidth:52,scaleMargins:{top:.08,bottom:.06}}});
  P1.add("area",{lineColor:COL.px,topColor:"rgba(76,141,255,.07)",bottomColor:"rgba(76,141,255,0)",lineWidth:1.5,priceFormat:{type:"price",precision:2,minMove:0.01}},PX);
  P1.add("line",{color:"rgba(167,139,250,.85)",lineWidth:1,priceScaleId:"left",priceFormat:{type:"price",precision:2,minMove:0.01}},C.mort);
  const fs=P1.add("line",{color:"rgba(232,236,243,.7)",lineWidth:1,lineType:1,priceScaleId:"left",priceFormat:{type:"price",precision:2,minMove:0.01}},C.fed);
  const mk={}; C.ev.forEach(e=>{ const w=wIdx(e[0]); mk[w]=(mk[w]||0)+(e[2]-e[1]); });
  fs.setMarkers(Object.keys(mk).map(Number).sort((a,b)=>a-b).map(w=>{ const up=mk[w]>0; return {time:dates[w],position:up?"aboveBar":"belowBar",color:up?"rgba(239,68,68,.55)":"rgba(59,130,246,.6)",shape:up?"arrowUp":"arrowDown",size:0.3}; }));
  [[ovRev,1,COL.rev],[ovOi,2,COL.oi]].forEach(([on,ix,c])=>{ if(!on||!Q.length) return;
    P1.add("line",{color:c,lineWidth:1.3,priceScaleId:"q"+ix,lastValueVisible:false,priceLineVisible:false,crosshairMarkerRadius:2,priceFormat:{type:"price",precision:1,minMove:0.1}},finLine(ix));
    P1.chart.priceScale("q"+ix).applyOptions({scaleMargins:{top:.12,bottom:.1}});
  });
  const bd=bands(); P1.bands(bd);
  b2.hidden=finMode==="off";
  if(finMode!=="off"){
    const F=finSeries(), nm=finMode==="oi"?(TK.oik||"영업이익"):"매출액";
    const P2=G.pane(b2,{key:"cyc2:"+tk+":"+finMode,times:dates,height:210,bandLabels:false,margins:{top:.16,bottom:.02},
      legend:i=>{ let k=F.QI[i];
        if(!Q.length) return `<b>${nm}</b><span class="d">SEC XBRL 실적이 없는 종목입니다.</span>`;
        if(k<0){ const t=dT[i]+6*DAY; for(let j=Q.length-1;j>=0;j--){ if(T(Q[j][0])<=t){ if(t-T(Q[j][0])<200*DAY) k=j; break; } } }   // 최근 분기 이후 주는 마지막 분기를 보여 준다
        if(k<0) return `<b>${nm}</b><span class="d">${dates[i]} 주 · 이 시기 분기 실적 없음 (SEC XBRL은 대개 2009년부터)</span>`;
        const q=Q[k], y=yoy(k,F.ix);
        return `<b>${nm}</b><span class="d">${qLabel(q[0])} · ${q[0]} 종료 분기</span><span>${sw("rgba(255,107,107,.7)")}<b>${eok(q[F.ix])}억달러</b></span>`+
          `<span>${sw(COL.yoy)}전년 대비 <b class="${y&&y.v!=null?cls(y.v):""}">${y==null?"–":y.t||sg(y.v)+"%"}</b></span>`; }});
    P2.chart.applyOptions({leftPriceScale:{visible:true,borderColor:"#232833",minimumWidth:52,scaleMargins:{top:.16,bottom:.02}}});
    P2.add("hist",{priceFormat:{type:"price",precision:1,minMove:0.1},lastValueVisible:false},F.V);
    const ys=P2.add("line",{color:"rgba(242,193,78,.8)",lineWidth:1,lineType:1,priceScaleId:"left",lastValueVisible:false,crosshairMarkerVisible:false,priceFormat:{type:"price",precision:0,minMove:1}},F.Y);
    ys.createPriceLine({price:0,color:"rgba(242,193,78,.25)",lineWidth:1,lineStyle:2,axisLabelVisible:false,title:""});
    P2.bands(bd.map(x=>Object.assign({},x,{label:null})));
  }
  const r=custom?[custom[0],custom[1]]:sel!=null?[PER[sel].ia,PER[sel].ib]:null;
  G.panes.forEach(P=>{ P.defI=r?r[1]:N-1; P.legend(null); });
  let rng=keep;
  if(!rng){ if(r){ const pad=Math.max(3,Math.round((r[1]-r[0])*0.04)); rng={from:r[0]-pad,to:r[1]+pad}; } else rng={from:-2,to:N+4}; }
  const setR=()=>G.panes.forEach(P=>P.chart.timeScale().setVisibleLogicalRange(rng));
  setR(); setTimeout(setR,0);
  info(null); pressPer(); srcLine();
}
function info(i){
  const el=$("c-info");
  if(i==null){ el.innerHTML=""; return; }
  const p=PER.find(x=>i>=x.ia&&i<=x.ib), t0=dT[i], t1=t0+6*DAY;
  const evs=C.ev.filter(e=>T(e[0])>=t0&&T(e[0])<=t1).map(e=>`<span class="${e[2]>e[1]?"up":"dn"}">${e[2]>e[1]?"▲ 인상":"▼ 인하"} ${Math.abs(Math.round((e[2]-e[1])*100))}bp · ${e[0]} (${f2(e[1])}→${f2(e[2])}%)</span>`);
  el.innerHTML=`<b>${dates[i]} 주</b>`+(p?`<span class="${p.K.c==="hold"?"":p.K.c}">${p.K.t} 구간 ${p.a} ~ ${p.open?"현재":p.b}</span>`:"")+evs.join("");
}
function srcLine(){
  setH($("c-src"),`<span class="it">${sw("rgba(239,68,68,.55)")}인상 구간</span><span class="it">${sw("rgba(59,130,246,.6)")}인하 구간</span><span class="it">${sw("rgba(255,255,255,.25)")}고른 동결 구간</span><span class="it">${sw("rgba(13,16,22,.9)")}사이클 안의 쉼(4개월↑)</span>`+
    `<span class="it">${sw(COL.px)}주가(오른쪽 눈금)</span><span class="it">${sw(COL.fed)}기준금리 · ${sw(COL.mort)}30년 모기지(왼쪽 눈금, %)</span>`+
    `<span class="it">${sw(COL.rev)}분기 매출액 · ${sw(COL.oi)}분기 ${esc((TK&&TK.oik)||"영업이익")} 꺾은선(각자 높이에 맞춘 눈금, 값은 왼쪽 위 범례)</span>`+
    (finMode!=="off"?`<span class="it">아래 칸 막대: 분기 ${finMode==="oi"?"영업이익":"매출액"}(억달러, 빨강 = 전년보다 증가·파랑 = 감소) · ${sw(COL.yoy)}전년 대비(%, 왼쪽 눈금)</span>`:""));
}
function setH(el,html){ el.innerHTML=html.replace(/style="background:([^"]+)"/g,'data-bg="$1"'); el.querySelectorAll("[data-bg]").forEach(x=>x.style.background=x.dataset.bg); }   // 사이트 CSP 가 style="…" 을 막는다

/* ---------- 구간 고르기 ---------- */
function pick(i){
  sel=i; custom=null; try{ localStorage.setItem("usre_cyc_sel",i==null?"all":String(i)); }catch(e){}
  draw(false); markRow(); if($("c-qdet").open) qTable();
}
function pickCustom(a,b){
  a=Math.max(0,Math.min(N-1,a)); b=Math.max(0,Math.min(N-1,b)); if(a>b){ const t=a; a=b; b=t; }
  if(b-a<2) return; custom=[a,b]; draw(false); markRow(); if($("c-qdet").open) qTable();
}
function span(){   // 지금 보고 있는 구간 [시작일, 끝날, 시작 위치, 끝 위치]
  if(custom) return [dates[custom[0]],dates[custom[1]],custom[0],custom[1]];
  if(sel!=null){ const p=PER[sel]; return [p.a,p.b,p.ia,p.ib]; }
  return [dates[0],dates[N-1],0,N-1];
}

/* ---------- 요약 줄 ---------- */
function rateRows(p){
  const m=p.m, t=p.t, mo=m.s&&m.e?m.e[1]-m.s[1]:null;
  const pre=m.pre&&m.s?m.s[1]-m.pre[1]:null;
  return `<div class="rr"><i>기준금리</i><span><b>${fedTxt(p.f0,p.a)} → ${fedTxt(p.f1,p.b)}</b> <em class="${cls(p.f1-p.f0)}">${bp(p.f1-p.f0)}</em>${p.n?` <em>${p.n}번 결정</em>`:""}</span>`+
    ((p.pause||[]).length?`<span><em>중간 쉼 ${p.pause.map(q=>`${q[0]}~${q[1]}`).join(", ")}</em></span>`:"")+`</div>`+
    `<div class="rr"><i>30년 모기지</i><span><b>${f2(m.s&&m.s[1])}% → ${f2(m.e&&m.e[1])}%</b> <em class="${cls(mo)}">${bp(mo)}</em></span>`+
    `<span>구간 최고 <b>${f2(m.hi&&m.hi[1])}%</b> <em>${m.hi?m.hi[0]:""}</em></span><span>최저 <b>${f2(m.lo&&m.lo[1])}%</b> <em>${m.lo?m.lo[0]:""}</em></span>`+
    `<span>시작 전 6개월 <b class="${cls(pre)}">${bp(pre)}</b></span></div>`+
    `<div class="rr"><i>10년물</i><span><b>${f2(t.s&&t.s[1])}% → ${f2(t.e&&t.e[1])}%</b> <em class="${cls(t.s&&t.e?t.e[1]-t.s[1]:null)}">${t.s&&t.e?bp(t.e[1]-t.s[1]):"–"}</em></span></div>`;
}
function rateRowsW(i0,i1){   // 직접 지정·전체: 주간 자료로 계산
  let hi=null,lo=null; for(let i=i0;i<=i1;i++){ const v=C.mort[i]; if(v==null) continue; if(hi==null||v>C.mort[hi]) hi=i; if(lo==null||v<C.mort[lo]) lo=i; }
  const a=C.mort[i0], b=C.mort[i1], fa=C.fed[i0], fb=C.fed[i1];
  const n=C.ev.filter(e=>T(e[0])>=dT[i0]&&T(e[0])<=dT[i1]+6*DAY).length;
  return `<div class="rr"><i>기준금리</i><span><b>${fedTxt(fa,dates[i0])} → ${fedTxt(fb,dates[i1])}</b> <em class="${cls(fb-fa)}">${bp(fb-fa)}</em> <em>${n}번 결정</em></span></div>`+
    `<div class="rr"><i>30년 모기지</i><span><b>${f2(a)}% → ${f2(b)}%</b> <em class="${cls(a!=null&&b!=null?b-a:null)}">${a!=null&&b!=null?bp(b-a):"–"}</em></span>`+
    (hi!=null?`<span>구간 최고 <b>${f2(C.mort[hi])}%</b> <em>${dates[hi]} 주</em></span><span>최저 <b>${f2(C.mort[lo])}%</b> <em>${dates[lo]} 주</em></span>`:"")+`</div>`+
    `<div class="rr"><i>10년물</i><span><b>${f2(C.t10[i0])}% → ${f2(C.t10[i1])}%</b> <em class="${cls(C.t10[i0]!=null&&C.t10[i1]!=null?C.t10[i1]-C.t10[i0]:null)}">${C.t10[i0]!=null&&C.t10[i1]!=null?bp(C.t10[i1]-C.t10[i0]):"–"}</em></span></div>`;
}
function summary(){
  const [a,b,i0,i1]=span(), p=sel!=null&&!custom?PER[sel]:null;
  const yrs=(T(b)-T(a))/DAY/365.25;
  const head=p?`<b>${p.K.t} ${p.a} ~ ${p.open?b+" (진행 중)":p.b}</b><em>${p.mon<24?Math.round(p.mon)+"개월":yrs.toFixed(1)+"년"}</em>`
    :`<b>${a} ~ ${b}</b><em>${yrs.toFixed(1)}년${custom?" · 직접 지정":" · 전체"}</em>`;
  const s=pxStat(i0,i1);
  const px=s?`<div class="rr"><i>${esc(tk)} 주가</i><span><b>${usd(PX[s.a])} → ${usd(PX[s.b])}</b> <b class="${cls(s.r)}">${sg(s.r)}%</b>${s.late?` <em>(${dates[s.a]}부터)</em>`:""}</span>`+
    (s.cagr!=null?`<span>연평균 <b class="${cls(s.cagr)}">${sg(s.cagr)}%</b></span>`:"")+
    `<span>최고 <b>${usd(PX[s.hi])}</b> <em>${dates[s.hi]}</em></span><span>최저 <b>${usd(PX[s.lo])}</b> <em>${dates[s.lo]}</em></span><span>최대 낙폭 <b class="dn">${s.mdd.toFixed(1)}%</b></span></div>`
    :`<div class="rr"><i>${esc(tk)} 주가</i><span class="mute">이 구간엔 상장 전이라 주가가 없습니다.</span></div>`;
  const ra=ttmS(a,b,1), rb=ttm(b,1), oa=ttmS(a,b,2), ob=ttm(b,2), nm=TK.oik||"영업이익";
  let fin;
  if(!Q.length) fin=`<span class="mute">SEC XBRL 실적이 없는 종목입니다.</span>`;
  else if(!rb||T(b)<T(Q[0][0])) fin=`<span class="mute">이 구간은 SEC XBRL 실적(${Q[0][0].slice(0,4)}년~) 이전이라 실적이 없습니다.</span>`;
  else fin=`<span>매출액(최근 4분기 합) <b>${ra?eok(ra.v):"–"} → ${eok(rb.v)}억달러</b> <b class="${cls(chg(ra,rb)&&chg(ra,rb).v)}">${chgTxt(chg(ra,rb))}</b></span>`+
    (oa||ob?`<span>${esc(nm)} <b>${oa?eok(oa.v):"–"} → ${ob?eok(ob.v):"–"}억달러</b> <b class="${cls(chg(oa,ob)&&chg(oa,ob).v)}">${chgTxt(chg(oa,ob))}</b></span>`:`<span>${esc(nm)} <span class="mute">이 구간 자료 없음</span></span>`)+
    `<span><em>${ra?qLabel(ra.end):"?"} → ${qLabel(rb.end)} 기준${ra&&ra.late?" (구간이 실적 공시 전에 시작해 첫 4분기부터)":""}</em></span><button type="button" class="c-qbtn" id="c-qbtn">분기별 매출·영업이익 보기 ▾</button>`;
  const el=$("c-sum");
  setH(el,`<div class="rh">${head}</div>`+(p?rateRows(p):rateRowsW(i0,i1))+px+`<div class="rr"><i>${esc(tk)} 실적</i>${fin}</div>`);
  const qb=$("c-qbtn"); if(qb) qb.addEventListener("click",()=>{ const d=$("c-qdet"); d.open=true; qTable(); d.scrollIntoView({behavior:"smooth",block:"start"}); });
}

/* ---------- 표: 구간 전체 ---------- */
function table(){
  const nm=TK.oik||"영업이익";
  const rows=PER.map(p=>{
    const m=p.m, mo=m.s&&m.e?m.e[1]-m.s[1]:null, pre=m.pre&&m.s?m.s[1]-m.pre[1]:null;
    const s=pxStat(p.ia,p.ib), r0=ttmS(p.a,p.b,1), o0=ttmS(p.a,p.b,2), rv=chg(r0,ttm(p.b,1)), oi=chg(o0,ttm(p.b,2));
    const lt=x=>x&&x.late?' <span class="mute">*</span>':"";
    return `<tr data-p="${p.i}" class="${p.i===sel&&!custom?"sel":""}"><td><span class="ck ${p.K.c}">${p.K.t}</span>${p.open?" <em>진행 중</em>":""}</td><td>${p.a} ~ ${p.open?"현재":p.b}</td><td>${p.mon<24?Math.round(p.mon)+"개월":(p.mon/12).toFixed(1)+"년"}</td>`+
      `<td>${f2(p.f0)} → ${f2(p.f1)}%</td><td class="${cls(p.f1-p.f0)}">${bp(p.f1-p.f0)}</td>`+
      `<td>${f2(m.s&&m.s[1])} → ${f2(m.e&&m.e[1])}%</td><td class="${cls(mo)}">${bp(mo)}</td><td>${f2(m.hi&&m.hi[1])}% <span class="mute">${m.hi?m.hi[0].slice(0,7):""}</span></td><td>${f2(m.lo&&m.lo[1])}% <span class="mute">${m.lo?m.lo[0].slice(0,7):""}</span></td><td class="${cls(pre)}">${bp(pre)}</td>`+
      `<td class="${s?cls(s.r):""}">${s?sg(s.r)+"%":"–"}${s&&s.late?' <span class="mute">상장 후</span>':""}</td><td class="${rv&&rv.v!=null?cls(rv.v):""}">${chgTxt(rv)}${rv?lt(r0):""}</td><td class="${oi&&oi.v!=null?cls(oi.v):""}">${chgTxt(oi)}${oi?lt(o0):""}</td></tr>`;
  }).reverse().join("");
  $("c-tbl").innerHTML=`<thead><tr><th>구분</th><th>기간</th><th>길이</th><th>기준금리(상단)</th><th>변화</th><th>30년 모기지</th><th>변화</th><th>모기지 최고</th><th>모기지 최저</th><th>시작 전 6개월 모기지</th><th>${esc(tk)} 주가</th><th>매출(4분기 합)</th><th>${esc(nm)}(4분기 합)</th></tr></thead><tbody>${rows}</tbody>`;
  $("c-tblh").textContent=`${NAME[tk]} (${tk}) · * = 구간이 실적 공시(XBRL) 전에 시작해 첫 4분기부터 잰 값`;
}
$("c-tbl").addEventListener("click",e=>{ const tr=e.target.closest("tr[data-p]"); if(!tr) return; pick(+tr.dataset.p); $("c-card").scrollIntoView({behavior:"smooth",block:"start"}); });
function markRow(){ $("c-tbl").querySelectorAll("tr[data-p]").forEach(r=>r.classList.toggle("sel",!custom&&+r.dataset.p===sel)); }

/* ---------- 표: 분기 실적 ---------- */
function qTable(){
  const el=$("c-qTbl"); if(!TK) return;
  const nm=TK.oik||"영업이익";
  if(!Q.length){ el.innerHTML='<tbody><tr><td>SEC XBRL 실적이 없는 종목입니다.</td></tr></tbody>'; return; }
  const [a,b]=span(), ta=T(a)-92*DAY, tb=T(b)+(sel!=null&&PER[sel]&&PER[sel].open?0:0);
  const ks=[]; Q.forEach((q,k)=>{ const e=T(q[0]); if(e>ta&&e<=tb+DAY) ks.push(k); });
  $("c-qh").textContent=`${NAME[tk]} (${tk}) · ${a} ~ ${b}`;
  if(!ks.length){ el.innerHTML=`<tbody><tr><td>이 구간에는 SEC XBRL 분기 실적이 없습니다(이 종목은 ${Q[0][0].slice(0,7)}부터).</td></tr></tbody>`; return; }
  const yc=y=>y==null?"<td>–</td>":y.t?`<td class="${y.t==="흑자 전환"?"up":"dn"}">${y.t}</td>`:`<td class="${cls(y.v)}">${sg(y.v)}%</td>`;
  const rows=ks.slice().reverse().map(k=>{ const q=Q[k], om=q[2]!=null&&q[1]>0?q[2]/q[1]*100:null;
    return `<tr${T(q[0])<T(a)?' class="pre"':""}><td>${qLabel(q[0])}${T(q[0])<T(a)?' <span class="mute">구간 직전</span>':""}</td><td>${q[0]}</td><td>${eok(q[1])}</td>${yc(yoy(k,1))}<td>${eok(q[2])}</td>${yc(yoy(k,2))}<td>${om==null?"–":om.toFixed(1)+"%"}</td></tr>`; }).join("");
  el.innerHTML=`<thead><tr><th>분기(회계)</th><th>분기 끝</th><th>매출액(억달러)</th><th>전년 대비</th><th>${esc(nm)}(억달러)</th><th>전년 대비</th><th>${esc(nm)}률</th></tr></thead><tbody>${rows}</tbody>`;
}

/* ---------- 시작 ---------- */
let built=false;
function ensure(){
  if($("v-cyc").hidden||built) return; built=true;
  TV.lib().then(load).catch(()=>{ $("c-info").textContent="차트 라이브러리를 불러오지 못했습니다."; });
}
window.__cycDraw=ensure;
function ovPress(){ $("c-ov").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.o==="rev"?ovRev:ovOi)); }
pressSeg("c-fin","f",finMode); pressSeg("c-scale","s",scale); ovPress();
})();
