# -*- coding: utf-8 -*-
"""IR 자료실 찾기 결과(tools/tg_raw/irfound_*.json) → deck_src.json(via ir) + ir_src.json(감시 도구용). 한 번 쓰는 합치기."""
import glob, json, os
T = os.path.dirname(os.path.abspath(__file__))
ds = json.load(open(os.path.join(T, "deck_src.json"), encoding="utf-8"))
src = json.load(open(os.path.join(T, "ir_src.json"), encoding="utf-8"))
k = {"ir": 0, "ir_ok": 0, "none": 0}
for f in sorted(glob.glob(os.path.join(T, "tg_raw", "irfound_*.json"))):
    for c, e in json.load(open(f, encoding="utf-8")).items():
        it = ds["items"].setdefault(c, {})
        if e.get("via") == "ir" and e.get("lib"):
            it.update(via="ir", lib=e["lib"], ok=bool(e.get("ok")), note=e.get("note", ""))
            if e.get("latest"):
                it["latest"] = e["latest"]
            s = src.get(c, {})
            if not s.get("lib") or not s.get("ok", True):
                src[c] = {"lib": e["lib"], "cal": s.get("cal", ""), "found": "2026-11-15", "ok": bool(e.get("ok")), "note": e.get("note", "")}
            k["ir"] += 1; k["ir_ok"] += bool(e.get("ok"))
        else:
            it.update(via="none", note=e.get("note", ""))
            k["none"] += 1
json.dump(ds, open(os.path.join(T, "deck_src.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
json.dump(src, open(os.path.join(T, "ir_src.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
v = {}
for e in ds["items"].values():
    v[e.get("via")] = v.get(e.get("via"), 0) + 1
print(k, v)
