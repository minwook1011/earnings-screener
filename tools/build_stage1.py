# -*- coding: utf-8 -*-
"""1단계 목록 만들기 — VANTAGE 일본 실적 데이터(로컬 C:\\dev\\vantage-0910)를 읽어 docs/data/jp/stage1.json 으로 쓴다.

  원천  VANTAGE docs/data/jp/reports/index.json  (발표 결과·평가·주가 반응)
        VANTAGE docs/data/ta/jp.json             (한글 이름·업종·시총·PER)
        VANTAGE docs/data/jp/names-ko.js         (한글 검색 이름 — 첫 낱말을 회사 이름으로)
  기간  가장 최근 발표일에서 거꾸로 DAYS 일(기본 45일). 같은 회사는 최신 발표 하나만.

  실행  python tools/build_stage1.py [--vantage C:\\dev\\vantage-0910] [--days 45]
"""
import argparse
import json
import os
import re
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "jp", "stage1.json")
KST = timezone(timedelta(hours=9))


def load(path):
    return json.load(open(path, encoding="utf-8"))


def ko_names(path):
    if not os.path.exists(path):
        return {}
    m = re.search(r"const KO_NAMES = (\{.*?\});", open(path, encoding="utf-8").read(), re.S)
    return {k: v.split(" ")[0] for k, v in json.loads(m.group(1)).items()} if m else {}


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
            "c": c,
            "n": t.get("name") or kn.get(c) or r.get("n"),
            "en": r.get("n"),
            "cat": r.get("cat") or t.get("sector"),
            "d": r["d"],
            "p": r.get("p"),
            "fy": r.get("fy"),
            "mc": r.get("mc") if r.get("mc") is not None else t.get("mcap"),
            "per": t.get("per"),
            "g": r.get("g"),
            "rev": r.get("rev_yoy"),
            "op": r.get("op_yoy"),
            "prog": r.get("prog"),
            "beat": r.get("beat"),
            "d1": r.get("d1"),
            "px": t.get("price"),
        })
    rows.sort(key=lambda x: (x["d"], x["mc"] or 0), reverse=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out = {"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "since": since, "last": last,
           "unit": {"mc": "억엔", "rev": "%", "op": "%", "d1": "%"}, "count": len(rows), "rows": rows}
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"1단계 {len(rows)}곳 ({since} ~ {last}) → {OUT}")


if __name__ == "__main__":
    main()
