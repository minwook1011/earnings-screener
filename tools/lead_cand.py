# -*- coding: utf-8 -*-
"""선행지표 후보 채점 — 기업마다 「백테스트로 맞는, 매달 트래킹할 수 있는 지표」 찾기(2026-11-24 사용자)

  방식은 lead_bt_q(분기 정렬)와 같다: 그 분기 3개월 지표(월 성장률 평균)의 직전 분기 대비 변화 →
  그 분기 매출 전년비 성장률의 가속/감속을 맞혔나(실적 일치율). 주가 일치율도 같이 낸다(참고).

  후보   <D>/<코드>/cands.json  [{id, name, dir(+1/−1, 지표 성격으로 미리 정함), why, src, release(공표 시기 문구), kind, unit, pts:[[YYYY-MM, 값]…]}]
         + 그 회사 원장의 기존 지표(같이 채점 — 시험 횟수에 셈)
  실적   <D>/fin40/<코드>.json(40분기 캐시, fin 과 같은 형식) — 없으면 docs/data/jp/lead/fin/<코드>.json
  우연 걸러내기
         p1     = 일치 수가 이 이상 나올 확률(공정한 동전, 이항분포)
         p_best = 1 − (1 − p1)^N   N = 그 회사에서 채점한 지표 수(판정 분기 8개 이상) — 「N개 중 최고」라서
         등급  확정  일치율 ≥ 70% · 분기 ≥ 12 · p_best ≤ 0.05 · 뒤쪽 절반 일치율 ≥ 60%
               유망  일치율 ≥ 70% · 분기 ≥ 10 · p_best ≤ 0.20
               미달  그 밖
  결과   <D>/<코드>/score.json  · 화면 출력
  python tools/lead_cand.py <코드> [<D>]     D 기본 = tools/lead_cand_data(깃 제외)
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lead_bt as B  # noqa: E402
import lead_bt_q as Q  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
DEF_D = os.path.join(B.ROOT, "tools", "lead_cand_data")


def binom_tail(k, n):
    return sum(math.comb(n, i) for i in range(k, n + 1)) / 2 ** n


def score(c, D=DEF_D, quiet=False):
    co = json.load(open(os.path.join(B.LEAD, c + ".json"), encoding="utf-8"))
    kq = json.load(open(os.path.join(B.ROOT, "docs", "data", "jp", "kq.json"), encoding="utf-8"))
    f40 = os.path.join(D, "fin40", c + ".json")
    qs = Q.quarters(c, co, kq, f40 if os.path.exists(f40) else None)
    bx = Q.Px(Q.daily("1306.T", True))
    raw = Q.daily(c + ".T", True)
    px = Q.Px(raw) if raw and len(raw) > 200 else None
    alias = json.load(open(os.path.join(B.MAC, "index.json"), encoding="utf-8"))["alias"]
    cands = []
    cp = os.path.join(D, c, "cands.json")
    if os.path.exists(cp):
        for x in json.load(open(cp, encoding="utf-8")):
            cands.append(("new:" + str(x["id"]), x.get("name") or x["id"], x.get("kind") or "", x.get("pts") or [], x.get("unit") or "",
                          int(x.get("dir") or 1), x.get("release") or "", x.get("why") or "", x.get("src") or ""))
    roles = {("i:" + str(it.get("id"))): it.get("role") for it in co["lead"]["items"]}
    roles.update({("m:" + m["id"]): m.get("role") for m in co["lead"].get("macro") or []})
    for key, name, kind, pts, unit in B.indicators(c, co, alias, {}):
        d, _ = Q.direction(name, kind, roles.get(key))
        rel = ""
        if key.startswith("m:") and alias.get(key[2:]):
            try:
                rel = json.load(open(os.path.join(B.MAC, alias[key[2:]]["file"]), encoding="utf-8")).get("release") or ""
            except (OSError, ValueError):
                pass
        cands.append(("old:" + key, name, kind, pts, unit, d, rel, "기존 원장 지표", ""))
    res = []
    for key, name, kind, pts, unit, d, rel, why, src in cands:
        x = B.monthly(pts)
        if not x or not qs:
            res.append({"key": key, "name": name, "ne": 0, "grade": "na", "why": why})
            continue
        av, awhy = Q.avail_rule(kind, name, rel)
        r = Q.evaluate(x, unit, qs, px, bx, d, av)
        rows = [z for z in r["rows"] if z[7] is not None]
        half = rows[len(rows) // 2:]
        h2 = sum(1 for z in half if z[7]) / len(half) if half else None
        res.append({"key": key, "name": name, "dir": d, "why": why, "src": src, "awhy": awhy, "ne": r["ne"], "np": r["np"],
                    "er": r["er"], "pr": r["pr"], "h2": h2, "hits": sum(1 for z in rows if z[7]),
                    "span": [rows[0][1], rows[-1][1]] if rows else None, "rows": r["rows"]})
    N = max(1, sum(1 for r in res if r["ne"] >= 8))
    for r in res:
        if r["ne"] < 8:
            r.setdefault("grade", "hold")
            continue
        p1 = binom_tail(r["hits"], r["ne"])
        r["p1"], r["pbest"] = p1, 1 - (1 - p1) ** N
        if r["er"] >= 0.70 and r["ne"] >= 12 and r["pbest"] <= 0.05 and (r["h2"] or 0) >= 0.60:
            r["grade"] = "확정"
        elif r["er"] >= 0.70 and r["ne"] >= 10 and r["pbest"] <= 0.20:
            r["grade"] = "유망"
        else:
            r["grade"] = "미달"
    order = {"확정": 0, "유망": 1, "미달": 2, "hold": 3, "na": 4}
    res.sort(key=lambda r: (order[r["grade"]], -(r.get("er") or 0), -r["ne"]))
    out = {"c": c, "n_tested": N, "n_quarters_fin": len(qs), "best": res[0]["key"] if res and res[0]["grade"] in ("확정", "유망") else None, "items": res}
    os.makedirs(os.path.join(D, c), exist_ok=True)
    json.dump(out, open(os.path.join(D, c, "score.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    if not quiet:
        print(f"{c} {co.get('n')} — 실적 {len(qs)}분기 · 채점 지표 {N}개(8분기↑)")
        for r in res:
            if r["grade"] == "na":
                continue
            print(f"  [{r['grade']}] {r['name'][:34]:34s} 실적 {('-' if r.get('er') is None else round(r['er']*100))}% ({r.get('hits','-')}/{r['ne']}) "
                  f"뒤절반 {('-' if r.get('h2') is None else round(r['h2']*100))}% 주가 {('-' if r.get('pr') is None else round(r['pr']*100))}%({r.get('np',0)}) "
                  f"p_best {('-' if r.get('pbest') is None else round(r['pbest'], 3))} {r['key']}")
    return out


if __name__ == "__main__":
    score(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else DEF_D)
