/* 큰 차트(트레이딩뷰 느낌) — 일본 스크리닝 카드를 누르면 열림(2026-10-29 사용자).
 * 차트 = vendor/lightweight-charts(TradingView 오픈소스, CSP 때문에 사이트 안에 둠). 일봉 2년 data/jp/px/<코드>.json
 * 선 긋기: Alt+H 수평선(커서 높이) · Alt+T 추세선(두 번 클릭) · 선 클릭 → Delete 로 지움 · 우클릭으로 바로 지움 · Esc 취소
 * 그린 선은 이 브라우저에 저장(localStorage "es-draw" — 종목별) */
(function () {
  "use strict";
  var LIB = "vendor/lightweight-charts-4.2.0.js?v=1", KEY = "es-draw";
  var DR = (function () { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } })();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(DR)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(v) { return v == null ? "—" : (+v).toLocaleString("ko-KR", { maximumFractionDigits: v < 100 ? 1 : 0 }); }
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  var libP = null;
  function lib() {
    if (window.LightweightCharts) return Promise.resolve();
    return libP || (libP = new Promise(function (ok, no) { var s = document.createElement("script"); s.src = LIB; s.onload = ok; s.onerror = no; document.head.appendChild(s); }));
  }

  var M = null, ch = null, ser = null, rows = [], code = null, mode = null, pend = null, sel = null, hover = null, plines = [], raf = 0;
  var UP = "#d23b3b", DN = "#2f6bd8", MAS = [[5, "#e0a100"], [20, "#d23b8f"], [60, "#2a9d5c"], [120, "#7a5cd6"]];

  function shell() {
    if (M) return M;
    M = document.createElement("div");
    M.className = "pxm"; M.setAttribute("role", "dialog"); M.setAttribute("aria-modal", "true");
    M.innerHTML = '<div class="pxm-in"><div class="pxm-hd"><div class="pxm-tt"><b id="pxm-n"></b><span id="pxm-c"></span><span id="pxm-p"></span></div>' +
      '<div class="pxm-tools"><div class="seg" id="pxm-rng">' + [["3M", 63], ["6M", 126], ["1Y", 250], ["2Y", 0]].map(function (r) { return '<button data-n="' + r[1] + '">' + r[0] + "</button>"; }).join("") + "</div>" +
      '<button data-tool="h" title="Alt+H — 커서 높이에 수평선">수평선 <kbd>Alt+H</kbd></button><button data-tool="t" title="Alt+T — 두 점을 클릭">추세선 <kbd>Alt+T</kbd></button>' +
      '<button data-tool="del" title="선을 클릭해 고른 뒤 Delete">선 지우기</button><button data-tool="clr">모두 지우기</button>' +
      '<button data-tool="co" class="pxm-co">리포트·재무</button><button class="pxm-x" data-tool="x" aria-label="닫기">✕</button></div></div>' +
      '<div class="pxm-leg" id="pxm-leg"></div><div class="pxm-ch" id="pxm-ch"><svg class="pxm-svg" id="pxm-svg"></svg></div>' +
      '<div class="pxm-ft" id="pxm-ft">Alt+H 수평선 · Alt+T 추세선(두 점 클릭) · 선 클릭 후 Delete 또는 우클릭으로 지우기 · Esc 취소 · 그린 선은 이 브라우저에 저장됩니다</div></div>';
    document.body.appendChild(M);
    M.addEventListener("click", function (e) { if (e.target === M) close(); });
    M.querySelectorAll("#pxm-rng button").forEach(function (b) { b.onclick = function () { range(+b.dataset.n); }; });
    M.querySelectorAll("[data-tool]").forEach(function (b) {
      b.onclick = function () {
        var t = b.dataset.tool;
        if (t === "x") close();
        else if (t === "h") setMode(mode === "h" ? null : "h");
        else if (t === "t") setMode(mode === "t" ? null : "t");
        else if (t === "del") { if (sel) remove(sel); else hint("지울 선을 먼저 클릭하세요"); }
        else if (t === "clr") { if (confirm("이 종목에 그린 선을 모두 지울까요?")) { DR[code] = { h: [], t: [] }; save(); sel = null; drawH(); } }
        else if (t === "co" && M._co) { var f = M._co; close(); f(); }
      };
    });
    document.addEventListener("keydown", key, true);
    return M;
  }
  function hint(t) { var f = document.getElementById("pxm-ft"); f.textContent = t; f.classList.add("on"); clearTimeout(f._t); f._t = setTimeout(function () { f.classList.remove("on"); f.textContent = "Alt+H 수평선 · Alt+T 추세선(두 점 클릭) · 선 클릭 후 Delete 또는 우클릭으로 지우기 · Esc 취소 · 그린 선은 이 브라우저에 저장됩니다"; }, 2500); }
  function setMode(m) {
    mode = m; pend = null;
    M.querySelectorAll("[data-tool=h],[data-tool=t]").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.tool === m); });
    M.classList.toggle("drawing", !!m);
    if (m === "t") hint("추세선: 시작점을 클릭하세요");
    if (m === "h") hint("수평선: 그을 높이를 클릭하세요(또는 Alt+H)");
  }
  function key(e) {
    if (!M || !M.classList.contains("on")) return;
    var k = e.code;
    if (e.altKey && k === "KeyH") { e.preventDefault(); e.stopPropagation(); addH(hover ? hover.p : rows[rows.length - 1][4]); return; }
    if (e.altKey && k === "KeyT") { e.preventDefault(); e.stopPropagation(); setMode(mode === "t" ? null : "t"); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); remove(sel); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (mode || pend) setMode(null); else if (sel) { sel = null; drawH(); } else close(); }
  }

  /* 점 저장 = {d: 날짜, k: 그 날짜에서 몇 봉 떨어졌나(오른쪽 빈 곳), p: 가격} — 데이터가 늘거나 앞이 잘려도 같은 자리 */
  function toPt(l, p) { var n = rows.length - 1, i = Math.max(0, Math.min(n, Math.round(l))); return { d: rows[i][0], k: +(l - i).toFixed(2), p: +p.toFixed(2) }; }
  function lg(pt) { var i = 0; while (i < rows.length - 1 && rows[i][0] < pt.d) i++; return i + (pt.k || 0); }
  function D() { return DR[code] || (DR[code] = { h: [], t: [] }); }

  function addH(p) { if (p == null) return; D().h.push({ p: +(+p).toFixed(2) }); save(); setMode(null); drawH(); }
  function remove(s) { var d = D(); d[s.k].splice(s.i, 1); if (!d.h.length && !d.t.length) delete DR[code]; save(); sel = null; drawH(); }
  function drawH() {
    plines.forEach(function (l) { ser.removePriceLine(l); }); plines = [];
    D().h.forEach(function (h, i) {
      var on = sel && sel.k === "h" && sel.i === i;
      plines.push(ser.createPriceLine({ price: h.p, color: on ? "#f2a900" : css("--ink") || "#333", lineWidth: on ? 2 : 1, lineStyle: 0, axisLabelVisible: true, title: "" }));
    });
  }
  function drawT() {
    var svg = document.getElementById("pxm-svg"); if (!svg || !ch) return;
    var ts = ch.timeScale(), w = ts.width(), g = "";
    svg.setAttribute("width", w); svg.setAttribute("height", document.getElementById("pxm-ch").clientHeight);
    function xy(pt) { var x = ts.logicalToCoordinate(lg(pt)), y = ser.priceToCoordinate(pt.p); return x == null || y == null ? null : [x, y]; }
    D().t.forEach(function (t, i) {
      var a = xy(t.a), b = xy(t.b); if (!a || !b) return;
      var on = sel && sel.k === "t" && sel.i === i;
      g += '<line class="tl' + (on ? " on" : "") + '" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '"/>' +
        (on ? '<circle class="tp" cx="' + a[0] + '" cy="' + a[1] + '" r="4"/><circle class="tp" cx="' + b[0] + '" cy="' + b[1] + '" r="4"/>' : "");
    });
    if (pend && hover) { var a2 = xy(pend), b2 = [ts.logicalToCoordinate(hover.l), ser.priceToCoordinate(hover.p)]; if (a2 && b2[0] != null) g += '<line class="tl pv" x1="' + a2[0] + '" y1="' + a2[1] + '" x2="' + b2[0] + '" y2="' + b2[1] + '"/>'; }
    svg.innerHTML = g;
  }
  function loop() { drawT(); raf = requestAnimationFrame(loop); }
  /* 클릭 지점 근처 선 찾기(6px) */
  function hit(x, y) {
    var ts = ch.timeScale(), best = null, bd = 7;
    D().h.forEach(function (h, i) { var yy = ser.priceToCoordinate(h.p); if (yy != null && Math.abs(yy - y) < bd) { bd = Math.abs(yy - y); best = { k: "h", i: i }; } });
    D().t.forEach(function (t, i) {
      var ax = ts.logicalToCoordinate(lg(t.a)), ay = ser.priceToCoordinate(t.a.p), bx = ts.logicalToCoordinate(lg(t.b)), by = ser.priceToCoordinate(t.b.p);
      if ([ax, ay, bx, by].indexOf(null) >= 0) return;
      var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, u = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      var d = Math.hypot(x - (ax + u * dx), y - (ay + u * dy)); if (d < bd) { bd = d; best = { k: "t", i: i }; }
    });
    return best;
  }

  function range(n) {
    if (!ch) return;
    var L = rows.length;
    if (!n || n >= L) ch.timeScale().setVisibleLogicalRange({ from: -2, to: L + 4 }); else ch.timeScale().setVisibleLogicalRange({ from: L - n, to: L + 4 });
    M.querySelectorAll("#pxm-rng button").forEach(function (b) { b.setAttribute("aria-pressed", +b.dataset.n === n); });
    try { localStorage.setItem("es-rng", n); } catch (e) {}
  }
  function legend(i) {
    var r = rows[i == null ? rows.length - 1 : i]; if (!r) return;
    var j = rows.indexOf(r), pv = j > 0 ? rows[j - 1][4] : r[4], chg = (r[4] / pv - 1) * 100;
    var mas = MAS.map(function (m) { var v = ma(m[0])[j]; return '<span class="ma" data-c="' + m[1] + '"><i class="ma' + m[0] + '"></i>MA' + m[0] + " " + fmt(v) + "</span>"; }).join("");
    document.getElementById("pxm-leg").innerHTML = '<span class="d">' + esc(r[0]) + "</span> 시 <b>" + fmt(r[1]) + "</b> 고 <b>" + fmt(r[2]) + "</b> 저 <b>" + fmt(r[3]) + "</b> 종 <b class=\"" + (chg >= 0 ? "up" : "dn") + "\">" + fmt(r[4]) + " (" + (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%)</b> 거래량 <b>" + (r[5] || 0).toLocaleString("ko-KR") + "</b>" + mas;
  }
  var MAC = {};
  function ma(n) {
    if (MAC[n]) return MAC[n];
    var out = [], s = 0; rows.forEach(function (r, i) { s += r[4]; if (i >= n) s -= rows[i - n][4]; out.push(i >= n - 1 ? s / n : null); });
    return (MAC[n] = out);
  }

  function open(c, name, onCo) {
    shell(); M._co = onCo; code = c; sel = null; pend = null; mode = null; hover = null; MAC = {};
    document.getElementById("pxm-n").textContent = name; document.getElementById("pxm-c").textContent = c;
    document.getElementById("pxm-p").textContent = ""; document.getElementById("pxm-leg").textContent = "불러오는 중…";
    M.classList.add("on"); document.documentElement.classList.add("pxm-open");
    Promise.all([lib(), fetch("data/jp/px/" + c + ".json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })]).then(function (x) {
      if (code !== c) return;
      rows = x[1]; build();
    }).catch(function (e) { document.getElementById("pxm-leg").textContent = "차트를 못 불러왔습니다(" + e.message + ")"; });
  }
  function build() {
    var box = document.getElementById("pxm-ch");
    if (ch) { ch.remove(); ch = null; }
    var LC = window.LightweightCharts, ink = css("--ink") || "#222", line = css("--line") || "#e3e3e3", bg = css("--surface") || "#fff";
    ch = LC.createChart(box, {
      autoSize: true, layout: { background: { color: bg }, textColor: ink, fontFamily: "Pretendard Variable, Pretendard, sans-serif", attributionLogo: false },
      grid: { vertLines: { color: line }, horzLines: { color: line } }, crosshair: { mode: 0 },
      rightPriceScale: { borderColor: line, scaleMargins: { top: 0.06, bottom: 0.24 } }, timeScale: { borderColor: line, rightOffset: 4, minBarSpacing: 1 },
      localization: { locale: "ko-KR", dateFormat: "yyyy-MM-dd" }
    });
    ser = ch.addCandlestickSeries({ upColor: UP, downColor: DN, borderUpColor: UP, borderDownColor: DN, wickUpColor: UP, wickDownColor: DN });
    ser.setData(rows.map(function (r) { return { time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] }; }));
    var vol = ch.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    ch.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    vol.setData(rows.map(function (r, i) { return { time: r[0], value: r[5], color: (i && r[4] < rows[i - 1][4] ? DN : UP) + "55" }; }));
    MAS.forEach(function (m) {
      var s = ch.addLineSeries({ color: m[1], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(ma(m[0]).map(function (v, i) { return v == null ? { time: rows[i][0] } : { time: rows[i][0], value: v }; }));
    });
    // 52주 고가
    var w = rows.slice(-250), hi = Math.max.apply(null, w.map(function (r) { return r[2]; }));
    ser.createPriceLine({ price: hi, color: "#f2a900", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "52주 고가" });
    var last = rows[rows.length - 1], pv = rows[rows.length - 2] || last, chg = (last[4] / pv[4] - 1) * 100;
    var pe = document.getElementById("pxm-p"); pe.textContent = fmt(last[4]) + "엔 " + (chg >= 0 ? "+" : "") + chg.toFixed(2) + "% · 52주 고가 " + fmt(hi) + " (" + ((last[4] / hi - 1) * 100).toFixed(1) + "%)"; pe.className = chg >= 0 ? "up" : "dn";
    legend();
    ch.subscribeCrosshairMove(function (p) {
      if (!p.point || p.logical == null) { hover = null; legend(); return; }
      hover = { l: p.logical, p: ser.coordinateToPrice(p.point.y) };
      legend(Math.max(0, Math.min(rows.length - 1, Math.round(p.logical))));
    });
    ch.subscribeClick(function (p) {
      if (!p.point) return;
      var l = ch.timeScale().coordinateToLogical(p.point.x), pr = ser.coordinateToPrice(p.point.y);
      if (mode === "h") { addH(pr); return; }
      if (mode === "t") {
        if (!pend) { pend = toPt(l, pr); hint("추세선: 끝점을 클릭하세요"); return; }
        D().t.push({ a: pend, b: toPt(l, pr) }); save(); setMode(null); return;
      }
      sel = hit(p.point.x, p.point.y); drawH();
      if (sel) hint("고른 선: Delete 키 또는 '선 지우기'로 지웁니다");
    });
    box.oncontextmenu = function (e) {
      var r = box.getBoundingClientRect(), h = hit(e.clientX - r.left, e.clientY - r.top);
      if (h) { e.preventDefault(); remove(h); }
    };
    drawH();
    var n0 = 250; try { var s0 = localStorage.getItem("es-rng"); if (s0 != null) n0 = +s0; } catch (e) {}
    range(n0);
    cancelAnimationFrame(raf); loop();
  }
  function close() {
    if (!M) return;
    M.classList.remove("on", "drawing"); document.documentElement.classList.remove("pxm-open");
    cancelAnimationFrame(raf); if (ch) { ch.remove(); ch = null; } code = null; mode = null; pend = null; sel = null;
  }
  window.PXC = { open: open, close: close };
})();
