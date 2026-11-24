# -*- coding: utf-8 -*-
"""선행지표 백테스트 — 기업별 선행지표가 실제로 주가를 앞서는지(2026-11-23 사용자)

  대상   docs/data/jp/lead/index.json 의 모든 기업 × 기업 원장의 선행지표(고유 ext·검색 trends·연금·월차)
         + 공용 시장 통계(lead.macro → data/jp/lead/macro) + 회사 월차 파일(data/jp/monthly)
  주가   야후 10년 월봉(수정주가, tools/lead_bt_px 캐시) — 못 받으면 docs/data/jp/px/<코드>.json(일봉 5년) 월말 종가.
         기준 = TOPIX ETF(1306.T). 못 받으면 전 종목 중앙값.

  방법(재현 가능하게, 미래 정보 안 씀)
   1) 지표를 월 단위로 맞춘다(같은 달 여러 값이면 평균).
   2) '성장률'로 바꾼다: 이미 % 증감(전년비·지수 100 기준)이면 그대로(100 기준은 −100),
      값이 모두 양수인 수준이면 전년 같은 달 대비 %, 그 밖(음수 섞인 지수)은 전년 같은 달과의 차이.
   3) 신호 = 3개월 평균 성장률이 3개월 전보다 좋아졌나(+)/나빠졌나(−).  z(m) = g3(m) − g3(m−3)
   4) 발표 지연 1개월을 가정한다 — m월 자료는 (m+1)월 말에야 쓸 수 있다.
   5) 시차 L(0~6개월)마다: (m+1+L)월 말부터 3개월 동안 주가 수익률 − TOPIX 수익률(초과수익)의 부호와
      신호 부호가 같은 비율 = 방향 일치율. 순위상관(스피어만)도 같이 잰다.
   6) 가장 잘 맞는 (시차, 방향)을 고르고 — 방향은 '지표↑ → 주가↑'(정방향) 또는 비용 지표처럼 '지표↑ → 주가↓'(역방향)
   7) 과최적화 확인: 앞 절반 기간에서만 (시차, 방향)을 골라 뒤 절반에 그대로 적용한 일치율 = 검증 일치율.
  판정   표본 12개 미만 → 판정 보류 · 일치율 ≥60% 그리고 검증 ≥55% → 선행 확인 · 일치율 ≥55% 그리고 검증 ≥50% → 약한 선행
         그 밖 → 교체 후보(주가를 앞서지 못함). 3개월 수익률이 겹치므로 실질 독립 표본은 대략 n/3 — p값도 그 기준.

  결과   docs/data/jp/lead/bt.json  {updated, bench, method, placebo, s: {코드: {키: [판정, 일치율, 방식, 표본]}}} — 한눈에 표용 요약
         docs/data/jp/lead/bt/<코드>.json  {키: 상세 결과(시차별 표·설명)} — 일치율 누르면 불러옴
         키 = "i:<원장 지표 id>" · "m:<공용 통계 id>" · "mon"(회사 월차 파일)
  python tools/lead_bt.py
"""
import json
import math
import os
import time
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAD = os.path.join(ROOT, "docs", "data", "jp", "lead")
MAC = os.path.join(LEAD, "macro")
MON = os.path.join(ROOT, "docs", "data", "jp", "monthly")
PX = os.path.join(ROOT, "docs", "data", "jp", "px")
KST = timezone(timedelta(hours=9))
H = 3            # 수익률 보는 기간(개월)
PUB = 1          # 발표 지연(개월)
LAGS = range(0, 7)


# ---------- 월 계산 ----------
def mi(s):                       # "2024-03" → 정수 월
    y, m = s[:7].split("-")
    return int(y) * 12 + int(m) - 1


def ms(i):
    return f"{i // 12:04d}-{i % 12 + 1:02d}"


def monthly(pts):
    acc = {}
    for p in pts or []:
        if not p or p[1] is None:
            continue
        try:
            v = float(p[1])
        except (TypeError, ValueError):
            continue
        if math.isnan(v):
            continue
        acc.setdefault(mi(str(p[0])), []).append(v)
    return {k: sum(v) / len(v) for k, v in acc.items()}


