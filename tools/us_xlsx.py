# -*- coding: utf-8 -*-
"""미국 상장사 표준 재무제표 엑셀(docs/data/us/xlsx/<티커>.xlsx) — SEC XBRL companyfacts 로 40개 분기 + 10개년.

  자료  https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json (10-Q·10-K 에 실린 us-gaap 값)
  분기  3개월 값이 있으면 그대로, 없으면 같은 회계연도 누계끼리 빼서(4Q = 연간 − 9개월, 현금흐름 2·3분기도 누계 차감) — 출처 시트에 표시
  추가  10-K 가 아직 없는 최신 분기는 extra(실적 보도자료 숫자)로 덧붙인다
  단위  백만 달러(EPS 는 달러, 주식수는 백만 주)

  python tools/us_xlsx.py DHI LEN           (CIK·추가 분기는 아래 COS 에)
"""
import json
import os
import sys
import urllib.request
from datetime import date

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as CL

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "us", "xlsx")
CACHE = os.path.join(ROOT, "tools", "sec_cache")
UA = "earnings-screener research script"

COS = {
    "DHI": {"cik": "0000882184", "name": "D.R. 호튼", "fye": 9,
            "extra": {"2026-09-30": {"rev": 9371.3, "pretax": 1014.6, "ni": 741.8,
                                      "_src": "FY26 4Q 실적 보도자료(8-K EX-99.1, 2026-10-29) — 10-K 제출 전"}}},
    "LEN": {"cik": "0000920760", "name": "레나", "fye": 11, "extra": {}},
    "Z": {"cik": "0001617640", "name": "질로우", "fye": 12, "extra": {}},
    "GDYN": {"cik": "0001743725", "name": "그리드다이나믹스", "fye": 12, "extra": {}},
}

