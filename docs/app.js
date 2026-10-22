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
    1: "텔레그램 1단계 카드에 올라온 회사를 이름과 티커만 모았습니다. 누르면 주가와 실적이 열립니다. 텔레그램 1단계 카드에서 [볼 후보]를 누르면 2단계로 올라갑니다.",
    2: "볼 후보로 고른 회사입니다. 둘째 줄은 최근 10개 분기의 매출액·영업이익(억엔)과 YoY(전년 같은 분기 대비 %)입니다. 분기 이름 위 '합병' = 그 분기부터 인수한 회사가 실적에 더해짐. 2단계 실적 분석 리서치가 붙습니다.",
    3: "다 같이 깊게 보고 매수 여부·비중·근거·다시 볼 조건을 정리합니다. 3단계 딥 리포트가 붙습니다.",
    4: "4단계까지 왔으면 사기 직전 좋은 종목입니다. 다 같이 보고 살지 말지 결정합니다."
  };
  var EMPTY = {
    2: "1단계 카드에서 [볼 후보]를 누르면 이곳으로 옵니다.",
    3: "2단계 카드에서 [3단계로]를 누르면 이곳으로 옮겨지고, 3단계 딥 리포트가 자동으로 붙습니다.",
    4: "3단계에서 다 같이 본 뒤 살지 말지 정할 종목이 이곳에 모입니다."
  };
  var GRADE_UP = { "서프라이즈": 1, "양호": 1, "호조": 1 }, GRADE_DN = { "부진": 1, "쇼크": 1, "미달": 1 };
  var S = { cos: {}, list: [], qy: {}, fs: {}, bm: {}, mo: {}, res: { items: {} }, stage: 1, q: "", sort: "mc", dir: -1, view: "all" };
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
    /* 1단계 = 텔레그램 '1단계 · 알림'에 올라온 회사만(2026-10-22 사용자). VANTAGE 실적 자료는 그 회사의 숫자를 채우는 데만 쓴다 */
    var vt = {}; (s1.rows || []).forEach(function (r) { vt[r.c] = r; });
    /* 발표 예정(JPX) 회사는 1단계에 넣지 않는다 — 1단계 = 실적 발표로 올라온 기업만(2026-10-22 사용자) */
    Object.keys(pipe.companies || {}).forEach(function (c) {
      var t = pipe.companies[c], card = t.cards[String(t.stage)] || t.cards["1"] || {};
      var o = cos[c] || (cos[c] = Object.assign({}, vt[c] || {}, { c: c, n: t.n, d: (vt[c] && vt[c].d) || annDate(card.ann, card.date), stage: 1 }));
      o.tn = t.n; o.stage = t.stage; o.tg = t; o.gone = t.gone || null; o.card = card; o.pre = false;
      o.by = card.by || null;
      ["mc", "per", "rev", "op", "d1"].forEach(function (k) { if (o[k] == null && card[k] != null) o[k] = card[k]; });
      o.vr = card.vr; o.tags = card.tags; o.lens = card.lens;
      o.bm = section(card, "비즈니스 모델")[0] || "";
    });
    Object.keys(cos).forEach(function (c) { var o = cos[c]; o.res = (res.items || {})[c] || {}; o.up = o.lens ? o.lens.up : null; });
    return cos;
  }

  /* ---------- 머리·레일 ---------- */
  function counts() { var n = { 1: 0, 2: 0, 3: 0, 4: 0 }; S.list.forEach(function (o) { if (!o.pre) n[1]++; if (o.stage >= 2) n[stOf(o)]++; }); return n; }
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

  /* ---------- 1단계: 주간 실적 캘린더(월~금, 주 단위로 넘기기) ---------- */
  var WD = "일월화수목금토", SHOW = 12;
  function ymd(t) { return t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2); }
  function monday(d) { var t = new Date(d + "T00:00:00"); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return ymd(t); }
  function addDays(d, n) { var t = new Date(d + "T00:00:00"); t.setDate(t.getDate() + n); return ymd(t); }
  function dot(d) { return (+d.slice(5, 7)) + "." + d.slice(8, 10); }
  function weekName(mon) { var th = new Date(addDays(mon, 3) + "T00:00:00"); return (th.getMonth() + 1) + "월 " + Math.ceil(th.getDate() / 7) + "주차"; }
  function stage1() {
    var q = S.q.trim().toLowerCase(), today = ymd(new Date());
    var rows = S.list.filter(function (o) { return o.d && (!q || [o.n, o.en, o.tn, o.c].join(" ").toLowerCase().indexOf(q) >= 0); });
    var weeks = {};
    rows.forEach(function (o) { var w = monday(o.d); (weeks[w] = weeks[w] || []).push(o); });
    var keys = Object.keys(weeks).sort();
    if (!S.week || (!weeks[S.week] && keys.length)) {
      var cur = monday(today);
      S.week = weeks[cur] ? cur : keys.filter(function (k) { return k <= cur; }).pop() || keys[0];
    }
    var wi = keys.indexOf(S.week), mon = S.week;
    var chips = keys.map(function (k) {
      return '<button data-week="' + k + '" aria-pressed="' + (k === mon) + '"' + (k === monday(today) ? ' class="now"' : "") + "><b>" + weekName(k) + "</b><span>" + dot(k) + "~" + dot(addDays(k, 4)) + " · " + weeks[k].length + "</span></button>";
    }).join("");
    var cols = [0, 1, 2, 3, 4].map(function (i) {
      var d = addDays(mon, i), list = (weeks[mon] || []).filter(function (o) { return o.d === d; });
      list.sort(function (a, b) { return (b.stage - a.stage) || (b.mc || 0) - (a.mc || 0); });
      var open = S.openDay === d, shown = open ? list : list.slice(0, SHOW);
      return '<section class="cal-col' + (d === today ? " today" : d < today ? " past" : "") + '"><header><b>' + dot(d) + "(" + WD[new Date(d + "T00:00:00").getDay()] + ")</b><span>" + list.length + "개</span></header>" +
        (list.length ? '<ul class="cal-list">' + shown.map(function (o) {
          return '<li><button data-c="' + esc(o.c) + '" class="' + (o.stage > 1 ? "s" + o.stage + " lv" : "") + '" title="' + esc((o.n || "") + (o.en && o.en !== o.n ? " (" + o.en + ")" : "")) + '">' +
            '<b class="tkr">' + esc(o.c) + '</b><span class="cnm">' + esc(o.n || o.en) + "</span>" +
            (o.stage > 1 ? '<i class="stg">' + o.stage + "단계</i>" : o.pre && o.est ? '<i class="pre">예상</i>' : "") + "</button></li>";
        }).join("") + "</ul>" : '<p class="cal-empty">발표 없음</p>') +
        (list.length > SHOW ? '<button class="more" data-day="' + d + '">' + (open ? "접기" : "+" + (list.length - SHOW) + "개 더 보기") + "</button>" : "") + "</section>";
    }).join("");
    return '<div class="ctl"><div class="fld q"><label for="q">검색</label><input type="search" id="q" placeholder="회사 이름 · 티커" value="' + esc(S.q) + '"></div>' +
      '<div class="count"><b>' + counts()[1] + "</b>개 기업 발표 · 예정 <b>" + S.list.filter(function (o) { return o.pre; }).length + "</b>개</div></div>" +
      '<p class="stage-note">' + NOTE[1] + "</p>" +
      '<div class="cal"><div class="weeks" id="weeks">' + chips + "</div>" +
      '<div class="wnav"><button data-step="-1"' + (wi <= 0 ? " disabled" : "") + '>‹ 이전 주</button><b>' + weekName(mon) + "</b><span>" + dot(mon) + " ~ " + dot(addDays(mon, 4)) + " · " + ((weeks[mon] || []).length) + '개</span><button data-step="0">이번 주</button><button data-step="1"' + (wi >= keys.length - 1 ? " disabled" : "") + ">다음 주 ›</button></div>" +
      '<div class="cal-grid">' + cols + "</div>" +
      '<p class="note">텔레그램 「1단계 · 알림」에 올라온 회사만 나옵니다. 15분마다 확인해서 새 카드가 오면 발표일 칸에 추가됩니다.</p></div>';
  }

  /* ---------- 2~4단계: 표 + 분기 성장률 줄 ---------- */
  var COLS = [
    { k: "rk", t: "#", cls: "l ns" }, { k: "c", t: "코드", cls: "l" }, { k: "n", t: "종목", cls: "l" },
    { k: "d", t: "발표" }, { k: "mc", t: "시총(억엔)" }, { k: "per", t: "PER" },
    { k: "rev", t: "매출 YoY" }, { k: "op", t: "영업이익 YoY" }, { k: "d1", t: "다음 날" }, { k: "vr", t: "거래량" },
    { k: "by", t: "올린 사람", cls: "l" }, { k: "res", t: "리서치", cls: "l ns" }
  ];
  function sorted(rows) {
    var k = S.sort, dir = S.dir;
    return rows.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (k === "n" || k === "c" || k === "d" || k === "by") { x = x || ""; y = y || ""; return dir * String(x).localeCompare(String(y)); }
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
  /* 성장률 칸 — 바탕만 파스텔, 글자는 진하게. 합병 분기는 숫자 그대로 + '합병' 표시 */
  function heat(v, t, m) {
    var mg = "", tip = "";
    if (t) return '<span class="hc ' + (t === "흑전" ? "p2" : "n2") + '"' + tip + ">" + t + mg + "</span>";
    if (v == null) return '<span class="hc na">—</span>';
    var c = v >= 30 ? "p3" : v >= 10 ? "p2" : v > 0 ? "p1" : v > -10 ? "n1" : v > -30 ? "n2" : "n3";
    return '<span class="hc ' + c + '"' + tip + ">" + pctTxt(v).replace("%", "") + mg + "</span>";
  }
  function amt(v) { return '<span class="hc v">' + (v == null ? "—" : num(v, Math.abs(v) < 100 ? 1 : 0)) + "</span>"; }
  function qline(c) {
    var q = S.qy[c];
    if (!q || !q.length) return '<div class="ql-empty">분기 성장률 자료 없음 — 다음 갱신 때 채웁니다</div>';
    var pad = []; for (var i = q.length; i < 10; i++) pad.push(null);
    var cells = pad.concat(q);
    function row(lab, f) { return "<span class=\"ql-l\">" + lab + "</span>" + cells.map(function (x) { return x ? f(x) : '<span class="hc na"></span>'; }).join(""); }
    return '<div class="qbox"><div class="qcap">최근 10개 분기 · 억엔</div><div class="ql">' + row("", function (x) { return '<span class="ql-p">' + (x.m ? '<i class="mgh" title="' + esc(x.m) + '">합병</i>' : "") + esc(x.p) + "</span>"; }) +
      row("매출액", function (x) { return amt(x.s); }) + row("YoY", function (x) { return heat(x.r, null, x.m); }) +
      row("영업이익", function (x) { return amt(x.op); }) + row("YoY", function (x) { return heat(x.o, x.ot, x.m); }) + "</div></div>" +
      (q.some(function (x) { return x.m; }) ? '<div class="ql-m">합병 = ' + esc(q.filter(function (x) { return x.m; }).map(function (x) { return x.m; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(" · ")) + " — 그 분기부터 인수한 회사가 실적에 더해짐</div>" : "");
  }
  /* 오늘 날짜 — 한국 시각, 하루는 오전 6시에 바뀜(2026-10-22 사용자) */
  function todayKo() {
    var t = new Date(Date.now() + 9 * 3600000 - 6 * 3600000);
    return (t.getUTCMonth() + 1) + "월 " + t.getUTCDate() + "일 (" + "일월화수목금토"[t.getUTCDay()] + ")";
  }
  function cl(t) { return '<span class="cl">' + t + "</span>"; }
  /* 내 표시(이 브라우저에만 저장, 텔레와 무관 — 2026-10-22 사용자): 하나만 켜짐
     3단계로 = 2단계 회사를 3단계 탭으로 · 보류 = 표 아래 보라 칸 · 별로임 = 맨 아래 노란 칸 */
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch (e) { return {}; } }
  var MEH = load("es-meh"), GOOD = load("es-good"), HOLD = load("es-hold"), OPEN = load("es-open"), HNOTE = load("es-hold-note");
  function stOf(o) { return o.stage === 2 && GOOD[o.c] ? 3 : o.stage; }
  function pick(kind, c, on, lab, onLab, tip) {
    return '<button type="button" class="' + kind + (on ? " on" : "") + '" data-pick="' + kind + '" data-pc="' + esc(c) + '" aria-pressed="' + on + '" title="' + (on ? "누르면 표시를 풉니다" : tip) + '">' + (on ? onLab : lab) + "</button>";
  }
  function mehBtn(c) {
    var o = S.cos[c] || {};
    return '<span class="picks">' +
      (o.stage === 2 ? pick("good", c, !!GOOD[c], "3단계로", "3단계 ✓", "누르면 3단계 탭으로 올립니다") : "") +
      pick("hold", c, !!HOLD[c], "보류", "보류 ✓", "누르면 표 아래 보류 칸으로 옮깁니다") + (HOLD[c] ? noteBtn(c) : "") +
      pick("meh", c, !!MEH[c], "별로임", "별로임 ✓", "누르면 표 맨 아래로 내립니다") + "</span>";
  }
  /* 보류 이유 — 보류 옆 말풍선. 마우스를 올리면 이유가 뜨고, 누르면 적는 칸이 열린다 */
  var BUBBLE = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3.5V14H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>';
  function noteBtn(c) {
    var t = HNOTE[c] || "";
    return '<button type="button" class="hnote' + (t ? " has" : "") + '" data-hnote="' + esc(c) + '" aria-label="보류 이유' + (t ? ": " + esc(t) : " 적기") + '">' + BUBBLE +
      '<span class="hnote-tip" role="tooltip">' + (t ? esc(t) : "보류 이유 적기") + "</span></button>";
  }
  function closeNote() { var x = document.getElementById("hpop"); if (x) x.remove(); }
  function openNote(btn, after) {
    closeNote();
    var c = btn.dataset.hnote, o = S.cos[c] || {}, r = btn.getBoundingClientRect();
    var pop = document.createElement("div");
    pop.id = "hpop"; pop.className = "hpop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "보류 이유");
    pop.innerHTML = "<b>" + esc(o.n || c) + " · 보류 이유</b>" + '<textarea maxlength="300" rows="3" placeholder="예: 3분기 실적 보고 다시 · 재고 증가 확인 필요"></textarea>' +
      '<div class="hpop-b"><button type="button" data-a="del">지우기</button><button type="button" data-a="x">닫기</button><button type="button" class="ok" data-a="ok">저장</button></div>';
    document.body.appendChild(pop);
    var ta = pop.querySelector("textarea"); ta.value = HNOTE[c] || "";
    var w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + "px";
    pop.style.top = (r.bottom + h + 8 < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + "px";
    function done(v) {
      if (v != null) { v = v.trim(); if (v) HNOTE[c] = v; else delete HNOTE[c]; save(); }
      closeNote(); if (v != null) after();
    }
    pop.onclick = function (e) { e.stopPropagation(); var a = e.target.dataset.a; if (a === "ok") done(ta.value); else if (a === "del") done(""); else if (a === "x") done(null); };
    pop.onkeydown = function (e) { if (e.key === "Escape") { e.stopPropagation(); done(null); } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) done(ta.value); };
    ta.focus();
  }
  document.addEventListener("click", function (e) { var x = document.getElementById("hpop"); if (x && !x.contains(e.target) && !e.target.closest("[data-hnote]")) closeNote(); });
  function save() {
    try { [["es-meh", MEH], ["es-good", GOOD], ["es-hold", HOLD], ["es-open", OPEN], ["es-hold-note", HNOTE]].forEach(function (x) { localStorage.setItem(x[0], JSON.stringify(x[1])); }); } catch (e) {}
  }
  function togglePick(kind, c) {
    var m = { meh: MEH, good: GOOD, hold: HOLD }[kind], was = !!m[c];
    delete MEH[c]; delete GOOD[c]; delete HOLD[c];
    if (!was) m[c] = 1;
    save();
  }
  function stageN(st) {
    var q = S.q.trim().toLowerCase();
    var rows = sorted(S.list.filter(function (o) { return stOf(o) === st && (!q || [o.n, o.en, o.tn, o.c].join(" ").toLowerCase().indexOf(q) >= 0); }));
    var mehRows = rows.filter(function (o) { return MEH[o.c]; }), holdRows = rows.filter(function (o) { return HOLD[o.c]; });
    rows = rows.filter(function (o) { return !MEH[o.c] && !HOLD[o.c]; });
    var nMeh = mehRows.length, nHold = holdRows.length;
    var head = '<div class="ctl"><div class="fld"><span>정렬</span><select id="sort">' +
      COLS.filter(function (c) { return !/ns/.test(c.cls || ""); }).map(function (c) { return '<option value="' + c.k + '"' + (S.sort === c.k ? " selected" : "") + ">" + c.t + "</option>"; }).join("") +
      '</select><span class="today">' + todayKo() + '</span></div><div class="fld"><span>순서</span><div class="seg" id="dir"><button data-v="-1" aria-pressed="' + (S.dir === -1) + '">큰 순</button><button data-v="1" aria-pressed="' + (S.dir === 1) + '">작은 순</button></div></div>' +
      '<div class="fld q"><label for="q">검색</label><input type="search" id="q" placeholder="회사 이름 · 티커" value="' + esc(S.q) + '"></div>' +
      '<div class="count"><b>' + (rows.length + nHold + nMeh) + "</b>개 기업" + (nHold ? ' <span class="hold-n">보류 ' + nHold + "곳</span>" : "") + (nMeh ? ' <span class="meh-n">별로임 ' + nMeh + "곳</span>" : "") + "</div></div>" + '<p class="stage-note">' + NOTE[st] + "</p>";
    if (!rows.length && !nMeh && !nHold) return head + (q ? '<div class="empty">검색과 맞는 기업이 없습니다.</div>' : '<div class="empty-stage"><b>아직 ' + st + "단계 기업이 없습니다</b>" + EMPTY[st] + "</div>");
    var th = COLS.map(function (c) {
      var ar = S.sort === c.k ? '<span class="ar">' + (S.dir < 0 ? "▼" : "▲") + "</span>" : "";
      return '<th class="' + (c.cls || "") + '" data-k="' + c.k + '">' + c.t + ar + "</th>";
    }).join("");
    var maxmc = Math.max.apply(null, rows.concat(mehRows, holdRows).map(function (o) { return o.mc || 0; })) || 1;
    function row(o, i, slim) {
      var w = Math.max(6, Math.round(60 * Math.sqrt((o.mc || 0) / maxmc)));
      return '<tr class="main' + (MEH[o.c] ? " is-meh" : HOLD[o.c] ? " is-hold" : "") + '" data-c="' + esc(o.c) + '">' +
        '<td class="l rk">' + (i + 1) + '</td><td class="l tk"><span class="tkc">' + esc(o.c) + "</span>" + (o.d ? '<span class="ann">' + md(o.d) + "(" + "일월화수목금토"[new Date(o.d + "T00:00:00").getDay()] + ") 발표</span>" : "") + mehBtn(o.c) + "</td>" +
        '<td class="l"><span class="nmrow"><span class="nm">' + esc(o.n) + (o.en && o.en !== o.n ? "<small>(" + esc(o.en.replace(/,? (Co\.,? )?(Ltd|Inc|Corporation|Holdings)\.?/g, "")) + ")</small>" : "") + "</span>" + (o.gone ? '<span class="gone" title="텔레그램에서 카드가 지워졌지만 사이트에는 남겨 둡니다(' + esc(o.gone) + ')">텔레에서 내려감</span>' : "") + "</span>" + (HOLD[o.c] && HNOTE[o.c] ? '<span class="hnote-t">보류 이유 · ' + esc(HNOTE[o.c]) + "</span>" : "") + '<span class="ind">' + esc(o.bm || o.cat || "") + "</span></td>" +
        '<td class="mc">' + cl("시총(억엔)") + mcap(o.mc) + "</td>" +
        "<td>" + cl("PER") + (o.per != null ? o.per.toFixed(1) : "—") + "</td>" +
        "<td>" + cl("매출 YoY") + pct(o.rev) + "</td><td>" + cl("영업이익 YoY") + pct(o.op) + "</td><td>" + cl("다음 날") + pct(o.d1) + "</td>" +
        "<td>" + cl("거래량") + (o.vr ? o.vr.toFixed(1) + "배" : "—") + "</td>" +
        '<td class="l by">' + cl("올린 사람") + (o.by ? esc(o.by) : '<span class="na" title="봇이 [볼 후보]를 누른 사람을 아직 기록하지 않습니다">—</span>') + '</td><td class="l">' + cl("리서치") + resTag(o) + "</td></tr>" +
        (slim ? "" : '<tr class="qrow" data-c="' + esc(o.c) + '"><td></td><td></td><td colspan="9">' + qline(o.c) + "</td></tr>");
    }
    var body = rows.map(function (o, i) { return row(o, i, false); }).join("");
    /* 보류(보라)·별로임(노랑) — 표 아래 따로. 기본은 한 줄로 줄임, 머리줄 버튼으로 펼침 */
    function sec(kind, lab, list, hint) {
      if (!list.length) return "";
      var open = !!OPEN[kind];
      return '<section class="pk-sec ' + kind + '-sec"><h3 class="pk-h ' + kind + '-h">' + lab + " <b>" + list.length + "곳</b><span>" + hint + "</span>" +
        '<button type="button" class="sec-tg" data-sec="' + kind + '" aria-expanded="' + open + '">' + (open ? "줄이기 ▲" : "펼치기 ▼") + "</button></h3>" +
        '<div class="tblwrap"><table class="main-t' + (open ? "" : " meh-t") + '"><tbody>' + list.map(function (o, i) { return row(o, i, !open); }).join("") + "</tbody></table></div></section>";
    }
    return head + (rows.length ? '<div class="tblwrap"><table class="main-t"><tbody>' + body + "</tbody></table></div>" : '<div class="empty">보류·별로임이 아닌 기업이 없습니다.</div>') +
      sec("hold", "보류", holdRows, "보라 버튼을 다시 누르면 위로 올라갑니다") + sec("meh", "별로임", mehRows, "노란 버튼을 다시 누르면 위로 올라갑니다");
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
    var head0 = '<div class="ptop"><div><div class="dtk">TSE : ' + esc(o.c) + "</div>" +
      '<h2 class="dnm" id="d-title">' + esc(o.n || o.en) + (o.en && o.en !== o.n ? "<small>(" + esc(o.en) + ")</small>" : "") + mehBtn(o.c) + "</h2>" +
      '<div class="chips">' + (o.cat ? '<span class="chip k">' + esc(o.cat) + "</span>" : "") +
      '<span class="chip st s' + o.stage + '">' + o.stage + "단계</span>" + (o.gone ? '<span class="gone" title="텔레그램에서 카드가 지워졌지만 사이트에는 남겨 둡니다(' + esc(o.gone) + ')">텔레에서 내려감</span>' : "") +
      (o.g ? '<span class="chip ' + (GRADE_UP[o.g] ? "gu" : GRADE_DN[o.g] ? "gd" : "") + '">' + esc(o.g) + "</span>" : "") +
      (o.d ? '<span class="chip">' + md(o.d) + (o.pre ? " 발표 " + (o.est ? "예상" : "예정") : " 발표") + (o.p || o.q ? " · " + esc(o.p || o.q) : "") + "</span>" : "") +
      (o.by ? '<span class="chip">올린 사람 · ' + esc(o.by) + "</span>" : "") +
      (o.card && o.card.memo ? '<span class="chip k">메모 · ' + esc(o.card.memo) + "</span>" : "") +
      '<a class="chip" href="https://kabutan.jp/stock/?code=' + encodeURIComponent(o.c) + '" target="_blank" rel="noopener noreferrer">카부탄 ↗</a></div>' +
      (rx.length ? '<div class="react">' + rx.map(function (r) { return '<span class="rx ' + (r[1] > 0 ? "up" : r[1] < 0 ? "dn" : "") + '">' + esc(r[0]) + "</span>"; }).join("") + "</div>" : "") +
      (d.note && d.note.headline ? '<p class="headline">' + esc(d.note.headline) + "</p>" : "") +
      '</div><button class="x" id="px" aria-label="닫기">✕</button></div>' +
      '<div class="track">' + track + "</div>";
    var rec = d.rec, last = d.px && d.px.length ? d.px[d.px.length - 1][1] : o.px;
    var kv = [["종가", num(last, last < 100 ? 1 : 0) + "엔"], ["시가총액", mcap(o.mc) + "억엔"], ["PER", o.per != null ? o.per.toFixed(1) + "배" : "—"],
      ["다음 날 주가", pct(o.d1)], ["매출 YoY", pct(o.rev)], ["영업이익 YoY", pct(o.op)]];
    if (rec && rec.progress && rec.progress.pct != null) kv.push(["진척률 차(%p)", pct(rec.progress.diff != null ? rec.progress.diff : o.prog)]);
    if (rec && rec.next_guide && rec.next_guide.op_g != null) kv.push(["다음 해 영업이익 예상", pct(rec.next_guide.op_g)]);
    if (o.vr) kv.push(["거래량(평소 대비)", o.vr.toFixed(1) + "배"]);
    var bm = S.bm[o.c], sum = (bm && bm.sum) || (d.note && d.note.about) || o.bm || "";
    var fr = fsRows(o, d);
    pin.innerHTML = head0 +
      (sum ? '<div class="dsec">기업 개요</div><div class="box"><p>' + esc(sum) + "</p></div>" : "") +
      (o.stage >= 2 || o.res["2"] ? '<div class="dsec">2단계 리서치</div><div id="r2"></div>' : "") +
      (o.stage >= 3 || o.res["3"] ? '<div class="dsec">3단계 리포트</div><div id="r3"></div>' : "") +
      '<div class="dsec">분기 재무제표<span class="hint">억엔 · 칸 색 = YoY · 오른쪽이 최근</span></div>' + fsGrid(o, d) +
      (fr.length > 1 ? '<div class="charts">' + barLine(fr, 0, "매출액") + barLine(fr, 1, "영업이익") + "</div>" : "") +
      (S.mo[o.c] ? '<details class="mo" id="mo"><summary><b>월차</b><span id="mo-sum">' + esc(S.mo[o.c]) + ' 까지 · 눌러서 펼치기</span></summary><div id="mo-body" class="mo-body"><p class="na">불러오는 중…</p></div></details>' : "") +
      '<div class="dsec">기본 정보</div><div class="kmini">' + kv.map(function (k) { return "<div><span>" + k[0] + "</span><b>" + k[1] + "</b></div>"; }).join("") + "</div>" +
      bmBlock(bm) +
      '<div class="dsec">주가 · 1년<span class="hint">점선 = 실적 발표일</span></div>' + chart(d.px, o.pre ? null : o.d);
    document.getElementById("px").onclick = function () { location.hash = "jp/" + S.stage; };
    pin.querySelectorAll("[data-hnote]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); openNote(b, function () { drawPanel(o, d); if (app.querySelector("#view")) render(); }); }; });
    pin.querySelectorAll("[data-pick]").forEach(function (b) {
      b.onclick = function () { togglePick(b.dataset.pick, b.dataset.pc); drawPanel(o, d); if (app.querySelector("#view")) render(); };
    });
    pin.querySelectorAll(".bm-bar i[data-w]").forEach(function (i) { i.style.width = i.dataset.w + "%"; });
    bindChart(pin);
    var fw = pin.querySelector(".fswrap"); if (fw) fw.scrollLeft = fw.scrollWidth;
    [2, 3].forEach(function (st) { if (o.stage >= st || o.res[String(st)]) research(o, st, document.getElementById("r" + st)); });
    if (S.mo[o.c]) monthly(o.c);
  }
  /* 월차 — 접어 두고, 펼치면 최근 13개월 표(전년 대비 칸은 100 기준 색) */
  function monthly(c) {
    getJSON("data/jp/monthly/" + c + ".json").then(function (m) {
      var rows = m.rows.slice(-13), sum = document.getElementById("mo-sum"), body = document.getElementById("mo-body");
      if (!body) return;
      var last = rows[rows.length - 1], k = m.ratio.indexOf(true);
      if (k >= 0 && last[k + 1] != null) sum.textContent = last[0].replace("-", "년 ") + "월 " + m.cols[k] + " " + last[k + 1] + "% · 눌러서 펼치기";
      var head = '<tr><th class="l"></th>' + rows.map(function (r) { return "<th>" + esc(r[0].slice(2).replace("-", ".")) + "</th>"; }).join("") + "</tr>";
      var body2 = m.cols.map(function (col, i) {
        return '<tr><th class="l">' + esc(col) + "</th>" + rows.map(function (r) {
          var v = r[i + 1];
          if (v == null) return '<td class="na">—</td>';
          return m.ratio[i] ? '<td class="mo-c ' + tone(v - 100) + '">' + v.toFixed(1) + "</td>" : "<td>" + num(v, v % 1 ? 1 : 0) + "</td>";
        }).join("") + "</tr>";
      }).join("");
      body.innerHTML = '<div class="mo-wrap"><table class="mo-t"><thead>' + head + "</thead><tbody>" + body2 + "</tbody></table></div>" +
        '<p class="note">전년 대비는 전년 같은 달 = 100. 칸 색: 100보다 크면 빨강, 작으면 파랑.' + (m.note ? " " + esc(m.note) + "." : "") +
        (m.src && /^https:\/\//.test(m.src) ? ' <a href="' + esc(m.src) + '" target="_blank" rel="noopener noreferrer">원문 ↗</a>' : "") + "</p>";
      var w = body.querySelector(".mo-wrap"); document.getElementById("mo").addEventListener("toggle", function () { w.scrollLeft = w.scrollWidth; });
    }).catch(function () { var b = document.getElementById("mo-body"); if (b) b.innerHTML = '<p class="na">월차를 못 불러왔습니다.</p>'; });
  }
  /* BM — 사업부문별 매출 비중 + 2~3줄 설명 */
  function bmBlock(bm) {
    if (!bm || !bm.seg || !bm.seg.length) return "";
    var mx = Math.max.apply(null, bm.seg.map(function (s) { return s.p || 0; })) || 1;
    return '<div class="dsec">BM · 사업부문<span class="hint">매출 비중 · ' + esc(bm.asof || "") + "</span></div>" +
      '<div class="bm">' + bm.seg.map(function (s) {
        return '<div class="bm-r"><div class="bm-h"><b>' + esc(s.n) + '</b><span class="bm-p">' + (s.p != null ? s.p.toFixed(1) + "%" : "—") +
          '</span></div><div class="bm-bar"><i data-w="' + (s.p != null ? (s.p / mx * 100).toFixed(1) : 0) + '"></i></div><p>' + esc(s.d || "") + "</p></div>";
      }).join("") + "</div>";
  }
  /* 막대(금액) + 꺾은선(YoY) — 최근 10개 분기 */
  function barLine(rows, k, title) {
    var r = rows.slice(-10), W = 440, H = 190, L = 34, R = 38, T = 22, B = 26, n = r.length;
    var vals = r.map(function (x) { return x.v[k]; }), ys = r.map(function (x) { return x.yoy[k]; });
    var vmax = Math.max.apply(null, vals.map(function (v) { return Math.max(0, v || 0); })), vmin = Math.min(0, Math.min.apply(null, vals.map(function (v) { return v || 0; })));
    if (vmax === vmin) vmax = vmin + 1;
    var yv = ys.filter(function (v) { return v != null; }), ymax = Math.max.apply(null, yv.concat([10])), ymin = Math.min.apply(null, yv.concat([0]));
    var pad = (ymax - ymin) * 0.12; ymax += pad; ymin -= pad;
    var bw = (W - L - R) / n, x = function (i) { return L + bw * i + bw / 2; };
    var yb = function (v) { return T + (H - T - B) * (1 - (v - vmin) / (vmax - vmin)); };
    var yl = function (v) { return T + (H - T - B) * (1 - (v - ymin) / (ymax - ymin)); };
    var bars = r.map(function (xq, i) {
      var v = vals[i] || 0, y0 = yb(0), y1 = yb(v);
      return '<rect class="b' + (xq.m ? " m" : "") + (v < 0 ? " neg" : "") + '" x="' + (x(i) - bw * 0.32).toFixed(1) + '" y="' + Math.min(y0, y1).toFixed(1) + '" width="' + (bw * 0.64).toFixed(1) + '" height="' + Math.max(1, Math.abs(y1 - y0)).toFixed(1) + '"><title>' + esc(xq.p + " " + num(v, Math.abs(v) < 100 ? 1 : 0) + "억엔" + (xq.m ? " · 합병" : "")) + "</title></rect>" +
        '<text class="bl" x="' + x(i).toFixed(1) + '" y="' + (H - 9) + '">' + esc(xq.p) + "</text>";
    }).join("");
    var pts = [], dots = "";
    ys.forEach(function (v, i) {
      if (v == null) return;
      pts.push(x(i).toFixed(1) + "," + yl(v).toFixed(1));
      dots += '<circle class="yd" cx="' + x(i).toFixed(1) + '" cy="' + yl(v).toFixed(1) + '" r="3.6"><title>' + esc(r[i].p + " YoY " + pctTxt(v)) + "</title></circle>" +
        '<text class="yt ' + (v >= 0 ? "u" : "d") + '" x="' + x(i).toFixed(1) + '" y="' + (yl(v) - 7).toFixed(1) + '">' + (v > 0 ? "+" : v < 0 ? "−" : "") + (Math.abs(v) >= 1000 ? Math.round(Math.abs(v) / 100) / 10 + "k" : Math.round(Math.abs(v))) + "%</text>";
    });
    var z = ymin < 0 && ymax > 0 ? '<line class="z" x1="' + L + '" x2="' + (W - R) + '" y1="' + yl(0).toFixed(1) + '" y2="' + yl(0).toFixed(1) + '"/>' : "";
    return '<figure class="bl-chart"><figcaption><b>' + title + '</b><span><i class="kb"></i>금액(억엔) <i class="kl"></i>YoY(%)</span></figcaption>' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + title + ' 10개 분기">' +
      '<text class="ax" x="' + (L - 4) + '" y="' + (T - 8) + '" text-anchor="end">' + num(vmax, vmax < 100 ? 1 : 0) + "</text>" +
      '<text class="ax" x="' + (W - R + 4) + '" y="' + (T - 8) + '">' + Math.round(ymax) + "%</text>" + z + bars +
      (pts.length > 1 ? '<polyline class="yl" points="' + pts.join(" ") + '"/>' : "") + dots + "</svg></figure>";
  }
  function research(o, st, box) {
    var r = o.res[String(st)];
    if (!r || r.status !== "완료") {
      box.innerHTML = '<div class="box wait"><span class="dot"></span><div><b>' + st + "단계 리서치 " + esc((r && r.status) || "대기") + "</b><p class=\"na\">" +
        (st === 2 ? "2단계 실적 분석 리서치" : "3단계 딥 리포트") + "가 자동으로 돌아 이곳에 붙습니다." + (r && r.queued ? " 대기열 등록 " + esc(r.queued) : "") + "</p></div></div>";
      return;
    }
    var link = r.html && /^research\/[0-9A-Z]{4}\/stage[23]\.html$/.test(r.html)
      ? '<a class="art" href="' + esc(r.html) + '" target="_blank" rel="noopener">리서치 전문 열기 ↗</a>'
      : r.artifact && /^https:\/\/claude\.ai\//.test(r.artifact)
      ? '<a class="art" href="' + esc(r.artifact) + '" target="_blank" rel="noopener noreferrer">리서치 전문 보기 ↗</a>'
      : '<button class="art" data-md="' + esc(r.file) + '">리서치 전문 펼치기</button>';
    box.innerHTML = '<div class="box rsum"><div class="rs-top"><span class="tag ok">' + st + "단계 완료</span><b>" + esc(r.verdict || r.title || "") + "</b></div>" +
      '<p class="na">' + esc(r.kind || "") + " · " + esc(r.written || "") + "</p>" + link + '<div class="rs-md"></div></div>';
    var btn = box.querySelector("button.art");
    if (btn) btn.onclick = function () {
      var mdBox = box.querySelector(".rs-md");
      if (mdBox.innerHTML) { mdBox.innerHTML = ""; btn.textContent = "리서치 전문 펼치기"; return; }
      getText("data/jp/" + btn.dataset.md).then(function (txt) { mdBox.innerHTML = '<div class="md">' + mdRender(txt) + "</div>"; btn.textContent = "접기"; });
    };
  }
  /* 분기 재무제표 — 열 = 분기(오른쪽이 최근), 행 = 매출·영업이익(이익률)·순이익, 칸마다 값·전 분기 대비·전년 대비 */
  function fsRows(o, d) {
    var f = S.fs[o.c];
    if (f && f.length) return f;
    if (!d.qs || !d.qs.length) return [];
    var k = d.unit === "백만엔" ? 100 : 1;
    return d.qs.map(function (x) {
      var y = x.yoy || {}, q = x.qoq || {};
      return { p: x.cq || x.label, sub: x.label, v: [x.rev / k, x.op / k, x.ni != null ? x.ni / k : null], yoy: [y.rev, y.op, y.ni], qoq: [q.rev, q.op, q.ni] };
    });
  }
  function tone(v) {
    if (v == null || isNaN(v)) return "";
    return v >= 30 ? "p3" : v >= 10 ? "p2" : v > 0 ? "p1" : v > -10 ? "n1" : v > -30 ? "n2" : "n3";
  }
  function sg(lab, v) { return '<span class="fs-g"><i>' + lab + '</i><em class="' + (v > 0 ? "up" : v < 0 ? "dn" : "na") + '">' + (v == null ? "—" : (v > 0 ? "+" : "") + Math.round(v) + "%") + "</em></span>"; }
  function fsGrid(o, d) {
    var rows = fsRows(o, d);
    if (!rows.length) return '<div class="box"><p class="na">분기 실적 자료가 아직 없습니다. 2단계로 올라가면 채워집니다.</p></div>';
    var names = ["매출", "영업이익", "순이익"];
    var head = '<tr><th class="l"></th>' + rows.map(function (x, i) {
      return "<th>" + (x.m ? '<i class="mgh" title="' + esc(x.m) + '">합병</i>' : "") + "<b>" + esc(x.p) + "</b>" + (i === rows.length - 1 ? '<span class="fs-now">최근</span>' : x.sub ? "<small>" + esc(x.sub) + "</small>" : "") + "</th>";
    }).join("") + "</tr>";
    var body = names.map(function (nm, r) {
      return '<tr><th class="l">' + nm + "</th>" + rows.map(function (x) {
        var v = x.v[r];
        var opm = r === 1 && x.v[0] ? '<span class="fs-g"><i>OPM</i><em>' + (x.v[1] / x.v[0] * 100).toFixed(1) + "%</em></span>" : "";
        return '<td class="fs-c ' + tone(x.yoy[r]) + '"><b>' + (v == null ? "—" : num(v, Math.abs(v) < 100 ? 1 : 0)) + "</b>" + opm + sg("QoQ", x.qoq[r]) + sg("YoY", x.yoy[r]) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    var mg = rows.filter(function (x) { return x.m; }).map(function (x) { return x.m; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    return '<div class="fswrap"><table class="fs"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>" +
      '<p class="note">분기는 결산기 기준(27.2Q = 2027년 결산기 2분기). 원천: 결산단신.' + (mg.length ? " 합병 = " + esc(mg.join(" · ")) + " — 그 분기부터 인수한 회사가 실적에 더해짐." : "") + "</p>";
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
    var rl = app.querySelector(".rail"); if (rl) document.documentElement.style.setProperty("--railh", rl.offsetHeight + "px");
    app.querySelectorAll("td.mc i[data-w]").forEach(function (i) { i.style.width = i.dataset.w + "px"; });
    app.querySelectorAll("[data-c]").forEach(function (el) { el.onclick = function () { location.hash = "jp/c/" + el.dataset.c; }; });
    app.querySelectorAll("[data-pick]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); togglePick(b.dataset.pick, b.dataset.pc); render(); }; });
    app.querySelectorAll("[data-hnote]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); openNote(b, render); }; });
    app.querySelectorAll("[data-sec]").forEach(function (b) { b.onclick = function () { OPEN[b.dataset.sec] = !OPEN[b.dataset.sec]; save(); rerender(); }; });
    var q = document.getElementById("q");
    if (q) q.oninput = function () { S.q = q.value; rerender(); var n = document.getElementById("q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    var so = document.getElementById("sort");
    if (so) so.onchange = function () { S.sort = so.value; rerender(); };
    app.querySelectorAll("#dir button").forEach(function (b) { b.onclick = function () { S.dir = +b.dataset.v; rerender(); }; });
    app.querySelectorAll("[data-week]").forEach(function (b) { b.onclick = function () { S.week = b.dataset.week; S.openDay = null; rerender(); }; });
    app.querySelectorAll("[data-step]").forEach(function (b) {
      b.onclick = function () {
        var keys = [].map.call(app.querySelectorAll("[data-week]"), function (x) { return x.dataset.week; });
        var st = +b.dataset.step;
        if (st === 0) { var cur = monday(ymd(new Date())); S.week = keys.indexOf(cur) >= 0 ? cur : S.week; }
        else S.week = keys[Math.max(0, Math.min(keys.length - 1, keys.indexOf(S.week) + st))];
        S.openDay = null; rerender();
      };
    });
    app.querySelectorAll("[data-day]").forEach(function (b) { b.onclick = function () { S.openDay = S.openDay === b.dataset.day ? null : b.dataset.day; rerender(); }; });
    var wk = app.querySelector("#weeks [aria-pressed=true]");
    if (wk) wk.parentNode.scrollLeft = wk.offsetLeft - wk.parentNode.clientWidth / 2 + wk.clientWidth / 2;
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
      if (!app.querySelector("#view")) { S.stage = o ? stOf(o) : 1; render(); }
      openCo(h[2]); return;
    }
    closePanel();
    var st = Math.min(4, Math.max(1, +h[1] || 2));
    if (st !== S.stage || !app.querySelector("#view")) { S.stage = st; if (st > 1 && S.sort === "up") S.sort = "mc"; render(); }
  }

  window.addEventListener("hashchange", route);
  route();
  Promise.all([
    getJSON("data/jp/stage1.json"),
    getJSON("data/jp/pipeline.json").catch(function () { return { companies: {} }; }),
    getJSON("data/jp/research/index.json").catch(function () { return { items: {} }; }),
    getJSON("data/jp/qyoy.json").catch(function () { return {}; }),
    getJSON("data/jp/fs.json").catch(function () { return {}; }),
    getJSON("data/jp/bm.json").catch(function () { return {}; }),
    getJSON("data/jp/monthly/index.json").catch(function () { return {}; })
  ]).then(function (r) {
    S.upd1 = r[0].updated || ""; S.upd2 = r[1].updated || "—"; S.qy = r[3]; S.fs = r[4]; S.bm = r[5]; S.mo = r[6]; S.res = r[2];
    S.cos = build(r[0], r[1], r[2]);
    S.list = Object.keys(S.cos).map(function (c) { return S.cos[c]; });
    S.ready = true; S.stage = 0;
    route();
  }).catch(function (e) { app.innerHTML = '<div class="empty">데이터를 못 불러왔습니다. (' + esc(e.message) + ")</div>"; });
})();