def growth(x, unit=""):
    """성장률 시계열과 변환 설명"""
    if not x:
        return {}, ""
    vals = list(x.values())
    med = sorted(vals)[len(vals) // 2]
    pctlike = "%" in (unit or "") or "전년" in (unit or "")
    if pctlike and 50 < med < 200:
        return {k: v - 100 for k, v in x.items()}, "전년 대비 지수(100 기준) − 100"
    if pctlike:
        return dict(x), "이미 % 증감 — 그대로"
    if min(vals) > 0:
        return {k: (v / x[k - 12] - 1) * 100 for k, v in x.items() if (k - 12) in x and x[k - 12] > 0}, "전년 같은 달 대비 %"
    return {k: v - x[k - 12] for k, v in x.items() if (k - 12) in x}, "전년 같은 달과의 차이"


def signal(g):
    g3 = {k: (g[k] + g[k - 1] + g[k - 2]) / 3 for k in g if (k - 1) in g and (k - 2) in g}
    return {k: g3[k] - g3[k - 3] for k in g3 if (k - 3) in g3}


# ---------- 주가 ----------
def month_close(rows):
    out = {}
    for r in rows:
        out[mi(r[0])] = r[4]        # 날짜순이므로 마지막 값 = 월말 종가
    return out


PXM = os.path.join(ROOT, "tools", "lead_bt_px")   # 10년 월봉 캐시(깃 제외) — 5년 일봉만으로는 표본이 모자라 늘림


def yahoo_m(sym):
    u = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=10y&interval=1mo"
    r = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read())["chart"]["result"][0]
    adj = (r["indicators"].get("adjclose") or [{}])[0].get("adjclose") or r["indicators"]["quote"][0]["close"]
    out = {}
    for t, c in zip(r["timestamp"], adj):
        if c:
            out[mi(datetime.fromtimestamp(t, KST).strftime("%Y-%m"))] = c
    return out


def month_close10(c):
    """10년 월말 종가(수정주가). 캐시가 이번 달 것이면 그대로, 아니면 다시 받는다."""
    os.makedirs(PXM, exist_ok=True)
    p = os.path.join(PXM, c + ".json")
    cur = datetime.now(KST).strftime("%Y-%m")
    try:
        d = json.load(open(p, encoding="utf-8"))
        if d.get("m") == cur:
            return {int(k): v for k, v in d["px"].items()}
    except (OSError, ValueError):
        pass
    try:
        px = yahoo_m(c + ".T")
    except Exception:
        return None
    json.dump({"m": cur, "px": px}, open(p, "w", encoding="utf-8"))
    time.sleep(0.15)
    return px


def bench():
    try:
        return clean(yahoo_m("1306.T")), "TOPIX ETF(1306.T, 수정주가)"
    except Exception as e:
        print("TOPIX 못 받음 — 전 종목 중앙값 사용:", e)
        return None, "전 종목 중앙값"


def clean(pc):
    """야후 월봉의 짧은 튐(분할 미반영 등 — 한 달에 −70% 넘게 빠지거나 3.3배 넘게 뛰었다가 3개월 안에 제자리)을
       앞뒤 사이 로그 보간으로 고친다. 실제로 계속 오른 주식(되돌아오지 않음)은 건드리지 않는다."""
    if not pc:
        return pc
    pc = dict(pc)
    ks = sorted(pc)
    i = 1
    while i < len(ks):
        a, m = ks[i - 1], ks[i]
        r1 = pc[m] / pc[a] if pc[a] else 1
        if r1 < 0.3 or r1 > 3.3:
            for j in range(i + 1, min(i + 4, len(ks))):
                r2 = pc[ks[j]] / pc[a] if pc[a] else 0
                if 0.4 < r2 < 2.5:
                    la, lc = math.log(pc[a]), math.log(pc[ks[j]])
                    for t in range(i, j):
                        pc[ks[t]] = math.exp(la + (lc - la) * (t - i + 1) / (j - i + 1))
                    break
        i += 1
    return pc


