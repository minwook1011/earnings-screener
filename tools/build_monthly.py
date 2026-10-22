# -*- coding: utf-8 -*-
"""월차(月次) — 월차를 내는 회사만 docs/data/jp/monthly/<코드>.json 으로(최근 24개월, 열 이름 한국어).

  원천  VANTAGE docs/data/jp/monthly/<코드>.json (TDnet·회사 IR 월차 원장, 매일 갱신)
        tools/monthly_extra/<코드>.json         (VANTAGE 에 없는 회사 — jp_monthly 도구로 받아 넣음)
  번역  VANTAGE jp-screener.js 의 MO_DICT(일본어 → 한국어, 긴 낱말부터 바꿈)
  대상  사이트에 나오는 회사(1단계 목록·발표 예정·텔레 단계) 전부
  결과  docs/data/jp/monthly/<코드>.json + index.json(월차 있는 코드 목록·최신 달)

  실행  python tools/build_monthly.py [--vantage C:\\dev\\vantage-0910]
"""
import argparse
import glob
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "jp", "monthly")
EXTRA = os.path.join(ROOT, "tools", "monthly_extra")
N = 24


def load(p):
    return json.load(open(p, encoding="utf-8"))


def mo_dict(vantage):
    js = open(os.path.join(vantage, "docs", "jp-screener.js"), encoding="utf-8").read()
    m = re.search(r"const MO_DICT=(\[.*?\]);", js, re.S)
    pairs = json.loads(m.group(1)) if m else []
    return sorted(pairs, key=lambda p: -len(p[0]))


def ko(s, pairs):
    for a, b in pairs:
        s = s.replace(a, b)
    s = re.sub(r"사업(?=[^\s·])", "사업 ", s)
    return re.sub(r"\s+", " ", s).replace("전년비", "전년 대비").strip()


def universe():
    d = os.path.join(ROOT, "docs", "data", "jp")
    s1 = load(os.path.join(d, "stage1.json"))
    codes = {r["c"] for r in s1.get("rows", [])} | {r["c"] for r in s1.get("upcoming", [])}
    pf = os.path.join(d, "pipeline.json")
    if os.path.exists(pf):
        codes |= set(load(pf).get("companies", {}))
    return codes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vantage", default=r"C:\dev\vantage-0910")
    a = ap.parse_args()
    pairs = mo_dict(a.vantage)
    os.makedirs(OUT, exist_ok=True)
    want = universe()
    index = {}
    src = {os.path.basename(f)[:-5]: f for f in glob.glob(os.path.join(a.vantage, "docs", "data", "jp", "monthly", "*.json"))}
    src.update({os.path.basename(f)[:-5]: f for f in glob.glob(os.path.join(EXTRA, "*.json"))})
    for c, f in src.items():
        if c not in want:
            continue
        d = load(f)
        cols = d.get("cols") or []
        if "rows" in d:
            rows = d["rows"]
        else:
            rows = [[m] + [d["data"][m].get(k) for k in cols] for m in sorted(d.get("data", {}), reverse=True)]
        rows = sorted(rows, key=lambda r: r[0])[-N:]
        units = d.get("units") or {}
        ratio = [("전년比" in k) or ("伸長率" in k) or (units.get(k, units.get("*", "")).startswith("전년")) for k in cols]
        out = {"c": c, "cols": [ko(k, pairs) for k in cols], "ratio": ratio, "rows": rows,
               "note": d.get("note"), "src": (d.get("latest") or {}).get("url") or (d.get("latest") or {}).get("pdf")}
        json.dump(out, open(os.path.join(OUT, f"{c}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        index[c] = rows[-1][0] if rows else None
    json.dump(index, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"월차 {len(index)}곳 →", OUT)


if __name__ == "__main__":
    main()
