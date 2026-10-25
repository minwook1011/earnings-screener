# -*- coding: utf-8 -*-
"""리서치룸 — 관심 기업 목록·리서치 모음·실적 프리뷰(docs/data/room.json).
  기업은 사용자가 말하면 Claude 가 이 스크립트로 넣는다. 사이트에서는 못 바꾼다(모두 같은 목록을 봄).

  python tools/room.py add <코드> [이름] [--memo "메모"] [--m jp]    관심 기업 추가(이름·업종은 stage1·pipeline 에서 찾음)
  python tools/room.py memo <코드> "메모"                             메모 바꾸기
  python tools/room.py remove <코드>                                  관심 기업에서 빼기(자료는 남김)
  python tools/room.py doc <코드> <종류> <HTML경로> "<한 줄 요약>"      자료 붙이기 — 종류: 프리뷰|인뎁스|메모 …
                                                                      HTML 을 docs/room/<코드>/ 로 복사(검색 노출 안 함 표시)
  python tools/room.py list
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOM = os.path.join(ROOT, "docs", "data", "room.json")
JP = os.path.join(ROOT, "docs", "data", "jp")
KST = timezone(timedelta(hours=9))
NL = chr(10)
SLUG = {"프리뷰": "preview", "인뎁스": "indepth", "메모": "memo"}


def now():
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M")


def load():
    try:
        return json.load(open(ROOM, encoding="utf-8"))
    except (OSError, ValueError):
        return {"updated": "", "watch": [], "docs": []}


def save(d):
    d["updated"] = now()
    json.dump(d, open(ROOM, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def lookup(c):
    """이름·업종·다음 발표일을 사이트 자료에서 찾는다."""
    out = {}
    try:
        s1 = json.load(open(os.path.join(JP, "stage1.json"), encoding="utf-8"))
        for r in s1.get("rows", []) + s1.get("upcoming", []):
            if r.get("c") == c:
                out.setdefault("n", r.get("n"))
                out.setdefault("cat", r.get("cat"))
    except (OSError, ValueError):
        pass
    try:
        p = json.load(open(os.path.join(JP, "pipeline.json"), encoding="utf-8"))["companies"].get(c)
        if p:
            out.setdefault("n", p.get("n"))
    except (OSError, ValueError, KeyError):
        pass
    return {k: v for k, v in out.items() if v}


def add(c, name=None, memo="", m="jp"):
    d = load()
    w = next((x for x in d["watch"] if x["c"] == c), None)
    info = lookup(c)
    if not w:
        w = {"c": c, "m": m, "added": now()[:10]}
        d["watch"].insert(0, w)
    w["n"] = name or w.get("n") or info.get("n") or c
    if info.get("cat"):
        w["cat"] = info["cat"]
    if memo:
        w["memo"] = memo
    save(d)
    print(f"관심 기업 추가: {w['n']}({c})")


def noindex(src):
    if 'name="robots"' in src:
        return src
    meta = '<meta name="robots" content="noindex, nofollow, noarchive">'
    if re.search(r"<head[^>]*>", src, re.I):
        return re.sub(r"(<head[^>]*>)", lambda mm: mm.group(1) + NL + meta, src, count=1, flags=re.I)
    return NL.join(['<!doctype html>', '<meta charset="utf-8">',
                    '<meta name="viewport" content="width=device-width, initial-scale=1">', meta, src])


def doc(c, kind, html, summary):
    d = load()
    day = now()[:10]
    rel = f"room/{c}/{SLUG.get(kind, 'doc')}-{day}.html"
    dst = os.path.join(ROOT, "docs", rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    src = open(html, encoding="utf-8").read()
    open(dst, "w", encoding="utf-8").write(noindex(src))
    title = (re.search(r"<title>([^<]*)", src) or [None, ""])[1].strip()
    name = next((x.get("n") for x in d["watch"] if x["c"] == c), None) or lookup(c).get("n") or c
    d["docs"] = [x for x in d["docs"] if x.get("html") != rel]
    d["docs"].insert(0, {"c": c, "n": name, "kind": kind, "date": now(), "title": title, "sum": summary, "html": rel})
    save(d)
    print(f"{name}({c}) {kind} 올림 → docs/{rel}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "list":
        print(json.dumps(load(), ensure_ascii=False, indent=1))
    elif a[0] == "add":
        memo = a[a.index("--memo") + 1] if "--memo" in a else ""
        m = a[a.index("--m") + 1] if "--m" in a else "jp"
        rest = [x for i, x in enumerate(a[1:], 1) if x not in ("--memo", "--m") and a[i - 1] not in ("--memo", "--m")]
        add(rest[0], rest[1] if len(rest) > 1 else None, memo, m)
    elif a[0] == "memo":
        d = load()
        for x in d["watch"]:
            if x["c"] == a[1]:
                x["memo"] = a[2]
        save(d)
    elif a[0] == "remove":
        d = load()
        d["watch"] = [x for x in d["watch"] if x["c"] != a[1]]
        save(d)
        print(f"관심 기업에서 뺌: {a[1]}")
    elif a[0] == "doc":
        doc(a[1], a[2], a[3], a[4] if len(a) > 4 else "")
    else:
        sys.exit(__doc__)
