/* 선행지표 트래킹(2026-11-16 사용자) — 2단계 리포트의 선행지표를 기업별로 매핑하고 주가와 겹쳐 본다.
 * 데이터  data/jp/lead/index.json(섹터 트리) · data/jp/lead/<코드>.json(지표 원장 — 값마다 근거 문서·쪽)
 *         data/jp/px/<코드>.json(일봉, build_px.py 매일) · data/jp/scr.json(시총·PER)
 * 주소    lead.html#            홈(다가오는 실적 · 섹터)
 *         lead.html#s/<대>/<소>  섹터(peer 비교)
 *         lead.html#c/<코드>     기업(체크포인트 · 지표×주가 · 선행지표 상세 · 2단계 리포트 · IR 자료 · 출처 매핑)
 * 차트 원칙: 주가 = 캔들/막대(OHLC)/선 전환, 지표 = 분기 막대(주가 아래 띠에 겹침, 축 없이 값 라벨),
 *            발표일 = 금색 점선 + 다음 날 주가 반응. 두 번째 y축은 쓰지 않는다. */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var DAY = 864e5;
  var S = { idx: null, co: {}, px: {}, scr: null, st: {} };
  var main = document.getElementById("main");
  var tip = document.getElementById("tip");
  var REDUCE = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 공통 ---------- */
  function getJSON(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]; }); }
  function nf(v, d) { if (v == null || isNaN(v)) return "—"; return (+v).toLocaleString("ko-KR", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function auto(v, u) {   // 단위에 맞춘 자릿수
    if (v == null || isNaN(v)) return "—";
    if (u === "%") return (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), 1) + "%";
    if (u === "억엔") return nf(v, Math.abs(v) < 100 ? 1 : 0);
    if (u === "만엔") return nf(v, 1);
    return nf(v, 0);
  }
  function pct(v, d) { if (v == null || isNaN(v)) return "—"; return (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), d == null ? 1 : d) + "%"; }
  function ud(v) { return v > 0 ? "up" : v < 0 ? "dn" : ""; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(t) { var d = new Date(t); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function md(t) { var d = new Date(t); return String(d.getUTCFullYear()).slice(2) + "." + pad(d.getUTCMonth() + 1) + "." + pad(d.getUTCDate()); }
  function tOf(s) { var p = s.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function today() { var n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); }
  function dday(s) { return Math.round((tOf(s) - today()) / DAY); }
  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function txt(parent, x, y, s, cls, anchor) { var t = el("text", { x: x, y: y, "class": cls || null, "text-anchor": anchor || null }, parent); t.textContent = s; return t; }
  function nice(lo, hi, n) {
    var span = hi - lo || 1, step = Math.pow(10, Math.floor(Math.log10(span / n))), m = span / n / step;
    step *= m > 5 ? 10 : m > 2 ? 5 : m > 1 ? 2 : 1;
    var out = [], v = Math.ceil(lo / step) * step;
    for (; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }

  /* ---------- 분기 ---------- */
  function qi(q) { var m = /^(\d{2})\.(\d)Q/.exec(q); return m ? +m[1] * 4 + (+m[2] - 1) : null; }
  function qs(i) { return pad(Math.floor(i / 4)) + "." + (i % 4 + 1) + "Q"; }
  function qEnd(co, q) {
    var i = qi(q), y = 2000 + Math.floor(i / 4), n = i % 4 + 1, mm = co.fy.end_month + 3 * n;
    var yr = y - 1 + Math.floor((mm - 1) / 12), mo = (mm - 1) % 12 + 1;
    return Date.UTC(yr, mo, 0);
  }
  function qStart(co, q) { return qEnd(co, qs(qi(q) - 1)) + DAY; }
  function qMonths(co, q) { var a = new Date(qStart(co, q)), b = new Date(qEnd(co, q)); return String(a.getUTCFullYear()).slice(2) + "." + (a.getUTCMonth() + 1) + "~" + (b.getUTCMonth() + 1); }

  /* ---------- 지표 계산 ---------- */
  function sm(co, k) {   // 시리즈 → {분기: {v, ref, p, note}}
    co._m = co._m || {};
    if (!co._m[k]) {
      var m = {}, s = co.series[k];
      (s ? s.pts : []).forEach(function (p) { m[p[0]] = { v: p[1], ref: p[2], p: p[3], note: p[4] }; });
      co._m[k] = m;
    }
    return co._m[k];
  }
  function sv(co, k, q) { var r = sm(co, k)[q]; return r ? r.v : null; }
  function yoy(co, k, q) { var a = sv(co, k, q), b = sv(co, k, qs(qi(q) - 4)); return a != null && b ? (a / b - 1) * 100 : null; }
  function ph(co, q) {   // 인당 월매출(만엔) = 분기 매출 ÷ 평균 컨설턴트 ÷ 3
    var s = sv(co, "sales", q), a = sv(co, "cons", q), b = sv(co, "cons", qs(qi(q) - 1));
    return s != null && a && b ? s * 1e4 / ((a + b) / 2) / 3 : null;
  }
  function estQ(co, q) {   // 인원 기반 추정 매출 = 직전 분기말 인원 × 직전 분기 인당 월매출 × 3
    var p = qs(qi(q) - 1), c = sv(co, "cons", p), h = ph(co, p);
    return c && h ? c * h * 3 / 1e4 : null;
  }
  function qsOf(co, k) { return co.series[k] ? co.series[k].pts.map(function (p) { return p[0]; }) : []; }
  function lastQ(co, k) { var a = qsOf(co, k); return a[a.length - 1]; }
  function model(co) {   // 백테스트 + 다음 분기 추정
    if (co._model) return co._model;
    var rows = [];
    qsOf(co, "sales").forEach(function (q) { var e = estQ(co, q), a = sv(co, "sales", q); if (e && a != null) rows.push({ q: q, est: e, act: a, err: (a / e - 1) * 100 }); });
    var errs = rows.map(function (r) { return r.err; });
    var mean = errs.length ? errs.reduce(function (s, x) { return s + x; }, 0) / errs.length : 0;
    var nq = qs(qi(lastQ(co, "sales")) + 1), ne = estQ(co, nq);
    co._model = { rows: rows, mean: mean, min: Math.min.apply(null, errs), max: Math.max.apply(null, errs), nq: nq, est: ne, adj: ne ? ne * (1 + mean / 100) : null };
    return co._model;
  }
  function refUrl(co, id, p) {
    var r = co.refs[id]; if (!r) return null;
    var u = r.local ? r.local : r.doc ? co.ir.tdnet + r.doc + ".pdf" : null;
    return u ? u + (p ? "#page=" + p : "") : null;
  }
  function refChip(co, id, p, label) {
    var r = co.refs[id]; if (!r) return "";
    var u = refUrl(co, id, p);
    var t = esc(label || (md(tOf(r.date)) + " " + (r.t.length > 18 ? r.t.slice(0, 18) + "…" : r.t))) + (p ? " · p." + p : "");
    return u ? '<a class="chip" href="' + esc(u) + '" target="_blank" rel="noopener" title="' + esc(r.t) + '">' + t + " ↗</a>" : '<span class="chip' + (r.check ? " gold" : "") + '" title="' + esc(r.t) + '">' + t + (r.check ? " · 확인 필요" : "") + "</span>";
  }

  /* 메인 차트에 올릴 지표 목록 — 2단계 리포트 지표가 앞 */
  function chips(co) {
    if (co._chips) return co._chips;
    var L = [], isInd = {};
    co.indicators.forEach(function (d) { isInd[d.series] = d.rank; });
    var g = co.guide || {}, m = model(co);
    function add(o) { o.rank = isInd[o.k] || null; L.push(o); }
    if (co.series.cons) add({ k: "cons", t: "컨설턴트 수", u: "명", val: function (q) { return sv(co, "cons", q); }, est: g.cons ? { q: g.cons.q, v: (g.cons.lo + g.cons.hi) / 2, lo: g.cons.lo, hi: g.cons.hi, lab: nf(g.cons.lo) + "~" + nf(g.cons.hi) + " 전망" } : null });
    if (co.series.sga) add({ k: "sga", t: "판관비 YoY", u: "%", val: function (q) { return yoy(co, "sga", q); } });
    if (co.series.cons && co.series.sales) {
      var ind = co.indicators.filter(function (d) { return d.series === "ph"; })[0];
      add({ k: "ph", t: "인당 월매출", u: "만엔", val: function (q) { return ph(co, q); }, est: ind && ind.rule && ind.rule.line ? { q: m.nq, v: ind.rule.line, lab: "기준 " + ind.rule.line } : null });
    }
    if (co.series.emp) add({ k: "emp", t: "총사원 수", u: "명", val: function (q) { return sv(co, "emp", q); }, est: g.emp ? { q: g.emp.q, v: g.emp.lo, lab: "약 " + nf(g.emp.lo) + " 전망" } : null });
    if (co.series.hire) add({ k: "hire", t: "중도 채용", u: "명", val: function (q) { return sv(co, "hire", q); } });
    if (co.series.sales) add({ k: "sales", t: "매출", u: "억엔", val: function (q) { return sv(co, "sales", q); }, est: m.adj ? { q: m.nq, v: m.adj, lo: m.est, hi: m.adj, lab: "추정 " + nf(m.adj, 0) } : null });
    L.sort(function (a, b) { return (a.rank || 9) - (b.rank || 9); });
    co._chips = L;
    return L;
  }
  function chipQs(co, ch) {   // 그 지표에 값이 있는 분기
    var src = ch.k === "ph" || ch.k === "sga" ? "sales" : ch.k;
    return qsOf(co, src === "sga" ? "sga" : src).filter(function (q) { return ch.val(q) != null; });
  }

  /* ---------- 주가 ---------- */
  function loadPx(c) {
    if (S.px[c]) return Promise.resolve(S.px[c]);
    return getJSON("data/jp/px/" + c + ".json").then(function (rows) {
      S.px[c] = rows.filter(function (r) { return r[4] != null; }).map(function (r) { return { t: tOf(r[0]), o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }; });
      return S.px[c];
    }).catch(function () { S.px[c] = []; return []; });
  }
  function weekly(rows) {
    var out = [], cur = null, key = null;
    rows.forEach(function (r) {
      var k = Math.floor((r.t / DAY + 3) / 7);
      if (k !== key) { if (cur) out.push(cur); cur = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v, t1: r.t }; key = k; }
      else { cur.h = Math.max(cur.h, r.h); cur.l = Math.min(cur.l, r.l); cur.c = r.c; cur.v += r.v; cur.t1 = r.t; }
    });
    if (cur) out.push(cur);
    return out;
  }
  function closeOn(px, t) { var r = null; for (var i = 0; i < px.length && px[i].t <= t; i++) r = i; return r; }
  function reaction(px, rel) {   // 15:30 발표 → 발표일 종가 대비 다음 거래일 종가
    var i = closeOn(px, tOf(rel));
    if (i == null || i + 1 >= px.length || px[i].t < tOf(rel) - 5 * DAY) return null;
    return (px[i + 1].c / px[i].c - 1) * 100;
  }
  function quote(c) {
    var px = S.px[c] || []; if (!px.length) return null;
    var L = px[px.length - 1], P = px[px.length - 2] || L;
    var yr = px.filter(function (r) { return r.t >= L.t - 365 * DAY; });
    var hi = Math.max.apply(null, yr.map(function (r) { return r.h; })), lo = Math.min.apply(null, yr.map(function (r) { return r.l; }));
    var y1 = yr[0];
    var sc = S.scr && S.scr.items && S.scr.items[c], k = sc && sc.px ? L.c / sc.px : 1;
    return { last: L.c, t: L.t, chg: (L.c / P.c - 1) * 100, hi: hi, lo: lo, y1: y1 ? (L.c / y1.c - 1) * 100 : null, mc: sc ? sc.mc * k : null, per: sc && sc.per ? sc.per * k : null };
  }

  /* ---------- 등장 효과 · 숫자 올리기 ---------- */
  var PEND = [], pT = null;
  function revealCheck() {
    var H = window.innerHeight || 800;
    PEND = PEND.filter(function (e) {
      if (!e.isConnected) return false;
      var r = e.getBoundingClientRect();
      if (r.top < H * 0.94 && r.bottom > -40) { e.classList.add("in"); if (e.hasAttribute("data-lazy")) lazyRun(e); return false; }
      return true;
    });
  }
  function reveal(root) {   // 화면에 들어오면 나타남(스크롤 위치로 직접 판정 — 백그라운드 탭에서도 동작)
    var list = Array.prototype.slice.call(root.querySelectorAll(".rv, [data-lazy]"));
    if (REDUCE) { list.forEach(function (e) { e.classList.add("in"); if (e.hasAttribute("data-lazy")) lazyRun(e); }); return; }
    var k = 0;
    list.forEach(function (e) { var r = e.getBoundingClientRect(); if (r.top < (window.innerHeight || 800)) e.style.transitionDelay = Math.min(k++, 8) * 45 + "ms"; });
    PEND = list; revealCheck();
  }
  window.addEventListener("scroll", function () { if (!pT) pT = setTimeout(function () { pT = null; revealCheck(); }, 60); }, { passive: true });
  var LAZY = {};
  function lazyRun(e) { var f = LAZY[e.getAttribute("data-lazy")]; if (f && !e._done) { e._done = 1; f(e); } }
  function countUp(root) {
    root.querySelectorAll("[data-count]").forEach(function (e) {
      var to = +e.getAttribute("data-count"), d = +(e.getAttribute("data-d") || 0), t0 = null, from = to * 0.82;
      if (REDUCE) { e.textContent = nf(to, d); return; }
      function step(ts) { if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / 900), k = 1 - Math.pow(1 - p, 3); e.textContent = nf(from + (to - from) * k, d); if (p < 1) requestAnimationFrame(step); }
      requestAnimationFrame(step);
    });
  }
  function animate(svg) {
    if (REDUCE) return;
    svg.classList.add("anim");
    svg.querySelectorAll(".draw").forEach(function (p) { try { var L = Math.ceil(p.getTotalLength()); p.style.setProperty("--len", L); } catch (e) {} });
    svg.querySelectorAll(".grow").forEach(function (b, i) { b.style.animationDelay = Math.min(i * 35, 700) + "ms"; });
    setTimeout(function () { svg.classList.remove("anim"); }, 2200);
  }

  /* ---------- 툴팁 ---------- */
  function showTip(html, ev) {
    tip.innerHTML = html; tip.classList.add("on");
    var w = tip.offsetWidth, h = tip.offsetHeight, x = ev.clientX + 16, y = ev.clientY + 14;
    if (x + w > innerWidth - 8) x = ev.clientX - w - 16;
    if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(60, y) + "px";
  }
  function hideTip() { tip.classList.remove("on"); }
  function row(k, v, cls) { return '<div class="row"><span>' + esc(k) + "</span><b" + (cls ? ' class="' + cls + '"' : "") + ">" + v + "</b></div>"; }

  /* ---------- 사이드 트리 ---------- */
  function renderTree(active) {
    var q = (document.getElementById("q").value || "").trim().toLowerCase();
    var h = S.idx.tree.map(function (g) {
      var kids = g.kids.map(function (k) {
        var on = active && active.sec === g.id + "/" + k.id;
        var cos = k.cos.filter(function (c) { var o = S.idx.cos[c]; return !q || (o.n + o.jp + c).toLowerCase().indexOf(q) >= 0; });
        if (q && !cos.length) return "";
        return '<a class="tsub' + (k.soon ? " soon" : "") + (on && !active.c ? " on" : "") + '" href="#s/' + g.id + "/" + k.id + '">' + esc(k.n) + (k.cos.length ? "<small>" + k.cos.length + "</small>" : "") + "</a>" +
          cos.map(function (c) {
            var co = S.co[c], d = co ? dday(co.next.date) : null;
            return '<a class="tco' + (active && active.c === c ? " on" : "") + '" href="#c/' + c + '"><span>' + esc(S.idx.cos[c].n) + "</span>" + (d != null && d >= 0 ? '<span class="dd">D-' + d + "</span>" : "") + '<span class="mono">' + c + "</span></a>";
          }).join("");
      }).join("");
      if (q && !kids) return "";
      return '<div class="tg"><div class="tg-h"><b>' + esc(g.n) + "</b><span>" + esc(g.en) + "</span></div>" + kids + "</div>";
    }).join("");
    document.getElementById("tree").innerHTML = h || '<p class="hint">맞는 기업이 없습니다.</p>';
  }

  /* ---------- 홈 ---------- */
  function viewHome() {
    var cos = Object.keys(S.co).map(function (c) { return S.co[c]; });
    var nInd = cos.reduce(function (s, c) { return s + c.indicators.length; }, 0);
    var nPts = cos.reduce(function (s, c) { return s + Object.keys(c.series).reduce(function (a, k) { return a + c.series[k].pts.length; }, 0); }, 0);
    var up = cos.slice().sort(function (a, b) { return tOf(a.next.date) - tOf(b.next.date); });
    var nSec = S.idx.tree.reduce(function (s, g) { return s + g.kids.filter(function (k) { return k.cos.length; }).length; }, 0);
    main.innerHTML =
      '<section class="home-hero rv"><span class="eyebrow">LEADING INDICATORS · JAPAN</span>' +
      "<h1>실적 전에 먼저 움직이는 숫자를<br><em>기업별로 매핑하고 주가와 겹쳐 본다</em></h1>" +
      "<p>2단계 리포트에서 고른 선행지표를 분기마다 원문(결산 설명자료·단신)에서 가져와 쌓습니다. 값마다 근거 문서와 쪽을 붙여 두어, 다음 실적 발표 전에 무엇을 확인하면 되는지 한 화면에서 봅니다.</p>" +
      '<div class="hstats"><div class="hstat"><b class="mono" data-count="' + cos.length + '">0</b><span>추적 기업</span></div><div class="hstat"><b class="mono" data-count="' + nInd + '">0</b><span>리포트 선행지표</span></div><div class="hstat"><b class="mono" data-count="' + nPts + '">0</b><span>출처 붙은 데이터 점</span></div><div class="hstat"><b class="mono" data-count="' + nSec + '">0</b><span>세부 섹터</span></div></div>' +
      '<div class="flow"><b>2단계 리포트</b><i>→</i><b>선행지표 선정</b><i>→</i><b>원문 값 매핑</b><i>→</i><b>주가와 겹쳐 보기</b><i>→</i><b>다음 실적 전 체크</b></div></section>' +
      '<div class="sec-t rv"><span class="n">01</span><h2>다가오는 체크포인트</h2><p>다음 실적 발표가 가까운 순서</p></div>' +
      '<div class="timeline">' + up.map(function (co) {
        var d = dday(co.next.date), q = quote(co.c);
        return '<a class="tl rv" href="#c/' + co.c + '"><div class="d"><b>' + (d >= 0 ? "D-" + d : "발표") + "</b><span>" + md(tOf(co.next.date)) + (co.next.fixed ? "" : " 예상") + "</span></div>" +
          "<div><h4>" + esc(co.n) + ' <span class="mono" style-none>' + "</span><small class=\"mono\"> " + co.c + "</small> · " + esc(co.next.q) + " (" + esc(co.next.period) + ")</h4><p>" + co.indicators.map(function (i) { return esc(i.t); }).join(" · ") + "</p></div>" +
          '<div class="ichips">' + (q ? '<span class="chip ' + (q.chg >= 0 ? "" : "") + '">' + nf(q.last) + '엔 <b class="' + ud(q.chg) + '">' + pct(q.chg) + "</b></span>" : "") + "</div></a>";
      }).join("") + "</div>" +
      '<div class="sec-t rv"><span class="n">02</span><h2>섹터</h2><p>2단계 리포트로 peer 를 확인한 뒤 세부 섹터로 나눕니다</p></div>' +
      '<div class="secgrid">' + S.idx.tree.map(function (g) {
        return '<div class="sbox rv"><span class="en">' + esc(g.en) + "</span><h3>" + esc(g.n) + "</h3><ul>" + g.kids.map(function (k) {
          return "<li>" + (k.cos.length ? '<a href="#s/' + g.id + "/" + k.id + '"><span>' + esc(k.n) + '</span><b class="mono">' + k.cos.length + "</b></a>" : "<span>" + esc(k.n) + "<em>준비 중</em></span>") + "</li>";
        }).join("") + "</ul></div>";
      }).join("") + "</div>";
    main.querySelectorAll("[style-none]").forEach(function (e) { e.removeAttribute("style-none"); });
    reveal(main); countUp(main);
  }

  /* ---------- 섹터 ---------- */
  function peerRows(cos) {
    return cos.map(function (co) {
      var lq = lastQ(co, "sales"), m = model(co), q = quote(co.c), cq = lastQ(co, "cons");
      return { co: co, lq: lq, sy: yoy(co, "sales", lq), cy: yoy(co, "cons", cq), cons: sv(co, "cons", cq), cq: cq, ph: ph(co, lq), phy: (function () { var a = ph(co, lq), b = ph(co, qs(qi(lq) - 4)); return a && b ? (a / b - 1) * 100 : null; })(), m: m, q: q, d: dday(co.next.date) };
    });
  }
  function peerTable(cos, cur) {
    var R = peerRows(cos);
    return '<div class="tw"><table class="cmp"><thead><tr><th>기업</th><th>분기말 컨설턴트</th><th>인원 YoY</th><th>매출 YoY</th><th>인당 월매출</th><th>다음 분기 인원 기반 추정</th><th>1년 주가</th><th>다음 실적</th></tr></thead><tbody>' +
      R.map(function (r) {
        return "<tr" + (cur === r.co.c ? ' class="cur"' : "") + '><td><a href="#c/' + r.co.c + '"><b>' + esc(r.co.n) + '</b></a> <span class="mono">' + r.co.c + "</span><small>" + esc(r.co.fy.label) + "</small></td>" +
          '<td class="mono">' + nf(r.cons) + "<small>" + r.cq + "</small></td>" +
          '<td class="mono ' + ud(r.cy) + '">' + pct(r.cy) + '</td><td class="mono ' + ud(r.sy) + '">' + pct(r.sy) + "<small>" + r.lq + "</small></td>" +
          '<td class="mono">' + nf(r.ph, 1) + "만엔<small>YoY " + pct(r.phy) + "</small></td>" +
          '<td class="mono">' + nf(r.m.adj, 1) + "억엔<small>" + r.m.nq + " · 오차 보정 " + pct(r.m.mean) + "</small></td>" +
          '<td class="mono ' + ud(r.q && r.q.y1) + '">' + pct(r.q && r.q.y1) + "</td>" +
          '<td class="mono">' + (r.d >= 0 ? "D-" + r.d : "—") + "<small>" + md(tOf(r.co.next.date)) + (r.co.next.fixed ? "" : " 예상") + "</small></td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  function viewSector(gid, kid) {
    var g = S.idx.tree.filter(function (x) { return x.id === gid; })[0], k = g && g.kids.filter(function (x) { return x.id === kid; })[0];
    if (!k) return viewHome();
    var cos = k.cos.map(function (c) { return S.co[c]; }).filter(Boolean);
    main.innerHTML = '<div class="crumb rv"><a href="#">선행지표</a><i>›</i><span>' + esc(g.n) + "</span><i>›</i><b>" + esc(k.n) + "</b></div>" +
      '<header class="sec-head rv"><span class="eyebrow">' + esc(g.en) + " · PEER GROUP</span><h1>" + esc(k.n) + "</h1><p>" + esc(k.desc || "") + "</p></header>" +
      '<div class="pgrid">' + cos.map(function (co) {
        var q = quote(co.c), m = model(co);
        return '<a class="card pc rv" href="#c/' + co.c + '"><div class="pc-top"><div><h3>' + esc(co.n) + '</h3><span class="jp">' + esc(co.jp) + " · " + co.c + " · " + esc(co.market) + "</span></div>" +
          (q ? '<div class="px"><b>' + nf(q.last) + '</b><span class="mono ' + ud(q.chg) + '">' + pct(q.chg) + "</span></div>" : "") + "</div>" +
          '<div class="pc-mini" data-lazy="mini:' + co.c + '"></div>' +
          '<div class="pc-kv"><div><span>분기말 컨설턴트</span><b>' + nf(sv(co, "cons", lastQ(co, "cons"))) + '</b></div><div><span>인원 YoY</span><b class="' + ud(yoy(co, "cons", lastQ(co, "cons"))) + '">' + pct(yoy(co, "cons", lastQ(co, "cons"))) + "</b></div><div><span>다음 실적</span><b>D-" + dday(co.next.date) + "</b></div></div></a>";
      }).join("") + "</div>" +
      '<div class="sec-t rv"><span class="n">PEER</span><h2>같은 기준으로 나란히</h2><p>인원·인당 월매출·추정은 모두 같은 식으로 계산</p></div>' +
      '<div class="card rv"><div class="card-b">' + peerTable(cos) + '<p class="hint">인당 월매출 = 분기 매출 ÷ (전 분기말+이번 분기말 컨설턴트)/2 ÷ 3. 인원 기반 추정 = 직전 분기말 인원 × 직전 분기 인당 월매출 × 3, 과거 분기 평균 오차만큼 보정(계산).</p></div></div>';
    cos.forEach(function (co) { LAZY["mini:" + co.c] = function (host) { drawMini(co, host); }; });
    reveal(main);
  }
  function drawMini(co, host) {   // 1년 주가 선 + 컨설턴트 수 막대
    var px = S.px[co.c] || []; if (!px.length) return;
    var W = host.clientWidth || 360, H = 110, L = px[px.length - 1].t, F = L - 365 * DAY;
    var rows = px.filter(function (r) { return r.t >= F; });
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none" });
    host.innerHTML = ""; host.appendChild(svg);
    var x = function (t) { return (t - F) / (L - F) * W; };
    var qq = qsOf(co, "cons").filter(function (q) { return qEnd(co, q) >= F; });
    var mx = Math.max.apply(null, qq.map(function (q) { return sv(co, "cons", q); }));
    var defs = el("defs", {}, svg), gr = el("linearGradient", { id: "gm" + co.c, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "var(--ind)", "stop-opacity": ".55" }, gr); el("stop", { offset: "1", "stop-color": "var(--ind)", "stop-opacity": ".08" }, gr);
    var gb = el("g", {}, svg);
    qq.forEach(function (q) {
      var a = Math.max(0, x(qStart(co, q))), b = Math.min(W, x(qEnd(co, q))), v = sv(co, "cons", q), h = v / mx * 42;
      if (b - a > 4) el("rect", { x: a + 3, y: H - h, width: b - a - 6, height: h, rx: 3, fill: "url(#gm" + co.c + ")", "class": "grow" }, gb);
    });
    var lo = Math.min.apply(null, rows.map(function (r) { return r.c; })), hi = Math.max.apply(null, rows.map(function (r) { return r.c; }));
    var y = function (v) { return 6 + (1 - (v - lo) / (hi - lo || 1)) * (H - 40); };
    var d = rows.map(function (r, i) { return (i ? "L" : "M") + x(r.t).toFixed(1) + "," + y(r.c).toFixed(1); }).join("");
    el("path", { d: d, "class": "pline draw", "vector-effect": "non-scaling-stroke" }, svg);
    animate(svg);
  }

  /* ---------- 기업 ---------- */
  function viewCompany(c) {
    var co = S.co[c]; if (!co) return viewHome();
    var g = co.sec.split("/"), G = S.idx.tree.filter(function (x) { return x.id === g[0]; })[0], K = G.kids.filter(function (x) { return x.id === g[1]; })[0];
    var q = quote(c), m = model(co), d = dday(co.next.date);
    var st = S.st[c] = S.st[c] || { chip: chips(co)[0].k, mode: "candle", range: "1Y", rel: true };
    var ringC = 2 * Math.PI * 19, ringP = Math.max(0, Math.min(1, 1 - d / 92));
    var peers = K.cos.map(function (x) { return S.co[x]; }).filter(Boolean);

    var hero = '<div class="crumb rv"><a href="#">선행지표</a><i>›</i><span>' + esc(G.n) + '</span><i>›</i><a href="#s/' + co.sec + '">' + esc(K.n) + "</a><i>›</i><b>" + esc(co.n) + "</b></div>" +
      '<section class="hero rv"><div><span class="eyebrow">' + esc(co.en.toUpperCase()) + " · " + c + " · TSE " + esc(co.market) + "</span>" +
      "<h1>" + esc(co.n) + '<span class="jp">' + esc(co.jp) + "</span></h1>" +
      '<div class="codes"><span class="chip">' + esc(co.fy.label) + '</span><span class="chip acc">' + esc(K.n) + "</span>" + co.tags.map(function (t) { return '<span class="chip">' + esc(t) + "</span>"; }).join("") + "</div>" +
      '<p class="about">' + esc(co.about) + '</p><div class="thesis">' + esc(co.thesis) + "</div></div>" +
      '<div class="qbox">' + (q ? '<div class="price"><b data-count="' + q.last + '">' + nf(q.last) + '</b><span class="chg ' + ud(q.chg) + '">' + pct(q.chg, 2) + '</span><small>엔 · ' + md(q.t) + " 종가 · 1년 " + pct(q.y1) + "</small></div>" +
        '<div class="range52"><div class="bar"><i id="r52"></i></div><div class="lab"><span>52주 저가 ' + nf(q.lo) + "</span><span>고가 " + nf(q.hi) + "</span></div></div>" +
        '<div class="qv"><span>시가총액</span><b>' + nf(q.mc) + "</b><small>억엔</small></div>" +
        '<div class="qv"><span>PER(회사 예상)</span><b>' + nf(q.per, 1) + "</b><small>배</small></div>" : "") +
      '<div class="qv next" style-none><svg class="ring" viewBox="0 0 46 46"><circle class="bgc" cx="23" cy="23" r="19"/><circle class="fgc" id="ringfg" cx="23" cy="23" r="19" transform="rotate(-90 23 23)" stroke-dasharray="' + ringC.toFixed(1) + '" stroke-dashoffset="' + ringC.toFixed(1) + '"/></svg>' +
      "<div><span>다음 실적 · " + esc(co.next.q) + " (" + esc(co.next.period) + ")</span><b>D-" + d + "</b><small>" + md(tOf(co.next.date)) + (co.next.fixed ? " 확정" : " 예상") + "</small></div></div>" +
      '<div class="qv"><span>인원 기반 ' + m.nq + " 매출 추정</span><b>" + nf(m.adj, 1) + "</b><small>억엔 · 보정 " + pct(m.mean) + "</small></div>" +
      "</div></section>";

    var cp = '<div class="sec-t rv"><span class="n">01</span><h2>다음 실적 체크포인트</h2><p>2단계 리포트의 선행지표 — 발표 전에 숫자로 확인할 것</p></div><div class="cp-grid">' +
      co.indicators.map(function (ind) { return checkCard(co, ind, d); }).join("") + "</div>";

    var chartCard = '<div class="sec-t rv"><span class="n">02</span><h2>선행지표 × 주가</h2><p>분기 지표를 주가 아래 띠에 겹쳐 보기 · 금색 점선 = 실적 발표일과 다음 날 주가 반응</p></div>' +
      '<section class="card rv" id="mc"><div class="card-h"><div class="ichips" id="ichips">' + chips(co).map(function (ch) {
        return '<button type="button" class="ichip" data-ch="' + ch.k + '" aria-pressed="' + (st.chip === ch.k) + '"><i class="dot"></i>' + esc(ch.t) + (ch.rank ? "<small>리포트 지표 " + ch.rank + "</small>" : "") + "</button>";
      }).join("") + '</div><span class="sp"></span>' +
      '<div class="ctl"><div class="seg" id="pmode" role="group" aria-label="주가 표시">' +
      '<button data-v="candle" aria-pressed="' + (st.mode === "candle") + '"><svg viewBox="0 0 14 14"><path d="M4 1v12M10 3v9" stroke="currentColor"/><rect x="2.5" y="4" width="3" height="5" fill="currentColor"/><rect x="8.5" y="5" width="3" height="4" fill="none" stroke="currentColor"/></svg>캔들</button>' +
      '<button data-v="ohlc" aria-pressed="' + (st.mode === "ohlc") + '"><svg viewBox="0 0 14 14"><path d="M4 2v10M2 5h2M4 9h2M10 3v9M8 8h2M10 5h2" stroke="currentColor" fill="none"/></svg>막대</button>' +
      '<button data-v="line" aria-pressed="' + (st.mode === "line") + '"><svg viewBox="0 0 14 14"><path d="M1 11l4-4 3 2 5-6" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>선</button></div>' +
      '<div class="seg" id="prange" role="group" aria-label="기간">' + ["6M", "1Y", "2Y", "3Y", "ALL"].map(function (r) { return '<button data-v="' + r + '" aria-pressed="' + (st.range === r) + '">' + (r === "ALL" ? "전체" : r) + "</button>"; }).join("") + "</div>" +
      '<div class="seg" id="prel"><button data-v="rel" aria-pressed="' + st.rel + '">발표일</button></div></div></div>' +
      '<div class="card-b"><div class="chart-wrap" id="cw"></div><div class="nav-wrap" id="nw"></div>' +
      '<div class="legend"><span><i class="lg-up"></i>상승</span><span><i class="lg-dn"></i>하락</span><span><i class="lg-ind"></i><b id="lgname"></b> (분기, 띠 안 막대)</span><span><i class="lg-est"></i>회사 전망·추정</span><span><i class="lg-rel"></i>실적 발표일</span></div>' +
      '<p class="hint">아래 작은 차트를 끌어 기간을 고르고, 양 끝 손잡이로 넓히거나 줄입니다. 차트 위에 마우스를 올리면 그날 주가와 그때까지 발표된 지표 값이 같이 보입니다. 1년 넘는 기간은 주봉.</p></div></section>';

    var detail = '<div class="sec-t rv"><span class="n">03</span><h2>선행지표 상세</h2><p>2단계 리포트 「선행지표」 그대로 — 왜 보나 · 근거 · 트래킹 · 출처</p></div>' +
      co.indicators.map(function (ind) { return indCard(co, ind); }).join("");

    var kpi = '<div class="sec-t rv"><span class="n">04</span><h2>회사 KPI 가이던스</h2><p>참고 — ' + esc(co.kpi.note) + "</p></div>" + kpiBlock(co);

    var peer = peers.length > 1 ? '<div class="sec-t rv"><span class="n">05</span><h2>같은 섹터 peer</h2><p>' + esc(K.n) + '</p></div><div class="card rv"><div class="card-b">' + peerTable(peers, c) + "</div></div>" : "";

    var rep = '<div class="sec-t rv"><span class="n">06</span><h2>2단계 리포트</h2><p>선행지표를 고른 원본</p></div>' +
      '<a class="card rep rv" href="' + esc(co.report.html) + '" target="_blank" rel="noopener"><span class="ic">2단계</span><div><h3>' + esc(co.report.title) + ' <small class="mono">' + esc(co.report.written) + "</small></h3><p>" + esc(co.report.verdict) + '</p></div><span class="go">리포트 열기 ↗</span></a>';

    var ir = '<div class="sec-t rv"><span class="n">07</span><h2>IR 자료</h2><p>모아 둔 결산 설명자료·단신 — 지표를 가져온 쪽은 아래 미리보기</p></div>' + irBlock(co);

    var map = '<div class="sec-t rv"><span class="n">08</span><h2>데이터 출처 매핑</h2><p>자동 업데이트할 때 어디서 무엇을 읽는지</p></div>' + mapBlock(co) +
      '<div class="sec-t rv"><span class="n">09</span><h2>수정 이력</h2><p>나중에 텔레그램으로 말한 수정이 여기에 쌓입니다</p></div><div class="card rv"><div class="card-b log">' +
      co.log.map(function (l) { return '<div><span class="d">' + esc(l.d) + '</span><span class="by">' + esc(l.by) + "</span><span>" + esc(l.t) + "</span></div>"; }).join("") +
      '<div class="tg"><span class="d">—</span><span class="by">텔레그램</span><span>예: 「베이커런트 컨설턴트 3Q 7,050명으로」 → 원장 수정 · 출처 기록 · 이 화면 자동 반영 (준비 중)</span></div></div></div>';

    main.innerHTML = hero + cp + chartCard + detail + kpi + peer + rep + ir + map;
    main.querySelectorAll("[style-none]").forEach(function (e) { e.removeAttribute("style-none"); });

    // 히어로 효과
    if (q) setTimeout(function () { var r = document.getElementById("r52"); if (r) r.style.left = ((q.last - q.lo) / (q.hi - q.lo || 1) * 100).toFixed(1) + "%"; }, 120);
    setTimeout(function () { var f = document.getElementById("ringfg"); if (f) f.style.strokeDashoffset = (ringC * (1 - ringP)).toFixed(1); }, 200);
    countUp(main);

    // 메인 차트
    setRange(co, st.range);
    drawMain(co, true);
    bindMain(co);
    co.indicators.forEach(function (ind) { LAZY["ind:" + c + ":" + ind.id] = function (host) { drawInd(co, ind, host, true); }; });
    main.querySelectorAll("[data-pv]").forEach(function (b) { b.onclick = function () { openLb(b.getAttribute("data-pv"), b.getAttribute("data-cap")); }; });
    main.querySelectorAll("[data-shift]").forEach(function (b) {
      b.onclick = function () { var ind = co.indicators.filter(function (x) { return x.id === b.getAttribute("data-shift"); })[0]; ind._shift = +b.getAttribute("data-v"); b.parentNode.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); drawInd(co, ind, document.getElementById("ic-" + ind.id), true); };
    });
    reveal(main);
  }

  function checkCard(co, ind, d) {
    var s = ind.series, m = model(co), last, lastLab, tgt, tgtLab, meta;
    if (s === "cons") {
      var lq = lastQ(co, "cons"); last = nf(sv(co, "cons", lq)) + "명"; lastLab = lq + " 말 · YoY " + pct(yoy(co, "cons", lq));
      if (co.guide.cons) { tgt = nf(co.guide.cons.lo) + "~" + nf(co.guide.cons.hi) + "명"; tgtLab = co.guide.cons.q + " 회사 전망"; }
      else { tgt = nf(m.adj, 1) + "억엔"; tgtLab = m.nq + " 인원 기반 매출 추정(보정)"; }
    } else if (s === "sga") {
      var q2 = lastQ(co, "sga"); last = pct(yoy(co, "sga", q2)); lastLab = q2 + " 판관비 YoY (매출 " + pct(yoy(co, "sales", q2)) + ")";
      var opm = sv(co, "op", q2) / sv(co, "sales", q2) * 100; tgt = "OPM ≥ 35%"; tgtLab = "지금 " + nf(opm, 1) + "% · 판관비 YoY 수렴";
    } else if (s === "ph") {
      var q3 = lastQ(co, "sales"); last = nf(ph(co, q3), 1) + "만엔"; lastLab = q3 + " 인당 월매출";
      tgt = "≥ " + ind.rule.line + "만엔"; tgtLab = m.nq + " 확인 기준";
    }
    meta = esc(ind.rule.label);
    return '<div class="cp rv"><span class="st wait">발표 대기 · D-' + d + '</span><span class="r">리포트 선행지표 ' + ind.rank + "</span><h4>" + esc(ind.t) + "</h4>" +
      '<div class="vals"><div><b>' + last + '</b><div class="meta">' + esc(lastLab) + '</div></div><span class="arrow">→</span><div><span class="tgt">' + tgt + '</span><div class="meta">' + esc(tgtLab) + "</div></div></div>" +
      '<div class="meta">기준: ' + meta + "</div></div>";
  }

  function indCard(co, ind) {
    var s = co.series[ind.series] || (ind.series === "ph" ? { n: "인당 월매출", src: { doc: "계산", where: "매출 ÷ 평균 컨설턴트 수 ÷ 3", freq: "분기", auto: "자동", how: "매출·컨설턴트 수 원장에서 계산" } } : null);
    var m = model(co), extra = "";
    if (ind.model === "lastq") {
      var cs = co.consensus;
      extra = '<div class="est-box"><div><span>' + lastQ(co, "cons") + " 말 컨설턴트</span><b>" + nf(sv(co, "cons", lastQ(co, "cons"))) + "명</b></div>" +
        "<div><span>" + m.nq + " 인원 기반 추정</span><b>" + nf(m.est, 1) + '억</b></div><div class="hl"><span>과거 오차 ' + pct(m.mean) + " 보정</span><b>" + nf(m.adj, 1) + "억</b></div>" +
        (cs ? '<div class="cs"><span>' + cs.q + " 컨센서스</span><b>" + nf(cs.sales, 0) + "억</b></div>" : "") + "</div>";
    } else if (ind.model === "yoy") {
      extra = '<div class="seg" role="group" aria-label="판관비 시점"><button data-shift="' + ind.id + '" data-v="0" aria-pressed="true">같은 분기</button><button data-shift="' + ind.id + '" data-v="2" aria-pressed="false">판관비 2분기 뒤로 밀기</button></div>';
    }
    var srcRows = [];
    [ind.series, ind.vs, ind.series === "ph" || ind.model === "lastq" ? "sales" : null, ind.model === "lastq" ? "cons" : null].filter(function (k, i, a) { return k && a.indexOf(k) === i; }).forEach(function (k) {
      var se = co.series[k] || (k === "ph" ? s : null); if (!se) return;
      var lp = se.pts ? se.pts[se.pts.length - 1] : null;
      srcRows.push('<div class="sm"><span class="nm">' + esc(se.n) + '</span><span class="wh" title="' + esc(se.src.where) + '">' + esc(se.src.doc) + " — " + esc(se.src.where) + "</span>" + autoTag(se.src.auto) + "</div>" +
        (lp ? '<div class="sm"><span class="nm"></span><span class="wh">최근 값 ' + lp[0] + " " + auto(lp[1], se.unit) + se.unit.replace("억엔", "억엔") + "</span>" + refChip(co, lp[2], lp[3], "근거") + "</div>" : ""));
    });
    var pv = (co.ir.docs[0].hl || []).filter(function (h) { return ind.model === "ph" ? h.p === 5 || h.p === 14 : true; }).slice(0, 2);
    return '<section class="card ind-card rv"><div class="ind-l"><span class="ind-no"><b>' + ind.rank + "</b>LEADING INDICATOR</span><h3>" + esc(ind.t) + '</h3><span class="sub">' + esc(ind.sub) + "</span>" +
      "<dl><div><dt>왜 보나</dt><dd>" + esc(ind.why) + "</dd></div><div><dt>근거</dt><dd>" + esc(ind.evidence) + '</dd></div><div><dt>트래킹</dt><dd class="trk">' + esc(ind.track) + "</dd></div></dl>" +
      '<p class="from-rep">출처: <a href="' + esc(co.report.html) + '" target="_blank" rel="noopener">2단계 리포트 · 선행지표 ' + ind.rank + "</a> (" + esc(co.report.written) + ")</p></div>" +
      '<div class="ind-r"><h4>' + esc(indChartTitle(co, ind)) + "</h4>" + '<div class="chart-wrap" id="ic-' + ind.id + '" data-lazy="ind:' + co.c + ":" + ind.id + '"></div>' + extra +
      '<div class="srcmap">' + srcRows.join("") + "</div>" +
      (pv.length ? '<div class="pv">' + pv.map(function (h) { return '<button type="button" data-pv="' + esc(h.img) + '" data-cap="' + esc("p." + h.p + " · " + h.cap) + '"><img src="' + esc(h.img) + '" alt="" loading="lazy">원문 p.' + h.p + "</button>"; }).join("") + "</div>" : "") +
      "</div></section>";
  }
  function indChartTitle(co, ind) {
    if (ind.model === "lastq") return "분기말 인원으로 다음 분기 매출 맞추기 — 실제 매출(막대) vs 인원 기반 추정(점)";
    if (ind.model === "yoy") return "판관비 YoY vs 매출 YoY (%)";
    if (ind.model === "ph") return "인당 월매출(만엔/월) — 2Q 신입 투입 때 꺾임";
    return ind.t;
  }
  function autoTag(a) { return '<span class="auto ' + (a === "자동" ? "a" : a === "반자동" ? "s" : "m") + '">' + esc(a) + "</span>"; }

  function kpiBlock(co) {
    var k = co.kpi;
    if (k.rows[0] && k.rows[0].txt) {
      return '<div class="card rv"><div class="card-b"><div class="kpi-txt">' + k.rows.map(function (r) { return "<div><span>" + esc(r.k) + "</span><b>" + esc(r.txt) + "</b><div>" + refChip(co, r.ref, r.p, "원문") + "</div></div>"; }).join("") + "</div></div></div>";
    }
    var cols = []; k.rows.forEach(function (r) { (r.pts || []).forEach(function (p) { if (cols.indexOf(p[0]) < 0) cols.push(p[0]); }); });
    cols.sort(function (a, b) { return qi(a) - qi(b); });
    var gq = (k.rows.filter(function (r) { return r.guide; })[0] || {}).guide;
    var h = '<div class="card rv"><div class="card-b"><div class="tw"><table class="kt"><thead><tr><th>항목</th>' + cols.map(function (q) { return "<th>" + q + "</th>"; }).join("") + (gq ? '<th>' + gq.q + " 전망</th>" : "") + "</tr></thead><tbody>" +
      k.rows.map(function (r) {
        var m = {}; (r.pts || []).forEach(function (p) { m[p[0]] = p; });
        return "<tr><td>" + esc(r.k) + "</td>" + cols.map(function (q) { var p = m[q]; return "<td class=\"mono\">" + (p ? (r.unit === "%" ? pct(p[1]) : nf(p[1])) + (p[4] ? "<small>" + esc(p[4]) + "</small>" : "") : (r.k.indexOf("컨설턴트") >= 0 && sv(co, "cons", q) ? nf(sv(co, "cons", q)) : "—")) + "</td>"; }).join("") +
          (gq ? '<td class="g mono">' + (r.guide ? (r.unit === "%" ? "+" + r.guide.lo + "~" + r.guide.hi + "%" : nf(r.guide.lo) + (r.guide.hi !== r.guide.lo ? "~" + nf(r.guide.hi) : "")) + (r.guide.yoy ? "<small>" + esc(r.guide.yoy) + "</small>" : "") : "") + "</td>" : "") + "</tr>";
      }).join("") + "</tbody></table></div>";
    if (k.track && k.track.length) {
      h += '<div class="track">' + k.track.map(function (t) {
        var u = t.k.indexOf("YoY") >= 0 ? "%" : "명";
        return '<div><span class="q">' + t.q + "</span><span>" + esc(t.k) + " 전망 " + (u === "%" ? "+" + t.lo + "~" + t.hi + "%" : nf(t.lo) + "~" + nf(t.hi)) + " → 실제 <b class=\"mono\">" + (u === "%" ? "+" + t.act + "%" : nf(t.act)) + "</b>" + (t.memo ? ' <small class="chk">' + esc(t.memo) + "</small>" : "") + '</span><span class="st ' + (t.res === "하회" ? "bad" : "ok") + '">' + esc(t.res) + "</span>" + refChip(co, t.ref, t.p, "전망 원문") + "</div>";
      }).join("") + "</div>";
    }
    return h + '<p class="hint">회사가 낸 다음 분기 전망 vs 실제 — 전망을 넘겼는지가 다음 실적의 기대치를 정한다.</p></div></div>';
  }

  function irBlock(co) {
    var docs = co.ir.docs, top = docs[0];
    var g = '<div class="irg">' + docs.map(function (d) {
      var r = co.refs[d.ref], u = refUrl(co, d.ref);
      return '<a class="irc rv" href="' + esc(u) + '" target="_blank" rel="noopener"><div class="th' + (d.thumb ? "" : " none") + '">' + (d.thumb ? '<img src="' + esc(d.thumb) + '" alt="" loading="lazy">' : "PDF") + '<span class="kind chip ' + (d.kind === "설명자료" ? "acc" : "") + '">' + esc(d.kind) + "</span></div>" +
        '<div class="bd"><b>' + esc(r.t) + "</b><span>" + md(tOf(r.date)) + (d.pages ? " · " + d.pages + "쪽" : "") + (r.local ? " · 사이트 보관" : " · JPX 원문") + "</span></div></a>";
    }).join("") + "</div>";
    var hl = top.hl ? '<div class="hlrow">' + top.hl.map(function (h) { return '<button type="button" class="rv" data-pv="' + esc(h.img) + '" data-cap="' + esc("p." + h.p + " · " + h.cap) + '"><img src="' + esc(h.img) + '" alt="" loading="lazy"><span><b>p.' + h.p + "</b>" + esc(h.cap) + "</span></button>"; }).join("") + "</div>" : "";
    return g + hl + '<p class="hint">' + (co.ir.lib ? '회사 IR 자료실 <a href="' + esc(co.ir.lib) + '" target="_blank" rel="noopener">' + esc(co.ir.lib) + "</a> · " : "") + "TDnet 원문은 JPX 공식 아카이브로 연결됩니다.</p>";
  }

  function mapBlock(co) {
    var rows = Object.keys(co.series).map(function (k) {
      var s = co.series[k], lp = s.pts[s.pts.length - 1], chk = s.pts.some(function (p) { return co.refs[p[2]] && co.refs[p[2]].check; });
      var refs = []; s.pts.forEach(function (p) { if (refs.indexOf(p[2]) < 0) refs.push(p[2]); });
      return "<tr><td><b>" + esc(s.n) + "</b><span class=\"how\">" + esc(s.unit) + " · " + s.pts.length + "개 분기 " + s.pts[0][0] + "~" + lp[0] + "</span></td>" +
        "<td>" + esc(s.src.doc) + '<span class="how">' + esc(s.src.where) + "</span></td>" +
        "<td>" + (s.src.find ? '<span class="fd">' + esc(s.src.find) + "</span>" : "—") + "</td>" +
        "<td>" + esc(s.src.freq) + "</td><td>" + autoTag(s.src.auto) + '<span class="how">' + esc(s.src.how) + "</span></td>" +
        '<td class="v">' + auto(lp[1], s.unit) + '<span class="how">' + lp[0] + "</span></td>" +
        "<td>" + refs.length + "건" + (chk ? ' <span class="chk">· 원문 확인 필요</span>' : "") + "<div>" + refChip(co, lp[2], lp[3], "최근 근거") + "</div></td></tr>";
    });
    rows.push('<tr><td><b>인당 월매출</b><span class="how">만엔 · 계산</span></td><td>계산<span class="how">분기 매출 ÷ (전 분기말 + 이번 분기말 컨설턴트)/2 ÷ 3</span></td><td>—</td><td>분기</td><td>' + autoTag("자동") + '<span class="how">원장 갱신되면 화면에서 다시 계산</span></td><td class="v">—</td><td>—</td></tr>');
    rows.push('<tr><td><b>인원 기반 추정 매출</b><span class="how">억엔 · 계산</span></td><td>계산<span class="how">직전 분기말 인원 × 직전 분기 인당 월매출 × 3, 과거 평균 오차 보정</span></td><td>—</td><td>분기</td><td>' + autoTag("자동") + '</td><td class="v">' + nf(model(co).adj, 1) + '<span class="how">' + model(co).nq + "</span></td><td>—</td></tr>");
    rows.push('<tr><td><b>주가(일봉)</b><span class="how">엔 · 5년</span></td><td>야후 파이낸스 시세<span class="how">data/jp/px/' + co.c + '.json</span></td><td>—</td><td>매일 10:00 · 15:30</td><td>' + autoTag("자동") + '<span class="how">tools/build_px.py</span></td><td class="v">' + (quote(co.c) ? nf(quote(co.c).last) : "—") + "</td><td>—</td></tr>");
    if (co.consensus) rows.push('<tr><td><b>컨센서스 매출</b><span class="how">억엔</span></td><td>' + esc(co.refs[co.consensus.ref].t) + '</td><td>—</td><td>수시</td><td>' + autoTag("수동") + '<span class="how">jp_consensus 로 갱신 예정</span></td><td class="v">' + nf(co.consensus.sales, 0) + '<span class="how">' + co.consensus.q + "</span></td><td>—</td></tr>");
    return '<div class="card rv"><div class="card-b"><div class="tw"><table class="mt"><thead><tr><th>지표</th><th>원천 · 위치</th><th>찾는 말</th><th>주기</th><th>자동화</th><th>최근 값</th><th>근거</th></tr></thead><tbody>' + rows.join("") + "</tbody></table></div>" +
      '<p class="hint">자동 = 공시 숫자(XBRL)로 바로 갱신 · 반자동 = 설명자료 PDF에서 「찾는 말」로 뽑고 사람이 확인 · 수동 = 직접 입력. 값마다 공시 번호·쪽이 원장(data/jp/lead/' + co.c + ".json)에 붙어 있습니다.</p></div></div>";
  }

  /* ---------- 메인 차트 ---------- */
  function rangeDays(r) { return { "6M": 182, "1Y": 365, "2Y": 730, "3Y": 1095 }[r] || 99999; }
  function setRange(co, r) {
    var px = S.px[co.c] || [], st = S.st[co.c]; if (!px.length) return;
    st.range = r; st.to = px[px.length - 1].t; st.from = Math.max(px[0].t, st.to - rangeDays(r) * DAY);
  }
  function curChip(co) { var st = S.st[co.c]; return chips(co).filter(function (c) { return c.k === st.chip; })[0] || chips(co)[0]; }

  function drawMain(co, anim) {
    var host = document.getElementById("cw"); if (!host) return;
    var st = S.st[co.c], px = S.px[co.c] || [];
    if (!px.length) { host.innerHTML = '<div class="empty">주가 자료가 없습니다.</div>'; return; }
    var ch = curChip(co); document.getElementById("lgname").textContent = ch.t;
    var W = Math.max(320, host.clientWidth), H = W < 600 ? 360 : 440, pL = 6, pR = 64, pT = 34, pB = 24;
    var from = st.from, to = st.to, lastT = px[px.length - 1].t;
    var sub = px.filter(function (r) { return r.t >= from && r.t <= to; });
    var wk = (to - from) / DAY > 400;
    var bars = wk ? weekly(sub) : sub;
    var est = ch.est, estEnd = est ? qEnd(co, est.q) : null;
    var xEnd = to;
    var nrel = co.next ? tOf(co.next.date) : null, pq = co.next ? co.next.q : null;
    if (to >= lastT - 3 * DAY) {
      xEnd = to + (to - from) * 0.035;
      if (est && estEnd > to && estEnd - to < 160 * DAY) xEnd = Math.max(xEnd, estEnd + (to - from) * 0.02);
      if (nrel && nrel > to && nrel - to < 75 * DAY) xEnd = Math.max(xEnd, nrel + (to - from) * 0.03);
      if (pq && qEnd(co, pq) > to - 120 * DAY) xEnd = Math.max(xEnd, qEnd(co, pq) + (to - from) * 0.02);
    }
    var IW = W - pL - pR, bot = H - pB, PH = bot - pT;
    var x = function (t) { return pL + (t - from) / (xEnd - from) * IW; };
    var lo = Math.min.apply(null, bars.map(function (b) { return b.l; })), hi = Math.max.apply(null, bars.map(function (b) { return b.h; }));
    var padv = (hi - lo) * 0.06; lo -= padv; hi += padv;
    var pTop = pT + 4, pBot = bot - PH * 0.27;
    var y = function (v) { return pTop + (1 - (v - lo) / (hi - lo)) * (pBot - pTop); };
    var bandTop = bot - PH * 0.38, bandBot = bot - 2;

    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": co.n + " 주가와 " + ch.t });
    var defs = el("defs", {}, svg);
    var gi = el("linearGradient", { id: "gInd", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "var(--ind)", "stop-opacity": ".46" }, gi); el("stop", { offset: "1", "stop-color": "var(--ind)", "stop-opacity": ".05" }, gi);
    var ga = el("linearGradient", { id: "gArea", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "var(--acc)", "stop-opacity": ".28" }, ga); el("stop", { offset: "1", "stop-color": "var(--acc)", "stop-opacity": "0" }, ga);
    var hp = el("pattern", { id: "hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    el("rect", { width: 6, height: 6, fill: "var(--ind-soft)" }, hp); el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "var(--ind)", "stroke-width": 2, "stroke-opacity": ".55" }, hp);
    var cp = el("clipPath", { id: "clipP" }, defs); el("rect", { x: pL, y: 0, width: IW, height: H }, cp);

    // 격자 · 가격 축
    var gg = el("g", { "class": "g-grid" }, svg), gax = el("g", { "class": "g-ax" }, svg);
    var lastY = y(px.filter(function (r) { return r.t <= to; }).slice(-1)[0].c);
    nice(lo, hi, 5).forEach(function (v) { var yy = y(v); if (yy < pTop - 2 || yy > pBot + 2) return; el("line", { x1: pL, x2: pL + IW, y1: yy, y2: yy }, gg); if (Math.abs(yy - lastY) > 14) txt(gax, W - pR + 8, yy + 3.5, nf(v)); });
    // 시간 축
    var span = (xEnd - from) / DAY, stepM = span > 1500 ? 6 : span > 700 ? 3 : span > 300 ? 2 : 1;
    var d0 = new Date(from), mt = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1);
    for (; mt < xEnd; ) {
      var dm = new Date(mt), mo = dm.getUTCMonth();
      if (mo % stepM === 0) { var xx = x(mt); el("line", { x1: xx, x2: xx, y1: pT, y2: bot }, gg); txt(gax, xx, H - 6, mo === 0 ? String(dm.getUTCFullYear()) : (String(dm.getUTCFullYear()).slice(2) + "." + pad(mo + 1)), null, "middle"); }
      mt = Date.UTC(dm.getUTCFullYear(), mo + 1, 1);
    }
    var body = el("g", { "clip-path": "url(#clipP)" }, svg);

    // 지표 띠
    el("rect", { x: pL, y: bandTop, width: IW, height: bandBot - bandTop, "class": "ind-band" }, body);
    var qq = chipQs(co, ch).filter(function (q) { return qEnd(co, q) >= from && qStart(co, q) <= xEnd; });
    var vals = qq.map(function (q) { return ch.val(q); });
    if (est && estEnd >= from && estEnd <= xEnd + 90 * DAY) vals.push(est.hi || est.v);
    var vmax = Math.max.apply(null, vals.concat([0])), vmin = Math.min.apply(null, vals.concat([0]));
    var bh = function (v) { return (v - vmin) / ((vmax - vmin) || 1) * (bandBot - bandTop - 30); };
    var gI = el("g", {}, body), gL = el("g", {}, svg);
    var showLab = qq.length <= 14;
    qq.forEach(function (q, i) {
      var a = x(qStart(co, q)), b = x(qEnd(co, q)), w = b - a, v = ch.val(q), h = Math.max(1.5, bh(v));
      var r = el("rect", { x: a + w * 0.1, y: bandBot - h, width: Math.max(1, w * 0.8), height: h, rx: Math.min(4, w * 0.15), "class": "ibar grow" }, gI);
      r.dataset.q = q;
      var mid = a + w / 2, inside = mid > pL + 14 && mid < pL + IW - 10;
      if (inside && (showLab || i === qq.length - 1 || i % 2 === qq.length % 2)) txt(gL, mid, bandBot - h - 5, auto(v, ch.u), "ibar-lab fade");
      if (inside && w > 26) txt(gL, mid, bandBot - 4, q, "ibar-q");
    });
    if (est && estEnd >= from && qStart(co, est.q) <= xEnd) {
      var ea = x(qStart(co, est.q)), eb = x(estEnd), ew = eb - ea, eh = Math.max(2, bh(est.v));
      el("rect", { x: ea + ew * 0.1, y: bandBot - eh, width: ew * 0.8, height: eh, rx: 4, "class": "ibar-est grow" }, gI);
      if (est.lo != null && est.hi != null && est.hi !== est.lo) { var y1 = bandBot - bh(est.lo), y2 = bandBot - bh(est.hi); el("path", { d: "M" + (ea + ew * .3) + "," + y1 + "H" + (ea + ew * .7) + "M" + (ea + ew / 2) + "," + y1 + "V" + y2 + "M" + (ea + ew * .3) + "," + y2 + "H" + (ea + ew * .7), stroke: "var(--ind-2)", "stroke-width": 1.4, fill: "none" }, gL); }
      txt(gL, ea + ew / 2, bandBot - Math.max(eh, est.hi ? bh(est.hi) : 0) - 6, est.lab, "ibar-lab est fade");
      if (ew > 26) txt(gL, ea + ew / 2, bandBot - 4, est.q, "ibar-q");
    }

    if (pq && (!est || est.q !== pq) && ch.val(pq) == null && qEnd(co, pq) <= xEnd + 20 * DAY && qStart(co, pq) >= from) {
      var ga2 = x(qStart(co, pq)), gb2 = x(qEnd(co, pq)), gw = gb2 - ga2, lastV = qq.length ? ch.val(qq[qq.length - 1]) : null, gh = lastV != null ? Math.max(8, bh(lastV)) : 40;
      el("rect", { x: ga2 + gw * 0.1, y: bandBot - gh, width: gw * 0.8, height: gh, rx: 4, fill: "none", stroke: "var(--gold)", "stroke-dasharray": "4 3", "stroke-width": 1.2, "class": "fade" }, gI);
      txt(gL, ga2 + gw / 2, bandBot - gh / 2 + 4, "?", "ibar-lab cs");
      if (gw > 34) txt(gL, ga2 + gw / 2, bandBot - gh + 14, md(nrel).slice(3), "ibar-lab cs fade");
      if (gw > 26) txt(gL, ga2 + gw / 2, bandBot - 4, pq, "ibar-q");
    }
    // 실적 발표일
    if (st.rel) {
      var gr = el("g", { "class": "rel" }, svg);
      Object.keys(co.rel).forEach(function (q) {
        var t = tOf(co.rel[q]); if (t < from || t > xEnd) return;
        var xx = x(t), rx = reaction(px, co.rel[q]);
        el("line", { x1: xx, x2: xx, y1: pT - 6, y2: bot }, gr);
        el("rect", { x: xx - 19, y: 2, width: 38, height: 26, rx: 6 }, gr);
        txt(gr, xx, 13, q.slice(3));
        if (rx != null) txt(gr, xx, 24, pct(rx, 1).replace(".0%", "%"), "rx " + ud(rx));
      });
      if (co.next && tOf(co.next.date) <= xEnd && tOf(co.next.date) >= from) {
        var nx = x(tOf(co.next.date));
        el("line", { x1: nx, x2: nx, y1: pT - 6, y2: bot, "stroke-dasharray": "5 4" }, gr);
        el("rect", { x: nx - 22, y: 2, width: 44, height: 26, rx: 6 }, gr);
        txt(gr, nx, 13, co.next.q.slice(3)); txt(gr, nx, 24, "D-" + dday(co.next.date), "rx");
      }
    }

    // 주가
    var gp = el("g", {}, body), step = IW / Math.max(1, (xEnd - from) / (wk ? 7 * DAY : 1.45 * DAY)), bw = Math.max(1, Math.min(14, step * 0.62));
    if (st.mode === "line") {
      var dd = bars.map(function (b, i) { return (i ? "L" : "M") + x(b.t).toFixed(1) + "," + y(b.c).toFixed(1); }).join("");
      el("path", { d: dd + "L" + x(bars[bars.length - 1].t).toFixed(1) + "," + pBot + "L" + x(bars[0].t).toFixed(1) + "," + pBot + "Z", "class": "parea fade" }, gp);
      el("path", { d: dd, "class": "pline draw" }, gp);
    } else {
      bars.forEach(function (b) {
        var up = b.c >= b.o, cx = x(wk ? b.t + 2 * DAY : b.t), c = up ? "c-up" : "c-dn";
        if (st.mode === "candle") {
          el("line", { x1: cx, x2: cx, y1: y(b.h), y2: y(b.l), "class": c + "-h", "stroke-width": 1 }, gp);
          var yt = y(Math.max(b.o, b.c)), yb = y(Math.min(b.o, b.c));
          el("rect", { x: cx - bw / 2, y: yt, width: bw, height: Math.max(1, yb - yt), "class": c + (up && bw > 3 ? "" : ""), rx: bw > 5 ? 1 : 0 }, gp);
        } else {
          el("path", { d: "M" + cx + "," + y(b.h) + "V" + y(b.l) + "M" + (cx - bw / 2) + "," + y(b.o) + "H" + cx + "M" + cx + "," + y(b.c) + "H" + (cx + bw / 2), "class": c + "-h", "stroke-width": bw > 4 ? 1.6 : 1.1 }, gp);
        }
      });
    }
    // 마지막 값 꼬리표
    var lb = bars[bars.length - 1], gl = el("g", { "class": "lastp" }, svg), ly = y(lb.c);
    el("line", { x1: x(lb.t), x2: pL + IW, y1: ly, y2: ly }, gl);
    el("rect", { x: W - pR + 3, y: ly - 9, width: pR - 6, height: 18, rx: 4 }, gl);
    txt(gl, W - pR + 8, ly + 4, nf(lb.c));

    // 십자선
    var gx = el("g", { "class": "xh", visibility: "hidden" }, svg);
    var vl = el("line", { y1: pT, y2: bot }, gx), hl = el("line", { x1: pL, x2: pL + IW }, gx);
    var dr = el("rect", { y: bot + 3, width: 64, height: 17, rx: 4 }, gx), dt = txt(gx, 0, bot + 15, "");
    var pr = el("rect", { x: W - pR + 3, width: pR - 6, height: 18, rx: 4 }, gx), pt = txt(gx, W - pR + 8 + (pR - 16) / 2, 0, "");
    var ov = el("rect", { x: pL, y: 0, width: IW, height: H, fill: "transparent" }, svg);
    var xs = bars.map(function (b) { return x(wk ? b.t + 2 * DAY : b.t); });
    function nearest(mx) { var lo2 = 0, hi2 = xs.length - 1; while (hi2 - lo2 > 1) { var mid = (lo2 + hi2) >> 1; if (xs[mid] < mx) lo2 = mid; else hi2 = mid; } return Math.abs(xs[lo2] - mx) < Math.abs(xs[hi2] - mx) ? lo2 : hi2; }
    ov.addEventListener("mousemove", function (ev) {
      var rc = svg.getBoundingClientRect(), mx = (ev.clientX - rc.left) * W / rc.width, my = (ev.clientY - rc.top) * H / rc.height;
      var i = nearest(mx), b = bars[i], cx = xs[i];
      gx.setAttribute("visibility", "visible");
      vl.setAttribute("x1", cx); vl.setAttribute("x2", cx); hl.setAttribute("y1", my); hl.setAttribute("y2", my);
      dr.setAttribute("x", Math.min(pL + IW - 64, Math.max(pL, cx - 32))); dt.setAttribute("x", Math.min(pL + IW - 32, Math.max(pL + 32, cx))); dt.textContent = md(b.t);
      var pv = lo + (1 - (my - pTop) / (pBot - pTop)) * (hi - lo);
      pr.setAttribute("y", my - 9); pt.setAttribute("y", my + 4); pt.setAttribute("x", W - pR / 2); pt.textContent = my <= pBot ? nf(pv) : "";
      // 그때까지 발표된 지표
      var known = null;
      Object.keys(co.rel).sort(function (a, b2) { return qi(a) - qi(b2); }).forEach(function (q) { if (tOf(co.rel[q]) <= b.t && ch.val(q) != null) known = q; });
      var inQ = qq.filter(function (q) { return qStart(co, q) <= b.t && qEnd(co, q) >= b.t; })[0];
      var prev = bars[i - 1], chg = prev ? (b.c / prev.c - 1) * 100 : null;
      var h = "<h5>" + md(b.t) + (wk ? " 주" : "") + "<span>" + esc(co.n) + "</span></h5>" + row("시가", nf(b.o)) + row("고가", nf(b.h)) + row("저가", nf(b.l)) + row("종가", nf(b.c) + (chg != null ? ' <small class="' + ud(chg) + '">' + pct(chg) + "</small>" : "")) + "<hr>" +
        (known ? row("발표된 " + ch.t, auto(ch.val(known), ch.u) + " (" + known + ")", "ind") + row("발표일", md(tOf(co.rel[known]))) : row(ch.t, "발표 전")) +
        (inQ && inQ !== known ? row("진행 중 분기", inQ + " · " + (co.rel[inQ] ? md(tOf(co.rel[inQ])) + " 발표" : "미발표")) : "");
      showTip(h, ev);
    });
    ov.addEventListener("mouseleave", function () { gx.setAttribute("visibility", "hidden"); hideTip(); });

    host.innerHTML = ""; host.appendChild(svg);
    if (anim) animate(svg);
    drawNav(co);
  }

  /* 기간 고르는 작은 차트(브러시) */
  function drawNav(co) {
    var host = document.getElementById("nw"), st = S.st[co.c], px = S.px[co.c];
    var W = Math.max(320, host.clientWidth), H = 46, pL = 6, pR = 64, IW = W - pL - pR;
    var all = weekly(px), F = px[0].t, L = px[px.length - 1].t;
    var x = function (t) { return pL + (t - F) / (L - F || 1) * IW; }, tx = function (xx) { return F + (xx - pL) / IW * (L - F); };
    var lo = Math.min.apply(null, all.map(function (b) { return b.c; })), hi = Math.max.apply(null, all.map(function (b) { return b.c; }));
    var y = function (v) { return 4 + (1 - (v - lo) / (hi - lo || 1)) * (H - 10); };
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, "class": "navg" });
    el("path", { d: all.map(function (b, i) { return (i ? "L" : "M") + x(b.t).toFixed(1) + "," + y(b.c).toFixed(1); }).join("") + "L" + x(L) + "," + H + "L" + x(F) + "," + H + "Z", "class": "na" }, svg);
    var bx = x(st.from), bw = Math.max(6, x(st.to) - bx);
    el("rect", { x: pL, y: 0, width: Math.max(0, bx - pL), height: H, "class": "mask" }, svg);
    el("rect", { x: bx + bw, y: 0, width: Math.max(0, pL + IW - bx - bw), height: H, "class": "mask" }, svg);
    var br = el("rect", { x: bx, y: 0.5, width: bw, height: H - 1, rx: 4, "class": "brush" }, svg);
    var h1 = el("rect", { x: bx - 3, y: H / 2 - 9, width: 6, height: 18, rx: 2, "class": "hd" }, svg), h2 = el("rect", { x: bx + bw - 3, y: H / 2 - 9, width: 6, height: 18, rx: 2, "class": "hd" }, svg);
    txt(svg, W - pR + 8, 14, md(F).slice(0, 5)).setAttribute("class", "");
    txt(svg, W - pR + 8, 30, "~" + md(L).slice(0, 5));
    host.innerHTML = ""; host.appendChild(svg);
    var drag = null;
    function pos(ev) { var rc = svg.getBoundingClientRect(); return (ev.clientX - rc.left) * W / rc.width; }
    function down(kind) { return function (ev) { ev.preventDefault(); ev.stopPropagation(); drag = { k: kind, x0: pos(ev), f: st.from, t: st.to }; document.addEventListener("mousemove", move); document.addEventListener("mouseup", up); }; }
    function move(ev) {
      if (!drag) return;
      var dt = tx(pos(ev)) - tx(drag.x0), minS = 40 * DAY;
      if (drag.k === "b") { var len = drag.t - drag.f, f = Math.min(Math.max(F, drag.f + dt), L - len); st.from = f; st.to = f + len; }
      else if (drag.k === "l") st.from = Math.min(Math.max(F, drag.f + dt), st.to - minS);
      else st.to = Math.max(Math.min(L, drag.t + dt), st.from + minS);
      st.range = null; markRange(); drawMain(co, false);
    }
    function up() { drag = null; document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); }
    br.addEventListener("mousedown", down("b")); h1.addEventListener("mousedown", down("l")); h2.addEventListener("mousedown", down("r"));
    svg.addEventListener("mousedown", function (ev) {   // 빈 곳 누르면 그 자리로 옮김
      if (ev.target !== svg && ev.target.getAttribute("class") !== "na" && ev.target.getAttribute("class") !== "mask") return;
      var c = tx(pos(ev)), len = st.to - st.from, f = Math.min(Math.max(F, c - len / 2), L - len);
      st.from = f; st.to = f + len; st.range = null; markRange(); drawMain(co, false);
    });
  }
  function markRange() { var st = S.st[cur()]; document.querySelectorAll("#prange button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.v === st.range); }); }
  function cur() { var m = /^#c\/(\w+)/.exec(location.hash); return m ? m[1] : null; }
  function bindMain(co) {
    var st = S.st[co.c];
    document.querySelectorAll("#ichips .ichip").forEach(function (b) { b.onclick = function () { st.chip = b.dataset.ch; document.querySelectorAll("#ichips .ichip").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); drawMain(co, true); }; });
    document.querySelectorAll("#pmode button").forEach(function (b) { b.onclick = function () { st.mode = b.dataset.v; document.querySelectorAll("#pmode button").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); drawMain(co, true); }; });
    document.querySelectorAll("#prange button").forEach(function (b) { b.onclick = function () { setRange(co, b.dataset.v); markRange(); drawMain(co, true); }; });
    var rb = document.querySelector("#prel button"); rb.onclick = function () { st.rel = !st.rel; rb.setAttribute("aria-pressed", st.rel); drawMain(co, false); };
  }

  /* ---------- 선행지표 상세 차트 ---------- */
  function drawInd(co, ind, host, anim) {
    if (!host) return;
    var W = Math.max(300, host.clientWidth), H = 250, pL = 44, pR = 16, pT = 18, pB = 26, IW = W - pL - pR, bot = H - pB;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H });
    var defs = el("defs", {}, svg), gs = el("linearGradient", { id: "gS" + ind.id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "var(--acc)", "stop-opacity": ".75" }, gs); el("stop", { offset: "1", "stop-color": "var(--acc)", "stop-opacity": ".22" }, gs);
    var hp = el("pattern", { id: "h2" + ind.id, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    el("rect", { width: 6, height: 6, fill: "var(--ind-soft)" }, hp); el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "var(--ind)", "stroke-width": 2, "stroke-opacity": ".6" }, hp);
    var gg = el("g", { "class": "g-grid" }, svg), ga = el("g", { "class": "g-ax" }, svg);
    var Q = [], series = [], lo = 0, hi = 0, unit = "";
    var hits = [];

    if (ind.model === "lastq") {
      var m = model(co); Q = m.rows.map(function (r) { return r.q; }).concat([m.nq]); unit = "억엔";
      var cs = co.consensus;
      hi = Math.max.apply(null, m.rows.map(function (r) { return Math.max(r.act, r.est); }).concat([m.adj || 0, cs ? cs.sales : 0])) * 1.12;
    } else if (ind.model === "yoy") {
      Q = qsOf(co, "sga").filter(function (q) { return yoy(co, "sga", q) != null || yoy(co, "sga", qs(qi(q) - (ind._shift || 0))) != null; });
      var sh = ind._shift || 0;
      Q = qsOf(co, "sales").filter(function (q) { return yoy(co, "sales", q) != null && qi(q) >= qi(qsOf(co, "sga")[4] || "99.1Q"); });
      if (sh) Q = Q.concat([qs(qi(Q[Q.length - 1]) + 1), qs(qi(Q[Q.length - 1]) + 2)]);
      unit = "%";
      series = [
        { n: "판관비 YoY" + (sh ? " (" + sh + "분기 뒤로)" : ""), cls: "ind", v: function (q) { return yoy(co, "sga", qs(qi(q) - sh)); } },
        { n: "매출 YoY", cls: "acc", v: function (q) { return yoy(co, "sales", q); } }
      ];
      Q.forEach(function (q) { series.forEach(function (s) { var v = s.v(q); if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v); } }); });
      hi *= 1.15;
    } else if (ind.model === "ph") {
      Q = qsOf(co, "sales").filter(function (q) { return ph(co, q) != null; }); var mq = model(co).nq; Q.push(mq); unit = "만엔";
      var vs = Q.map(function (q) { return ph(co, q); }).filter(function (v) { return v != null; }).concat([ind.rule.line]);
      lo = Math.min.apply(null, vs) * 0.96; hi = Math.max.apply(null, vs) * 1.03;
    }
    var n = Q.length, bwid = IW / n;
    var x = function (i) { return pL + bwid * (i + 0.5); };
    var y = function (v) { return pT + (1 - (v - lo) / (hi - lo || 1)) * (bot - pT); };
    nice(lo, hi, 4).forEach(function (v) { if (v < lo || v > hi) return; el("line", { x1: pL, x2: W - pR, y1: y(v), y2: y(v) }, gg); txt(ga, pL - 6, y(v) + 3.5, unit === "%" ? v + "%" : nf(v), null, "end"); });
    Q.forEach(function (q, i) { if (n <= 12 || i % 2 === (n - 1) % 2) txt(ga, x(i), H - 8, q, null, "middle"); });
    var gB = el("g", {}, svg), gT = el("g", {}, svg);

    if (ind.model === "lastq") {
      var mm = model(co), csx = co.consensus;
      var ptsE = [];
      mm.rows.forEach(function (r, i) {
        var bw = bwid * 0.56, h = bot - y(r.act);
        el("rect", { x: x(i) - bw / 2, y: y(r.act), width: bw, height: h, rx: 3, fill: "url(#gS" + ind.id + ")", "class": "grow" }, gB);
        ptsE.push([x(i), y(r.est)]);
        if (i >= n - 4) txt(gT, x(i), y(Math.max(r.act, r.est)) - 7, nf(r.act, r.act < 100 ? 1 : 0), "ibar-lab fade");
        hits.push({ i: i, h: "<h5>" + r.q + "<span>" + qMonths(co, r.q) + "</span></h5>" + row("실제 매출", nf(r.act, 1) + "억") + row("인원 기반 추정", nf(r.est, 1) + "억", "ind") + row("오차", pct(r.err)) + "<hr>" + row("직전 분기말 인원", nf(sv(co, "cons", qs(qi(r.q) - 1))) + "명") + row("직전 인당 월매출", nf(ph(co, qs(qi(r.q) - 1)), 1) + "만엔") });
      });
      var li = n - 1, bw2 = bwid * 0.56;
      if (mm.adj) {
        el("rect", { x: x(li) - bw2 / 2, y: y(mm.adj), width: bw2, height: bot - y(mm.adj), rx: 3, fill: "url(#h2" + ind.id + ")", stroke: "var(--ind)", "stroke-dasharray": "3 2", "class": "grow" }, gB);
        ptsE.push([x(li), y(mm.est)]);
        txt(gT, x(li), y(mm.adj) - 7, nf(mm.adj, mm.adj < 100 ? 1 : 0) + " 추정", "ibar-lab est fade");
        if (csx) { el("line", { x1: x(li) - bw2 / 2 - 6, x2: x(li) + bw2 / 2 + 6, y1: y(csx.sales), y2: y(csx.sales), stroke: "var(--gold)", "stroke-width": 2 }, gT); txt(gT, x(li), y(csx.sales) + 15, "컨센 " + nf(csx.sales), "ibar-lab cs"); }
        hits.push({ i: li, h: "<h5>" + mm.nq + " 추정<span>" + qMonths(co, mm.nq) + "</span></h5>" + row("인원 기반 추정", nf(mm.est, 1) + "억", "ind") + row("평균 오차 보정 " + pct(mm.mean), nf(mm.adj, 1) + "억", "ind") + row("과거 오차 범위", pct(mm.min) + " ~ " + pct(mm.max)) + (csx ? row("컨센서스", nf(csx.sales, 0) + "억") : "") + "<hr>" + row(lastQ(co, "cons") + " 말 인원", nf(sv(co, "cons", lastQ(co, "cons"))) + "명") });
      }
      el("path", { d: ptsE.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(""), fill: "none", stroke: "var(--ind)", "stroke-width": 1.5, "stroke-dasharray": "4 3", "class": "draw" }, gT);
      ptsE.forEach(function (p, i) { el("circle", { cx: p[0], cy: p[1], r: i === ptsE.length - 1 ? 5 : 4, fill: "var(--panel)", stroke: "var(--ind)", "stroke-width": 2, "class": "fade" }, gT); });
      leg(host, [["lg-sales", "실제 매출"], ["lg-ind", "인원 기반 추정(직전 분기말 인원 × 직전 인당 월매출 × 3)"], ["lg-est", "다음 분기 추정(오차 보정)"]].concat(csx ? [["lg-rel", "컨센서스"]] : []));
    } else if (ind.model === "yoy") {
      series.forEach(function (s) {
        var pts = []; Q.forEach(function (q, i) { var v = s.v(q); if (v != null) pts.push([x(i), y(v), v, q]); });
        var col = s.cls === "ind" ? "var(--ind)" : "var(--acc-2)";
        el("path", { d: pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(""), fill: "none", stroke: col, "stroke-width": 2, "stroke-linejoin": "round", "class": "draw" }, gT);
        pts.forEach(function (p, i) { el("circle", { cx: p[0], cy: p[1], r: 4, fill: col, stroke: "var(--panel)", "stroke-width": 2, "class": "fade" }, gT); });
        var lp = pts[pts.length - 1]; if (lp) txt(gT, lp[0] + 2, lp[1] - 9, pct(lp[2], 0), "ibar-lab fade");
      });
      el("line", { x1: pL, x2: W - pR, y1: y(0), y2: y(0), stroke: "var(--line-2)" }, gB);
      Q.forEach(function (q, i) { hits.push({ i: i, h: "<h5>" + q + "<span>" + qMonths(co, q) + "</span></h5>" + series.map(function (s) { return row(s.n, pct(s.v(q)), s.cls === "ind" ? "ind" : ""); }).join("") + (sv(co, "op", q) ? row("영업이익률", nf(sv(co, "op", q) / sv(co, "sales", q) * 100, 1) + "%") : "") }); });
      leg(host, [["lg-ind", series[0].n], ["lg-sales", "매출 YoY"]]);
    } else if (ind.model === "ph") {
      var pts2 = []; Q.forEach(function (q, i) { var v = ph(co, q); if (v != null) pts2.push([x(i), y(v), v, q]); });
      Q.forEach(function (q, i) { if (/\.2Q$/.test(q)) el("rect", { x: x(i) - bwid / 2, y: pT, width: bwid, height: bot - pT, fill: "var(--gold-soft)", opacity: ".55" }, gB); });
      var ly = y(ind.rule.line);
      el("line", { x1: pL, x2: W - pR, y1: ly, y2: ly, stroke: "var(--gold)", "stroke-dasharray": "5 4", "stroke-width": 1.3 }, gB);
      txt(gT, pL + 4, ly - 6, "확인 기준 " + ind.rule.line + "만엔", "ibar-lab").setAttribute("text-anchor", "start");
      el("path", { d: pts2.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(""), fill: "none", stroke: "var(--ind)", "stroke-width": 2.2, "stroke-linejoin": "round", "class": "draw" }, gT);
      pts2.forEach(function (p, i) { el("circle", { cx: p[0], cy: p[1], r: 4.5, fill: "var(--ind)", stroke: "var(--panel)", "stroke-width": 2, "class": "fade" }, gT); if (i >= pts2.length - 3 || /\.2Q$/.test(p[3])) txt(gT, p[0], p[1] - 10, nf(p[2], 1), "ibar-lab fade"); });
      var li2 = n - 1; el("circle", { cx: x(li2), cy: ly, r: 7, fill: "none", stroke: "var(--gold)", "stroke-width": 1.6, "stroke-dasharray": "3 2" }, gT);
      txt(gT, x(li2), ly + 20, "?", "ibar-lab est");
      Q.forEach(function (q, i) { var v = ph(co, q); hits.push({ i: i, h: "<h5>" + q + "<span>" + qMonths(co, q) + "</span></h5>" + (v != null ? row("인당 월매출", nf(v, 1) + "만엔", "ind") + row("매출", nf(sv(co, "sales", q), 1) + "억") + row("평균 컨설턴트", nf((sv(co, "cons", q) + sv(co, "cons", qs(qi(q) - 1))) / 2) + "명") + (/\.2Q$/.test(q) ? row("메모", "신졸 투입 분기") : "") : row("확인 기준", "≥ " + ind.rule.line + "만엔") + row("발표", md(tOf(co.next.date)))) }); });
      leg(host, [["lg-ind", "인당 월매출"], ["lg-rel", "확인 기준"], ["lg-2q", "2Q(신졸 투입)"]]);
    }
    // 호버
    var hl = el("rect", { y: pT, height: bot - pT, width: bwid, fill: "var(--ink)", opacity: 0, rx: 6 }, gB);
    hits.forEach(function (h) {
      var r = el("rect", { x: x(h.i) - bwid / 2, y: 0, width: bwid, height: H, fill: "transparent" }, svg);
      r.addEventListener("mousemove", function (ev) { hl.setAttribute("x", x(h.i) - bwid / 2); hl.setAttribute("opacity", ".05"); showTip(h.h, ev); });
      r.addEventListener("mouseleave", function () { hl.setAttribute("opacity", 0); hideTip(); });
    });
    var old = host.querySelector("svg"); if (old) host.removeChild(old);
    host.insertBefore(svg, host.firstChild);
    if (anim) animate(svg);
  }
  function leg(host, items) {
    var l = host.querySelector(".legend"); if (!l) { l = document.createElement("div"); l.className = "legend"; host.appendChild(l); }
    l.innerHTML = items.map(function (i) { return '<span><i class="' + i[0] + '"></i>' + esc(i[1]) + "</span>"; }).join("");
  }

  /* ---------- 라이트박스 ---------- */
  var lb = document.getElementById("lb");
  function openLb(src, cap) { document.getElementById("lbimg").src = src; document.getElementById("lbcap").textContent = cap || ""; lb.hidden = false; }
  lb.addEventListener("click", function (e) { if (e.target === lb || e.target.id === "lbx") lb.hidden = true; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") lb.hidden = true; });

  /* ---------- 테마 ---------- */
  document.getElementById("themeBtn").onclick = function () {
    var t = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("ld-theme", t); } catch (e) {}
  };

  /* ---------- 라우팅 ---------- */
  function route() {
    hideTip();
    var h = location.hash.replace(/^#\/?/, ""), p = h.split("/");
    if (p[0] === "c" && p[1] && S.idx.cos[p[1]]) {
      renderTree({ sec: S.idx.cos[p[1]].sec, c: p[1] });
      loadPx(p[1]).then(function () { viewCompany(p[1]); });
    } else if (p[0] === "s" && p[2]) { renderTree({ sec: p[1] + "/" + p[2] }); viewSector(p[1], p[2]); }
    else { renderTree(null); viewHome(); }
    window.scrollTo(0, 0);
  }
  var rT = null;
  window.addEventListener("resize", function () {
    clearTimeout(rT);
    rT = setTimeout(function () {
      var c = cur(); if (!c || !S.co[c]) return;
      drawMain(S.co[c], false);
      S.co[c].indicators.forEach(function (ind) { var hst = document.getElementById("ic-" + ind.id); if (hst && hst._done) drawInd(S.co[c], ind, hst, false); });
    }, 150);
  });
  document.getElementById("sideTg").onclick = function () { var sd = document.getElementById("side"), o = sd.classList.toggle("open"); this.setAttribute("aria-expanded", o); };
  document.getElementById("tree").addEventListener("click", function (e) { if (e.target.closest("a")) { document.getElementById("side").classList.remove("open"); document.getElementById("sideTg").setAttribute("aria-expanded", false); } });
  document.getElementById("q").addEventListener("input", function () { var c = cur(); renderTree(c ? { sec: S.idx.cos[c].sec, c: c } : null); });

  getJSON("data/jp/lead/index.json").then(function (idx) {
    S.idx = idx;
    var codes = Object.keys(idx.cos);
    return Promise.all([
      Promise.all(codes.map(function (c) { return getJSON("data/jp/lead/" + c + ".json").then(function (d) { S.co[c] = d; }); })),
      Promise.all(codes.map(loadPx)),
      getJSON("data/jp/scr.json").then(function (d) { S.scr = d; }).catch(function () { S.scr = null; })
    ]);
  }).then(function () {
    window.addEventListener("hashchange", route);
    route();
  }).catch(function (e) { main.innerHTML = '<div class="empty">불러오지 못했습니다 — ' + esc(e.message || e) + "</div>"; });
})();
