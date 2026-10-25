# -*- coding: utf-8 -*-
"""분기 단독 실적을 결산단신 XBRL(tools/xbrl_cache, build_xlsx 와 같은 자료)에서 뽑아 tools/qhist/jp.json 에 넣는다.
  리서치룸 실적 프리뷰처럼 텔레 단계에 없는 회사도 '최근 10개 분기' 상자를 그리게(2026-10-25 사용자).
  이미 qhist 에 있는 회사(예약 작업이 jp_guidance 로 넣은 것)는 건드리지 않는다. 단위 백만엔.

  python tools/qhist_xbrl.py [코드 …]     코드를 안 주면 리서치룸 자료(room.json docs·watch) 중 qhist 에 없는 회사
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_xlsx as bx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "qhist", "jp.json")
N = 14


def rows_of(code):
    data, used, fsm = bx.collect(code)
    if not used:
        return None
    PL = data["PL"]
    rev = bx.pick(PL, bx.PLMAP["revenue"])
    if not rev:
        return None
    op, ni = bx.pick(PL, bx.PLMAP["op"]), bx.pick(PL, bx.PLMAP["ni_owner"]) or bx.pick(PL, bx.PLMAP["ni"])
    end_m = (fsm - 2) % 12 + 1 if fsm else 3
    out = []
    for fy, q in bx.qseq(max(rev), N):
        s, o = bx.standalone(rev, fy, q), bx.standalone(op, fy, q)
        if s is None or o is None:
            continue
        n = bx.standalone(ni, fy, q)
        out.append([f"{fy}/{end_m} {q}Q", round(s / 1e6), round(o / 1e6), round(n / 1e6) if n is not None else 0])
    # 기간 경계가 어긋난 누계 차(결산기 변경·소급 수정)로 생기는 이상값은 버린다 — 매출 0 이하, 중앙값의 40% 미만
    good = sorted(r[1] for r in out if r[1] > 0)
    med = good[len(good) // 2] if good else 0
    out = [r for r in out if r[1] > 0 and r[1] >= med * 0.4]
    return out[::-1] or None


def main(codes):
    src = json.load(open(SRC, encoding="utf-8"))
    if not codes:
        room = json.load(open(os.path.join(ROOT, "docs", "data", "room.json"), encoding="utf-8"))
        codes = sorted({x["c"] for x in room.get("docs", []) + room.get("watch", [])})
    mine = set(src.get("_xbrl", []))   # 이 스크립트가 넣은 회사 — 다시 돌리면 새로 뽑는다
    add = 0
    for c in codes:
        if c in src and c not in mine:
            continue
        try:
            r = rows_of(c)
        except Exception as e:
            print(" ", c, "실패", e)
            continue
        if r:
            src[c] = r
            mine.add(c)
            add += 1
    src["_xbrl"] = sorted(mine)
    json.dump(src, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"qhist 결산단신 보충 {add}곳")


if __name__ == "__main__":
    main(sys.argv[1:])
