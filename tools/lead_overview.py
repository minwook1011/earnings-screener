# -*- coding: utf-8 -*-
"""기업별 선행지표 한눈에(2026-11-17 사용자) — docs/data/jp/lead/overview.json

  rows: [코드, 기업명, 대분류, 세부, [[지표 이름, 종류, 개월 수, 마지막 달], …], 메모]
  종류: 고유(이 회사 전용·두 곳 이하) · 공통(세 곳 이상이 같이 씀) · 연금 · 월차 · 대기(이름만, 데이터 없음)
"""
import collections
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAD = os.path.join(ROOT, "docs", "data", "jp", "lead")
MAC = os.path.join(LEAD, "macro")
MON = os.path.join(ROOT, "docs", "data", "jp", "monthly")

ix = json.load(open(os.path.join(LEAD, "index.json"), encoding="utf-8"))
al = json.load(open(os.path.join(MAC, "index.json"), encoding="utf-8"))["alias"]
grp = {g["id"]: (g["n"], {k["id"]: k["n"] for k in g["kids"]}) for g in ix["tree"]}
_f = {}


def series(mid):
    a = al.get(mid)
    if not a:
        return None
    if a["file"] not in _f:
        _f[a["file"]] = json.load(open(os.path.join(MAC, a["file"]), encoding="utf-8"))
    se = [s for s in _f[a["file"]].get("series") or [] if s.get("key") == a["key"]]
    return (a["file"] + "#" + a["key"], se[0]["pts"]) if se else None


cos, use = {}, collections.Counter()
for c in ix["cos"]:
    co = json.load(open(os.path.join(LEAD, c + ".json"), encoding="utf-8"))
    cos[c] = co
    for m in co["lead"].get("macro") or []:
        s = series(m["id"])
        if s:
            use[s[0]] += 1


def span(pts):
    p = [x[0] for x in pts if x and x[1] is not None]
    return len(p), (max(p) if p else "")


rows = []
order = [(g["id"], k["id"]) for g in ix["tree"] for k in g["kids"]]
for c, co in sorted(cos.items(), key=lambda kv: (order.index(tuple(kv[1]["sec"].split("/"))) if tuple(kv[1]["sec"].split("/")) in order else 999, kv[0])):
    g, k = co["sec"].split("/")
    ind = []
    if os.path.exists(os.path.join(MON, c + ".json")) and not any(i.get("kind") == "monthly" for i in co["lead"]["items"]):
        ind.append(["월차데이터", "월차", None, None])
    for it in sorted(co["lead"]["items"], key=lambda i: i.get("rank") or 9):
        n, last = span(it.get("pts") or [])
        if it.get("kind") == "pension":
            ind.append(["연금 가입자 수", "연금", n, last])
        elif it.get("kind") == "monthly":
            ind.append([it.get("t"), "월차", n, last])
        else:
            ind.append([it.get("t") or it.get("short"), "고유" if n else "대기", n, last, 1 if it.get("volatile") else 0])
    for m in sorted(co["lead"].get("macro") or [], key=lambda i: i.get("rank") or 9):
        s = series(m["id"])
        if s:
            n, last = span(s[1])
            ind.append([m.get("name") or m["id"], "고유" if use[s[0]] <= 2 else "공통", n, last, 1 if m.get("volatile") else 0])
        else:
            ind.append([m.get("name") or m["id"], "대기", 0, "", 1 if m.get("volatile") else 0])
    rows.append([c, co["n"], grp.get(g, ("", {}))[0], grp.get(g, ("", {}))[1].get(k, k), ind, co["lead"].get("pick_note") or ""])
json.dump({"updated": ix.get("updated"), "rows": rows}, open(os.path.join(LEAD, "overview.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("overview", len(rows), "곳")
