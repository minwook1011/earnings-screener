# -*- coding: utf-8 -*-
"""선행지표 다시 고르기 결과 반영(2026-11-16 사용자) — 기업마다 고른 외부 지표(데이터 포함)를 원장에 넣는다.

  입력 out_*.json: {코드: {sub, lead:[{kind:"macro_ref", id, key, rank, why} | {kind:"series", name, unit, src, why, rank, pts}], note}}
  - 연금 가입자 수는 SI·컨설팅 섹터에만 남기고 나머지는 지운다(사용자: 인력이 매출을 정하는 곳만).
  - macro_ref → lead.macro(id = "<파일id>#<key>"), docs/data/jp/lead/macro/index.json 별칭을 파일·시리즈마다 다시 만든다.
  - series → lead.items(kind "ext") 에 값 그대로.
  - 기업별 결과표(지표·이유·R) 를 --report 경로에 마크다운으로.

  python tools/lead_apply.py [--report out.md] out_1.json …
"""
import glob
import json
import os
import statistics
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAD = os.path.join(ROOT, "docs", "data", "jp", "lead")
MAC = os.path.join(LEAD, "macro")
KEEP_PENSION = {"consult", "advisory", "think", "si"}


def macro_index():
    ix = json.load(open(os.path.join(MAC, "index.json"), encoding="utf-8")) if os.path.exists(os.path.join(MAC, "index.json")) else {"alias": {}}
    al = ix.get("alias", {})
    files = {}
    for f in glob.glob(os.path.join(MAC, "*.json")):
        fn = os.path.basename(f)
        if fn == "index.json":
            continue
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            print("못 읽음", fn)
            continue
        files[d.get("id") or fn[:-5]] = (fn, d)
        for s in d.get("series") or []:
            al["%s#%s" % (d.get("id") or fn[:-5], s.get("key"))] = {"file": fn, "key": s.get("key"), "yoy": bool(s.get("yoy"))}
            if s.get("alias"):
                al.setdefault(s["alias"], {"file": fn, "key": s.get("key"), "yoy": bool(s.get("yoy"))})
        if d.get("series"):
            al.setdefault(d.get("id") or fn[:-5], {"file": fn, "key": d["series"][0].get("key"), "yoy": bool(d["series"][0].get("yoy"))})
    ix["alias"] = al
    json.dump(ix, open(os.path.join(MAC, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return al, files


def qlab(fy_end, ym):
    y, m = int(ym[:4]), int(ym[5:7])
    fy = y + (1 if m > fy_end else 0)
    off = (m - fy_end - 1) % 12
    return "%02d.%dQ" % (fy % 100, off // 3 + 1)


def r_value(co, pts, pct):
    sales = {p[0]: p[1] for p in co["series"]["sales"]["pts"]}
    def yoy(q):
        a, b = sales.get(q), sales.get("%02d.%sQ" % (int(q[:2]) - 1, q[3]))
        return (a / b - 1) * 100 if a is not None and b else None
    g = {}
    for ym, v, *_ in pts:
        if v is None:
            continue
        g.setdefault(qlab(co["fy"]["end_month"], ym), []).append(v)
    xs, ys = [], []
    for q, v in g.items():
        if len(v) < 3:
            continue
        s = yoy(q) if pct else sales.get(q)
        if s is not None:
            xs.append(sum(v) / len(v))
            ys.append(s)
    if len(xs) < 4:
        return None, len(xs)
    try:
        return statistics.correlation(xs, ys), len(xs)
    except Exception:
        return None, len(xs)


def main():
    args = sys.argv[1:]
    rep = None
    if "--report" in args:
        i = args.index("--report")
        rep = args[i + 1]
        args = args[:i] + args[i + 2:]
    al, files = macro_index()
    idx = json.load(open(os.path.join(LEAD, "index.json"), encoding="utf-8"))
    lines = []
    for f in args:
        for code, x in json.load(open(f, encoding="utf-8")).items():
            p = os.path.join(LEAD, code + ".json")
            if not os.path.exists(p):
                continue
            co = json.load(open(p, encoding="utf-8"))
            sub = co["sec"].split("/")[1]
            items = [i for i in co["lead"]["items"] if i.get("kind") == "pension" and sub in KEEP_PENSION]
            macro, out = [], []
            for L in sorted(x.get("lead") or [], key=lambda l: l.get("rank") or 9):
                if L.get("kind") == "series" and L.get("pts"):
                    pts = [[q[0], q[1], "ext"] for q in L["pts"] if q and q[1] is not None]
                    it = {"id": "x%d" % len(items), "kind": "ext", "rank": L.get("rank"), "t": L["name"], "short": L["name"][:22], "nm": L["name"][:16], "unit": L.get("unit") or "",
                          "entity": L.get("src", ""), "corp": "", "note": L.get("why", ""), "why": L.get("why", ""), "pts": pts,
                          "src": [{"doc": L.get("src", ""), "where": L["name"], "freq": "월", "auto": "반자동", "how": "조사 시점 수집 — 월 1회 클로드 예약 작업으로 갱신 예정"}]}
                    items.append(it)
                    r, n = r_value(co, pts, (L.get("unit") or "") == "%")
                    out.append((L.get("rank"), L["name"], L.get("why", ""), r, n, len(pts)))
                elif L.get("kind") == "macro_ref":
                    key = "%s#%s" % (L.get("id"), L.get("key")) if L.get("key") else L.get("id")
                    if key not in al and L.get("id") in al:
                        key = L["id"]
                    if key in al:
                        fn = al[key]["file"]
                        d = json.load(open(os.path.join(MAC, fn), encoding="utf-8"))
                        se = [s for s in d["series"] if s.get("key") == al[key]["key"]][0]
                        useY = al[key]["yoy"] and se.get("yoy")
                        nm = d["name"] + (" — " + se["name"] if se.get("name") else "")
                        macro.append({"id": key, "name": nm, "why": L.get("why", ""), "rank": L.get("rank")})
                        r, n = r_value(co, se["yoy"] if useY else se["pts"], useY or se.get("unit") == "%")
                        out.append((L.get("rank"), nm, L.get("why", ""), r, n, len(se["pts"])))
                    else:
                        out.append((L.get("rank"), "(데이터 없음) " + str(L.get("id")), L.get("why", ""), None, 0, 0))
            co["lead"]["items"] = items
            co["lead"]["macro"] = macro
            co["lead"]["why"] = "회사 밖에서 매달 나오는 데이터 중 이 회사 매출을 먼저 보여 주는 것만 골랐다. 지표마다 이유가 붙어 있다."
            co["lead"]["caveat"] = "R은 분기로 묶어 잰 상관이라 분기 수가 적으면 참고용. 전년비(%) 지표는 매출 YoY 와 비교한다."
            co["lead"]["pick_note"] = x.get("note", "")
            co["log"] = [{"d": "2026-11-16", "by": "Claude", "t": "선행지표 다시 고름(회사별 외부 데이터) — " + "; ".join(o[1] for o in out)}] + [l for l in co.get("log", []) if "2단계 리포트 기업으로 추가" not in l.get("t", "")]
            json.dump(co, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            lines.append("### %s (%s) — %s\n" % (co["n"], code, co["sec"]) + ("".join("- **%s** — %s · R %s (n=%d분기, %d개월)\n" % (o[1], o[2], ("%.2f" % o[3]) if o[3] is not None else "—", o[4], o[5]) for o in out) or "- 외부 지표 없음\n") + ("  - 메모: %s\n" % x["note"] if x.get("note") else ""))
    # 섹터 SI·컨설팅 밖 기업의 연금 가입자 제거(이번에 안 다룬 기업도)
    for c, o in idx["cos"].items():
        if o["sec"].split("/")[1] in KEEP_PENSION:
            continue
        p = os.path.join(LEAD, c + ".json")
        co = json.load(open(p, encoding="utf-8"))
        n0 = len(co["lead"]["items"])
        co["lead"]["items"] = [i for i in co["lead"]["items"] if i.get("kind") != "pension"]
        if len(co["lead"]["items"]) != n0:
            json.dump(co, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if rep:
        open(rep, "w", encoding="utf-8").write("\n".join(lines))
    print("반영", len(lines), "곳")


if __name__ == "__main__":
    main()
