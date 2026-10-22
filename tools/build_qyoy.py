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
EVT = os.path.join(ROOT, "tools", "qhist", "events.json")   # 합병·인수로 부풀려진 분기
OUT = os.path.join(ROOT, "docs", "data", "jp", "qyoy.json")
N = 10
FS_N = 12
FS_OUT = os.path.join(ROOT, "docs", "data", "jp", "fs.json")


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


def lkey(lab):
    m = re.match(r"(\d+)\.(\d)Q", lab)
    return (int(m.group(1)), int(m.group(2)))


def main():
    src = json.load(open(SRC, encoding="utf-8"))
    evt = json.load(open(EVT, encoding="utf-8")) if os.path.exists(EVT) else {}
    out = {"_about": "최근 10개 분기 성장률(전년 같은 분기 대비 %, 오래된 것부터). r=매출 o=영업이익 ot=글자(흑전·적전·적지) m=그 분기에 합병·인수한 회사가 처음 연결됨(화면: 분기 이름 위 '합병')",
           "_src": src.get("_fetched")}
    fsout = {"_about": "분기 재무제표(억엔) v=[매출,영업이익,순이익] qoq·yoy=같은 순서 %, m=합병 효과"}
    for c, rows in src.items():
        if c.startswith("_"):
            continue
        by = {key(r[0]): r[1:] for r in rows}
        # 재무제표 표(상세 패널): 최근 12분기 매출·영업이익·순이익 + 전 분기 대비·전년 대비
        fs = []
        for r in sorted(rows, key=lambda r: key(r[0]))[-FS_N:]:
            y, mo, q = key(r[0])
            pq = by.get((y, mo, q - 1) if q > 1 else (y - 1, mo, 4))
            py = by.get((y - 1, mo, q))
            it = {"p": label(r[0]), "v": [round(x / 100, 1) for x in r[1:]],
                  "qoq": [growth(r[i], pq[i - 1])[0] if pq else None for i in (1, 2, 3)],
                  "yoy": [growth(r[i], py[i - 1])[0] if py else None for i in (1, 2, 3)]}
            for e in evt.get(c, []):
                if e.get("at") == it["p"]:
                    it["m"] = e["note"]
            fs.append(it)
        fsout[c] = fs
        seq = []
        for p, s, op, *_ in sorted(rows, key=lambda r: key(r[0])):
            y, mo, q = key(p)
            prev = by.get((y - 1, mo, q))
            if not prev:
                continue
            r, _ = growth(s, prev[0])
            o, ot = growth(op, prev[1])
            if prev[1] > 0 and op <= 0:
                o, ot = None, "적전"
            it = {"p": label(p), "r": r, "o": o, "ot": ot, "s": round(s / 100, 1), "op": round(op / 100, 1)}
            for e in evt.get(c, []) if not c.startswith("_") else []:
                if e.get("at") == it["p"]:
                    it["m"] = e["note"]
            seq.append(it)
        out[c] = seq[-N:]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(fsout, open(FS_OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("분기 성장률", {c: len(v) for c, v in out.items() if not c.startswith("_")})


if __name__ == "__main__":
    main()
