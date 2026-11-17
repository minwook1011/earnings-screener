# -*- coding: utf-8 -*-
"""재검토 제안 반영(2026-11-17 사용자 승인 「제안대로 진행」) — 지금 원장에서 drop 은 빼고, 받은 add 는 붙이고, 못 받은 건 대기로.

  review/out_*.json : {코드: {drop:[{name}], add:[…제안…], note}}       ← 무엇을 뺄지
  fetch/out_*.json  : {코드: {add:[{kind series|macro_ref, name, unit, src, why, pts, trend, volatile}], pending:[{name, why, reason}]}}

  - 연금(nenkin/lk)·월차(kind monthly)는 drop 대상이어도 지우지 않는다(사용자 원칙: SI·컨설팅 인력, 월차 반드시).
  - volatile = IP·인물 등 지금 잘 나가서 고른 지표 → 화면에 「변동 가능」 표시.

  python tools/lead_patch.py <review 폴더> <fetch 폴더>
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAD = os.path.join(ROOT, "docs", "data", "jp", "lead")
MAC = os.path.join(LEAD, "macro")


def norm(s):
    return re.sub(r"[\s·()（）「」:：\-—,]", "", str(s or "")).lower()


def load(folder):
    out = {}
    for f in glob.glob(os.path.join(folder, "out_*.json")):
        for c, x in json.load(open(f, encoding="utf-8")).items():
            if isinstance(x, dict):
                out[c] = x
    return out


rev, fet = load(sys.argv[1]), load(sys.argv[2])
al = json.load(open(os.path.join(MAC, "index.json"), encoding="utf-8"))["alias"]
# 공용 파일 별칭 다시(새 macro 파일 반영)
for f in glob.glob(os.path.join(MAC, "*.json")):
    if f.endswith("index.json"):
        continue
    try:
        d = json.load(open(f, encoding="utf-8"))
    except Exception:
        print("못 읽음", f)
        continue
    fid = d.get("id") or os.path.basename(f)[:-5]
    for s in d.get("series") or []:
        al["%s#%s" % (fid, s.get("key"))] = {"file": os.path.basename(f), "key": s.get("key"), "yoy": bool(s.get("yoy"))}
    if d.get("series"):
        al.setdefault(fid, {"file": os.path.basename(f), "key": d["series"][0].get("key"), "yoy": False})
ix = json.load(open(os.path.join(MAC, "index.json"), encoding="utf-8"))
ix["alias"] = al
json.dump(ix, open(os.path.join(MAC, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

st = {"drop": 0, "drop_miss": 0, "add": 0, "add_bad": 0, "pend": 0, "cos": 0}
for c in sorted(set(rev) | set(fet)):
    p = os.path.join(LEAD, c + ".json")
    if not os.path.exists(p):
        continue
    co = json.load(open(p, encoding="utf-8"))
    L = co["lead"]
    keep_kind = lambda i: i.get("kind") in ("pension", "monthly") or i.get("nenkin") or i.get("lk")
    for d in (rev.get(c) or {}).get("drop") or []:
        k = norm(d.get("name"))
        n0 = len(L["items"]) + len(L.get("macro") or [])
        L["items"] = [i for i in L["items"] if keep_kind(i) or (norm(i.get("t")) != k and norm(i.get("short")) != k)]
        L["macro"] = [m for m in L.get("macro") or [] if norm(m.get("name")) != k]
        if len(L["items"]) + len(L["macro"]) < n0:
            st["drop"] += 1
        else:
            st["drop_miss"] += 1
    fx = fet.get(c) or {}
    have = {norm(i.get("t")) for i in L["items"]} | {norm(m.get("name")) for m in L.get("macro") or []} | {m.get("id") for m in L.get("macro") or []}
    r0 = 1 + max([i.get("rank") or 0 for i in L["items"]] + [m.get("rank") or 0 for m in L.get("macro") or []] + [0])
    for k, a in enumerate(fx.get("add") or []):
        vol = bool(a.get("volatile"))
        if re.search(r"clarkson|클락슨", json.dumps(a, ensure_ascii=False), re.I):   # 재게시 금지 원천
            st["add_bad"] += 1
            continue
        if a.get("kind") == "series" and a.get("pts"):
            pts = [[q[0], q[1], "ext"] for q in a["pts"] if q and len(q) > 1 and q[1] is not None]
            if len(pts) < 6 or norm(a.get("name")) in have:
                st["add_bad"] += 1
                continue
            name = a["name"]
            L["items"].append({"id": "r%d" % (len(L["items"]) + k), "kind": "trends" if a.get("trend") else "ext", "rank": r0 + k * 0.1, "t": name, "short": name[:26], "nm": name[:18],
                               "unit": a.get("unit") or "", "entity": a.get("src", ""), "corp": "", "note": a.get("why", ""), "why": a.get("why", ""), "volatile": vol, "pts": pts,
                               "src": [{"doc": a.get("src", ""), "where": name, "freq": "월", "auto": "반자동", "how": "월 1회 다시 받기"}]})
            have.add(norm(name))
            st["add"] += 1
        elif a.get("kind") == "macro_ref":
            mid = "%s#%s" % (a.get("id"), a.get("key")) if a.get("key") else a.get("id")
            if mid not in al or mid in have:
                st["add_bad"] += 1
                continue
            L.setdefault("macro", []).append({"id": mid, "name": a.get("name") or "", "why": a.get("why", ""), "rank": r0 + k * 0.1, "volatile": vol})
            have.add(mid)
            st["add"] += 1
        else:
            st["add_bad"] += 1
    for q in fx.get("pending") or []:
        if re.search(r"환율 제외|제외 결정|생략|clarkson|클락슨", (q.get("reason") or "") + (q.get("name") or ""), re.I):
            continue
        L.setdefault("macro", []).append({"id": "wait:" + q.get("name", ""), "name": q.get("name", "") + "(수집 대기)", "why": q.get("why", ""), "reason": q.get("reason", ""), "volatile": bool(q.get("volatile"))})
        st["pend"] += 1
    note = (rev.get(c) or {}).get("note") or ""
    drv = (rev.get(c) or {}).get("driver") or ""
    if drv:
        L["pick_note"] = drv + (" " + note if note else "")
    co["log"] = [{"d": "2026-11-17", "by": "Claude", "t": "리포트 재검토 반영 — 판정 %s" % ((rev.get(c) or {}).get("verdict") or "")}] + co.get("log", [])
    json.dump(co, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    st["cos"] += 1
print(st)
