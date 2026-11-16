# -*- coding: utf-8 -*-
"""일본어 지표명 → 한국어(lead_ko.json), thesis 를 「핵심지표: …」 로 (2026-11-17 사용자)."""
import glob, json, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAD = os.path.join(ROOT, "docs", "data", "jp", "lead")
MAC = os.path.join(LEAD, "macro")
MON = os.path.join(ROOT, "docs", "data", "jp", "monthly")
KO = json.load(open(os.path.join(ROOT, "tools", "lead_ko.json"), encoding="utf-8"))
JP = re.compile("[぀-ヿ一-鿿]")


def tr(s):
    if not isinstance(s, str) or not s:
        return s
    if s in KO:
        return KO[s]
    m = re.match(r"구글 검색 관심도 「(.+?)」", s)
    if m:
        return "구글트렌드: " + m.group(1)
    s2 = re.sub(r"\s*\(?HS ?[0-9.+]*\)?", "", s).strip()
    if s2 != s and s2:
        return tr(s2)
    if " — " in s:
        parts = [tr(p) for p in s.split(" — ")]
        return parts[-1] if not JP.search(parts[-1]) else " — ".join(parts)
    return s


def dump(p, d):
    json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


for f in glob.glob(os.path.join(MAC, "*.json")):
    if f.endswith("index.json"):
        continue
    d = json.load(open(f, encoding="utf-8"))
    d["name"] = tr(d.get("name"))
    for s in d.get("series") or []:
        s["name"] = tr(s.get("name"))
    dump(f, d)

left = set()
for f in glob.glob(os.path.join(LEAD, "*.json")):
    if f.endswith("index.json"):
        continue
    co = json.load(open(f, encoding="utf-8"))
    names = []
    if os.path.exists(os.path.join(MON, os.path.basename(f))):
        names.append("월차데이터")
    for it in co["lead"]["items"]:
        for k in ("t", "short", "nm"):
            it[k] = tr(it.get(k))
        if it.get("kind") == "pension":
            names.append("연금 가입자 수")
        elif it.get("kind") == "trends" or (it.get("short") or "").startswith("구글"):
            names.append("구글트렌드(브랜드)")
        elif it.get("short"):
            names.append(it["short"])
    for m in co["lead"].get("macro") or []:
        m["name"] = tr(m.get("name"))
        names.append("구글트렌드(브랜드)" if m["name"].startswith("구글트렌드") else m["name"])
    for n in names:
        if n and JP.search(n):
            left.add(n)
    seen = []
    for n in names:
        if n and n not in seen:
            seen.append(n)
    co["thesis"] = "핵심지표: " + (", ".join(seen) if seen else "아직 없음")
    dump(f, co)
print("번역 안 된 것", len(left))
for x in sorted(left):
    print(" ", x)
