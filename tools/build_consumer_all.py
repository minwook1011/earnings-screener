# -*- coding: utf-8 -*-
"""일본 소비재 전 종목(시총 기준 없음) — 2026-10-29 사용자: '소비재'를 넓게 보고 일본 상장사 전부를 훑어 소비하는 업종은 다 넣는다
   → docs/data/jp/consumer_all.json  ({"updated", "cats", "items": {코드: {n, jp, cat, s, mc, note}}})

  판정·분류  tools/consumer_all_class.json — 2026-10-30 JPX 상장종목 일람(프라임·스탠다드·그로스 내국·외국주, 3,707곳)을
             한 곳씩 카부탄 회사 개요·테마로 보고 판정한 결과 {코드: {g, n, jp, s, amb, mc}}.
             g = 아래 CATS 중 하나, amb = 애매해서 넣은 이유(분명한 소비재면 ""), mc = 판정 때 카부탄 시총(억엔).
  소비재란   사람(개인)이 돈 써서 사거나 이용하는 것 전부. 업종 분류와 상관없이 본다. 애매하면 넣는다(note 에 이유).
             넣음 — 먹는 것(식품·외식·음료·주류·담배), 입는 것(의류·신발·가방), 장난감·캐릭터·가챠, 게임·애니·만화·음악·아이돌,
                    건강식품·보충제·OTC·콘택트렌즈, 화장품·향수·위생용품, 시계·주얼리·안경, 백화점·슈퍼·편의점·드럭·전문점·EC,
                    가구·문구·생활용품·가전·반려동물, 호텔·여행·테마파크·골프·피트니스·스포츠용품·파친코, 개인용 주택·자동차·이륜·타이어,
                    미용·클리닉·결혼·장례·학원·소비자용 인터넷 서비스, 소비재 도매·식품 원료(애매 표시).
             뺌   — 은행·증권·보험·리스·소비자금융, 전력·가스·통신사·철도·물류, B2B 부품·소재·기계·화학 소재·반도체,
                    기업용 소프트웨어·SI·인재·광고대행, 건설·부동산 개발·임대, 처방약·의료기기·바이오.
  이름·시총  100억(vantage-0910) 스크리너 RAW·RAW_EXT·RAW_MAJ 에 있는 종목은 거기 시총(억엔)으로 바꾼다(build_pxall 과 같은 경로).
             거기 없는 소형주는 판정 때 카부탄 시총을 그대로 둔다.
  새 상장·재판정  consumer_all_class.json 에 한 줄 넣고(또는 고치고) 이 스크립트를 다시 돌린다.

  python tools/build_consumer_all.py
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_pxall import arr, vfile  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "consumer_all_class.json")
OUT = os.path.join(ROOT, "docs", "data", "jp", "consumer_all.json")
KST = timezone(timedelta(hours=9))
CATS = ["식품", "음료·주류·담배", "외식", "의류·신발·가방", "시계·주얼리·명품", "화장품·향수·퍼스널케어", "건강식품·보충제·OTC",
        "장난감·캐릭터·가챠", "게임·콘텐츠", "레저·여행·스포츠", "백화점·쇼핑몰", "슈퍼·편의점·할인점", "드럭스토어", "전문점·EC",
        "생활잡화·인테리어·가전", "주택·자동차", "생활서비스", "도매·원료"]


def vantage_mcap():
    """100억 스크리너 종목의 최신 시총(억엔) — 못 읽으면 {}"""
    out = {}
    for rel, name in (("docs/data/jp/screener-data.js", "RAW"), ("docs/data/jp/consumer-extra.js", "RAW_EXT"),
                      ("docs/data/jp/major-data.js", "RAW_MAJ")):
        try:
            for r in arr(vfile(rel), name):
                if r and r[0] and r[5] is not None:
                    out.setdefault(r[0], r[5])
        except Exception as e:
            print(f"  {rel} 못 읽음: {e}")
    return out


def main():
    src = json.load(open(SRC, encoding="utf-8"))
    mc = vantage_mcap()
    items, bad = {}, []
    for code in sorted(src, key=lambda c: -((mc.get(c) if c in mc else src[c].get("mc")) or 0)):
        x = src[code]
        if x.get("g") not in CATS:
            bad.append(code)
            continue
        it = {"n": x.get("n") or x.get("jp") or code, "jp": x.get("jp") or "", "cat": x["g"], "s": x.get("s") or "",
              "mc": mc.get(code, x.get("mc"))}
        if x.get("amb"):
            it["note"] = x["amb"]
        items[code] = it
    out = {"updated": datetime.now(KST).strftime("%Y-%m-%d"), "cats": CATS, "items": items}
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"완료 {len(items)}곳 · 애매 {sum(1 for v in items.values() if v.get('note'))} · "
          f"100억 시총 반영 {sum(1 for c in items if c in mc)} · {os.path.getsize(OUT) / 1e3:.0f}KB")
    print(" / ".join(f"{c}({sum(1 for v in items.values() if v['cat'] == c)})" for c in CATS))
    if bad:
        print("분류 이름이 CATS 에 없어 뺌:", " ".join(bad))
    return 0


if __name__ == "__main__":
    sys.exit(main())
