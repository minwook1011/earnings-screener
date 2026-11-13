# -*- coding: utf-8 -*-
"""결산단신 PDF 목록(2026-11-13 사용자) — 카드 맨 위 「(M/D) 결산단신 PDF」·「한글 번역」 칩이 읽는다.
  docs/research/<코드>/tanshin.pdf(research_queue.py 가 받아 둔 사본)와 tanshin_ko.pdf(레이아웃 그대로 한국어 번역본)를 훑는다.
  발표일은 tanshin.pdf.doc 의 거래소 문서 번호(1401 + YYYYMMDD + …)에서 읽는다.

  python tools/pdf_index.py        → docs/data/jp/pdf.json {"updated", "items": {코드: {"t": "YYYY-MM-DD", "ko": 0|1}}}
"""
import json
import os
import re
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "docs", "research")
OUT = os.path.join(ROOT, "docs", "data", "jp", "pdf.json")
KST = timezone(timedelta(hours=9))


def build():
    items = {}
    for c in sorted(os.listdir(RES)):
        d = os.path.join(RES, c)
        p = os.path.join(d, "tanshin.pdf")
        if not os.path.isfile(p):
            continue
        t = None
        try:
            m = re.match(r"\d{4}(\d{4})(\d{2})(\d{2})", open(p + ".doc", encoding="utf-8").read().strip())
            if m:
                t = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        except OSError:
            pass
        ko = os.path.isfile(os.path.join(d, "tanshin_ko.pdf"))
        if ko:   # 번역본이 지금 원본의 것인지(원본이 새 분기로 바뀌면 옛 번역은 안 보여 줌)
            try:
                ko = open(os.path.join(d, "tanshin_ko.pdf.doc"), encoding="utf-8").read().strip() == open(p + ".doc", encoding="utf-8").read().strip()
            except OSError:
                ko = False
        items[c] = {"t": t, "ko": 1 if ko else 0}
    old = {}
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding="utf-8")).get("items", {})
        except ValueError:
            pass
    if old == items:
        return items
    json.dump({"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "items": items},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return items


if __name__ == "__main__":
    it = build()
    print(f"결산단신 {len(it)}곳 · 번역본 {sum(v['ko'] for v in it.values())}곳 → docs/data/jp/pdf.json")
