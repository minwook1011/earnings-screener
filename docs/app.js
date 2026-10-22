/* 실적발표스크리너 — 일본 탭.
 *  1단계: 실적 발표 기업 이름·티커만 모아 둔 목록
 *  2~4단계: VANTAGE 스크리너 같은 표 + 기업마다 둘째 줄(최근 10개 분기 매출·영업이익 성장률)
 *  어느 기업이든 누르면 오른쪽 패널(주가 1년·분기 실적·텔레 카드·리서치)
 * 데이터: data/jp/stage1.json · pipeline.json · qyoy.json · research/index.json · co/<코드>.json
 * 주소: #jp/1 · #jp/2 · #jp/3 · #jp/4 · #jp/c/<코드> · #us · #kr */
(function () {
  "use strict";
  var STAGES = [
    { n: 1, lab: "1단계 · 퀵", hint: "실적 발표 기업 전체" },
    { n: 2, lab: "2단계 · 분석", hint: "볼 후보 — 점수·실적 분석" },
    { n: 3, lab: "3단계 · 딥", hint: "깊은 리포트·매수 근거" },
    { n: 4, lab: "4단계 · 결정", hint: "살지 말지 결정 직전" }
  ];
  var NOTE = {
    1: "실적을 발표한 기업을 이름과 티커만 모았습니다. 누르면 주가와 실적이 열립니다. 텔레그램 1단계 카드에서 [볼 후보]를 누르면 2단계로 올라갑니다.",
    2: "볼 후보로 고른 회사입니다. 둘째 줄은 최근 10개 분기의 매출·영업이익 성장률(전년 같은 분기 대비)입니다. 2단계 실적 분석 리서치가 붙습니다.",
    3: "다 같이 깊게 보고 매수 여부·비중·근거·다시 볼 조건을 정리합니다. 3단계 딥 리포트가 붙습니다.",
    4: "4단계까지 왔으면 사기 직전 좋은 종목입니다. 다 같이 보고 살지 말지 결정합니다."
  };
  var EMPTY = {
    2: "1단계 카드에서 [볼 후보]를 누르면 이곳으로 옵니다.",
    3: "2단계 카드에서 [3단계로]를 누르면 이곳으로 옮겨지고, 3단계 딥 리포트가 자동으로 붙습니다.",
    4: "3단계에서 다 같이 본 뒤 살지 말지 정할 종목이 이곳에 모입니다."
  };
  var GRADE_UP = { "서프라이즈": 1, "양호": 1, "호조": 1 }, GRADE_DN = { "부진": 1, "쇼크": 1, "미달": 1 };
  var S = { cos: {}, list: [], qy: {}, res: { items: {} }, stage: 1, q: "", sort: "mc", dir: -1, view: "all" };
  var app = document.getElementById("app");

  /* ---------- 도우미 ---------- */
  function getJSON(p) { return fetch(p, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }); }
  function getText(p) { return fetch(p, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.text(); }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(v, d) { return v == null || isNaN(v) ? "—" : (+v).toLocaleString("ko-KR", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function pctTxt(v) { if (v == null || isNaN(v)) return "—"; var a = Math.abs(v); return (v > 0 ? "+" : v < 0 ? "−" : "") + (a >= 1000 ? num(a) : a.toFixed(1)) + "%"; }
  function pct(v) { return '<span class="' + (v > 0 ? "up" : v < 0 ? "dn" : "na") + '">' + pctTxt(v) + "</span>"; }
  function mcap(v) { return v == null ? "—" : v >= 10000 ? num(v / 10000, 2) + "조" : num(v, v < 100 ? 1 : 0); }
  function md(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? m[2] + "/" + m[3] : ""; }
  function gtag(g) { return g ? '<span class="tag ' + (GRADE_UP[g] ? "gu" : GRADE_DN[g] ? "gd" : "") + '">' + esc(g) + "</span>" : ""; }
  function annDate(ann, ref) {
    var m = /^(\d{1,2})\/(\d{1,2})/.exec(ann || ""); if (!m) return null;
    return (+(ref || "").slice(0, 4) || new Date().getFullYear()) + "-" + ("0" + m[1]).slice(-2) + "-" + ("0" + m[2]).slice(-2);
  }
  function section(card, t) { var s = ((card && card.sections) || []).filter(function (x) { return x.t.indexOf(t) === 0; })[0]; return s ? s.lines : []; }

  /* ---------- 데이터 합치기 ---------- */
  function build(s1, pipe, res) {
    var cos = {};
    (s1.rows || []).forEach(function (r) { var o = cos[r.c] = Object.assign({}, r); o.stage = 1; });
    Object.keys(pipe.companies || {}).forEach(function (c) {
      var t = pipe.companies[c], card = t.cards[String(t.stage)] || t.cards["1"] || {};
      var o = cos[c] || (cos[c] = { c: c, n: t.n, d: annDate(card.ann, card.date), stage: 1 });
      o.tn = t.n; o.stage = t.stage; o.tg = t; o.card = card;
      ["mc", "per", "rev", "op", "d1"].forEach(function (k) { if (o[k] == null && card[k] != null) o[k] = card[k]; });
      o.vr = card.vr; o.tags = card.tags; o.lens = card.lens;
      o.bm = section(card, "비즈니스 모델")[0] || "";
    });
    Object.keys(cos).forEach(function (c) { var o = cos[c]; o.res = (res.items || {})[c] || {}; o.up = o.lens ? o.lens.up : null; });
    return cos;
  }

  /* ---------- 머리·레일 ---------- */
  function counts() { var n = { 1: S.list.length, 2: 0, 3: 0, 4: 0 }; S.list.forEach(function (o) { if (o.stage >= 2) n[o.stage]++; }); return n; }
  function head() {
    var n = counts();
    return '<header class="jhd"><div class="hd"><div class="jbrand">' +
      '<div class="eyebrow">Tokyo Stock Exchange · Earnings</div>' +
      '<h1><span class="kanji">決</span>일본 실적발표 스크리너</h1>' +
      '<div class="sub">실적 발표 기업을 1→4단계로 거릅니다 &nbsp;|&nbsp; 실적 <span class="mono">' + esc(S.upd1) + "</span> · 텔레 <span class=\"mono\">" + esc(S.upd2) + "</span></div></div>" +
      '<div class="stats">' + STAGES.map(function (s) { return '<div class="stat"><b>' + n[s.n] + "</b><span>" + s.n + "단계</span></div>"; }).join("") + "</div></div></header>" +
      '<nav class="rail"><div class="rail-in">' + STAGES.map(function (s, i) {
        return (i ? '<span class="rail-sep">›</span>' : "") + '<a class="cat s' + s.n + '" href="#jp/' + s.n + '" aria-pressed="' + (S.stage === s.n) + '"><i>' + s.n + "</i>" + esc(s.lab) + '<span class="n">' + n[s.n] + "</span></a>";
      }).join("") + '<span class="rail-hint">' + esc(STAGES[S.stage - 1].hint) + "</span></div></nav>";
  }

  /* ---------- 1단계: 이름·티커 목록 ---------- */
  function stage1() {
    var q = S.q.trim().toLowerCase();
    var rows = S.list.filter(function (o) { return !q || [o.n, o.en, o.tn, o.c].join(" ").toLowerCase().indexOf(q) >= 0; });
    rows.sort(function (a, b) { return (b.d || "").localeCompare(a.d || "") || (b.mc || 0) - (a.mc || 0); });
    var byDay = {}, days = [];
    rows.forEach(function (o) { var d = o.d || "날짜 없음"; if (!byDay[d]) { byDay[d] = []; days.push(d); } byDay[d].push(o); });
    return '<div class="ctl"><div class="fld q"><label for="q">검색</label><input type="search" id="q" placeholder="회사 이름 · 티커" value="' + esc(S.q) + '"></div>' +
      '<div class="count"><b>' + rows.length + "</b>개 기업</div></div>" +
      '<p class="stage-note">' + NOTE[1] + "</p>" +
      (rows.length ? '<div class="days">' + days.map(function (d) {
        return '<section class="day"><h3>' + (d.length === 10 ? md(d) + ' <small>' + "일월화수목금토"[new Date(d).getDay()] + "</small>" : esc(d)) + '<span>' + byDay[d].length + "</span></h3>" +
          '<div class="tick">' + byDay[d].map(function (o) {
            return '<button class="tk-b' + (o.stage > 1 ? " s" + o.stage + " lv" : "") + '" data-c="' + esc(o.c) + '"><b>' + esc(o.c) + "</b>" + esc(o.n || o.en) + (o.stage > 1 ? "<i>" + o.stage + "</i>" : "") + "</button>";
          }).join("") + "</div></section>";
      }).join("") + "</div>" : '<div class="empty">조건에 맞는 기업이 없습니다.</div>');
  }

  /* ---------- 2~4단계: 표 + 분기 성장률 줄 ---------- */
  var COLS = [
    { k: "rk", t: "#", cls: "l ns" }, { k: "c", t: "코드", cls: "l" }, { k: "n", t: "종목", cls: "l" },
    { k: "d", t: "발표" }, { k: "mc", t: "시총(억엔)" }, { k: "per", t: "PER" },
    { k: "rev", t: "매출성장" }, { k: "op", t: "영업이익성장" }, { k: "d1", t: "다음 날" }, { k: "vr", t: "거래량" },
    { k: "up", t: "AI 렌즈", cls: "l" }, { k: "res", t: "리서치", cls: "l ns" }
  ];
  function sorted(rows) {
    var k = S.sort, dir = S.dir;
    return rows.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (k === "n" || k === "c" || k === "d") { x = x || ""; y = y || ""; return dir * String(x).localeCompare(String(y)); }
      if (x == null) return 1; if (y == null) return -1;
      return dir * (x - y);
    });
  }
  function votes(L) {
    if (!L) return '<span class="na">—</span>';
    var v = ""; for (var i = 0; i < 5; i++) v += '<i class="' + (i < L.up ? "u" : i < L.up + L.down ? "d" : "") + '"></i>';
    return '<span class="votes">' + v + '</span><span class="up">' + L.up + '</span><span class="na"> · </span><span class="dn">' + L.down + "</span>";
  }
  function resTag(o) {
    var st = Math.min(o.stage, 3), r = o.res[String(st)];
    if (!r) return '<span class="tag">없음</span>';
    return r.status === "완료" ? '<span class="tag ok">' + st + "단계 완료</span>" : '<span class="tag wait">' + st + "단계 " + esc(r.status) + "</span>";
  }
  function heat(v, t) {
    if (t) return '<span class="hc ' + (t === "흑전" ? "p2" : "n2") + '">' + t + "</span>";
    if (v == null) return '<span class="hc na">—</span>';
    var c = v >= 30 ? "p3" : v >= 10 ? "p2" : v > 0 ? "p1" : v > -10 ? "n1" : v > -30 ? "n2" : "n3";
    return '<span class="hc ' + c + '">' + pctTxt(v).replace("%", "") + "</span>";
  }
  function qline(c) {
    var q = S.qy[c];
    if (!q || !q.length) return '<div class="ql-empty">분기 성장률 자료 없음 — 다음 갱신 때 채웁니다</div>';
    var pad = []; for (var i = q.length; i < 10; i++) pad.push(null);
    var cells = pad.concat(q);
    function row(lab, f) { return "<span class=\"ql-l\">" + lab + "</span>" + cells.map(function (x) { return x ? f(x) : '<span class="hc na"></span>'; }).join(""); }
    return '<div class="ql">' + row("", function (x) { return '<span class="ql-p">' + esc(x.p) + "</span>"; }) +
      row("매출 성장", function (x) { return heat(x.r); }) + row("영업이익 성장", function (x) { return heat(x.o, x.ot); }) + "</div>";
  }
  function stageN(st) {
    var rows = sorted(S.list.filter(function (o) { return o.stage === st; }));
    var head = '<div class="ctl"><div class="fld"><span>정렬</span><select id="sort">' +
      COLS.filter(function (c) { return !/ns/.test(c.cls || ""); }).map(function (c) { return '<option value="' + c.k + '"' + (S.sort === c.k ? " selected" : "") + ">" + c.t + "</option>"; }).join("") +
      '</select></div><div class="fld"><span>순서</span><div class="seg" id="dir"><button data-v="-1" aria-pressed="' + (S.dir === -1) + '">큰 순</button><button data-v="1" aria-pressed="' + (S.dir === 1) + '">작은 순</button></div></div>' +
      '<div class="count"><b>' + rows.length + "</b>개 기업</div></div>" + '<p class="stage-note">' + NOTE[st] + "</p>";
    if (!rows.length) return head + '<div class="empty-stage"><b>아직 ' + st + "단계 기업이 없습니다</b>" + EMPTY[st] + "</div>";
    var th = COLS.map(function (c) {
      var ar = S.sort === c.k ? '<span class="ar">' + (S.dir < 0 ? "▼" : "▲") + "</span>" : "";
      return '<th class="' + (c.cls || "") + '" data-k="' + c.k + '">' + c.t + ar + "</th>";
    }).join("");
    var maxmc = Math.max.apply(null, rows.map(function (o) { return o.mc || 0; })) || 1;
    var body = rows.map(function (o, i) {
      var w = Math.max(6, Math.round(60 * Math.sqrt((o.mc || 0) / maxmc)));
      return '<tr class="main" data-c="' + esc(o.c) + '">' +
        '<td class="l rk">' + (i + 1) + '</td><td class="l tk">' + esc(o.c) + "</td>" +
        '<td class="l"><span class="nm">' + esc(o.n) + (o.en && o.en !== o.n ? "<small>(" + esc(o.en.replace(/,? (Co\.,? )?(Ltd|Inc|Corporation|Holdings)\.?/g, "")) + ")</small>" : "") + '</span><span class="ind">' + esc(o.bm || o.cat || "") + "</span></td>" +
        '<td class="earn">' + md(o.d) + "</td>" +
        '<td class="mc">' + mcap(o.mc) + '<i style="width:0"></i></td>'.replace('style="width:0"', 'data-w="' + w + '"') +
        "<td>" + (o.per != null ? o.per.toFixed(1) : "—") + "</td>" +
        "<td>" + pct(o.rev) + "</td><td>" + pct(o.op) + "</td><td>" + pct(o.d1) + "</td>" +
        "<td>" + (o.vr ? o.vr.toFixed(1) + "배" : "—") + "</td>" +
        '<td class="l">' + votes(o.lens) + '</td><td class="l">' + resTag(o) + "</td></tr>" +
        '<tr class="qrow" data-c="' + esc(o.c) + '"><td></td><td></td><td colspan="10">' + qline(o.c) + "</td></tr>";
    }).join("");
    return head + '<div class="tblwrap"><table class="main-t"><thead><tr>' + th + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }

  /* ---------- 상세 패널 ---------- */
  var panel = document.getElementById("panel"), pin = document.getElementById("pin"), scrim = document.getElementById("scrim");
  var CO = {};
  function openCo(c) {
    var o = S.cos[c];
    if (!o) return closePanel();
    pin.innerHTML = '<div class="loading">불러오는 중…</div>';
    panel.classList.add("on"); scrim.classList.add("on"); document.body.style.overflow = "hidden";
    (CO[c] ? Promise.resolve(CO[c]) : getJSON("data/jp/co/" + c + ".json").catch(function () { return {}; })).then(function (d) { CO[c] = d; drawPanel(o, d); panel.focus(); });
  }
  function drawPanel(o, d) {
    var rec = d.rec || {}, card = o.card || {};
    var rx = [];
    if (o.d1 != null) rx.push(['다음 날 ' + pctTxt(o.d1), o.d1]);
    if (rec.px && rec.px.d5 != null) rx.push(["5일 " + pctTxt(rec.px.d5), rec.px.d5]);
    if (o.vr) rx.push(["거래량 " + o.vr.toFixed(1) + "배", 0]);
    if (rec.cons && rec.cons.pct != null) rx.push(["컨센 대비 " + pctTxt(rec.cons.pct), rec.cons.pct]);
    if (rec.beat && rec.beat.pct != null) rx.push(["회사 예상 대비 " + pctTxt(rec.beat.pct), rec.beat.pct]);
    (o.tags || []).filter(function (t) { return t !== "실적 호조"; }).forEach(function (t) { rx.push([t, /상향/.test(t) ? 1 : /하향/.test(t) ? -1 : 0]); });
    var hist = (o.tg && o.tg.hist) || [], at = {};
    hist.forEach(function (h) { if (h.ev === "카드") at[h.stage] = h.date; });
    var track = STAGES.map(function (s) {
      var cls = s.n < o.stage ? "done" : s.n === o.stage ? "cur" : "";
      var when = s.n === 1 ? (o.d ? md(o.d) + " 발표" : "") : at[s.n] ? at[s.n].slice(5, 10).replace("-", "/") + " 진입" : "—";
      return '<div class="s' + s.n + " " + cls + '"><b>' + esc(s.lab) + "</b>" + esc(when) + "</div>";
    }).join("");
    var tabs = [["base", "기본 정보"], ["q", "분기 실적"]];
    if (o.card) tabs.push(["tg", "텔레 카드"]);
    if (o.stage >= 2) tabs.push(["r2", "2단계 리서치"]);
    if (o.stage >= 3) tabs.push(["r3", "3단계 리포트"]);
    pin.innerHTML = '<div class="ptop"><div><div class="dtk">TSE : ' + esc(o.c) + "</div>" +
      '<h2 class="dnm" id="d-title">' + esc(o.n || o.en) + (o.en && o.en !== o.n ? "<small>(" + esc(o.en) + ")</small>" : "") + "</h2>" +
      '<div class="chips">' + (o.cat ? '<span class="chip k">' + esc(o.cat) + "</span>" : "") +
      '<span class="chip st s' + o.stage + '">' + o.stage + "단계</span>" +
      (o.g ? '<span class="chip ' + (GRADE_UP[o.g] ? "gu" : GRADE_DN[o.g] ? "gd" : "") + '">' + esc(o.g) + "</span>" : "") +
      (o.d ? '<span class="chip">' + md(o.d) + " 발표" + (o.p ? " · " + esc(o.p) : "") + "</span>" : "") +
      '<a class="chip" href="https://kabutan.jp/stock/?code=' + encodeURIComponent(o.c) + '" target="_blank" rel="noopener noreferrer">카부탄 ↗</a></div>' +
      (rx.length ? '<div class="react">' + rx.map(function (r) { return '<span class="rx ' + (r[1] > 0 ? "up" : r[1] < 0 ? "dn" : "") + '">' + esc(r[0]) + "</span>"; }).join("") + "</div>" : "") +
      (d.note && d.note.headline ? '<p class="headline">' + esc(d.note.headline) + "</p>" : "") +
      '</div><button class="x" id="px" aria-label="닫기">✕</button></div>' +
      '<div class="track">' + track + "</div>" +
      '<div class="ptabs">' + tabs.map(function (t, i) { return '<button data-tab="' + t[0] + '" aria-pressed="' + (i === 0) + '">' + t[1] + "</button>"; }).join("") + "</div>" +
      '<div id="ptab"></div>';
    document.getElementById("px").onclick = function () { location.hash = "jp/" + S.stage; };
    pin.querySelectorAll("[data-tab]").forEach(function (b) {
      b.onclick = function () { pin.querySelectorAll("[data-tab]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); showTab(o, d, b.dataset.tab); };
    });
    showTab(o, d, "base");
  }
  function showTab(o, d, t) {
    var box = document.getElementById("ptab"), rec = d.rec || {};
    if (t === "base") {
      var last = d.px && d.px.length ? d.px[d.px.length - 1][1] : o.px;
      var kv = [["종가 (엔)", num(last, last < 100 ? 1 : 0)], ["시가총액 (억엔)", mcap(o.mc)], ["PER", o.per != null ? o.per.toFixed(1) + "배" : "—"],
        ["매출 성장 (전년 같은 분기)", pct(o.rev)], ["영업이익 성장 (전년 같은 분기)", pct(o.op)], ["다음 날 주가", pct(o.d1)]];
      if (rec.progress && rec.progress.pct != null) kv.push(["진척률 차 (작년 대비 %p)", pct(rec.progress.diff != null ? rec.progress.diff : o.prog)]);
      if (rec.next_guide && rec.next_guide.op_g != null) kv.push(["다음 해 영업이익 예상", pct(rec.next_guide.op_g)]);
      if (kv.length % 2) kv.push(["", ""]);
      var bm = o.bm || (d.note && d.note.about) || "";
      box.innerHTML = '<div class="kgrid">' + kv.map(function (k) { return "<div><span>" + k[0] + "</span><b>" + k[1] + "</b></div>"; }).join("") + "</div>" +
        '<div class="dsec">주가 · 1년<span class="hint">점선 = 실적 발표일</span></div>' + chart(d.px, o.d) +
        (bm ? '<div class="dsec">무엇을 하는 회사인가</div><div class="box"><p>' + esc(bm) + "</p></div>" : "") +
        (d.note && d.note.summary_md ? '<div class="dsec">실적 요약<span class="hint">VANTAGE 실적 노트</span></div><div class="box md">' + mdRender(d.note.summary_md) + "</div>" : "") +
        (o.card && section(o.card, "왜 좋았나").length ? '<div class="dsec">왜 좋았나<span class="hint">텔레 카드</span></div><div class="box">' + section(o.card, "왜 좋았나").map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") + "</div>" : "");
      bindChart(box);
      return;
    }
    if (t === "q") {
      var q = S.qy[o.c], rows = "";
      if (q && q.length) {
        rows = q.slice().reverse().map(function (x, i) {
          return '<tr class="' + (i === 0 ? "cur" : "") + '"><td class="l">' + esc(x.p) + "</td><td>" + num(x.s, 1) + "</td><td>" + heat(x.r) + "</td><td>" + num(x.op, 1) + "</td><td>" + heat(x.o, x.ot) + "</td><td>" + (x.s ? (x.op / x.s * 100).toFixed(1) + "%" : "—") + "</td></tr>";
        }).join("");
        box.innerHTML = '<div class="tblwrap"><table class="qt"><thead><tr><th class="l">분기</th><th>매출(억엔)</th><th>매출 성장</th><th>영업이익(억엔)</th><th>영업이익 성장</th><th>영업이익률</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
          '<p class="note">결산기 기준 분기(예: 27.2Q = 2027년 결산기 2분기). 성장률은 전년 같은 분기 대비. 원천: 결산단신.</p>';
      } else if (d.qs && d.qs.length) {
        var k = (d.unit === "백만엔") ? 100 : 1;
        rows = d.qs.slice().reverse().map(function (x, i) {
          return '<tr class="' + (i === 0 ? "cur" : "") + '"><td class="l">' + esc(x.label) + "</td><td>" + num(x.rev / k, 1) + "</td><td>" + heat(x.yoy && x.yoy.rev) + "</td><td>" + num(x.op / k, 1) + "</td><td>" + heat(x.yoy && x.yoy.op) + "</td><td>" + (x.opm != null ? x.opm + "%" : "—") + "</td></tr>";
        }).join("");
        box.innerHTML = '<div class="tblwrap"><table class="qt"><thead><tr><th class="l">기간</th><th>매출(억엔)</th><th>매출 성장</th><th>영업이익(억엔)</th><th>영업이익 성장</th><th>영업이익률</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
          '<p class="note">원천: VANTAGE 실적 리포트(최근 8분기).</p>';
      } else box.innerHTML = '<div class="box"><p class="na">분기 실적 자료가 아직 없습니다. 2단계로 올라가면 채워집니다.</p></div>';
      return;
    }
    if (t === "tg") {
      var c = o.card, L = c.lens;
      box.innerHTML = '<div class="box"><h4>' + esc(c.ann) + " 발표 · 텔레 " + esc(c.date) + "</h4><p>" + esc(c.val || "") + "</p></div>" +
        (L ? '<div class="box"><h4>AI 렌즈 — 3단계로 ' + L.up + " · 삭제 " + L.down + " (실제 인물 의견 아님)</h4>" + (L.rows || []).map(function (r) {
          return '<div class="lensrow"><b class="' + (r.v === "up" ? "up" : "dn") + '">' + esc(r.who) + " · " + (r.v === "up" ? "3단계로" : "삭제") + "</b><span>" + esc(r.why) + "</span></div>";
        }).join("") + "</div>" : "") +
        (c.sections || []).map(function (s) { return '<div class="box"><h4>' + esc(s.t) + "</h4>" + s.lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") + "</div>"; }).join("");
      return;
    }
    var st = t === "r2" ? 2 : 3, r = o.res[String(st)];
    if (!r || r.status !== "완료") {
      box.innerHTML = '<div class="box wait"><span class="dot"></span><div><b>' + st + "단계 리서치 " + esc((r && r.status) || "대기") + "</b><p class=\"na\">" +
        (st === 2 ? "2단계 실적 분석 리서치" : "3단계 딥 리포트") + "가 자동으로 돌아 이곳에 붙습니다." + (r && r.queued ? " 대기열 등록 " + esc(r.queued) : "") + "</p></div></div>";
      return;
    }
    box.innerHTML = '<div class="box"><p class="na">불러오는 중…</p></div>';
    getText("data/jp/" + r.file).then(function (txt) {
      box.innerHTML = '<div class="box md">' + mdRender(txt) + '</div><p class="note">' + esc(r.kind || "") + " · " + esc(r.written || "") + "</p>";
    }).catch(function () { box.innerHTML = '<div class="box">리서치 파일을 못 불러왔습니다.</div>'; });
  }
  function closePanel() { panel.classList.remove("on"); scrim.classList.remove("on"); document.body.style.overflow = ""; }
  scrim.onclick = function () { location.hash = "jp/" + S.stage; };
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && panel.classList.contains("on")) location.hash = "jp/" + S.stage; });

  /* ---------- 주가 차트(SVG) ---------- */
  function dstr(day) { var t = new Date(day * 86400000); return t.getUTCFullYear() + "-" + ("0" + (t.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + t.getUTCDate()).slice(-2); }
  function chart(px, ann) {
    if (!px || px.length < 5) return '<div class="chartbox"><p class="note" style="padding:14px">주가 자료가 없습니다.</p></div>'.replace(' style="padding:14px"', "");
    var W = 900, H = 240, L = 8, R = 56, T = 14, B = 24;
    var lo = Infinity, hi = -Infinity; px.forEach(function (p) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); });
    var pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    var x = function (i) { return L + (W - L - R) * i / (px.length - 1); }, y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var pts = px.map(function (p, i) { return x(i).toFixed(1) + "," + y(p[1]).toFixed(1); }).join(" ");
    var grid = "", lab = "";
    for (var g = 0; g <= 3; g++) { var v = lo + (hi - lo) * g / 3, yy = y(v); grid += '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/>'; lab += '<text class="ax" x="' + (W - R + 6) + '" y="' + (yy + 3) + '">' + num(v) + "</text>"; }
    var lastM = "";
    px.forEach(function (p, i) { var m = dstr(p[0]).slice(0, 7); if (m !== lastM && i > 3) { lab += '<text class="ax" x="' + x(i) + '" y="' + (H - 6) + '">' + (+m.slice(5)) + "월</text>"; } lastM = m; });
    var ev = "";
    if (ann) { var ai = px.findIndex(function (p) { return dstr(p[0]) >= ann; }); if (ai > 0) ev = '<line class="ev" x1="' + x(ai) + '" x2="' + x(ai) + '" y1="' + T + '" y2="' + (H - B) + '"/><text class="evt" x="' + (x(ai) + 4) + '" y="' + (T + 10) + '">발표</text>'; }
    var first = px[0][1], lastv = px[px.length - 1][1], chg = (lastv / first - 1) * 100;
    return '<div class="chartbox" data-px="' + esc(JSON.stringify(px.map(function (p) { return p[1]; }))) + '" data-d0="' + px[0][0] + '" data-days="' + esc(JSON.stringify(px.map(function (p) { return p[0]; }))) + '">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="1년 주가">' + grid +
      '<polygon class="ar" points="' + x(0) + "," + (H - B) + " " + pts + " " + x(px.length - 1) + "," + (H - B) + '"/>' +
      '<polyline class="ln" points="' + pts + '"/>' + ev + lab +
      '<line class="cross" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" visibility="hidden"/><circle class="dot" r="4" cx="0" cy="0" visibility="hidden"/></svg>' +
      '<div class="tip"></div><div class="chart-note">1년 ' + pct(chg) + " · " + dstr(px[0][0]) + " ~ " + dstr(px[px.length - 1][0]) + "</div></div>";
  }
  function bindChart(root) {
    var box = root.querySelector(".chartbox[data-px]"); if (!box) return;
    var vals = JSON.parse(box.dataset.px), days = JSON.parse(box.dataset.days), svg = box.querySelector("svg");
    var cross = svg.querySelector(".cross"), dot = svg.querySelector(".dot"), tip = box.querySelector(".tip");
    var W = 900, H = 240, L = 8, R = 56, T = 14, B = 24, lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    svg.addEventListener("mousemove", function (e) {
      var r = svg.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width * W;
      var i = Math.round((fx - L) / (W - L - R) * (vals.length - 1)); i = Math.max(0, Math.min(vals.length - 1, i));
      var cx = L + (W - L - R) * i / (vals.length - 1), cy = T + (H - T - B) * (1 - (vals[i] - lo) / (hi - lo));
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); dot.setAttribute("visibility", "visible");
      tip.textContent = dstr(days[i]) + "  " + num(vals[i], vals[i] < 100 ? 1 : 0) + "엔";
      var px = cx / W * r.width; tip.style.left = Math.min(r.width - 150, Math.max(4, px + 10)) + "px"; tip.classList.add("on");
    });
    svg.addEventListener("mouseleave", function () { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.classList.remove("on"); });
  }

  /* ---------- 아주 작은 마크다운 ---------- */
  function inline(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  function mdRender(src) {
    var Ls = String(src).replace(/\r/g, "").split("\n"), out = [], i = 0;
    while (i < Ls.length) {
      var l = Ls[i];
      if (!l.trim()) { i++; continue; }
      var h = /^(#{1,3})\s+(.*)$/.exec(l);
      if (h) { out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"); i++; continue; }
      if (/^---+\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
      if (/^\|/.test(l)) {
        var rows = []; while (i < Ls.length && /^\|/.test(Ls[i])) { rows.push(Ls[i]); i++; }
        var cells = function (r) { return r.replace(/^\||\|$/g, "").split("|").map(function (x) { return x.trim(); }); };
        var hd = cells(rows[0]), body = rows.slice(/^\|[\s:|-]+\|$/.test(rows[1] || "") ? 2 : 1);
        out.push('<div class="tw"><table><thead><tr>' + hd.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          body.map(function (r) { return "<tr>" + cells(r).map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>");
        continue;
      }
      if (/^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l)) {
        var ol = /^\s*\d+\./.test(l), items = [];
        while (i < Ls.length && (ol ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(Ls[i])) { items.push(Ls[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, "")); i++; }
        out.push((ol ? "<ol>" : "<ul>") + items.map(function (x) { return "<li>" + inline(x) + "</li>"; }).join("") + (ol ? "</ol>" : "</ul>"));
        continue;
      }
      var para = []; while (i < Ls.length && Ls[i].trim() && !/^(#|\||---|\s*[-*]\s|\s*\d+\.\s)/.test(Ls[i])) { para.push(Ls[i]); i++; }
      out.push("<p>" + inline(para.join(" ")) + "</p>");
    }
    return out.join("");
  }

  /* ---------- 화면 ---------- */
  function render() {
    app.innerHTML = head() + '<div class="wrap" id="view">' + (S.stage === 1 ? stage1() : stageN(S.stage)) + "</div>";
    bindView();
  }
  function rerender() { document.getElementById("view").innerHTML = S.stage === 1 ? stage1() : stageN(S.stage); bindView(); }
  function bindView() {
    app.querySelectorAll("td.mc i[data-w]").forEach(function (i) { i.style.width = i.dataset.w + "px"; });
    app.querySelectorAll("[data-c]").forEach(function (el) { el.onclick = function () { location.hash = "jp/c/" + el.dataset.c; }; });
    var q = document.getElementById("q");
    if (q) q.oninput = function () { S.q = q.value; rerender(); var n = document.getElementById("q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    var so = document.getElementById("sort");
    if (so) so.onchange = function () { S.sort = so.value; rerender(); };
    app.querySelectorAll("#dir button").forEach(function (b) { b.onclick = function () { S.dir = +b.dataset.v; rerender(); }; });
    app.querySelectorAll("th[data-k]").forEach(function (th) {
      if (/ns/.test(th.className)) return;
      th.onclick = function () { var k = th.dataset.k; if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = (k === "n" || k === "c") ? 1 : -1; } rerender(); };
    });
  }
  function soon(name) { return '<div class="soon"><h2>' + name + " 준비 중</h2><p>일본 탭과 같은 1~4단계 흐름으로 만들 예정입니다.</p></div>"; }
  function route() {
    var h = (location.hash || "#jp").slice(1).split("/"), m = h[0] || "jp";
    document.querySelectorAll(".market a").forEach(function (a) { a.classList.toggle("on", a.dataset.m === m); });
    if (m === "us" || m === "kr") { closePanel(); app.innerHTML = soon(m === "us" ? "미국" : "한국"); return; }
    if (!S.ready) return;
    if (h[1] === "c") {
      var o = S.cos[h[2]];
      if (!app.querySelector("#view")) { S.stage = o ? o.stage : 1; render(); }
      openCo(h[2]); return;
    }
    closePanel();
    var st = Math.min(4, Math.max(1, +h[1] || 1));
    if (st !== S.stage || !app.querySelector("#view")) { S.stage = st; if (st > 1 && S.sort === "mc" && !S.touched) S.sort = st === 2 ? "up" : "mc"; render(); }
  }

  window.addEventListener("hashchange", route);
  route();
  Promise.all([
    getJSON("data/jp/stage1.json"),
    getJSON("data/jp/pipeline.json").catch(function () { return { companies: {} }; }),
    getJSON("data/jp/research/index.json").catch(function () { return { items: {} }; }),
    getJSON("data/jp/qyoy.json").catch(function () { return {}; })
  ]).then(function (r) {
    S.upd1 = r[0].updated || ""; S.upd2 = r[1].updated || "—"; S.qy = r[3]; S.res = r[2];
    S.cos = build(r[0], r[1], r[2]);
    S.list = Object.keys(S.cos).map(function (c) { return S.cos[c]; });
    S.ready = true; S.stage = 0;
    route();
  }).catch(function (e) { app.innerHTML = '<div class="empty">데이터를 못 불러왔습니다. (' + esc(e.message) + ")</div>"; });
})();
