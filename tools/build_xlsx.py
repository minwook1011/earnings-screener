# -*- coding: utf-8 -*-
"""회사별 표준 재무제표 엑셀(docs/data/jp/xlsx/<코드>.xlsx) — 토큰 없이 파이썬만으로.

  자료  결산단신 XBRL(TDnet → 거래소 보관소 www2.jpx.co.jp/disc). 목록은 yanoshin TDnet API.
        첨부 재무제표(손익·포괄손익·재무상태표·현금흐름표·부문)의 **항목 전부**를 싣는다.
  양식  테크윙 재무모델 양식(맑은 고딕, 회색 머리줄, 회색 띠 구분줄, 비율 줄은 회색 글씨 수식).
  한국어 항목명은 tools/jp_labels_ko.json(일본어 → 한국어). 없는 말은 tools/jp_labels_missing.json 에 모이고
        엑셀에는 영어 요소명이 임시로 들어간다 → 사전에 채운 뒤 다시 돌리면 된다.
  섹터 자료  리서치 폴더의 <코드>_data.json(2단계 보고서 만들 때 모은 월차·수주·수출입 등)과 사이트 월차를
        '섹터 데이터' 시트에 표로 싣고, 출처는 맨 오른쪽 칸.

  python tools/build_xlsx.py 6954 [6999 …]      만들기(결산단신 zip 은 tools/xbrl_cache 에 보관)
"""
import glob
import json
import os
import re
import sys
import time
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as CL

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", "xbrl_cache")
LABELS = os.path.join(ROOT, "tools", "jp_labels_ko.json")
MISSING = os.path.join(ROOT, "tools", "jp_labels_missing.json")
OUT = os.path.join(ROOT, "docs", "data", "jp", "xlsx")
PIPE = os.path.join(ROOT, "docs", "data", "jp", "pipeline.json")
MONTHLY = os.path.join(ROOT, "docs", "data", "jp", "monthly")
RESEARCH = os.path.join(os.path.dirname(ROOT), "리서치", "2단계")
KST = timezone(timedelta(hours=9))
LIST = "https://webapi.yanoshin.jp/webapi/tdnet/list/{code}.json?limit=300"
ZIPS = ["https://www.release.tdnet.info/inbs/0812{rest}.zip", "https://www2.jpx.co.jp/disc/{code}0/0812{rest}.zip"]
PDF = "https://www2.jpx.co.jp/disc/{code}0/{doc}.pdf"
NQ = 20      # 분기 칸 최대
NF = 30      # 결산단신 최대 수(약 7년)
STMTS = [("PL", "손익계산서"), ("CI", "포괄손익"), ("BS", "재무상태표"), ("CF", "현금흐름표"), ("SG", "부문")]
KIND = {"bs": "BS", "pl": "PL", "pc": "PL", "ci": "CI", "cf": "CF", "sg": "SG"}


# ---------- 받기 ----------
def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            return urllib.request.urlopen(req, timeout=30).read()
        except Exception:
            if i == tries - 1:
                return None
            time.sleep(2)


def filings(code):
    raw = get(LIST.format(code=code))
    if not raw:
        sys.exit("결산단신 목록을 못 받았습니다")
    out = []
    for it in json.loads(raw).get("items", []):
        t = it.get("Tdnet", it) if isinstance(it, dict) else {}
        title = t.get("title", "")
        if "決算短信" not in title or "訂正" in title or not t.get("url_xbrl"):
            continue
        m = re.search(r"(\d{18})\.pdf", t.get("document_url", ""))
        if m:
            out.append({"doc": m.group(1), "date": t.get("pubdate", "")[:10], "title": title})
    return out[:NF]


def zip_of(code, doc):
    p = os.path.join(CACHE, code, doc + ".zip")
    if os.path.exists(p):
        if zipfile.is_zipfile(p):
            return p
        os.remove(p)   # 받다 끊긴 파일
    for u in ZIPS:
        b = get(u.format(code=code, rest=doc[4:]))
        if b and b[:2] == b"PK":
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p + ".part", "wb").write(b)
            os.replace(p + ".part", p)
            return p
    return None


