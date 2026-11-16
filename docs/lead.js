/* 선행지표 트래킹(2026-11-16 사용자) — 실적보다 먼저 나오는 "외부" 월간 데이터로 기업 상황을 미리 본다.
 * 원칙(2026-11-16 사용자): 회사가 발표하는 숫자·가이던스는 선행지표가 아니다(결과 확인용 → 아래 참고 표로만).
 *   선행지표 = 다른 곳에서 매달 나오는 데이터(연금 가입자 수, 수출입 통계, 공공 구인 건수 …) 중 실적과 R(상관)이 높은 것.
 * 데이터  data/jp/lead/index.json(섹터 트리) · data/jp/lead/<코드>.json(lead.items = 월간 선행지표 원장, lead.next = 다음 발표일, series = 회사 발표 참고)
 *         data/jp/px/<코드>.json(일봉, build_px.py 매일) · data/jp/scr.json(시총·PER)
 * 주소    lead.html# · #s/<대>/<소> · #c/<코드>
 * 왼쪽 목록: 기업이 700곳 가까이 늘어날 것을 전제로 — 검색 결과 목록 + 접히는 대분류 + 펼친 세부 섹터의 기업만 보임(많으면 안에서 스크롤).
 * 차트    선행지표: 월 막대(위) + 같은 시간축의 분기 매출 막대(아래) — 두 번째 y축 없이 위아래로 나눔.
 *         주가: 캔들/막대(OHLC)/선, 선행지표 월 막대를 주가 아래 띠에 겹침. 휠 = 확대·축소, 끌기 = 이동, 두 번 누르기 = 1년. */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var DAY = 864e5;
  var S = { idx: null, co: {}, px: {}, scr: null, st: {}, open: {}, fold: {}, macroIdx: null, macroF: {} };
  var main = document.getElementById("main");
  var tip = document.getElementById("tip");
  var REDUCE = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 공통 ---------- */
  function getJSON(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]; }); }
  function nf(v, d) { if (v == null || isNaN(v)) return "—"; return (+v).toLocaleString("ko-KR", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function pct(v, d) { if (v == null || isNaN(v)) return "—"; return (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), d == null ? 1 : d) + "%"; }
  function sgn(v) { return v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "±") + nf(Math.abs(v)); }
  function ud(v) { return v > 0 ? "up" : v < 0 ? "dn" : ""; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function md(t) { var d = new Date(t); return String(d.getUTCFullYear()).slice(2) + "." + pad(d.getUTCMonth() + 1) + "." + pad(d.getUTCDate()); }
  function tOf(s) { var p = s.split("-"); return Date.UTC(+p[0], +p[1] - 1, +(p[2] || 1)); }
  function today() { var n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); }
  function dday(s) { return Math.round((tOf(s) - today()) / DAY); }
  function dlab(s) { var d = dday(s); return d > 0 ? "D-" + d : d === 0 ? "오늘" : "지남"; }
  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function txt(parent, x, y, s, cls, anchor) { var t = el("text", { x: x, y: y, "class": cls || null, "text-anchor": anchor || null }, parent); t.textContent = s; return t; }
  function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }
  function nice(lo, hi, n) {
    var span = hi - lo || 1, step = Math.pow(10, Math.floor(Math.log10(span / n))), m = span / n / step;
    step *= m > 5 ? 10 : m > 2 ? 5 : m > 1 ? 2 : 1;
    var out = [], v = Math.ceil(lo / step) * step;
    for (; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }
  function corr(xs, ys) {
    var n = xs.length; if (n < 3) return null;
    var mx = xs.reduce(function (a, b) { return a + b; }, 0) / n, my = ys.reduce(function (a, b) { return a + b; }, 0) / n, sxy = 0, sx = 0, sy = 0;
    for (var i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sx += Math.pow(xs[i] - mx, 2); sy += Math.pow(ys[i] - my, 2); }
    return sx && sy ? sxy / Math.sqrt(sx * sy) : null;
  }

  /* ---------- 분기·달 ---------- */
  function qi(q) { var m = /^(\d{2})\.(\d)Q/.exec(q); return m ? +m[1] * 4 + (+m[2] - 1) : null; }
  function qs(i) { return pad(Math.floor(i / 4)) + "." + (i % 4 + 1) + "Q"; }
  function qEnd(co, q) { var i = qi(q), y = 2000 + Math.floor(i / 4), n = i % 4 + 1, mm = co.fy.end_month + 3 * n; return Date.UTC(y - 1 + Math.floor((mm - 1) / 12), (mm - 1) % 12 + 1, 0); }
  function qStart(co, q) { return qEnd(co, qs(qi(q) - 1)) + DAY; }
  function qMonths(co, q) { var a = new Date(qStart(co, q)), b = new Date(qEnd(co, q)); return String(a.getUTCFullYear()).slice(2) + "." + (a.getUTCMonth() + 1) + "~" + (b.getUTCMonth() + 1) + "월"; }
  function qOfYm(co, ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7), E = co.fy.end_month, fy = y + (m > E ? 1 : 0), off = ((m - E - 1) % 12 + 12) % 12; return pad(fy % 100) + "." + (Math.floor(off / 3) + 1) + "Q"; }
  function ymAdd(ym, k) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + k; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + "-" + pad(m + 1); }
  function ymT(ym) { return Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 20); }   // 매월 20일 무렵 기준
  function ymLab(ym) { return ym.slice(2, 4) + "." + ym.slice(5, 7); }
  function qMonthsList(co, q) { var a = new Date(qStart(co, q)), ym = a.getUTCFullYear() + "-" + pad(a.getUTCMonth() + 1); return [ym, ymAdd(ym, 1), ymAdd(ym, 2)]; }

  /* ---------- 회사 발표(참고) ---------- */
  function sm(co, k) { co._m = co._m || {}; if (!co._m[k]) { var m = {}; ((co.series[k] || {}).pts || []).forEach(function (p) { m[p[0]] = { v: p[1], ref: p[2], p: p[3] }; }); co._m[k] = m; } return co._m[k]; }
  function sv(co, k, q) { var r = sm(co, k)[q]; return r ? r.v : null; }
  function yoy(co, k, q) { var a = sv(co, k, q), b = sv(co, k, qs(qi(q) - 4)); return a != null && b ? (a / b - 1) * 100 : null; }
  function ph(co, q) { var s = sv(co, "sales", q), a = sv(co, "cons", q), b = sv(co, "cons", qs(qi(q) - 1)); return s != null && a && b ? s * 1e4 / ((a + b) / 2) / 3 : null; }
  function qsOf(co, k) { return co.series[k] ? co.series[k].pts.map(function (p) { return p[0]; }) : []; }

  /* ---------- 선행지표 계산 ---------- */
  function U(it) { return it && it.unit ? it.unit : "명"; }
  function NM(it) { return !it ? "가입자" : it.kind === "trends" ? "검색 관심도" : it.kind === "macro" ? (it.nm || "시장 통계") : "가입자"; }
  function DG(it) { return it && (it.kind === "trends" || it.kind === "macro") ? 1 : 0; }
  function bestIt(co) { return co.lead.items.filter(function (x) { return x.pts.length >= 12; })[0] || co.lead.items[0]; }
  function item(co, id) { return co.lead.items.filter(function (x) { return x.id === id; })[0] || co.lead.items[0]; }
  function mm(it) { if (!it._m) { it._m = {}; it.pts.forEach(function (p) { it._m[p[0]] = p; }); } return it._m; }
  function mv(it, ym) { var p = mm(it)[ym]; return p ? p[1] : null; }
  function stat(co, it) {   // 분기 묶음 · R · 이번 분기 추정
    if (it._st) return it._st;
    var qmap = {}, order = [];
    it.pts.forEach(function (p) { var q = qOfYm(co, p[0]); if (!qmap[q]) { qmap[q] = []; order.push(q); } qmap[q].push(p[1]); });
    var rows = order.map(function (q) { var v = qmap[q], avg = v.reduce(function (a, b) { return a + b; }, 0) / v.length, s = it.unit === "%" ? yoy(co, "sales", q) : sv(co, "sales", q); return { q: q, n: v.length, avg: avg, sales: s, ratio: s != null && it.unit !== "%" ? s * 1e4 / avg / 3 : null }; });   // 전년비(%) 지표는 매출 YoY 와 비교
    var full = rows.filter(function (x) { return x.n === 3 && x.sales != null; });
    var r = corr(full.map(function (x) { return x.avg; }), full.map(function (x) { return x.sales; }));
    var ratios = full.map(function (x) { return x.ratio; });
    var pq = co.next.q, pr = rows.filter(function (x) { return x.q === pq; })[0], est = null;
    if (pr && ratios.length) {
      var avgR = ratios.reduce(function (a, b) { return a + b; }, 0) / ratios.length, mid = pr.avg * avgR * 3 / 1e4, ly = sv(co, "sales", qs(qi(pq) - 4));
      est = { q: pq, n: pr.n, avg: pr.avg, mid: mid, lo: pr.avg * Math.min.apply(null, ratios) * 3 / 1e4, hi: pr.avg * Math.max.apply(null, ratios) * 3 / 1e4, ratio: avgR, yoy: ly ? (mid / ly - 1) * 100 : null };
    }
    if (!it.pts.length) { it._st = { rows: rows, full: full, r: null, n: 0, est: null, last: ["—", null], mom: null, yoy: null, g3: null }; return it._st; }
    var L = it.pts[it.pts.length - 1], P = it.pts[it.pts.length - 2], Y = mm(it)[ymAdd(L[0], -12)], Y3 = mm(it)[ymAdd(L[0], -3)];
    var pc = it.unit === "%";
    it._st = { rows: rows, full: full, r: r, n: full.length, est: pc ? null : est, last: L, mom: P ? L[1] - P[1] : null, yoy: Y && !pc ? (L[1] / Y[1] - 1) * 100 : null, g3: Y3 && !pc ? (Math.pow(L[1] / Y3[1], 4) - 1) * 100 : null };
    return it._st;
  }
  function refLink(co, id, label) {
    var r = co.refs[id]; if (!r) return "";
    var u = r.url || (r.local ? r.local : r.doc ? co.ir.tdnet + r.doc + ".pdf" : null);
    return u ? '<a class="chip" href="' + esc(u) + '" target="_blank" rel="noopener" title="' + esc(r.t) + '">' + esc(label || r.t) + " ↗</a>" : '<span class="chip">' + esc(label || r.t) + "</span>";
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
      if (k !== key) { if (cur) out.push(cur); cur = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; key = k; }
      else { cur.h = Math.max(cur.h, r.h); cur.l = Math.min(cur.l, r.l); cur.c = r.c; cur.v += r.v; }
    });
    if (cur) out.push(cur);
    return out;
  }
  function reaction(px, rel) {
    var t = tOf(rel), i = null; for (var k = 0; k < px.length && px[k].t <= t; k++) i = k;
    if (i == null || i + 1 >= px.length || px[i].t < t - 5 * DAY) return null;
    return (px[i + 1].c / px[i].c - 1) * 100;
  }
  function quote(c) {
    var px = S.px[c] || []; if (!px.length) return null;
    var L = px[px.length - 1], P = px[px.length - 2] || L, yr = px.filter(function (r) { return r.t >= L.t - 365 * DAY; });
    var sc = S.scr && S.scr.items && S.scr.items[c], k = sc && sc.px ? L.c / sc.px : 1, mk = S.co[c] && S.co[c].mkt;
    return { last: L.c, t: L.t, chg: (L.c / P.c - 1) * 100, hi: Math.max.apply(null, yr.map(function (r) { return r.h; })), lo: Math.min.apply(null, yr.map(function (r) { return r.l; })), y1: yr[0] ? (L.c / yr[0].c - 1) * 100 : null,
      mc: sc ? sc.mc * k : mk ? L.c * mk.shares / 1e8 : null, per: sc && sc.per ? sc.per * k : mk && mk.fc_eps > 0 ? L.c / mk.fc_eps : null };
  }

  /* ---------- 등장 효과 ---------- */
  var PEND = [], pTm = null, LAZY = {};
  function lazyRun(e) { var f = LAZY[e.getAttribute("data-lazy")]; if (f && !e._done) { e._done = 1; f(e); } }
  function revealCheck() {
    var H = window.innerHeight || 800;
    PEND = PEND.filter(function (e) {
      if (!e.isConnected) return false;
      var r = e.getBoundingClientRect();
      if (r.top < H * 0.94 && r.bottom > -40) { e.classList.add("in"); if (e.hasAttribute("data-lazy")) lazyRun(e); return false; }
      return true;
    });
  }
  function reveal(root) {
    var list = Array.prototype.slice.call(root.querySelectorAll(".rv, [data-lazy]"));
    if (REDUCE) { list.forEach(function (e) { e.classList.add("in"); if (e.hasAttribute("data-lazy")) lazyRun(e); }); return; }
    var k = 0;
    list.forEach(function (e) { if (e.getBoundingClientRect().top < (window.innerHeight || 800)) e.style.transitionDelay = Math.min(k++, 8) * 45 + "ms"; });
    PEND = list; revealCheck();
  }
  window.addEventListener("scroll", function () { if (!pTm) pTm = setTimeout(function () { pTm = null; revealCheck(); }, 60); }, { passive: true });
  setInterval(function () { if (PEND.length) revealCheck(); }, 400);   // 스크롤 이벤트가 안 오는 경우(점프 이동·백그라운드 탭) 대비
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
    svg.querySelectorAll(".draw").forEach(function (p) { try { p.style.setProperty("--len", Math.ceil(p.getTotalLength())); } catch (e) {} });
    svg.querySelectorAll(".grow").forEach(function (b, i) { b.style.animationDelay = Math.min(i * 30, 700) + "ms"; });
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

  /* ---------- 왼쪽 목록(700곳 규모) ----------
   * 검색어가 있으면 트리 대신 맞는 기업만 평평하게(최대 40) — 이름·일본명·코드·섹터 이름.
   * 검색어가 없으면: 「지표 발표 임박」 몇 곳 + 대분류(접힘) → 세부 섹터(기업 수) → 펼친 섹터의 기업(많으면 안에서 스크롤). */
  function secName(c) { var o = S.idx.cos[c], p = (o.sec || "").split("/"), g = S.idx.tree.filter(function (x) { return x.id === p[0]; })[0], k = g && g.kids.filter(function (x) { return x.id === p[1]; })[0]; return k ? k.n : ""; }
  function coLink(c, active, showSec) {
    var co = S.co[c], o = S.idx.cos[c], ln = co && co.lead ? co.lead.next.date : o.ln, d = ln ? dday(ln) : null;
    return '<a class="tco' + (active && active.c === c ? " on" : "") + '" href="#c/' + c + '"><span class="nm">' + esc(o.n) + (showSec ? "<small>" + esc(secName(c)) + "</small>" : "") + "</span>" +
      (d != null && d >= 0 ? '<span class="dd" title="다음 선행지표 발표">' + (d === 0 ? "오늘" : "D-" + d) + "</span>" : "") + '<span class="mono">' + c + "</span></a>";
  }
  function renderTree(active) {
    var q = (document.getElementById("q").value || "").trim().toLowerCase(), box = document.getElementById("tree"), all = Object.keys(S.idx.cos);
    if (active && active.sec) S.open[active.sec.split("/")[0]] = true;
    if (q) {
      var hit = all.filter(function (c) { var o = S.idx.cos[c]; return (o.n + " " + (o.jp || "") + " " + c + " " + secName(c)).toLowerCase().indexOf(q) >= 0; });
      box.innerHTML = '<div class="tg-h"><b>검색 결과</b><span>' + hit.length + "곳</span></div>" + (hit.length ? '<div class="clist">' + hit.slice(0, 40).map(function (c) { return coLink(c, active, true); }).join("") + "</div>" + (hit.length > 40 ? '<p class="hint">40곳까지 보임 — 더 좁혀 검색</p>' : "") : '<p class="hint">맞는 기업이 없습니다.</p>');
      return;
    }
    var soon = all.filter(function (c) { return S.idx.cos[c].nd; }).map(function (c) { return { c: c, d: dday(S.idx.cos[c].nd) }; }).filter(function (x) { return x.d >= 0 && x.d <= 30; }).sort(function (a, b) { return a.d - b.d; });
    var h = '<div class="tg soon-box"><div class="tg-h"><b>실적 발표 임박</b><span>30일 안 ' + soon.length + "곳</span></div>" + (soon.length ? '<div class="clist">' + soon.slice(0, 6).map(function (x) { return coLink(x.c, active, true); }).join("") + "</div>" : '<p class="hint">없음</p>') + "</div>";
    h += S.idx.tree.map(function (g) {
      var n = g.kids.reduce(function (s, k) { return s + k.cos.length; }, 0), open = !!S.open[g.id];
      return '<div class="tg' + (open ? " open" : "") + '"><button type="button" class="tg-h tg-btn" data-g="' + g.id + '" aria-expanded="' + open + '"><b>' + esc(g.n) + '</b><span>' + n + "곳 <i>▾</i></span></button>" +
        (open ? g.kids.map(function (k) {
          var on = active && active.sec === g.id + "/" + k.id;
          return '<a class="tsub' + (k.soon && !k.cos.length ? " soon" : "") + (on && !active.c ? " on" : "") + (on ? " cur" : "") + '" href="#s/' + g.id + "/" + k.id + '">' + esc(k.n) + (k.cos.length ? "<small>" + k.cos.length + "</small>" : "") + "</a>" +
            (on && k.cos.length && !S.fold[g.id + "/" + k.id] ? '<div class="clist in-sec">' + k.cos.map(function (c) { return coLink(c, active, false); }).join("") + "</div>" : "");
        }).join("") : "") + "</div>";
    }).join("");
    box.innerHTML = h;
    box.querySelectorAll(".tg-btn").forEach(function (b) { b.onclick = function () { S.open[b.dataset.g] = !S.open[b.dataset.g]; renderTree(active); }; });
    box.querySelectorAll(".tsub").forEach(function (a2) {   // 펼친 세부 섹터를 다시 누르면 기업 목록 접기(2026-11-16 사용자)
      a2.onclick = function (e) {
        var sec = a2.getAttribute("href").slice(3);
        if (active && active.sec === sec) { e.preventDefault(); S.fold[sec] = !S.fold[sec]; renderTree(active); }
        else S.fold[sec] = false;
      };
    });
  }

  /* ---------- 홈 ---------- */
  function viewHome() {
    var cos = Object.keys(S.idx.cos).map(function (c) { var o = S.idx.cos[c]; return { c: c, n: o.n, ln: o.ln, nd: o.nd, nq: o.nq }; });
    var nPts = S.idx.tree.reduce(function (s, g) { return s + g.kids.filter(function (k) { return k.cos.length; }).length; }, 0);
    var ev = [];
    cos.forEach(function (co) { if (co.nd) ev.push({ co: co, d: co.nd, k: "실적", t: (co.nq || "") + " 실적 발표" }); });
    ev = ev.filter(function (e) { return dday(e.d) >= 0 && dday(e.d) <= 45; }).sort(function (a, b) { return tOf(a.d) - tOf(b.d); }).slice(0, 30);
    var lns = cos.map(function (c) { return c.ln; }).filter(function (d) { return d && dday(d) >= 0; }).sort();
    var nextLead = lns.length ? { d: lns[0] } : null;
    if (nextLead) ev.unshift({ co: { c: "", n: "연금 가입자 수 갱신(전 기업)" }, d: nextLead.d, k: "지표", t: "일본연금기구 데이터 갱신 — 전달 20일 무렵 기준" });
    main.innerHTML =
      '<section class="home-hero rv"><span class="eyebrow">LEADING INDICATORS · JAPAN</span>' +
      "<h1>회사 발표보다 먼저 나오는 숫자로<br><em>다음 실적을 미리 본다</em></h1>" +
      "<p>회사가 내는 숫자와 가이던스는 결과 확인용입니다. 여기서는 매달 외부에서 나오는 데이터(연금 가입자 수 · 수출입 통계 · 공공 구인 건수 등) 중 실적과 상관(R)이 높은 것을 골라 쌓고, 주가와 겹쳐 봅니다.</p>" +
      '<div class="hstats"><div class="hstat"><b class="mono" data-count="' + Object.keys(S.idx.cos).length + '">0</b><span>추적 기업</span></div><div class="hstat"><b class="mono" data-count="' + nPts + '">0</b><span>세부 섹터</span></div>' +
      (nextLead ? '<div class="hstat"><b class="mono">' + esc(dlab(nextLead.d)) + "</b><span>다음 지표 발표 " + esc(md(tOf(nextLead.d))) + "</span></div>" : "") + "</div>" +
      '<div class="flow"><b>외부 월간 데이터</b><i>→</i><b>분기로 묶어 매출과 R</b><i>→</i><b>이번 분기 매출 추정</b><i>→</i><b>주가와 겹쳐 보기</b><i>→</i><b>실적 전 판단</b></div></section>' +
      '<div class="sec-t rv"><span class="n">01</span><h2>다가오는 일정</h2><p>지표 갱신일과 45일 안 실적 발표(최대 30곳)</p></div>' +
      '<div class="timeline">' + ev.map(function (e) {
        return '<a class="tl rv" href="' + (e.co.c ? "#c/" + e.co.c : "#") + '"><div class="d"><b>' + dlab(e.d) + "</b><span>" + md(tOf(e.d)) + '</span></div><div><h4>' + esc(e.co.n) + ' <small class="mono">' + e.co.c + "</small></h4><p>" + esc(e.t) + '</p></div><div><span class="chip ' + (e.k === "지표" ? "ind" : "gold") + '">' + e.k + "</span></div></a>";
      }).join("") + "</div>" +
      '<div class="sec-t rv"><span class="n">02</span><h2>섹터</h2><p>사업모델이 같은 회사끼리 잘게 묶습니다</p></div>' +
      '<div class="secgrid">' + S.idx.tree.map(function (g) {
        return '<div class="sbox rv"><span class="en">' + esc(g.en) + "</span><h3>" + esc(g.n) + "</h3><ul>" + g.kids.map(function (k) {
          return "<li>" + (k.cos.length ? '<a href="#s/' + g.id + "/" + k.id + '"><span>' + esc(k.n) + '</span><b class="mono">' + k.cos.length + "</b></a>" : "<span>" + esc(k.n) + "<em>준비 중</em></span>") + "</li>";
        }).join("") + "</ul></div>";
      }).join("") + "</div>";
    reveal(main); countUp(main);
  }

  /* ---------- 섹터 ---------- */
  function ensureCo(codes, px) {   // 원장·주가를 필요할 때만 받음(기업 수백 곳)
    return Promise.all(codes.map(function (c) { return S.co[c] ? null : getJSON("data/jp/lead/" + c + ".json").then(function (d) { S.co[c] = d; }).catch(function () {}); }))
      .then(function () { return Promise.all(codes.map(function (c) { return attachMacro(S.co[c]); })); })
      .then(function () { return px ? Promise.all(codes.map(loadPx)) : null; });
  }
  function viewSector(gid, kid) {
    var g = S.idx.tree.filter(function (x) { return x.id === gid; })[0], k = g && g.kids.filter(function (x) { return x.id === kid; })[0];
    if (!k) return viewHome();
    if (k.cos.some(function (c) { return !S.co[c] || !S.px[c]; })) { main.innerHTML = '<div class="boot"><i></i><i></i><i></i></div>'; return ensureCo(k.cos, true).then(function () { if (location.hash.indexOf(gid + "/" + kid) >= 0) viewSector(gid, kid); }); }
    var cos = k.cos.map(function (c) { return S.co[c]; }).filter(Boolean);
    main.innerHTML = '<div class="crumb rv"><a href="#">선행지표</a><i>›</i><span>' + esc(g.n) + "</span><i>›</i><b>" + esc(k.n) + "</b></div>" +
      '<header class="sec-head rv"><span class="eyebrow">' + esc(g.en) + " · PEER GROUP</span><h1>" + esc(k.n) + "</h1><p>" + esc(k.desc || "") + "</p></header>" +
      '<div class="pgrid">' + cos.map(function (co) {
        var q = quote(co.c), it = bestIt(co), s = stat(co, it);
        return '<a class="card pc rv" href="#c/' + co.c + '"><div class="pc-top"><div><h3>' + esc(co.n) + '</h3><span class="jp">' + esc(co.jp) + " · " + co.c + " · " + esc(co.market) + "</span></div>" +
          (q ? '<div class="px"><b>' + nf(q.last) + '</b><span class="mono ' + ud(q.chg) + '">' + pct(q.chg) + "</span></div>" : "") + "</div>" +
          '<div class="pc-mini" data-lazy="mini:' + co.c + '"></div>' +
          '<div class="pc-kv"><div><span>' + esc(it.short) + " " + ymLab(s.last[0]) + "</span><b>" + nf(s.last[1]) + '</b></div><div><span>전년 대비</span><b class="' + ud(s.yoy) + '">' + pct(s.yoy) + "</b></div><div><span>다음 지표 발표</span><b>" + dlab(co.lead.next.date) + "</b></div></div></a>";
      }).join("") + "</div>" +
      '<div class="sec-t rv"><span class="n">PEER</span><h2>선행지표 나란히</h2><p>같은 원천 · 같은 계산</p></div>' +
      '<div class="card rv"><div class="card-b"><div class="tw"><table class="cmp"><thead><tr><th>기업</th><th>선행지표</th><th>전월 대비</th><th>전년 대비</th><th>최근 3개월 연율</th><th>R(분기 평균 vs 매출)</th><th>이번 분기 매출 추정</th><th>다음 지표 · 실적</th></tr></thead><tbody>' +
      cos.map(function (co) {
        var s = stat(co, bestIt(co));
        return '<tr><td><a href="#c/' + co.c + '"><b>' + esc(co.n) + '</b></a> <span class="mono">' + co.c + "</span><small>" + esc(bestIt(co).short) + "</small></td>" +
          '<td class="mono">' + nf(s.last[1]) + "<small>" + ymLab(s.last[0]) + '</small></td><td class="mono ' + ud(s.mom) + '">' + sgn(s.mom) + '</td><td class="mono ' + ud(s.yoy) + '">' + pct(s.yoy) + '</td><td class="mono ' + ud(s.g3) + '">' + pct(s.g3) + "</td>" +
          '<td class="mono">' + (s.r != null ? nf(s.r, 2) : "—") + "<small>n=" + s.n + '</small></td><td class="mono">' + (s.est ? nf(s.est.mid, 1) + "억엔<small>" + s.est.q + " · " + s.est.n + "/3개월 반영</small>" : "—") + '</td><td class="mono">' + dlab(co.lead.next.date) + "<small>실적 " + dlab(co.next.date) + "</small></td></tr>";
      }).join("") + "</tbody></table></div></div></div>";
    cos.forEach(function (co) { LAZY["mini:" + co.c] = function (host) { drawMini(co, host); }; });
    reveal(main);
  }
  function drawMini(co, host) {
    var px = S.px[co.c] || []; if (!px.length) return;
    if (!bestIt(co) || !bestIt(co).pts.length) return;
    var it = bestIt(co), W = host.clientWidth || 360, H = 110, L = px[px.length - 1].t, F = Math.min(ymT(it.pts[0][0]) - 20 * DAY, L - 365 * DAY);
    var rows = px.filter(function (r) { return r.t >= F; });
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none" });
    host.innerHTML = ""; host.appendChild(svg);
    var x = function (t) { return (t - F) / (L + 15 * DAY - F) * W; };
    var vs = it.pts.map(function (p) { return p[1]; }), mx = Math.max.apply(null, vs), mn = Math.min.apply(null, vs) * 0.9;
    var defs = el("defs", {}, svg), gr = el("linearGradient", { id: "gm" + co.c, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "var(--b1)", "stop-opacity": ".6" }, gr); el("stop", { offset: "1", "stop-color": "var(--b1)", "stop-opacity": ".08" }, gr);
    var bw = W / 16 * 0.62;
    it.pts.forEach(function (p) { var h = (p[1] - mn) / (mx - mn) * 44 + 4; el("rect", { x: x(ymT(p[0])) - bw / 2, y: H - h, width: bw, height: h, rx: 2, fill: "url(#gm" + co.c + ")", "class": "grow" }, svg); });
    var lo = Math.min.apply(null, rows.map(function (r) { return r.c; })), hi = Math.max.apply(null, rows.map(function (r) { return r.c; }));
    var y = function (v) { return 6 + (1 - (v - lo) / (hi - lo || 1)) * (H - 40); };
    el("path", { d: rows.map(function (r, i) { return (i ? "L" : "M") + x(r.t).toFixed(1) + "," + y(r.c).toFixed(1); }).join(""), "class": "pline draw", "vector-effect": "non-scaling-stroke" }, svg);
    animate(svg);
  }

  /* ---------- 기업 ---------- */
  function viewCompany(c) {
    var co = S.co[c]; if (!co) return viewHome();
    var g = co.sec.split("/"), G = S.idx.tree.filter(function (x) { return x.id === g[0]; })[0], K = G.kids.filter(function (x) { return x.id === g[1]; })[0];
    var q = quote(c), d = dday(co.next.date), it0 = co.lead.items[0];
    var best = co.lead.items.filter(function (x) { return x.pts.length >= 12; })[0] || it0;
    var st = S.st[c] = S.st[c] || { li: best.id, ov: best.id, mode: "candle", range: "1Y", rel: true };
    var ringC = 2 * Math.PI * 19, ringP = Math.max(0, Math.min(1, 1 - d / 92)), nd = dday(co.lead.next.date);

    var hero = '<div class="crumb rv"><a href="#">선행지표</a><i>›</i><span>' + esc(G.n) + '</span><i>›</i><a href="#s/' + co.sec + '">' + esc(K.n) + "</a><i>›</i><b>" + esc(co.n) + "</b></div>" +
      '<section class="hero rv"><div><span class="eyebrow">' + esc(co.en.toUpperCase()) + " · " + c + " · TSE " + esc(co.market) + "</span>" +
      "<h1>" + esc(co.n) + '<span class="jp">' + esc(co.jp) + "</span></h1>" +
      '<div class="codes"><span class="chip">' + esc(co.fy.label) + '</span><span class="chip acc">' + esc(K.n) + "</span>" + co.tags.map(function (t) { return '<span class="chip">' + esc(t) + "</span>"; }).join("") + "</div>" +
      '<p class="about">' + esc(co.about) + '</p><div class="thesis">' + esc(co.thesis) + "</div></div>" +
      '<div class="qbox">' + (q ? '<div class="price"><b data-count="' + q.last + '">' + nf(q.last) + '</b><span class="chg ' + ud(q.chg) + '">' + pct(q.chg, 2) + "</span><small>엔 · " + md(q.t) + " 종가 · 1년 " + pct(q.y1) + "</small></div>" +
        '<div class="range52"><div class="bar"><i id="r52"></i></div><div class="lab"><span>52주 저가 ' + nf(q.lo) + "</span><span>고가 " + nf(q.hi) + "</span></div></div>" +
        '<div class="qv"><span>시가총액</span><b>' + nf(q.mc) + "</b><small>억엔</small></div>" +
        '<div class="qv"><span>PER(회사 예상)</span><b>' + nf(q.per, 1) + "</b><small>배</small></div>" : "") +
      '<div class="qv next"><svg class="ring" viewBox="0 0 46 46"><circle class="bgc" cx="23" cy="23" r="19"/><circle class="fgc" id="ringfg" cx="23" cy="23" r="19" transform="rotate(-90 23 23)" stroke-dasharray="' + ringC.toFixed(1) + '" stroke-dashoffset="' + ringC.toFixed(1) + '"/></svg>' +
      "<div><span>다음 실적 · " + esc(co.next.q) + " (" + esc(co.next.period) + ")</span><b>D-" + d + "</b><small>" + md(tOf(co.next.date)) + (co.next.fixed ? " 확정" : " 예상") + "</small></div></div>" +
      '<div class="qv ind-next"><span>다음 선행지표 발표</span><b>' + (nd > 0 ? "D-" + nd : nd === 0 ? "오늘" : "갱신 대기") + "</b><small>" + md(tOf(co.lead.next.date)) + " · " + co.lead.next.basis.slice(5).replace("-", "/") + " 무렵 기준</small></div>" +
      "</div></section>";

    var lead = '<div class="sec-t rv"><span class="n">01</span><h2>선행지표</h2><p>회사 발표가 아닌 외부 월간 데이터 — 실적보다 먼저 나옴</p></div>' +
      '<section class="card rv" id="lc"><div class="card-h"><div class="ichips" id="lchips">' + co.lead.items.map(function (it) {
        return '<button type="button" class="ichip" data-li="' + it.id + '" aria-pressed="' + (st.li === it.id) + '"><i class="dot"></i>' + esc(it.short) + "<small>" + it.pts.length + "개월</small></button>";
      }).join("") + '</div><span class="sp"></span><span class="chip ind" id="lnext"></span></div>' +
      '<div class="card-b"><div class="lead-grid"><div class="lead-chart"><div class="chart-wrap" id="lw"></div><div class="legend" id="llg"></div></div><div class="lstats" id="ls"></div></div>' +
      '<div class="lwhy"><p><b>왜 보나</b> ' + esc(co.lead.why) + '</p><p><b>주의</b> ' + esc(co.lead.caveat) + '</p><p id="lnote"></p>' + (co.lead.macro && co.lead.macro.length ? '<p><b>추가 예정 시장 통계</b> ' + co.lead.macro.map(function (m) { return esc(m.name || m.id) + (m.why ? ' <span class="how">— ' + esc(m.why) + '</span>' : ''); }).join(' · ') + '</p>' : '') + '</div></div></section>';

    var price = '<div class="sec-t rv"><span class="n">02</span><h2>주가 × 선행지표</h2><p>월간 선행지표를 주가 아래 띠에 겹쳐 보기 · 금색 점선 = 실적 발표일과 다음 날 주가 반응</p></div>' +
      '<section class="card rv" id="mc"><div class="card-h"><div class="ctl">' +
      '<span class="lab">겹칠 지표</span><div class="seg" id="ovsel">' + co.lead.items.map(function (it) { return '<button data-v="' + it.id + '" aria-pressed="' + (st.ov === it.id) + '">' + esc(it.short.replace("연금 가입자 · ", "")) + "</button>"; }).join("") + '<button data-v="" aria-pressed="' + (!st.ov) + '">끄기</button></div></div><span class="sp"></span>' +
      '<div class="ctl">' +
      '<div class="seg" id="prange" role="group" aria-label="기간">' + ["3M", "6M", "1Y", "2Y", "3Y", "ALL"].map(function (r) { return '<button data-v="' + r + '" aria-pressed="' + (st.range === r) + '">' + (r === "ALL" ? "전체" : r) + "</button>"; }).join("") + "</div>" +
      '<div class="seg"><button id="zin" aria-label="확대" title="확대">＋</button><button id="zout" aria-label="축소" title="축소">－</button></div>' +
      '<div class="seg"><button data-v="rel" id="prel" aria-pressed="' + st.rel + '">발표일</button></div></div></div>' +
      '<div class="card-b"><div class="chart-wrap pan" id="cw"></div><div class="nav-wrap" id="nw"></div>' +
      '<div class="legend"><span><i class="lg-up"></i>상승</span><span><i class="lg-dn"></i>하락</span><span><i class="lg-ind"></i><b id="lgname"></b> (월, 띠 안 막대)</span><span><i class="lg-ghost"></i>다음 지표 발표 자리</span><span><i class="lg-rel"></i>실적 발표일</span></div>' +
      '<p class="hint">차트 위에서 <b>마우스 휠</b> = 확대·축소, <b>끌기</b> = 앞뒤 이동, <b>두 번 클릭</b> = 1년으로. 아래 작은 차트는 아무 데나 누르면 그 자리로, 보라 상자는 끌어서 이동, 양 끝을 잡으면 넓히기·좁히기. 1년 넘는 기간은 주봉.</p></div></section>';

    var ref = '<div class="sec-t rv"><span class="n">03</span><h2>참고 — 회사 발표 숫자</h2><p>결과 확인용 · 선행지표 아님</p></div>' + refTable(co);
    var rep = '<div class="sec-t rv"><span class="n">04</span><h2>2단계 리포트</h2><p>기업 분석 원본</p></div>' + (co.report ?
      '<a class="card rep rv" href="' + esc(co.report.html) + '" target="_blank" rel="noopener"><span class="ic">2단계</span><div><h3>' + esc(co.report.title) + ' <small class="mono">' + esc(co.report.written) + "</small></h3><p>" + esc(co.report.verdict) + '</p></div><span class="go">리포트 열기 ↗</span></a>' :
      '<div class="card rep rv none"><span class="ic">2단계</span><div><h3>아직 없음</h3><p>2단계 리포트를 쓰면 여기에 연결됩니다.</p></div></div>');
    var ir = '<div class="sec-t rv"><span class="n">05</span><h2>IR 자료</h2><p>모아 둔 결산 설명자료·단신</p></div>' + irBlock(co);
    var map = '<div class="sec-t rv"><span class="n">06</span><h2>데이터 출처 매핑</h2><p>자동 업데이트할 때 어디서 무엇을 읽는지</p></div>' + mapBlock(co) +
      '<div class="sec-t rv"><span class="n">07</span><h2>수정 이력</h2><p>나중에 텔레그램으로 말한 수정이 여기에 쌓입니다</p></div><div class="card rv"><div class="card-b log">' +
      co.log.map(function (l) { return '<div><span class="d">' + esc(l.d) + '</span><span class="by">' + esc(l.by) + "</span><span>" + esc(l.t) + "</span></div>"; }).join("") + "</div></div>";

    main.innerHTML = hero + lead + price + ref + rep + ir + map;
    if (q) setTimeout(function () { var r = document.getElementById("r52"); if (r) r.style.left = ((q.last - q.lo) / (q.hi - q.lo || 1) * 100).toFixed(1) + "%"; }, 120);
    setTimeout(function () { var f = document.getElementById("ringfg"); if (f) f.style.strokeDashoffset = (ringC * (1 - ringP)).toFixed(1); }, 200);
    countUp(main);
    drawLead(co, true);
    document.querySelectorAll("#lchips .ichip").forEach(function (b) { b.onclick = function () { st.li = b.dataset.li; document.querySelectorAll("#lchips .ichip").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); drawLead(co, true); }; });
    if (st.from == null) setRange(co, st.range);
    PC.co = null; NV.co = null; drawMain(co, true); bindMain(co);
    main.querySelectorAll("[data-pv]").forEach(function (b) { b.onclick = function () { openLb(b.getAttribute("data-pv"), b.getAttribute("data-cap")); }; });
    reveal(main);
  }

  /* 선행지표 패널 — 위 월 막대 + 아래 분기 매출(같은 시간축) */
  function drawLead(co, anim) {
    var host = document.getElementById("lw"); if (!host) return;
    var st = S.st[co.c], it = item(co, st.li), s = stat(co, it), nd = dday(co.lead.next.date), main1 = it.id === co.lead.items[0].id;
    if (!it.pts.length) { host.innerHTML = '<div class="empty">아직 수집 전입니다 — 다음 갱신(' + md(tOf(co.lead.next.date)) + ')부터 쌓입니다.</div>'; document.getElementById("ls").innerHTML = ""; return; }
    document.getElementById("lnext").textContent = "다음 발표 " + md(tOf(co.lead.next.date)) + " (" + (nd > 0 ? "D-" + nd : nd === 0 ? "오늘" : "갱신 대기") + ") · " + co.lead.next.basis.slice(5).replace("-", "/") + " 무렵 기준";
    document.getElementById("lnote").innerHTML = "<b>대상</b> " + esc(it.entity) + ' <span class="mono">' + esc(it.corp) + "</span> — " + esc(it.note);
    var last = it.pts[it.pts.length - 1][0], pq = co.next.q, endYm = qMonthsList(co, pq)[2], first = it.pts[0][0];
    if (endYm <= last) endYm = ymAdd(last, 1);
    if (ymAdd(first, 24) < endYm) first = ymAdd(endYm, -24);
    if (ymAdd(first, 6) > endYm) first = ymAdd(endYm, -6);
    if (it.stack) first = ymAdd(endYm, -11);
    var months = []; for (var ym = first; ym <= endYm; ym = ymAdd(ym, 1)) months.push(ym);
    var W = Math.max(320, host.clientWidth), pL = 50, pR = 12, IW = W - pL - pR, n = months.length, bw = IW / n;
    var top = 30, h1 = W < 600 ? 170 : 210, gap = 34, h2 = W < 600 ? 130 : 160, yTop = top + h1 + gap, sTop = yTop, H = sTop + h2 + 26;
    var x = function (i) { return pL + bw * (i + 0.5); };
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H });
    var defs = el("defs", {}, svg);
    var gi = el("linearGradient", { id: "gLI", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "var(--b1)", "stop-opacity": ".95" }, gi); el("stop", { offset: "1", "stop-color": "var(--b1)", "stop-opacity": ".35" }, gi);
    var gs = el("linearGradient", { id: "gLS", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "var(--b2)", "stop-opacity": ".8" }, gs); el("stop", { offset: "1", "stop-color": "var(--b2)", "stop-opacity": ".25" }, gs);
    var hp = el("pattern", { id: "hLS", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    el("rect", { width: 6, height: 6, fill: "var(--acc-soft)" }, hp); el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "var(--b2)", "stroke-width": 2, "stroke-opacity": ".7" }, hp);
    var gg = el("g", { "class": "g-grid" }, svg), ga = el("g", { "class": "g-ax" }, svg), gB = el("g", {}, svg), gT = el("g", {}, svg);

    // 분기 띠 · 4월(신졸 입사)
    var Qs = []; months.forEach(function (m, i) { var q = qOfYm(co, m); if (!Qs.length || Qs[Qs.length - 1].q !== q) Qs.push({ q: q, a: i, b: i }); else Qs[Qs.length - 1].b = i; });
    Qs.forEach(function (Q, k) {
      if (k % 2 === 0) el("rect", { x: pL + bw * Q.a, y: top - 24, width: bw * (Q.b - Q.a + 1), height: H - top - 2, fill: "var(--panel-2)", opacity: ".75", rx: 6 }, gB);
      txt(gT, pL + bw * (Q.a + Q.b + 1) / 2, top - 10, Q.q, "q-lab" + (Q.q === pq ? " cur" : ""), "middle");
    });
    months.forEach(function (m, i) { if (m.slice(5) === "04") txt(gT, x(i), top + h1 + 13, "신졸 입사", "apr", "middle"); });

    // 위: 월 막대
    var vals = it.pts.map(function (p) { return p[1]; }), vmax = Math.max.apply(null, vals), vmin = Math.min.apply(null, vals);
    var lo = it.stack ? 0 : Math.max(0, vmin - (vmax - vmin) * 0.55), hi = vmax + (vmax - lo) * 0.2;
    if (hi - lo < 1) { lo = Math.max(0, vmin * 0.6); hi = vmax * 1.15; }
    var pctU = it.unit === "%"; if (pctU) { lo = Math.min(0, vmin * 1.15); hi = Math.max(0, vmax) * 1.2 + 1; }
    var b0 = pctU ? 0 : lo;
    var y1 = function (v) { return top + (1 - (v - lo) / (hi - lo)) * h1; };
    nice(lo, hi, 4).forEach(function (v) { if (v < lo || v > hi) return; el("line", { x1: pL, x2: W - pR, y1: y1(v), y2: y1(v) }, gg); txt(ga, pL - 6, y1(v) + 3.5, nf(v), null, "end"); });
    var bwr = Math.min(34, bw * 0.62), hits = [], stackCols = ["var(--ind)", "var(--acc)", "var(--gold)"];
    months.forEach(function (m, i) {
      var p = mm(it)[m], q = qOfYm(co, m);
      if (p) {
        if (it.stack && p[3]) { var acc = 0; it.stack.forEach(function (sk, j) { var v = p[3][sk[0]]; el("rect", { x: x(i) - bwr / 2, y: y1(acc + v), width: bwr, height: Math.max(1, y1(acc) - y1(acc + v) - 1.5), rx: 2, fill: stackCols[j], opacity: j ? ".8" : ".92", "class": "grow" }, gB); acc += v; }); }
        else el("rect", { x: x(i) - bwr / 2, y: Math.min(y1(p[1]), y1(b0)), width: bwr, height: Math.max(1, Math.abs(y1(b0) - y1(p[1]))), rx: Math.min(4, bwr / 4), fill: p[1] < 0 && pctU ? "var(--down)" : "url(#gLI)", "class": "grow" }, gB);
        var prev = mm(it)[ymAdd(m, -1)], yy = mm(it)[ymAdd(m, -12)];
        txt(gT, x(i), y1(p[1]) - 6, nf(p[1]), "ibar-lab fade", "middle");
        hits.push({ a: i, b: i, up: 1, h: "<h5>" + ymLab(m) + " 무렵<span>" + esc(it.short) + "</span></h5>" + row(NM(it), nf(p[1], DG(it)) + U(it), "ind") + (prev ? row("전월 대비", sgn(p[1] - prev[1]) + U(it)) : "") + (yy ? row("전년 대비", pct((p[1] / yy[1] - 1) * 100)) : "") +
          (p[3] && it.stack ? "<hr>" + it.stack.map(function (sk) { return row(sk[1], nf(p[3][sk[0]]) + U(it)); }).join("") : "") + "<hr>" + row("분기", q + " (" + qMonths(co, q) + ")") + row("출처", esc(co.refs[p[2]] ? co.refs[p[2]].t.split(" — ")[0] : p[2])) });
      } else if (m > last) {
        var gh = y1(lo) - y1(mv(it, last) || vmax), isNext = m === ymAdd(last, 1);
        el("rect", { x: x(i) - bwr / 2, y: y1(lo) - gh, width: bwr, height: gh, rx: 4, fill: "none", stroke: "var(--gold)", "stroke-dasharray": "4 3", "stroke-width": 1.2, opacity: isNext ? 1 : 0.5, "class": "fade" }, gB);
        txt(gT, x(i), y1(lo) - gh / 2 + 4, "?", "ibar-lab cs", "middle");
        if (isNext) { txt(gT, x(i), y1(lo) - gh + 16, md(tOf(co.lead.next.date)).slice(3), "ibar-lab cs fade", "middle"); txt(gT, x(i), y1(lo) - gh + 28, "발표", "ibar-lab cs fade", "middle"); }
        hits.push({ a: i, b: i, up: 1, h: "<h5>" + ymLab(m) + " 무렵<span>미발표</span></h5>" + row("발표 예정", isNext ? md(tOf(co.lead.next.date)) + " (" + dlab(co.lead.next.date) + ")" : "그다음 갱신일") + row("분기", q) });
      } else hits.push({ a: i, b: i, up: 1, h: "<h5>" + ymLab(m) + "<span>기록 전</span></h5>" + row(it.short, "이 달부터 쌓는 중 아님") });
      if (n <= 18 || i % 2 === 0) txt(ga, x(i), H - 6, ymLab(m), null, "middle");
    });

    // 가입자 YoY — 월 막대 위에 겹친 꺾은선(l1, 2026-11-16 사용자: 절댓값 막대엔 웬만하면 YoY 를 같이)
    var iy = it.unit === "%" ? [] : months.map(function (m, i) { var p = mm(it)[m], b = mm(it)[ymAdd(m, -12)]; return p && b && b[1] ? { x: x(i), v: (p[1] / b[1] - 1) * 100 } : null; }).filter(Boolean);
    if (iy.length) {
      var iv = iy.map(function (d) { return d.v; }), ilo = Math.min.apply(null, iv.concat([0])), ihi = Math.max.apply(null, iv.concat([1])) * 1.1;
      var y4 = function (v) { return top + 12 + (1 - (v - ilo) / ((ihi - ilo) || 1)) * (h1 * 0.3); };
      var gi4 = el("g", {}, svg);
      if (iy.length > 1) el("path", { d: iy.map(function (d, i) { return (i ? "L" : "M") + d.x.toFixed(1) + "," + y4(d.v).toFixed(1); }).join(""), fill: "none", stroke: "var(--l1)", "stroke-width": 2, "class": "draw" }, gi4);
      iy.forEach(function (d) { el("circle", { cx: d.x, cy: y4(d.v), r: 4, fill: "var(--l1)", stroke: "var(--panel)", "stroke-width": 2, "class": "fade" }, gi4); txt(gi4, d.x, y4(d.v) - 8, pct(d.v, 1), "ibar-lab cs fade", "middle"); });
    } else txt(gT, pL + 8, top + 8, NM(it) + " YoY: 1년 전 값이 쌓이면 표시", "apr", "start");

    // 아래: 분기 매출(회사 발표 결과) + 이번 분기 추정
    var sv2 = Qs.map(function (Q) { return sv(co, "sales", Q.q); }).filter(function (v) { return v != null; });
    if (s.est && main1) sv2.push(s.est.hi); if (co.consensus && co.consensus.q === pq) sv2.push(co.consensus.sales);
    var smax = Math.max.apply(null, sv2.concat([1])) * 1.05, base2 = sTop + h2;
    var y2 = function (v) { return base2 - v / smax * h2; };
    txt(ga, pL - 6, sTop + 12, "매출", "sub-ax", "end"); txt(ga, pL - 6, sTop + 24, "억엔", "sub-ax", "end");
    el("line", { x1: pL, x2: W - pR, y1: base2, y2: base2, stroke: "var(--line-2)" }, gg);
    Qs.forEach(function (Q) {
      var a = pL + bw * Q.a + 6, w = bw * (Q.b - Q.a + 1) - 12, v = sv(co, "sales", Q.q), cx = a + w / 2, r0 = s.rows.filter(function (r) { return r.q === Q.q; })[0];
      if (v != null) {
        el("rect", { x: a, y: y2(v), width: w, height: base2 - y2(v), rx: 4, fill: "url(#gLS)", "class": "grow" }, gB);
        txt(gT, cx, base2 - 8, nf(v, v < 100 ? 1 : 0), "ibar-lab in fade", "middle");
        hits.push({ a: Q.a, b: Q.b, up: 0, h: "<h5>" + Q.q + "<span>" + qMonths(co, Q.q) + "</span></h5>" + row("매출(회사 발표)", nf(v, 1) + "억엔") + row("매출 YoY", pct(yoy(co, "sales", Q.q))) + (r0 ? "<hr>" + row(NM(it) + " 분기 평균", nf(r0.avg, DG(it)) + U(it) + " (" + r0.n + "/3개월)", "ind") + (r0.ratio ? row(NM(it) + " 1" + U(it) + "당 월매출", nf(r0.ratio, 1) + "만엔") : "") : "") });
      } else if (Q.q === pq && s.est && main1) {
        el("rect", { x: a, y: y2(s.est.mid), width: w, height: base2 - y2(s.est.mid), rx: 4, fill: "url(#hLS)", stroke: "var(--b2)", "stroke-dasharray": "3 2", "class": "grow" }, gB);
        el("path", { d: "M" + (cx - 8) + "," + y2(s.est.lo) + "H" + (cx + 8) + "M" + cx + "," + y2(s.est.lo) + "V" + y2(s.est.hi) + "M" + (cx - 8) + "," + y2(s.est.hi) + "H" + (cx + 8), stroke: "var(--acc-2)", "stroke-width": 1.4, fill: "none" }, gT);
        txt(gT, cx, base2 - 8, "추정 " + nf(s.est.mid, s.est.mid < 100 ? 1 : 0), "ibar-lab est2 in fade", "middle");
        if (co.consensus && co.consensus.q === pq) { el("line", { x1: a - 4, x2: a + w + 4, y1: y2(co.consensus.sales), y2: y2(co.consensus.sales), stroke: "var(--ink)", "stroke-width": 2, "stroke-dasharray": "5 3" }, gT); txt(gT, cx, base2 - 22, "컨센 " + nf(co.consensus.sales), "ibar-lab in", "middle"); }
        hits.push({ a: Q.a, b: Q.b, up: 0, h: "<h5>" + Q.q + " 추정<span>" + qMonths(co, Q.q) + "</span></h5>" + row(NM(it) + " 분기 평균", nf(s.est.avg, DG(it)) + U(it) + " (" + s.est.n + "/3개월)", "ind") + row("× " + NM(it) + " 1" + U(it) + "당 월매출", nf(s.est.ratio, 1) + "만엔(과거 평균)") + row("= 매출 추정", nf(s.est.mid, 1) + "억엔", "ind") + row("범위", nf(s.est.lo, 1) + " ~ " + nf(s.est.hi, 1)) + (s.est.yoy != null ? row("YoY", pct(s.est.yoy)) : "") + (co.consensus ? row("컨센서스", nf(co.consensus.sales) + "억엔") : "") });
      }
    });

    // 매출 YoY — 매출 막대 위에 겹친 꺾은선(2026-11-16 사용자). 축 없이 점마다 값
    var sy = Qs.map(function (Q) { var v = yoy(co, "sales", Q.q); return v != null ? { x: pL + bw * (Q.a + Q.b + 1) / 2, v: v } : null; }).filter(Boolean);
    var ey = s.est && main1 && s.est.yoy != null ? Qs.filter(function (Q) { return Q.q === s.est.q; }).map(function (Q) { return { x: pL + bw * (Q.a + Q.b + 1) / 2, v: s.est.yoy }; })[0] : null;
    var yv = sy.map(function (d) { return d.v; }).concat(ey ? [ey.v] : []);
    if (yv.length) {
      var ylo = Math.min.apply(null, yv.concat([0])), yhi = Math.max.apply(null, yv) * 1.08;
      var y3 = function (v) { return sTop + 22 + (1 - (v - ylo) / ((yhi - ylo) || 1)) * (h2 * 0.42); };
      var gy = el("g", { "class": "yov" }, svg);
      if (sy.length > 1) el("path", { d: sy.map(function (d, i) { return (i ? "L" : "M") + d.x.toFixed(1) + "," + y3(d.v).toFixed(1); }).join(""), fill: "none", stroke: "var(--l1)", "stroke-width": 2, "stroke-linejoin": "round", "class": "draw" }, gy);
      if (ey && sy.length) { var lp = sy[sy.length - 1]; el("path", { d: "M" + lp.x + "," + y3(lp.v) + "L" + ey.x + "," + y3(ey.v), fill: "none", stroke: "var(--l1)", "stroke-width": 1.6, "stroke-dasharray": "4 3" }, gy); }
      sy.forEach(function (d) { el("circle", { cx: d.x, cy: y3(d.v), r: 4, fill: "var(--l1)", stroke: "var(--panel)", "stroke-width": 2, "class": "fade" }, gy); txt(gy, d.x, y3(d.v) - 9, pct(d.v, 1), "ibar-lab cs fade", "middle"); });
      if (ey) { el("circle", { cx: ey.x, cy: y3(ey.v), r: 4.5, fill: "var(--panel)", stroke: "var(--l1)", "stroke-width": 2, "class": "fade" }, gy); txt(gy, ey.x, y3(ey.v) - 9, pct(ey.v, 0) + " 추정", "ibar-lab cs fade", "middle"); }
    }
    var hl = el("rect", { fill: "var(--ink)", opacity: 0, rx: 6 }, gB);
    hits.forEach(function (h) {
      var a = pL + bw * h.a, w = bw * (h.b - h.a + 1), yy = h.up ? top - 24 : sTop - 6, hh = h.up ? h1 + 44 : h2 + 10;
      var r = el("rect", { x: a, y: yy, width: w, height: hh, fill: "transparent" }, svg);
      r.addEventListener("mousemove", function (ev) { hl.setAttribute("x", a); hl.setAttribute("y", yy); hl.setAttribute("width", w); hl.setAttribute("height", hh); hl.setAttribute("opacity", ".05"); showTip(h.h, ev); });
      r.addEventListener("mouseleave", function () { hl.setAttribute("opacity", 0); hideTip(); });
    });
    host.innerHTML = ""; host.appendChild(svg);
    if (anim) animate(svg);
    document.getElementById("llg").innerHTML = (it.stack ? it.stack.map(function (sk, j) { return '<span><i class="lg-s' + j + '"></i>' + esc(sk[1]) + "</span>"; }).join("") : '<span><i class="lg-ind"></i>' + esc(it.short) + " (월)</span>") +
      '<span><i class="lg-ghost"></i>미발표 달</span><span><i class="lg-l1"></i>' + esc(NM(it)) + ' YoY · 매출 YoY(각 막대 위 겹침)</span><span><i class="lg-sales"></i>분기 매출(회사 발표 결과)</span>' + (main1 ? '<span><i class="lg-est2"></i>이번 분기 매출 추정(' + esc(NM(it)) + ' 기준)</span>' : "") + (co.consensus ? '<span><i class="lg-cs"></i>컨센서스</span>' : "");
    drawStats(co, it, s);
  }

  function drawStats(co, it, s) {
    var L = s.last, nd = dday(co.lead.next.date), main1 = it.id === co.lead.items[0].id;
    var rCls = s.r == null ? "" : s.r >= 0.8 ? "hi" : s.r >= 0.5 ? "mid" : "lo";
    var h = '<div class="ls-box nx"><span>다음 선행지표 발표</span><b class="mono">' + (nd > 0 ? "D-" + nd : nd === 0 ? "오늘" : "갱신 대기") + '</b><div class="ls-sub"><span>' + md(tOf(co.lead.next.date)) + " · " + co.lead.next.basis.slice(5).replace("-", "/") + " 무렵 기준</span><span>" + (function () { var g = Math.round((tOf(co.next.date) - tOf(co.lead.next.date)) / DAY); return g > 0 ? "실적(" + md(tOf(co.next.date)) + ")보다 " + g + "일 먼저" : "이번 실적(" + md(tOf(co.next.date)) + ") 뒤 갱신"; })() + "</span></div></div>";
    h += '<div class="ls-box"><span>최신 값 · ' + ymLab(L[0]) + ' 무렵</span><b class="mono">' + nf(L[1], DG(it)) + '<small>' + U(it) + '</small></b><div class="ls-sub"><span class="' + ud(s.mom) + '">전월 ' + (it.unit === "%" ? (s.mom > 0 ? "+" : "") + nf(s.mom, 1) + "%p" : sgn(s.mom)) + "</span>" + (s.yoy != null ? '<span class="' + ud(s.yoy) + '">전년 ' + pct(s.yoy) + "</span>" : "") + "</div></div>";
    if (true) {
      h += '<div class="ls-box r ' + rCls + '"><span>R · 분기 평균 ' + esc(NM(it)) + ' vs 분기 매출</span><b class="mono">' + (s.r == null ? "—" : nf(s.r, 2)) + '</b><div class="ls-sub"><span>n=' + s.n + "개 분기</span><span>" + (s.n < 6 ? "데이터 쌓이는 중 — 참고용" : "") + '</span></div><div class="rbar"><i data-w="' + Math.max(0, (s.r || 0) * 100).toFixed(0) + '"></i></div></div>';
      if (s.est) h += '<div class="ls-box est"><span>' + s.est.q + " 매출 추정 · " + NM(it) + " " + s.est.n + '/3개월 반영</span><b class="mono">' + nf(s.est.mid, 1) + '<small>억엔</small></b><div class="ls-sub"><span>범위 ' + nf(s.est.lo, 1) + "~" + nf(s.est.hi, 1) + "</span>" + (s.est.yoy != null ? '<span class="' + ud(s.est.yoy) + '">YoY ' + pct(s.est.yoy) + "</span>" : "") + "</div>" +
        (co.consensus && co.consensus.q === s.est.q ? '<div class="ls-cs">컨센서스 ' + nf(co.consensus.sales) + '억엔 대비 <b class="' + ud(s.est.mid - co.consensus.sales) + '">' + pct((s.est.mid / co.consensus.sales - 1) * 100) + "</b></div>" : "") + "</div>";
    } else h += '<div class="ls-box"><span>기록</span><b class="mono">' + it.pts.length + '<small>개월</small></b><div class="ls-sub"><span>' + esc(it.note) + "</span></div></div>";
    var box = document.getElementById("ls"); box.innerHTML = h;
    setTimeout(function () { box.querySelectorAll(".rbar i").forEach(function (i) { i.style.width = i.getAttribute("data-w") + "%"; }); }, 150);
  }

  function refTable(co) {
    var qq = qsOf(co, "sales").slice(-8), hasSga = !!co.series.sga;
    return '<div class="card rv"><div class="card-b"><div class="tw"><table class="kt"><thead><tr><th>분기</th>' + qq.map(function (q) { return "<th>" + q + "</th>"; }).join("") + "</tr></thead><tbody>" +
      "<tr><td>매출(억엔)</td>" + qq.map(function (q) { return '<td class="mono">' + nf(sv(co, "sales", q), sv(co, "sales", q) < 100 ? 1 : 0) + "</td>"; }).join("") + "</tr>" +
      "<tr><td>매출 YoY</td>" + qq.map(function (q) { var v = yoy(co, "sales", q); return '<td class="mono ' + ud(v) + '">' + pct(v) + "</td>"; }).join("") + "</tr>" +
      (co.series.cons ? "<tr><td>컨설턴트 수(분기말)</td>" + qq.map(function (q) { return '<td class="mono">' + nf(sv(co, "cons", q)) + "</td>"; }).join("") + "</tr>" +
      "<tr><td>인당 월매출(만엔)</td>" + qq.map(function (q) { return '<td class="mono">' + nf(ph(co, q), 1) + "</td>"; }).join("") + "</tr>" : "") +
      (function () { var it = co.lead.items[0]; return "<tr><td>" + esc(NM(it)) + " 1" + U(it) + "당 월매출(만엔)</td>" + qq.map(function (q) { var r = stat(co, it).rows.filter(function (x) { return x.q === q && x.n === 3; })[0]; return '<td class="mono">' + (r && r.ratio ? nf(r.ratio, 1) : "—") + "</td>"; }).join("") + "</tr>"; })() +
      (hasSga ? "<tr><td>판관비 YoY</td>" + qq.map(function (q) { return '<td class="mono">' + pct(yoy(co, "sga", q)) + "</td>"; }).join("") + "</tr>" : "") +
      "</tbody></table></div>" +
      '<p class="hint">결산단신·설명자료 숫자. 인당 월매출 = 분기 매출 ÷ (전 분기말 + 이번 분기말 컨설턴트)/2 ÷ 3. 회사 전망·가이던스는 선행지표로 쓰지 않습니다.</p></div></div>';
  }

  function irBlock(co) {
    var docs = co.ir.docs, top = docs[0];
    var g = '<div class="irg">' + docs.map(function (d) {
      var r = co.refs[d.ref], u = r.local ? r.local : co.ir.tdnet + r.doc + ".pdf";
      return '<a class="irc rv" href="' + esc(u) + '" target="_blank" rel="noopener"><div class="th' + (d.thumb ? "" : " none") + '">' + (d.thumb ? '<img src="' + esc(d.thumb) + '" alt="" loading="lazy">' : "PDF") + '<span class="kind chip ' + (d.kind === "설명자료" ? "acc" : "") + '">' + esc(d.kind) + "</span></div>" +
        '<div class="bd"><b>' + esc(r.t) + "</b><span>" + md(tOf(r.date)) + (d.pages ? " · " + d.pages + "쪽" : "") + (r.local ? " · 사이트 보관" : " · JPX 원문") + "</span></div></a>";
    }).join("") + "</div>";
    var hl = top.hl ? '<div class="hlrow">' + top.hl.map(function (h) { return '<button type="button" class="rv" data-pv="' + esc(h.img) + '" data-cap="' + esc("p." + h.p + " · " + h.cap) + '"><img src="' + esc(h.img) + '" alt="" loading="lazy"><span><b>p.' + h.p + "</b>" + esc(h.cap) + "</span></button>"; }).join("") + "</div>" : "";
    return g + hl + '<p class="hint">' + (co.ir.lib ? '회사 IR 자료실 <a href="' + esc(co.ir.lib) + '" target="_blank" rel="noopener">' + esc(co.ir.lib) + "</a> · " : "") + "TDnet 원문은 JPX 공식 아카이브로 연결됩니다.</p>";
  }

  function autoTag(a) { return '<span class="auto ' + (a === "자동" ? "a" : a === "반자동" ? "s" : "m") + '">' + esc(a) + "</span>"; }
  function mapBlock(co) {
    var rows = [];
    co.lead.items.forEach(function (it) {
      var L = it.pts[it.pts.length - 1], refs = [];
      it.pts.forEach(function (p) { if (refs.indexOf(p[2]) < 0) refs.push(p[2]); });
      it.src.forEach(function (s, k) {
        rows.push('<tr class="' + (k ? "" : "lead-row") + '"><td>' + (k ? "" : '<span class="chip ind">선행지표</span> <b>' + esc(it.short) + '</b><span class="how">' + esc(it.corp) + " · " + it.pts.length + "개월 " + ymLab(it.pts[0][0]) + "~" + ymLab(L[0]) + "</span>") + "</td>" +
          "<td>" + esc(s.doc) + '<span class="how">' + esc(s.where) + "</span></td><td>" + esc(s.freq) + "</td><td>" + autoTag(s.auto) + '<span class="how">' + esc(s.how) + "</span></td>" +
          '<td class="v">' + (k ? "" : nf(L[1]) + '<span class="how">' + ymLab(L[0]) + "</span>") + "</td><td>" + refLink(co, refs[k] || refs[0], "원천 열기") + "</td></tr>");
      });
    });
    rows.push('<tr><td><b>다음 지표 발표일</b><span class="how">D-day 알림에 씀</span></td><td>' + esc(co.lead.next.note) + "</td><td>월 1회</td><td>" + autoTag("자동") + '<span class="how">갱신일에 100억 수집 → 이 원장 반영</span></td><td class="v">' + md(tOf(co.lead.next.date)) + '<span class="how">' + dlab(co.lead.next.date) + "</span></td><td>—</td></tr>");
    rows.push('<tr><td><b>분기 매출</b><span class="how">R·추정 계산용 결과값</span></td><td>결산단신 · 설명자료</td><td>분기</td><td>' + autoTag("자동") + '<span class="how">jp_guidance 누계 → 분기 차감</span></td><td class="v">' + nf(sv(co, "sales", qsOf(co, "sales").slice(-1)[0]), 1) + "</td><td>—</td></tr>");
    rows.push('<tr><td><b>주가(일봉)</b></td><td>야후 파이낸스 시세<span class="how">data/jp/px/' + co.c + ".json</span></td><td>매일 10:00 · 15:30</td><td>" + autoTag("자동") + '<span class="how">tools/build_px.py</span></td><td class="v">' + (quote(co.c) ? nf(quote(co.c).last) : "—") + "</td><td>—</td></tr>");
    if (co.consensus) rows.push('<tr><td><b>컨센서스 매출</b></td><td>' + esc(co.refs[co.consensus.ref].t) + "</td><td>수시</td><td>" + autoTag("수동") + '<span class="how">jp_consensus 로 갱신 예정</span></td><td class="v">' + nf(co.consensus.sales) + '<span class="how">' + co.consensus.q + "</span></td><td>—</td></tr>");
    return '<div class="card rv"><div class="card-b"><div class="tw"><table class="mt"><thead><tr><th>지표</th><th>원천 · 위치</th><th>주기</th><th>자동화</th><th>최근 값</th><th>근거</th></tr></thead><tbody>' + rows.join("") + "</tbody></table></div>" +
      '<p class="hint">R = 선행지표를 분기(3개월 모두 있는 분기)로 평균 내어 같은 분기 매출과 잰 상관계수. 이번 분기 추정 = 지금까지 나온 달의 평균 지표 × 과거 분기 「지표 1단위당 월매출」 평균 × 3(범위 = 그 비율의 최저~최고). 값마다 원천이 원장(data/jp/lead/' + co.c + ".json)에 붙어 있습니다.</p></div></div>";
  }

  /* ---------- 주가 차트(한 번 만들고 층만 다시 그림 — 끌기·휠이 끊기지 않게) ---------- */
  var PC = { co: null }, NV = { co: null };
  function rangeDays(r) { return { "3M": 91, "6M": 182, "1Y": 365, "2Y": 730, "3Y": 1095 }[r] || 99999; }
  function setRange(co, r) { var px = S.px[co.c] || [], st = S.st[co.c]; if (!px.length) return; st.range = r; st.to = px[px.length - 1].t; st.from = Math.max(px[0].t, st.to - rangeDays(r) * DAY); }
  function markRange(co) { var st = S.st[co.c]; document.querySelectorAll("#prange button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.v === st.range); }); }
  function clampRange(co, f, t) {
    var px = S.px[co.c], F = px[0].t, L = px[px.length - 1].t, span = Math.max(25 * DAY, Math.min(t - f, L - F));
    if (f < F) f = F; if (f + span > L) f = L - span;
    return [f, f + span];
  }

  function buildMain(co) {
    var host = document.getElementById("cw");
    var W = Math.max(320, host.clientWidth), H = W < 600 ? 360 : 450;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": co.n + " 주가" });
    var defs = el("defs", {}, svg);
    var gi = el("linearGradient", { id: "gInd", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "var(--b1)", "stop-opacity": ".55" }, gi); el("stop", { offset: "1", "stop-color": "var(--b1)", "stop-opacity": ".08" }, gi);
    var ga = el("linearGradient", { id: "gArea", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "var(--b2)", "stop-opacity": ".28" }, ga); el("stop", { offset: "1", "stop-color": "var(--b2)", "stop-opacity": "0" }, ga);
    var cp = el("clipPath", { id: "clipP" }, defs), cpr = el("rect", { x: 0, y: 0, width: W, height: H }, cp);
    var L = { grid: el("g", { "class": "g-grid" }, svg), ax: el("g", { "class": "g-ax" }, svg) };
    L.body = el("g", { "clip-path": "url(#clipP)" }, svg); L.ind = el("g", {}, L.body); L.price = el("g", {}, L.body);
    L.lab = el("g", {}, svg); L.rel = el("g", { "class": "rel" }, svg); L.last = el("g", { "class": "lastp" }, svg);
    L.xh = el("g", { "class": "xh", visibility: "hidden" }, svg);
    L.vl = el("line", {}, L.xh); L.hl = el("line", {}, L.xh); L.dr = el("rect", { width: 64, height: 17, rx: 4 }, L.xh); L.dt = txt(L.xh, 0, 0, ""); L.pr = el("rect", { height: 18, rx: 4 }, L.xh); L.pt = txt(L.xh, 0, 0, "");
    L.ov = el("rect", { fill: "transparent", "class": "ovr" }, svg);
    host.innerHTML = ""; host.appendChild(svg);
    PC = { co: co, svg: svg, L: L, W: W, H: H, cpr: cpr, M: null };
    bindPan(co);
  }

  function drawMain(co, anim) {
    var host = document.getElementById("cw"); if (!host) return;
    var st = S.st[co.c], px = S.px[co.c] || [];
    if (!px.length) { host.innerHTML = '<div class="empty">주가 자료가 없습니다.</div>'; return; }
    if (PC.co !== co || !PC.svg || !PC.svg.isConnected || Math.abs(PC.W - Math.max(320, host.clientWidth)) > 2) buildMain(co);
    var L = PC.L, W = PC.W, H = PC.H, pL = 6, pR = 64, pT = 34, pB = 24;
    ["grid", "ax", "ind", "price", "lab", "rel", "last"].forEach(function (k) { clear(L[k]); });
    var it = st.ov ? item(co, st.ov) : null;
    document.getElementById("lgname").textContent = it ? it.short : "겹치기 꺼짐";
    var from = st.from, to = st.to, lastT = px[px.length - 1].t;
    var sub = px.filter(function (r) { return r.t >= from && r.t <= to; });
    var wk = (to - from) / DAY > 400, bars = wk ? weekly(sub) : sub;
    if (!bars.length) return;
    var xEnd = to, nrel = tOf(co.next.date), nlead = tOf(co.lead.next.date);
    if (to >= lastT - 3 * DAY) { xEnd = to + (to - from) * 0.035; [nrel, nlead].forEach(function (t) { if (t > to && t - to < 75 * DAY) xEnd = Math.max(xEnd, t + (to - from) * 0.03); }); }
    var IW = W - pL - pR, bot = H - pB, PH = bot - pT;
    var x = function (t) { return pL + (t - from) / (xEnd - from) * IW; };
    var lo = Math.min.apply(null, bars.map(function (b) { return b.l; })), hi = Math.max.apply(null, bars.map(function (b) { return b.h; }));
    var padv = (hi - lo) * 0.06; lo -= padv; hi += padv;
    var pTop = pT + 4, pBot = it ? bot - PH * 0.27 : bot - 6;
    var y = function (v) { return pTop + (1 - (v - lo) / (hi - lo)) * (pBot - pTop); };
    PC.cpr.setAttribute("x", pL); PC.cpr.setAttribute("width", IW);
    PC.M = { from: from, xEnd: xEnd, IW: IW, pL: pL, pR: pR, pTop: pTop, pBot: pBot, lo: lo, hi: hi, bars: bars, wk: wk, it: it };

    var lastY = y(px.filter(function (r) { return r.t <= to; }).slice(-1)[0].c);
    nice(lo, hi, 5).forEach(function (v) { var yy = y(v); if (yy < pTop - 2 || yy > pBot + 2) return; el("line", { x1: pL, x2: pL + IW, y1: yy, y2: yy }, L.grid); if (Math.abs(yy - lastY) > 14) txt(L.ax, W - pR + 8, yy + 3.5, nf(v)); });
    var span = (xEnd - from) / DAY;
    if (span < 130) { for (var wt = from + (7 - ((from / DAY + 3) % 7)) * DAY; wt < xEnd; wt += 14 * DAY) { el("line", { x1: x(wt), x2: x(wt), y1: pT, y2: bot }, L.grid); txt(L.ax, x(wt), H - 6, md(wt).slice(3), null, "middle"); } }
    else {
      var stepM = span > 1500 ? 6 : span > 700 ? 3 : span > 300 ? 2 : 1, d0 = new Date(from), mt = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1);
      for (; mt < xEnd;) { var dm = new Date(mt), mo = dm.getUTCMonth(); if (mo % stepM === 0) { var xx = x(mt); el("line", { x1: xx, x2: xx, y1: pT, y2: bot }, L.grid); txt(L.ax, xx, H - 6, mo === 0 ? String(dm.getUTCFullYear()) : String(dm.getUTCFullYear()).slice(2) + "." + pad(mo + 1), null, "middle"); } mt = Date.UTC(dm.getUTCFullYear(), mo + 1, 1); }
    }

    if (it) {   // 선행지표 띠(월 막대)
      var bandTop = bot - PH * 0.36, bandBot = bot - 2;
      el("rect", { x: pL, y: bandTop, width: IW, height: bandBot - bandTop, "class": "ind-band" }, L.ind);
      var vs = it.pts.map(function (p) { return p[1]; }), vmax = Math.max.apply(null, vs), vmin = Math.min.apply(null, vs), base = it.stack ? 0 : Math.max(0, vmin - (vmax - vmin) * 0.6);
      var bh = function (v) { return (v - base) / ((vmax - base) || 1) * (bandBot - bandTop - 26); };
      var bw = Math.max(2, Math.min(26, 30 * DAY / (xEnd - from) * IW * 0.62));
      var shown = it.pts.filter(function (p) { var t = ymT(p[0]); return t >= from - 15 * DAY && t <= xEnd + 15 * DAY; });
      shown.forEach(function (p, i) {
        var cx = x(ymT(p[0])), h = Math.max(2, bh(p[1]));
        el("rect", { x: cx - bw / 2, y: bandBot - h, width: bw, height: h, rx: Math.min(3, bw / 4), "class": "ibar grow" }, L.ind);
        if (cx > pL + 16 && cx < pL + IW - 12 && (shown.length <= 16 || i % 2 === shown.length % 2 || i === shown.length - 1)) txt(L.lab, cx, bandBot - h - 5, nf(p[1]), "ibar-lab fade", "middle");
      });
      var py = shown.map(function (p) { var b = mm(it)[ymAdd(p[0], -12)]; return b ? { x: x(ymT(p[0])), v: (p[1] / b[1] - 1) * 100 } : null; }).filter(Boolean);
      if (py.length) {
        var pv = py.map(function (d) { return d.v; }), plo = Math.min.apply(null, pv.concat([0])), phi = Math.max.apply(null, pv.concat([1])) * 1.1;
        var y5 = function (v) { return bandTop + 6 + (1 - (v - plo) / ((phi - plo) || 1)) * (bandBot - bandTop) * 0.3; };
        if (py.length > 1) el("path", { d: py.map(function (d, i) { return (i ? "L" : "M") + d.x.toFixed(1) + "," + y5(d.v).toFixed(1); }).join(""), fill: "none", stroke: "var(--l1)", "stroke-width": 1.8 }, L.lab);
        py.forEach(function (d) { el("circle", { cx: d.x, cy: y5(d.v), r: 3.5, fill: "var(--l1)", stroke: "var(--panel)", "stroke-width": 1.5 }, L.lab); txt(L.lab, d.x, y5(d.v) - 7, pct(d.v, 0), "ibar-lab cs", "middle"); });
      }
      var ny = ymAdd(it.pts[it.pts.length - 1][0], 1), nt = ymT(ny);
      if (nt >= from && nt <= xEnd) { var gh = Math.max(8, bh(it.pts[it.pts.length - 1][1])), cx2 = x(nt); el("rect", { x: cx2 - bw / 2, y: bandBot - gh, width: bw, height: gh, rx: 3, fill: "none", stroke: "var(--gold)", "stroke-dasharray": "3 2" }, L.ind); if (bw > 14) { txt(L.lab, cx2, bandBot - gh + 14, md(nlead).slice(3), "ibar-lab cs", "middle"); } }
    }

    if (st.rel) {
      Object.keys(co.rel).forEach(function (q) {
        var t = tOf(co.rel[q]); if (t < from || t > xEnd) return;
        var xx = x(t), rx = reaction(px, co.rel[q]);
        el("line", { x1: xx, x2: xx, y1: pT - 6, y2: bot }, L.rel); el("rect", { x: xx - 19, y: 2, width: 38, height: 26, rx: 6 }, L.rel);
        txt(L.rel, xx, 13, q.slice(3)); if (rx != null) txt(L.rel, xx, 24, pct(rx, 1).replace(".0%", "%"), "rx " + ud(rx));
      });
      if (nrel >= from && nrel <= xEnd) { var nx = x(nrel); el("line", { x1: nx, x2: nx, y1: pT - 6, y2: bot, "stroke-dasharray": "5 4" }, L.rel); el("rect", { x: nx - 22, y: 2, width: 44, height: 26, rx: 6 }, L.rel); txt(L.rel, nx, 13, co.next.q.slice(3)); txt(L.rel, nx, 24, "D-" + dday(co.next.date), "rx"); }
    }

    var stepW = IW / Math.max(1, (xEnd - from) / (wk ? 7 * DAY : 1.45 * DAY)), bw2 = Math.max(1, Math.min(14, stepW * 0.62));
    if (st.mode === "line") {
      var dd = bars.map(function (b, i) { return (i ? "L" : "M") + x(b.t).toFixed(1) + "," + y(b.c).toFixed(1); }).join("");
      el("path", { d: dd + "L" + x(bars[bars.length - 1].t).toFixed(1) + "," + pBot + "L" + x(bars[0].t).toFixed(1) + "," + pBot + "Z", "class": "parea fade" }, L.price);
      el("path", { d: dd, "class": "pline" + (anim ? " draw" : "") }, L.price);
    } else {
      bars.forEach(function (b) {
        var up = b.c >= b.o, cx = x(wk ? b.t + 2 * DAY : b.t), c = up ? "c-up" : "c-dn";
        if (st.mode === "candle") {
          el("line", { x1: cx, x2: cx, y1: y(b.h), y2: y(b.l), "class": c + "-h", "stroke-width": 1 }, L.price);
          var yt = y(Math.max(b.o, b.c)), yb = y(Math.min(b.o, b.c));
          el("rect", { x: cx - bw2 / 2, y: yt, width: bw2, height: Math.max(1, yb - yt), "class": c, rx: bw2 > 5 ? 1 : 0 }, L.price);
        } else el("path", { d: "M" + cx + "," + y(b.h) + "V" + y(b.l) + "M" + (cx - bw2 / 2) + "," + y(b.o) + "H" + cx + "M" + cx + "," + y(b.c) + "H" + (cx + bw2 / 2), "class": c + "-h", "stroke-width": bw2 > 4 ? 1.6 : 1.1 }, L.price);
      });
    }
    var lb = bars[bars.length - 1], ly = y(lb.c);
    el("line", { x1: x(lb.t), x2: pL + IW, y1: ly, y2: ly }, L.last); el("rect", { x: W - pR + 3, y: ly - 9, width: pR - 6, height: 18, rx: 4 }, L.last); txt(L.last, W - pR + 8, ly + 4, nf(lb.c));

    L.vl.setAttribute("y1", pT); L.vl.setAttribute("y2", bot); L.hl.setAttribute("x1", pL); L.hl.setAttribute("x2", pL + IW);
    L.dr.setAttribute("y", bot + 3); L.dt.setAttribute("y", bot + 15); L.dt.setAttribute("text-anchor", "middle"); L.pr.setAttribute("x", W - pR + 3); L.pr.setAttribute("width", pR - 6);
    L.ov.setAttribute("x", pL); L.ov.setAttribute("y", 0); L.ov.setAttribute("width", IW); L.ov.setAttribute("height", H);
    PC.xs = bars.map(function (b) { return x(wk ? b.t + 2 * DAY : b.t); });
    if (anim) animate(PC.svg);
    updNav(co);
  }

  function crosshair(co, ev) {
    var M = PC.M, L = PC.L, svg = PC.svg; if (!M) return;
    var rc = svg.getBoundingClientRect(), mx = (ev.clientX - rc.left) * PC.W / rc.width, my = (ev.clientY - rc.top) * PC.H / rc.height;
    var xs = PC.xs, a = 0, b2 = xs.length - 1; while (b2 - a > 1) { var mid = (a + b2) >> 1; if (xs[mid] < mx) a = mid; else b2 = mid; }
    var i = Math.abs(xs[a] - mx) < Math.abs(xs[b2] - mx) ? a : b2, b = M.bars[i], cx = xs[i];
    L.xh.setAttribute("visibility", "visible");
    L.vl.setAttribute("x1", cx); L.vl.setAttribute("x2", cx); L.hl.setAttribute("y1", my); L.hl.setAttribute("y2", my);
    L.dr.setAttribute("x", Math.min(M.pL + M.IW - 64, Math.max(M.pL, cx - 32))); L.dt.setAttribute("x", Math.min(M.pL + M.IW - 32, Math.max(M.pL + 32, cx))); L.dt.textContent = md(b.t);
    var pv = M.lo + (1 - (my - M.pTop) / (M.pBot - M.pTop)) * (M.hi - M.lo);
    L.pr.setAttribute("y", my - 9); L.pt.setAttribute("y", my + 4); L.pt.setAttribute("x", PC.W - M.pR / 2); L.pt.setAttribute("text-anchor", "middle"); L.pt.textContent = my <= M.pBot ? nf(pv) : "";
    var prev = M.bars[i - 1], chg = prev ? (b.c / prev.c - 1) * 100 : null;
    var h = "<h5>" + md(b.t) + (M.wk ? " 주" : "") + "<span>" + esc(co.n) + "</span></h5>" + row("시가", nf(b.o)) + row("고가", nf(b.h)) + row("저가", nf(b.l)) + row("종가", nf(b.c) + (chg != null ? ' <small class="' + ud(chg) + '">' + pct(chg) + "</small>" : ""));
    if (M.it) { var known = null; M.it.pts.forEach(function (p) { if (ymT(ymAdd(p[0], 1)) - 18 * DAY <= b.t) known = p; }); h += "<hr>" + (known ? row("그때 공개된 " + M.it.short, nf(known[1], DG(M.it)) + U(M.it) + " (" + ymLab(known[0]) + ")", "ind") : row(M.it.short, "기록 전")); }
    showTip(h, ev);
  }

  function bindPan(co) {
    var ov = PC.L.ov, drag = null;
    ov.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      var st = S.st[co.c]; drag = { x0: ev.clientX, f: st.from, t: st.to };
      try { ov.setPointerCapture(ev.pointerId); } catch (e) {}
      PC.svg.classList.add("grabbing"); hideTip(); PC.L.xh.setAttribute("visibility", "hidden");
    });
    ov.addEventListener("pointermove", function (ev) {
      if (!drag) { if (ev.pointerType !== "touch") crosshair(co, ev); return; }
      var st = S.st[co.c], rc = PC.svg.getBoundingClientRect(), dx = (ev.clientX - drag.x0) * PC.W / rc.width;
      var dt = -dx / PC.M.IW * (PC.M.xEnd - PC.M.from);
      var r = clampRange(co, drag.f + dt, drag.t + dt); st.from = r[0]; st.to = r[1]; st.range = null; markRange(co); schedule(co);
    });
    function end(ev) { if (!drag) return; try { ov.releasePointerCapture(ev.pointerId); } catch (e) {} drag = null; PC.svg.classList.remove("grabbing"); }
    ov.addEventListener("pointerup", end); ov.addEventListener("pointercancel", end);
    ov.addEventListener("pointerleave", function () { if (!drag) { PC.L.xh.setAttribute("visibility", "hidden"); hideTip(); } });
    ov.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      var rc = PC.svg.getBoundingClientRect(), mx = (ev.clientX - rc.left) * PC.W / rc.width, M = PC.M;
      zoomAt(co, M.from + (mx - M.pL) / M.IW * (M.xEnd - M.from), ev.deltaY > 0 ? 1.18 : 1 / 1.18);
    }, { passive: false });
    ov.addEventListener("dblclick", function () { setRange(co, "1Y"); markRange(co); drawMain(co, true); });
  }
  function zoomAt(co, center, k) {
    var st = S.st[co.c], ratio = Math.max(0, Math.min(1, (center - st.from) / (st.to - st.from || 1))), span = (st.to - st.from) * k;
    var r = clampRange(co, center - span * ratio, center - span * ratio + span); st.from = r[0]; st.to = r[1]; st.range = null; markRange(co); schedule(co);
  }
  var pending = null;
  function schedule(co) { if (pending) return; pending = setTimeout(function () { pending = null; drawMain(co, false); }, 16); }

  /* 기간 고르는 작은 차트 — 한 번 만들고 상자만 움직임. 손잡이 판정 폭 넓게 */
  function buildNav(co) {
    var host = document.getElementById("nw"), px = S.px[co.c];
    var W = Math.max(320, host.clientWidth), H = 56, pL = 6, pR = 64, IW = W - pL - pR;
    var all = weekly(px), F = px[0].t, L = px[px.length - 1].t;
    var x = function (t) { return pL + (t - F) / (L - F || 1) * IW; }, tx = function (xx) { return F + (xx - pL) / IW * (L - F); };
    var lo = Math.min.apply(null, all.map(function (b) { return b.c; })), hi = Math.max.apply(null, all.map(function (b) { return b.c; }));
    var y = function (v) { return 6 + (1 - (v - lo) / (hi - lo || 1)) * (H - 12); };
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, "class": "navg" });
    var bg = el("rect", { x: pL, y: 0, width: IW, height: H, fill: "transparent", "class": "nbg" }, svg);
    var na = el("path", { d: all.map(function (b, i) { return (i ? "L" : "M") + x(b.t).toFixed(1) + "," + y(b.c).toFixed(1); }).join("") + "L" + x(L) + "," + H + "L" + x(F) + "," + H + "Z", "class": "na" }, svg);
    var m1 = el("rect", { y: 0, height: H, "class": "mask" }, svg), m2 = el("rect", { y: 0, height: H, "class": "mask" }, svg);
    var br = el("rect", { y: 1, height: H - 2, rx: 6, "class": "brush" }, svg);
    var h1 = el("rect", { y: H / 2 - 13, width: 8, height: 26, rx: 3, "class": "hd" }, svg), h2 = el("rect", { y: H / 2 - 13, width: 8, height: 26, rx: 3, "class": "hd" }, svg);
    var g1 = el("rect", { y: 0, width: 24, height: H, fill: "transparent", "class": "hdz" }, svg), g2 = el("rect", { y: 0, width: 24, height: H, fill: "transparent", "class": "hdz" }, svg);
    txt(svg, W - pR + 8, 20, md(F).slice(0, 5)); txt(svg, W - pR + 8, 38, "~" + md(L).slice(0, 5));
    host.innerHTML = ""; host.appendChild(svg);
    NV = { co: co, svg: svg, W: W, x: x, pL: pL, IW: IW, m1: m1, m2: m2, br: br, h1: h1, h2: h2, g1: g1, g2: g2 };
    function pos(ev) { var rc = svg.getBoundingClientRect(); return (ev.clientX - rc.left) * W / rc.width; }
    function start(kind) {
      return function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var st = S.st[co.c], k = kind;
        if (k === "bg") { var c = tx(pos(ev)), len = st.to - st.from, r0 = clampRange(co, c - len / 2, c + len / 2); st.from = r0[0]; st.to = r0[1]; st.range = null; markRange(co); schedule(co); k = "b"; }
        var d = { k: k, x0: pos(ev), f: st.from, t: st.to };
        try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
        svg.classList.add("dragging");
        function mv(e2) {
          var dt = tx(pos(e2)) - tx(d.x0), r;
          if (d.k === "b") r = clampRange(co, d.f + dt, d.t + dt);
          else if (d.k === "l") r = [Math.max(F, Math.min(d.f + dt, d.t - 25 * DAY)), d.t];
          else r = [d.f, Math.min(L, Math.max(d.t + dt, d.f + 25 * DAY))];
          st.from = r[0]; st.to = r[1]; st.range = null; markRange(co); schedule(co);
        }
        function up(e2) { try { svg.releasePointerCapture(e2.pointerId); } catch (e) {} svg.classList.remove("dragging"); svg.removeEventListener("pointermove", mv); svg.removeEventListener("pointerup", up); svg.removeEventListener("pointercancel", up); }
        svg.addEventListener("pointermove", mv); svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
      };
    }
    br.addEventListener("pointerdown", start("b")); [g1, h1].forEach(function (e) { e.addEventListener("pointerdown", start("l")); }); [g2, h2].forEach(function (e) { e.addEventListener("pointerdown", start("r")); });
    [bg, na, m1, m2].forEach(function (e) { e.addEventListener("pointerdown", start("bg")); });
  }
  function updNav(co) {
    var host = document.getElementById("nw"); if (!host) return;
    if (NV.co !== co || !NV.svg || !NV.svg.isConnected || Math.abs(NV.W - Math.max(320, host.clientWidth)) > 2) buildNav(co);
    var st = S.st[co.c], bx = NV.x(st.from), bw = Math.max(10, NV.x(st.to) - bx);
    NV.m1.setAttribute("x", NV.pL); NV.m1.setAttribute("width", Math.max(0, bx - NV.pL));
    NV.m2.setAttribute("x", bx + bw); NV.m2.setAttribute("width", Math.max(0, NV.pL + NV.IW - bx - bw));
    NV.br.setAttribute("x", bx); NV.br.setAttribute("width", bw);
    NV.h1.setAttribute("x", bx - 4); NV.h2.setAttribute("x", bx + bw - 4); NV.g1.setAttribute("x", bx - 12); NV.g2.setAttribute("x", bx + bw - 12);
  }

  function bindMain(co) {
    var st = S.st[co.c];
    document.querySelectorAll("#ovsel button").forEach(function (b) { b.onclick = function () { st.ov = b.dataset.v; document.querySelectorAll("#ovsel button").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); drawMain(co, true); }; });
    document.querySelectorAll("#prange button").forEach(function (b) { b.onclick = function () { setRange(co, b.dataset.v); markRange(co); drawMain(co, true); }; });
    var rb = document.getElementById("prel"); rb.onclick = function () { st.rel = !st.rel; rb.setAttribute("aria-pressed", st.rel); drawMain(co, false); };
    document.getElementById("zin").onclick = function () { zoomAt(co, st.to, 1 / 1.4); };
    document.getElementById("zout").onclick = function () { zoomAt(co, st.to, 1.4); };
  }

  /* ---------- 라이트박스 · 테마 ---------- */
  var lb = document.getElementById("lb");
  function openLb(src, cap) { document.getElementById("lbimg").src = src; document.getElementById("lbcap").textContent = cap || ""; lb.hidden = false; }
  lb.addEventListener("click", function (e) { if (e.target === lb || e.target.id === "lbx") lb.hidden = true; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") lb.hidden = true; });
  document.getElementById("themeBtn").onclick = function () {
    var t = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("ld-theme", t); } catch (e) {}
  };

  /* ---------- 공용 시장 통계(data/jp/lead/macro) — 기업 원장의 lead.macro id(별칭)를 찾아 지표로 붙임 ---------- */
  function attachMacro(co) {
    if (!co || co._macro || !co.lead.macro || !co.lead.macro.length) return Promise.resolve();
    var ix = S.macroIdx; if (!ix) return Promise.resolve();
    var need = co.lead.macro.map(function (m) { return ix[m.id] ? { m: m, at: ix[m.id] } : null; }).filter(Boolean);
    var files = {}; need.forEach(function (n) { files[n.at.file] = 1; });
    return Promise.all(Object.keys(files).map(function (f) { return S.macroF[f] ? Promise.resolve() : getJSON("data/jp/lead/macro/" + f).then(function (d) { S.macroF[f] = d; }).catch(function () {}); })).then(function () {
      co._macro = 1;
      need.forEach(function (n, i) {
        var d = S.macroF[n.at.file]; if (!d) return;
        var se = (d.series || []).filter(function (x) { return x.key === n.at.key; })[0] || (d.series || [])[0]; if (!se || !se.pts || !se.pts.length) return;
        if (co.lead.items.some(function (x) { return x.id === "m" + i; })) return;
        var useY = n.at.yoy && se.yoy && se.yoy.length;
        co.lead.items.push({ id: "m" + i, kind: "macro", t: d.name + (se.name ? " — " + se.name : "") + (useY ? "(전년비)" : ""), short: (se.name || d.name).slice(0, 16) + (useY ? " YoY" : ""), nm: (se.name || d.name).slice(0, 14), unit: useY ? "%" : (se.unit || ""), entity: d.src || "", corp: d.id, note: n.m.why || "", why: n.m.why || "",
          pts: (useY ? se.yoy : se.pts).filter(function (p) { return p && p[1] != null; }).map(function (p) { return [p[0], p[1], "mc"]; }), src: [{ doc: d.src || d.name, where: (se.name || "") + " · " + (d.url || ""), freq: d.freq || "월", auto: "반자동", how: "공용 시장 통계 data/jp/lead/macro/" + n.at.file + " — 다음 공표 " + (d.next || "") }] });
        co.refs.mc = { date: "", t: d.src || d.name, url: d.url || "" };
      });
      co.lead.macro = co.lead.macro.filter(function (m) { return !ix[m.id]; });
    });
  }

  /* ---------- 라우팅 ---------- */
  function cur() { var m = /^#c\/(\w+)/.exec(location.hash); return m ? m[1] : null; }
  function route() {
    hideTip();
    var h = location.hash.replace(/^#\/?/, ""), p = h.split("/");
    if (p[0] === "c" && p[1] && S.idx.cos[p[1]]) { renderTree({ sec: S.idx.cos[p[1]].sec, c: p[1] }); main.innerHTML = '<div class="boot"><i></i><i></i><i></i></div>'; ensureCo([p[1]], true).then(function () { return attachMacro(S.co[p[1]]); }).then(function () { if (cur() === p[1]) viewCompany(p[1]); }); }
    else if (p[0] === "s" && p[2]) { renderTree({ sec: p[1] + "/" + p[2] }); viewSector(p[1], p[2]); }
    else { renderTree(null); viewHome(); }
    window.scrollTo(0, 0);
  }
  var rT = null;
  window.addEventListener("resize", function () { clearTimeout(rT); rT = setTimeout(function () { var c = cur(); if (!c || !S.co[c]) return; drawLead(S.co[c], false); drawMain(S.co[c], false); }, 150); });
  document.getElementById("sideTg").onclick = function () { var sd = document.getElementById("side"), o = sd.classList.toggle("open"); this.setAttribute("aria-expanded", o); };
  document.getElementById("tree").addEventListener("click", function (e) { if (e.target.closest("a") && !e.defaultPrevented) { document.getElementById("side").classList.remove("open"); document.getElementById("sideTg").setAttribute("aria-expanded", false); } });
  document.getElementById("q").addEventListener("input", function () { var c = cur(), h = location.hash.split("/"); renderTree(c ? { sec: S.idx.cos[c].sec, c: c } : h[0] === "#s" ? { sec: h[1] + "/" + h[2] } : null); });

  getJSON("data/jp/lead/index.json").then(function (idx) {
    S.idx = idx;
    var codes = Object.keys(idx.cos);
    return Promise.all([
      getJSON("data/jp/scr.json").then(function (d) { S.scr = d; }).catch(function () { S.scr = null; }),
      getJSON("data/jp/lead/macro/index.json").then(function (d) { S.macroIdx = d.alias || {}; }).catch(function () { S.macroIdx = null; })
    ]);
  }).then(function () { window.addEventListener("hashchange", route); route(); })
    .catch(function (e) { main.innerHTML = '<div class="empty">불러오지 못했습니다 — ' + esc(e.message || e) + "</div>"; });
})();
