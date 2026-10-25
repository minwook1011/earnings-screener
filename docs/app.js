/* 실적발표스크리너 — 일본 탭.
 *  1단계: 실적 발표 기업 이름·티커만 모아 둔 목록
 *  2~4단계: VANTAGE 스크리너 같은 표 + 기업마다 둘째 줄(최근 10개 분기 매출·영업이익 성장률)
 *  어느 기업이든 누르면 오른쪽 패널(주가 1년·분기 실적·텔레 카드·리서치)
 * 데이터: data/jp/stage1.json · pipeline.json · qyoy.json · ret.json(주가 수익률) · research/index.json · co/<코드>.json
 * 주소: #jp/1 · #jp/2 · #jp/3 · #jp/4 · #jp/c/<코드> · #room/watch|res|pre · #us · #kr */
(function () {
  "use strict";
  var STAGES = [
    { n: 1, lab: "1단계 · 퀵", hint: "실적 발표 기업 전체" },
    { n: 2, lab: "2단계 · 리포트", hint: "볼 후보 — 실적 브리프" },
    { n: 3, lab: "3단계", hint: "텔레 3단계 기록" },
    { n: 4, lab: "4단계", hint: "텔레 4단계 기록" }
  ];
  var NOTE = {
    1: "텔레그램 1단계 카드에 올라온 회사를 이름과 티커만 모았습니다. 누르면 주가와 실적이 열립니다. 텔레그램 1단계 카드에서 [볼 후보]를 누르면 2단계로 올라갑니다.",
    2: "텔레 2단계에 올라온 회사마다 실적 브리프를 바로 써서 붙입니다(3·4단계로 간 회사도 여기 남음). 둘째 줄은 최근 10개 분기의 매출액·영업이익(억엔)과 YoY(전년 같은 분기 대비 %)입니다. 분기 이름 위 '합병' = 그 분기부터 인수한 회사가 실적에 더해짐.",
    3: "텔레 3단계로 간 회사 기록입니다. 리포트는 2단계 실적 브리프를 봅니다.",
    4: "텔레 4단계로 간 회사 기록입니다. 다 같이 보고 살지 말지 정합니다."
  };
  var EMPTY = {
    2: "1단계 카드에서 [볼 후보]를 누르면 이곳으로 옵니다.",
    3: "텔레 2단계 카드에서 [3단계로]를 누르면 이곳에 기록됩니다.",
    4: "텔레 4단계로 간 회사가 이곳에 기록됩니다."
  };
  var GRADE_UP = { "서프라이즈": 1, "양호": 1, "호조": 1 }, GRADE_DN = { "부진": 1, "쇼크": 1, "미달": 1 };
  var S = { cos: {}, list: [], qy: {}, fs: {}, bm: {}, mo: {}, res: { items: {} }, xl: {}, ret: { items: {} }, room: { watch: [], docs: [] }, roomTab: "watch", stage: 1, q: "", sort: "mc", dir: -1, view: "day", day: null };
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
      o.tn = t.n; o.stage = t.stage; o.tg = t; o.card = card; o.pre = false;
      o.by = card.by || null;
      ["mc", "per", "rev", "op", "d1"].forEach(function (k) { if (o[k] == null && card[k] != null) o[k] = card[k]; });
      o.vr = card.vr; o.tags = card.tags; o.lens = card.lens;
      o.bm = section(card, "비즈니스 모델")[0] || "";
    });
    Object.keys(cos).forEach(function (c) { var o = cos[c]; o.res = (res.items || {})[c] || {}; o.up = o.lens ? o.lens.up : null; });
    return cos;
  }

  /* ---------- 머리·레일 ---------- */
  function counts() { var n = { 1: 0, 2: 0, 3: 0, 4: 0 }; S.list.forEach(function (o) { if (!o.pre) n[1]++; if (o.stage >= 2) n[2]++; if (stOf(o) >= 3) n[stOf(o)]++; }); return n; }
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
      '<p class="note">텔레그램 「1단계 · 알림」에 올라온 회사만 나옵니다. 3분마다 확인해서 새 카드가 오면 발표일 칸에 추가됩니다.</p></div>';
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
    var st = 2, r = o.res["2"];
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
  /* 주가 수익률 1D~12M — 기간마다 색 기준이 다르다(짧을수록 작은 움직임도 진하게) */
  var RET = [["d1", "1D", [1, 3, 6]], ["d5", "5D", [2, 5, 10]], ["d7", "7D", [3, 7, 12]], ["m1", "1M", [4, 10, 18]], ["m3", "3M", [6, 15, 30]], ["m12", "12M", [10, 30, 60]]];
  function rline(c) {
    var r = (S.ret.items || {})[c];
    if (!r) return "";
    return '<div class="qbox rbox"><div class="qcap">주가 수익률 · ' + esc(md(r.d)) + " 종가 " + num(r.px, r.px < 100 ? 1 : 0) + "엔</div><div class=\"rl\">" +
      RET.map(function (x) { return '<span class="ql-p">' + x[1] + "</span>"; }).join("") +
      RET.map(function (x) {
        var v = r[x[0]], t = x[2];
        if (v == null) return '<span class="hc na">—</span>';
        var a = Math.abs(v), k = (v >= 0 ? "p" : "n") + (a >= t[2] ? 3 : a >= t[1] ? 2 : a >= t[0] ? 1 : 0);
        return '<span class="hc ' + k + '">' + pctTxt(v) + "</span>";
      }).join("") + "</div></div>";
  }
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
  /* 3단계로 — 그 브라우저의 3단계 탭에도 올림(텔레·리서치와 무관, 2단계 목록에는 그대로 남음). 2026-10-25 사용자: 버튼 유지 */
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch (e) { return {}; } }
  var GOOD = load("es-good");
  function stOf(o) { return o.stage === 2 && GOOD[o.c] ? 3 : o.stage; }
  function mehBtn(c) {
    var o = S.cos[c] || {}, g = !!GOOD[c];
    if (o.stage !== 2) return "";
    return '<span class="picks"><button type="button" class="good' + (g ? " on" : "") + '" data-pick="good" data-pc="' + esc(c) + '" aria-pressed="' + g + '" title="' + (g ? "누르면 3단계 탭에서 뺍니다" : "누르면 이 브라우저의 3단계 탭에도 올립니다") + '">' + (g ? "3단계 ✓" : "3단계로") + "</button></span>";
  }
  function togglePick(c) {
    if (GOOD[c]) delete GOOD[c]; else GOOD[c] = 1;
    try { localStorage.setItem("es-good", JSON.stringify(GOOD)); } catch (e) {}
  }
  /* 오늘(한국 시각, 오전 6시에 바뀜) — YYYY-MM-DD */
  function kstYmd() { var t = new Date(Date.now() + 3 * 3600000); return t.toISOString().slice(0, 10); }
  function dlab(d) { return md(d) + "(" + "일월화수목금토"[new Date(d + "T00:00:00").getDay()] + ")"; }
  /* 2단계 = 2단계 이상 전부(리포트 목록) — 날짜별(기본)·전체(발표순). 3·4단계 = 텔레 기록(2026-10-25 사용자) */
  function stageN(st) {
    var q = S.q.trim().toLowerCase();
    var rows = S.list.filter(function (o) { return (st === 2 ? o.stage >= 2 : stOf(o) === st) && (!q || [o.n, o.en, o.tn, o.c].join(" ").toLowerCase().indexOf(q) >= 0); });
    var day = st === 2 && S.view === "day" && !q, all = st === 2 && !day, nav = "";
    if (st === 2) {
      var dates = {}; S.list.forEach(function (o) { if (o.stage >= 2) dates[o.d || "-"] = (dates[o.d || "-"] || 0) + 1; });
      var keys = Object.keys(dates).filter(function (k) { return k !== "-"; }).sort();
      if (!S.day || !dates[S.day]) { var td = kstYmd(); S.day = keys.filter(function (k) { return k <= td; }).pop() || keys[keys.length - 1] || null; }
      var di = keys.indexOf(S.day);
      if (day) {
        rows = sorted(rows.filter(function (o) { return o.d === S.day; }));
        nav = '<div class="cal"><div class="weeks" id="weeks">' + keys.map(function (k) {
          return '<button data-dd="' + k + '" aria-pressed="' + (k === S.day) + '"' + (k === kstYmd() ? ' class="now"' : "") + "><b>" + dlab(k) + "</b><span>" + dates[k] + "개</span></button>";
        }).join("") + "</div>" +
          '<div class="wnav"><button data-dstep="-1"' + (di <= 0 ? " disabled" : "") + ">‹ 이전 날</button><b>" + (S.day ? dlab(S.day) + " 발표" : "발표일 없음") + "</b><span>" + rows.length + '개</span><button data-dstep="1"' + (di >= keys.length - 1 ? " disabled" : "") + ">다음 날 ›</button></div></div>";
      } else {
        rows = rows.slice().sort(function (a, b) { return S.dir * String(a.d || "0").localeCompare(String(b.d || "0")) || (b.mc || 0) - (a.mc || 0); });
      }
    } else rows = sorted(rows);
    var vsel = st === 2 ? '<div class="fld"><span>보기</span><div class="seg" id="vw"><button data-v="day" aria-pressed="' + (S.view === "day") + '">날짜별</button><button data-v="all" aria-pressed="' + (S.view === "all") + '">전체</button></div></div>' : "";
    var head = '<div class="ctl">' + vsel + (all ? "" : '<div class="fld"><span>정렬</span><select id="sort">' +
      COLS.filter(function (c) { return !/ns/.test(c.cls || ""); }).map(function (c) { return '<option value="' + c.k + '"' + (S.sort === c.k ? " selected" : "") + ">" + c.t + "</option>"; }).join("") +
      "</select></div>") + '<div class="fld"><span>순서</span><div class="seg" id="dir"><button data-v="-1" aria-pressed="' + (S.dir === -1) + '">' + (all ? "최근 발표 먼저" : "큰 순") + '</button><button data-v="1" aria-pressed="' + (S.dir === 1) + '">' + (all ? "오래된 발표 먼저" : "작은 순") + "</button></div></div>" +
      '<div class="fld q"><label for="q">검색</label><input type="search" id="q" placeholder="회사 이름 · 티커" value="' + esc(S.q) + '"></div>' +
      '<div class="count"><span class="today">' + todayKo() + "</span> · <b>" + rows.length + "</b>개 기업</div></div>" + '<p class="stage-note">' + NOTE[st] + "</p>" + nav;
    if (!rows.length) return head + (q ? '<div class="empty">검색과 맞는 기업이 없습니다.</div>' : '<div class="empty-stage"><b>아직 ' + st + "단계 기업이 없습니다</b>" + EMPTY[st] + "</div>");
    var th = COLS.map(function (c) {
      var ar = S.sort === c.k ? '<span class="ar">' + (S.dir < 0 ? "▼" : "▲") + "</span>" : "";
      return '<th class="' + (c.cls || "") + '" data-k="' + c.k + '">' + c.t + ar + "</th>";
    }).join("");
    var maxmc = Math.max.apply(null, rows.map(function (o) { return o.mc || 0; })) || 1;
    function row(o, i) {
      var w = Math.max(6, Math.round(60 * Math.sqrt((o.mc || 0) / maxmc)));
      return '<tr class="main" data-c="' + esc(o.c) + '">' +
        '<td class="l rk">' + (i + 1) + '</td><td class="l tk"><span class="tkc">' + esc(o.c) + "</span>" + (o.d ? '<span class="ann">' + md(o.d) + "(" + "일월화수목금토"[new Date(o.d + "T00:00:00").getDay()] + ") 발표</span>" : "") + (st === 2 && o.stage >= 3 ? '<span class="stgtag s' + o.stage + '">' + o.stage + "단계</span>" : "") + mehBtn(o.c) + "</td>" +
        '<td class="l"><span class="nmrow"><span class="nm">' + esc(o.n) + (o.en && o.en !== o.n ? "<small>(" + esc(o.en.replace(/,? (Co\.,? )?(Ltd|Inc|Corporation|Holdings)\.?/g, "")) + ")</small>" : "") + "</span></span>" + '<span class="ind">' + esc(o.bm || o.cat || "") + "</span></td>" +
        '<td class="mc">' + cl("시총(억엔)") + mcap(o.mc) + "</td>" +
        "<td>" + cl("PER") + (o.per != null ? o.per.toFixed(1) : "—") + "</td>" +
        "<td>" + cl("매출 YoY") + pct(o.rev) + "</td><td>" + cl("영업이익 YoY") + pct(o.op) + "</td><td>" + cl("다음 날") + pct(o.d1) + "</td>" +
        "<td>" + cl("거래량") + (o.vr ? o.vr.toFixed(1) + "배" : "—") + "</td>" +
        '<td class="l by">' + cl("올린 사람") + (o.by ? esc(o.by) : '<span class="na" title="봇이 [볼 후보]를 누른 사람을 아직 기록하지 않습니다">—</span>') + '</td><td class="l">' + cl("리서치") + resTag(o) + "</td></tr>" +
        '<tr class="qrow" data-c="' + esc(o.c) + '"><td></td><td></td><td colspan="9">' + '<div class="qwrap">' + qline(o.c) + rline(o.c) + "</div></td></tr>";
    }
    var last = null, body = rows.map(function (o, i) {
      var sep = all && o.d !== last ? '<tr class="dsep"><td colspan="11">' + (o.d ? dlab(o.d) + " 발표" : "발표일 모름") + "</td></tr>" : "";
      last = o.d; return sep + row(o, i);
    }).join("");
    return head + '<div class="tblwrap"><table class="main-t"><tbody>' + body + "</tbody></table></div>";
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
      '<span class="chip st s' + o.stage + '">' + o.stage + "단계</span>" +
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
      '<div class="dsec"><span>분기 재무제표' + (S.xl[o.c] ? ' <a class="xl" href="data/jp/xlsx/' + esc(o.c) + '.xlsx?v=' + encodeURIComponent(S.xl[o.c]) + '" download>xlsx 다운로드</a>' : '') + '</span><span class="hint">억엔 · 칸 색 = YoY · 오른쪽이 최근</span></div>' + fsGrid(o, d) +
      (fr.length > 1 ? '<div class="charts">' + barLine(fr, 0, "매출액") + barLine(fr, 1, "영업이익") + "</div>" : "") +
      (S.mo[o.c] ? '<details class="mo" id="mo"><summary><b>월차</b><span id="mo-sum">' + esc(S.mo[o.c]) + ' 까지 · 눌러서 펼치기</span></summary><div id="mo-body" class="mo-body"><p class="na">불러오는 중…</p></div></details>' : "") +
      '<div class="dsec">기본 정보</div><div class="kmini">' + kv.map(function (k) { return "<div><span>" + k[0] + "</span><b>" + k[1] + "</b></div>"; }).join("") + "</div>" +
      bmBlock(bm) +
      '<div class="dsec">주가 · 1년<span class="hint">점선 = 실적 발표일</span></div>' + chart(d.px, o.pre ? null : o.d);
    document.getElementById("px").onclick = function () { location.hash = "jp/" + S.stage; };
    pin.querySelectorAll("[data-pick]").forEach(function (b) {
      b.onclick = function () { togglePick(b.dataset.pc); drawPanel(o, d); if (app.querySelector("#view")) render(); };
    });
    pin.querySelectorAll(".bm-bar i[data-w]").forEach(function (i) { i.style.width = i.dataset.w + "%"; });
    bindChart(pin);
    var fw = pin.querySelector(".fswrap"); if (fw) fw.scrollLeft = fw.scrollWidth;
    if (o.stage >= 2 || o.res["2"]) research(o, 2, document.getElementById("r2"));
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
    app.querySelectorAll("[data-pick]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); togglePick(b.dataset.pc); render(); }; });
    app.querySelectorAll("#vw button").forEach(function (b) { b.onclick = function () { S.view = b.dataset.v; S.dir = -1; rerender(); }; });
    app.querySelectorAll("[data-dd]").forEach(function (b) { b.onclick = function () { S.day = b.dataset.dd; rerender(); }; });
    app.querySelectorAll("[data-dstep]").forEach(function (b) {
      b.onclick = function () { var k = [].map.call(app.querySelectorAll("[data-dd]"), function (x) { return x.dataset.dd; }); S.day = k[Math.max(0, Math.min(k.length - 1, k.indexOf(S.day) + +b.dataset.dstep))]; rerender(); };
    });
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
  /* ---------- 리서치룸 — 관심 기업 · 리서치 모음 · 실적 프리뷰(data/room.json, 목록은 Claude 가 tools/room.py 로 고침) ---------- */
  var ROOM_T = [{ k: "watch", lab: "관심 기업" }, { k: "res", lab: "리서치 모음" }, { k: "pre", lab: "실적 프리뷰" }];
  function nextAnn(c) {
    var u = (S.upc || {})[c], o = S.cos[c];
    return u || (o && o.d && o.d >= ymd(new Date()) ? o.d : "");
  }
  function roomDocs() {
    var out = (S.room.docs || []).map(function (d) { return Object.assign({}, d); });
    Object.keys(S.res.items || {}).forEach(function (c) {
      var r = S.res.items[c]["2"];
      if (!r || r.status !== "완료" || !r.html) return;
      out.push({ c: c, n: (S.cos[c] && (S.cos[c].tn || S.cos[c].n)) || c, kind: "2단계 리포트", date: r.written || "", title: r.title || "", sum: r.verdict || "", html: r.html });
    });
    return out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }
  function docLink(d) { return '<a class="rbtn" href="' + esc(d.html) + '" target="_blank" rel="noopener noreferrer">' + esc(d.kind) + " 열기</a>"; }
  function docRow(d, ann) {
    return '<article class="rdoc"><div class="rd-meta"><span class="tag tg">' + esc(d.kind) + '</span><span class="mono">' + esc((d.date || "").slice(0, 10)) + "</span>" +
      (ann ? '<span class="ann">' + esc(dlab(ann)) + " 발표</span>" : "") + "</div>" +
      "<h3>" + esc(d.n) + ' <span class="mono">' + esc(d.c) + "</span></h3>" +
      (d.sum ? "<p>" + esc(d.sum) + "</p>" : "") + '<div class="rd-act">' + docLink(d) +
      (S.cos[d.c] ? '<a class="rbtn ghost" href="#jp/c/' + esc(d.c) + '">재무·주가 보기</a>' : "") + "</div></article>";
  }
  function roomView() {
    var t = S.roomTab, q = (S.rq || "").trim().toLowerCase(), docs = roomDocs(), body = "";
    function hit(x) { return !q || (x.n + " " + x.c + " " + (x.memo || "") + " " + (x.title || "")).toLowerCase().indexOf(q) >= 0; }
    if (t === "watch") {
      var w = (S.room.watch || []).filter(hit);
      body = w.length ? '<table class="room-t"><tbody>' + w.map(function (x) {
        var mine = docs.filter(function (d) { return d.c === x.c; }), ann = nextAnn(x.c);
        return '<tr><td class="rn"><b>' + esc(x.n) + '</b><span class="mono">' + esc(x.c) + "</span>" + (x.cat ? '<span class="cat2">' + esc(x.cat) + "</span>" : "") + "</td>" +
          '<td class="ra">' + (ann ? '<span class="ann">' + esc(dlab(ann)) + " 발표</span>" : '<span class="na">발표일 미정</span>') + "</td>" +
          '<td class="rm">' + esc(x.memo || "") + "<small>" + esc(x.added || "") + " 추가</small></td>" +
          '<td class="rl">' + mine.map(docLink).join("") + (S.xl[x.c] ? '<a class="rbtn ghost" href="data/jp/xlsx/' + esc(x.c) + '.xlsx?v=' + encodeURIComponent(S.xl[x.c]) + '" download>xlsx</a>' : "") +
          (S.cos[x.c] ? '<a class="rbtn ghost" href="#jp/c/' + esc(x.c) + '">재무·주가</a>' : "") + (mine.length ? "" : '<span class="na">자료 없음</span>') + "</td></tr>";
      }).join("") + "</tbody></table>" : '<div class="empty-stage"><b>관심 기업이 없습니다</b>Claude 에게 "OOO 리서치룸에 추가"라고 말하면 여기에 올라갑니다.</div>';
    } else if (t === "res") {
      var kinds = ["전체"].concat(docs.map(function (d) { return d.kind; }).filter(function (k, i, a) { return a.indexOf(k) === i; }));
      var f = S.rk && kinds.indexOf(S.rk) >= 0 ? S.rk : "전체";
      var list = docs.filter(function (d) { return (f === "전체" || d.kind === f) && hit(d); });
      body = '<div class="seg rk">' + kinds.map(function (k) { return '<button data-rk="' + esc(k) + '" aria-pressed="' + (k === f) + '">' + esc(k) + "</button>"; }).join("") + "</div>" +
        (list.length ? '<div class="rdocs">' + list.map(function (d) { return docRow(d, ""); }).join("") + "</div>" : '<div class="empty-stage"><b>자료가 없습니다</b></div>');
    } else {
      var pre = docs.filter(function (d) { return d.kind === "프리뷰" && hit(d); }).map(function (d) { return { d: d, a: nextAnn(d.c) || d.ann || "" }; })
        .sort(function (a, b) { return (a.a || "9") < (b.a || "9") ? -1 : (a.a || "9") > (b.a || "9") ? 1 : 0; });
      body = pre.length ? '<div class="rdocs">' + pre.map(function (x) { return docRow(x.d, x.a); }).join("") + "</div>" :
        '<div class="empty-stage"><b>실적 프리뷰가 없습니다</b>관심 기업의 발표 전 프리뷰를 써 두면 발표일 순으로 여기에 모입니다.</div>';
    }
    var cnt = { watch: (S.room.watch || []).length, res: docs.length, pre: docs.filter(function (d) { return d.kind === "프리뷰"; }).length };
    return '<header class="jhd"><div class="hd"><div class="jbrand"><div class="eyebrow">Research Room</div><h1>리서치룸</h1>' +
      '<div class="sub">분석하고 싶은 기업, 돌린 리서치 전부, 실적 프리뷰를 모아 둡니다 &nbsp;|&nbsp; 갱신 <span class="mono">' + esc(S.room.updated || "—") + "</span></div></div>" +
      '<div class="stats">' + ROOM_T.map(function (x) { return '<div class="stat"><b>' + cnt[x.k] + "</b><span>" + x.lab + "</span></div>"; }).join("") + "</div></div></header>" +
      '<nav class="rail"><div class="rail-in">' + ROOM_T.map(function (x) {
        return '<a class="cat s2" href="#room/' + x.k + '" aria-pressed="' + (t === x.k) + '">' + esc(x.lab) + '<span class="n">' + cnt[x.k] + "</span></a>";
      }).join("") + '<input id="rq" class="rq" type="search" placeholder="이름·티커 검색" value="' + esc(S.rq || "") + '"></div></nav>' +
      '<div class="wrap" id="view">' + body + "</div>";
  }
  function renderRoom() {
    app.innerHTML = roomView();
    app.querySelectorAll("[data-rk]").forEach(function (b) { b.onclick = function () { S.rk = b.dataset.rk; renderRoom(); }; });
    var q = document.getElementById("rq");
    if (q) q.oninput = function () { S.rq = q.value; renderRoom(); var n = document.getElementById("rq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  }
  function soon(name) { return '<div class="soon"><h2>' + name + " 준비 중</h2><p>일본 탭과 같은 1~4단계 흐름으로 만들 예정입니다.</p></div>"; }
  function route() {
    var h = (location.hash || "#jp").slice(1).split("/"), m = h[0] || "jp";
    document.querySelectorAll(".market a").forEach(function (a) { a.classList.toggle("on", a.dataset.m === m); });
    if (m === "us" || m === "kr") { closePanel(); app.innerHTML = soon(m === "us" ? "미국" : "한국"); return; }
    if (!S.ready) return;
    if (m === "room") { closePanel(); S.roomTab = ["watch", "res", "pre"].indexOf(h[1]) >= 0 ? h[1] : "watch"; renderRoom(); return; }
    if (h[1] === "c") {
      var o = S.cos[h[2]];
      if (!app.querySelector("#view")) { S.stage = o ? Math.min(o.stage, 2) : 1; render(); }
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
    getJSON("data/jp/monthly/index.json").catch(function () { return {}; }),
    getJSON("data/jp/xlsx/index.json").catch(function () { return {}; }),
    getJSON("data/room.json").catch(function () { return { watch: [], docs: [] }; }),
    getJSON("data/jp/ret.json").catch(function () { return { items: {} }; })
  ]).then(function (r) {
    S.upd1 = r[0].updated || ""; S.upd2 = r[1].updated || "—"; S.qy = r[3]; S.fs = r[4]; S.bm = r[5]; S.mo = r[6]; S.res = r[2]; S.xl = r[7]; S.room = r[8]; S.ret = r[9]; S.upc = {}; (r[0].upcoming || []).forEach(function (u) { if (!u.est && !S.upc[u.c]) S.upc[u.c] = u.d; });
    S.cos = build(r[0], r[1], r[2]);
    S.list = Object.keys(S.cos).map(function (c) { return S.cos[c]; });
    S.ready = true; S.stage = 0;
    route();
  }).catch(function (e) { app.innerHTML = '<div class="empty">데이터를 못 불러왔습니다. (' + esc(e.message) + ")</div>"; });
})();
