# -*- coding: utf-8 -*-
"""분기 성장률 줄 — tools/qhist/jp.json(단독 분기 실적) → docs/data/jp/qyoy.json.

  회사마다 최근 10개 분기의 매출·영업이익 성장률(전년 같은 분기 대비 %)을 오래된 것부터 담는다.
  영업이익이 작년 같은 분기에 0 이하면 %가 뜻이 없어 글자로: 흑자 전환 · 적자 전환 · 적자 지속.
  2단계 이상 회사의 분기 실적은 예약 작업이 jp_guidance(history='quarterly', count=14)로 받아 qhist/jp.json 에 넣는다.

  실행  python tools/build_qyoy.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "qhist", "jp.json")
OUT = os.path.join(ROOT, "docs", "data", "jp", "qyoy.json")
N = 10


def key(p):
    m = re.match(r"(\d{4})/(\d{1,2}) (\d)Q", p)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def label(p):
    y, mo, q = key(p)
    return f"{y % 100}.{q}Q"          # 결산기 기준: 26.4Q = 2026년 결산기 4분기


def growth(cur, prev):
    if prev is None or cur is None:
        return None, None
    if prev > 0:
        return round((cur / prev - 1) * 100, 1), None
    if cur > 0:
        return None, "흑전"
    return None, "적지" if prev < 0 else None


def main():
    src = json.load(open(SRC, encoding="utf-8"))
    out = {"_about": "최근 10개 분기 성장률(전년 같은 분기 대비 %, 오래된 것부터). r=매출 o=영업이익 ot=글자(흑전·적전·적지)",
           "_src": src.get("_fetched")}
    for c, rows in src.items():
        if c.startswith("_"):
            continue
        by = {key(p): (s, op) for p, s, op in rows}
        seq = []
        for p, s, op in sorted(rows, key=lambda r: key(r[0])):
            y, mo, q = key(p)
            prev = by.get((y - 1, mo, q))
            if not prev:
                continue
            r, _ = growth(s, prev[0])
            o, ot = growth(op, prev[1])
            if prev[1] > 0 and op <= 0:
                o, ot = None, "적전"
            seq.append({"p": label(p), "r": r, "o": o, "ot": ot, "s": round(s / 100, 1), "op": round(op / 100, 1)})
        out[c] = seq[-N:]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("분기 성장률", {c: len(v) for c, v in out.items() if not c.startswith("_")})


if __name__ == "__main__":
    main()
