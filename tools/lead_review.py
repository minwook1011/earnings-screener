# -*- coding: utf-8 -*-
"""선행지표 검토(2026-11-16 사용자: 이유 선정을 잘 고려해서) — 지표마다 시차 0~2분기의 R(전년비끼리) 을 재서 실제로 앞서는지 본다.

  지표(분기 평균)를 k분기 앞으로 당겨 매출(전년비 지표면 매출 YoY)과 상관을 잰다.
  k=1 이 가장 높으면 「1분기(약 3개월) 먼저 움직인다」.
  판정: |R| ≥ 0.6 · n ≥ 6 = 강함 / ≥ 0.4 = 보통 / 그 아래 = 약함. R 이 음수면 반대로 움직임(공실률 같은 역지표는 정상일 수 있음).
  결과는 원장 lead.review 에 쓰고(--write), 마크다운 표를 --report 에.

  python tools/lead_review.py [--write] [--report out.md] [코드 …]
"""
import json
import os
import statistics
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAD = os.path.join(ROOT, "docs", "data", "jp", "lead")
MAC = os.path.join(LEAD, "macro")


def qlab(fy_end, ym):
    y, m = int(ym[:4]), int(ym[5:7])
    fy = y + (1 if m > fy_end else 0)
    off = (m - fy_end - 1) % 12
    return fy * 4 + off // 3   # 분기 번호


def series_list(co, al):
    out = []
    for it in co["lead"]["items"]:
        if it.get("pts"):
            out.append((it.get("t") or it.get("short"), it["pts"], it.get("unit") == "%"))
    for m in co["lead"].get("macro") or []:
        a = al.get(m["id"])
        if not a:
            continue
        d = json.load(open(os.path.join(MAC, a["file"]), encoding="utf-8"))
        se = [s for s in d["series"] if s.get("key") == a["key"]]
        if not se:
            continue
        se = se[0]
        useY = a.get("yoy") and se.get("yoy")
        out.append((m.get("name") or m["id"], se["yoy"] if useY else se["pts"], bool(useY) or se.get("unit") == "%"))
    return out


def analyse(co, pts, pct):
    def qi(q): return (2000 + int(q[:2])) * 4 + int(q[3]) - 1
    sales = {qi(p[0]): p[1] for p in co["series"]["sales"]["pts"] if p[1] is not None}
    # 매출 전년비 vs 지표 전년비(전년비로 공표되는 지표는 그대로) — 계절성·추세를 빼고 방향만 비교
    tgt = {q: (v / sales[q - 4] - 1) * 100 for q, v in sales.items() if sales.get(q - 4)}
    g = {}
    for p in pts:
        if p[1] is None:
            continue
        g.setdefault(qlab(co["fy"]["end_month"], p[0]), []).append(p[1])
    lv = {q: sum(v) / len(v) for q, v in g.items() if len(v) == 3}
    x = lv if pct else {q: (v / lv[q - 4] - 1) * 100 for q, v in lv.items() if lv.get(q - 4)}
    res = []
    for k in range(3):
        xs, ys = [], []
        for q, v in tgt.items():
            if q - k in x:
                xs.append(x[q - k])
                ys.append(v)
        r = None
        if len(xs) >= 4:
            try:
                r = statistics.correlation(xs, ys)
            except Exception:
                r = None
        res.append((k, r, len(xs)))
    ok = [t for t in res if t[1] is not None]
    best = max(ok, key=lambda t: abs(t[1])) if ok else (0, None, 0)
    a = abs(best[1]) if best[1] is not None else 0
    verdict = "판단 불가(분기 부족)" if best[1] is None or best[2] < 6 else "강함" if a >= 0.6 and best[2] >= 8 else "보통" if a >= 0.4 else "약함"
    return res, best, verdict


def main():
    args = sys.argv[1:]
    write = "--write" in args
    rep = None
    if "--report" in args:
        i = args.index("--report")
        rep = args[i + 1]
        args = args[:i] + args[i + 2:]
    codes = [a for a in args if not a.startswith("--")]
    al = json.load(open(os.path.join(MAC, "index.json"), encoding="utf-8"))["alias"]
    idx = json.load(open(os.path.join(LEAD, "index.json"), encoding="utf-8"))
    lines, cnt = [], {}
    for c in codes or list(idx["cos"]):
        p = os.path.join(LEAD, c + ".json")
        co = json.load(open(p, encoding="utf-8"))
        rev = []
        rows = []
        for name, pts, pct in series_list(co, al):
            res, best, verdict = analyse(co, pts, pct)
            cnt[verdict] = cnt.get(verdict, 0) + 1
            rev.append({"name": name, "lag": best[0], "r": round(best[1], 2) if best[1] is not None else None, "n": best[2], "verdict": verdict,
                        "by_lag": [[k, round(r, 2) if r is not None else None, n] for k, r, n in res]})
            rows.append("| %s | %s | %s | %s | %s |" % (name[:40], " / ".join("%d:%s" % (k, ("%.2f" % r) if r is not None else "—") for k, r, n in res),
                                                     "%d분기" % best[0], ("%.2f" % best[1]) if best[1] is not None else "—", verdict))
        if write:
            co["lead"]["review"] = rev
            json.dump(co, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        lines.append("### %s (%s)\n| 지표 | 시차별 R(0~3분기) | 최적 시차 | R | 판정 |\n|---|---|---|---|---|\n%s\n" % (co["n"], c, "\n".join(rows) if rows else "| 지표 없음 | | | | |"))
    if rep:
        open(rep, "w", encoding="utf-8").write("\n".join(lines))
    print(cnt)


if __name__ == "__main__":
    main()
