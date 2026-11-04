/* usre-tv.js — 미국 부동산 화면의 검정 차트(2026-11-04 사용자: "나쁜양파 검정 차트처럼, 그리고 고르고 지울 수 있게").
 * 차트 = vendor/lightweight-charts(TradingView 오픈소스, CSP 때문에 사이트 안에 둠).
 * 선 긋기: 수평선(Alt+H) · 추세선(Alt+T, 두 점 클릭) · 수직선(Alt+V) · 선 클릭 → Delete / 우클릭으로 지움 · Esc 취소
 * 그린 선은 이 브라우저에 저장(localStorage "usre-draw" — 차트·칸별).
 *
 *   TV.lib()                          → Promise(라이브러리 로드)
 *   TV.group(barEl, {sync})           → 도구 줄 + 칸 묶음(sync=true 면 칸끼리 시간축·십자선을 맞춘다)
 *   g.pane(box, {key, times, height, log, timeVisible, legend(i), margins}) → 칸
 *   p.add("line"|"area"|"hist", opts, values[]) → 시리즈(첫 시리즈가 선 긋기 기준)
 *   p.bands([{a,b,color,label}]) · p.vlines([{d,label}]) — 배경 띠·사건선(날짜 문자열)
 */
(function () {
  "use strict";
  var LIB = "vendor/lightweight-charts-4.2.0.js?v=1", KEY = "usre-draw";
  var C = { bg: "#0d1016", grid: "rgba(255,255,255,.045)", text: "#8b93a3", border: "#232833", cross: "#5b6375", draw: "#e9edf5", sel: "#f5b400" };
  var libP = null;
  function lib() {
    if (window.LightweightCharts) return Promise.resolve();
    return libP || (libP = new Promise(function (ok, no) { var s = document.createElement("script"); s.src = LIB; s.onload = ok; s.onerror = no; document.head.appendChild(s); }));
  }
  var DR = (function () { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } })();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(DR)); } catch (e) {} }
  var HINT0 = "Alt+R 구간 보기(시작·끝 클릭) · Alt+H 수평선 · Alt+T 추세선 · Alt+V 수직선 · 선을 클릭해 고른 뒤 Delete, 또는 우클릭으로 지우기 · Esc 취소 · 휠 확대 · 끌어서 이동";

  /* ---------- 그리기 층(배경 띠·사건선 = 아래, 사용자 선 = 위) ---------- */
  function Prim(P) {
    this.P = P;
    var self = this;
    this._v = [
      { zOrder: function () { return "bottom"; }, renderer: function () { return { draw: function () {}, drawBackground: function (t) { self.P._bg(t); } }; } },
      { zOrder: function () { return "top"; }, renderer: function () { return { draw: function (t) { self.P._fg(t); } }; } }
    ];
  }
  Prim.prototype.attached = function (p) { this.req = p.requestUpdate; };
  Prim.prototype.detached = function () { this.req = null; };
  Prim.prototype.updateAllViews = function () {};
  Prim.prototype.paneViews = function () { return this._v; };

  /* ---------- 칸 ---------- */
  function Pane(g, box, o) {
    this.g = g; this.box = box; this.o = o; this.times = o.times; this.key = o.key;
    this.series = []; this.main = null; this.mainVals = null; this._bands = []; this._vl = []; this.plines = [];
    box.classList.add("tvp"); box.textContent = "";
    if (o.height) box.style.height = o.height + "px";
    this.lg = document.createElement("div"); this.lg.className = "tv-lg"; box.appendChild(this.lg);
    var LC = window.LightweightCharts;
    this.chart = LC.createChart(box, {
      autoSize: true,
      layout: { background: { color: C.bg }, textColor: C.text, fontFamily: "Pretendard Variable, Pretendard, Malgun Gothic, sans-serif", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: 0, vertLine: { color: C.cross, labelBackgroundColor: "#2b313d" }, horzLine: { color: C.cross, labelBackgroundColor: "#2b313d" } },
      rightPriceScale: { borderColor: C.border, mode: o.log ? 1 : 0, minimumWidth: 74, scaleMargins: o.margins || { top: 0.1, bottom: 0.08 } },
      timeScale: { borderColor: C.border, rightOffset: 6, minBarSpacing: 0.15, visible: o.timeVisible !== false },
      localization: { locale: "ko-KR", dateFormat: "yyyy-MM-dd" }
    });
    var P = this;
    this.chart.subscribeCrosshairMove(function (e) { P.g._move(P, e); });
    this.chart.subscribeClick(function (e) { P.g._click(P, e); });
    box.addEventListener("contextmenu", function (e) {
      var r = box.getBoundingClientRect(), h = P.hit(e.clientX - r.left, e.clientY - r.top);
      if (h) { e.preventDefault(); P.g.sel = { pane: P, k: h.k, i: h.i }; P.g.remove(); }
    });
    box.addEventListener("mouseenter", function () { P.g.last = P.g; TVG.cur = P.g; });
  }
  Pane.prototype.idx = function (d) {   // 날짜 문자열 → 위치(가장 가까운 앞쪽 봉)
    var t = this.times, lo = 0, hi = t.length - 1;
    if (d <= t[0]) return 0; if (d >= t[hi]) return hi;
    while (lo < hi) { var m = (lo + hi + 1) >> 1; if (t[m] <= d) lo = m; else hi = m - 1; }
    return lo;
  };
  Pane.prototype.add = function (type, opt, vals) {
    var c = this.chart, s;
    var base = { priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 3 };
    for (var k in opt) base[k] = opt[k];
    if (type === "area") s = c.addAreaSeries(base);
    else if (type === "hist") s = c.addHistogramSeries(base);
    else s = c.addLineSeries(base);
    var t = this.times;
    s.setData(vals.map(function (v, i) {
      if (v == null) return { time: t[i] };
      return typeof v === "object" ? { time: t[i], value: v.value, color: v.color } : { time: t[i], value: v };
    }));
    this.series.push(s);
    if (!this.main && !opt.notMain) { this.main = s; this.mainVals = vals; s.attachPrimitive(this.prim = new Prim(this)); this.drawH(); }
    return s;
  };
  Pane.prototype.bands = function (a) { this._bands = a || []; this.upd(); };
  Pane.prototype.vlines = function (a) { this._vl = a || []; this.upd(); };
  Pane.prototype.upd = function () { if (this.prim && this.prim.req) this.prim.req(); };
  var EMPTY = { h: [], t: [], v: [] };
  Pane.prototype.D = function () { return DR[this.key] || EMPTY; };                          // 읽기
  Pane.prototype.W = function () { var d = DR[this.key] || (DR[this.key] = { h: [], t: [], v: [] }); d.h = d.h || []; d.t = d.t || []; d.v = d.v || []; return d; };   // 쓰기
  Pane.prototype.lgOf = function (pt) { return this.idx(pt.d) + (pt.k || 0); };
  Pane.prototype.pt = function (l, p) {
    var n = this.times.length - 1, i = Math.max(0, Math.min(n, Math.round(l)));
    return { d: this.times[i], k: +(l - i).toFixed(2), p: +(+p).toPrecision(6) };
  };
  Pane.prototype.x = function (l) {   // 4.2 는 소수 위치를 0 으로 돌려줘서 정수 두 칸 사이를 직접 나눈다
    var ts = this.chart.timeScale(), i = Math.floor(l), f = l - i, a = ts.logicalToCoordinate(i);
    if (a == null || !f) return a;
    var b = ts.logicalToCoordinate(i + 1); return b == null ? a : a + (b - a) * f;
  };
  Pane.prototype.y = function (p) { return this.main ? this.main.priceToCoordinate(p) : null; };
  Pane.prototype.drawH = function () {
    var P = this, g = this.g;
    if (!this.main) return;
    this.plines.forEach(function (l) { P.main.removePriceLine(l); }); this.plines = [];
    (this.D().h || []).forEach(function (h, i) {
      var on = g.sel && g.sel.pane === P && g.sel.k === "h" && g.sel.i === i;
      P.plines.push(P.main.createPriceLine({ price: h.p, color: on ? C.sel : C.draw, lineWidth: on ? 2 : 1, lineStyle: 0, axisLabelVisible: true, title: "" }));
    });
    this.upd();
  };
  Pane.prototype.hit = function (x, y) {
    var P = this, best = null, bd = 7, d = this.D();
    (d.h || []).forEach(function (h, i) { var yy = P.y(h.p); if (yy != null && Math.abs(yy - y) < bd) { bd = Math.abs(yy - y); best = { k: "h", i: i }; } });
    (d.v || []).forEach(function (v, i) { var xx = P.x(P.lgOf(v)); if (xx != null && Math.abs(xx - x) < bd) { bd = Math.abs(xx - x); best = { k: "v", i: i }; } });
    (d.t || []).forEach(function (t, i) {
      var ax = P.x(P.lgOf(t.a)), ay = P.y(t.a.p), bx = P.x(P.lgOf(t.b)), by = P.y(t.b.p);
      if ([ax, ay, bx, by].indexOf(null) >= 0) return;
      var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, u = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      var dd = Math.hypot(x - (ax + u * dx), y - (ay + u * dy)); if (dd < bd) { bd = dd; best = { k: "t", i: i }; }
    });
    return best;
  };
  Pane.prototype._bg = function (target) {
    var P = this;
    target.useMediaCoordinateSpace(function (s) {
      var ctx = s.context, H = s.mediaSize.height, W = s.mediaSize.width;
      P._bands.forEach(function (b) {
        var x0 = P.x(P.idx(b.a) - 0.5), x1 = P.x(P.idx(b.b) + 0.5);
        if (x0 == null || x1 == null || x1 < 0 || x0 > W) return;
        ctx.fillStyle = b.color; ctx.fillRect(x0, 0, Math.max(1, x1 - x0), H);
        if (b.label && P.o.bandLabels !== false) {
          ctx.font = "600 11px Pretendard Variable, Pretendard, sans-serif";
          var lx = Math.max(x0, 0) + 4;
          if (Math.min(x1, W) - lx >= ctx.measureText(b.label).width + 2) { ctx.fillStyle = b.lc || "rgba(255,255,255,.55)"; ctx.fillText(b.label, lx, H - 36); }   // 띠가 좁으면 글자를 넣지 않는다
        }
      });
      P._vl.forEach(function (v, k) {
        var x = P.x(P.idx(v.d)); if (x == null || x < 0 || x > W) return;
        ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, H); ctx.stroke(); ctx.setLineDash([]);
        if (v.label) { ctx.fillStyle = "rgba(220,226,236,.62)"; ctx.font = "10.5px Pretendard Variable, Pretendard, sans-serif"; ctx.fillText(v.label, x + 4, H - 8 - (k % 2) * 13); }
      });
    });
  };
  Pane.prototype._fg = function (target) {
    var P = this, g = this.g, d = this.D();
    target.useMediaCoordinateSpace(function (s) {
      var ctx = s.context, H = s.mediaSize.height;
      function seg(ax, ay, bx, by, on, dash) {
        ctx.strokeStyle = on ? C.sel : C.draw; ctx.lineWidth = on ? 2.2 : 1.4; ctx.setLineDash(dash ? [5, 4] : []);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
        if (on) { ctx.fillStyle = C.sel; [[ax, ay], [bx, by]].forEach(function (q) { ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, 7); ctx.fill(); }); }
      }
      (d.t || []).forEach(function (t, i) {
        var ax = P.x(P.lgOf(t.a)), ay = P.y(t.a.p), bx = P.x(P.lgOf(t.b)), by = P.y(t.b.p);
        if ([ax, ay, bx, by].indexOf(null) >= 0) return;
        seg(ax, ay, bx, by, g.sel && g.sel.pane === P && g.sel.k === "t" && g.sel.i === i);
      });
      (d.v || []).forEach(function (v, i) {
        var x = P.x(P.lgOf(v)); if (x == null) return;
        var on = g.sel && g.sel.pane === P && g.sel.k === "v" && g.sel.i === i;
        seg(x, 0, x, H, on);
        ctx.fillStyle = on ? C.sel : "rgba(233,237,245,.8)"; ctx.font = "600 10.5px IBM Plex Mono, monospace"; ctx.fillText(v.d, x + 4, 12);
      });
      if (g.pend && g.pend.r && g.hover) {
        var rx0 = P.x(g.pend.l), rx1 = P.x(g.hover.l);
        if (rx0 != null && rx1 != null) {
          var lx = Math.min(rx0, rx1), wx = Math.abs(rx1 - rx0);
          ctx.fillStyle = "rgba(41,98,255,.16)"; ctx.fillRect(lx, 0, wx, H);
          ctx.strokeStyle = "rgba(90,140,255,.9)"; ctx.lineWidth = 1; ctx.setLineDash([]);
          [rx0, rx1].forEach(function (xx) { ctx.beginPath(); ctx.moveTo(Math.round(xx) + 0.5, 0); ctx.lineTo(Math.round(xx) + 0.5, H); ctx.stroke(); });
        }
      }
      if (g.pend && g.pend.pt && g.pend.pane === P && g.hover && g.hover.pane === P) {
        var ax2 = P.x(P.lgOf(g.pend.pt)), ay2 = P.y(g.pend.pt.p), bx2 = P.x(g.hover.l), by2 = P.y(g.hover.p);
        if ([ax2, ay2, bx2, by2].indexOf(null) < 0) seg(ax2, ay2, bx2, by2, false, true);
      }
    });
  };
  Pane.prototype.legend = function (i) {
    if (!this.o.legend) return;
    var n = this.times.length - 1; if (i == null || i < 0 || i > n) i = this.defI != null ? Math.min(n, this.defI) : n;   // 마우스가 없으면 보고 있는 구간의 끝 주
    // 사이트 CSP 가 style="…" 을 막으므로 색은 data-bg 로 받아 CSSOM 으로 칠한다(마우스를 움직일 때마다 경고가 쌓이지 않게)
    this.lg.innerHTML = this.o.legend(i).replace(/style="background:([^"]+)"/g, 'data-bg="$1"');
    var a = this.lg.querySelectorAll("[data-bg]");
    for (var k = 0; k < a.length; k++) a[k].style.background = a[k].getAttribute("data-bg");
  };
  Pane.prototype.destroy = function () { try { this.chart.remove(); } catch (e) {} };

  /* ---------- 묶음(도구 줄) ---------- */
  var TVG = { all: [], cur: null };
  function Group(bar, o) {
    o = o || {};
    this.bar = bar; this.panes = []; this.sync = !!o.sync; this.mode = null; this.pend = null; this.sel = null; this.hover = null; this.onHover = o.onHover; this.onRange = o.onRange; this.onFit = o.onFit; this._lock = false;
    var G = this;
    if (bar) {
      bar.classList.add("tv-bar");
      bar.innerHTML =
        '<button data-t="h" title="커서 높이에 수평선(Alt+H)">— 수평선<kbd>Alt+H</kbd></button>' +
        '<button data-t="t" title="두 점을 클릭(Alt+T)">╱ 추세선<kbd>Alt+T</kbd></button>' +
        '<button data-t="v" title="커서 위치에 수직선(Alt+V)">│ 수직선<kbd>Alt+V</kbd></button>' +
        '<i class="tv-sep"></i><button data-t="r" title="시작일과 끝날을 차례로 클릭하면 그 구간만 크게 봅니다(Alt+R)">↔ 구간 보기<kbd>Alt+R</kbd></button>' +
        '<button data-t="fit" title="처음부터 끝까지 전부 보기">전체 보기</button>' +
        '<i class="tv-sep"></i><button data-t="del" title="고른 선 지우기(Delete)">고른 선 지우기<kbd>Del</kbd></button>' +
        '<button data-t="clr">모두 지우기</button><span class="tv-hint">' + HINT0 + "</span>";
      bar.querySelectorAll("button[data-t]").forEach(function (b) {
        b.onclick = function () {
          var t = b.dataset.t; TVG.cur = G;
          if (t === "h" || t === "t" || t === "v" || t === "r") G.setMode(G.mode === t ? null : t);
          else if (t === "fit") G.fit();
          else if (t === "del") { if (G.sel) G.remove(); else G.hint("지울 선을 먼저 클릭하세요"); }
          else if (t === "clr") {
            if (!confirm("이 차트에 그린 선을 모두 지울까요?")) return;
            G.panes.forEach(function (P) { delete DR[P.key]; P.drawH(); }); save(); G.sel = null;
          }
        };
      });
    }
    TVG.all.push(this);
  }
  Group.prototype.hint = function (t) {
    if (!this.bar) return; var h = this.bar.querySelector(".tv-hint"); h.textContent = t; h.classList.add("on");
    clearTimeout(h._t); h._t = setTimeout(function () { h.classList.remove("on"); h.textContent = HINT0; }, 2600);
  };
  Group.prototype.setMode = function (m) {
    this.mode = m; this.pend = null;
    if (this.bar) this.bar.querySelectorAll("button[data-t]").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.t === m); });
    this.panes.forEach(function (P) { P.box.classList.toggle("drawing", !!m); P.upd(); });
    if (m === "t") this.hint("추세선: 시작점을 클릭하세요");
    if (m === "h") this.hint("수평선: 그을 높이를 클릭하세요");
    if (m === "v") this.hint("수직선: 그을 날짜를 클릭하세요");
    if (m === "r") this.hint("구간 보기: 시작일을 클릭하세요");
  };
  Group.prototype.pane = function (box, o) {
    var P = new Pane(this, box, o), G = this;
    this.panes.push(P);
    if (this.sync) {
      P.chart.timeScale().subscribeVisibleLogicalRangeChange(function (r) {
        if (G._lock || !r) return; G._lock = true;
        G.panes.forEach(function (Q) { if (Q !== P) Q.chart.timeScale().setVisibleLogicalRange(r); });
        G._lock = false;
      });
    }
    return P;
  };
  Group.prototype._move = function (P, e) {
    var G = this;
    if (!e.point || e.logical == null) {
      if (G._xlock) return;
      G.hover = null;
      G.panes.forEach(function (Q) { Q.legend(null); if (G.sync && Q !== P) Q.chart.clearCrosshairPosition(); Q.upd(); });
      if (G.onHover) G.onHover(null);
      return;
    }
    G.hover = { pane: P, l: e.logical, p: P.main ? P.main.coordinateToPrice(e.point.y) : null };
    var i = Math.max(0, Math.min(P.times.length - 1, Math.round(e.logical)));
    if (G.sync) {
      G._xlock = true;
      G.panes.forEach(function (Q) {
        Q.legend(i);
        if (Q !== P && Q.main && Q.mainVals) {
          var v = Q.mainVals[i]; v = v && typeof v === "object" ? v.value : v;
          if (v != null) Q.chart.setCrosshairPosition(v, Q.times[i], Q.main); else Q.chart.clearCrosshairPosition();
        }
      });
      G._xlock = false;
    } else P.legend(i);
    if (G.onHover) G.onHover(i);
    if (G.pend) (G.pend.r ? G.panes : [P]).forEach(function (Q) { Q.upd(); });
  };
  Group.prototype._click = function (P, e) {
    var G = this; TVG.cur = G;
    if (!e.point) return;
    var l = P.chart.timeScale().coordinateToLogical(e.point.x), pr = P.main ? P.main.coordinateToPrice(e.point.y) : null;
    if (l == null) return;
    if (G.mode === "h" && pr != null) { G.addH(P, pr); return; }
    if (G.mode === "v") { G.addV(P, l); return; }
    if (G.mode === "r") {
      var li = Math.max(0, Math.min(P.times.length - 1, Math.round(l)));
      if (!G.pend || !G.pend.r) { G.pend = { pane: P, l: li, r: true }; G.hint("구간 보기: 끝날을 클릭하세요 · " + P.times[li] + " ~"); return; }
      var a = Math.min(G.pend.l, li), b = Math.max(G.pend.l, li); G.setMode(null);
      if (b - a < 2) { G.hint("구간이 너무 짧습니다. 다시 지정하세요"); return; }
      G.range(a, b); return;
    }
    if (G.mode === "t" && pr != null) {
      if (!G.pend || G.pend.pane !== P) { G.pend = { pane: P, pt: P.pt(l, pr) }; G.hint("추세선: 끝점을 클릭하세요"); return; }
      P.W().t.push({ a: G.pend.pt, b: P.pt(l, pr) }); save(); G.setMode(null); return;
    }
    var h = P.hit(e.point.x, e.point.y), old = G.sel;
    G.sel = h ? { pane: P, k: h.k, i: h.i } : null;
    if (old && old.pane !== P) old.pane.drawH();
    P.drawH();
    if (h) G.hint("고른 선: Delete 키 또는 '고른 선 지우기'로 지웁니다");
  };
  Group.prototype.range = function (a, b) {   // 위치 a~b 만 보기(동기화 묶음은 한 칸만 바꾸면 나머지도 따라온다)
    if (this.onRange) { this.onRange(a, b); return; }
    var r = { from: a - 0.5, to: b + 0.5 };
    (this.sync ? this.panes.slice(0, 1) : this.panes).forEach(function (P) { P.chart.timeScale().setVisibleLogicalRange(r); });
  };
  Group.prototype.fit = function () {
    if (this.onFit) { this.onFit(); return; }
    var n = this.panes.length ? this.panes[0].times.length : 0;
    (this.sync ? this.panes.slice(0, 1) : this.panes).forEach(function (P) { P.chart.timeScale().setVisibleLogicalRange({ from: -1, to: n + 4 }); });
  };
  Group.prototype.addH = function (P, p) { var d = P.W(); d.h.push({ p: +(+p).toPrecision(6) }); save(); this.setMode(null); P.drawH(); };
  Group.prototype.addV = function (P, l) { var d = P.W(), pt = P.pt(l, 0); d.v.push({ d: pt.d, k: 0 }); save(); this.setMode(null); P.upd(); };
  Group.prototype.remove = function () {
    var s = this.sel; if (!s) return;
    var d = s.pane.W(); d[s.k].splice(s.i, 1);
    if (!(d.h || []).length && !(d.t || []).length && !(d.v || []).length) delete DR[s.pane.key];
    save(); this.sel = null; s.pane.drawH();
  };
  Group.prototype.destroy = function () {
    this.panes.forEach(function (P) { P.destroy(); }); this.panes = [];
    var k = TVG.all.indexOf(this); if (k >= 0) TVG.all.splice(k, 1); if (TVG.cur === this) TVG.cur = null;
  };
  Group.prototype.alive = function () { return this.panes.length && this.panes[0].box.isConnected; };

  document.addEventListener("keydown", function (e) {
    var G = TVG.cur; if (!G || !G.alive()) return;
    var tg = e.target, typing = tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.isContentEditable);
    if (typing) return;
    var k = e.code;
    if (e.altKey && k === "KeyH") { e.preventDefault(); if (G.hover && G.hover.p != null) G.addH(G.hover.pane, G.hover.p); else G.setMode("h"); return; }
    if (e.altKey && k === "KeyV") { e.preventDefault(); if (G.hover) G.addV(G.hover.pane, G.hover.l); else G.setMode("v"); return; }
    if (e.altKey && k === "KeyT") { e.preventDefault(); G.setMode(G.mode === "t" ? null : "t"); return; }
    if (e.altKey && k === "KeyR") { e.preventDefault(); G.setMode(G.mode === "r" ? null : "r"); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && G.sel) { e.preventDefault(); e.stopPropagation(); G.remove(); return; }
    if (e.key === "Escape" && (G.mode || G.pend || G.sel)) {
      e.preventDefault(); e.stopPropagation();
      if (G.mode || G.pend) G.setMode(null); else { var p = G.sel.pane; G.sel = null; p.drawH(); }
    }
  }, true);

  window.TV = { lib: lib, group: function (bar, o) { return new Group(bar, o); }, C: C, _g: TVG };
})();
