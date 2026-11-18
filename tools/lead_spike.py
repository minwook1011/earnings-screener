# -*- coding: utf-8 -*-
"""선행지표 「튄 지표」 감지(2026-11-18 사용자) — docs/data/jp/lead/alerts.json 을 만든다.

  의도: 선행지표가 그 회사에 「좋은 쪽으로 의미 있게 꺾여 오르는」 순간을 잡는다(개선 신호).
        반대로 나빠지는 신호(수요·판가 지표 급락, 원가 지표 급등)는 경고로 따로 모은다.

  기준
  · 기울기 = 전월 대비 변화율(이미 %·YoY 인 지표는 %p 차이)
  · 계절 제거 = 같은 달의 과거 전월비 중앙값을 뺌(12월은 원래 오르는 만큼 빼고 봄) — %·YoY 지표는 안 뺌
  · z = (이번 달 기울기 − 평소 기울기) ÷ 평소 흔들림 폭 — 자기 지난 36개월 기준(중앙값·MAD) = 「평소의 몇 배」
  · 세 갈래
      ⚡ 빠른 신호  원값 z ≥ 3 · 전월비 + · YoY ≥ 0          (월차·구글트렌드만 — 빨리 아는 게 가치인 지표)
      ✅ 확인 신호  3개월선 기울기 z ≥ 2 · 3개월선 상승 · YoY ≥ 0 (전부)
      🔄 추세 전환  3개월선이 12개월선을 위로 뚫음 · YoY ≥ 0     (전부)
  · 최소 크기  트렌드 15% · 수출입 20% · 그 밖 비율 3% · %p 지표 2%p — 기울기가 이보다 작으면 z 가 커도 무시
  · 거름  자료 25개월 미만 · 마지막 값이 4개월보다 오래됨 · 최근 13개월에 0 이하 값(기저 0 근처) · 대수·척·건 단위 12개월 평균 20 미만
  · 원가 판정(기업×지표마다)  역할(role) 직접 지정 > 지표 YoY 와 매출 YoY 상관 ≤ −0.3 > 단가·물가류인데 영업이익 YoY 상관 ≤ −0.3 > 이름 단서(수입 단가·원료·연료·운임·임금)
      원가 지표는 개선 신호에서 빼고, 튀어 오르면 경고로 보낸다
  · 점수 = min(z,10) × 갈래 가중(전환 1.2·확인 1.0·빠름 0.8) × R 가중(|R|≥0.6 1.5·≥0.3 1.0·그 밖 0.5) × 키 데이터 1.3

  python tools/lead_spike.py          alerts.json 만들기
  python tools/lead_spike.py --top 20 상위 출력
"""
import collections
import datetime as dt
import glob
import json
import math
import os
import statistics as st
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
L = os.path.join(ROOT, "docs", "data", "jp", "lead")

MIN = {"trend": 15.0, "lumpy": 20.0, "ratio": 3.0, "level": 2.0}
COSTW = ("수입 단가", "수입단가", "원료", "원재료", "연료", "운임", "용선료", "임금", "인건비", "전기요금")
PRICEW = ("단가", "물가", "가격", "시세", "값")
COUNTU = ("대", "척", "건", "명", "곳")
LANE_W = {"cross": 1.2, "conf": 1.0, "fast": 0.8}


