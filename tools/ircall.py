# -*- coding: utf-8 -*-
"""결산설명회(IR 콜) 일정 — 2단계 이상 회사(2026-10-26 사용자: 평일 15:30·16:30·17:30 예약 작업이 찾음).
  python tools/ircall.py todo              날짜를 아직 못 찾은 곳(발표 14일 안) → JSON [{c, n, ann, tanshin}]
                                           tanshin = 결산단신 첫 쪽 '결산설명회 개최 유무' 칸(파이썬, AI 없음). '없음'인 곳은 바로 기록하고 목록에서 뺀다
  python tools/ircall.py set <코드> "<한 줄>" [출처]   예 "11/6(금) · 애널리스트 대상"(날짜를 못 찾았으면 "있음 · 날짜 미확인")
→ docs/data/jp/ircall.json (사이트 2~4단계 표 '3단계로' 아래 빈칸) + 2단계 리포트의 결산단신 버튼 옆 칩
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "docs", "data", "jp")
OUT = os.path.join(DATA, "ircall.json")
KST = timezone(timedelta(hours=9))
DAYS = 14


def now():
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M")


def load():
    if os.path.exists(OUT):
        return json.load(open(OUT, encoding="utf-8"))
    return {"updated": None, "items": {}}


def save(d):
    d["updated"] = now()
    json.dump(d, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def dated(t):
    return bool(re.match(r"\d{1,2}/\d{1,2}", t or ""))


def flag(c, doc):
    """결산단신 첫 쪽의 개최 유무 칸 → '없음' / '있음(대상)' / None"""
    import build_xlsx
    import research_queue
    p = os.path.join(build_xlsx.CACHE, "_tanshin", doc + ".pdf")
    if not os.path.exists(p):
        b = build_xlsx.get(f"https://www.release.tdnet.info/inbs/{doc}.pdf") or build_xlsx.get(build_xlsx.PDF.format(code=c, doc=doc))
        if not b or b[:4] != b"%PDF":
            return None
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "wb").write(b)
    chip = re.sub(r"<[^>]+>", "", research_queue.call_chip(p))
    return chip.replace("결산설명회 ", "").replace(" · 날짜 미확인", "") or None


def todo():
    import build_xlsx
    pipe = json.load(open(os.path.join(DATA, "pipeline.json"), encoding="utf-8"))["companies"]
    d = load()
    cut = (datetime.now(KST) - timedelta(days=DAYS)).strftime("%Y-%m-%d")
    out = []
    for c, co in pipe.items():
        if co["stage"] < 2:
            continue
        it = d["items"].get(c) or {}
        if dated(it.get("t")) or it.get("t") == "없음":
            continue
        try:
            f = build_xlsx.filings(c)[0]
        except BaseException:
            continue
        if f["date"] < cut:
            continue
        fl = it.get("flag") or flag(c, f["doc"])
        if fl == "없음":
            d["items"][c] = {"t": "없음", "ann": f["date"], "chk": now(), "src": "결산단신 첫 쪽"}
            patch(c, "결산설명회 없음")
            continue
        d["items"].setdefault(c, {}).update({"flag": fl, "ann": f["date"]})
        if fl and not d["items"][c].get("t"):   # 찾기 전에도 사이트에 '날짜 미확인'
            d["items"][c]["t"] = fl + " · 날짜 미확인"
        out.append({"c": c, "n": co["n"], "ann": f["date"], "tanshin": fl, "tries": it.get("tries", 0)})
    save(d)
    print(json.dumps(out, ensure_ascii=False, indent=1))


def patch(c, text):
    """2단계 리포트 결산단신 버튼 옆 칩을 바꾼다(있을 때만)."""
    h = os.path.join(ROOT, "docs", "research", c, "stage2.html")
    if not os.path.exists(h):
        return
    s = open(h, encoding="utf-8").read()
    if 'class="es-tanshin-bar"' not in s:
        return
    chip = f'<span class="es-call">{text}</span>'
    if 'class="es-call"' in s:
        s2 = re.sub(r'<span class="es-call">[^<]*</span>', lambda _: chip, s, count=1)
    else:
        s2 = re.sub(r'(<div class="es-tanshin-bar">.*?)(</div>)', lambda k: k.group(1) + chip + k.group(2), s, count=1, flags=re.S)
    if ".es-call{" not in s2:
        s2 = s2.replace('<div class="es-tanshin-bar">', '<style>.es-call{display:inline-block;margin-left:10px;padding:6px 12px;'
                        'border-radius:999px;border:1.5px solid #c62828;color:#c62828;font:600 13px/1 system-ui,"Malgun Gothic",'
                        'sans-serif;vertical-align:1px}</style><div class="es-tanshin-bar">', 1)
    if s2 != s:
        open(h, "w", encoding="utf-8").write(s2)


def put(c, t, src=""):
    d = load()
    it = d["items"].setdefault(c, {})
    it.update({"t": t, "chk": now(), "tries": it.get("tries", 0) + (0 if dated(t) else 1)})
    if src:
        it["src"] = src
    save(d)
    patch(c, ("IR 설명회 " + t) if dated(t) else ("결산설명회 " + t))
    print(f"{c} → {t}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["todo"]:
        todo()
    elif a[:1] == ["set"] and len(a) >= 3:
        put(a[1], a[2], a[3] if len(a) > 3 else "")
    else:
        sys.exit(__doc__)