def fwd(pc, a):
    b = a + H
    return pc[b] / pc[a] - 1 if a in pc and b in pc and pc[a] else None


# ---------- 통계 ----------
def rank(v):
    o = sorted(range(len(v)), key=lambda i: v[i])
    r = [0.0] * len(v)
    i = 0
    while i < len(o):
        j = i
        while j + 1 < len(o) and v[o[j + 1]] == v[o[i]]:
            j += 1
        for k in range(i, j + 1):
            r[o[k]] = (i + j) / 2
        i = j + 1
    return r


def spearman(a, b):
    if len(a) < 5:
        return None
    ra, rb = rank(a), rank(b)
    ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))
    return num / den if den else None


def pval(hit, n):
    """일치율이 50%보다 높을 확률이 우연일 가능성(정규근사, 실질 표본 n/3)"""
    ne = max(1.0, n / H)
    z = (hit - 0.5) / math.sqrt(0.25 / ne)
    return 0.5 * math.erfc(z / math.sqrt(2))


def pairs(z, pc, bc, L):
    out = []
    for m in sorted(z):
        if z[m] == 0:
            continue
        a = m + PUB + L
        r, b = fwd(pc, a), fwd(bc, a)
        if r is None or b is None:
            continue
        out.append((m, z[m], r - b))
    return out


def hitrate(ps, s):
    if not ps:
        return None
    return sum(1 for _, v, e in ps if (v * s > 0) == (e > 0)) / len(ps)


def test(x, unit, pc, bc):
    g, tf = growth(x, unit)
    z = signal(g)
    res = {"tf": tf}
    if not z:
        res.update(grade="na", why="성장률을 만들 만큼 자료가 길지 않음(최소 18개월 필요)")
        return res
    lag = {L: pairs(z, pc, bc, L) for L in LAGS}
    best = None
    rows = []
    for L in LAGS:
        ps = lag[L]
        hp = hitrate(ps, 1)
        c = spearman([v for _, v, _ in ps], [e for _, _, e in ps])
        rows.append([L, len(ps), None if hp is None else round(hp * 100, 1), None if c is None else round(c, 3)])
        for s in (1, -1):
            h = hitrate(ps, s)
            if h is None or len(ps) < 12:
                continue
            key = (h, abs(c or 0) if (c or 0) * s >= 0 else -1, -L)
            if best is None or key > best[0]:
                best = (key, L, s, h, c)
    n0 = max(len(v) for v in lag.values())
    res["lags"] = rows
    allm = sorted(set(m for v in lag.values() for m, _, _ in v))
    res["period"] = [ms(allm[0]), ms(allm[-1])] if allm else None
    if best is None:
        res.update(grade="hold", n=n0, why=f"주가와 겹치는 표본이 {n0}개 — 12개 미만이라 판정 보류")
        return res
    _, L, s, h, c = best
    ps = lag[L]
    half = len(ps) // 2
    h1, h2 = hitrate(ps[:half], s), hitrate(ps[half:], s)
    # 검증: 앞 절반에서만 고른 (시차, 방향)을 뒤 절반에 적용
    cut = ps[half][0] if half < len(ps) else None
    oos, oL, os_ = None, None, None
    if cut is not None:
        bf = None
        for L2 in LAGS:
            first = [p for p in lag[L2] if p[0] < cut]
            for s2 in (1, -1):
                hh = hitrate(first, s2)
                if hh is None or len(first) < 6:
                    continue
                k = (hh, -L2)
                if bf is None or k > bf[0]:
                    bf = (k, L2, s2)
        if bf:
            _, oL, os_ = bf
            second = [p for p in lag[oL] if p[0] >= cut]
            if len(second) >= 6:
                oos = hitrate(second, os_)
    n = len(ps)
    wf, nwf, wfL = walk(lag)
    res["wf"], res["nwf"] = (None if wf is None else round(wf * 100, 1)), nwf
    fx = hitrate(lag[0], 1)            # 고정 설정(시차 0 · 정방향) — 고르는 과정이 없어 편향 없음
    res["fx"], res["nfx"] = (None if fx is None else round(fx * 100, 1)), len(lag[0])
    if wf is not None and nwf >= MINWF:
        res["rate"], res["rm"], rate, rn = res["wf"], "wf", wf, nwf
    elif fx is not None and len(lag[0]) >= 12:
        res["rate"], res["rm"], rate, rn = res["fx"], "fx", fx, len(lag[0])
    else:
        res["rate"], res["rm"], rate, rn = None, None, None, 0
    if rate is None or (res["rm"] == "fx" and rn < 24):
        grade = "hold"
    elif rate >= STRONG:
        grade = "strong"
    elif rate >= MID:
        grade = "mid"
    else:
        grade = "weak"
    res.update(grade=grade, n=n, L=L, s=s, hit=round(h * 100, 1), corr=None if c is None else round(c * s, 3),
               h1=None if h1 is None else round(h1 * 100, 1), h2=None if h2 is None else round(h2 * 100, 1),
               oos=None if oos is None else round(oos * 100, 1), oL=oL, os=os_, p=round(pval(h, n), 3),
               up=round(sum(e for _, v, e in ps if v * s > 0) / max(1, sum(1 for _, v, _ in ps if v * s > 0)) * 100, 2),
               dn=round(sum(e for _, v, e in ps if v * s < 0) / max(1, sum(1 for _, v, _ in ps if v * s < 0)) * 100, 2))
    res["why"] = comment(res)
    return res


