# -*- coding: utf-8 -*-
"""1단계 목록 + 기업별 상세 파일 만들기 — VANTAGE 일본 실적 데이터(로컬)를 읽어 공개용으로 줄여 쓴다.

  원천  VANTAGE docs/data/jp/reports/index.json · reports/<rid>.json · reports/notes/<rid>.json
        VANTAGE docs/data/ta/jp.json (한글 이름·업종·시총·PER) · names-ko.js · px/<코드>.json (일봉)
  결과  docs/data/jp/stage1.json          1단계 표(최근 DAYS일 발표, 회사당 최신 하나)
        docs/data/jp/co/<코드>.json        상세(주가 1년·최근 8분기·발표 결과·요약)
        텔레 카드에만 있는 회사(pipeline.json)는 야후 일봉으로 주가만 채운다.

  실행  python tools/tg_parse.py 다음에  python tools/build_stage1.py [--vantage C:\\dev\\vantage-0910] [--days 45]
"""
import argparse
import json
import os
import re
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "docs", "data", "jp")
KST = timezone(timedelta(hours=9))
PX_DAYS = 260          # 상세 차트: 약 1년치 거래일
QS_N = 8               # 상세 표: 최근 8분기


def load(path):
    return json.load(open(path, encoding="utf-8"))


def dump(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(obj, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


def ko_names(path):
    if not os.path.exists(path):
        return {}
    m = re.search(r"const KO_NAMES = (\{.*?\});", open(path, encoding="utf-8").read(), re.S)
    return {k: v.split(" ")[0] for k, v in json.loads(m.group(1)).items()} if m else {}


def yahoo_px(code):
    """야후 일봉 1년 → [[1970-01-01부터 날수, 종가], …] (VANTAGE px 와 같은 모양)."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{code}.T?range=1y&interval=1d"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        r = json.loads(urllib.request.urlopen(req, timeout=20).read())["chart"]["result"][0]
        out = []
        for t, c in zip(r["timestamp"], r["indicators"]["quote"][0]["close"]):
            if c is not None:
                out.append([int((t + 9 * 3600) // 86400), round(c, 1)])
        return out
    except Exception as e:  # 받지 못하면 차트만 빠진다
        print("  야후 실패", code, e)
        return []


def detail(c, data, rid):
    out = {"c": c}
    pxf = os.path.join(data, "jp", "px", f"{c}.json")
    if os.path.exists(pxf):
        out["px"] = load(pxf).get("b", [])[-PX_DAYS:]
    if rid:
        rf = os.path.join(data, "jp", "reports", f"{rid}.json")
        if os.path.exists(rf):
            r = load(rf)
            out["unit"] = r.get("unit")
            rec = r.get("rec") or {}
            out["rec"] = {k: rec.get(k) for k in ("date", "time", "period", "fy", "kind", "q", "q_yoy", "guide", "next_guide",
                                                    "revision", "beat", "cons", "progress", "px", "fyres") if rec.get(k) is not None}
            out["qs"] = [{k: q.get(k) for k in ("label", "cq", "rev", "op", "ni", "opm", "yoy")} for q in (r.get("qs") or [])[-QS_N:]]
        nf = os.path.join(data, "jp", "reports", "notes", f"{rid}.json")
        if os.path.exists(nf):
            n = load(nf)
            out["note"] = {k: n.get(k) for k in ("headline", "about", "summary_md") if n.get(k)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vantage", default=r"C:\dev\vantage-0910")
    ap.add_argument("--days", type=int, default=45)
    a = ap.parse_args()
    data = os.path.join(a.vantage, "docs", "data")

    idx = load(os.path.join(data, "jp", "reports", "index.json"))["reports"]
    ta = {s["tk"].replace(".T", ""): s for s in load(os.path.join(data, "ta", "jp.json"))["stocks"] if s.get("tk")}
    kn = ko_names(os.path.join(data, "jp", "names-ko.js"))

    last = max(r["d"] for r in idx if r.get("d"))
    since = (date.fromisoformat(last) - timedelta(days=a.days)).isoformat()
    best = {}
    for r in idx:
        if not r.get("d") or r["d"] < since:
            continue
        if r["c"] not in best or r["d"] > best[r["c"]]["d"]:
            best[r["c"]] = r

    rows = []
    for c, r in best.items():
        t = ta.get(c, {})
        rows.append({
            "c": c, "n": t.get("name") or kn.get(c) or r.get("n"), "en": r.get("n"),
            "cat": r.get("cat") or t.get("sector"), "d": r["d"], "p": r.get("p"), "fy": r.get("fy"),
            "mc": r.get("mc") if r.get("mc") is not None else t.get("mcap"), "per": t.get("per"),
            "g": r.get("g"), "rev": r.get("rev_yoy"), "op": r.get("op_yoy"), "prog": r.get("prog"),
            "beat": r.get("beat"), "d1": r.get("d1"), "px": t.get("price"), "r3": t.get("r3"), "rid": r.get("rid"),
        })
        dump(detail(c, data, r.get("rid")), os.path.join(DATA, "co", f"{c}.json"))
    rows.sort(key=lambda x: (x["d"], x["mc"] or 0), reverse=True)

    # 텔레 카드에만 있는 회사 — 주가만 채운다(VANTAGE px 있으면 그것, 없으면 야후)
    pf = os.path.join(DATA, "pipeline.json")
    extra = 0
    if os.path.exists(pf):
        for c in load(pf).get("companies", {}):
            if c in best:
                continue
            d = detail(c, data, None)
            if not d.get("px"):
                d["px"] = yahoo_px(c)[-PX_DAYS:]
                time.sleep(0.4)
            dump(d, os.path.join(DATA, "co", f"{c}.json"))
            extra += 1

    dump({"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "since": since, "last": last,
          "unit": {"mc": "억엔", "rev": "%", "op": "%", "d1": "%"}, "count": len(rows), "rows": rows},
         os.path.join(DATA, "stage1.json"))
    print(f"1단계 {len(rows)}곳 ({since} ~ {last}) · 상세 {len(rows) + extra}곳")


if __name__ == "__main__":
    main()
