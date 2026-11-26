# -*- coding: utf-8 -*-
"""선행지표 알림 후보 기준 비교(2026-11-26 사용자) — 여러 단순 기준을 한꺼번에 백테스트하고 주당 몇 개 잡히는지 본다.

  사용자: 「3개월 연속 상승, 기준값 돌파, 평소 대비 z 3배, 기울기 … 여러 가지 기준을 세워 보고,
           백테스트했을 때 주에 몇 개 잡히나 — 주 알림으로 받을 것, 지표 일정 정도만 매주 보게」

  지표 → 전년비 g(lead_bt.growth) · 3개월 평균 g3 · 원값 3개월선 m3 · 12개월선 m12. 원가 지표는 g 부호를 뒤집음(원가 하락 = 개선).
  그 달까지의 값만 사용. 같은 회사·지표·기준은 3개월 안에 다시 울리지 않음. 개선 쪽만(주 알림 = 좋아지는 신호).

  기준(RULES 참고) — 연속 상승 · 기준값 돌파 · z(평소 대비 몇 배) · 기울기 · 조합
  진입·수익률·비교선은 lead_alert_bt 와 같음(공표일 다음 거래일 종가, 3일~1년, TOPIX 대비).
  점수(주당 상위 N 고르기용) = min(세기,6) × (키 데이터 1.3) × (매출 일치율 65%↑ 1.2, 55% 이하 0.8)

  python tools/lead_alert_rules.py <출력.json>
"""
import collections
import datetime as dt
import json
import math
import os
import statistics as st
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lead_bt as B          # noqa: E402
import lead_bt_q as Q        # noqa: E402
import lead_alert_bt as A    # noqa: E402

LEAD, MAC, HZ, HZN = A.LEAD, A.MAC, A.HZ, A.HZN

RULES = [
    ("U3", "3개월 연속 상승", "전년비가 3개월 연속 오르고 플러스"),
    ("U3M", "3개월선 3연속 상승", "3개월 평균 전년비가 3개월 연속 오르고 플러스"),
    ("X0", "0 돌파", "3개월 평균 전년비가 마이너스 → 플러스"),
    ("X10", "+10% 돌파", "3개월 평균 전년비가 +10% 아래 → 위"),
    ("Z3", "한 달 z≥3", "이번 달 전년비가 직전 3개월 평균보다 평소 변화폭의 3배 넘게 뜀, 플러스"),
    ("Z3M", "3개월 z≥3", "3개월 평균 전년비의 3개월 변화가 평소의 3배 넘음, 상승 중"),
    ("Z2U", "z≥2 + 3연속", "3개월 변화 z≥2 이고 3개월 평균 전년비 3개월 연속 상승"),
    ("GC", "추세선 돌파", "원값 3개월선이 12개월선을 아래 → 위로 뚫음, 전년비 플러스"),
    ("SL2", "기울기 z≥2", "원값 3개월선의 3개월 기울기가 평소의 2배 넘고 오름, 전년비 플러스"),
    ("RB", "바닥 반등", "3개월 평균 전년비가 0 돌파 + 직전 12개월 최저 −5% 이하 + 2개월 연속 상승"),
    ("HI", "2년 최고", "3개월 평균 전년비가 24개월 최고, 플러스, 3개월 연속 상승"),
]
RID = {r[0]: i for i, r in enumerate(RULES)}


def zl(hist, x, floor=0.5):
    if len(hist) < 18:
        return None
    h = hist[-36:]
    med = st.median(h)
    mad = st.median([abs(v - med) for v in h])
    sd = max(1.4826 * mad, 0.25 * (st.median([abs(v) for v in h]) or 0), floor)
    return (x - med) / sd