# ---------- 읽기 ----------
class IX(HTMLParser):
    """인라인 XBRL 한 장 — 문맥(기간·멤버)과 표의 행(이름표 + 숫자들)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ctx, self.rows = {}, []
        self.cur = self.field = self.row = self.cell = self.fact = None
        self.buf = ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "xbrli:context":
            self.cur = {"start": None, "end": None, "inst": None, "mem": [], "id": a.get("id")}
        elif self.cur is not None and tag in ("xbrli:startdate", "xbrli:enddate", "xbrli:instant", "xbrldi:explicitmember"):
            self.field, self.buf = tag, ""
        elif tag == "tr":
            self.row = {"cells": [], "facts": []}
        elif tag in ("td", "th") and self.row is not None:
            self.cell = ""
        elif tag == "ix:nonfraction":
            self.fact = {"name": a.get("name", ""), "ctx": a.get("contextref", ""), "scale": int(a.get("scale") or 0),
                         "sign": a.get("sign"), "fmt": a.get("format", ""), "txt": ""}

    def handle_endtag(self, tag):
        if self.field == tag:
            k = {"xbrli:startdate": "start", "xbrli:enddate": "end", "xbrli:instant": "inst"}.get(tag)
            if k:
                self.cur[k] = self.buf.strip()
            else:
                self.cur["mem"].append(self.buf.strip())
            self.field = None
        elif tag == "xbrli:context" and self.cur:
            self.ctx[self.cur["id"]] = self.cur
            self.cur = None
        elif tag == "ix:nonfraction" and self.fact is not None:
            f = self.fact
            t = f["txt"].strip()
            if "zero" in f["fmt"] or t in ("", "－", "-", "―", "—", "‐"):
                v = 0.0
            else:
                try:
                    v = float(re.sub(r"[^\d.]", "", t)) * 10 ** f["scale"]
                except ValueError:
                    v = None
            if v is not None and f["sign"] == "-":
                v = -v
            f["v"] = v
            if self.row is not None:
                self.row["facts"].append(f)
            self.fact = None
        elif tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.row["cells"].append(self.cell)
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.row["facts"]:
                self.rows.append(self.row)
            self.row = None

    def handle_data(self, d):
        if self.field:
            self.buf += d
        if self.fact is not None:
            self.fact["txt"] += d
        elif self.cell is not None:
            self.cell += d


def clean(s):
    return re.sub(r"\s+", "", (s or "").replace("　", " ")).strip()


def labels_of(z):
    """회사 고유 요소·부문 멤버의 일본어 이름(lab.xml)."""
    out = {}
    for n in z.namelist():
        if n.endswith("-lab.xml"):
            s = z.read(n).decode("utf-8", "ignore")
            locs = dict((m[1], m[0].split("#")[-1]) for m in re.findall(r'<link:loc[^>]*xlink:href="([^"]+)"[^>]*xlink:label="([^"]+)"', s))
            arcs = dict(re.findall(r'<link:labelArc[^>]*xlink:from="([^"]+)"[^>]*xlink:to="([^"]+)"', s))
            labs = {}
            for lab, txt in re.findall(r'<link:label[^>]*xlink:label="([^"]+)"[^>]*xml:lang="ja"[^>]*>([^<]*)<', s):
                labs.setdefault(lab, txt)
            for frm, to in arcs.items():
                if frm in locs and to in labs:
                    out[locs[frm]] = labs[to]
    return out


def months(a, b):
    return (b.year - a.year) * 12 + b.month - a.month + (1 if b.day >= 28 else 0)


def plabel(end, fsm):
    off = (end.month - fsm) % 12
    q = off // 3 + 1
    fy_start = end.year if end.month >= fsm else end.year - 1
    fy_end = fy_start + (1 if fsm != 1 else 0)
    return fy_end, q


def parse_filing(path):
    z = zipfile.ZipFile(path)
    jlab = labels_of(z)
    out, parts, ctx = [], [], {}
    for n in z.namelist():    # 문맥(기간·멤버)은 한 파일에만 정의돼 있기도 해서 먼저 다 모은다
        m = re.search(r"/\d{7}-[a-z]{2}(bs|pl|pc|ci|cf|sg)\d+-.*-ixbrl\.htm$", n)
        if not m:
            continue
        p = IX()
        p.feed(z.read(n).decode("utf-8", "ignore"))
        ctx.update(p.ctx)
        parts.append((m, p))
    fsm = next((int(c["start"][5:7]) for c in ctx.values() if c["start"] and c["end"]
                and months(date.fromisoformat(c["start"]), date.fromisoformat(c["end"])) >= 3), None)
    for m, p in parts:
        for order, row in enumerate(p.rows):
            lab = next((clean(x) for x in row["cells"] if clean(x) and not re.fullmatch(r"[\d,.\-△▲()（）%－―]+", clean(x))), "")
            for f in row["facts"]:
                c = ctx.get(f["ctx"])
                if not c or f["v"] is None:
                    continue
                out.append({"stmt": KIND[m.group(1)], "name": f["name"], "lab": lab, "order": order, "c": c,
                            "v": f["v"], "fsm": fsm, "mem": [x for x in c["mem"] if not x.endswith("NonConsolidatedMember")]})   # 개별만 내는 회사
    return out, jlab


# ---------- 모으기 ----------
def collect(code):
    fl = filings(code)
    data = {k: {"rows": [], "seen": {}, "ytd": {}, "inst": {}} for k, _ in STMTS}
    jlab_all, used, fsm0 = {}, [], None
    for f in fl:                                  # 새것부터 — 먼저 들어간 값이 우선
        path = zip_of(code, f["doc"])
        if not path:
            continue
        facts, jlab = parse_filing(path)
        if not facts:
            continue
        used.append(f)
        jlab_all.update(jlab)
        prev = {k: None for k, _ in STMTS}
        for x in facts:
            st, c = x["stmt"], x["c"]
            if st != "SG" and x["mem"]:
                continue                          # 단체·기타 축은 뺌(연결만)
            key = x["name"] + ("|" + "|".join(x["mem"]) if x["mem"] else "")
            D = data[st]
            if key not in D["seen"]:
                lab = x["lab"]
                if x["mem"]:
                    mem = x["mem"][-1].split(":")[-1]
                    lab = (jlab.get(mem) or jlab_all.get(mem) or mem) + " · " + x["lab"]
                pos = D["rows"].index(prev[st]) + 1 if prev[st] in D["rows"] else len(D["rows"])
                D["rows"].insert(pos, key)
                D["seen"][key] = {"lab": lab, "name": x["name"], "mem": x["mem"]}
            prev[st] = key
            if c["inst"]:
                if not x["fsm"] and not fsm0:
                    continue
                e = date.fromisoformat(c["inst"])
                D["inst"].setdefault(key, {}).setdefault(plabel(e, x["fsm"] or fsm0), x["v"])
            elif c["start"] and c["end"]:
                s, e = date.fromisoformat(c["start"]), date.fromisoformat(c["end"])
                fsm0 = fsm0 or s.month
                q = round(months(s, e) / 3)
                if 1 <= q <= 4:
                    fy, _ = plabel(e, s.month)
                    D["ytd"].setdefault(key, {}).setdefault((fy, q), x["v"])
    return data, used, fsm0


def quarters(data):
    ks = set()
    for st in ("PL", "BS", "CF", "SG", "CI"):
        for d in list(data[st]["ytd"].values()) + list(data[st]["inst"].values()):
            ks |= set(d)
    ks = sorted(ks)
    return ks[-NQ:]


def standalone(ytd, fy, q):
    a = ytd.get((fy, q))
    if a is None:
        return None
    if q == 1:
        return a
    b = ytd.get((fy, q - 1))
    return None if b is None else a - b


# ---------- 한국어 ----------
def ko_dict():
    try:
        return json.load(open(LABELS, encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def eng(name):
    n = name.split(":")[-1]
    n = re.sub(r"(IFRS|Summary|CY|NC)$", "", n)
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", n)


def ko(jp, name, KO, miss):
    parts = [p for p in jp.split(" · ")]
    out = []
    for p in parts:
        if not p:
            continue
        alt = [p] + [re.sub(r"四半期|中間|当期", w, p) for w in ("中間", "当期", "")] + [re.sub(r"（[^）]*△[^）]*）$", "", p)]
        hit = next((KO[a] for a in alt if a in KO), None)
        if hit:
            out.append(hit)
        elif re.search(r"[぀-ヿ一-鿿]", p):
            miss.add(p)
            out.append(eng(name) if p == parts[-1] else p.encode("ascii", "ignore").decode() or "부문")
        else:
            out.append(p)
    return " · ".join(out) or eng(name)


# ---------- 엑셀(테크윙 양식) ----------
F = "맑은 고딕"
GRAY = PatternFill("solid", fgColor="FFD9D9D9")
BAND = PatternFill("solid", fgColor="FF808080")
THIN = Side(style="thin", color="FFBFBFBF")
NUM = '#,##0.0;\\(#,##0.0\\);"-"'
PCT = '0.0%;\\-0.0%;"-"'
CEN = Alignment(horizontal="center", vertical="center")
LEFT = Alignment(horizontal="left", vertical="center")


def sheet_head(ws, title, unit, note, cols, src):
    ws.sheet_view.showGridLines = False
    ws["A1"] = title
    ws["A1"].font = Font(name=F, size=20, bold=True)
    ws["A2"] = note
    ws["A2"].font = Font(name=F, size=9, color="FFFF0000")
    ws["B2"] = unit
    ws["B2"].font = Font(name=F, size=9, color="FF808080")
    head = ["항목", "참고"] + cols + ["출처"]
    for i, h in enumerate(head, 1):
        c = ws.cell(3, i, h)
        c.font = Font(name=F, size=10, bold=True)
        c.fill = GRAY
        c.alignment = CEN
        c.border = Border(top=THIN, bottom=THIN)
    ws.column_dimensions["A"].width = 34
    ws.column_dimensions["B"].width = 12
    for i in range(len(cols)):
        ws.column_dimensions[CL(3 + i)].width = 11
    ws.column_dimensions[CL(3 + len(cols))].width = 40
    c = ws.cell(4, 3 + len(cols), src)
    c.font = Font(name=F, size=9, color="FF808080")
    c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.freeze_panes = "C4"


def band(ws, r, text, ncol):
    for i in range(1, ncol + 1):
        c = ws.cell(r, i, text if i == 1 else None)
        c.font = Font(name=F, size=11, bold=True, color="FFFFFFFF")
        c.fill = BAND
        c.alignment = CEN


def val_row(ws, r, label, ref, vals, bold=False):
    c = ws.cell(r, 1, label)
    c.font = Font(name=F, size=11, bold=bold)
    c.alignment = LEFT
    if ref:
        b = ws.cell(r, 2, ref)
        b.font = Font(name=F, size=9, color="FF808080")
        b.alignment = CEN
    for i, v in enumerate(vals):
        if v is None:
            continue
        c = ws.cell(r, 3 + i, round(v, 4))
        c.font = Font(name=F, size=11, bold=bold)
        c.number_format = NUM
        c.alignment = CEN


def ratio_row(ws, r, label, f):
    """f(col_letter, i) → 수식(없으면 None). 회색 글씨 % 줄(테크윙 YoY·OPM 줄)."""
    c = ws.cell(r, 1, label)
    c.font = Font(name=F, size=11, color="FF808080")
    c.alignment = LEFT
    return c


KEYS = {  # 손익 핵심 줄 아래 비율 줄
    "Sales": [("YoY", "yoy")], "Revenue": [("YoY", "yoy")],
    "GrossProfit": [("매출총이익률", "m")], "OperatingIncome": [("영업이익률", "m"), ("YoY", "yoy")],
    "OperatingProfit": [("영업이익률", "m"), ("YoY", "yoy")], "OrdinaryIncome": [("경상이익률", "m")],
    "ProfitLossAttributableToOwnersOfParent": [("순이익률", "m"), ("YoY", "yoy")],
    "ProfitAttributableToOwnersOfParent": [("순이익률", "m"), ("YoY", "yoy")],
}


def keyof(name):
    n = name.split(":")[-1]
    for k in KEYS:
        if n == k or n == k + "IFRS" or (k in ("Sales", "Revenue") and n in ("NetSales", "NetSalesIFRS", "RevenueIFRS", "OperatingRevenue1", "Revenues")):
            return k
    return None


def write_stmt(ws, st, D, cols, KO, miss, mode, sales_row=None):
    """mode: q = 분기 단독(손익·포괄), cf = 누계 그대로, bs = 시점."""
    r = 4
    nq = len(cols["q"])
    first = None
    for key in D["rows"]:
        meta = D["seen"][key]
        lab = ko(meta["lab"], meta["name"], KO, miss)
        if mode == "bs":
            src = D["inst"].get(key, {})
            vals = [src.get(k) for k in cols["q"]] + [src.get((fy, 4)) for fy in cols["y"]]
        else:
            src = D["ytd"].get(key, {})
            if mode == "q":
                vals = [standalone(src, fy, q) for fy, q in cols["q"]]
            else:
                vals = [src.get(k) for k in cols["q"]]
            vals += [src.get((fy, 4)) for fy in cols["y"]]
        if not any(v is not None for v in vals):
            continue
        per_share = "PerShare" in meta["name"]
        vals = [None if v is None else (v if per_share else v / 1e8) for v in vals]
        bold = bool(re.search(r"(Total|GrossProfit|OperatingIncome|OperatingProfit|OrdinaryIncome|ProfitLoss|Sales$|Revenue)", meta["name"].split(":")[-1])) and not meta["mem"]
        val_row(ws, r, lab, "엔/주" if per_share else ("근사" if per_share and mode == "q" else None), vals, bold)
        if per_share:
            for i in range(len(vals)):
                ws.cell(r, 3 + i).number_format = '#,##0.00;\\(#,##0.00\\);"-"'
        k = keyof(meta["name"]) if st == "PL" and not meta["mem"] else None
        row_v = r
        r += 1
        if k in ("Sales", "Revenue") and first is None:
            first = row_v
        for txt, how in KEYS.get(k, []) if k else []:
            ratio_row(ws, r, txt, None)
            for i in range(len(vals)):
                col, cl = 3 + i, CL(3 + i)
                if how == "yoy":
                    j = col - 4 if i < nq else col - 1
                    if (i < nq and i < 4) or (i >= nq and i == nq):
                        continue
                    a, b = f"{cl}{row_v}", f"{CL(j)}{row_v}"
                    fm = f'=IF(OR({a}="",{b}=""),"",IFERROR({a}/{b}-1,""))'
                else:
                    if not first:
                        continue
                    a, b = f"{cl}{row_v}", f"{cl}{first}"
                    fm = f'=IF(OR({a}="",{b}=""),"",IFERROR({a}/{b},""))'
                c = ws.cell(r, col, fm)
                c.font = Font(name=F, size=11, color="FF808080")
                c.number_format = PCT
                c.alignment = CEN
            r += 1
    return r


def table_block(ws, r, title, header, rows, src, width):
    """섹터 자료 표 하나 — 회색 띠 제목, 머리줄, 행들, 맨 오른쪽 출처."""
    band(ws, r, title, width)
    r += 1
    for i, h in enumerate(["항목"] + header, 1):
        c = ws.cell(r, i, h)
        c.font = Font(name=F, size=10, bold=True)
        c.fill = GRAY
        c.alignment = CEN
    c = ws.cell(r, width, "출처")
    c.font = Font(name=F, size=10, bold=True)
    c.fill = GRAY
    c.alignment = CEN
    r += 1
    first = True
    for lab, vals in rows:
        ws.cell(r, 1, kt(lab)).font = Font(name=F, size=11)
        for i, v in enumerate(vals):
            c = ws.cell(r, 2 + i, v)
            c.font = Font(name=F, size=11)
            c.alignment = CEN
            if isinstance(v, (int, float)):
                c.number_format = '#,##0.0;\\(#,##0.0\\);"-"' if isinstance(v, float) else "#,##0"
        if first:
            s = ws.cell(r, width, src or "2단계 보고서 자료(회사 설명회 자료·공시)")
            s.font = Font(name=F, size=9, color="FF808080")
            first = False
        r += 1
    return r + 1


KEYW = {"rev": "매출", "revenue": "매출", "sales": "매출", "op": "영업이익", "ni": "순이익", "np": "순이익", "eps": "EPS",
        "n": "애널리스트 수", "n_eps": "EPS 애널리스트 수", "n_rev": "매출 애널리스트 수", "eps_90d_ago": "90일 전 EPS",
        "mean": "평균", "median": "중앙값", "high": "최고", "low": "최저", "target": "목표주가", "consensus": "컨센서스",
        "guidance": "가이던스", "prev": "직전", "h1": "상반기", "h2": "하반기", "orders": "수주", "order": "수주",
        "backlog": "수주잔고", "segments": "부문별", "segment": "부문", "region": "지역별", "share": "비중", "yoy": "YoY",
        "qoq": "QoQ", "bridge": "증감 요인", "total": "합계", "monthly": "월차", "export": "수출", "exports": "수출",
        "import": "수입", "imports": "수입", "trade": "무역", "machine": "공작기계", "tool": "", "price": "가격",
        "margin": "이익률", "opm": "영업이익률", "gpm": "매출총이익률", "units": "수량", "volume": "물량", "cagr": "CAGR",
        "fy": "FY", "actual": "실적", "plan": "계획", "forecast": "예상", "est": "추정", "peers": "비교 기업",
        "valuation": "밸류에이션", "per": "PER", "pbr": "PBR", "roe": "ROE", "mc": "시가총액", "capex": "설비투자",
        "rd": "연구개발비", "da": "감가상각비", "fx": "환율", "usd": "달러", "eur": "유로", "cny": "위안",
        "q1": "1Q", "q2": "2Q", "q3": "3Q", "q4": "4Q", "kpi": "핵심 지표", "stores": "점포", "store": "점포",
        "customers": "고객 수", "ticket": "객단가", "existing": "기존점", "all": "전체", "growth": "성장률", "pct": "%"}


def kt(k):
    """영어 키 → 한국어(모르는 말은 그대로)."""
    k = str(k)
    if k.lower() in KEYW:
        return KEYW[k.lower()]
    if re.fullmatch(r"[A-Za-z0-9_ ·\-]+", k) and ("_" in k or " · " in k):
        out = []
        for part in k.split(" · "):
            toks = [KEYW.get(t.lower(), t) for t in part.split("_")]
            out.append(" ".join(t for t in toks if t))
        return " · ".join(out)
    return k


def is_num_list(v):
    return isinstance(v, list) and v and all(isinstance(x, (int, float)) or x is None for x in v)


def sector_tables(code):
    """리서치 폴더 <코드>_data.json 에서 표 모양 자료를 뽑는다(재무 숫자는 재무제표 시트가 있으니 뺌)."""
    out = []
    files = glob.glob(os.path.join(RESEARCH, code + " *", code + "_data.json"))
    try:
        d = json.load(open(files[0], encoding="utf-8")) if files else None
    except ValueError:
        d = None   # 깨진 자료 파일은 건너뜀
    if isinstance(d, dict):
        skip = {"quarterly", "annual", "price", "company", "code", "fiscal", "unit", "asof"}
        for k, v in d.items():
            if k in skip or not isinstance(v, dict):
                continue
            src = next((str(v[s]) for s in ("src", "source", "출처", "sources") if s in v), "")
            note = str(v.get("note", "")) if isinstance(v.get("note"), str) else ""
            src = " · ".join(x for x in (src, note) if x)
            if isinstance(v.get("labels"), list):
                rows = [(kk, vv) for kk, vv in v.items() if is_num_list(vv)]
                if rows:
                    out.append((k, [str(x) for x in v["labels"]], rows, src))
                continue
            flat = [(kk, vv) for kk, vv in v.items() if isinstance(vv, (int, float))]
            if len(flat) >= 2:
                out.append((k, ["값"], [(kk, [vv]) for kk, vv in flat], src))
            for kk, vv in v.items():
                if isinstance(vv, dict):
                    f2 = [(a, b) for a, b in vv.items() if isinstance(b, (int, float))]
                    if len(f2) >= 2:
                        out.append((k + " · " + kk, ["값"], [(a, [b]) for a, b in f2], src))
        for k, v in d.items():   # 표 모양 리스트([{…}, …])
            if k in skip or not isinstance(v, list) or not v or not all(isinstance(x, dict) for x in v):
                continue
            cols = [c for c in v[0].keys()]
            if len(cols) < 2:
                continue
            out.append((k, cols[1:], [(x.get(cols[0]), [x.get(c) for c in cols[1:]]) for x in v], ""))
    mp = os.path.join(MONTHLY, code + ".json")
    if os.path.exists(mp):
        m = json.load(open(mp, encoding="utf-8"))
        rows = m.get("rows", [])[-24:]
        out.insert(0, ("월차", [r[0] for r in rows], [(c, [r[i + 1] for r in rows]) for i, c in enumerate(m.get("cols", []))],
                       (m.get("src") or "회사 월차 공시") + (" · " + m["note"] if m.get("note") else "")))
    return out


def fy_note(fsm):
    end = (fsm - 2) % 12 + 1
    return f"{end}월 결산"


def build(code):
    data, used, fsm = collect(code)
    if not used:
        print(code, "결산단신 XBRL 없음")
        return None
    KO, miss = ko_dict(), set()
    qs = quarters(data)
    ys = sorted({fy for fy, q in qs if q == 4} | {fy for st in ("PL", "CF") for d in data[st]["ytd"].values() for fy, q in d if q == 4})
    cols = {"q": qs, "y": ys}
    heads = [f"{fy % 100:02d}.{q}Q" for fy, q in qs] + [f"FY{fy % 100:02d}" for fy in ys]
    name = (json.load(open(PIPE, encoding="utf-8"))["companies"].get(code, {}) or {}).get("n", code)
    src = "결산단신 XBRL(거래소 공시, TDnet·JPX 보관소). 쓴 문서: " + ", ".join(
        f"{f['date']}" for f in used[:4]) + (f" 외 {len(used) - 4}건" if len(used) > 4 else "") + " — '출처' 시트에 전부"
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    note = f"결산기 기준(27.2Q = 2027년 결산기 2분기) · {fy_note(fsm or 4)} · 연결"
    for st, title in STMTS:
        D = data[st]
        if not D["rows"]:
            continue
        ws = wb.create_sheet(title)
        mode = {"BS": "bs", "CF": "cf"}.get(st, "q")
        n = {"q": "분기 단독(누계 차분)", "cf": "누계(그 분기까지)", "bs": "분기 말 잔액"}[mode]
        sheet_head(ws, f"{name} {title}", "(단위: 억엔)", f"{note} · {n} · 오른쪽 FY = 연간", heads, src)
        write_stmt(ws, st, D, cols, KO, miss, mode)
    sec = sector_tables(code)
    if sec:
        ws = wb.create_sheet("섹터 데이터")
        ws.sheet_view.showGridLines = False
        ws["A1"] = f"{name} 섹터·사업 데이터"
        ws["A1"].font = Font(name=F, size=20, bold=True)
        ws["A2"] = "2단계 보고서를 만들 때 모은 자료 · 월차 · 출처는 맨 오른쪽"
        ws["A2"].font = Font(name=F, size=9, color="FFFF0000")
        width = max(len(h) for _, h, _, _ in sec) + 2
        ws.column_dimensions["A"].width = 30
        for i in range(2, width):
            ws.column_dimensions[CL(i)].width = 11
        ws.column_dimensions[CL(width)].width = 44
        r = 4
        for t, h, rows, s in sec:
            r = table_block(ws, r, ko(t, t, KO, miss) if re.search(r"[぀-ヿ]", t) else kt(t), [kt(x) for x in h], rows, s, width)
    ws = wb.create_sheet("출처")
    ws.sheet_view.showGridLines = False
    ws["A1"] = "출처 · 쓴 결산단신"
    ws["A1"].font = Font(name=F, size=20, bold=True)
    for i, h in enumerate(["공시일", "문서", "PDF"], 1):
        c = ws.cell(3, i, h)
        c.font = Font(name=F, size=10, bold=True)
        c.fill = GRAY
    for i, f in enumerate(used, 4):
        m = re.search(r"(\d{4})年(\d{1,2})月期", f["title"])
        q = re.search(r"第(\d)四半期", f["title"])
        t = (f"{m.group(1)}년 {int(m.group(2))}월 결산기 " if m else "") + (f"{q.group(1)}분기 결산단신" if q else ("중간 결산단신" if "中間" in f["title"] else "연간 결산단신"))
        ws.cell(i, 1, f["date"])
        ws.cell(i, 2, t)
        ws.cell(i, 3, PDF.format(code=code, doc=f["doc"]))
    for col, w in (("A", 12), ("B", 34), ("C", 60)):
        ws.column_dimensions[col].width = w
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, code + ".xlsx")
    wb.save(out)
    idx_p = os.path.join(OUT, "index.json")
    try:
        idx = json.load(open(idx_p, encoding="utf-8"))
    except (OSError, ValueError):
        idx = {}
    idx[code] = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    json.dump(idx, open(idx_p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if miss:
        try:
            old = json.load(open(MISSING, encoding="utf-8"))
        except (OSError, ValueError):
            old = []
        json.dump(sorted(set(old) | miss), open(MISSING, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{code} 엑셀 → docs/data/jp/xlsx/{code}.xlsx (결산단신 {len(used)}건, 분기 {len(qs)}칸, 섹터 표 {len(sec)}개, 번역 필요 {len(miss)}개)")
    return miss


if __name__ == "__main__":
    for c in sys.argv[1:]:
        try:
            build(c)
        except Exception as e:
            print(c, "엑셀 실패:", e)
