# -*- coding: utf-8 -*-
"""기업별 「백테스트로 맞는 선행지표」 결과를 원장에 반영(2026-11-24 사용자 승인 「ㅇㅇ ㄱㄱ」, 원자재 가격 포함)

  입력  tools/lead_cand_data/_result_all.json (기업별 채점 모음) + <코드>/cands.json(새 후보 시계열)
  규칙  - 확정·유망 기업만 손댄다. 미달·보류 기업은 원장 그대로.
        - 1위 지표가 새 후보면 원장 items 에 붙이고 맨 앞(rank 0.5)에 둔다 → 「키 데이터」가 된다.
        - 1위 지표가 원장 기존 지표(i:·m:)면 그 지표를 맨 앞으로 올리고 등급만 단다.
        - 원장 기존 지표 중 확정·유망이 나온 것에는 모두 등급(bt)을 단다.
        - 그 회사 자신의 월차(kind monthly)는 건드리지 않는다.
  bt    {g: 확정|유망, er: 일치율 %, h: 맞힌 분기, n: 판정 분기, d: 채점일}

  python tools/lead_cand_apply.py [--dry]
"""
import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAD = os.path.join(ROOT, "docs", "data", "jp", "lead")
D = os.path.join(ROOT, "tools", "lead_cand_data")
DAY = "2026-11-25"
DRY = "--dry" in sys.argv

R = json.load(open(os.path.join(D, "_result_all.json"), encoding="utf-8"))
st = {"co": 0, "new": 0, "old_top": 0, "old_tag": 0, "miss": 0}
for r in R:
    if r["grade"] not in ("확정", "유망") or not r["items"]:
        # 다시 채점해 미달·보류가 된 곳은 예전 등급 표시를 지운다(2026-11-25 2차 — 긴 이력으로 우연이 드러난 곳)
        p = os.path.join(LEAD, r["c"] + ".json")
        co = json.load(open(p, encoding="utf-8"))
        n0 = sum(1 for i in co["lead"]["items"] + (co["lead"].get("macro") or []) if i.get("bt"))
        if n0:
            for i in co["lead"]["items"] + (co["lead"].get("macro") or []):
                i.pop("bt", None)
            co["log"] = [{"d": DAY, "by": "Claude", "t": "긴 이력으로 다시 채점 — 백테스트 등급 해제(%s)" % r["grade"]}] + co.get("log", [])
            if not DRY:
                json.dump(co, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            st["cleared"] = st.get("cleared", 0) + 1
        continue
    c = r["c"]
    p = os.path.join(LEAD, c + ".json")
    co = json.load(open(p, encoding="utf-8"))
    L = co["lead"]
    L.setdefault("macro", [])
    for it in L["items"]:
        it.pop("bt", None)
    for m in L["macro"]:
        m.pop("bt", None)

    def bt(x):
        return {"g": x["grade"], "er": x["er"], "h": x["hits"], "n": x["ne"], "d": DAY}

    def find_old(key):
        _, typ, oid = key.split(":", 2)
        if typ == "i":
            return next((i for i in L["items"] if str(i.get("id")) == oid), None)
        return next((m for m in L["macro"] if str(m.get("id")) == oid), None)

    for x in r["items"]:   # 원장 기존 지표 등급 달기
        if x["key"].startswith("old:") and x["grade"] in ("확정", "유망"):
            o = find_old(x["key"])
            if o is not None:
                o["bt"] = bt(x)
                st["old_tag"] += 1
    top = r["items"][0]
    if top["key"].startswith("old:"):
        o = find_old(top["key"])
        if o is None:
            st["miss"] += 1
            print("못 찾음", c, top["key"])
            continue
        o["rank"] = 0.5
        st["old_top"] += 1
    else:
        cid = top["key"][4:]
        cs = json.load(open(os.path.join(D, c, "cands.json"), encoding="utf-8"))
        a = next((k for k in cs if str(k["id"]) == cid), None)
        if a is None:
            st["miss"] += 1
            print("후보 없음", c, cid)
            continue
        iid = "bt_" + cid
        L["items"] = [i for i in L["items"] if i.get("id") != iid]
        pts = [[q[0], q[1], "ext"] for q in a.get("pts") or [] if q and len(q) > 1 and q[1] is not None]
        name = a.get("name") or cid
        trend = (a.get("kind") == "trends")
        L["items"].append({"id": iid, "kind": "trends" if trend else "ext", "rank": 0.5, "t": name, "short": name[:26], "nm": name[:18],
                           "unit": a.get("unit") or "", "entity": a.get("src", ""), "corp": "", "note": a.get("why", ""), "why": a.get("why", ""),
                           "volatile": False, "dir": a.get("dir", 1), "bt": bt(top), "pts": pts,
                           "src": [{"doc": a.get("src", ""), "where": name, "freq": "월", "auto": "수동",
                                    "how": "조사 시점 수집(" + DAY + ") — 공표: " + (a.get("release") or "모름")}]})
        st["new"] += 1
    # 1위 말고 다른 지표가 rank 0.5 이하면 한 칸 뒤로
    for i in L["items"] + L["macro"]:
        if i.get("rank") is not None and i["rank"] <= 0.5 and not (i is (o if top["key"].startswith("old:") else None)) and i.get("id") != ("bt_" + top["key"][4:]):
            i["rank"] = 0.9
    co["log"] = [{"d": DAY, "by": "Claude", "t": "백테스트로 맞는 선행지표 반영 — %s %d%%(%d/%d) %s" % (top["grade"], top["er"], top["hits"], top["ne"], top["name"])}] + co.get("log", [])
    if not DRY:
        json.dump(co, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    st["co"] += 1
print(st)
