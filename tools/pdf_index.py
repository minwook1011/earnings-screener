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


def doc_day(p):
    """사본 옆 .doc(거래소 문서 번호 1401+YYYYMMDD… 또는 주소)에서 공개일 — 주소면 파일 받은 날"""
    try:
        v = open(p + ".doc", encoding="utf-8").read().strip()
    except OSError:
        return None, ""
    try:   # 실제 공개일(deck_refresh.py 가 적음) — 문서 번호 속 날짜는 공개일과 다를 수 있다
        return open(p + ".day", encoding="utf-8").read().strip()[:10], v
    except OSError:
        pass
    m = re.match(r"\d{4}(\d{4})(\d{2})(\d{2})\d+$", v) or re.search(r"/(\d{4})(\d{2})(\d{2})\d{6,}\.pdf", v)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}", v
    return datetime.fromtimestamp(os.path.getmtime(p), KST).strftime("%Y-%m-%d"), v


def ko_ok(d, name):
    """번역본이 지금 원본의 것인지(원본이 새 분기로 바뀌면 옛 번역은 안 보여 줌)"""
    k = os.path.join(d, name + "_ko.pdf")
    if not os.path.isfile(k):
        return 0
    try:
        return 1 if open(k + ".doc", encoding="utf-8").read().strip() == open(os.path.join(d, name + ".pdf.doc"), encoding="utf-8").read().strip() else 0
    except OSError:
        return 0


def build():
    """t·ko = 결산단신, s·sko = 실적설명회 자료(setsumei.pdf — 카드 칩은 이것을 먼저 보인다, 2026-11-15 사용자)"""
    items = {}
    for c in sorted(os.listdir(RES)):
        d = os.path.join(RES, c)
        it = {}
        if os.path.isfile(os.path.join(d, "tanshin.pdf")):
            it["t"] = doc_day(os.path.join(d, "tanshin.pdf"))[0]
            it["ko"] = ko_ok(d, "tanshin")
        if os.path.isfile(os.path.join(d, "setsumei.pdf")):
            it["s"] = doc_day(os.path.join(d, "setsumei.pdf"))[0]
            it["sko"] = ko_ok(d, "setsumei")
        if it:
            items[c] = it
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
    print(f"결산단신 {sum(1 for v in it.values() if 't' in v)}곳 · 설명회 자료 {sum(1 for v in it.values() if 's' in v)}곳 · 설명회 번역본 {sum(v.get('sko', 0) for v in it.values())}곳 → docs/data/jp/pdf.json")