def hits(x, sgn):
    """{월: [(기준, 세기)]}"""
    g, _ = B.growth(x, "")
    if not g:
        return {}
    if sgn < 0:
        g = {k: -v for k, v in g.items()}
    ks = sorted(g)
    g3 = {k: (g[k] + g[k - 1] + g[k - 2]) / 3 for k in ks if (k - 1) in g and (k - 2) in g}
    xs = sorted(x)
    m3 = {k: sum(x[k - i] for i in range(3)) / 3 for k in xs if all((k - i) in x for i in range(3))}
    m12 = {k: sum(x[k - i] for i in range(12)) / 12 for k in xs if all((k - i) in x for i in range(12))}
    pos = min(x.values()) > 0
    sl = {k: (math.log(m3[k] / m3[k - 3]) * 100 if pos else m3[k] - m3[k - 3]) * (1 if sgn > 0 else -1) for k in m3 if (k - 3) in m3 and (not pos or (m3[k] > 0 and m3[k - 3] > 0))}
    ad = {k: g[k] - (g[k - 1] + g[k - 2] + g[k - 3]) / 3 for k in ks if all((k - i) in g for i in (1, 2, 3))}
    bd = {k: g3[k] - g3[k - 3] for k in g3 if (k - 3) in g3}
    out = collections.defaultdict(list)
    adk, bdk, slk = sorted(ad), sorted(bd), sorted(sl)
    for k in ks:
        r = []
        up3 = all((k - i) in g for i in range(4)) and g[k] > g[k - 1] > g[k - 2] > g[k - 3]
        if up3 and g[k] > 0:
            r.append(("U3", g[k] - g[k - 3]))
        u3m = all((k - i) in g3 for i in range(4)) and g3[k] > g3[k - 1] > g3[k - 2] > g3[k - 3]
        if k in g3 and u3m and g3[k] > 0:
            r.append(("U3M", g3[k] - g3[k - 3]))
        if k in g3 and (k - 1) in g3:
            if g3[k - 1] <= 0 < g3[k]:
                r.append(("X0", g3[k] - g3[k - 1]))
                past = [g3[j] for j in range(k - 12, k) if j in g3]
                if (k - 2) in g3 and g3[k - 1] > g3[k - 2] and past and min(past) <= -5:
                    r.append(("RB", g3[k] - min(past)))
            if g3[k - 1] <= 10 < g3[k]:
                r.append(("X10", g3[k] - g3[k - 1]))
        if k in ad:
            z = zl([ad[j] for j in adk if j < k], ad[k])
            if z is not None and z >= 3 and g[k] > 0:
                r.append(("Z3", z))
        zb = None
        if k in bd:
            zb = zl([bd[j] for j in bdk if j < k], bd[k])
            if zb is not None and zb >= 3 and (k - 1) in g3 and g3[k] > g3[k - 1]:
                r.append(("Z3M", zb))
            if zb is not None and zb >= 2 and u3m:
                r.append(("Z2U", zb))
        if k in m3 and k in m12 and (k - 1) in m3 and (k - 1) in m12 and k in g and g[k] > 0:
            a0, a1 = sgn * (m3[k - 1] - m12[k - 1]), sgn * (m3[k] - m12[k])
            if a0 <= 0 < a1:
                r.append(("GC", 1.5))
        if k in sl and k in g and g[k] > 0 and sl[k] > 0:
            z = zl([sl[j] for j in slk if j < k], sl[k])
            if z is not None and z >= 2:
                r.append(("SL2", z))
        if k in g3 and g3[k] > 0 and u3m:
            prev = [g3[j] for j in range(k - 24, k) if j in g3]
            if len(prev) >= 20 and g3[k] > max(prev):
                r.append(("HI", 2.0))
        if r:
            out[k] = r
    return out


