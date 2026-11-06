# -*- coding: utf-8 -*-
"""미국 전체 종목 표 + 미국 실적 캘린더 — 2026-11-06 사용자
  종목  100억 사이트(vantage-0910) 「글로벌 메가캡 · 미국」 전 종목(data/ta/us.json)
        + 「미국 실적」 기업 전부(data/us/earnings_dates.json — S&P500·AI 관련·데이터 허브 명단)
        C:\\dev\\vantage-0910 이 없으면 깃허브 원본을 읽는다. 100억 쪽에 종목이 늘면 다음 회차에 저절로 들어온다.
  주가  야후 일봉 1년(전 종목 같은 날 기준으로 다시 계산). 1일·5일·1개월(21거래일)·3·6·12개월·52주 고점 대비·
        거래량 배수(오늘 ÷ 50일 평균)·RS(3·6·9·12개월 가중 수익률 백분위, 1~99)·6개월 추이
  시총  억달러. 100억 표에 있는 종목 = 100억 시총 × (지금 가격 ÷ 100억 가격). 없는 종목 = 나스닥 요약 시총(주식 수를 tools/us_shares.json 에 7일 보관)
  일정  100억 earnings_dates(나스닥·야후 교차) 의 다음·지난 발표일 + 직전 cal.json 의 지난 날짜를 이어받음(지우지 않음)
        지난 발표는 '발표 후 주가'(장 전 = 그날, 장 후·미정 = 다음 거래일 종가 등락)와 EPS 서프라이즈(100억 earnings_calendar.json)
  결과  docs/data/us/all.json   {updated, as_of, idx:{n,v,c}, count, stocks:[...]}
        docs/data/us/cal.json   {updated, n_universe, days:{"YYYY-MM-DD":[{t,n,en,sec,mc,tm,fq,eps,est,rx,rxd,sp}]}}  하루 안은 시총 큰 순
  python tools/build_us.py
"""
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "us")
SHARES = os.path.join(ROOT, "tools", "us_shares.json")
NAMES = os.path.join(ROOT, "tools", "us_names_ko.json")
KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
VANTAGE = [os.environ.get("VANTAGE_DIR", ""), r"C:\dev\vantage-0910", os.path.join(os.path.expanduser("~"), "repos", "vantage-0910")]
RAWGH = "https://raw.githubusercontent.com/minwook1011/vantage-0910/main/"
SEC_KO = {"Information Technology": "정보기술", "Financials": "금융", "Industrials": "산업재", "Health Care": "헬스케어",
          "Consumer Discretionary": "경기소비재", "Consumer Staples": "필수소비재", "Utilities": "유틸리티", "Energy": "에너지",
          "Materials": "소재", "Communication Services": "커뮤니케이션", "Real Estate": "부동산",
          "Technology": "정보기술", "Finance": "금융", "Consumer Discretionary ": "경기소비재", "Basic Materials": "소재",
          "Telecommunications": "커뮤니케이션"}


def get(url, timeout=25, tries=3):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read().decode("utf-8", "replace")
        except Exception:
            time.sleep(1.5 * (i + 1))
    return ""


def vjson(rel):
    for v in VANTAGE:
        p = os.path.join(v, rel)
        if v and os.path.exists(p):
            return json.load(open(p, encoding="utf-8"))
    t = get(RAWGH + rel.replace("\\", "/"), timeout=60)
    return json.loads(t) if t else {}


def load(p, d):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return d


def ysym(t):
    return t.replace(".", "-")


def chart(t, rng="1y"):
    """[(날짜, 종가, 거래량)] — 미 동부 날짜"""
    j = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym(t)}?range={rng}&interval=1d", timeout=20)
    try:
        r = json.loads(j)["chart"]["result"][0]
        off = r["meta"].get("gmtoffset", -18000)
        q = r["indicators"]["quote"][0]
        out, n = [], len(r["timestamp"])
        for k, (ts, c, v) in enumerate(zip(r["timestamp"], q["close"], q["volume"])):
            if c is None and k == n - 1:   # 마지막 날 종가가 비어 오는 일이 있음 → 메타의 정규장 가격
                c, v = r["meta"].get("regularMarketPrice"), r["meta"].get("regularMarketVolume")
            if c is None:
                continue
            out.append((datetime.fromtimestamp(ts + off, timezone.utc).strftime("%Y-%m-%d"), c, v or 0))
        return out
    except Exception:
        return []