# (키, 한국어 항목, 태그 후보, 종류: d=기간·i=시점, 굵게)
ITEMS = [
    ("PL", None, None, None, None),
    ("rev", "매출", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"], "d", True),
    ("cogs", "매출원가", ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfRealEstateRevenue", "HomeBuildingCosts"], "d", False),
    ("gp", "매출총이익", ["GrossProfit"], "d", False),
    ("sga", "판매관리비(일반관리비)", ["SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"], "d", False),
    ("mkt", "마케팅비", ["SellingAndMarketingExpense", "MarketingAndAdvertisingExpense"], "d", False),
    ("rnd", "기술·개발비", ["ResearchAndDevelopmentExpense"], "d", False),
    ("costs", "총비용(원가+판관비 등)", ["CostsAndExpenses"], "d", False),
    ("op", "영업이익", ["OperatingIncomeLoss"], "d", True),
    ("pretax", "세전이익", ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
                         "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
                         "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"], "d", True),
    ("tax", "법인세", ["IncomeTaxExpenseBenefit"], "d", False),
    ("ni", "순이익(지배)", ["NetIncomeLoss"], "d", True),
    ("eps", "희석 EPS(달러)", ["EarningsPerShareDiluted"], "d", False),
    ("shs", "희석 주식수(백만 주)", ["WeightedAverageNumberOfDilutedSharesOutstanding"], "d", False),
    ("BS", None, None, None, None),
    ("cash", "현금성자산", ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], "i", False),
    ("inv", "재고자산(주택·택지)", ["InventoryRealEstate", "RealEstateInventory", "InventoryNet", "InventoryRealEstateLandAndLandDevelopmentCosts"], "i", False),
    ("assets", "총자산", ["Assets"], "i", True),
    ("liab", "총부채", ["Liabilities"], "i", False),
    ("debt", "차입금(장부)", ["NotesPayable", "LongTermDebt", "SeniorNotes", "DebtInstrumentCarryingAmount"], "i", False),
    ("equity", "자본(지배)", ["StockholdersEquity"], "i", True),
    ("CF", None, None, None, None),
    ("ocf", "영업현금흐름", ["NetCashProvidedByUsedInOperatingActivities"], "c", True),
    ("capex", "설비투자", ["PaymentsToAcquirePropertyPlantAndEquipment"], "c", False),
    ("buyback", "자사주 매입", ["PaymentsForRepurchaseOfCommonStock"], "c", False),
    ("div", "배당 지급", ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"], "c", False),
]
SEC_TITLE = {"PL": "손익계산서", "BS": "재무상태표(분기 말)", "CF": "현금흐름표"}


def facts(cik):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, f"CIK{cik}.json")
    if not os.path.exists(p) or (date.today() - date.fromtimestamp(os.path.getmtime(p))).days >= 1:
        req = urllib.request.Request(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", headers={"User-Agent": UA})
        open(p, "wb").write(urllib.request.urlopen(req, timeout=60).read())
    return json.load(open(p, encoding="utf-8"))["facts"].get("us-gaap", {})


def d(s):
    return date.fromisoformat(s)


def series(G, tags, unit):
    """태그 후보를 차례로 합쳐 {(start,end): val} — 같은 기간은 가장 늦게 제출된 값. 앞 태그 우선."""
    out, used = {}, {}
    for t in tags:
        u = G.get(t, {}).get("units", {})
        rows = u.get(unit) or u.get("USD/shares") or u.get("shares") or []
        for r in sorted(rows, key=lambda r: r.get("filed", "")):
            if r.get("form") not in ("10-Q", "10-K", "10-Q/A", "10-K/A"):
                continue
            k = (r.get("start"), r["end"])
            if k in out and used[k] != t:
                continue
            out[k], used[k] = r["val"], t
    return out, used


def qends(G):
    ni, _ = series(G, ["NetIncomeLoss"], "USD")
    ends = sorted({e for (s, e) in ni if s and 80 <= (d(e) - d(s)).days <= 100})
    fy = sorted({e for (s, e) in ni if s and 350 <= (d(e) - d(s)).days <= 380})
    return sorted(set(ends) | set(fy))


def quarter_val(S, end, kind):
    if kind == "i":
        return S.get((None, end)), "공시"
    best = [(s, v) for (s, e), v in S.items() if s and e == end]
    for s, v in best:
        if 80 <= (d(end) - d(s)).days <= 100:
            return v, "공시"
    # 누계 차감: 같은 시작일의 더 짧은 누계(직전 분기 말까지)
    for s, v in sorted(best, key=lambda x: x[0]):
        span = (d(end) - d(s)).days
        if span < 150:
            continue
        prev = [(e2, v2) for (s2, e2), v2 in S.items() if s2 == s and e2 < end and 80 <= (d(end) - d(e2)).days <= 100]
        if prev:
            return v - prev[0][1], "누계 차감(계산)"
    return None, ""


def annual_val(S, end, kind):
    if kind == "i":
        return S.get((None, end))
    for (s, e), v in S.items():
        if s and e == end and 350 <= (d(e) - d(s)).days <= 380:
            return v
    return None


def qlabel(end, fye):
    e = d(end)
    fy = e.year + (1 if e.month > fye else 0)
    q = ((e.month - fye - 1) % 12) // 3 + 1
    return f"FY{str(fy)[2:]} {q}Q", f"{str(e.year)[2:]}.{e.month}말"


def build(tk):
    co = COS[tk]
    G = facts(co["cik"])
    ends = [e for e in qends(G) if True]
    for e in co["extra"]:
        if e not in ends:
            ends.append(e)
    ends = sorted(ends)[-40:]
    data, how, tagused = {}, {}, {}
    for key, ko, tags, kind, _ in ITEMS:
        if not tags:
            continue
        unit = "USD/shares" if key == "eps" else ("shares" if key == "shs" else "USD")
        S, used = series(G, tags, unit)
        tagused[key] = sorted(set(used.values()))
        for e in ends:
            v, h = quarter_val(S, e, "i" if kind == "i" else "d")
            ex = co["extra"].get(e, {})
            if v is None and key in ex:
                v, h = ex[key] * 1e6, ex["_src"]
            if key == "eps" and h.startswith("누계"):
                v, h = None, ""    # EPS 는 누계 차감이 맞지 않아 비움
            data[(key, e)], how[(key, e)] = v, h
        data[("_S", key)] = (S, kind)
    for e in ends:   # 매출총이익 공시가 없으면 매출 − 매출원가(계산)
        if data.get(("gp", e)) is None and data.get(("rev", e)) is not None and data.get(("cogs", e)) is not None:
            data[("gp", e)], how[("gp", e)] = data[("rev", e)] - data[("cogs", e)], "누계 차감(계산) — 매출 − 매출원가"
    # 연간 10개년
    ni, _ = series(G, ["NetIncomeLoss"], "USD")
    fys = sorted({e for (s, e) in ni if s and 350 <= (d(e) - d(s)).days <= 380})[-10:]

    wb = openpyxl.Workbook()
    H = PatternFill("solid", fgColor="1F3A5F"); HF = Font(color="FFFFFF", bold=True)
    SEC = PatternFill("solid", fgColor="E8EEF6"); B = Font(bold=True); thin = Side(style="thin", color="D0D7E2")

    def sheet(ws, cols, getv, title, collab):
        ws.sheet_view.showGridLines = False
        ws["A1"] = f"{co['name']} ({tk}) — {title}"; ws["A1"].font = Font(bold=True, size=13)
        ws["A2"] = "단위: 백만 달러(EPS 달러, 주식수 백만 주) · 자료: SEC XBRL(10-Q·10-K) · 회색 글씨 = 누계 차감 계산값, 주황 = 보도자료 값"
        ws["A2"].font = Font(size=9, color="666666")
        r = 4
        ws.cell(r, 1, "항목").fill = H; ws.cell(r, 1).font = HF
        for j, c in enumerate(cols):
            a, b = collab(c)
            x = ws.cell(r, 2 + j, a); x.fill = H; x.font = HF; x.alignment = Alignment(horizontal="center")
            y = ws.cell(r + 1, 2 + j, b); y.font = Font(size=8, color="666666"); y.alignment = Alignment(horizontal="center")
        r += 2
        for key, ko, tags, kind, bold in ITEMS:
            if not tags:
                ws.cell(r, 1, SEC_TITLE[key]).font = B
                for j in range(len(cols) + 1):
                    ws.cell(r, 1 + j).fill = SEC
                r += 1
                continue
            ws.cell(r, 1, ko).font = Font(bold=bold)
            for j, c in enumerate(cols):
                v, h = getv(key, c)
                if v is None:
                    continue
                val = v if key == "eps" else v / 1e6
                x = ws.cell(r, 2 + j, round(val, 2 if key == "eps" else 1))
                x.number_format = "0.00" if key == "eps" else "#,##0.0"
                x.border = Border(bottom=thin)
                if h.startswith("누계"):
                    x.font = Font(color="808080", bold=bold)
                elif h and h != "공시":
                    x.font = Font(color="C0651A", bold=bold)
                elif bold:
                    x.font = B
            r += 1
            if key in ("rev", "pretax", "ni"):   # YoY·마진 줄
                ws.cell(r, 1, "  YoY(%)" if key != "pretax" else "  세전이익률(%)").font = Font(size=9, color="666666")
                for j, c in enumerate(cols):
                    v, _ = getv(key, c)
                    if key == "pretax":
                        rv, _ = getv("rev", c)
                        val = v / rv * 100 if v is not None and rv else None
                    else:
                        k0 = j - (4 if len(cols) > 12 else 1)
                        p0 = getv(key, cols[k0])[0] if k0 >= 0 else None
                        val = (v / p0 - 1) * 100 if v is not None and p0 and p0 > 0 else None
                    if val is not None:
                        x = ws.cell(r, 2 + j, round(val, 1)); x.number_format = "0.0"; x.font = Font(size=9, color="666666")
                r += 1
        ws.column_dimensions["A"].width = 24
        for j in range(len(cols)):
            ws.column_dimensions[CL(2 + j)].width = 10.5
        ws.freeze_panes = "B6"

    ws = wb.active; ws.title = "분기 재무(40)"
    sheet(ws, ends, lambda k, e: (data.get((k, e)), how.get((k, e), "")), f"분기 재무제표 {len(ends)}개 분기", lambda e: qlabel(e, co["fye"]))

    def av(k, e):
        S, kind = data[("_S", k)]
        v = annual_val(S, e, kind)
        return v, "공시" if v is not None else ""
    ws2 = wb.create_sheet("연간(10년)")
    sheet(ws2, fys, av, f"연간 재무제표 {len(fys)}개년", lambda e: (f"FY{e[:4]}", f"~{e[2:4]}.{int(e[5:7])}말"))

    ws3 = wb.create_sheet("출처")
    ws3.sheet_view.showGridLines = False
    rows = [["자료", f"SEC EDGAR companyfacts — https://data.sec.gov/api/xbrl/companyfacts/CIK{co['cik']}.json"],
            ["받은 날", date.today().isoformat()],
            ["분기 값", "10-Q 의 3개월 값을 그대로. 3개월 값이 없는 분기(대개 회계 4분기)와 현금흐름 2·3·4분기는 같은 회계연도 누계끼리 뺀 계산값(회색). 누계 차감 EPS 는 비움"],
            ["재무상태표", "분기 말 시점 값(10-Q·10-K)"],
            ["빈 칸", "SEC 표준 원장(us-gaap)에 없는 항목은 비움 — 회사 고유 태그로 공시하는 항목(예: 레나의 주택 판매 원가·재고자산·차입금)과 홈빌더가 따로 내지 않는 영업이익. 매출총이익은 매출 − 매출원가로 계산(회색)"]]
    for e, ex in co["extra"].items():
        rows.append([f"보도자료 값 {e}", ex["_src"] + " — 매출·세전이익·순이익만(주황)"])
    rows.append(["", ""]); rows.append(["항목", "쓴 XBRL 태그(앞에 있는 것이 우선)"])
    for key, ko, tags, kind, _ in ITEMS:
        if tags:
            rows.append([ko, ", ".join(tagused.get(key, [])) or "공시 없음"])
    for i, (a, b) in enumerate(rows, 1):
        ws3.cell(i, 1, a).font = B if a else Font()
        ws3.cell(i, 2, b)
    ws3.column_dimensions["A"].width = 22; ws3.column_dimensions["B"].width = 120

    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, tk + ".xlsx")
    wb.save(out)
    have = sum(1 for e in ends if data.get(("rev", e)) is not None)
    print(f"{tk}: {out} · 분기 {len(ends)}개({qlabel(ends[0], co['fye'])[0]}~{qlabel(ends[-1], co['fye'])[0]}, 매출 있는 분기 {have}) · 연간 {len(fys)}개")


def add_button(src, tk):
    if 'id="es-xlsx"' in src:
        return src
    import re
    btn = ('<style>#es-xlsx-bar{position:relative;z-index:5;text-align:right;padding:12px 16px 0}'
           '#es-xlsx{display:inline-block;padding:8px 14px;border-radius:999px;background:#1d6f42;color:#fff;'
           'font:600 13px/1 system-ui,"Malgun Gothic",sans-serif;text-decoration:none}'
           '#es-xlsx:hover{background:#155a35}@media print{#es-xlsx-bar{display:none}}</style>'
           f'<div id="es-xlsx-bar"><a id="es-xlsx" href="../../../data/us/xlsx/{tk}.xlsx" download="{tk}.xlsx">xlsx 다운로드</a></div>')
    return re.sub(r"(<body[^>]*>)", lambda m: m.group(1) + btn, src, count=1, flags=re.I)


if __name__ == "__main__":
    for t in sys.argv[1:]:
        build(t.upper())
