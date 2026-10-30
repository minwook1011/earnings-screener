/* 일본 리포트 아카이빙(옛 실적발표스크리너) — 일본 탭.
 *  1단계: 실적 발표 기업 이름·티커만 모아 둔 목록
 *  2~4단계: VANTAGE 스크리너 같은 표 + 기업마다 둘째 줄(최근 10개 분기 매출·영업이익 성장률)
 *  어느 기업이든 누르면 오른쪽 패널(주가 1년·분기 실적·텔레 카드·리서치)
 * 데이터: data/jp/stage1.json · pipeline.json · qyoy.json · ret.json(주가 수익률) · ircall.json(IR 설명회) · research/index.json · co/<코드>.json
 * 주소: #jp/1 · #jp/2 · #jp/3 · #jp/4 · #jp/c/<코드> · #jps · #jps/c/<코드> · #room/watch|res|pre · #us · #kr */
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
    2: "텔레 2단계에 올라온 회사마다 실적 브리프를 바로 써서 붙입니다(3·4단계로 간 회사도 여기 남음). 둘째 줄은 최근 10개 분기의 매출액·영업이익(억엔)과 YoY(전년 같은 분기 대비 %)입니다. 분기 이름 위 노란 '인수' = 그 분기부터 인수한 회사가 실적에 더해짐.",
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
      '<h1><span class="kanji">決</span>일본 리포트 아카이빙</h1>' +
      '<div class="sub">2단계에 올라온 회사의 실적 리포트를 쌓아 둡니다 &nbsp;|&nbsp; 실적 <span class="mono">' + esc(S.upd1) + "</span> · 텔레 <span class=\"mono\">" + esc(S.upd2) + "</span></div></div>" +
      '<div class="stats"><div class="stat"><b>' + n[2] + "</b><span>리포트</span></div></div></div></header>" +
      // 2→3→4단계만, 1단계 퀵은 일단 뺌(2026-10-27 사용자: 사이트 = 일본 리포트 아카이빙)
      '<nav class="rail"><div class="rail-in">' + [1, 2, 3].map(function (i, k) { return (k ? '<span class="rail-sep">›</span>' : "") + cat(STAGES[i], n); }).join("") +
      '<span class="rail-hint">' + esc(STAGES[S.stage - 1].hint) + "</span></div></nav>";
  }
  function cat(s, n) {
    return '<a class="cat s' + s.n + '" href="#jp/' + s.n + '" aria-pressed="' + (S.stage === s.n) + '"><i>' + s.n + "</i>" + esc(s.lab) + '<span class="n">' + n[s.n] + "</span></a>";
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
  /* 성장률 칸 — 바탕만 파스텔, 글자는 진하게. 인수 분기는 숫자 그대로 + '인수' 표시 */
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
  /* 1년 주가 미니 차트(ret.json sp = 5거래일 간격 종가) — 2026-10-25 사용자: 수익률 상자 대신 3단계로 버튼 밑 빈칸에 */
  function spark(c) {
    var r = (S.ret.items || {})[c], p = r && r.sp;
    if (!p || p.length < 2) return "";
    var W = 104, H = 40, lo = Math.min.apply(null, p), hi = Math.max.apply(null, p), k = hi > lo ? hi - lo : 1;
    var pts = p.map(function (v, i) { return (i * W / (p.length - 1)).toFixed(1) + "," + (2 + (H - 4) * (1 - (v - lo) / k)).toFixed(1); }).join(" ");
    var ch = (p[p.length - 1] / p[0] - 1) * 100, cls = ch >= 0 ? "up" : "dn";
    return '<div class="spark ' + cls + '" title="최근 1년 주가(주간) · ' + esc(md(r.d)) + " 종가 " + num(r.px, r.px < 100 ? 1 : 0) + '엔"><svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-hidden="true"><polyline points="' + pts + '"/></svg>' +
      '<span class="sp-l">1년 <b>' + pctTxt(Math.round(ch * 10) / 10) + "</b></span></div>";
  }
  /* 결산설명회(IR 콜) 일정 — 3단계로 버튼 밑 빈칸(2026-10-26 사용자, ircall.json · 평일 15:30·16:30·17:30 갱신) */
  function irc(c) {
    var x = ((S.irc || {}).items || {})[c], t = x && x.t;
    if (!t) return "";
    var d = /^\d{1,2}\/\d{1,2}/.test(t), p = t.split(" · ");
    return '<div class="irc' + (d ? " on" : "") + '" title="결산설명회(IR 콜)' + (x.src && /^https?:/.test(x.src) ? " · " + esc(x.src) : "") + '"><span>IR 설명회</span><b>' +
      esc(d ? p[0] : t === "없음" ? "없음" : "날짜 미확인") + "</b>" + (d && p[1] ? "<small>" + esc(p.slice(1).join(" · ")) + "</small>" : "") + "</div>";
  }
  function qline(c) {
    var q = S.qy[c];
    if (!q || !q.length) return '<div class="ql-empty">분기 성장률 자료 없음 — 다음 갱신 때 채웁니다</div>';
    var pad = []; for (var i = q.length; i < 10; i++) pad.push(null);
    var cells = pad.concat(q);
    function row(lab, f) { return "<span class=\"ql-l\">" + lab + "</span>" + cells.map(function (x) { return x ? f(x) : '<span class="hc na"></span>'; }).join(""); }
    // 분기 머리줄 = 회색 띠(2026-10-27 사용자: 가독성)
    var head = '<span class="ql-l qh">억엔</span>' + cells.map(function (x) { return '<span class="ql-p qh">' + (x ? (x.m ? '<i class="mgh" title="' + esc(x.m) + '">인수</i>' : "") + esc(x.p) : "") + "</span>"; }).join("");
    return '<div class="qbox"><div class="qcap">최근 10개 분기</div><div class="ql">' + head +
      row("매출액", function (x) { return amt(x.s); }) + row("YoY", function (x) { return heat(x.r, null, x.m); }) +
      row("영업이익", function (x) { return amt(x.op); }) + row("YoY", function (x) { return heat(x.o, x.ot, x.m); }) + "</div></div>" +
      (q.some(function (x) { return x.m; }) ? '<div class="ql-m">인수 = ' + esc(q.filter(function (x) { return x.m; }).map(function (x) { return x.m; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(" · ")) + " — 그 분기부터 인수한 회사가 실적에 더해짐</div>" : "");
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
  function vselHtml() {
    return '<div class="fld"><span>보기</span><div class="seg" id="vw">' + [["day", "날짜별"], ["all", "전체"]].map(function (v) {
      return '<button data-v="' + v[0] + '" aria-pressed="' + (S.view === v[0]) + '">' + v[1] + "</button>";
    }).join("") + "</div></div>";
  }

  /* ---------- 2단계 스크리닝 — 100억 사이트 일본 스크리너와 같은 표(2026-10-26 사용자). 2단계 이상 전부 누적, 숫자는 data/jp/scr.json(build_scr.py) ---------- */
  var SC = [
    { k: "mc", t: "시총(억엔)", s: "시가총액" }, { k: "rev", t: "매출(억엔)", s: "매출" }, { k: "revg", t: "매출성장", s: "매출성장률 (TTM YoY)" },
    { k: "py", t: "1Y", s: "주가수익률 (1년)" }, { k: "ytd", t: "YTD", s: "주가수익률 (YTD)" }, { k: "per", t: "PER", s: "PER (낮은 순)", lo: 1 },
    { k: "roe", t: "ROE", s: "ROE" }, { k: "opm", t: "OPM", s: "영업이익률" }, { k: "d", t: "실적발표", s: "실적발표 (최근 순)" }
  ];
  var FAV = load("es-fav");
  function scv(o, k) { var x = (S.scr.items || {})[o.c] || {}; return k === "d" ? o.d || null : k === "mc" ? (x.mc != null ? x.mc : o.mc) : k === "per" ? (x.per != null ? x.per : o.per) : x[k]; }
  /* 조건 검색 — '시총 1000억 이상, 매출성장 10% 이상, 영업이익률 15% 이상 순' */
  var SM = [["mc", /시총|시가총액/], ["revg", /매출\s*성장|성장률/], ["rev", /매출|규모/], ["ytd", /ytd|연초/i], ["py", /주가|상승률|수익률|1년/], ["per", /per/i], ["roe", /roe/i], ["opm", /영업이익률|opm|이익률/i]];
  function parseSmart(t) {
    var conds = [], sort = null;
    String(t || "").split(/[,，]|그리고/).forEach(function (part) {
      var p = part.trim(); if (!p) return;
      var m = SM.filter(function (x) { return x[1].test(p); })[0]; if (!m) return;
      var n = /(-?\d+(?:\.\d+)?)\s*(조|억|%)?/.exec(p.replace(/,/g, ""));
      if (n) {
        var v = +n[1]; if (m[0] === "mc" || m[0] === "rev") v = n[2] === "조" ? v * 10000 : v;
        conds.push({ k: m[0], v: v, lo: /이하|미만|아래|낮/.test(p) });
      }
      if (/순\s*$/.test(p)) sort = m[0];
    });
    return conds.length || sort ? { conds: conds, sort: sort } : null;
  }
  function scrQ(o) {
    var q = S.qy[o.c] || [], r = S.s1rows[o.c] || {}, cur = r.fy && r.p ? r.fy.slice(2, 4) + "." + r.p : null;
    var cells = q.slice(-10);   // 빈 칸으로 채우지 않음(2026-10-26 사용자)
    function row(lab, f) { return '<span class="ql-l">' + lab + "</span>" + cells.map(f).join(""); }
    if (!q.length) return '<div class="ql-empty">분기 자료 없음 — 다음 갱신 때 채웁니다</div>';
    // 실적발표 분기 = 세로 한 줄을 노란 네모로 감쌈(2026-10-27 사용자: ✓ 대신)
    function nw(h, x, k) { return x.p === cur ? h.replace('class="hc', 'class="hc nw ' + k) : h; }
    return '<div class="qbox sq"><div class="qcap">분기 YoY · %</div><div class="ql c' + cells.length + '">' +   // CSP가 인라인 style을 막으므로 칸 수는 클래스로

      row("", function (x) { var on = x.p === cur; return '<span class="ql-p' + (on ? " now nw nw-t" : "") + '">' + (on && o.d ? '<i class="qd">' + esc(md(o.d)) + "</i>" : "") + (x.m ? '<i class="mgh" title="' + esc(x.m) + '">인수</i>' : "") + esc(x.p) + "</span>"; }) +
      row("매출액", function (x) { return nw(heat(x.r, null, x.m), x, ""); }) + row("영업이익", function (x) { return nw(heat(x.o, x.ot, x.m), x, "nw-b"); }) + "</div></div>";
  }
  /* 스크리닝 둘째 줄 왼쪽 — 별·순번·코드·종목 칸 밑을 꽉 채우는 1년 주가(2026-10-26 사용자) */
  function bigSpark(c) {
    var r = (S.ret.items || {})[c], p = r && r.sp;
    if (!p || p.length < 2) return "";
    var W = 300, H = 80, lo = Math.min.apply(null, p), hi = Math.max.apply(null, p), k = hi > lo ? hi - lo : 1;
    var xy = p.map(function (v, i) { return [(i * W / (p.length - 1)).toFixed(1), (3 + (H - 6) * (1 - (v - lo) / k)).toFixed(1)]; });
    var ch = (p[p.length - 1] / p[0] - 1) * 100;
    return '<div class="bsp ' + (ch >= 0 ? "up" : "dn") + '" title="최근 1년 주가(주간) · ' + esc(md(r.d)) + " 종가 " + num(r.px, r.px < 100 ? 1 : 0) + '엔"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<polygon points="0,' + H + " " + xy.map(function (a) { return a.join(","); }).join(" ") + " " + W + "," + H + '"/><polyline points="' + xy.map(function (a) { return a.join(","); }).join(" ") + '"/></svg>' +
      '<span class="bsp-l">1년 <b>' + pctTxt(Math.round(ch * 10) / 10) + "</b> · " + esc(md(r.d)) + " " + num(r.px, r.px < 100 ? 1 : 0) + "엔</span></div>";
  }
  /* 스크리닝 판 4개 — 표 · 신고가 · 신고가 근접 · 턴어라운드(2026-10-29 사용자). 판정은 data/jp/px/index.json(build_px.py, 매일 10:00·15:30) */
  var BOARDS = [
    { k: "tbl", t: "스크리닝 표" },
    { k: "new", t: "신고가", f: function (p) { return p && p.new; }, note: "최근 5거래일 안에 52주 신고가(고가 기준)를 새로 쓴 종목." },
    { k: "near", t: "신고가 근접", f: function (p) { return p && p.near; }, note: "52주 최고가에서 15% 이내까지 올라온 종목(신고가 종목 제외)." },
    { k: "turn", t: "턴어라운드", f: function (p) { return p && p.turn; }, note: "최근 52주 안에 이동평균 20·60·120일이 역배열이었다가 지금 정배열로 바뀐 종목. 세로 점선이 바뀐 날." },
    { k: "fav", t: "★ 즐겨찾기 목록" }
  ];
  /* 즐겨찾기 목록 — ★ 종목을 내가 만든 목록에 나눠 담고 끌어서 옮김(2026-10-29 사용자). 이 브라우저에 저장(es-favg) */
  var FG = (function () { try { var g = JSON.parse(localStorage.getItem("es-favg") || "null"); if (g && g.length) return g; } catch (e) {} return [{ id: "u", n: "미분류", c: [] }]; })();
  function saveFG() { try { localStorage.setItem("es-favg", JSON.stringify(FG)); } catch (e) {} }
  function syncFG() {   // ★ 와 맞춤: 새 ★ 는 첫 목록 끝에, ★ 뺀 종목은 지움
    var seen = {};
    FG.forEach(function (g) { g.c = g.c.filter(function (c) { if (!FAV[c] || seen[c]) return false; seen[c] = 1; return true; }); });
    Object.keys(FAV).forEach(function (c) { if (!seen[c] && S.cos[c]) FG[0].c.push(c); });
    saveFG();
  }
  function favView() {
    syncFG();
    var n = FG.reduce(function (a, g) { return a + g.c.length; }, 0);
    return boardTabs() + '<p class="stage-note">★ 를 누른 종목이 여기 모입니다. 카드를 끌어 다른 목록으로 옮기거나 순서를 바꾸고, 목록 이름은 눌러서 고칩니다. 이 브라우저에 저장됩니다.</p>' +
      (n ? "" : '<div class="empty">아직 즐겨찾기가 없습니다 — 표나 카드의 ☆ 를 누르세요.</div>') +
      '<div class="fgwrap">' + FG.map(function (g, gi) {
        return '<section class="fg" data-g="' + esc(g.id) + '"><header><input class="fg-n" data-gn="' + esc(g.id) + '" value="' + esc(g.n) + '" aria-label="목록 이름"><span class="fg-k">' + g.c.length + "</span>" +
          (gi ? '<button type="button" class="fg-del" data-gdel="' + esc(g.id) + '" title="목록 지우기(종목은 첫 목록으로)">✕</button>' : "") + "</header>" +
          '<div class="fg-list pgrid" data-drop="' + esc(g.id) + '">' + g.c.map(function (c) { return S.cos[c] ? pcard(S.cos[c]) : ""; }).join("") +
          '<div class="fg-end">여기로 끌어 놓기</div></div></section>';
      }).join("") + '<button type="button" class="fg-add" id="fgadd">+ 목록 추가</button></div>';
  }
  function bindFav() {
    var drag = null;
    app.querySelectorAll(".fg-list .pcard").forEach(function (el) {
      el.setAttribute("draggable", "true");
      el.ondragstart = function (e) { drag = el.dataset.px; el.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", drag); } catch (er) {} };
      el.ondragend = function () { el.classList.remove("dragging"); app.querySelectorAll(".drop-at").forEach(function (x) { x.classList.remove("drop-at", "after"); }); };
    });
    function spot(list, x, y) {   // 놓을 자리 = 커서에 가장 가까운 카드 앞(카드 오른쪽 절반이면 그 뒤)
      var cards = [].filter.call(list.querySelectorAll(".pcard"), function (c) { return c.dataset.px !== drag; }), best = null, bd = 1e9, after = false;
      cards.forEach(function (c) { var r = c.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = c; after = x > cx; } });
      var end = list.querySelector(".fg-end").getBoundingClientRect();
      if (best && Math.hypot(x - (end.left + end.width / 2), y - (end.top + end.height / 2)) < bd) best = null;
      return { el: best, after: after };
    }
    app.querySelectorAll(".fg-list").forEach(function (list) {
      list.ondragover = function (e) {
        if (!drag) return; e.preventDefault();
        app.querySelectorAll(".drop-at").forEach(function (x) { x.classList.remove("drop-at", "after"); });
        var s = spot(list, e.clientX, e.clientY); (s.el || list.querySelector(".fg-end")).classList.add("drop-at"); if (s.el && s.after) s.el.classList.add("after");
      };
      list.ondrop = function (e) {
        e.preventDefault(); if (!drag) return;
        var s = spot(list, e.clientX, e.clientY), g = FG.filter(function (x) { return x.id === list.dataset.drop; })[0];
        FG.forEach(function (x) { x.c = x.c.filter(function (c) { return c !== drag; }); });
        var i = s.el ? g.c.indexOf(s.el.dataset.px) + (s.after ? 1 : 0) : g.c.length;
        g.c.splice(i, 0, drag); drag = null; saveFG(); rerender();
      };
    });
    app.querySelectorAll("[data-gn]").forEach(function (inp) {
      inp.onchange = function () { var g = FG.filter(function (x) { return x.id === inp.dataset.gn; })[0]; g.n = inp.value.trim() || g.n; saveFG(); };
      inp.onkeydown = function (e) { if (e.key === "Enter") inp.blur(); };
    });
    app.querySelectorAll("[data-gdel]").forEach(function (b) {
      b.onclick = function () { var i = FG.map(function (x) { return x.id; }).indexOf(b.dataset.gdel); if (i < 1) return; FG[0].c = FG[0].c.concat(FG[i].c); FG.splice(i, 1); saveFG(); rerender(); };
    });
    var add = document.getElementById("fgadd");
    if (add) add.onclick = function () { FG.push({ id: "g" + Date.now().toString(36), n: "새 목록 " + FG.length, c: [] }); saveFG(); rerender(); var ins = app.querySelectorAll("[data-gn]"); ins[ins.length - 1].focus(); ins[ins.length - 1].select(); };
  }
  S.board = (function () { try { var b = localStorage.getItem("es-board"); return BOARDS.some(function (x) { return x.k === b; }) ? b : "tbl"; } catch (e) { return "tbl"; } })();
  function boardTabs() {
    var all = S.list.filter(inScr);
    return '<nav class="boards" id="boards">' + BOARDS.map(function (b) {
      var n = b.k === "fav" ? all.filter(function (o) { return FAV[o.c]; }).length : b.f ? all.filter(function (o) { return b.f((S.px.items || {})[o.c]); }).length : all.length;
      return '<button data-board="' + b.k + '" aria-pressed="' + (S.board === b.k) + '">' + b.t + "<span>" + n + "</span></button>";
    }).join("") + "</nav>";
  }
  /* 카드 차트 — 1년 종가(2거래일 간격). 신고가·근접 = 52주 고가 점선, 턴어라운드 = 20·60·120일선 + 바뀐 날 */
  function pchart(p, B) {
    var c = p.cl || [], W = 300, H = 200, all = c.slice();
    if (B === "turn") all = all.concat((p.m20 || []).filter(Boolean), (p.m60 || []).filter(Boolean), (p.m120 || []).filter(Boolean));
    if (B !== "turn") all.push(p.hi);
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), k = hi > lo ? hi - lo : 1;
    function X(i) { return (i * W / Math.max(1, c.length - 1)).toFixed(1); }
    function Y(v) { return (6 + (H - 12) * (1 - (v - lo) / k)).toFixed(1); }
    function line(a, cls) { var pts = []; a.forEach(function (v, i) { if (v != null) pts.push(X(i) + "," + Y(v)); }); return '<polyline class="' + cls + '" vector-effect="non-scaling-stroke" points="' + pts.join(" ") + '"/>'; }
    var up = c[c.length - 1] >= c[0], g = "";
    g += '<polygon class="pa" points="0,' + H + " " + c.map(function (v, i) { return X(i) + "," + Y(v); }).join(" ") + " " + W + "," + H + '"/>';
    if (B !== "turn") g += '<line class="phi" vector-effect="non-scaling-stroke" x1="0" x2="' + W + '" y1="' + Y(p.hi) + '" y2="' + Y(p.hi) + '"/>';
    if (B === "turn") {
      g += line(p.m120 || [], "pm120") + line(p.m60 || [], "pm60") + line(p.m20 || [], "pm20");
      if (p.tix != null) g += '<line class="ptx" vector-effect="non-scaling-stroke" x1="' + X(p.tix) + '" x2="' + X(p.tix) + '" y1="0" y2="' + H + '"/>';
    }
    g += line(c, "pl");
    return '<svg class="' + (up ? "up" : "dn") + '" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">' + g + "</svg>";
  }
  function pcard(o) {
    var p = (S.px.items || {})[o.c] || {}, x = (S.scr.items || {})[o.c] || {}, q = (S.qy[o.c] || []).slice(-1)[0] || {}, per = scv(o, "per"), B = S.board;
    var tag = B === "turn" ? "정배열 전환 " + md(p.turn) : B === "new" ? "52주 신고가 " + md(p.hid) : "고점 대비 " + pctTxt(p.off);
    return '<div class="pcard" data-px="' + esc(o.c) + '" tabindex="0" role="button"><button type="button" class="star pc-star' + (FAV[o.c] ? " on" : "") + '" data-fav="' + esc(o.c) + '" aria-pressed="' + !!FAV[o.c] + '" title="즐겨찾기">' + (FAV[o.c] ? "★" : "☆") + "</button>" +
      '<div class="pc-ch">' + pchart(p, B) + '<span class="pc-tag">' + esc(tag) + "</span></div>" +
      '<div class="pc-nm"><b>' + esc(o.n) + "</b><span>" + esc(o.c) + " · " + num(p.px, p.px < 100 ? 1 : 0) + "엔</span></div>" +
      '<div class="pc-st"><span><i>YTD</i>' + pct(x.ytd) + "</span><span" + (q.p ? ' title="최근 분기 ' + esc(q.p) + ' 매출 YoY"' : "") + "><i>매출성장" + (q.p ? "<small>" + esc(q.p) + "</small>" : "") + "</i>" + (q.r == null ? "—" : pct(q.r)) + "</span>" +
      "<span><i>PER</i>" + (per == null ? "—" : per < 0 ? '<b class="na">적자</b>' : per.toFixed(1)) + "</span></div></div>";
  }
  /* ---------- 일본 주요 전 종목 — 100억 사이트 일본 종목 전부(2026-10-29 사용자). data/jp/pxall/index.json(build_pxall.py, 10:00·15:30 · 상한가는 19:00 카부탄도) ---------- */
  var ABOARDS = [
    { k: "all", t: "전 종목", f: function () { return true; }, note: "100억 사이트 일본 종목 + 일본 소비재 전 종목. 섹터를 골라 보고, 판(신고가·근접·턴·+8%)에 걸린 종목은 누르면 5년 차트." },
    { k: "fav", t: "★ 즐겨찾기", f: function () { return true; }, note: "☆ 를 누른 종목. 일본 스크리닝 탭의 ★ 와 같은 목록이고 이 브라우저에 저장됩니다." },
    { k: "new", t: "신고가", f: function (p) { return p.new; }, note: "최근 5거래일 안에 52주 신고가(고가 기준)를 새로 쓴 종목." },
    { k: "near", t: "신고가 근접", f: function (p) { return p.near; }, note: "52주 최고가에서 15% 이내(신고가 종목 제외)." },
    { k: "turn", t: "턴어라운드", f: function (p) { return p.turn; }, note: "최근 52주 안에 20·60·120일선이 역배열이었다가 지금 정배열. 세로 점선이 바뀐 날." },
    { k: "up", t: "상한가 · +8%↑", f: function (p) { return p.up; }, note: "그날 +8% 이상 오른 종목(장중 종가 기준 + 시간외 PTS). 카부탄 상승률 순위로 확인, ‘상한가’ 표시는 카부탄 ストップ高." }
  ];
  S.aboard = (function () { try { var b = localStorage.getItem("es-aboard"); return ABOARDS.some(function (x) { return x.k === b; }) ? b : "all"; } catch (e) { return "all"; } })();
  S.aq = ""; S.amin = 0; S.asort = "mc"; S.asec = "";
  /* 섹터 — data/jp/sectors.json(tools/sector.py, 2026-10-30 사용자). 종목마다 섹터 하나, 맨 앞 '전체' = 모든 섹터 */
  function secOf(c) { return (((S.sec || {}).items || {})[c] || {}).s || ""; }
  /* 최근·다음 실적 발표일 — 최근 = 카부탄 결산 발표일(ann.json, tools/build_ann.py)과 JPX 캘린더 중 늦은 날, 다음 = JPX 캘린더(cal.json)에서 오늘 뒤 첫 날 */
  function calIdx() {
    if (S.cidx) return S.cidx;
    var m = {}, dd = (S.cal || {}).days || {};
    Object.keys(dd).forEach(function (d) { dd[d].forEach(function (o) { (m[o.c] = m[o.c] || []).push([d, o.q]); }); });
    return (S.cidx = m);
  }
  function annOf(c) {
    var a = ((S.ann || {}).items || {})[c] || {}, t = kstYmd(), r = { ld: a.ld || "", lp: a.lp || "", nd: "", nq: "" };
    (calIdx()[c] || []).forEach(function (x) {
      if (x[0] <= t) { if (x[0] > r.ld) { r.ld = x[0]; r.lp = x[1] || ""; } }
      else if (!r.nd || x[0] < r.nd) { r.nd = x[0]; r.nq = x[1] || ""; }
    });
    return r;
  }
  function annTxt(d, q, t) { return d ? '<b class="mono">' + esc(dlab(d)) + "</b>" + (d === t ? '<i class="an-t">오늘</i>' : "") + (q ? "<small>" + esc(String(q).replace(/^\d\d\.(\d\d)-(\d\d)$/, function (m, x, y) { return +x + "~" + +y + "월"; })) + "</small>" : "") : '<span class="na">—</span>'; }
  function renderAll() {
    if (!S.pxa || !S.sec || !S.cal || !S.ann) {
      app.innerHTML = '<div class="loading">불러오는 중…</div>';
      Promise.all([S.pxa || getJSON("data/jp/pxall/index.json"), S.sec || getJSON("data/jp/sectors.json").catch(function () { return { sectors: [], items: {} }; }),
        S.cal || getJSON("data/jp/cal.json").catch(function () { return { days: {} }; }), S.ann || getJSON("data/jp/ann.json").catch(function () { return { items: {} }; })])
        .then(function (r) { S.pxa = r[0]; S.sec = r[1]; S.cal = r[2]; S.ann = r[3]; S.cidx = null; if (S.mode === "jpa") renderAll(); })
        .catch(function (e) { app.innerHTML = '<div class="empty">전 종목 자료를 못 불러왔습니다(' + esc(e.message) + ")</div>"; });
      return;
    }
    var it = S.pxa.items || {}, si = S.sec.items || {};
    var pool = Object.keys(si).length ? si : it;   // 전 종목 판 = sectors.json 1,389곳(판에 걸린 종목은 차트 자료를 덧붙임)
    var bd = ABOARDS.filter(function (x) { return x.k === S.aboard; })[0], q = S.aq.trim().toLowerCase(), isAll = bd.k === "all" || bd.k === "fav";
    var all = isAll ? Object.keys(pool).filter(function (c) { return bd.k === "all" || FAV[c]; }).map(function (c) { return Object.assign({ c: c }, si[c] || {}, it[c] || {}, { s: secOf(c), pa: !!it[c] }, annOf(c)); })
      : Object.keys(it).map(function (c) { return Object.assign({ c: c }, it[c], { s: secOf(c), pa: true }, annOf(c)); }).filter(bd.f);
    var base = all.filter(function (o) { return (!S.amin || (o.mc || 0) >= S.amin) && (!q || [o.n, o.en, o.c, o.cat, o.s].join(" ").toLowerCase().indexOf(q) >= 0); });
    var secs = (S.sec.sectors || []).filter(function (s) { return base.some(function (o) { return o.s === s; }); });
    if (S.asec && secs.indexOf(S.asec) < 0) S.asec = "";
    var rows = base.filter(function (o) { return !S.asec || o.s === S.asec; });
    var key = S.aboard === "up" && S.asort === "mc" ? "upv" : S.asort;
    function upv(o) { return o.up ? Math.max(o.up.day || -99, o.up.pts || -99) : -99; }
    rows.sort(function (a, b) { return key === "upv" ? upv(b) - upv(a) : key === "off" ? (b.off || -99) - (a.off || -99) : key === "turn" ? String(b.turn || "").localeCompare(String(a.turn || "")) : key === "per" ? ((a.per > 0 ? a.per : 1e9) - (b.per > 0 ? b.per : 1e9)) : key === "nd" ? String(a.nd || "9").localeCompare(String(b.nd || "9")) : key === "ld" ? String(b.ld || "").localeCompare(String(a.ld || "")) : (b[key] == null ? -1e9 : b[key]) - (a[key] == null ? -1e9 : a[key]); });
    var head = '<header class="jhd"><div class="hd"><div class="jbrand"><div class="eyebrow">Tokyo Stock Exchange · All Majors</div>' +
      '<h1><span class="kanji">全</span>일본 주요 전 종목<a class="calbtn" href="#jpcal">실적 발표 캘린더 ›</a></h1>' +
      '<div class="sub">100억 사이트 일본 종목 + 일본 소비재 ' + (S.pxa.n_universe || "—") + '개 전부 &nbsp;|&nbsp; 주가 <span class="mono">' + esc(S.pxa.updated || "") + '</span> · 카부탄 <span class="mono">' + esc(S.pxa.kabutan || "") + "</span></div></div>" +
      '<div class="stats"><div class="stat"><b>' + Object.keys(pool).length + '</b><span>전 종목</span></div><div class="stat"><b>' + Object.keys(it).length + "</b><span>판에 오른 종목</span></div></div></div></header>";
    var tabs = '<nav class="boards" id="aboards">' + ABOARDS.map(function (b) { var n = b.k === "all" ? Object.keys(pool).length : b.k === "fav" ? Object.keys(pool).filter(function (c) { return FAV[c]; }).length : Object.keys(it).filter(function (c) { return b.f(it[c]); }).length; return '<button data-ab="' + b.k + '" aria-pressed="' + (S.aboard === b.k) + '">' + b.t + "<span>" + n + "</span></button>"; }).join("") + "</nav>";
    var chips = '<nav class="secs" id="asecs" aria-label="섹터"><button data-sec="" aria-pressed="' + !S.asec + '">전체<span>' + base.length + "</span></button>" +
      secs.map(function (s) { return '<button data-sec="' + esc(s) + '" aria-pressed="' + (S.asec === s) + '">' + esc(s) + "<span>" + base.filter(function (o) { return o.s === s; }).length + "</span></button>"; }).join("") + "</nav>";
    var sorts = (isAll ? [["mc", "시가총액"], ["ytd", "YTD"], ["py", "1년 주가"], ["revg", "매출성장"], ["opm", "영업이익률"], ["per", "PER 낮은 순"], ["nd", "다음 실적 빠른 순"], ["ld", "최근 실적 최근 순"]]
      : [["mc", S.aboard === "up" ? "상승률" : "시가총액"], ["ytd", "YTD"], ["revg", "매출성장"], ["off", "고점과 가까운 순"]].concat(S.aboard === "turn" ? [["turn", "최근 전환 순"]] : [], [["nd", "다음 실적 빠른 순"], ["ld", "최근 실적 최근 순"]]));
    if (!sorts.some(function (s) { return s[0] === S.asort; })) S.asort = "mc";
    var ctl = '<div class="ctl"><div class="fld"><label for="asort">정렬 기준</label><select id="asort">' + sorts.map(function (s) { return '<option value="' + s[0] + '"' + (S.asort === s[0] ? " selected" : "") + ">" + s[1] + "</option>"; }).join("") + "</select></div>" +
      '<div class="fld"><span>최소 시총</span><div class="seg" id="amin">' + [[0, "전체"], [1000, "1천억엔↑"], [5000, "5천억엔↑"], [10000, "1조엔↑"]].map(function (v) { return '<button data-v="' + v[0] + '" aria-pressed="' + (S.amin === v[0]) + '">' + v[1] + "</button>"; }).join("") + "</div></div>" +
      '<div class="fld q"><label for="aq">검색</label><input type="search" id="aq" placeholder="종목명 · 코드 · 업종 · 섹터" value="' + esc(S.aq) + '"></div>' +
      '<div class="count"><b>' + rows.length + "</b>개 종목</div></div>";
    var note = '<p class="stage-note">' + bd.note + (isAll ? "" : " 카드를 누르면 5년 큰 차트(Alt+H 수평선 · Alt+T 추세선).") + "</p>";
    var today = kstYmd();
    function astar(c) { return '<button type="button" class="star' + (FAV[c] ? " on" : "") + '" data-afav="' + esc(c) + '" aria-pressed="' + !!FAV[c] + '" title="즐겨찾기">' + (FAV[c] ? "★" : "☆") + "</button>"; }
    function badges(o) { return o.pa ? (o.new ? '<i class="cb new">신고가</i>' : "") + (o.near ? '<i class="cb near">근접</i>' : "") + (o.turn ? '<i class="cb turn">턴</i>' : "") + (o.up ? '<i class="cb up">' + (o.up.stop ? "상한가" : "+8%") + "</i>" : "") : ""; }
    var body = !rows.length ? '<div class="empty">' + (bd.k === "fav" && !all.length ? "아직 즐겨찾기가 없습니다 — 전 종목 표나 카드의 ☆ 를 누르세요." : "조건에 맞는 종목이 없습니다.") + "</div>" : !isAll ? '<div class="pgrid">' + rows.map(acard).join("") + "</div>" :
      '<div class="tbl-wrap"><table class="con-t all-t"><thead><tr><th class="fv"></th><th>종목</th><th>섹터</th><th>최근 실적</th><th>다음 실적</th><th class="r">시총(억엔)</th><th class="r">YTD</th><th class="r">1년</th><th class="r">매출성장</th><th class="r">OPM</th><th class="r">PER</th><th>판</th><th></th></tr></thead><tbody>' +
      rows.map(function (o) {
        return "<tr" + (o.pa ? ' data-pa="' + esc(o.c) + '" class="hasch" tabindex="0"' : "") + '><td class="fv">' + astar(o.c) + "</td><td><b>" + esc(o.n || o.c) + '</b> <span class="mono na">' + esc(o.c) + "</span>" + (o.cat && o.cat !== o.s ? '<span class="jp">' + esc(o.cat) + "</span>" : "") + "</td>" +
          '<td class="sc">' + esc(o.s || "—") + '</td><td class="an">' + annTxt(o.ld, o.lp, today) + '</td><td class="an nx">' + annTxt(o.nd, o.nq, today) + '</td><td class="r mono">' + mcap(o.mc) + '</td><td class="r">' + (o.ytd == null ? "—" : pct(o.ytd)) + '</td><td class="r">' + (o.py == null ? "—" : pct(o.py)) + "</td>" +
          '<td class="r">' + (o.revg == null ? "—" : pct(o.revg)) + '</td><td class="r mono">' + (o.opm == null ? "—" : (+o.opm).toFixed(1) + "%") + '</td><td class="r mono">' + (o.per == null ? "—" : o.per < 0 ? "적자" : (+o.per).toFixed(1)) + "</td>" +
          "<td>" + badges(o) + '</td><td><a class="kbl" href="https://kabutan.jp/stock/?code=' + encodeURIComponent(o.c) + '" target="_blank" rel="noopener noreferrer">카부탄↗</a></td></tr>';
      }).join("") + "</tbody></table></div>";
    app.innerHTML = '<div class="wrap" id="view">' + head + tabs + chips + ctl + note + body + "</div>";
    app.querySelectorAll("#aboards button").forEach(function (b) { b.onclick = function () { S.aboard = b.dataset.ab; try { localStorage.setItem("es-aboard", S.aboard); } catch (e) {} renderAll(); }; });
    app.querySelectorAll("#asecs button").forEach(function (b) { b.onclick = function () { S.asec = b.dataset.sec; renderAll(); }; });
    app.querySelectorAll("#amin button").forEach(function (b) { b.onclick = function () { S.amin = +b.dataset.v; renderAll(); }; });
    var so = document.getElementById("asort"); so.onchange = function () { S.asort = so.value; renderAll(); };
    var aq = document.getElementById("aq");
    function ago() { S.aq = aq.value; renderAll(); var n = document.getElementById("aq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    typing(aq, ago);
    app.querySelectorAll("[data-pa]").forEach(function (el) {
      // 텔레 단계 밖이라도 2단계 리포트만 쓴 회사는 '리포트·재무'가 리포트를 바로 연다(2026-10-30 사용자: 마스그룹)
      function go() { var c = el.dataset.pa, o = it[c] || {}, inSite = S.cos[c], r = ((S.res.items || {})[c] || {})["2"], rep = r && r.status === "완료" && r.html;
        window.PXC && PXC.open(c, o.n || c, inSite ? function () { location.hash = "jp/c/" + c; } : rep ? function () { window.open(ver(r.html, r.written), "_blank", "noopener"); } : null, "data/jp/pxall/"); }
      el.onclick = function (e) { if (e.target.closest("a,button")) return; go(); }; el.onkeydown = function (e) { if (e.key === "Enter") go(); };
    });
    app.querySelectorAll("[data-afav]").forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); var c = b.dataset.afav; if (FAV[c]) delete FAV[c]; else FAV[c] = 1; try { localStorage.setItem("es-fav", JSON.stringify(FAV)); } catch (er) {} var y = window.scrollY; renderAll(); window.scrollTo(0, y); };
    });
  }
  /* ---------- 일본 소비재 — 소형주까지 소비하는 모든 업종을 분류해 훑어보는 칸(2026-10-30 사용자). data/jp/consumer_all.json ---------- */
  S.ccat = ""; S.cq = "";
  function renderCon() {
    if (!S.con || !S.pxa) {
      app.innerHTML = '<div class="loading">불러오는 중…</div>';
      Promise.all([S.con || getJSON("data/jp/consumer_all.json"), S.pxa || getJSON("data/jp/pxall/index.json").catch(function () { return { items: {} }; })]).then(function (r) { S.con = r[0]; S.pxa = r[1]; if (S.mode === "jpc") renderCon(); })
        .catch(function () { app.innerHTML = '<div class="empty">소비재 전 종목 분류를 아직 만드는 중입니다.</div>'; });
      return;
    }
    var it = S.con.items || {}, pa = S.pxa.items || {}, all = Object.keys(it).map(function (c) { return Object.assign({ c: c }, it[c]); });
    var cats = (S.con.cats || []).slice(); all.forEach(function (o) { if (cats.indexOf(o.cat) < 0) cats.push(o.cat); });
    var q = S.cq.trim().toLowerCase();
    var rows = all.filter(function (o) { return (!S.ccat || o.cat === S.ccat) && (!q || [o.n, o.jp, o.c, o.cat, o.note].join(" ").toLowerCase().indexOf(q) >= 0); })
      .sort(function (a, b) { return (b.mc || 0) - (a.mc || 0); });
    function cnt(k) { return all.filter(function (o) { return o.cat === k; }).length; }
    function badges(c) { var p = pa[c]; if (!p) return ""; return (p.new ? '<i class="cb new">신고가</i>' : "") + (p.near ? '<i class="cb near">근접</i>' : "") + (p.turn ? '<i class="cb turn">턴</i>' : "") + (p.up ? '<i class="cb up">' + (p.up.stop ? "상한가" : "+8%") + "</i>" : ""); }
    var head = '<header class="jhd"><div class="hd"><div class="jbrand"><div class="eyebrow">Tokyo Stock Exchange · Consumer</div><h1><span class="kanji">消</span>일본 소비재</h1>' +
      '<div class="sub">먹는 것·입는 것·장난감·뽑기·화장품·시계·백화점… 소비하는 모든 업종, 소형주 포함 &nbsp;|&nbsp; 분류 <span class="mono">' + esc(S.con.updated || "") + "</span></div></div>" +
      '<div class="stats"><div class="stat"><b>' + all.length + "</b><span>종목</span></div></div></div></header>";
    var chips = '<nav class="boards" id="ccats"><button data-cc="" aria-pressed="' + !S.ccat + '">전체<span>' + all.length + "</span></button>" + cats.map(function (k) { return '<button data-cc="' + esc(k) + '" aria-pressed="' + (S.ccat === k) + '">' + esc(k) + "<span>" + cnt(k) + "</span></button>"; }).join("") + "</nav>";
    var ctl = '<div class="ctl"><div class="fld q"><label for="cq">검색</label><input type="search" id="cq" placeholder="종목명 · 코드 · 분류" value="' + esc(S.cq) + '"></div><div class="count"><b>' + rows.length + "</b>개 종목</div></div>";
    var tb = '<div class="tbl-wrap"><table class="con-t"><thead><tr><th>종목</th><th>코드</th><th>분류</th><th class="r">시총(억엔)</th><th class="r">YTD</th><th>판</th><th>메모</th></tr></thead><tbody>' +
      rows.map(function (o) { var p = pa[o.c]; return '<tr' + (p ? ' data-cp="' + esc(o.c) + '" class="hasch"' : "") + "><td><b>" + esc(o.n) + "</b>" + (o.jp && o.jp !== o.n ? '<span class="jp">' + esc(o.jp) + "</span>" : "") + '</td><td class="mono">' + esc(o.c) + "</td><td>" + esc(o.cat) + '</td><td class="r mono">' + num(o.mc) + '</td><td class="r">' + (p && p.ytd != null ? pct(p.ytd) : "—") + "</td><td>" + badges(o.c) + '</td><td class="nt">' + esc(o.note || "") + "</td></tr>"; }).join("") + "</tbody></table></div>";
    app.innerHTML = '<div class="wrap" id="view">' + head + chips + ctl + '<p class="stage-note">판(신고가·근접·턴어라운드·상한가)에 걸린 종목은 줄을 누르면 5년 차트가 열립니다.</p>' + tb + "</div>";
    app.querySelectorAll("#ccats button").forEach(function (b) { b.onclick = function () { S.ccat = b.dataset.cc; renderCon(); }; });
    var cq = document.getElementById("cq");
    function cgo() { S.cq = cq.value; renderCon(); var n = document.getElementById("cq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    typing(cq, cgo);
    app.querySelectorAll("[data-cp]").forEach(function (tr) { tr.onclick = function () { var c = tr.dataset.cp; window.PXC && PXC.open(c, (it[c] || {}).n || c, S.cos[c] ? function () { location.hash = "jp/c/" + c; } : null, "data/jp/pxall/"); }; });
  }
  /* ---------- 일본 주요 전 종목 실적 발표 캘린더 — JPX 決算発表予定日(2026-10-30 사용자). 한 번에 한 주(월~금), 주 단위로 넘김 ----------
   *  종목마다 실발 후 주가(발표 20분쯤 뒤 카부탄 등락, data/jp/rx.json · tools/rx.py) + 카부탄 링크, 누르면 요약 재무 */
  var CAL_SHOW = 15;
  S.calq = ""; S.calopen = {}; S.calweek = null;
  function kb(c, path) { return "https://kabutan.jp/stock/" + (path || "") + "?code=" + encodeURIComponent(c); }
  function rxOf(o, day) { var r = ((S.rx || {}).items || {})[o.c]; return r && r.v != null && (!r.d || r.d >= day) ? r : null; }
  function renderCal() {
    if (!S.cal || !S.pxa || !S.rx) {
      app.innerHTML = '<div class="loading">불러오는 중…</div>';
      Promise.all([S.cal || getJSON("data/jp/cal.json"), S.pxa || getJSON("data/jp/pxall/index.json").catch(function () { return { items: {} }; }), S.rx || getJSON("data/jp/rx.json").catch(function () { return { items: {} }; })])
        .then(function (r) { S.cal = r[0]; S.pxa = r[1]; S.rx = r[2]; if (S.mode === "jpcal") renderCal(); })
        .catch(function (e) { app.innerHTML = '<div class="empty">캘린더를 못 불러왔습니다(' + esc(e.message) + ")</div>"; });
      return;
    }
    var days = S.cal.days || {}, q = S.calq.trim().toLowerCase(), today = kstYmd();
    function hit(o) { return !q || [o.n, o.c, o.cat].join(" ").toLowerCase().indexOf(q) >= 0; }
    var weeks = {};
    Object.keys(days).forEach(function (d) { var n = days[d].filter(hit).length; if (n) { var w = monday(d); weeks[w] = (weeks[w] || 0) + n; } });
    var keys = Object.keys(weeks).sort(), cur = monday(today);
    if (!S.calweek || !weeks[S.calweek]) S.calweek = weeks[cur] ? cur : keys.filter(function (k) { return k >= cur; })[0] || keys[keys.length - 1];
    var mon = S.calweek, wi = keys.indexOf(mon);
    if (!keys.length) { app.innerHTML = '<div class="wrap" id="view"><div class="empty">' + (q ? "검색과 맞는 종목이 없습니다." : "캘린더 자료가 없습니다.") + "</div></div>"; return; }
    var chips = keys.map(function (k) {
      return '<button data-cw="' + k + '" aria-pressed="' + (k === mon) + '"' + (k === cur ? ' class="now"' : "") + "><b>" + weekName(k) + "</b><span>" + dot(k) + "~" + dot(addDays(k, 4)) + " · " + weeks[k] + "</span></button>";
    }).join("");
    function item(o, d) {
      var r = rxOf(o, d), pre = d > today;
      return '<li><button class="ce" data-cc="' + esc(o.c) + '" data-cd="' + d + '" title="' + esc(o.c + " · " + (o.cat || "") + " · 눌러서 재무 보기") + '">' +
        '<span class="ce-n"><b>' + esc(o.n || o.c) + '</b><i class="mono">' + esc(o.c) + "</i>" + (o.q ? '<em class="ce-q">' + esc(o.q) + "</em>" : "") + "</span>" +
        '<span class="ce-m">' + (o.mc != null ? "시총 " + mcap(o.mc) + "억엔" : "") + (o.cat ? " · " + esc(o.cat) : "") + "</span></button>" +
        (pre ? "" : '<div class="ce-rx"><span>실발 후 주가:</span>' + (r ? '<b class="' + (r.v > 0 ? "up" : r.v < 0 ? "dn" : "na") + '" title="' + esc(md(r.d) + " " + (r.t || "") + " 카부탄 기준") + '">' + pctTxt(r.v) + "</b>" : '<b class="na">' + (d === today ? "대기" : "—") + "</b>") +
          '<a class="kbl" href="' + kb(o.c) + '" target="_blank" rel="noopener noreferrer">카부탄↗</a></div>') + "</li>";
    }
    var cols = [0, 1, 2, 3, 4].map(function (i) {
      var d = addDays(mon, i), list = (days[d] || []).filter(hit), open = S.calopen[d] || q, shown = open ? list : list.slice(0, CAL_SHOW);
      var nrx = list.filter(function (o) { return rxOf(o, d); }).length;
      return '<section class="cal-col' + (d === today ? " today" : d < today ? " past" : "") + '"><header><b>' + dot(d) + "(" + WD[new Date(d + "T00:00:00").getDay()] + ")</b><span>" + list.length + "곳" + (nrx ? " · 반응 " + nrx : "") + "</span></header>" +
        (list.length ? '<ul class="cal-list ce-list">' + shown.map(function (o) { return item(o, d); }).join("") + "</ul>" : '<p class="cal-empty">발표 없음</p>') +
        (list.length > CAL_SHOW && !q ? '<button class="more" data-more="' + d + '">' + (open ? "접기" : "+" + (list.length - CAL_SHOW) + "곳 더 보기") + "</button>" : "") + "</section>";
    }).join("");
    var head = '<header class="jhd"><div class="hd"><div class="jbrand"><div class="eyebrow">Tokyo Stock Exchange · Earnings Calendar</div><h1><span class="kanji">暦</span>실적 발표 캘린더<a class="calbtn" href="#jpa">‹ 일본 주요 전 종목</a></h1>' +
      '<div class="sub">일본 주요 전 종목 ' + (S.cal.n_universe || "—") + '개 · JPX 결산 발표 예정일 <span class="mono">' + esc(S.cal.updated || "") + "</span>" + (S.rx.updated ? ' &nbsp;|&nbsp; 실발 후 주가 <span class="mono">' + esc(S.rx.updated) + "</span>" : "") + "</div></div></div></header>";
    var ctl = '<div class="ctl"><div class="fld q"><label for="calq">검색</label><input type="search" id="calq" placeholder="종목명 · 코드 · 업종" value="' + esc(S.calq) + '"></div>' +
      '<div class="count"><span class="today">' + todayKo() + "</span> · 이 주 <b>" + (weeks[mon] || 0) + "</b>곳</div></div>";
    app.innerHTML = '<div class="wrap" id="view">' + head + ctl +
      '<p class="stage-note">하루 칸은 시가총액 큰 순. <b>실발 후 주가</b> = 실적 발표 20분쯤 뒤 카부탄에서 본 등락(보통 15:30 발표 → 15:50 확인). 종목을 누르면 요약 재무가 열립니다.</p>' +
      '<div class="cal"><div class="weeks" id="weeks">' + chips + "</div>" +
      '<div class="wnav"><button data-step="-1"' + (wi <= 0 ? " disabled" : "") + ">‹ 이전 주</button><b>" + weekName(mon) + "</b><span>" + dot(mon) + " ~ " + dot(addDays(mon, 4)) + "</span>" +
      '<button data-step="0"' + (mon === cur ? " disabled" : "") + '>이번 주</button><button data-step="1"' + (wi >= keys.length - 1 ? " disabled" : "") + ">다음 주 ›</button></div>" +
      '<div class="cal-grid">' + cols + "</div></div></div>";
    app.querySelectorAll("[data-cw]").forEach(function (b) { b.onclick = function () { S.calweek = b.dataset.cw; renderCal(); }; });
    app.querySelectorAll("[data-step]").forEach(function (b) {
      b.onclick = function () { var st = +b.dataset.step; S.calweek = st ? keys[wi + st] : (weeks[cur] ? cur : S.calweek); renderCal(); };
    });
    var wk = document.getElementById("weeks"), on = wk && wk.querySelector('[aria-pressed="true"]'); if (on) wk.scrollLeft = on.offsetLeft - wk.clientWidth / 2 + on.clientWidth / 2;
    app.querySelectorAll("[data-more]").forEach(function (b) { b.onclick = function () { S.calopen[b.dataset.more] = !S.calopen[b.dataset.more]; renderCal(); }; });
    app.querySelectorAll("[data-cc]").forEach(function (el) {
      el.onclick = function () { var d = el.dataset.cd, o = (days[d] || []).filter(function (x) { return x.c === el.dataset.cc; })[0]; if (o) calFin(o, d); };
    });
    var cq = document.getElementById("calq");
    function go() { S.calq = cq.value; renderCal(); var n = document.getElementById("calq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    typing(cq, go);
  }
  /* 캘린더 종목 요약 재무 — 오른쪽 패널. 100억 스크리너 숫자(시총·매출·성장·OPM·ROE·PER·YTD·1Y) + 분기 자료가 있으면 10개 분기 */
  function calFin(o, d) {
    var r = rxOf(o, d), p = (S.pxa.items || {})[o.c];
    function f1(v, u) { return v == null ? "—" : num(v, Math.abs(v) < 100 ? 1 : 0) + (u || ""); }
    var kv = [["시가총액", o.mc != null ? mcap(o.mc) + "억엔" : "—"], ["매출(연)", f1(o.sales, "억엔")], ["매출성장(TTM)", o.revg == null ? "—" : pct(o.revg)],
      ["영업이익률", f1(o.opm, "%")], ["ROE", f1(o.roe, "%")], ["PER", o.per == null ? "—" : o.per < 0 ? "적자" : o.per.toFixed(1) + "배"],
      ["YTD", o.ytd == null ? "—" : pct(o.ytd)], ["1년 주가", o.py == null ? "—" : pct(o.py)]];
    if (o.sales && o.opm != null) kv.splice(3, 0, ["영업이익(연, 어림)", f1(o.sales * o.opm / 100, "억엔")]);
    pin.innerHTML = '<div class="ptop"><div><div class="dtk">TSE : ' + esc(o.c) + "</div>" +
      '<h2 class="dnm" id="d-title">' + esc(o.n || o.c) + "</h2>" +
      '<div class="chips">' + (o.cat ? '<span class="chip k">' + esc(o.cat) + "</span>" : "") + '<span class="chip">' + esc(dlab(d)) + " 발표" + (o.q ? " · " + esc(o.q) : "") + "</span>" +
      '<a class="chip" href="' + kb(o.c) + '" target="_blank" rel="noopener noreferrer">카부탄 ↗</a><a class="chip" href="' + kb(o.c, "finance") + '" target="_blank" rel="noopener noreferrer">카부탄 결산 ↗</a></div>' +
      (d <= kstYmd() ? '<div class="react"><span class="rx ' + (r ? (r.v > 0 ? "up" : r.v < 0 ? "dn" : "") : "") + '">실발 후 주가: ' + (r ? pctTxt(r.v) + " · " + esc(md(r.d) + " " + (r.t || "")) : "아직 없음") + "</span></div>" : "") +
      '</div><button class="x" id="px" aria-label="닫기">✕</button></div>' +
      '<div class="dsec">요약 재무<span class="hint">100억 스크리너 · 억엔</span></div><div class="kmini">' + kv.map(function (k) { return "<div><span>" + k[0] + "</span><b>" + k[1] + "</b></div>"; }).join("") + "</div>" +
      (S.qy[o.c] && S.qy[o.c].length ? '<div class="dsec">최근 10개 분기</div>' + qline(o.c) : '<div id="cf-kq"><p class="na">분기 실적 불러오는 중…</p></div>') +
      '<div class="cf-act">' + (p ? '<button class="rbtn" id="cf-ch">5년 차트</button>' : "") + (S.cos[o.c] ? '<a class="rbtn ghost" href="#jp/c/' + esc(o.c) + '">상세 패널</a>' : "") + "</div>";
    panel.classList.add("on"); scrim.classList.add("on"); document.body.style.overflow = "hidden"; panel.focus();
    document.getElementById("px").onclick = closePanel;
    var ch = document.getElementById("cf-ch"); if (ch) ch.onclick = function () { window.PXC && PXC.open(o.c, o.n || o.c, null, "data/jp/pxall/"); };
    if (document.getElementById("cf-kq")) (S.kq ? Promise.resolve(S.kq) : getJSON("data/jp/kq.json")).then(function (k) {
      S.kq = k; var box = document.getElementById("cf-kq"); if (!box) return;
      box.innerHTML = kqTable(k[o.c]);
      var w = box.querySelector(".fswrap"); if (w) w.scrollLeft = w.scrollWidth;
    }).catch(function () { var box = document.getElementById("cf-kq"); if (box) box.innerHTML = '<p class="note">분기별 실적은 카부탄 결산 페이지에서 볼 수 있습니다.</p>'; });
  }
  /* 카부탄 3ヵ月決算 최근 8개 분기(kq.json, tools/build_ann.py) — 칸 색 = 전년 같은 분기 대비 */
  function kqTable(q) {
    if (!q || !q.length) return '<p class="note">분기별 실적은 카부탄 결산 페이지에서 볼 수 있습니다.</p>';
    function yoy(i, k) { var a = q[i][k], b = i >= 4 ? q[i - 4][k] : null; return a != null && b ? (a / Math.abs(b) - 1) * 100 * (b < 0 ? -1 : 1) : null; }
    var names = [["매출", 1], ["영업이익", 2], ["순이익", 3]];
    var head = '<tr><th class="l"></th>' + q.map(function (x, i) { return "<th><b>" + esc(x[0].replace(/^(\d\d)\.(\d\d)-(\d\d)$/, "$1.$2~$3")) + "</b><small>" + esc(md(x[4])) + " 발표</small>" + (i === q.length - 1 ? '<span class="fs-now">최근</span>' : "") + "</th>"; }).join("") + "</tr>";
    var body = names.map(function (nm) {
      return '<tr><th class="l">' + nm[0] + "</th>" + q.map(function (x, i) {
        var v = x[nm[1]], y = yoy(i, nm[1]);
        var opm = nm[1] === 2 && x[1] && v != null ? '<span class="fs-g"><i>OPM</i><em>' + (v / x[1] * 100).toFixed(1) + "%</em></span>" : "";
        return '<td class="fs-c ' + tone(y) + '"><b>' + (v == null ? "—" : num(v, Math.abs(v) < 100 ? 1 : 0)) + "</b>" + opm + sg("YoY", y) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return '<div class="dsec">최근 8개 분기<span class="hint">억엔 · 3개월 실적 · 칸 색 = YoY</span></div><div class="fswrap"><table class="fs"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>" +
      '<p class="note">원천: 카부탄 결산 페이지 「3ヵ月決算」. 분기 = 그 회사 결산월 기준 3개월.</p>';
  }
  function acard(o) {
    var B = S.aboard, u = o.up || {};
    var tag = B === "turn" ? "정배열 전환 " + md(o.turn) : B === "new" ? "52주 신고가 " + md(o.hid) : B === "up" ? (u.stop ? "상한가 " : "") + (u.day != null ? "장중 " + pctTxt(u.day) : "") + (u.pts != null ? (u.day != null ? " · " : "") + "PTS " + pctTxt(u.pts) : "") : "고점 대비 " + pctTxt(o.off);
    return '<div class="pcard' + (B === "up" && u.stop ? " stop" : "") + '" data-pa="' + esc(o.c) + '" tabindex="0" role="button"><button type="button" class="star pc-star' + (FAV[o.c] ? " on" : "") + '" data-afav="' + esc(o.c) + '" aria-pressed="' + !!FAV[o.c] + '" title="즐겨찾기">' + (FAV[o.c] ? "★" : "☆") + "</button>" +
      '<div class="pc-ch">' + pchart(o, B === "up" ? "near" : B) + '<span class="pc-tag">' + esc(tag) + "</span></div>" +
      '<div class="pc-nm"><b>' + esc(o.n) + "</b><span>" + esc(o.c) + " · " + num(o.px, o.px < 100 ? 1 : 0) + "엔" + (o.s ? ' · <em class="pc-sec">' + esc(o.s) + "</em>" : "") + "</span></div>" +
      '<div class="pc-an"><span><i>최근 실적</i>' + annTxt(o.ld, o.lp, kstYmd()) + "</span><span><i>다음 실적</i>" + annTxt(o.nd, o.nq, kstYmd()) + "</span></div>" +
      '<div class="pc-st"><span><i>YTD</i>' + pct(o.ytd) + "</span><span><i>매출성장</i>" + pct(o.revg) + "</span>" +
      "<span><i>PER</i>" + (o.per == null ? "—" : o.per < 0 ? '<b class="na">적자</b>' : (+o.per).toFixed(1)) + "</span></div></div>";
  }
  /* 스크리닝 대상 = 2단계 이상 + 2단계 리포트를 쓴 회사(1단계 포함, 2026-10-29 사용자) */
  function inScr(o) { var r = (o.res || {})["2"]; return o.stage >= 2 || !!(r && r.status === "완료" && r.html); }
  function scrView() {
    if (S.board === "fav") return favView();
    var q = S.q.trim().toLowerCase(), sm = S.smart, minmc = S.minmc || 0;
    var rows = S.list.filter(function (o) {
      if (!inScr(o)) return false;
      if (q && [o.n, o.en, o.tn, o.c, o.cat, o.bm].join(" ").toLowerCase().indexOf(q) < 0) return false;
      if (minmc && !((scv(o, "mc") || 0) >= minmc)) return false;
      if (S.favonly && !FAV[o.c]) return false;
      return !sm || sm.conds.every(function (c) { var v = scv(o, c.k); return v != null && (c.lo ? v <= c.v : v >= c.v); });
    });
    var k = (sm && sm.sort) || S.ssort || "mc", lo = (SC.filter(function (x) { return x.k === k; })[0] || {}).lo, dir = S.sdir || (lo ? 1 : -1);
    rows.sort(function (a, b) {
      var x = scv(a, k), y = scv(b, k);
      if (x == null) return 1; if (y == null) return -1;
      if (k === "d") return dir * String(x).localeCompare(String(y));
      if (k === "per") { if (x < 0) return 1; if (y < 0) return -1; }
      return dir * (x - y);
    });
    var nF = Object.keys(FAV).filter(function (c) { return S.cos[c] && inScr(S.cos[c]); }).length;
    var B = S.board, bd = BOARDS.filter(function (x) { return x.k === B; })[0];
    if (bd.f) rows = rows.filter(function (o) { return bd.f((S.px.items || {})[o.c]); });
    var head = boardTabs() + '<div class="ctl">' +
      '<div class="fld"><label for="ssort">정렬 기준</label><select id="ssort">' + SC.map(function (c) { return '<option value="' + c.k + '"' + (k === c.k ? " selected" : "") + ">" + c.s + "</option>"; }).join("") + "</select></div>" +
      '<div class="fld"><span>최소 시총</span><div class="seg" id="minmc">' + [[0, "전체"], [500, "500억엔↑"], [1000, "1천억엔↑"], [5000, "5천억엔↑"]].map(function (v) { return '<button data-v="' + v[0] + '" aria-pressed="' + (minmc === v[0]) + '">' + v[1] + "</button>"; }).join("") + "</div></div>" +
      '<div class="fld"><span>즐겨찾기</span><div class="seg" id="favflt"><button data-v="0" aria-pressed="' + !S.favonly + '">전체</button><button data-v="1" aria-pressed="' + !!S.favonly + '">★만 ' + nF + "</button></div></div>" +
      '<div class="fld q"><label for="q">검색</label><input type="search" id="q" placeholder="종목명 · 코드 · 업종" value="' + esc(S.q) + '"></div>' +
      '<div class="count"><span class="today">' + todayKo() + "</span> · <b>" + rows.length + "</b>개 종목</div></div>" +
      '<div class="smart"><div class="smart-in"><span class="smart-ic">⌕</span><input type="text" id="sq" placeholder="조건으로 검색 — 예: 시총 1000억 이상, 매출성장 10% 이상, 주가 상승률 30% 이상, 영업이익률 15% 이상 순" value="' + esc(S.sq || "") + '"><button id="sqgo">검색</button>' + (sm ? '<button id="sqclear">해제</button>' : "") + "</div>" +
      '<div class="smart-hint">' + (sm ? "적용: " + sm.conds.map(function (c) { var x = SC.filter(function (y) { return y.k === c.k; })[0]; return "<b>" + esc(x.t) + " " + c.v + (c.lo ? " 이하" : " 이상") + "</b>"; }).join(" · ") + (sm.sort ? " · " + esc(SC.filter(function (y) { return y.k === sm.sort; })[0].t) + " 순" : "") : "시총·매출·매출성장·주가 상승률(1년·YTD)·PER·ROE·영업이익률 조건을 알아듣습니다. “~순”을 붙이면 그 기준으로 정렬합니다.") + "</div></div>" +
      '<p class="stage-note">' + (bd.f ? bd.note + " 주가 " + esc(md(S.px.updated)) + " " + esc((S.px.updated || "").slice(11)) + " 기준 · 카드를 누르면 큰 차트가 열립니다(Alt+H 수평선 · Alt+T 추세선)." : '텔레 2단계에 올라온 회사와 2단계 리포트를 쓴 회사를 모두 쌓아 둔 스크리너입니다. 매출·이익은 최근 4개 분기 합(TTM), ROE = 최근 4개 분기 순이익 ÷ 분기말 자기자본. 둘째 줄은 1년 주가와 분기별 매출액·영업이익 YoY — 노란 네모가 최근 실적발표 분기입니다. 회사를 누르면 리포트·재무제표·주가가 열립니다.') + "</p>";
    if (!rows.length) return head + '<div class="empty">조건에 맞는 종목이 없습니다.</div>';
    if (bd.f) return head + '<div class="pgrid">' + rows.map(pcard).join("") + "</div>";
    var maxmc = Math.max.apply(null, rows.map(function (o) { return scv(o, "mc") || 0; })) || 1;
    var th = '<tr><th class="ns"></th><th class="l ns">#</th><th class="l ns">코드</th><th class="l ns">종목</th>' + SC.map(function (c) {
      return '<th data-sk="' + c.k + '"' + (k === c.k ? ' class="on"' : "") + ">" + c.t + (k === c.k ? '<span class="ar">' + (dir < 0 ? "▼" : "▲") + "</span>" : "") + "</th>";
    }).join("") + "</tr>";
    var body = rows.map(function (o, i) {
      var x = (S.scr.items || {})[o.c] || {}, mc = scv(o, "mc"), w = Math.max(6, Math.round(60 * Math.sqrt((mc || 0) / maxmc)));
      var per = scv(o, "per"), en = (o.en && o.en !== o.n ? o.en.replace(/,? (Co\.,? )?(Ltd|Inc|Corporation|Holdings)\.?/g, "") : "");
      return '<tr class="main" data-c="' + esc(o.c) + '"><td class="fv"><button type="button" class="star' + (FAV[o.c] ? " on" : "") + '" data-fav="' + esc(o.c) + '" aria-pressed="' + !!FAV[o.c] + '" title="즐겨찾기">' + (FAV[o.c] ? "★" : "☆") + "</button></td>" +
        '<td class="l rk">' + (i + 1) + '</td><td class="l tk"><span class="tkc">' + esc(o.c) + "</span>" + (o.stage >= 3 ? '<span class="stgtag s' + o.stage + '">' + o.stage + "단계</span>" : "") + "</td>" +
        '<td class="l"><span class="nmrow"><span class="nm">' + esc(o.n) + (en ? "<small>(" + esc(en) + ")</small>" : "") + "</span></span>" + '<span class="ind">' + esc([x.cat || o.cat, o.bm].filter(Boolean).join(" · ")) + "</span></td>" +
        '<td class="mc">' + cl("시총(억엔)") + mcap(mc) + '<i class="mcb" data-w="' + w + '"></i></td>' +
        "<td>" + cl("매출(억엔)") + num(x.rev, x.rev != null && x.rev < 100 ? 1 : 0) + "</td>" +
        "<td>" + cl("매출성장") + pct(x.revg) + "</td><td>" + cl("1Y") + pct(x.py) + "</td><td>" + cl("YTD") + pct(x.ytd) + "</td>" +
        "<td>" + cl("PER") + (per == null ? "—" : per < 0 ? '<span class="na">적자</span>' : per.toFixed(1)) + "</td>" +
        "<td>" + cl("ROE") + (x.roe == null ? "—" : x.roe.toFixed(1)) + "</td><td>" + cl("OPM") + (x.opm == null ? "—" : x.opm.toFixed(1)) + "</td>" +
        '<td class="sd">' + cl("실적발표") + (o.d ? '<b class="ann">' + esc(md(o.d)) + "</b>" : "—") + "</td></tr>" +
        '<tr class="qrow" data-c="' + esc(o.c) + '"><td colspan="4" class="sp-big">' + bigSpark(o.c) + '</td><td colspan="9"><div class="qwrap">' + scrQ(o) + "</div></td></tr>";
    }).join("");
    return head + '<div class="tblwrap"><table class="main-t scr-t"><thead>' + th + "</thead><tbody>" + body + "</tbody></table></div>";
  }

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
    var vsel = st === 2 ? vselHtml() : "";
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
        '<tr class="qrow" data-c="' + esc(o.c) + '"><td></td><td class="sp-td">' + irc(o.c) + spark(o.c) + '</td><td colspan="9">' + '<div class="qwrap">' + qline(o.c) + "</div></td></tr>";
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
    document.getElementById("px").onclick = function () { location.hash = back(); };
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
      return '<rect class="b' + (xq.m ? " m" : "") + (v < 0 ? " neg" : "") + '" x="' + (x(i) - bw * 0.32).toFixed(1) + '" y="' + Math.min(y0, y1).toFixed(1) + '" width="' + (bw * 0.64).toFixed(1) + '" height="' + Math.max(1, Math.abs(y1 - y0)).toFixed(1) + '"><title>' + esc(xq.p + " " + num(v, Math.abs(v) < 100 ? 1 : 0) + "억엔" + (xq.m ? " · 인수" : "")) + "</title></rect>" +
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
      ? '<a class="art" href="' + esc(ver(r.html, r.written)) + '" target="_blank" rel="noopener">리서치 전문 열기 ↗</a>'
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
      return "<th>" + (x.m ? '<i class="mgh" title="' + esc(x.m) + '">인수</i>' : "") + "<b>" + esc(x.p) + "</b>" + (i === rows.length - 1 ? '<span class="fs-now">최근</span>' : x.sub ? "<small>" + esc(x.sub) + "</small>" : "") + "</th>";
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
      '<p class="note">분기는 결산기 기준(27.2Q = 2027년 결산기 2분기). 원천: 결산단신.' + (mg.length ? " 인수 = " + esc(mg.join(" · ")) + " — 그 분기부터 인수한 회사가 실적에 더해짐." : "") + "</p>";
  }
  function closePanel() { panel.classList.remove("on"); scrim.classList.remove("on"); document.body.style.overflow = ""; }
  function back() { return S.mode === "jps" ? "jps" : "jp/" + S.stage; }
  function shut() { if (S.mode === "jpcal") closePanel(); else location.hash = back(); }   // 캘린더 요약 재무는 주소 없이 열림
  scrim.onclick = shut;
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && panel.classList.contains("on")) shut(); });

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
  function body() { return S.mode === "jps" ? scrView() : S.stage === 1 ? stage1() : stageN(S.stage); }
  /* 일본 스크리닝 탭(2026-10-29 사용자: 2단계 '보기'에서 상단 탭으로 뺌) */
  function scrHead() {
    var n = S.list.filter(inScr).length;
    return '<header class="jhd"><div class="hd"><div class="jbrand"><div class="eyebrow">Tokyo Stock Exchange · Screening</div>' +
      '<h1><span class="kanji">選</span>일본 스크리닝</h1>' +
      '<div class="sub">2단계에 올라온 회사와 리포트를 쓴 회사를 한 표에 모읍니다 &nbsp;|&nbsp; 실적 <span class="mono">' + esc(S.upd1) + "</span> · 텔레 <span class=\"mono\">" + esc(S.upd2) + "</span></div></div>" +
      '<div class="stats"><div class="stat"><b>' + n + "</b><span>종목</span></div></div></div></header>";
  }
  function render() {
    app.innerHTML = (S.mode === "jps" ? scrHead() : head()) + '<div class="wrap" id="view">' + body() + "</div>";
    bindView();
  }
  function rerender() { document.getElementById("view").innerHTML = body(); bindView(); }
  function bindView() {
    var rl = app.querySelector(".rail"); if (rl) document.documentElement.style.setProperty("--railh", rl.offsetHeight + "px");
    app.querySelectorAll("td.mc i[data-w]").forEach(function (i) { i.style.width = i.dataset.w + "px"; });
    app.querySelectorAll("[data-c]").forEach(function (el) { el.onclick = function () { location.hash = (S.mode === "jps" ? "jps" : "jp") + "/c/" + el.dataset.c; }; });
    app.querySelectorAll("[data-pick]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); togglePick(b.dataset.pc); render(); }; });
    app.querySelectorAll("#vw button").forEach(function (b) { b.onclick = function () { S.view = b.dataset.v; S.dir = -1; rerender(); }; });
    app.querySelectorAll("[data-dd]").forEach(function (b) { b.onclick = function () { S.day = b.dataset.dd; rerender(); }; });
    app.querySelectorAll("[data-dstep]").forEach(function (b) {
      b.onclick = function () { var k = [].map.call(app.querySelectorAll("[data-dd]"), function (x) { return x.dataset.dd; }); S.day = k[Math.max(0, Math.min(k.length - 1, k.indexOf(S.day) + +b.dataset.dstep))]; rerender(); };
    });
    var q = document.getElementById("q");
    // 한글 조합 중(ㄱ→가)엔 다시 그리지 않음 — 그리면 입력칸이 새로 생겨 'ㄱ교ㅅ세' 처럼 깨짐(2026-10-29 사용자)
    function qgo() { S.q = q.value; rerender(); var n = document.getElementById("q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    if (q) typing(q, qgo);
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
    app.querySelectorAll("td.mc i.mcb[data-w]").forEach(function (i) { i.style.width = i.dataset.w + "px"; });
    var ss = document.getElementById("ssort");
    if (ss) ss.onchange = function () { S.ssort = ss.value; S.sdir = 0; if (S.smart) S.smart.sort = null; rerender(); };
    app.querySelectorAll("th[data-sk]").forEach(function (th) {
      th.onclick = function () { var k = th.dataset.sk, cur = (S.smart && S.smart.sort) || S.ssort || "mc"; if (S.smart) S.smart.sort = null; if (cur === k) S.sdir = -(S.sdir || (k === "per" ? 1 : -1)); else { S.ssort = k; S.sdir = 0; } rerender(); };
    });
    if (S.board === "fav" && S.mode === "jps") bindFav();
    app.querySelectorAll("#boards button").forEach(function (b) { b.onclick = function () { S.board = b.dataset.board; try { localStorage.setItem("es-board", S.board); } catch (e) {} rerender(); }; });
    app.querySelectorAll("[data-px]").forEach(function (el) {
      function go() { var o = S.cos[el.dataset.px] || {}; window.PXC && PXC.open(el.dataset.px, o.n || el.dataset.px, function () { location.hash = "jps/c/" + el.dataset.px; }); }
      el.onclick = go; el.onkeydown = function (e) { if (e.key === "Enter") go(); };
    });
    app.querySelectorAll("#minmc button").forEach(function (b) { b.onclick = function () { S.minmc = +b.dataset.v; rerender(); }; });
    app.querySelectorAll("#favflt button").forEach(function (b) { b.onclick = function () { S.favonly = b.dataset.v === "1"; rerender(); }; });
    app.querySelectorAll("[data-fav]").forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); var c = b.dataset.fav; if (FAV[c]) delete FAV[c]; else FAV[c] = 1; try { localStorage.setItem("es-fav", JSON.stringify(FAV)); } catch (er) {} rerender(); };
    });
    var sq = document.getElementById("sq");
    function goSmart() { S.sq = sq.value; S.smart = parseSmart(sq.value); rerender(); }
    if (sq) { sq.onkeydown = function (e) { if (e.key === "Enter") goSmart(); }; document.getElementById("sqgo").onclick = goSmart; }
    var sc = document.getElementById("sqclear"); if (sc) sc.onclick = function () { S.sq = ""; S.smart = null; rerender(); };
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
  // 리포트 주소에 판 표시 — 휴대폰이 예전 판(다크 화면)을 캐시에서 다시 보여 주지 않게(2026-10-26)
  function ver(u, w) { return u + "?v=" + String(w || "").replace(/\D/g, "") + "L2"; }
  function docLink(d) { return '<a class="rbtn" href="' + esc(ver(d.html, d.date)) + '" target="_blank" rel="noopener noreferrer">' + esc(d.kind) + " 열기</a>"; }
  function docRow(d, ann, full) {
    return '<article class="rdoc' + (full ? " pre" : "") + '"><div class="rd-meta"><span class="tag tg">' + esc(d.kind) + '</span><span class="mono">' + esc((d.date || "").slice(0, 10)) + "</span>" +
      (ann ? '<span class="ann">' + esc(dlab(ann)) + " 발표</span>" : "") + "</div>" +
      "<h3>" + esc(d.n) + ' <span class="mono">' + esc(d.c) + "</span></h3>" +
      (d.sum ? "<p>" + esc(d.sum) + "</p>" : "") +
      (full ? '<div class="rd-q">' + spark(d.c) + (S.qy[d.c] && S.qy[d.c].length ? qline(d.c) : "") + "</div>" : "") + '<div class="rd-act">' + docLink(d) +
      (S.cos[d.c] ? '<a class="rbtn ghost" href="#jp/c/' + esc(d.c) + '">재무·주가 보기</a>' : "") +
      (S.xl[d.c] ? '<a class="rbtn ghost" href="data/jp/xlsx/' + esc(d.c) + '.xlsx?v=' + encodeURIComponent(S.xl[d.c]) + '" download>xlsx 다운로드</a>' : "") + "</div></article>";
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
      body = pre.length ? '<div class="rdocs">' + pre.map(function (x) { return docRow(x.d, x.a, true); }).join("") + "</div>" :
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
    function rgo() { S.rq = q.value; renderRoom(); var n = document.getElementById("rq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    if (q) typing(q, rgo);
  }
  /* 검색칸 — 타이핑이 멈추고(0.3초) 한글 조합도 끝났을 때만 화면을 다시 그림.
     한 글자가 끝나는 compositionend 순간엔 다음 글자 조합이 이미 시작돼 있어, 그때 그리면 입력칸이 바뀌며 글자가 지워짐(2026-10-30 사용자) */
  function typing(el, fn) {
    var t = 0, comp = false;
    function later() { clearTimeout(t); t = setTimeout(function () { if (comp) later(); else fn(); }, 300); }
    el.addEventListener("compositionstart", function () { comp = true; });
    el.addEventListener("compositionend", function () { comp = false; later(); });
    el.addEventListener("input", later);
  }
  function soon(name) { return '<div class="soon"><h2>' + name + " 준비 중</h2><p>일본 탭과 같은 1~4단계 흐름으로 만들 예정입니다.</p></div>"; }
  function route() {
    var h = (location.hash || "#jp").slice(1).split("/"), m = h[0] || "jp";
    document.querySelectorAll(".market a").forEach(function (a) { a.classList.toggle("on", a.dataset.m === m); });
    if (m === "us" || m === "kr" || m === "room") S.mode = m;   // 늦게 온 전 종목·소비재·캘린더 자료가 이 화면을 덮어쓰지 않게
    if (m === "us" || m === "kr") { closePanel(); app.innerHTML = soon(m === "us" ? "미국" : "한국"); return; }
    if (!S.ready) return;
    if (m === "room") { closePanel(); S.roomTab = ["watch", "res", "pre"].indexOf(h[1]) >= 0 ? h[1] : "watch"; renderRoom(); return; }
    if (m === "jpa") { closePanel(); S.mode = "jpa"; renderAll(); return; }
    if (m === "jpc") { closePanel(); S.mode = "jpc"; renderCon(); return; }
    if (m === "jpcal") { closePanel(); S.mode = "jpcal"; renderCal(); return; }
    var md0 = m === "jps" ? "jps" : "jp", sw = S.mode !== md0;
    S.mode = md0;
    if (h[1] === "c") {
      if (sw || !app.querySelector("#view")) { if (md0 === "jp") S.stage = 2; render(); }
      openCo(h[2]); return;
    }
    closePanel();
    if (md0 === "jps") { if (sw || !app.querySelector("#view")) render(); return; }
    var st = Math.min(4, Math.max(2, +h[1] || 2));   // 1단계 퀵은 일단 뺌(2026-10-27 사용자) — #jp/1 은 2단계로
    if (sw || st !== S.stage || !app.querySelector("#view")) { S.stage = st; if (st > 1 && S.sort === "up") S.sort = "mc"; render(); }
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
    getJSON("data/jp/ret.json").catch(function () { return { items: {} }; }),
    getJSON("data/jp/ircall.json").catch(function () { return { items: {} }; }),
    getJSON("data/jp/scr.json").catch(function () { return { items: {} }; }),
    getJSON("data/jp/px/index.json").catch(function () { return { items: {} }; })
  ]).then(function (r) {
    S.scr = r[11]; S.px = r[12]; S.s1rows = {}; (r[0].rows || []).forEach(function (x) { S.s1rows[x.c] = x; });
    S.upd1 = r[0].updated || ""; S.upd2 = r[1].updated || "—"; S.qy = r[3]; S.fs = r[4]; S.bm = r[5]; S.mo = r[6]; S.res = r[2]; S.xl = r[7]; S.room = r[8]; S.ret = r[9]; S.irc = r[10]; S.upc = {}; (r[0].upcoming || []).forEach(function (u) { if (!u.est && !S.upc[u.c]) S.upc[u.c] = u.d; });
    S.cos = build(r[0], r[1], r[2]);
    S.list = Object.keys(S.cos).map(function (c) { return S.cos[c]; });
    S.ready = true; S.stage = 0; S.s1 = r[0]; S.pipe = r[1];
    route();
    /* 열어 둔 화면도 새 리포트·단계가 보이게 — 2분마다, 탭으로 돌아올 때 다시 받음(2026-10-26 사용자: 텔레 안 브라우저에서 '진행 중'이 남음) */
    function refresh() {
      if (document.hidden) return;
      Promise.all([getJSON("data/jp/pipeline.json"), getJSON("data/jp/research/index.json"), getJSON("data/jp/ircall.json").catch(function () { return S.irc; })]).then(function (x) {
        if (x[0].updated === S.pipe.updated && x[1].updated === S.res.updated && (x[2] || {}).updated === (S.irc || {}).updated) return;
        S.pipe = x[0]; S.res = x[1]; S.irc = x[2]; S.upd2 = x[0].updated || "—";
        S.cos = build(S.s1, S.pipe, S.res);
        S.list = Object.keys(S.cos).map(function (c) { return S.cos[c]; });
        if (!panel.classList.contains("on")) { var y = window.scrollY; route(); window.scrollTo(0, y); }
      }).catch(function () {});
    }
    setInterval(refresh, 120000);
    document.addEventListener("visibilitychange", refresh);
  }).catch(function (e) { app.innerHTML = '<div class="empty">데이터를 못 불러왔습니다. (' + esc(e.message) + ")</div>"; });
})();
