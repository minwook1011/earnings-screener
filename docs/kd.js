/* 기업 데이터 차트(2026-11-13 사용자) — 상세 패널 아래에 실적 자료의 핵심 숫자를 차트로.
 * 데이터: data/jp/kd/<코드>.json (실적 발표 때마다 Claude 가 결산단신·설명회 자료에서 갱신)
 *   tables: { q: 분기 행, a: 연간 행, ... }  각 행의 x = 가로축 이름
 *   charts: [{ sec, t(제목), def(정의), d(표 이름), x(가로축 열, 기본 x), bars:[{k,l,u,c,f(옅게 40%)}], lines:[{k,l,u,c,yoy,r}], stack, max, muted, noplan, src }]
 * 차트 원칙: 절댓값 = 막대, 비율·성장률·비교 = 꺾은선.
 *   막대 색 순서 민트 → 보라 → 하늘 → 살구 → 분홍 → 버터 → 회청(계열은 최신 값이 큰 것부터 c=0,1,…)
 *   꺾은선 색 순서 노랑 → 초록 → 파랑 → 빨강 → 보라 → 청록 → 회색. YoY 는 노란 꺾은선 + 오른쪽 축 + 점마다 값. */
(function () {
  var CACHE = {};
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]; }); }
  function n(v) { return v == null || v === "" || isNaN(+v) ? null : +v; }
  function fmt(v, u) {
    if (v == null) return "—";
    var a = Math.abs(v), d = u === "%" || u === "개월" || (a < 100 && v % 1) ? (a < 10 && u !== "%" ? 2 : 1) : 0;
    if (u === "억엔" && a < 100) d = 2;
    return v.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function yoyTxt(v) { return (v > 0 ? "+" : v < 0 ? "−" : "") + (Math.abs(v) >= 1000 ? (Math.round(Math.abs(v) / 100) / 10) + "k" : Math.round(Math.abs(v))) + "%"; }
  function nice(max) {
    if (max <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(max))), m = max / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  function axisTxt(v, u) { var a = Math.abs(v); return (a >= 10000 ? Math.round(v / 1000) + "k" : a >= 1000 ? (v / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : fmt(v, a < 10 ? u : "")) + (u === "%" ? "%" : ""); }

  function chart(ch, rows) {
    var xk = ch.x || "x", bars = ch.bars || [], lines = ch.lines || [];
    if (ch.noplan) rows = rows.filter(function (r) { return !r.plan; });
    rows = rows.filter(function (r) { return bars.concat(lines).some(function (s) { return n(r[s.k]) != null; }); });
    var W = 440, H = 200, L = 34, R = lines.some(function (s) { return s.r; }) ? 36 : 10, T = 22, B = 24, nn = rows.length;
    if (!nn) return "";
    var left = lines.filter(function (s) { return !s.r; }), right = lines.filter(function (s) { return s.r; });
    var lv = [];
    rows.forEach(function (r) {
      if (ch.stack) lv.push(bars.reduce(function (s, b) { return s + (n(r[b.k]) || 0); }, 0));
      else bars.forEach(function (b) { var v = n(r[b.k]); if (v != null) lv.push(v); });
      left.forEach(function (s) { var v = n(r[s.k]); if (v != null) lv.push(v); });
    });
    var lmin = Math.min(0, Math.min.apply(null, lv)), lmax = ch.max || nice(Math.max.apply(null, lv) * 1.05);
    if (lmin < 0) lmin = -nice(-lmin);
    var rv = []; rows.forEach(function (r) { right.forEach(function (s) { var v = n(r[s.k]); if (v != null) rv.push(Math.min(v, 300)); }); });
    var rmin = Math.min(0, Math.min.apply(null, rv.concat([0]))), rmax = Math.max.apply(null, rv.concat([10])); var pad = (rmax - rmin) * 0.15; rmax += pad; if (rmin < 0) rmin -= pad;
    var bw = (W - L - R) / nn, x = function (i) { return L + bw * i + bw / 2; };
    var yl = function (v) { return T + (H - T - B) * (1 - (v - lmin) / (lmax - lmin)); };
    var yr = function (v) { return T + (H - T - B) * (1 - (Math.min(v, 300) - rmin) / (rmax - rmin)); };
    var unitL = (bars[0] || left[0] || {}).u || "";
    var g = "";
    [0.5, 1].forEach(function (f) { var v = lmin + (lmax - lmin) * f, y = yl(v); g += '<line class="kd-gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="kd-ax" x="' + (L - 4) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' + esc(axisTxt(v, unitL)) + "</text>"; });
    if (right.length) [0.5, 1].forEach(function (f) { var v = rmin + (rmax - rmin) * f; g += '<text class="kd-ax" x="' + (W - R + 4) + '" y="' + (yr(v) + 3).toFixed(1) + '">' + Math.round(v) + "%</text>"; });
    var z = yl(Math.max(0, lmin));
    g += '<line class="kd-z" x1="' + L + '" x2="' + (W - R) + '" y1="' + z.toFixed(1) + '" y2="' + z.toFixed(1) + '"/>';
    var step = Math.max(1, Math.ceil((nn * 34) / (W - L - R)));
    var gw = bw * (ch.stack ? 0.62 : 0.74), sub = ch.stack ? gw : gw / Math.max(1, bars.length);
    rows.forEach(function (r, i) {
      var acc = 0, mut = ch.muted && r[ch.muted] ? " m" : "";
      bars.forEach(function (b, j) {
        var v = n(r[b.k]); if (v == null) return;
        var y0, y1, xx;
        if (ch.stack) { y0 = yl(acc); y1 = yl(acc + v); acc += v; xx = x(i) - gw / 2; }
        else { y0 = yl(0); y1 = yl(v); xx = x(i) - gw / 2 + sub * j; }
        g += '<rect class="kd-b c' + b.c + (b.f ? " m" : mut) + '" x="' + (xx + (ch.stack ? 0 : 0.6)).toFixed(1) + '" y="' + Math.min(y0, y1).toFixed(1) + '" width="' + Math.max(1, sub - (ch.stack ? 0 : 1.2)).toFixed(1) + '" height="' + Math.max(0.8, Math.abs(y1 - y0)).toFixed(1) + '" rx="1.5"/>';
      });
      var lab = String(r[xk]) + (ch.xs || "");
      if ((nn - 1 - i) % step === 0) g += '<text class="kd-xl" x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '">' + esc(lab.length > 7 && ch.x ? lab.slice(0, 7) : lab) + "</text>";
    });
    if (bars.length && !lines.length) {   // 막대만 있으면 마지막 값 표시
      var lr = rows[nn - 1], b0 = bars[0], v0 = n(lr[b0.k]);
      if (v0 != null && !ch.stack) g += '<text class="kd-vl" x="' + (x(nn - 1) - gw / 2 + sub / 2).toFixed(1) + '" y="' + (yl(Math.max(0, v0)) - 5).toFixed(1) + '">' + esc(fmt(v0, b0.u)) + "</text>";
    }
    var labelAll = bw >= 26;
    lines.forEach(function (s) {
      var y = s.r ? yr : yl, pts = [];
      rows.forEach(function (r, i) { var v = n(r[s.k]); if (v != null) pts.push([x(i), v, i]); });
      if (pts.length > 1) g += '<polyline class="kd-l c' + s.c + '" points="' + pts.map(function (p) { return p[0].toFixed(1) + "," + y(p[1]).toFixed(1); }).join(" ") + '"/>';
      pts.forEach(function (p, k) {
        g += '<circle class="kd-d c' + s.c + '" cx="' + p[0].toFixed(1) + '" cy="' + y(p[1]).toFixed(1) + '" r="3.2"/>';
        if (labelAll || k === pts.length - 1) g += '<text class="kd-lt c' + s.c + '" x="' + p[0].toFixed(1) + '" y="' + (y(p[1]) - 7).toFixed(1) + '">' + esc(s.yoy ? yoyTxt(p[1]) : fmt(p[1], s.u) + (s.u === "%" ? "%" : "")) + "</text>";
      });
    });
    rows.forEach(function (r, i) {   // 칸마다 마우스 올리면 값
      var t = String(r[xk]) + (ch.xs || "") + bars.concat(lines).map(function (s) { var v = n(r[s.k]); return v == null ? "" : "\n" + s.l + " " + (s.yoy ? yoyTxt(v) : fmt(v, s.u) + (s.u ? " " + s.u : "")); }).join("");
      g += '<rect class="kd-hit" x="' + (L + bw * i).toFixed(1) + '" y="' + T + '" width="' + bw.toFixed(1) + '" height="' + (H - T - B) + '"><title>' + esc(t) + "</title></rect>";
    });
    var leg = bars.map(function (b) { return '<i class="kd-sw c' + b.c + (b.f ? " m" : "") + '"></i>' + esc(b.l) + (b.u ? "(" + esc(b.u) + ")" : ""); })
      .concat(lines.map(function (s) { return '<i class="kd-sw ln c' + s.c + '"></i>' + esc(s.l) + (s.u && !s.yoy ? "(" + esc(s.u) + ")" : s.yoy ? "(%)" : ""); }));
    if (ch.muted) leg.push('<i class="kd-sw c0 m"></i>회사 계획');
    return '<figure class="kd-fig"><figcaption><b>' + esc(ch.t) + "</b><span>" + leg.join(" ") + "</span></figcaption>" +
      (ch.def ? '<p class="kd-def">' + esc(ch.def) + "</p>" : "") +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(ch.t) + '">' + g + "</svg>" +
      '<p class="kd-src">출처: ' + esc(ch.src || "") + "</p></figure>";
  }

  function annualTable(doc) {   // 분기 표와 같은 항목·틀(app.js FTABLE)
    var a = (doc.tables || {}).a || [];
    if (!a.length || !window.FTABLE) return "";
    var lastAct = -1; a.forEach(function (r, i) { if (!r.plan) lastAct = i; });
    var cols = a.map(function (r, i) {
      var p = a[i - 1], op = n(r.op), pop = p ? n(p.op) : null, gp = n(r.gp);
      return { p: r.x, plan: !!r.plan, now: i === lastAct, d: r, s: n(r.sales), g: gp, op: op, ni: n(r.net),
        sg: n(r.sga) != null ? n(r.sga) : gp != null && op != null ? gp - op : null,
        sy: n(r.sales_yoy), oy: n(r.op_yoy) != null ? n(r.op_yoy) : op != null && pop > 0 ? (op / pop - 1) * 100 : null };
    });
    return '<div class="dsec"><span>연간 재무제표</span><span class="hint">억엔 · 옅은 열 = 회사 계획</span></div>' + window.FTABLE(cols, { unit: "억엔", det: doc.annual_detail }) +
      '<p class="kd-src">출처: ' + esc(doc.annual_src || "") + "</p>";
  }

  function draw(doc, keyEl, mainEl) {
    var T = doc.tables || {}, charts = doc.charts || [];
    var rows = function (ch) { return T[ch.d] || []; };
    if (keyEl) keyEl.innerHTML = charts.filter(function (c) { return c.sec === "key"; }).map(function (c) { return chart(c, rows(c)); }).join("");
    if (!mainEl) return;
    var secs = [];
    charts.forEach(function (c) { if (c.sec !== "key" && secs.indexOf(c.sec) < 0) secs.push(c.sec); });
    mainEl.innerHTML = annualTable(doc) +
      '<div class="dsec"><span>데이터</span><span class="hint">' + esc(doc.latest || "") + " 자료 · " + esc(doc.unit || "") + "</span></div>" +
      secs.map(function (s) {
        return '<div class="kd-sec">' + esc(s) + '</div><div class="kd-grid">' + charts.filter(function (c) { return c.sec === s; }).map(function (c) { return chart(c, rows(c)); }).join("") + "</div>";
      }).join("") +
      '<details class="kd-rule"><summary>차트 원칙</summary><p>절댓값은 막대, 비율·성장률·비교는 꺾은선. 막대 색은 민트 → 보라 → 하늘 → 살구 → 분홍 → 버터 → 회청 순서로, 최신 값이 큰 계열부터. 꺾은선은 노랑 → 초록 → 파랑 → 빨강 → 보라 → 청록 → 회색. YoY 는 노란 선과 오른쪽 축.</p></details>';
    var tw = mainEl.querySelector(".ftw"); if (tw) tw.scrollLeft = tw.scrollWidth;
  }

  window.KD = {
    mount: function (c, keyEl, mainEl) {
      if (!keyEl && !mainEl) return;
      var idx = CACHE._idx || (CACHE._idx = fetch("data/jp/kd/index.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }));
      var p = CACHE[c] || (CACHE[c] = idx.then(function (ix) {   // 자료 있는 회사만 부름(없는 회사는 404 없이 조용히 빠짐)
        if (!ix[c]) throw new Error("none");
        return fetch("data/jp/kd/" + encodeURIComponent(c) + ".json?v=" + encodeURIComponent(ix[c]), { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
      }));
      p.then(function (doc) { draw(doc, keyEl, mainEl); }).catch(function () { if (keyEl) keyEl.remove(); if (mainEl) mainEl.remove(); });
    },
  };
})();
