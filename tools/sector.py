# -*- coding: utf-8 -*-
"""일본 주요 전 종목 섹터 — 2026-10-30 사용자: 종목마다 섹터 하나, 섹터별로 볼 수 있게
  100억 스크리너 업종(32개)과 일본 소비재 분류(18개)가 섞여 있어 하나의 섹터 목록(SECTORS)으로 묶는다.
  반도체는 100억 업종에 따로 없어서(전기기기·기계 안에 있음) SEMI 코드 목록으로 뺀다.
  결과  docs/data/jp/sectors.json  {updated, sectors: [순서], items: {코드: {n, s, cat, mc, ytd, py, revg, opm, per}}}
        1,389곳 전부(판에 안 걸린 종목 포함). 주가 차트는 없음 — 판에 걸린 종목은 pxall 카드 차트를 같이 씀.
  build_pxall.py 가 끝날 때 같이 다시 쓴다. 따로: python tools/sector.py
"""
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "jp", "sectors.json")
CLASS = os.path.join(ROOT, "tools", "consumer_all_class.json")

SECTORS = ["반도체", "전기·전자", "정밀기기", "기계", "자동차·수송", "화학", "소재·철강", "의약품", "정보·통신",
           "게임·엔터·콘텐츠", "식품·음료", "외식", "유통·소매", "패션·명품", "화장품·퍼스널케어", "생활·홈",
           "레저·여행", "서비스", "건설·부동산", "운송·물류", "상사·도매", "금융", "에너지·전력", "기타"]
MAP = {
    "전기기기": "전기·전자", "정밀기기": "정밀기기", "기계": "기계", "자동차·수송기기": "자동차·수송",
    "화학": "화학", "철강·금속": "소재·철강", "소재(유리·고무·섬유·종이)": "소재·철강", "의약품": "의약품",
    "정보·통신": "정보·통신", "게임·엔터": "게임·엔터·콘텐츠", "게임·콘텐츠": "게임·엔터·콘텐츠", "장난감·캐릭터·가챠": "게임·엔터·콘텐츠",
    "식품·음료": "식품·음료", "식품": "식품·음료", "음료·주류·담배": "식품·음료", "라멘": "식품·음료", "건강식품·보충제·OTC": "식품·음료",
    "외식": "외식", "리테일·유통": "유통·소매", "소매": "유통·소매", "전문점·EC": "유통·소매", "슈퍼·편의점·할인점": "유통·소매",
    "드럭스토어": "유통·소매", "백화점·쇼핑몰": "유통·소매", "패션·명품": "패션·명품", "의류·신발·가방": "패션·명품",
    "시계·주얼리·명품": "패션·명품", "화장품·퍼스널케어": "화장품·퍼스널케어", "화장품·향수·퍼스널케어": "화장품·퍼스널케어",
    "생활·홈": "생활·홈", "생활잡화·인테리어·가전": "생활·홈", "기타 제품": "생활·홈", "여행·레저": "레저·여행",
    "레저·여행·스포츠": "레저·여행", "서비스": "서비스", "미용·헬스케어서비스": "서비스", "생활서비스": "서비스",
    "건설": "건설·부동산", "부동산": "건설·부동산", "운송·물류": "운송·물류", "상사·도매": "상사·도매", "도매·원료": "상사·도매",
    "은행": "금융", "증권·기타금융": "금융", "보험": "금융", "전력·가스": "에너지·전력", "에너지·자원": "에너지·전력",
}
# 반도체(장비·소재·설계·메모리·기판) — 100억 업종에서는 전기기기·기계·화학에 섞여 있음
SEMI = {"8035", "6857", "6146", "6920", "6723", "285A", "7735", "6525", "6526", "3436", "4062", "6323", "7729", "6963",
        "6315", "6871", "6266", "4186", "6890", "6967", "4004", "3132", "6338"}
CAR = re.compile(r"차|자동차|오토바이|바이크|타이어|딜러|트럭|카케어|카 |마이카|튜닝|머플러|서스펜션|윤활유|이륜")


OVR = {"8951": "건설·부동산"}   # 리츠


def sector(code, cat, s=""):
    if code in OVR:
        return OVR[code]
    if code in SEMI:
        return "반도체"
    if cat == "주택·자동차":
        return "자동차·수송" if CAR.search(s or "") else "건설·부동산"
    return MAP.get(cat or "", "기타")


def build(U=None):
    if U is None:
        from build_pxall import universe
        U = universe()
    try:
        cls = json.load(open(CLASS, encoding="utf-8"))
    except (OSError, ValueError):
        cls = {}
    items = {}
    for c, u in U.items():
        s = (cls.get(c) or {}).get("s", "")
        o = {"n": u.get("n"), "s": sector(c, u.get("cat"), s), "cat": u.get("cat")}
        o.update({k: u[k] for k in ("mc", "ytd", "py", "revg", "opm", "per") if u.get(k) is not None})
        items[c] = o
    from build_pxall import KST
    json.dump({"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "sectors": SECTORS, "items": items},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return items


if __name__ == "__main__":
    from collections import Counter
    it = build()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(f"섹터 {len(it)}곳:", ", ".join(f"{k} {v}" for k, v in Counter(x["s"] for x in it.values()).most_common()))
