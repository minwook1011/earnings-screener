# -*- coding: utf-8 -*-
"""실적설명회 자료 출처 지도(2026-11-15 사용자) — 일본 전 기업(docs/data/jp/co)마다 설명회 PDF 를 '어디서 받는지' 적어 둔다.
  다음 실적 때 ir_watch.py·research_queue.py deck 이 이 지도대로 바로 받는다(다시 찾지 않음).

  via   tdnet = 거래소 공시(TDnet)에 설명회 자료를 올리는 회사 — 실적 날 공시 목록에서 제목(title 예)으로 바로 받음
        ir    = 회사 IR 자료실에만 올림 — lib(자료실 주소)에서 PDF 링크를 읽어 받음(tools/ir_src.json 과 같은 주소)
        none  = 최근 1년 TDnet 에 설명회 자료가 없고 IR 자료실도 모름 — 안 내는 회사일 가능성(찾으면 ir_src 에 더함)
  last  = 지금 사이트에 있는 사본(docs/research/<코드>/setsumei.pdf)을 받은 곳(문서 번호 또는 주소)
  n     = 최근 1년 TDnet 설명회 자료 건수, title = 가장 최근 제목(분기 판단·제목 패턴용)

  python tools/deck_map.py            전 기업 다시 훑기(공시 목록 한 번씩, 수 분) → tools/deck_src.json
  python tools/deck_map.py 7203 6758  몇 곳만
"""
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
import build_xlsx  # noqa: E402

OUT = os.path.join(TOOLS, "deck_src.json")
RES = os.path.join(ROOT, "docs", "research")
KST = timezone(timedelta(hours=9))
NOT = re.compile(r"訂正|English|英文")


def load(p, e):
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return e


def tdnet_decks(c):
    raw = build_xlsx.get(build_xlsx.LIST.format(code=c))
    if raw is None:
        return None
    cut = (datetime.now(KST).date() - timedelta(days=380)).isoformat()
    out = []
    for it in json.loads(raw).get("items", []):
        t = it.get("Tdnet", it) if isinstance(it, dict) else {}
        title, day = t.get("title", ""), t.get("pubdate", "")[:10]
        m = re.search(r"(\d{18})\.pdf", t.get("document_url", ""))
        if m and day >= cut and build_xlsx.DECK.search(title) and not NOT.search(title):
            out.append({"doc": m.group(1), "date": day, "title": title})
    return sorted(out, key=lambda f: f["date"], reverse=True)


def one(c, src):
    e = {}
    p = os.path.join(RES, c, "setsumei.pdf.doc")
    if os.path.isfile(p):
        e["last"] = open(p, encoding="utf-8").read().strip()
    fl = tdnet_decks(c)
    s = src.get(c) or {}
    if fl:
        e.update(via="tdnet", n=len(fl), title=fl[0]["title"][-80:], at=fl[0]["date"])
    elif s.get("lib") and s.get("ok", True):
        e.update(via="ir", lib=s["lib"])
    elif e.get("last", "").startswith("http") and "tdnet" not in e["last"]:
        e.update(via="ir", lib=e["last"].rsplit("/", 1)[0] + "/")
    elif fl is None:
        e["via"] = "?"   # 공시 목록을 못 받음 — 다음 회차에 다시
    else:
        e["via"] = "none"
    if s.get("lib"):
        e["ir"] = s["lib"]
    return c, e


def main(codes):
    src = load(os.path.join(TOOLS, "ir_src.json"), {})
    old = load(OUT, {"items": {}})
    items = old.get("items", {})
    t0 = time.time()
    with ThreadPoolExecutor(6) as ex:
        for c, e in ex.map(lambda c: one(c, src), codes):
            if e.get("via") == "?" and c in items:
                continue
            items[c] = e
    json.dump({"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "items": dict(sorted(items.items()))},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    k = {}
    for e in items.values():
        k[e["via"]] = k.get(e["via"], 0) + 1
    print(f"{len(items)}곳 {k} · {round(time.time() - t0)}초 → tools/deck_src.json")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    cs = sys.argv[1:] or sorted(f[:-5] for f in os.listdir(os.path.join(ROOT, "docs", "data", "jp", "co")) if f.endswith(".json"))
    main(cs)
