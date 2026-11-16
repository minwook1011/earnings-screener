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
  function blab(v) {   // 막대 데이터 라벨 — 짧게(1.2만 이상 k, 100 미만 소수 1자리)
    var a = Math.abs(v);
    if (a >= 10000) return (v / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    if (a >= 100 || v % 1 === 0) return Math.round(v).toLocaleString("ko-KR");
    return v.toFixed(1);
  }
  function yoyTxt(v) { return (v > 0 ? "+" : v < 0 ? "−" : "") + (Math.abs(v) >= 1000 ? (Math.round(Math.abs(v) / 100) / 10) + "k" : Math.round(Math.abs(v))) + "%"; }
  function nice(max) {
    if (max <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(max))), m = max / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  function axisTxt(v, u) { var a = Math.abs(v); return (a >= 10000 ? Math.round(v / 1000) + "k" : a >= 1000 ? (v / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : fmt(v, a < 10 ? u : "")) + (u === "%" ? "%" : ""); }

  function mtable(ch, rows) {   // 표 차트(table:1, 2026-11-16 사용자 — 월차 24개월 표) — 행 = 달(최신 위), 열 = cols[{k,l,u}]
    var cols = ch.cols || [];
    rows = rows.filter(function (r) { return cols.some(function (c) { return n(r[c.k]) != null; }); }).slice(-(ch.last || 24)).reverse();
    if (!rows.length) return "";
    return '<figure class="kd-fig kd-tbl"><figcaption><b>' + esc(ch.t) + "</b><span>" + esc(ch.cap || (/^\d{2}\.\d{2}$/.test(rows[0].x) ? "최신 달 위 · " + rows.length + "개월" : rows.length + "개 항목")) + "</span></figcaption>" +
      (ch.def ? '<p class="kd-def">' + esc(ch.def) + "</p>" : "") +
      '<div class="kd-tw"><table><thead><tr><th>' + esc(ch.xl || (/^\d{2}\.\d{2}$/.test(rows[0].x) ? "달" : "")) + '</th>' + cols.map(function (c) { return "<th>" + esc(c.l) + (c.u ? "<small>" + esc(c.u) + "</small>" : "") + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) {
        return "<tr><td>" + esc(r.x) + "</td>" + cols.map(function (c) {
          var v = n(r[c.k]), cl = c.yoy100 && v != null ? (v > 100 ? " up" : v < 100 ? " dn" : "") : c.yoy && v != null ? (v > 0 ? " up" : v < 0 ? " dn" : "") : "";
          return '<td class="n' + cl + '">' + (v == null ? "—" : esc(c.yoy100 || c.u === "%" ? v.toFixed(1) : fmt(v, c.u))) + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="kd-src">출처: ' + esc(ch.src || "") + "</p></figure>";
  }

  function chart(ch, rows) {
    if (ch.table) return mtable(ch, rows);
    var xk = ch.x || "x", bars = ch.bars || [], lines = ch.lines || [];
    if (ch.noplan) rows = rows.filter(function (r) { return !r.plan; });
    if (lines.length && rows.some(function (r) { return r.plan; }))   // 회사 계획 행에는 꺾은선을 잇지 않는다(실적만 선, 계획은 옅은 막대 — 2026-11-16 사용자)
      rows = rows.map(function (r) { if (!r.plan) return r; var o = {}; for (var k in r) o[k] = r[k]; lines.forEach(function (l) { if (!l.plan) o[l.k] = null; }); return o; });
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
    var split = bars.length && right.length && !ch.max;   // 막대 + 오른쪽 꺾은선: 막대는 아래, 선은 위
    var lmin = Math.min(0, Math.min.apply(null, lv)), lmax = ch.max || nice(Math.max.apply(null, lv) * (split ? 1.55 : 1.12));
    if (lmin < 0) lmin = -nice(-lmin);
    var rv = []; rows.forEach(function (r) { right.forEach(function (s) { var v = n(r[s.k]); if (v != null) rv.push(Math.min(v, 300)); }); });
    var rmin = Math.min(0, Math.min.apply(null, rv.concat([0]))), rmax = Math.max.apply(null, rv.concat([10])); var pad = (rmax - rmin) * 0.15; rmax += pad; if (rmin < 0) rmin -= pad;
    if (split) rmin -= (rmax - rmin) * 0.9;   // 선을 위쪽 절반에
    var bw = (W - L - R) / nn, x = function (i) { return L + bw * i + bw / 2; };
    var yl = function (v) { return T + (H - T - B) * (1 - (v - lmin) / (lmax - lmin)); };
    var yr = function (v) { return T + (H - T - B) * (1 - (Math.min(v, 300) - rmin) / (rmax - rmin)); };
    var unitL = (bars[0] || left[0] || {}).u || "";
    var g = "";
    [0.5, 1].forEach(function (f) { var v = lmin + (lmax - lmin) * f, y = yl(v); g += '<line class="kd-gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="kd-ax" x="' + (L - 4) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' + esc(axisTxt(v, unitL)) + "</text>"; });
    // 선을 위로 올린 차트는 오른쪽 축 맨 위 값만
    if (right.length) (split ? [1] : [0.5, 1]).forEach(function (f) { var v = rmin + (rmax - rmin) * f; g += '<text class="kd-ax" x="' + (W - R + 4) + '" y="' + (yr(v) + 3).toFixed(1) + '">' + Math.round(v) + "%</text>"; });
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
    if (bars.length && !ch.stack) {   // 막대 데이터 라벨 — 칸이 좁으면 첫 계열(민트)만, 옅은 막대는 빼고
      var wide = sub >= 19;
      rows.forEach(function (r, i) {
        bars.forEach(function (b, j) {
          var v = n(r[b.k]); if (v == null || b.f || (!wide && j > 0)) return;
          var cx = wide ? x(i) - gw / 2 + sub * j + sub / 2 : x(i) - gw / 2 + sub / 2;
          g += '<text class="kd-bl' + (wide || bars.length === 1 ? "" : " sm") + '" x="' + cx.toFixed(1) + '" y="' + (yl(Math.max(0, v)) - 3.5).toFixed(1) + '">' + esc(blab(v)) + "</text>";
        });
      });
    }
    var lastLab = [];   // 꺾은선은 최신 값만 글자로(2026-11-16 사용자) - 나머지는 마우스를 올리면 값 상자로
    lines.forEach(function (s) {
      var y = s.r ? yr : yl, pts = [];
      rows.forEach(function (r, i) { var v = n(r[s.k]); if (v != null) pts.push([x(i), v, i]); });
      if (pts.length > 1) g += '<polyline class="kd-l c' + s.c + '" points="' + pts.map(function (p) { return p[0].toFixed(1) + "," + y(p[1]).toFixed(1); }).join(" ") + '"/>';
      pts.forEach(function (p, k) {
        g += '<circle class="kd-d c' + s.c + '" cx="' + p[0].toFixed(1) + '" cy="' + y(p[1]).toFixed(1) + '" r="3.2"/>';
        if (k === pts.length - 1) lastLab.push({ c: s.c, x: p[0], y: y(p[1]) - 7, t: s.yoy ? yoyTxt(p[1]) : fmt(p[1], s.u) + (s.u === "%" ? "%" : "") });
      });
    });
    lastLab.sort(function (a, b) { return a.y - b.y; });   // 끝 글자끼리 겹치지 않게 11px 씩 벌린다
    for (var li = 1; li < lastLab.length; li++) if (lastLab[li].y - lastLab[li - 1].y < 11) lastLab[li].y = lastLab[li - 1].y + 11;
    lastLab.forEach(function (o) { g += '<text class="kd-lt c' + o.c + '" x="' + o.x.toFixed(1) + '" y="' + Math.max(9, o.y).toFixed(1) + '">' + esc(o.t) + "</text>"; });
    rows.forEach(function (r, i) {   // 칸마다 마우스 올리면 값 상자(kd-tip) - 계열마다 한 줄씩 색 표시와 함께
      var t = "<b>" + esc(String(r[xk]) + (ch.xs || "")) + "</b>" + bars.map(function (s) { return [s, 0]; }).concat(lines.map(function (s) { return [s, 1]; })).map(function (z) {
        var s = z[0], v = n(r[s.k]); if (v == null) return "";
        return '<span><i class="kd-sw ' + (z[1] ? "ln " : "") + "c" + s.c + '"></i>' + esc(s.l) + " <em>" + esc(s.yoy ? yoyTxt(v) : fmt(v, s.u) + (s.u ? " " + s.u : "")) + "</em></span>";
      }).join("");
      g += '<rect class="kd-hit" x="' + (L + bw * i).toFixed(1) + '" y="' + T + '" width="' + bw.toFixed(1) + '" height="' + (H - T - B) + '" data-tip="' + esc(t) + '"/>';
    });
    var leg = bars.map(function (b) { return '<i class="kd-sw c' + b.c + (b.f ? " m" : "") + '"></i>' + esc(b.l) + (b.u ? "(" + esc(b.u) + ")" : ""); })
      .concat(lines.map(function (s) { return '<i class="kd-sw ln c' + s.c + '"></i>' + esc(s.l) + (s.u && !s.yoy ? "(" + esc(s.u) + ")" : s.yoy ? "(%)" : ""); }));
    if (ch.muted) leg.push('<i class="kd-sw c0 m"></i>회사 계획');
    return '<figure class="kd-fig"><figcaption><b>' + esc(ch.t) + "</b><span>" + leg.join(" ") + "</span></figcaption>" +
      (ch.def ? '<p class="kd-def">' + esc(ch.def) + "</p>" : "") +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(ch.t) + '">' + g + "</svg>" +
      '<p class="kd-src">출처: ' + esc(ch.src || "") + "</p></figure>";
  }

  function quarterTable(doc) {   // 최근 12분기 재무제표(2026-11-16 사용자) — 2단계 리포트 맨 위 표(build_deep.py _fs_table)와 같은 모양
    var q = ((doc.tables || {}).q || []).filter(function (r) { return !r.plan && n(r.sales) != null; }).slice(-12);
    if (!q.length) return "";
    var by = {}; ((doc.tables || {}).q || []).forEach(function (r) { by[r.x] = r; });
    function prev(x) { var m = /^(\d+)\.(\d)Q$/.exec(x || ""); return m ? by[(+m[1] - 1) + "." + m[2] + "Q"] : null; }
    function yo(r, k) { if (n(r[k + "_yoy"]) != null) return n(r[k + "_yoy"]); var b = prev(r.x), a = n(r[k]), c = b ? n(b[k]) : null; return a != null && c != null && c > 0 ? (a / c - 1) * 100 : null; }
    function mg(r, k) { var a = n(r[k]), s = n(r.sales); return a != null && s ? a / s * 100 : null; }
    var rows = [["매출액", function (r) { return n(r.sales); }, "num", "mj"], ["YoY", function (r) { return yo(r, "sales"); }, "yoy", "g"],
      ["매출총이익", function (r) { return n(r.gp); }, "num", "sep"], ["GPM", function (r) { return mg(r, "gp"); }, "pct", "g"],
      ["영업이익", function (r) { return n(r.op); }, "num", "mj sep"], ["OPM", function (r) { return mg(r, "op"); }, "pct", "g"], ["YoY", function (r) { return yo(r, "op"); }, "yoy", "g"],
      ["순이익", function (r) { return n(r.net); }, "num", "mj sep"], ["YoY", function (r) { return yo(r, "net"); }, "yoy", "g"]];
    var last = q.length - 1, cur = function (i) { return i === last ? " cur" : ""; };
    var pc = function (v, sg) { return v == null ? "—" : (sg && v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "%"; };
    var head = '<tr class="curl"><th></th>' + q.map(function (r, i) { return i === last ? '<th class="curt">이번 실적' + (r.pub ? "(" + esc(r.pub) + ")" : "") + "</th>" : "<th></th>"; }).join("") + "</tr>" +
      "<tr><th>억엔</th>" + q.map(function (r, i) { return '<th class="' + cur(i).trim() + '">' + esc(r.x) + (r.span ? '<small class="qs">' + esc(r.span) + "</small>" : "") + (r.pub ? '<small class="qp">발표 ' + esc(r.pub) + "</small>" : "") + "</th>"; }).join("") + "</tr>";
    var major = "", body = "";
    rows.forEach(function (sp) {
      if (sp[2] === "num") major = sp[0];
      var vals = q.map(sp[1]); if (vals.every(function (v) { return v == null; })) return;
      body += '<tr class="' + sp[3] + '"><td>' + esc(sp[0]) + "</td>" + vals.map(function (v, i) {
        var t = sp[2] === "num" ? fmt(v, "억엔") : pc(v, sp[2] === "yoy"), ring = i === last && sp[2] === "yoy" && (major === "매출액" || major === "영업이익") && v != null;
        return '<td class="n' + (ring ? " hl" : "") + cur(i) + '">' + (ring ? "<span>" + esc(t) + "</span>" : esc(t)) + "</td>";
      }).join("") + "</tr>";
    });
    return '<div class="dsec"><span>분기 재무제표 · 최근 ' + q.length + '분기</span><span class="hint">억엔 · 오른쪽이 최근</span></div><div class="tw kdq-w"><table class="fst kdq"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>";
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

  function bindTip(root) {   // 마우스를 올린 칸의 값 - 차트 위에 뜨는 작은 상자(글자가 겹치지 않게)
    if (!root) return;
    root.querySelectorAll(".kd-fig").forEach(function (fig) {
      var tip = document.createElement("div"); tip.className = "kd-tip"; fig.appendChild(tip);
      fig.querySelectorAll(".kd-hit").forEach(function (h) {
        h.addEventListener("mouseenter", function () { tip.innerHTML = h.getAttribute("data-tip"); tip.style.display = "block"; });
        h.addEventListener("mousemove", function (e) {
          var r = fig.getBoundingClientRect(), x = e.clientX - r.left, w = tip.offsetWidth;
          tip.style.left = Math.max(4, Math.min(r.width - w - 4, x + 14 + w > r.width ? x - w - 14 : x + 14)) + "px";
          tip.style.top = Math.max(4, e.clientY - r.top - tip.offsetHeight - 10) + "px";
        });
        h.addEventListener("mouseleave", function () { tip.style.display = "none"; });
      });
    });
  }
  function draw(doc, keyEl, mainEl) {
    var T = doc.tables || {}, charts = doc.charts || [];
    var rows = function (ch) { return T[ch.d] || []; };
    if (keyEl) keyEl.innerHTML = charts.filter(function (c) { return c.sec === "key"; }).map(function (c) { return chart(c, rows(c)); }).join("");
    if (!mainEl) return;
    var secs = [];
    charts.forEach(function (c) { if (c.sec !== "key" && secs.indexOf(c.sec) < 0) secs.push(c.sec); });
    mainEl.innerHTML = quarterTable(doc) + annualTable(doc) +
      '<div class="dsec"><span>데이터</span><span class="hint">' + esc(doc.latest || "") + " 자료 · " + esc(doc.unit || "") + "</span></div>" +
      secs.map(function (s) {
        return '<div class="kd-sec">' + esc(s) + '</div><div class="kd-grid">' + charts.filter(function (c) { return c.sec === s; }).map(function (c) { return chart(c, rows(c)); }).join("") + "</div>";
      }).join("") +
      '<details class="kd-rule"><summary>차트 원칙</summary><p>절댓값은 막대, 비율·성장률·비교는 꺾은선. 막대 색은 민트 → 보라 → 하늘 → 살구 → 분홍 → 버터 → 회청 순서로, 최신 값이 큰 계열부터. 꺾은선은 노랑 → 초록 → 파랑 → 빨강 → 보라 → 청록 → 회색. YoY 는 노란 선과 오른쪽 축.</p></details>';
    [keyEl, mainEl].forEach(bindTip);
    mainEl.querySelectorAll(".ftw,.kdq-w").forEach(function (tw) { tw.scrollLeft = tw.scrollWidth; });
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
