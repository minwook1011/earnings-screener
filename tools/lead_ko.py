# -*- coding: utf-8 -*-
"""일본어 지표명 → 한국어(lead_ko.json), thesis 를 「핵심지표: …」 로 (2026-11-17 사용자)."""
import glob, json, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAD = os.path.join(ROOT, "docs", "data", "jp", "lead")
MAC = os.path.join(LEAD, "macro")
MON = os.path.join(ROOT, "docs", "data", "jp", "monthly")
KO = json.load(open(os.path.join(ROOT, "tools", "lead_ko.json"), encoding="utf-8"))
GEN = {"합계", "전세계", "전체", "계", "총계", "total", "금액", "수출액", "수입액", "value"}
JP = re.compile("[぀-ヿ一-鿿]")


def tr(s):
    if not isinstance(s, str) or not s:
        return s
    if s in KO:
        return KO[s]
    m = re.match(r"(?:구글 )?검색 관심도 — 「?([^」(（]+)", s)
    if m:
        return "구글트렌드: " + m.group(1).strip()
    if JP.search(s):   # 일본어 괄호 설명은 떼어 낸다
        s3 = re.sub(r"\s*[（(][^()（）]*[぀-ヿ一-鿿][^()（）]*(?:[)）]|$)", "", s).strip()
        if s3 and s3 != s:
            return tr(s3)
    m = re.match(r"구글 검색 관심도 「(.+?)」", s)
    if m:
        return "구글트렌드: " + m.group(1)
    s2 = re.sub(r"\s*\(?HS ?[0-9.+]*\)?", "", s).strip()
    if s2 != s and s2:
        return tr(s2)
    if " — " in s:
        parts = [tr(p) for p in s.split(" — ")]
        if JP.search(parts[-1]):
            return " — ".join(parts)
        last, first = parts[-1], re.sub(r"\(.*?\)", "", parts[0]).strip()
        if last in GEN or last in first:
            return first
        if len(last) <= 5 or last.endswith("행") or last.endswith("산"):
            return "%s(%s)" % (first, last)
        return last
    return s


def clean(s):
    """잘린 괄호·HS 코드 조각 정리"""
    if not isinstance(s, str):
        return s
    s = re.sub(r"[·,]?\s*(?:HS ?)?\d{4}(?:\.\d+)?\)", ")", s)
    s = re.sub(r"\(\)", "", s)
    out, depth = [], 0
    for ch in s:   # 짝 없는 닫는 괄호 제거
        if ch == ")":
            if depth == 0:
                continue
            depth -= 1
        elif ch == "(":
            depth += 1
        out.append(ch)
    s = "".join(out)
    while s.count("(") > s.count(")"):
        i = s.rfind("(")
        s = s[:i].rstrip(" ·,—-")
    return s.strip()


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

AL = json.load(open(os.path.join(MAC, "index.json"), encoding="utf-8"))["alias"]
_mc = {}


def mfile(fn):
    if fn not in _mc:
        _mc[fn] = json.load(open(os.path.join(MAC, fn), encoding="utf-8"))
    return _mc[fn]


def label(mid):
    """공용 통계 표시 이름 — 시리즈 이름만으로 뜻이 서면 그것, 아니면 「파일: 시리즈」"""
    a = AL.get(mid)
    if not a:
        return None
    d = mfile(a["file"])
    se = [x for x in d.get("series") or [] if x.get("key") == a["key"]]
    F = tr(d.get("name") or "")
    S = tr(se[0].get("name") or "") if se else ""
    F0 = re.sub(r"\(.*?\)", "", F).strip()
    if not S or S in GEN or S == F or S in F0:
        return F0 or F
    if ":" in S:
        return S
    if F0.endswith("기종별") or F0 == "기종별":
        return "기계 수주: " + S
    if len(S) <= 5 or S.endswith("행") or S.endswith("산"):
        return "%s(%s)" % (F0, S)
    tri = lambda t: {t[i:i + 3] for i in range(len(t) - 2)}
    if tri(S) & tri(F0):
        return S
    return "%s: %s" % (F0, S)


left = set()
for f in glob.glob(os.path.join(LEAD, "*.json")):
    if f.endswith("index.json"):
        continue
    co = json.load(open(f, encoding="utf-8"))
    if "lead" not in co:
        continue
    names = []
    if os.path.exists(os.path.join(MON, os.path.basename(f))) or any(i.get("kind") == "monthly" for i in co["lead"]["items"]):
        names.append("월차데이터")
    for it in co["lead"]["items"]:
        for k in ("t", "short", "nm"):
            it[k] = clean(tr(it.get(k)))
        if it.get("kind") == "monthly":
            continue
        if it.get("kind") == "pension":
            names.append("연금 가입자 수")
        elif it.get("kind") == "trends" or (it.get("short") or "").startswith("구글") or (it.get("t") or "").startswith("구글트렌드"):
            tm = re.sub(r"^구글트렌드:\s*", "", it.get("short") or it.get("t") or "")
            names.append("구글트렌드: " + re.sub(r"\(.*?\)", "", tm).strip())
        elif it.get("short"):
            names.append(it["short"])
    for m in co["lead"].get("macro") or []:
        lb = label(m.get("id"))
        m["name"] = clean(lb or tr(m.get("name")))
        if m["name"].startswith("구글트렌드") or str(m.get("id", "")).startswith("gt:"):
            names.append("구글트렌드(브랜드)")
        elif lb:   # 데이터 있는 것만 핵심지표에
            names.append(m["name"])
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
