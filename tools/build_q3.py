# -*- coding: utf-8 -*-
"""「3Q26 일본 스크리닝」 판 자료 — 2026-11-17 사용자. 2단계 리포트를 쓴 회사 전부를 한 표에.

  결과  docs/data/jp/px/q3.json
        {"updated", "cq": "3Q26", "items": {코드: {n, d, p, cq, per, s, op, r, o, ot, m, opm, opm0, h:[[분기, 매출YoY, 영업이익YoY, 글자]…], mc, pe, sp:[0~100 …], c3, c1}}}
  분기  qhist(단독 분기, 백만엔)의 가장 최근 분기. cq = 그 분기가 끝난 달의 달력 분기(7~9월 끝 = 3Q26).
        qhist 에 없으면 stage1(카부탄 결산 요약)의 매출·영업이익 YoY 만.
  주가  px/<코드>.json(5년 일봉)에서 최근 3년 · 10거래일 간격 종가 → 0~100 으로 눌러 작게(카드가 아닌 표 안 작은 차트용).
  build_px.py 가 끝날 때 부른다(매일 10:00·15:30, px 폴더째 푸시). 따로: python tools/build_q3.py
"""
import html
import json
import os
import re
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = os.path.join(ROOT, "docs", "data", "jp")
QH = os.path.join(ROOT, "tools", "qhist", "jp.json")
EVT = os.path.join(ROOT, "tools", "qhist", "events.json")
OUT = os.path.join(J, "px", "q3.json")
KST = timezone(timedelta(hours=9))
TARGET = "3Q26"


def load(p, d=None):
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return d


def qkey(p):
    m = re.match(r"(\d{4})/(\d{1,2}) (\d)Q", p)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def end_month(k):
    """회계연도 끝 (Y, M), 분기 q → 그 분기가 끝난 (연, 월)."""
    y, m, q = k
    i = y * 12 + (m - 1) - (4 - q) * 3
    return i // 12, i % 12 + 1


def cal_q(k):
    y, m = end_month(k)
    return f"{(m - 1) // 3 + 1}Q{y % 100:02d}"


def period(k):
    y, m = end_month(k)
    i = y * 12 + (m - 1) - 2
    return f"{(i // 12) % 100:02d}.{i % 12 + 1:02d}-{m:02d}"


def yoy(a, b):
    if a is None or b is None:
        return None, None
    if b <= 0:
        return None, ("흑전" if a > 0 else "적지")
    if a < 0:
        return None, "적전"
    return round((a / b - 1) * 100, 1), None


def quarters(rows, evt):
    """qhist 한 회사 → 분기별 {k, s, op, r, o, ot, m} (오래된 것부터)."""
    by = {}
    for r in rows:
        k = qkey(r[0])
        if k:
            by[k] = r
    out = []
    for k in sorted(by):
        r = by[k]
        prev = by.get((k[0] - 1, k[1], k[2]))
        rv, _ = yoy(r[1], prev[1] if prev else None)
        ov, ot = yoy(r[2], prev[2] if prev else None)
        out.append({"k": k, "s": r[1], "op": r[2], "r": rv, "o": ov, "ot": ot,
                    "opm0": round(prev[2] / prev[1] * 100, 1) if prev and prev[1] else None,
                    "m": evt.get(f"{k[0] % 100:02d}.{k[2]}Q")})
    return out


def spark(code):
    px = load(os.path.join(J, "px", f"{code}.json"))
    if not px:
        return None
    last = datetime.strptime(px[-1][0], "%Y-%m-%d").date()
    since = (last - timedelta(days=365 * 3)).isoformat()
    rows = [r for r in px if r[0] >= since and r[4]]
    if len(rows) < 20:
        return None
    pick = rows[::10]
    if pick[-1] is not rows[-1]:
        pick.append(rows[-1])
    v = [r[4] for r in pick]
    lo, hi = min(v), max(v)
    k = (hi - lo) or 1
    y1 = (last - timedelta(days=365)).isoformat()
    base1 = next((r[4] for r in rows if r[0] >= y1), None)
    return {"sp": [round((x - lo) / k * 100) for x in v], "c3": round((v[-1] / v[0] - 1) * 100, 1),
            "c1": round((v[-1] / base1 - 1) * 100, 1) if base1 else None, "px": v[-1], "pd": rows[-1][0], "p0": pick[0][0]}


def main():
    res = (load(os.path.join(J, "research", "index.json"), {}) or {}).get("items", {})
    qh = load(QH, {}) or {}
    ev = load(EVT, {}) or {}
    st = {x["c"]: x for x in (load(os.path.join(J, "stage1.json"), {}) or {}).get("rows", [])}
    scr = (load(os.path.join(J, "scr.json"), {}) or {}).get("items", {})
    pipe = (load(os.path.join(J, "pipeline.json"), {}) or {}).get("companies", {})
    items = {}
    for c, r in res.items():
        r2 = (r or {}).get("2") or {}
        if r2.get("status") != "완료" or not r2.get("html"):
            continue
        s1 = st.get(c, {})
        nm = s1.get("n") or (pipe.get(c) or {}).get("n") or re.sub(r"\s*(2단계\s*)?(기업분석|실적 분석|리포트).*$", "", r2.get("title", "")) or c
        o = {"n": html.unescape(nm), "d": r2.get("ann") or s1.get("d") or (r2.get("written") or "")[:10], "w": (r2.get("written") or "")[:10]}
        qs = quarters(qh.get(c) or [], {e.get("at"): e.get("note") for e in (ev.get(c) or []) if isinstance(e, dict)}) if isinstance(qh.get(c), list) else []
        if qs:
            q = qs[-1]
            o.update({"p": f"{q['k'][0] % 100:02d}.{q['k'][2]}Q", "cq": cal_q(q["k"]), "per": period(q["k"]),
                      "s": round(q["s"] / 100, 1), "op": round(q["op"] / 100, 1), "r": q["r"], "o": q["o"], "ot": q["ot"],
                      "opm": round(q["op"] / q["s"] * 100, 1) if q["s"] else None, "opm0": q["opm0"]})
            if q.get("m"):
                o["m"] = q["m"]
            o["h"] = [[cal_q(x["k"]), x["r"], x["o"], x["ot"]] for x in qs[-5:-1]]
        elif s1.get("rev") is not None or s1.get("op") is not None:
            o.update({"p": (s1.get("fy", "")[2:4] + "." + s1.get("p", "")) if s1.get("fy") else s1.get("p"), "r": s1.get("rev"), "o": s1.get("op"), "src": "kabutan"})
        x = scr.get(c, {})
        o["mc"] = x.get("mc") if x.get("mc") is not None else s1.get("mc")
        o["pe"] = x.get("per") if x.get("per") is not None else s1.get("per")
        o["cat"] = x.get("cat") or s1.get("cat")
        sp = spark(c)
        if sp:
            o.update(sp)
        items[c] = {k: v for k, v in o.items() if v is not None}
    out = {"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "cq": TARGET, "items": items}
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    n3 = sum(1 for v in items.values() if v.get("cq") == TARGET)
    print(f"3Q26 판 {len(items)}곳 (그중 {TARGET} 분기 {n3} · 분기 자료 없음 {sum(1 for v in items.values() if 'r' not in v and 'o' not in v)} · 3년 주가 없음 {sum(1 for v in items.values() if 'sp' not in v)})")


if __name__ == "__main__":
    main()
