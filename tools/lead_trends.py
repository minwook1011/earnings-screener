# -*- coding: utf-8 -*-
"""브랜드 구글트렌드 넣기(2026-11-17 사용자: 브랜드 있는 것들은 웬만하면 트렌드) — out_*.json → 원장 lead.items(kind trends)

  입력 {코드: {term, term_ko(한국어 뜻 — 라벨은 「일본어 검색어(한국어 뜻)」, 2026-11-20 사용자), region, why, pts:[[YYYY-MM, v]…]} | null}
  - 같은 회사의 「gt:」 수집 대기 항목은 지운다(받았든 못 받았든 이번 결과로 대체).
  - pts 없으면(도구 실패) 수집 대기로 남긴다.

  python tools/lead_trends.py out_1.json …
"""
import json
import re
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAD = os.path.join(ROOT, "docs", "data", "jp", "lead")
n_ok = n_wait = 0


def LAB(term, ko):   # 「구글트렌드: 일본어(한국어)」 — 2026-11-20 사용자. 한국어 안 괄호는 쉼표로
    if not ko:
        return "구글트렌드: " + term
    m = re.match(r"^(.*?)\s*[(（](.*)[)）]\s*$", ko)
    return "구글트렌드: %s(%s)" % (term, m.group(1) + ", " + m.group(2) if m else ko)


for f in sys.argv[1:]:
    for c, x in json.load(open(f, encoding="utf-8")).items():
        if c.endswith("_why") or not x:
            continue
        p = os.path.join(LEAD, c + ".json")
        if not os.path.exists(p):
            continue
        co = json.load(open(p, encoding="utf-8"))
        co["lead"]["macro"] = [m for m in co["lead"].get("macro") or [] if not str(m.get("id", "")).startswith("gt:")]
        terms = x.get("terms") or [x]
        have = {i.get("term") for i in co["lead"]["items"] if i.get("kind") == "trends"}
        for k, x in enumerate(terms):
          term = x.get("term")
          if not term or term in have:
            continue
          gid = "gt" if not have and k == 0 else "gt%d" % (len(have) + k + 1)
          if x.get("pts"):
            pts = [[q[0], round(q[1], 1), "gt"] for q in x["pts"] if q and q[1] is not None]
            co["lead"]["items"].append({"id": gid, "kind": "trends", "rank": 0.5 + k * 0.1, "t": LAB(term, x.get("term_ko")), "short": LAB(term, x.get("term_ko")), "nm": term[:14], "term_ko": x.get("term_ko", ""), "unit": "지수",
                                        "term": term, "entity": "구글 트렌드(%s)" % ("일본" if x.get("region", "JP") == "JP" else "전 세계"), "corp": term,
                                        "note": "0~100 상대 지수(5년 중 최고 = 100). 주별 값을 월평균으로", "why": x.get("why", ""), "pts": pts,
                                        "src": [{"doc": "Google Trends (region=%s, 5년)" % x.get("region", "JP"), "where": "검색어 「%s」 주별 → 월평균" % term, "freq": "주 단위(월로 묶음)", "auto": "반자동", "how": "월 1회 다시 받기"}]})
            co["refs"]["gt"] = {"date": "2026-11-17", "t": "Google Trends", "url": "https://trends.google.com/"}
            n_ok += 1
          else:
            co["lead"].setdefault("macro", []).append({"id": "gt:" + term, "name": "구글트렌드: %s(수집 대기)" % term, "why": x.get("why", ""), "region": x.get("region", "world")})
            n_wait += 1
        json.dump(co, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("트렌드 붙임", n_ok, "· 수집 대기", n_wait)
