# -*- coding: utf-8 -*-
"""분기 매출총이익·판관비를 결산단신 XBRL(tools/xbrl_cache)에서 뽑아 tools/qhist/gp.json 에 넣는다(2026-11-13 사용자).
  상세 패널 분기 재무제표에 매출총이익·GPM·판관비·판관비율 줄을 그리기 위한 것. 단위 백만엔.
  모양 {"코드": {"2026/12 3Q": [매출총이익, 판관비], ...}, "_seen": {"코드": "가장 새 결산단신 날짜"}}
  매출총이익이 없는 회사(은행·일부 IFRS)는 빈 값 → 화면에서 그 줄을 뺀다.

  python tools/qhist_gp.py [코드 …]     코드를 안 주면 qhist/jp.json 의 회사 중 새 결산단신이 들어온 곳만
  build_qyoy.py 가 돌 때 update() 를 불러 새로 들어온 회사만 채운다.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tools", "qhist", "gp.json")
QH = os.path.join(ROOT, "tools", "qhist", "jp.json")
N = 14


def rows_of(code):
    import build_xlsx as bx
    data, used, fsm = bx.collect(code)
    if not used:
        return None, None
    PL = data["PL"]
    gp, sga = bx.pick(PL, bx.PLMAP["gp"]), bx.pick(PL, bx.PLMAP["sga"])
    if not gp:
        return {}, used[0]["date"]
    end_m = (fsm - 2) % 12 + 1 if fsm else 3
    out = {}
    for fy, q in bx.qseq(max(gp), N):
        g = bx.standalone(gp, fy, q)
        if g is None:
            continue
        s = bx.standalone(sga, fy, q) if sga else None
        out[f"{fy}/{end_m} {q}Q"] = [round(g / 1e6), round(s / 1e6) if s is not None else None]
    return out, used[0]["date"]


def cache_stamp(code):
    d = os.path.join(ROOT, "tools", "xbrl_cache", code)
    try:
        return max(os.listdir(d)) if os.path.isdir(d) else ""
    except ValueError:
        return ""


def update(codes=None, force=False):
    out = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}
    seen = out.setdefault("_seen", {})
    if codes is None:
        codes = [c for c in json.load(open(QH, encoding="utf-8")) if not c.startswith("_")]
    n = 0
    for c in codes:
        st = cache_stamp(c)
        if not st or (not force and seen.get(c) == st):
            continue                                   # 새 결산단신 없음
        try:
            r, _ = rows_of(c)
        except Exception as e:                         # 한 회사가 깨져도 나머지는 계속
            print(" ", c, "매출총이익 실패", e)
            continue
        if r is not None:
            out[c] = r
            n += 1
        seen[c] = st
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return n


if __name__ == "__main__":
    a = sys.argv[1:]
    print("매출총이익 채움", update(a or None, force=bool(a)), "곳")