def main(out_path):
    ix = json.load(open(os.path.join(LEAD, "index.json"), encoding="utf-8"))
    alias = json.load(open(os.path.join(MAC, "index.json"), encoding="utf-8")).get("alias", {})
    cards = {x["c"]: x for x in json.load(open(os.path.join(LEAD, "cards.json"), encoding="utf-8"))["cards"]}
    bx = Q.Px(Q.daily("1306.T", True))
    rel_txt = {}

    def release_of(mid):
        a = alias.get(mid)
        if not a:
            return ""
        if a["file"] not in rel_txt:
            try:
                rel_txt[a["file"]] = json.load(open(os.path.join(MAC, a["file"]), encoding="utf-8")).get("release") or ""
            except (OSError, ValueError):
                rel_txt[a["file"]] = ""
        return rel_txt[a["file"]]

    def fwd(px, d):
        a = px.after(d)
        if a is None:
            return None
        ta = px.d[a]
        ia = bx.on_or_after(ta)
        if ia is None or bx.d[ia] != ta:
            return None
        r, xr = [], []
        for h in HZ:
            b, ib = a + h, ia + h
            if b < len(px.c) and ib < len(bx.c):
                ra, rb = px.c[b] / px.c[a] - 1, bx.c[ib] / bx.c[ia] - 1
                r.append(round(ra * 100, 1))
                xr.append(round((ra - rb) * 100, 1))
            else:
                r.append(None)
                xr.append(None)
        pre = round(((px.c[a - 1] / px.c[a - 21] - 1) - (bx.c[ia - 1] / bx.c[ia - 21] - 1)) * 100, 1) if a >= 21 and ia >= 21 else None
        return ta, r, xr, pre

    ind_tab, events, base = [], [], {}
    macf = {}
    for c in ix["cos"]:
        raw = Q.daily(c + ".T", True)
        if not raw or len(raw) < 300:
            continue
        try:
            co = json.load(open(os.path.join(LEAD, c + ".json"), encoding="utf-8"))
        except (OSError, ValueError):
            continue
        px = Q.Px(raw)
        cd = cards.get(c, {})
        sty_n = A.style_of(cd.get("sec") or "")
        kid = cd.get("kid")
        det = {}
        try:
            for xx in json.load(open(os.path.join(LEAD, "detail", c + ".json"), encoding="utf-8"))["items"]:
                det[xx["key"]] = xx
        except (OSError, ValueError, KeyError):
            pass
        meta_all = {("i:" + str(it.get("id"))): it for it in co["lead"]["items"]}
        meta_all.update({("m:" + m["id"]): m for m in co["lead"].get("macro") or []})
        for key, name, kind, pts, unit in B.indicators(c, co, alias, macf):
            x = B.monthly(pts)
            if len(x) < 30:
                continue
            meta = meta_all.get(key) or {}
            sgn, _ = Q.direction(name, kind, meta.get("role"))
            ik = "monthly" if key == "mon" else kind
            if ik == "monthly":
                av, awhy = (lambda e: Q.day_of(e + 1, 10)), "회사 월차 — 다음 달 10일 무렵"
            else:
                av, awhy = Q.avail_rule(ik, name, release_of(key[2:]) if key.startswith("m:") else "")
            dt_ = det.get(key) or next((v for kk, v in det.items() if kk.startswith(key)), None)
            hr = [dt_["lags"][0]["h"], dt_["lags"][0]["n"]] if dt_ and dt_.get("lags") and dt_["lags"][0]["n"] >= 10 else None
            is_key = kid is not None and key in ("i:" + str(kid), "m:" + str(kid))
            bt = (meta.get("bt") or {}).get("g") if isinstance(meta.get("bt"), dict) else None
            for k in sorted(x)[24:]:
                f = fwd(px, av(k))
                if f:
                    bb = base.setdefault(sty_n, [[] for _ in HZ])
                    for i, v in enumerate(f[2]):
                        if v is not None:
                            bb[i].append(v)
            H = hits(x, sgn)
            if not H:
                continue
            ii = len(ind_tab)
            used = False
            last = {}
            hrw = 1.0 if not hr else 1.2 if hr[0] / hr[1] >= 0.65 else 0.8 if hr[0] / hr[1] <= 0.55 else 1.0
            for k in sorted(H):
                d = av(k)
                f = None
                for rid, sv in H[k]:
                    if rid in last and k - last[rid] <= 3:
                        continue
                    last[rid] = k
                    if f is None:
                        f = fwd(px, d) or False
                    if not f:
                        continue
                    sc = round(min(abs(sv or 0), 6) * (1.3 if is_key else 1.0) * hrw, 2)
                    events.append([d, f[0], ii, RID[rid], round(sv, 1) if sv is not None else None, f[3], f[1], f[2], B.ms(k), sc])
                    used = True
            if used:
                ind_tab.append({"c": c, "k": key, "n": name[:60], "kind": ik, "key": is_key, "bt": bt, "cost": sgn < 0, "rel": awhy, "hr": hr})
            # ii 는 used 일 때만 맞도록 — 안 쓰였으면 이벤트도 없음
    cos = {c: {"n": cards[c]["n"], "sec": cards[c].get("sec"), "s": cards[c].get("s"), "g": cards[c].get("g"), "st": A.style_of(cards[c].get("sec"))}
           for c in {t["c"] for t in ind_tab} if c in cards}
    baseline = {k: {"med": [round(st.median(v), 2) if v else None for v in base[k]], "win": [round(sum(1 for a in v if a > 0) / len(v) * 100, 1) if v else None for v in base[k]],
                    "n": [len(v) for v in base[k]]} for k in base}
    events.sort(key=lambda e: e[0])

    # 기준별 요약: 주당 알림 수 · 수익률 · 전반(~2020)/후반(2021~)
    def week(d):
        t = dt.date.fromisoformat(d)
        return (t - dt.timedelta(days=t.weekday())).isoformat()
    W0, W1 = "2016-01-04", "2026-10-26"
    weeks_all = (dt.date.fromisoformat(W1) - dt.date.fromisoformat(W0)).days // 7 + 1
    R52 = (dt.date.fromisoformat(W1) - dt.timedelta(weeks=51)).isoformat()
    summ = []
    for i, (rid, nm, why) in enumerate(RULES):
        E = [e for e in events if e[3] == i and W0 <= e[0] <= "2026-11-01"]
        wk = collections.Counter(week(e[0]) for e in E)
        wkc = [wk.get((dt.date.fromisoformat(W0) + dt.timedelta(weeks=j)).isoformat(), 0) for j in range(weeks_all)]
        rec = [n for j, n in enumerate(wkc) if (dt.date.fromisoformat(W0) + dt.timedelta(weeks=j)).isoformat() >= R52]
        row = {"id": rid, "n": nm, "why": why, "cnt": len(E), "wk_avg": round(len(E) / weeks_all, 1), "wk_med": st.median(wkc), "wk_max": max(wkc),
               "wk_rec": round(sum(rec) / len(rec), 1), "cos_wk": round(len({(week(e[0]), ind_tab[e[2]]["c"]) for e in E}) / weeks_all, 1)}
        for part, lo, hi in (("all", "2000", "9999"), ("p1", "2000", "2020-12-31"), ("p2", "2021-01-01", "9999")):
            P = [e for e in E if lo <= e[0] <= hi]
            row[part] = []
            for h in (2, 3, 4, 5, 6):
                v = [e[7][h] for e in P if e[7][h] is not None]
                bw = collections.Counter(cos.get(ind_tab[e[2]]["c"], {}).get("st") for e in P if e[7][h] is not None)
                bl = sum(baseline[s]["med"][h] * n for s, n in bw.items() if s in baseline) / max(1, sum(n for s, n in bw.items() if s in baseline))
                row[part].append(None if not v else [round(st.median(v), 2), round(st.median(v) - bl, 2), round(sum(1 for a in v if a > 0) / len(v) * 100, 1), len(v)])
        summ.append(row)
    res = {"updated": json.load(open(os.path.join(LEAD, "cards.json"), encoding="utf-8")).get("updated"), "hz": HZN, "hzd": HZ,
           "rules": [{"id": r[0], "n": r[1], "why": r[2]} for r in RULES], "summary": summ, "weeks": weeks_all,
           "styles": {k: {"why": v["why"]} for k, v in A.STYLE.items()}, "sec2style": A.SEC2STYLE,
           "cos": cos, "ind": ind_tab, "ev": events, "base": baseline,
           "tree": [{"id": g["id"], "n": g["n"], "kids": [{"id": k["id"], "n": k["n"]} for k in g["kids"]]} for g in ix["tree"]]}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    print("지표", len(ind_tab), "알림", len(events), round(os.path.getsize(out_path) / 1e6, 2), "MB")
    print(f"{'기준':<14}{'건수':>7}{'주평균':>7}{'최근1년':>8}{'주중앙':>7}{'주최대':>7} | 초과 중앙값−비교선(%p)/승률: 1M 3M 6M | 전반 3M · 후반 3M")
    for r in summ:
        a = r["all"]
        f = lambda z: "  -  " if not z else f"{z[1]:+.1f}/{z[2]:.0f}%"
        print(f"{r['n']:<14}{r['cnt']:>7}{r['wk_avg']:>7}{r['wk_rec']:>8}{r['wk_med']:>7}{r['wk_max']:>7} | {f(a[1])} {f(a[2])} {f(a[3])} | {f(r['p1'][2])} · {f(r['p2'][2])}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get("TEMP", "."), "alert_rules.json"))