def nasdaq_mcap(t):
    j = get(f"https://api.nasdaq.com/api/quote/{t}/summary?assetclass=stocks", timeout=20, tries=2)
    try:
        s = json.loads(j)["data"]["summaryData"]
        mc = float(re.sub(r"[^\d.]", "", s["MarketCap"]["value"]))
        sec = (s.get("Sector") or {}).get("value")
        return mc, sec
    except Exception:
        return None, None


def ret(b, n):
    if len(b) <= n:
        return None
    a = b[-1 - n][1]
    return round((b[-1][1] / a - 1) * 100, 2) if a else None


def metrics(b):
    if len(b) < 2:
        return None
    c = [x[1] for x in b]
    v = [x[2] for x in b]
    av = sum(v[-51:-1]) / max(1, len(v[-51:-1]))
    hi = max(c[-252:])
    return {"date": b[-1][0], "price": round(c[-1], 2), "chg1d": ret(b, 1), "chg5d": ret(b, 5), "chg1m": ret(b, 21),
            "r3": ret(b, 63), "r6": ret(b, 126), "r9": ret(b, 189), "r12": ret(b, min(252, len(b) - 1)) if len(b) > 200 else None,
            "from_hi": round((c[-1] / hi - 1) * 100, 1) if hi else None, "vr": round(v[-1] / av, 2) if av else None,
            "c": [round(x, 2) for x in c[-126:]]}


def reaction(b, d, tm):
    """발표 후 주가 — 장 전 = 그날 종가/전날, 장 후·미정 = 다음 거래일 종가/그날(그날이 휴장이면 그 뒤 첫 날)"""
    ds = [x[0] for x in b]
    i = next((k for k, x in enumerate(ds) if x >= d), None)
    if i is None:
        return None, None
    if tm != "pre" and ds[i] == d:
        i += 1
    if i <= 0 or i >= len(b):
        return None, None
    return round((b[i][1] / b[i - 1][1] - 1) * 100, 2), ds[i]


def surprise(hist, d):
    best = None
    for h in hist or []:
        q = h.get("quarter_end") or ""
        if q and q < d and (datetime.strptime(d, "%Y-%m-%d") - datetime.strptime(q, "%Y-%m-%d")).days <= 100 and h.get("eps_surprise_pct") is not None:
            best = h
    return None if not best else {"sp": best["eps_surprise_pct"], "ea": best.get("eps_actual"), "ee": round(best["eps_estimate"], 2) if best.get("eps_estimate") is not None else None}


