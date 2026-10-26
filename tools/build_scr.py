# -*- coding: utf-8 -*-
"""스크리닝 보기 숫자 — 2단계 이상 회사 전부(누적) → docs/data/jp/scr.json.

  100억 사이트 일본 스크리너와 같은 칸(2026-10-26 사용자): 시총·매출(TTM)·매출성장(TTM YoY)·1년·YTD·PER·ROE·영업이익률(TTM)·실적발표일.
  매출·이익 = tools/qhist/jp.json(분기 단독, 백만엔) 최근 4개 분기 합. 주가 = docs/data/jp/co/<코드>.json 일봉 1년.
  ROE = 최근 4개 분기 순이익 ÷ 최근 분기말 자기자본(결산단신 XBRL, build_xlsx 와 같은 자료). 분기가 바뀔 때만 다시 계산.

  python tools/build_scr.py
"""
import json
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JP = os.path.join(ROOT, "docs", "data", "jp")
OUT = os.path.join(JP, "scr.json")


def rd(p, d=None):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return d


def roe_equity(code):
    """최근 분기말 자기자본(백만엔). 못 구하면 None."""
    import build_xlsx as bx
    data, used, fsm = bx.collect(code)
    if not used:
        return None
    BS = data["BS"]
    own = bx.pick(BS, ["EquityAttributableToOwnersOfParentIFRS"], "inst")
    if own:
        return own[max(own)] / 1e6
    te, nci = bx.pick(BS, bx.BSMAP["total_equity"], "inst"), bx.pick(BS, bx.BSMAP["nci"], "inst")
    if not te:
        return None
    k = max(te)
    sub = bx.pick(BS, ["SubscriptionRightsToShares"], "inst")
    return (te[k] - (nci.get(k) or 0) - (sub.get(k) or 0)) / 1e6


def main():
    pipe = rd(os.path.join(JP, "pipeline.json"), {}).get("companies", {})
    s1 = {r["c"]: r for r in rd(os.path.join(JP, "stage1.json"), {}).get("rows", [])}
    qh = rd(os.path.join(ROOT, "tools", "qhist", "jp.json"), {})
    old = rd(OUT, {}).get("items", {})
    today = date.today()
    out = {}
    for c, t in pipe.items():
        if t.get("stage", 1) < 2:
            continue
        r, card = s1.get(c, {}), t["cards"].get(str(t["stage"])) or t["cards"].get("2") or {}
        o = {"mc": r.get("mc", card.get("mc")), "per": r.get("per", card.get("per")), "cat": r.get("cat")}
        q = qh.get(c) or []
        if len(q) >= 4:
            rev, op, ni = (sum(x[i] for x in q[:4]) for i in (1, 2, 3))
            o.update(q=q[0][0], rev=round(rev / 100, 1), opm=round(op / rev * 100, 1) if rev else None)
            if len(q) >= 8:
                pr = sum(x[1] for x in q[4:8])
                o["revg"] = round((rev / pr - 1) * 100, 1) if pr > 0 else None
            if o["per"] is None and o["mc"] and ni > 0:
                o["per"] = round(o["mc"] * 100 / ni, 1)
            prev = old.get(c, {})
            eq = prev.get("eq") if prev.get("q") == o["q"] else None
            if eq is None:
                try:
                    eq = roe_equity(c)
                except Exception as e:
                    print(" ", c, "자기자본 실패", e)
            if eq:
                o["eq"] = round(eq)
                o["roe"] = round(ni / eq * 100, 1)
        px = (rd(os.path.join(JP, "co", c + ".json"), {}) or {}).get("px") or []
        if len(px) > 20:
            last = px[-1][1]
            o["px"] = last
            o["py"] = round((last / px[0][1] - 1) * 100, 1)
            jan1 = (date(today.year, 1, 1) - date(1970, 1, 1)).days
            base = [p for p in px if p[0] < jan1]
            o["ytd"] = round((last / base[-1][1] - 1) * 100, 1) if base else None
        out[c] = {k: v for k, v in o.items() if v is not None}
    json.dump({"updated": today.isoformat(), "items": out}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("스크리닝", len(out), "곳")


if __name__ == "__main__":
    main()