MINWF = 12      # 걸어가며 검증한 예측이 이만큼은 있어야 판정
STRONG, MID = 0.68, 0.58   # 무작위 신호 위약 검사(3회)로 맞춤 — 68% 이상이어야 진짜 지표가 무작위의 약 2배(2026-11-23)


def walk(lag):
    """걸어가며 검증(walk-forward): 매달, 그 시점까지 결과가 확정된 표본만으로 (시차, 방향)을 고르고
       그 설정으로 이번 신호를 예측해 맞았는지 센다. 미래를 보고 고르는 편향이 없다."""
    ms_ = sorted(set(m for v in lag.values() for m, _, _ in v))
    hits = n = 0
    used = {}
    for m in ms_:
        now = m + PUB                        # 이 신호를 쓸 수 있는 시점
        best = None
        for L in LAGS:
            known = [p for p in lag[L] if p[0] + PUB + L + H <= now]   # 결과(3개월 수익률)가 이미 끝난 것만
            if len(known) < 12:
                continue
            for s in (1, -1):
                h = hitrate(known, s)
                k = (h, -L, s)
                if best is None or k > best[0]:
                    best = (k, L, s)
        if not best:
            continue
        _, L, s = best
        cur = [p for p in lag[L] if p[0] == m]
        if not cur:
            continue
        _, v, e = cur[0]
        n += 1
        hits += (v * s > 0) == (e > 0)
        used[L] = used.get(L, 0) + 1
    return (hits / n if n else None), n, used


