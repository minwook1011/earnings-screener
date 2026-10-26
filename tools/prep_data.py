# -*- coding: utf-8 -*-
"""2단계 보고서용 공통 자료를 AI 없이 미리 모은다(토큰 0). 2026-10-26 사용자 — '자료 수집 파이썬화' 시험.

python tools/prep_data.py <코드> <작업 폴더>
→ <작업 폴더>/<코드>_prep.json
  분기 12·연간 10(결산단신 XBRL, build_xlsx 재사용) · 부문 · 재무상태표·현금흐름 요약 · 회사 예상(최근 결산단신 요약)
  · 결산단신 발표일과 다음 날 주가 반응 · 주간 주가 5년 · 환율. 단위 억 엔(소수 1자리), 주가 엔.
컨센·경쟁사·설명회 발췌·유가증권보고서·웹은 여기 없다 — 보고서 에이전트가 도구로 받는다.
"""
import json
import os
import re
import sys
import zipfile
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_xlsx as bx  # noqa: E402

KST = timezone(timedelta(hours=9))
CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{s}?range={r}&interval={i}"


def oku(v):
    return None if v is None else round(v / 1e8, 1)


def series(blk, keys):
    return {k: [oku(v) for v in blk[k]] for k in keys if k in blk}


def chart(sym, rng, itv):
    raw = bx.get(CHART.format(s=sym, r=rng, i=itv))
    if not raw:
        return []
    try:
        r = json.loads(raw)["chart"]["result"][0]
        ts, cl = r["timestamp"], r["indicators"]["quote"][0]["close"]
    except (KeyError, IndexError, TypeError, ValueError):
        return []
    return [(datetime.fromtimestamp(t, KST).date().isoformat(), round(c, 1)) for t, c in zip(ts, cl) if c is not None]


def forecast(path):
    """최근 결산단신 요약 XBRL 의 회사 예상(연간). 값은 엔 → 억 엔, EPS 는 엔."""
    want = {"NetSales": "매출", "OperatingIncome": "영업이익", "OrdinaryIncome": "경상이익",
            "ProfitAttributableToOwnersOfParent": "순이익", "NetIncomePerShare": "EPS",
            "SalesIFRS": "매출", "RevenueIFRS": "매출", "OperatingIncomeIFRS": "영업이익", "OperatingProfitIFRS": "영업이익",
            "ProfitAttributableToOwnersOfParentIFRS": "순이익", "BasicEarningsPerShareIFRS": "EPS"}
    out = {}
    try:
        z = zipfile.ZipFile(path)
        for n in z.namelist():
            if "Summary" not in n or not n.endswith("ixbrl.htm"):
                continue
            s = z.read(n).decode("utf-8", "ignore")
            for m in re.finditer(r"<ix:nonFraction([^>]*)>([^<]*)</ix:nonFraction>", s):
                at, txt = m.group(1), m.group(2)
                nm = re.search(r'name="[^":]+:([^"]+)"', at)
                cx = re.search(r'contextRef="([^"]+)"', at)
                if not nm or not cx or "Forecast" not in cx.group(1) or "Year" not in cx.group(1):
                    continue
                key = want.get(nm.group(1))
                if not key or not txt.strip() or key in out:
                    continue
                try:
                    v = float(txt.replace(",", ""))
                except ValueError:
                    continue
                sc = re.search(r'scale="(-?\d+)"', at)
                v *= 10 ** int(sc.group(1)) if sc else 1
                if 'sign="-"' in at:
                    v = -v
                out[key] = round(v, 1) if key == "EPS" else oku(v)
    except (OSError, zipfile.BadZipFile):
        pass
    return out


def reactions(daily, dates):
    """결산단신 발표일 → 다음 거래일 종가 등락(발표가 장 마감 뒤라고 보고 발표일 종가 대비)."""
    if not daily:
        return []
    days = [d for d, _ in daily]
    px = dict(daily)
    out = []
    for d in dates:
        before = [x for x in days if x <= d]
        after = [x for x in days if x > d]
        if before and after:
            a, b = px[before[-1]], px[after[0]]
            out.append({"발표일": d, "기준일": before[-1], "다음날": after[0], "등락%": round((b / a - 1) * 100, 1)})
    return out


def main(code, folder):
    os.makedirs(folder, exist_ok=True)
    data, used, fsm = bx.collect(code)
    res = {"code": code, "made": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "unit": "억 엔(주가·EPS 는 엔)",
           "note": "prep_data.py 가 AI 없이 만든 자료. 분기 = 누계 차분(계산). 숫자는 결산단신 XBRL 그대로 — 다시 조회하지 않는다."}
    if used:
        KO, miss = bx.ko_dict(), set()
        mk = bx.make_model(code, code, data, used, fsm, KO, miss)
        if mk:
            model = mk[0]
            keys = ["revenue", "gp", "sga", "op", "pbt", "ni_owner"]
            res["fiscal_note"] = model["meta"]["fiscal_note"]
            res["quarterly"] = {"labels": model["quarterly"]["labels"], **series(model["quarterly"], keys)}
            res["annual"] = {"labels": model["annual"]["labels"], **series(model["annual"], keys)}
            res["segments"] = [{"name": s["name"], "annual": [oku(v) for v in s["annual"]],
                                "quarterly": [oku(v) for v in s["quarterly"]]} for s in model["segments"]]
            bs = model["bs"]["annual"]
            res["bs_annual"] = {"labels": bs["labels"], **{k: [oku(v) for v in bs[k]] for k in bs if k != "labels"}}
            cf = model["cf"]["annual"]
            res["cf_annual"] = {"labels": cf["labels"], **{k: [oku(v) for v in cf[k]] for k in cf if k != "labels"}}
            if model.get("market_data"):
                res["shares"] = model["market_data"]["shares"]
        else:
            res["gap"] = "매출 줄을 못 찾음(은행·증권 등) — 실적은 도구로 받는다"
        res["filings"] = [{"date": f["date"], "title": f["title"], "doc": f["doc"]} for f in used]
        res["company_forecast"] = forecast(bx.zip_of(code, used[0]["doc"]))
        res["company_forecast_src"] = used[0]["date"] + " 결산단신 요약"
    else:
        res["gap"] = "결산단신 XBRL 없음"
    daily = chart(code + ".T", "2y", "1d")
    res["reactions"] = reactions(daily, [f["date"] for f in used[:8]])[::-1] if used else []
    wk = chart(code + ".T", "5y", "1wk")
    res["price_weekly"] = wk
    if daily:
        res["price_last"] = {"date": daily[-1][0], "close": daily[-1][1]}
        if res.get("shares"):
            res["mcap_oku"] = round(daily[-1][1] * res["shares"] / 1e8, 1)
    fx = chart("JPYKRW=X", "5d", "1d")
    if fx:
        res["fx_jpykrw"] = {"date": fx[-1][0], "rate": round(fx[-1][1], 3)}
    out = os.path.join(folder, f"{code}_prep.json")
    json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{code} 자료 → {out} (분기 {len(res.get('quarterly', {}).get('labels', []))} · 연간 {len(res.get('annual', {}).get('labels', []))}"
          f" · 부문 {len(res.get('segments', []))} · 결산단신 {len(res.get('filings', []))} · 주간 주가 {len(wk)} · 회사 예상 {len(res.get('company_forecast', {}))}칸)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("python tools/prep_data.py <코드> <작업 폴더>")
    main(sys.argv[1], sys.argv[2])