def jl(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def ym_add(ym, k):
    y, m = int(ym[:4]), int(ym[5:7]) - 1 + k
    return f"{y + m // 12}-{m % 12 + 1:02d}"


def ma(v, n):
    return [st.mean(v[max(0, i - n + 1):i + 1]) for i in range(len(v))]


def corr(a, b):
    if len(a) < 6:
        return None
    try:
        return st.correlation(a, b)
    except Exception:
        return None


def kind_of(nm, unit, ikind):
    if ikind == "trends" or nm.startswith("구글트렌드"):
        return "trend"
    if unit in ("%", "%p", "pt") or nm.endswith(("전년비", "YoY")):
        return "level"
    if any(w in nm for w in ("수출", "수입", "←", "→")) and not any(w in nm for w in PRICEW):
        return "lumpy"
    return "ratio"


def quarter_rows(pts, fin):
    """fin 분기(end 달)마다 그 분기 3개월 평균 지표"""
    m = {p[0]: p[1] for p in pts}
    out = []
    for r in fin:
        e = r.get("end")
        if not e:
            continue
        v = [m.get(ym_add(e, -i)) for i in range(3)]
        if all(x is not None for x in v):
            out.append((e, st.mean(v), r.get("s"), r.get("o")))
    return out


def r_level(pts, fin, pct):
    """사이트 칩과 같은 R — 분기 평균 지표 vs 분기 매출(전년비 지표는 매출 YoY)"""
    q = quarter_rows(pts, fin)
    by = {e: s for e, _, s, _ in q}
    sal = {r["end"]: r.get("s") for r in fin if r.get("end")}
    xs, ys = [], []
    for e, a, s, _ in q:
        if s is None:
            continue
        if pct:
            pv = sal.get(ym_add(e, -12))
            if not pv:
                continue
            s = (s / pv - 1) * 100
        xs.append(a)
        ys.append(s)
    return corr(xs, ys), len(xs)


def r_yoy(pts, fin, col):
    """지표 YoY vs 매출(또는 영업이익) YoY — 원가 판정용(추세 공유로 부풀지 않게)"""
    q = {e: (a, s, o) for e, a, s, o in quarter_rows(pts, fin)}
    xs, ys = [], []
    for e, (a, s, o) in q.items():
        p = q.get(ym_add(e, -12))
        if not p:
            continue
        cur, prv = (s, p[1]) if col == "s" else (o, p[2])
        if cur is None or prv is None or prv <= 0 or not p[0] or p[0] <= 0:
            continue
        xs.append(a / p[0] - 1)
        ys.append(cur / prv - 1)
    return corr(xs, ys)


def evaluate(pts, unit, nm, kd):
    """세 갈래 판정에 쓰는 숫자"""
    ymz = [p[0] for p in pts]
    v = [p[1] for p in pts]
    lvl = kd == "level"

    def slope(s):
        return [(s[i] - s[i - 1]) if lvl or s[i - 1] <= 0 else (s[i] / s[i - 1] - 1) * 100 for i in range(1, len(s))]

    def zscore(d):
        ms = [ymz[i][5:] for i in range(1, len(ymz))]
        by = collections.defaultdict(list)
        for m_, x in zip(ms[:-1], d[:-1]):
            by[m_].append(x)
        adj = [x - (st.median(by[m_]) if len(by[m_]) >= 2 and not lvl else 0) for m_, x in zip(ms, d)]
        h = adj[-37:-1]
        med = st.median(h)
        mad = st.median([abs(x - med) for x in h])
        sd = max(1.4826 * mad, 0.5 * (st.median([abs(x) for x in h]) or 0), 0.2 * MIN[kd], 1e-9)
        return (adj[-1] - med) / sd

    s3 = ma(v, 3)
    s12 = ma(v, 12)
    d1, d3 = slope(v), slope(s3)
    z1, z3 = zscore(d1), zscore(d3)
    if unit == "%" and lvl:
        yoy1, yoy3 = v[-1], s3[-1]
    elif lvl:
        yoy1, yoy3 = v[-1] - v[-13], s3[-1] - s3[-13]
    else:
        yoy1 = (v[-1] / v[-13] - 1) * 100 if v[-13] > 0 else None
        yoy3 = (s3[-1] / s3[-13] - 1) * 100 if s3[-13] > 0 else None
    return {"z1": z1, "z3": z3, "d1": d1[-1], "d3": d3[-1], "yoy1": yoy1, "yoy3": yoy3,
            "up_x": s3[-1] > s12[-1] and s3[-2] <= s12[-2], "dn_x": s3[-1] < s12[-1] and s3[-2] >= s12[-2],
            "spark": [[ymz[i], v[i], round(s3[i], 4)] for i in range(max(0, len(v) - 24), len(v))]}


def lanes(e, kd, fast_ok, sign, zf=3, zc=2, yoy_min=0, use=("fast", "conf", "cross")):
    """sign=+1 오름, −1 내림 — 갈래별 조건(백테스트로 고른 문턱은 main 에서 넘김)"""
    mn = MIN[kd]
    out = []
    y1, y3 = e["yoy1"], e["yoy3"]
    ok = (lambda y: y is not None and (y >= yoy_min if sign > 0 else y < 0))
    if "fast" in use and fast_ok and sign * e["z1"] >= zf and sign * e["d1"] > 0 and abs(e["d1"]) >= mn and ok(y1):
        out.append("fast")
    if "conf" in use and sign * e["z3"] >= zc and sign * e["d3"] > 0 and abs(e["d3"]) >= mn / 2 and ok(y3):
        out.append("conf")
    if "cross" in use and (e["up_x"] if sign > 0 else e["dn_x"]) and ok(y3):
        out.append("cross")
    return out


def main():
    today = dt.date.today()
    fresh_from = ym_add(f"{today.year}-{today.month:02d}", -4)
    alias = jl(os.path.join(L, "macro", "index.json")).get("alias", {})
    mfiles = {}

    def macro_series(mid):
        at = alias.get(mid)
        if not at:
            return None
        f = at["file"]
        if f not in mfiles:
            try:
                mfiles[f] = jl(os.path.join(L, "macro", f))
            except Exception:
                mfiles[f] = None
        d = mfiles[f]
        if not d:
            return None
        ss = d.get("series") or []
        se = next((x for x in ss if x.get("key") == at.get("key")), ss[0] if ss else None)
        if not se or not se.get("pts"):
            return None
        use_y = bool(at.get("yoy") and se.get("yoy"))
        return d, se, use_y

    groups = {}
    stats = collections.Counter()
    for p in sorted(glob.glob(os.path.join(L, "[0-9]*.json"))):
        c = os.path.basename(p)[:-5]
        try:
            d = jl(p)
        except Exception:
            continue
        ld = d.get("lead") or {}
        try:
            fin = jl(os.path.join(L, "fin", c + ".json")).get("q", [])
        except Exception:
            fin = []
        items = []
        for it in ld.get("items", []):
            if it.get("kind") == "macro":
                continue
            items.append({"id": it["id"], "nm": it.get("short") or it.get("t") or "", "unit": it.get("unit") or "", "kind": it.get("kind"),
                          "rank": it.get("rank"), "role": it.get("role"), "pts": it.get("pts") or [], "gkey": None})
        need = [m for m in ld.get("macro", []) if isinstance(m, dict) and m.get("id") in alias]
        for i, m in enumerate(need):
            ms = macro_series(m["id"])
            if not ms:
                continue
            md, se, use_y = ms
            items.append({"id": "m%d" % i, "nm": ((m.get("name") or se.get("name") or md.get("name") or "")[:26]) + (" YoY" if use_y else ""),
                          "unit": "%" if use_y else (se.get("unit") or ""), "kind": "macro", "rank": m.get("rank"), "role": m.get("role"),
                          "pts": se["yoy"] if use_y else se["pts"], "gkey": "M:" + md.get("id", m["id"]) + "#" + se.get("key", "") + ("/y" if use_y else "")})
        # 키 데이터 = 6개 점 이상 중 rank 가장 앞(사이트 bestIt 과 같게)
        key_id, key_rank = None, 99
        for it in items:
            pts = [x for x in it["pts"] if x and x[1] is not None]
            rk = 9 if it["rank"] is None else it["rank"]
            if len(pts) >= 6 and rk < key_rank:
                key_id, key_rank = it["id"], rk
        for it in items:
            pts = [[x[0], x[1]] for x in it["pts"] if x and x[1] is not None and len(str(x[0])) == 7]
            stats["기업×지표"] += 1
            if len(pts) < 25:
                stats["거름: 25개월 미만"] += 1
                continue
            if pts[-1][0] < fresh_from:
                stats["거름: 오래된 값"] += 1
                continue
            nm, unit = it["nm"], it["unit"]
            kd = kind_of(nm, unit, it["kind"])
            v = [x[1] for x in pts]
            if kd != "level" and min(v[-13:]) <= 0:
                stats["거름: 기저 0 근처"] += 1
                continue
            if unit in COUNTU and st.mean(v[-12:]) < 20:
                stats["거름: 대수 적음"] += 1
                continue
            pct = unit == "%"
            r, rn = r_level(pts, fin, pct)
            rs, ro = r_yoy(pts, fin, "s"), r_yoy(pts, fin, "o")
            role = it["role"]
            if not role:
                if rs is not None and rs <= -0.3:
                    role = "원가"
                elif any(w in nm for w in PRICEW) and ro is not None and ro <= -0.3:
                    role = "원가"
                elif (rs is None or abs(rs) < 0.3) and any(w in nm for w in COSTW):
                    role = "원가"
                else:
                    role = "수요"
            e = evaluate(pts, unit, nm, kd)
            fast_ok = it["kind"] in ("monthly", "trends") or kd == "trend"
            # 백테스트(2026-11-18, 3차)로 고른 기준 — 개선: R≥+0.6(분기 6개↑) · ✅(z≥1.5)+🔄 · YoY≥0 / 원가 급등: z≥2.5 · YoY≥+5% / ⚡는 과열 주의로
            side, hit = None, []
            if role == "원가":
                h = lanes(e, kd, fast_ok, +1, zf=3, zc=2.5, yoy_min=5)
                if h: side, hit = "cost", h
            else:
                h = lanes(e, kd, fast_ok, +1, zc=1.5, use=("conf", "cross")) if (r is not None and rn >= 6 and r >= 0.6) else []
                if h: side, hit = "up", h
                else:
                    h = lanes(e, kd, fast_ok, +1, use=("fast",))
                    if h: side, hit = "hot", h
                    else:
                        h = lanes(e, kd, fast_ok, -1)
                        if h: side, hit = "dem", h
            if not side:
                continue
            gk = it["gkey"] or ("S:" + nm + "|" + unit + "|" + "|".join(f"{x:.6g}" for x in v[-6:]))
            z = max(abs(e["z1"]) if "fast" in hit else 0, abs(e["z3"]) if ("conf" in hit or "cross" in hit) else 0, abs(e["z3"]))
            rw = 0.7 if r is None else 1.5 if abs(r) >= 0.6 else 1.0 if abs(r) >= 0.3 else 0.5
            is_key = it["id"] == key_id
            score = min(z, 10) * max(LANE_W[h] for h in hit) * rw * (1.3 if is_key else 1.0)
            g = groups.setdefault((side, gk), {
                "side": side, "name": nm, "unit": unit, "kind": kd, "ym": pts[-1][0], "lanes": hit, "cost": role == "원가",
                "z1": round(e["z1"], 2), "z3": round(e["z3"], 2), "d1": round(e["d1"], 2), "d3": round(e["d3"], 2),
                "yoy1": None if e["yoy1"] is None else round(e["yoy1"], 2), "yoy3": None if e["yoy3"] is None else round(e["yoy3"], 2),
                "spark": e["spark"], "cos": [], "score": 0})
            g["cos"].append({"c": c, "n": d.get("n") or c, "id": it["id"], "r": None if r is None else round(r, 2), "rn": rn,
                             "key": is_key, "role": role, "score": round(score, 2)})
            g["score"] = max(g["score"], round(score, 2))
            stats["신호: " + side] += 1
    out = sorted(groups.values(), key=lambda g: -g["score"])
    for g in out:
        g["cos"].sort(key=lambda x: -x["score"])
    res = {"updated": today.isoformat(), "rules_ver": 2, "stats": dict(stats)}
    for sd in ("up", "cost", "hot", "dem"):
        res[sd] = [g for g in out if g["side"] == sd]
    with open(os.path.join(L, "alerts.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    print({sd: (len(res[sd]), sum(len(g["cos"]) for g in res[sd])) for sd in ("up", "cost", "hot", "dem")})
    print(dict(stats))
    top = int(sys.argv[sys.argv.index("--top") + 1]) if "--top" in sys.argv else 0
    for side in ("up", "cost", "hot", "dem"):
        for g in res[side][:top]:
            print(side, g["score"], g["name"], g["ym"], g["lanes"], "z", g["z1"], g["z3"], "전월", g["d1"], "YoY", g["yoy3"],
                  [(x["c"], x["r"]) for x in g["cos"][:4]])


if __name__ == "__main__":
    main()