def comment(r):
    d = "정방향(지표가 좋아지면 주가가 시장보다 강함)" if r["s"] > 0 else "역방향(지표가 좋아지면 주가가 시장보다 약함 — 비용·경쟁 지표형)"
    lead = f"발표 후 {r['L']}개월 뒤부터 3개월" if r["L"] else "발표 직후 3개월"
    t = ""
    if r.get("rm") == "wf":
        t += f"일치율 {r['wf']}% = 걸어가며 검증(매달 그때까지의 과거만 보고 시차·방향을 골라 {r['nwf']}번 예측한 적중률). "
    elif r.get("rm") == "fx":
        t += f"일치율 {r['fx']}% = 고정 설정(발표 직후 3개월 · 지표↑이면 주가 강세로 가정) 적중률, 표본 {r['nfx']}개" + (" — 표본이 적어 참고용. " if r["nfx"] < 24 else ". ")
    t += f"전체 기간에서 가장 잘 맞은 설정은 {d}, {lead} — 방향 일치 {r['hit']}%(표본 {r['n']}개, 사후에 고른 값이라 실제보다 좋게 나옴). "
    t += f"이 설정이 '강세'로 본 달의 3개월 초과수익 평균 {r['up']:+.1f}%p, '약세'로 본 달 {r['dn']:+.1f}%p. "
    if r["oos"] is not None:
        t += f"앞 절반으로 고른 설정을 뒤 절반에 적용하면 {r['oos']}%. "
    t += {"strong": "과거만 보고 골라도 꾸준히 맞아, 주가를 앞서는 지표로 볼 만하다.",
          "mid": "어느 정도 맞지만 우연과 확실히 구분되진 않는다 — 계속 지켜볼 지표.",
          "weak": "동전 던지기와 크게 다르지 않다 — 주가를 앞선다는 근거가 없어 교체 후보.",
          "hold": "자료 기간이 짧아 판정 보류 — 지표가 1~2년 더 쌓이면 다시 본다."}[r["grade"]]
    return t


# ---------- 지표 모으기 ----------
def indicators(c, co, alias, macf):
    out = []
    mp = os.path.join(MON, c + ".json")
    if os.path.exists(mp) and not any(i.get("kind") == "monthly" for i in co["lead"]["items"]):
        d = json.load(open(mp, encoding="utf-8"))
        cols, ratio = d.get("cols") or [], d.get("ratio") or []
        j = next((i for i, n in enumerate(cols) if "기존점" in n and "매출" in n), None)
        if j is None:
            j = next((i for i, r in enumerate(ratio) if r), None)
        if j is not None:
            pts = [[r[0], r[j + 1]] for r in d.get("rows") or [] if len(r) > j + 1]
            out.append(("mon", "월차: " + cols[j], "월차", pts, "%" if (ratio[j] if j < len(ratio) else False) else ""))
    for it in co["lead"]["items"]:
        out.append(("i:" + str(it.get("id")), it.get("t") or it.get("short") or "", it.get("kind"), it.get("pts") or [], it.get("unit") or ""))
    for m in co["lead"].get("macro") or []:
        a = alias.get(m["id"])
        if not a:
            out.append(("m:" + m["id"], m.get("name") or m["id"], "macro", [], ""))
            continue
        if a["file"] not in macf:
            try:
                macf[a["file"]] = json.load(open(os.path.join(MAC, a["file"]), encoding="utf-8"))
            except (OSError, ValueError):
                macf[a["file"]] = {}
        se = [s for s in macf[a["file"]].get("series") or [] if s.get("key") == a["key"]]
        se = se[0] if se else {}
        if a.get("yoy") and se.get("yoy"):
            out.append(("m:" + m["id"], m.get("name") or se.get("name") or m["id"], "macro", se["yoy"], "% 전년"))
        else:
            out.append(("m:" + m["id"], m.get("name") or se.get("name") or m["id"], "macro", se.get("pts") or [], se.get("unit") or ""))
    return out


def placebo_tail(cos_real, run, seeds=(1, 2, 3)):
    """위약 검사: 지표 대신 같은 달에 무작위 신호를 넣어 똑같이 돌린다 → 일치율별 '무작위가 이 이상 나올 비율'."""
    import random
    orig = globals()["signal"]
    vals = {"wf": [], "fx": []}
    try:
        for sd in seeds:
            random.seed(sd)
            globals()["signal"] = lambda g, o=orig: {k: random.gauss(0, 1) for k in o(g)}
            for v in run().values():
                for r in v.values():
                    if r.get("rate") is not None and r["grade"] != "hold":
                        vals[r["rm"]].append(r["rate"])
    finally:
        globals()["signal"] = orig
    tail = {}
    for k, v in vals.items():
        tail[k] = [round(sum(1 for x in v if x >= t) / len(v) * 100, 1) if v else None for t in range(30, 91)]
    real = [r for v in cos_real.values() for r in v.values() if r.get("rate") is not None and r["grade"] != "hold"]
    ratio = {}
    for t in (58, 68):
        a = sum(1 for r in real if r["rate"] >= t)
        b = sum(1 for k in vals for x in vals[k] if x >= t) / len(seeds)
        ratio[t] = [a, round(b)]
    return {"from": 30, "tail": tail, "count": ratio, "n_real": len(real), "n_placebo": round(sum(len(v) for v in vals.values()) / len(seeds))}