def main():
    ta = vjson(r"docs\data\ta\us.json")
    ed = vjson(r"docs\data\us\earnings_dates.json")
    ec = vjson(r"docs\earnings_calendar.json").get("calendar", {})
    T = {s["tk"]: s for s in ta.get("stocks", [])}
    D = ed.get("dates", {})
    if not T or not D:
        sys.exit("100억 자료를 못 읽음 — 아무것도 안 바꿈")
    ko = load(NAMES, {})
    univ = list(T) + [t for t in D if t not in T]

    with ThreadPoolExecutor(8) as ex:
        bars = dict(zip(univ, ex.map(chart, univ)))
    idx = chart("^GSPC", "5d")

    sh = load(SHARES, {})
    now = datetime.now(KST)
    need = [t for t in univ if t not in T and bars.get(t) and (t not in sh or sh[t].get("at", "") < (now - timedelta(days=7)).strftime("%Y-%m-%d"))]
    with ThreadPoolExecutor(4) as ex:
        for t, (mc, sec) in zip(need, ex.map(nasdaq_mcap, need)):
            if mc:
                sh[t] = {"n": mc / bars[t][-1][1], "sec": sec, "at": now.strftime("%Y-%m-%d")}
    json.dump(sh, open(SHARES, "w", encoding="utf-8"), ensure_ascii=False, indent=0)

    rows = []
    for t in univ:
        m = metrics(bars.get(t) or [])
        s, e = T.get(t), D.get(t, {})
        if not m:
            continue
        if s:
            mc = s["mcap"] * 10 * m["price"] / s["price"] if s.get("price") else (s.get("mcap") or 0) * 10   # 100억 ta 는 10억달러 → 억달러
            nm, en, sec, about, per = s.get("name"), s.get("en"), s.get("sector"), s.get("about"), s.get("per")
            if not re.search("[가-힣]", nm or "") and ko.get(t):   # 100억 이름이 영문이면 한국어 사전
                nm = ko[t]
        else:
            mc = sh[t]["n"] * m["price"] / 1e8 if t in sh else e.get("mcap")
            nm, en = ko.get(t) or e.get("name") or t, e.get("name") or t
            if re.search("[가-힣]", en):
                en = None
            sec = SEC_KO.get(e.get("sector") or "") or SEC_KO.get((sh.get(t) or {}).get("sec") or "") or "기타"
            about, per = None, None
        nx = e.get("next") or {}
        rows.append(dict(tk=t, name=nm, en=en, sector=sec, mcap=round(mc, 1) if mc else None, about=about, per=per,
                         ai=e.get("ai"), nx=nx.get("date"), nxt=nx.get("time"), **m))
    # RS — 3·6·9·12개월 가중(40·20·20·20) 백분위
    sc = []
    for r in rows:
        p = [r.get(k) for k in ("r3", "r6", "r9", "r12")]
        if p[0] is not None:
            w = [0.4, 0.2, 0.2, 0.2]
            sc.append((sum((x if x is not None else p[0]) * k for x, k in zip(p, w)), r))
    sc.sort(key=lambda x: x[0])
    for i, (_, r) in enumerate(sc):
        r["rs"] = max(1, min(99, round((i + 1) / len(sc) * 99)))
    for r in rows:
        r.pop("r9", None)
    rows.sort(key=lambda r: -(r["mcap"] or 0))
    asof = max((r["date"] for r in rows), default="")
    iv = {}
    if len(idx) >= 2:
        iv = {"n": "S&P 500", "v": round(idx[-1][1], 2), "c": round((idx[-1][1] / idx[-2][1] - 1) * 100, 2)}
    os.makedirs(OUT, exist_ok=True)
    json.dump({"updated": now.strftime("%Y-%m-%d %H:%M"), "as_of": asof, "idx": iv, "count": len(rows), "src_ta": ta.get("generated_at"),
               "stocks": rows}, open(os.path.join(OUT, "all.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    # ── 실적 캘린더 ──
    R = {r["tk"]: r for r in rows}
    old = load(os.path.join(OUT, "cal.json"), {}).get("days", {})
    days = {}

    def put(d, t, ev, src_est=False):
        if not d:
            return
        r = R.get(t) or {}
        o = {"t": t, "n": r.get("name") or ko.get(t) or (D.get(t) or {}).get("name") or t, "en": r.get("en"),
             "sec": r.get("sector") or SEC_KO.get((D.get(t) or {}).get("sector") or ""),
             "mc": r.get("mcap") or (D.get(t) or {}).get("mcap"), "tm": ev.get("time") or "na", "fq": ev.get("fq"), "eps": ev.get("eps_fc"),
             "est": bool(src_est)}
        lst = days.setdefault(d, [])
        lst[:] = [x for x in lst if x["t"] != t] + [o]

    for d, lst in old.items():           # 지난 날짜는 이어받음
        for o in lst:
            days.setdefault(d, []).append(dict(o))
    today = now.strftime("%Y-%m-%d")
    for t, e in D.items():
        ls, nx = e.get("last") or {}, e.get("next") or {}
        if ls.get("date"):
            put(ls["date"], t, ls)
        if nx.get("date"):
            # 다음 발표일이 바뀌면 옛 예정일(아직 안 지난 날)에서 뺌
            for d in list(days):
                if d >= today and d != nx["date"]:
                    days[d] = [x for x in days[d] if x["t"] != t]
            put(nx["date"], t, nx, nx.get("src") == "yahoo" and not (e.get("yahoo") or {}).get("confirmed"))
    lo = (now - timedelta(days=70)).strftime("%Y-%m-%d")
    hi = (now + timedelta(days=130)).strftime("%Y-%m-%d")
    days = {d: v for d, v in days.items() if lo <= d <= hi and v}
    for d, lst in days.items():
        for o in lst:
            if d <= today and bars.get(o["t"]):
                rx, rxd = reaction(bars[o["t"]], d, o["tm"])
                if rx is not None:
                    o["rx"], o["rxd"] = rx, rxd
                s = surprise((ec.get(o["t"]) or {}).get("eps_history"), d)
                if s:
                    o.update(s)
            r = R.get(o["t"])
            if r:
                o["n"], o["en"], o["sec"] = r["name"], r.get("en"), r.get("sector") or o.get("sec")
            elif ko.get(o["t"]):
                o["n"] = ko[o["t"]]
            if r and r.get("mcap"):
                o["mc"] = r["mcap"]
        lst.sort(key=lambda o: -(o.get("mc") or 0))
    json.dump({"updated": now.strftime("%Y-%m-%d %H:%M"), "src": ed.get("updated"), "n_universe": len(univ), "days": dict(sorted(days.items()))},
              open(os.path.join(OUT, "cal.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"미국 전체 {len(rows)}종목(기준 {asof}) · 캘린더 {len(days)}일 {sum(len(v) for v in days.values())}건")


if __name__ == "__main__":
    main()
