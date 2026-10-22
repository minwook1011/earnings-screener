/* 실적발표스크리너 — 일본 탭 1~4단계.
 * 데이터: data/jp/stage1.json(실적 발표 전체, VANTAGE에서 만듦)
 *         data/jp/pipeline.json(텔레그램 그룹의 단계 현황 — tools/tg_parse.py)
 *         data/jp/research/index.json + research/<코드>/stage<N>.md(단계별 리서치)
 * 주소: #jp(=#jp/1) · #jp/2 · #jp/c/5018 · #us · #kr */
(function () {
  "use strict";
  var STAGES = [
    { n: 1, lab: "1단계 · 퀵", desc: "실적 발표 기업 전체" },
    { n: 2, lab: "2단계 · 분석", desc: "볼 후보 · 점수·실적 분석" },
    { n: 3, lab: "3단계 · 딥", desc: "깊은 리포트 · 매수 근거" },
    { n: 4, lab: "4단계 · 결정", desc: "살지 말지 결정 직전" }
  ];
  var GRADE_UP = { "서프라이즈": 1, "양호": 1, "호조": 1 };
  var GRADE_DN = { "부진": 1, "쇼크": 1, "미달": 1 };
  var S = { cos: {}, list: [], pipe: null, res: { items: {} }, s1: null, q: "", f: "all", sort: "d" };
  var app = document.getElementById("app");

  function getJSON(p) { return fetch(p, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }); }
  function getText(p) { return fetch(p, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.text(); }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pct(v, d) {
    if (v == null || isNaN(v)) return '<b class="mute">—</b>';
    var cls = v > 0 ? "up" : v < 0 ? "dn" : "";
    var t = Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(d == null ? 1 : d);
    return '<b class="num ' + cls + '">' + (v > 0 ? "+" : "") + t + "%</b>";
  }
  function mcap(v) {
    if (v == null) return "—";
    if (v >= 10000) return (v / 10000).toFixed(2).replace(/\.?0+$/, "") + "조엔";
    return (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1)) + "억엔";
  }
  function md(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? (+m[2]) + "/" + (+m[3]) : (s || ""); }
  function gradeBadge(g) {
    if (!g) return "";
    return '<span class="badge ' + (GRADE_UP[g] ? "g-up" : GRADE_DN[g] ? "g-dn" : "") + '">' + esc(g) + "</span>";
  }
  function stageBadge(n) { return n > 1 ? '<span class="badge st s' + n + '">' + n + "단계</span>" : ""; }

  /* ---------- 데이터 합치기 ---------- */
  function annDate(ann, ref) {
    var m = /^(\d{1,2})\/(\d{1,2})/.exec(ann || "");
    if (!m) return null;
    var y = +(ref || "").slice(0, 4) || new Date().getFullYear();
    return y + "-" + ("0" + m[1]).slice(-2) + "-" + ("0" + m[2]).slice(-2);
  }
  function build(s1, pipe, res) {
    var cos = {};
    (s1.rows || []).forEach(function (r) { cos[r.c] = { c: r.c, n: r.n, en: r.en, cat: r.cat, d: r.d, p: r.p, fy: r.fy, mc: r.mc, per: r.per, g: r.g, rev: r.rev, op: r.op, d1: r.d1, prog: r.prog, stage: 1 }; });
    Object.keys(pipe.companies || {}).forEach(function (c) {
      var t = pipe.companies[c], card = t.cards[String(t.stage)] || t.cards["1"] || {};
      var o = cos[c] || (cos[c] = { c: c, n: t.n, d: annDate(card.ann, card.date), mc: card.mc, per: card.per, rev: card.rev, op: card.op, d1: card.d1, stage: 1 });
      o.n = o.n || t.n; o.tn = t.n;
      o.stage = t.stage; o.tg = t; o.card = card;
      if (o.mc == null) o.mc = card.mc;
      if (o.per == null) o.per = card.per;
      if (o.d1 == null) o.d1 = card.d1;
      if (card.tags) o.tags = card.tags;
      if (card.vr) o.vr = card.vr;
    });
    Object.keys(cos).forEach(function (c) { cos[c].res = (res.items || {})[c] || {}; });
    return cos;
  }

  /* ---------- 단계 흐름 ---------- */
  function counts() {
    var n = { 1: 0, 2: 0, 3: 0, 4: 0 };
    S.list.forEach(function (o) { n[1]++; if (o.stage >= 2) n[o.stage]++; });
    return n;
  }
  function flow(cur) {
    var n = counts();
    return '<nav class="flow" aria-label="단계">' + STAGES.map(function (s) {
      return '<a class="step s' + s.n + (s.n === cur ? " on" : "") + '" href="#jp/' + s.n + '">' +
        '<div class="lab"><i>' + s.n + "</i>" + esc(s.lab) + "</div>" +
        '<div class="cnt num">' + n[s.n] + "<small>곳</small></div>" +
        '<div class="desc">' + esc(s.desc) + "</div></a>";
    }).join("") + "</nav>";
  }

  /* ---------- 1단계 ---------- */
  var SORTS = { d: "발표일 최신", d1: "다음 날 주가", op: "영업이익 증가율", rev: "매출 증가율", mc: "시가총액" };
  function stage1() {
    var q = S.q.trim().toLowerCase();
    var rows = S.list.filter(function (o) {
      if (S.f === "tg" && !o.tg) return false;
      if (S.f === "good" && !(GRADE_UP[o.g] || (o.op != null && o.op >= 30))) return false;
      if (S.f === "up" && !(o.stage >= 2)) return false;
      if (!q) return true;
      return [o.n, o.en, o.tn, o.c, o.cat].join(" ").toLowerCase().indexOf(q) >= 0;
    });
    var k = S.sort;
    rows.sort(function (a, b) {
      if (k === "d") return (b.d || "").localeCompare(a.d || "") || (b.mc || 0) - (a.mc || 0);
      var x = a[k], y = b[k];
      if (x == null) return 1; if (y == null) return -1;
      return y - x;
    });
    var chips = [["all", "전체"], ["tg", "텔레 카드"], ["good", "실적 좋음"], ["up", "2단계 이상"]].map(function (c) {
      return '<button class="chip' + (S.f === c[0] ? " on" : "") + '" data-f="' + c[0] + '">' + c[1] + "</button>";
    }).join("");
    var sorts = Object.keys(SORTS).map(function (s) { return '<option value="' + s + '"' + (S.sort === s ? " selected" : "") + ">" + SORTS[s] + "</option>"; }).join("");
    return '<div class="bar"><h2>1단계 · 실적 발표 전체</h2>' +
      '<input class="search" id="q" type="search" placeholder="회사 이름·코드·업종" value="' + esc(S.q) + '">' + chips +
      '<select class="sort" id="sort" aria-label="정렬">' + sorts + "</select>" +
      '<span class="count num">' + rows.length + "곳</span>" +
      '<p class="hint">최근 발표 기업 전부입니다. 텔레그램 1단계 카드에서 [볼 후보]를 누르면 2단계로 올라갑니다.</p></div>' +
      (rows.length ? '<div class="grid">' + rows.map(card1).join("") + "</div>" : '<div class="empty">조건에 맞는 기업이 없습니다.</div>');
  }
  function card1(o) {
    return '<article class="co" data-c="' + esc(o.c) + '" tabindex="0">' +
      '<div class="hd"><span class="nm">' + esc(o.n || o.en) + '</span><span class="cd">' + esc(o.c) + "</span>" + stageBadge(o.stage) + "</div>" +
      '<div class="meta">' + esc(md(o.d)) + " 발표" + (o.p ? " · " + esc(o.p) : "") + (o.cat ? " · " + esc(o.cat) : "") + "</div>" +
      '<div class="nums">' +
      "<div><span>매출</span>" + pct(o.rev) + "</div>" +
      "<div><span>영업이익</span>" + pct(o.op) + "</div>" +
      "<div><span>다음 날</span>" + pct(o.d1) + "</div>" +
      '<div><span>시총</span><b class="num">' + mcap(o.mc) + "</b></div>" +
      '<div><span>PER</span><b class="num">' + (o.per != null ? o.per.toFixed(1) + "배" : "—") + "</b></div>" +
      '<div><span>진척 차</span>' + (o.prog != null ? pct(o.prog) : '<b class="mute">—</b>') + "</div>" +
      "</div>" +
      '<div class="ft">' + gradeBadge(o.g) + (o.tg ? '<span class="badge tg">텔레 카드</span>' : "") +
      (o.tags || []).filter(function (t) { return t !== "실적 호조"; }).map(function (t) { return '<span class="badge">' + esc(t) + "</span>"; }).join("") +
      "</div></article>";
  }

  /* ---------- 2~4단계 ---------- */
  function lensBlock(L, full) {
    if (!L) return "";
    var slots = "";
    for (var i = 0; i < 5; i++) slots += "<i class=\"" + (i < L.up ? "u" : i < L.up + L.down ? "d" : "") + "\"></i>";
    var who = (L.rows || []).map(function (r) {
      return '<span class="' + (r.v === "up" ? "u" : "d") + '"' + (full ? "" : ' title="' + esc(r.why) + '"') + ">" + esc(r.who) + " " + (r.v === "up" ? "3단계로" : "삭제") + "</span>";
    }).join("");
    var rows = full ? (L.rows || []).map(function (r) {
      return '<p><b class="' + (r.v === "up" ? "up" : "dn") + '">' + esc(r.who) + " · " + (r.v === "up" ? "3단계로" : "삭제") + "</b> " + esc(r.why) + "</p>";
    }).join("") : "";
    return '<div class="lens"><div class="sum">AI 렌즈 <span class="vote">' + slots + '</span><span class="num"><span class="up">3단계로 ' + L.up + '</span> · <span class="dn">삭제 ' + L.down + "</span></span></div>" +
      (full ? '<div class="lines">' + rows + "</div>" : '<div class="who">' + who + "</div>") + "</div>";
  }
  function resChip(o, st) {
    var r = o.res[String(st)];
    if (!r) return '<span class="badge">리서치 없음</span>';
    if (r.status === "완료") return '<span class="badge r-ok">' + st + "단계 리서치 완료</span>";
    return '<span class="badge r-wait">' + st + "단계 리서치 " + esc(r.status) + "</span>";
  }
  function section(card, t) {
    var s = (card.sections || []).filter(function (x) { return x.t.indexOf(t) === 0; })[0];
    return s ? s.lines : [];
  }
  function whyLines(card) {
    return section(card, "왜 좋았나").slice(0, 2).map(function (l) {
      var m = /^([A-Z가-힣 ]{1,6}):\s*(.*)$/.exec(l);
      return '<p class="why">' + (m ? "<em>" + esc(m[1]) + "</em>" + esc(m[2]) : esc(l)) + "</p>";
    }).join("");
  }
  function cardDeep(o, st) {
    var c = o.card || {};
    var bm = section(c, "비즈니스 모델")[0] || "";
    var rv = st <= 3 ? Math.min(st, 3) : 3;
    var r = o.res[String(rv)];
    return '<article class="deep" data-c="' + esc(o.c) + '" tabindex="0">' +
      '<div class="hd"><span class="nm">' + esc(o.n) + '</span><span class="cd">' + esc(o.c) + " · " + esc(c.ann || md(o.d)) + '</span><span class="r">' + gradeBadge(o.g) + "</span></div>" +
      (bm ? '<div class="bm">' + esc(bm) + "</div>" : "") +
      '<div class="kpi">' +
      '<div><span>시총</span><b class="num">' + mcap(o.mc) + "</b></div>" +
      '<div><span>PER</span><b class="num">' + (o.per != null ? o.per.toFixed(1) + "배" : "—") + "</b></div>" +
      "<div><span>영업이익</span>" + pct(o.op) + "</div>" +
      "<div><span>다음 날</span>" + pct(o.d1) + "</div></div>" +
      whyLines(c) + lensBlock(c.lens) +
      '<div class="rs">' + resChip(o, rv) + (r && r.verdict ? "<span><b>" + esc(r.verdict) + "</b></span>" : "<span>단계에 들어오면 리서치가 자동으로 붙습니다</span>") + "</div>" +
      "</article>";
  }
  var EMPTY = {
    3: ["아직 3단계 기업이 없습니다", "2단계 카드에서 [3단계로]를 누르면 이곳으로 옮겨지고, 3단계 딥 리포트가 자동으로 붙습니다."],
    4: ["아직 4단계 기업이 없습니다", "3단계에서 다 같이 본 뒤 살지 말지 정할 종목이 이곳에 모입니다."],
    2: ["아직 2단계 기업이 없습니다", "1단계 카드에서 [볼 후보]를 누르면 이곳으로 옵니다."]
  };
  var HINT = {
    2: "볼 후보로 고른 회사입니다. 각자 점수 1~5와 코멘트를 남기고, 2단계 실적 분석 리서치가 붙습니다.",
    3: "다 같이 깊게 보고 매수 여부·비중·근거·다시 볼 조건을 정리합니다. 3단계 딥 리포트가 붙습니다.",
    4: "4단계까지 왔으면 사기 직전 좋은 종목입니다. 다 같이 보고 살지 말지 결정합니다."
  };
  function stageN(st) {
    var rows = S.list.filter(function (o) { return o.stage === st; });
    rows.sort(function (a, b) { return ((b.card && b.card.lens && b.card.lens.up) || 0) - ((a.card && a.card.lens && a.card.lens.up) || 0) || (b.op || 0) - (a.op || 0); });
    var s = STAGES[st - 1];
    var head = '<div class="bar"><h2>' + esc(s.lab) + '</h2><span class="count num">' + rows.length + '곳</span><p class="hint">' + HINT[st] + "</p></div>";
    if (!rows.length) return head + '<div class="empty-stage"><h3>' + EMPTY[st][0] + "</h3><p>" + EMPTY[st][1] + "</p></div>";
    return head + '<div class="deck">' + rows.map(function (o) { return cardDeep(o, st); }).join("") + "</div>";
  }

  /* ---------- 기업 상세(서랍) ---------- */
  var drawer = document.getElementById("drawer"), dbody = document.getElementById("drawer-body");
  function openCo(c) {
    var o = S.cos[c];
    if (!o) { closeDrawer(); return; }
    var hist = (o.tg && o.tg.hist) || [];
    var at = {}; hist.forEach(function (h) { if (h.ev === "카드") at[h.stage] = h.date; });
    var track = STAGES.map(function (s) {
      var cls = s.n < o.stage ? "done" : s.n === o.stage ? "cur" : "";
      var when = s.n === 1 ? md(o.d) + " 발표" : at[s.n] ? at[s.n].slice(5, 10).replace("-", "/") + " 진입" : "—";
      return '<div class="s' + s.n + " " + cls + '"><b>' + esc(s.lab) + "</b>" + esc(when) + "</div>";
    }).join("");
    var tabs = [];
    if (o.stage >= 2) tabs.push(["r2", "2단계 리서치"]);
    if (o.stage >= 3) tabs.push(["r3", "3단계 리포트"]);
    if (o.card) tabs.push(["tg", "텔레 카드"]);
    tabs.push(["num", "숫자"]);
    dbody.innerHTML = '<div class="d-head"><h2 id="d-title">' + esc(o.n) + ' <span class="mute code-s">' + esc(o.c) + "</span></h2>" +
      '<div class="sub">' + [o.en, o.cat, md(o.d) + " 발표" + (o.p ? " · " + o.p : "")].filter(Boolean).map(esc).join(" · ") +
      ' · <a href="https://kabutan.jp/stock/?code=' + encodeURIComponent(o.c) + '" target="_blank" rel="noopener">카부탄</a></div></div>' +
      '<div class="track">' + track + "</div>" +
      '<div class="tabs" role="tablist">' + tabs.map(function (t, i) { return '<button role="tab" data-tab="' + t[0] + '"' + (i === 0 ? ' class="on"' : "") + ">" + t[1] + "</button>"; }).join("") + "</div>" +
      '<div id="tabbody"></div>';
    drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    showTab(o, tabs[0][0]);
    dbody.querySelectorAll("[data-tab]").forEach(function (b) {
      b.onclick = function () {
        dbody.querySelectorAll("[data-tab]").forEach(function (x) { x.classList.toggle("on", x === b); });
        showTab(o, b.dataset.tab);
      };
    });
  }
  function showTab(o, t) {
    var box = document.getElementById("tabbody");
    if (t === "r2" || t === "r3") {
      var st = t === "r2" ? 2 : 3, r = o.res[String(st)];
      if (!r || r.status !== "완료") {
        box.innerHTML = '<div class="panel wait"><span class="dot"></span><div><b>' + st + "단계 리서치 " + esc((r && r.status) || "대기") + "</b>" +
          '<p class="mute">' + (st === 2 ? "2단계 실적 분석 리서치" : "3단계 딥 리포트") + "가 자동으로 돌아 이곳에 붙습니다." +
          (r && r.queued ? " 대기열 등록 " + esc(r.queued) : "") + "</p></div></div>";
        return;
      }
      box.innerHTML = '<div class="panel"><p class="mute">리서치를 불러오는 중…</p></div>';
      getText("data/jp/" + r.file).then(function (txt) {
        box.innerHTML = '<div class="panel md">' + mdRender(txt) + "</div>" +
          '<p class="mute note">' + esc(r.kind || "") + " · " + esc(r.written || "") + "</p>";
      }).catch(function () { box.innerHTML = '<div class="panel">리서치 파일을 못 불러왔습니다.</div>'; });
      return;
    }
    if (t === "tg") {
      var c = o.card;
      box.innerHTML = '<div class="panel"><h4>' + esc(c.ann) + " 발표 · 텔레 " + esc(c.date) + "</h4><p>" + esc(c.val || "") + "</p></div>" +
        (c.lens ? '<div class="panel">' + lensBlock(c.lens, true) + '<p class="mute note">AI 렌즈는 실제 인물 의견이 아닙니다.</p></div>' : "") +
        (c.sections || []).map(function (s) {
          return '<div class="panel"><h4>' + esc(s.t) + '</h4><div class="lines">' + s.lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") + "</div></div>";
        }).join("");
      return;
    }
    var kv = [["시가총액", mcap(o.mc)], ["PER", o.per != null ? o.per.toFixed(1) + "배" : "—"], ["매출 증가율(전년 같은 분기)", pct(o.rev)],
      ["영업이익 증가율(전년 같은 분기)", pct(o.op)], ["다음 날 주가", pct(o.d1)], ["진척률 차(작년 대비 %p)", o.prog != null ? pct(o.prog) : "—"],
      ["거래량(평소 대비)", o.vr ? o.vr + "배" : "—"], ["실적 평가", o.g ? gradeBadge(o.g) : "—"]];
    box.innerHTML = '<div class="panel md"><div class="tw"><table><tbody>' + kv.map(function (r) { return "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>"; }).join("") + "</tbody></table></div></div>";
  }
  function closeDrawer() {
    drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); document.body.style.overflow = "";
  }
  drawer.addEventListener("click", function (e) {
    if (e.target.hasAttribute("data-close")) { closeDrawer(); if (/\/c\//.test(location.hash)) history.back(); }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && drawer.classList.contains("open")) { closeDrawer(); if (/\/c\//.test(location.hash)) history.back(); } });

  /* ---------- 아주 작은 마크다운 ---------- */
  function inline(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  function mdRender(src) {
    var L = src.replace(/\r/g, "").split("\n"), out = [], i = 0;
    while (i < L.length) {
      var l = L[i];
      if (!l.trim()) { i++; continue; }
      var h = /^(#{1,3})\s+(.*)$/.exec(l);
      if (h) { out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"); i++; continue; }
      if (/^---+\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
      if (/^\|/.test(l)) {
        var rows = [];
        while (i < L.length && /^\|/.test(L[i])) { rows.push(L[i]); i++; }
        var cells = function (r) { return r.replace(/^\||\|$/g, "").split("|").map(function (x) { return x.trim(); }); };
        var hd = cells(rows[0]), body = rows.slice(/^\|[\s:|-]+\|$/.test(rows[1] || "") ? 2 : 1);
        out.push('<div class="tw"><table><thead><tr>' + hd.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          body.map(function (r) { return "<tr>" + cells(r).map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>");
        continue;
      }
      if (/^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l)) {
        var ol = /^\s*\d+\./.test(l), items = [];
        while (i < L.length && (ol ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(L[i])) { items.push(L[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, "")); i++; }
        out.push((ol ? "<ol>" : "<ul>") + items.map(function (x) { return "<li>" + inline(x) + "</li>"; }).join("") + (ol ? "</ol>" : "</ul>"));
        continue;
      }
      var para = [];
      while (i < L.length && L[i].trim() && !/^(#|\||---|\s*[-*]\s|\s*\d+\.\s)/.test(L[i])) { para.push(L[i]); i++; }
      out.push("<p>" + inline(para.join(" ")) + "</p>");
    }
    return out.join("");
  }

  /* ---------- 화면 ---------- */
  function soon(name) {
    return '<div class="soon"><h2>' + name + " 준비 중</h2><p>일본 탭과 같은 1~4단계 흐름으로 만들 예정입니다.</p></div>";
  }
  function route() {
    var h = (location.hash || "#jp").slice(1).split("/");
    var m = h[0] || "jp";
    document.querySelectorAll(".market a").forEach(function (a) { a.classList.toggle("on", a.dataset.m === m); });
    if (m === "us") { closeDrawer(); app.innerHTML = soon("미국"); return; }
    if (m === "kr") { closeDrawer(); app.innerHTML = soon("한국"); return; }
    if (!S.s1) return;
    if (h[1] === "c") {
      var o = S.cos[h[2]];
      if (!app.dataset.st) render(o ? Math.max(1, o.stage) : 1);
      openCo(h[2]);
      return;
    }
    closeDrawer();
    render(Math.min(4, Math.max(1, +h[1] || 1)));
  }
  function render(st) {
    app.dataset.st = st;
    app.innerHTML = flow(st) + '<section id="view">' + (st === 1 ? stage1() : stageN(st)) + "</section>";
    bindView(st);
  }
  function rerenderList() {
    var view = document.getElementById("view");
    view.innerHTML = stage1(); bindView(1);
    var q = document.getElementById("q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length);
  }
  function bindView(st) {
    app.querySelectorAll("[data-c]").forEach(function (el) {
      var go = function () { location.hash = "jp/c/" + el.dataset.c; };
      el.onclick = go;
      el.onkeydown = function (e) { if (e.key === "Enter") go(); };
    });
    if (st !== 1) return;
    var q = document.getElementById("q");
    q.oninput = function () { S.q = q.value; rerenderList(); };
    document.getElementById("sort").onchange = function (e) { S.sort = e.target.value; rerenderList(); };
    app.querySelectorAll("[data-f]").forEach(function (b) { b.onclick = function () { S.f = b.dataset.f; rerenderList(); }; });
  }

  window.addEventListener("hashchange", route);
  route();
  Promise.all([
    getJSON("data/jp/stage1.json"),
    getJSON("data/jp/pipeline.json").catch(function () { return { companies: {} }; }),
    getJSON("data/jp/research/index.json").catch(function () { return { items: {} }; })
  ]).then(function (r) {
    S.s1 = r[0]; S.pipe = r[1]; S.res = r[2];
    S.cos = build(r[0], r[1], r[2]);
    S.list = Object.keys(S.cos).map(function (c) { return S.cos[c]; });
    document.getElementById("updated").textContent = "실적 " + (r[0].updated || "") + " · 텔레 " + (r[1].updated || "—") + " 갱신";
    route();
  }).catch(function (e) {
    app.innerHTML = '<div class="empty">데이터를 못 불러왔습니다. (' + esc(e.message) + ")</div>";
  });
})();