def main():
    ix = json.load(open(os.path.join(LEAD, "index.json"), encoding="utf-8"))
    alias = json.load(open(os.path.join(MAC, "index.json"), encoding="utf-8"))["alias"]
    pcs = {}
    for c in ix["cos"]:
        m10 = month_close10(c)
        p = os.path.join(PX, c + ".json")
        m5 = {}
        if os.path.exists(p):
            try:
                m5 = month_close(json.load(open(p, encoding="utf-8")))
            except (OSError, ValueError):
                pass
        if m10:
            pcs[c] = clean(m10)     # 수정주가 10년(배당·분할 반영)
        elif m5:
            pcs[c] = clean(m5)
    bc, bname = bench()
    if bc is None:      # 전 종목 월 수익률 중앙값으로 만든 지수
        months = sorted(set(m for pc in pcs.values() for m in pc))
        bc, lvl = {}, 100.0
        for m in months:
            rs = sorted(pc[m] / pc[m - 1] - 1 for pc in pcs.values() if m in pc and (m - 1) in pc and pc[m - 1])
            if rs:
                lvl *= 1 + rs[len(rs) // 2]
            bc[m] = lvl
    macf = {}

    def run():
        out = {}
        for c in ix["cos"]:
            try:
                co = json.load(open(os.path.join(LEAD, c + ".json"), encoding="utf-8"))
            except (OSError, ValueError):
                continue
            pc = pcs.get(c)
            res = {}
            for key, name, kind, pts, unit in indicators(c, co, alias, macf):
                x = monthly(pts)
                if not x:
                    r = {"grade": "na", "why": "지표 데이터가 아직 없음"}
                elif not pc:
                    r = {"grade": "na", "why": "주가 자료 없음"}
                else:
                    r = test(x, unit, pc, bc)
                r["name"], r["kind"] = name, kind
                res[key] = r
            out[c] = res
        return out

    out = run()
    cnt = {}
    for v in out.values():
        for r in v.values():
            cnt[r["grade"]] = cnt.get(r["grade"], 0) + 1
    pl = placebo_tail(out, run)
    doc = {"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "bench": bname,
           "method": {"h": H, "pub": PUB, "lags": [LAGS.start, LAGS.stop - 1],
                      "grade": {"strong": "일치율 68% 이상", "mid": "58~68%", "weak": "58% 미만 — 교체 후보", "hold": "자료 기간이 짧음", "na": "데이터 없음"}},
           "placebo": pl, "cos": out}
    # 요약(한눈에 표용, 가벼움) + 기업별 상세(일치율 누르면 불러옴)
    sm = {k: v for k, v in doc.items() if k != "cos"}
    sm["s"] = {c: {k: [r["grade"], r.get("rate"), r.get("rm"), r.get("nwf") if r.get("rm") == "wf" else r.get("nfx")] for k, r in v.items()} for c, v in out.items()}
    json.dump(sm, open(os.path.join(LEAD, "bt.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.join(LEAD, "bt"), exist_ok=True)
    for c, v in out.items():
        json.dump(v, open(os.path.join(LEAD, "bt", c + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("위약 비교", pl["count"])
    print("백테스트", len(out), "곳 ·", sum(cnt.values()), "지표 ·", " · ".join(f"{k} {v}" for k, v in sorted(cnt.items())), "· 기준", bname)


if __name__ == "__main__":
    main()
