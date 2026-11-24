# -*- coding: utf-8 -*-
"""일본 주요 전 종목 섹터 — 2026-10-30 사용자: 종목마다 섹터 하나, 섹터별로 볼 수 있게
  100억 스크리너 업종(32개)과 일본 소비재 분류(18개)가 섞여 있어 하나의 섹터 목록(SECTORS)으로 묶는다.
  반도체는 100억 업종에 따로 없어서(전기기기·기계 안에 있음) SEMI 코드 목록으로 뺀다.
  결과  docs/data/jp/sectors.json  {updated, sectors: [순서], items: {코드: {n, s, cat, mc, ytd, py, revg, opm, per}}}
        1,389곳 전부(판에 안 걸린 종목 포함). 주가 차트는 없음 — 판에 걸린 종목은 pxall 카드 차트를 같이 씀.
        + x: {코드: 섹터} — 100억 목록 밖이지만 사이트에 나오는 회사(일본 스크리닝 판·리포트 쓴 회사, 2026-11-23 사용자: 카드 이름 옆 섹터)
          JPX 상장 종목 목록(33業種区分, tools/jpx_ind.json 에 7일 보관)으로 나눈다. 100억 업종으로 '기타'가 된 종목도 이걸로 다시 본다.
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
# JPX 33업종 → SECTORS
J33 = {"水産・農林業": "식품·음료", "食料品": "식품·음료", "鉱業": "에너지·전력", "石油・石炭製品": "에너지·전력", "電気・ガス業": "에너지·전력",
       "建設業": "건설·부동산", "不動産業": "건설·부동산", "繊維製品": "패션·명품", "パルプ・紙": "소재·철강", "化学": "화학", "医薬品": "의약품",
       "ゴム製品": "소재·철강", "ガラス・土石製品": "소재·철강", "鉄鋼": "소재·철강", "非鉄金属": "소재·철강", "金属製品": "소재·철강",
       "機械": "기계", "電気機器": "전기·전자", "輸送用機器": "자동차·수송", "精密機器": "정밀기기", "その他製品": "생활·홈",
       "陸運業": "운송·물류", "海運業": "운송·물류", "空運業": "운송·물류", "倉庫・運輸関連業": "운송·물류", "情報・通信業": "정보·통신",
       "卸売業": "상사·도매", "小売業": "유통·소매", "銀行業": "금융", "証券、商品先物取引業": "금융", "保険業": "금융", "その他金融業": "금융",
       "サービス業": "서비스"}
JPX = os.path.join(ROOT, "tools", "jpx_ind.json")
JPX_URL = "https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xlsx"


def jpx_ind():
    """{코드: 33業種区分} — 7일 넘으면 JPX 엑셀을 다시 받는다. 못 받으면 있던 것을 쓴다."""
    try:
        old = json.load(open(JPX, encoding="utf-8"))
    except (OSError, ValueError):
        old = {}
    if old.get("at", "") >= datetime.now().strftime("%Y-%m-%d") or (old.get("at") and (datetime.now() - datetime.strptime(old["at"], "%Y-%m-%d")).days < 7):
        return old.get("items", {})
    try:
        import io
        import urllib.request
        import pandas as pd
        req = urllib.request.Request(JPX_URL, headers={"User-Agent": "Mozilla/5.0"})
        d = pd.read_excel(io.BytesIO(urllib.request.urlopen(req, timeout=60).read()), dtype=str)
        items = {str(r["コード"]).strip(): r["33業種区分"] for _, r in d.iterrows() if r["33業種区分"] in J33}
        if len(items) > 3000:
            json.dump({"at": datetime.now().strftime("%Y-%m-%d"), "items": items}, open(JPX, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
            return items
    except Exception as e:  # noqa: BLE001
        print("JPX 업종 못 받음:", e)
    return old.get("items", {})


def site_codes():
    """100억 목록 밖이어도 사이트 카드에 나오는 회사 — 일본 스크리닝 판(px)·리포트 쓴 회사"""
    out = set()
    for rel in (("docs", "data", "jp", "px", "index.json"), ("docs", "data", "jp", "research", "index.json")):
        try:
            d = json.load(open(os.path.join(ROOT, *rel), encoding="utf-8"))
            out |= set(d.get("items", d))
        except (OSError, ValueError, AttributeError):
            pass
    return out


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
    items, ji = {}, jpx_ind()
    for c, u in U.items():
        s = (cls.get(c) or {}).get("s", "")
        o = {"n": u.get("n"), "s": sector(c, u.get("cat"), s), "cat": u.get("cat")}
        if o["s"] == "기타" and J33.get(ji.get(c)):
            o["s"] = J33[ji[c]]
        o.update({k: u[k] for k in ("mc", "ytd", "py", "revg", "opm", "per") if u.get(k) is not None})
        items[c] = o
    from build_pxall import KST
    x = {c: ("반도체" if c in SEMI else OVR.get(c) or J33[ji[c]]) for c in sorted(site_codes()) if c not in items and J33.get(ji.get(c))}
    json.dump({"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "sectors": SECTORS, "items": items, "x": x},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return items


if __name__ == "__main__":
    from collections import Counter
    it = build()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(f"섹터 {len(it)}곳:", ", ".join(f"{k} {v}" for k, v in Counter(x["s"] for x in it.values()).most_common()))
