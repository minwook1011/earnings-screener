# -*- coding: utf-8 -*-
"""지표별 「자세히」 분석(2026-11-25 사용자) — docs/data/jp/lead/detail/<코드>.json

  사이트 「이 지표들을 고른 이유 › 자세히」 사이드바가 읽는다. 지표마다:
  - 시차: 지표를 0~3개월 앞당겨(그 분기보다 L개월 먼저 끝난 3개월) 볼 때 실적 방향 일치율과
          「분기 지표 성장률 vs 매출 YoY」 상관 → 가장 잘 맞는 시차
  - 연도별 일치율, 최근 4·8분기 성적
  - 어긋난 분기(지표는 가속인데 매출 성장은 둔화 등)
  - 차트용 분기 계열(지표 분기 평균 성장률 · 매출 YoY), 월 성장률 계열
  - 위 숫자로 만든 한국어 설명 문장
  방식은 lead_bt_q·lead_cand 와 같다(분기 3개월 평균 성장률의 직전 분기 대비 변화 → 매출 YoY 의 가속·감속).
  실적은 tools/lead_cand_data/fin40/<코드>.json(40분기)이 있으면 그것, 없으면 fin/<코드>.json(20분기).

  python tools/lead_detail.py [코드 …]
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
ROOT, LEAD, MAC = B.ROOT, B.LEAD, B.MAC
OUT = os.path.join(LEAD, "detail")
F40 = os.path.join(ROOT, "tools", "lead_cand_data", "fin40")
DAY = "2026-11-25"


def corr(a, b):
    n = len(a)
    if n < 4:
        return None
    ma, mb = sum(a) / n, sum(b) / n
    sa = math.sqrt(sum((x - ma) ** 2 for x in a))
    sb = math.sqrt(sum((y - mb) ** 2 for y in b))
    return None if not sa or not sb else sum((x - ma) * (y - mb) for x, y in zip(a, b)) / sa / sb


def qlab(p):
    return p


def run_lag(g, qs, dirn, L):
    """L개월 앞당긴 지표로 분기 평가 — rows: [p, e, qv, chg, sig, acc, hit, sales_g]"""
    qv = {}
    for r in qs:
        e = r["e"] - L
        if all(m in g for m in (e - 2, e - 1, e)):
            qv[r["e"]] = (g[e - 2] + g[e - 1] + g[e]) / 3
    rows = []
    for r in qs:
        e = r["e"]
        if e not in qv:
            continue
        chg = qv[e] - qv[e - 3] if (e - 3) in qv else None
        sig = None if not chg else (1 if chg > 0 else -1) * dirn
        hit = None if sig is None or r["acc"] is None or r["acc"] == 0 else ((sig > 0) == (r["acc"] > 0))
        rows.append([r["p"], e, qv[e], chg, sig, r["acc"], hit, r["g"]])
    ev = [x for x in rows if x[6] is not None]
    cc = [(x[2], x[7]) for x in rows if x[7] is not None]
    # 상관은 튀는 값(코로나 기저) 영향을 줄이려고 ±100% 로 자름
    cl = lambda v: max(-100.0, min(100.0, v))
    r_ = corr([cl(a) for a, _ in cc], [cl(b) for _, b in cc]) if len(cc) >= 6 else None
    return rows, {"L": L, "h": sum(1 for x in ev if x[6]), "n": len(ev), "r": None if r_ is None else round(r_ * dirn, 2)}


def lead_days(qs, avail):
    """분기 마지막 달 값이 나오는 날 → 실적 발표일까지 며칠(중앙값)"""
    from datetime import date
    ds = []
    for r in qs:
        if not r.get("pub"):
            continue
        try:
            a = date.fromisoformat(avail(r["e"]))
            p = date.fromisoformat(r["pub"][:10])
        except ValueError:
            continue
        ds.append((p - a).days)
    ds.sort()
    return ds[len(ds) // 2] if ds else None


def text_for(name, dirn, tf, lags, best, years, rec4, rec8, miss, bt, nq, ld=None, awhy=""):
    t = []
    l0 = lags[0]
    if not l0["n"]:
        return ["판정할 수 있는 분기가 아직 없습니다 — 지표 이력이 짧거나 실적 분기와 겹치는 구간이 부족합니다."]
    er0 = round(l0["h"] / l0["n"] * 100)
    t.append(f"같은 분기 기준으로 보면 지표가 직전 분기보다 좋아졌을 때 매출 성장률도 빨라진 경우가 {l0['n']}개 분기 중 {l0['h']}번({er0}%)입니다."
             + (" 이 지표는 오를수록 매출엔 불리한 성격(원가·경쟁)이라 방향을 뒤집어 셉니다." if dirn < 0 else ""))
    if bt:
        t.append(f"기업별 백테스트 등급은 「{bt['g']}」({bt['er']}%, {bt['h']}/{bt['n']}) — 시험한 지표 수까지 감안해 우연이 아니라고 본 결과입니다.")
    if best and best["L"] > 0 and best["n"] >= 8:
        eb = round(best["h"] / best["n"] * 100)
        if eb >= er0 + 5:
            t.append(f"지표를 {best['L']}개월 앞당겨 맞추면 {eb}%({best['h']}/{best['n']})로 더 잘 맞습니다 — 매출보다 약 {best['L']}개월 먼저 움직이는 지표로 보입니다.")
        else:
            t.append(f"{best['L']}개월 앞당기면 {eb}%로 비슷합니다 — 뚜렷한 시차보다는 같은 시기에 같이 움직이는 지표입니다.")
    elif l0["n"] >= 8:
        t.append("앞당겨 맞춰도 나아지지 않아, 같은 분기에 같이 움직이는(동행) 지표로 보는 게 맞습니다.")
    if ld is not None:
        when = awhy.split("→")[-1].strip() if awhy else "추정"
        if ld >= 7:
            t.append(f"공표 시점이 이 지표의 쓸모입니다 — 분기 마지막 달 값이 나오는 날({when})부터 실적 발표까지 보통 {ld}일 남습니다.")
        elif ld > -7:
            t.append(f"분기 마지막 달 값은 실적 발표와 거의 같은 때({when}) 나옵니다 — 실적 전에는 분기 앞 두 달 값으로 미리 봐야 합니다.")
        else:
            t.append(f"분기 마지막 달 값이 실적 발표보다 보통 {-ld}일 늦게 나옵니다({when}) — 실적 전에는 분기 앞 한두 달 값으로만 볼 수 있습니다.")
    rs = [x["r"] for x in lags if x["r"] is not None]
    if lags[0]["r"] is not None:
        r0 = lags[0]["r"]
        lvl = "강하게" if abs(r0) >= 0.6 else "어느 정도" if abs(r0) >= 0.35 else "약하게"
        t.append(f"분기 지표 성장률과 매출 YoY 의 상관은 {r0:+.2f} — 성장률 크기도 {lvl} 같이 움직입니다." if r0 > 0 else f"분기 지표 성장률과 매출 YoY 의 상관은 {r0:+.2f} — 방향은 맞아도 성장률 크기는 따로 노는 편입니다.")
    if rec8 and rec8[1] >= 4:
        t.append(f"최근 8개 분기는 {rec8[0]}/{rec8[1]}, 최근 4개 분기는 {rec4[0]}/{rec4[1]} 맞았습니다.")
    yy = [y for y in years if y[2] >= 3]
    if len(yy) >= 3:
        bad = min(yy, key=lambda y: y[1] / y[2])
        good = max(yy, key=lambda y: y[1] / y[2])
        if bad[1] / bad[2] < 0.5:
            t.append(f"{bad[0]}년에는 {bad[1]}/{bad[2]}로 잘 안 맞았습니다(가장 잘 맞은 해는 {good[0]}년 {good[1]}/{good[2]}).")
    if miss:
        ex = ", ".join(f"{m['p']}(지표 {'개선' if m['chg'] * dirn > 0 else '악화'} · 매출 성장 {'가속' if m['acc'] > 0 else '둔화'})" for m in miss[:3])
        t.append(f"크게 어긋난 분기: {ex}. 이런 분기는 회사 쪽 요인(출점·가격 인상·인수·일회성)이 업계 흐름과 다르게 움직였을 가능성이 큽니다.")
    if nq and nq < 16:
        t.append(f"실적이 {nq}개 분기뿐이라 결론은 데이터가 더 쌓여야 단단해집니다.")
    t.append(f"성장률 계산: {tf}.")
    return t


def detail(c, kq, alias, macf):
    co = json.load(open(os.path.join(LEAD, c + ".json"), encoding="utf-8"))
    f40 = os.path.join(F40, c + ".json")
    qs = Q.quarters(c, co, kq, f40 if os.path.exists(f40) else None)
    roles = {("i:" + str(it.get("id"))): it.get("role") for it in co["lead"]["items"]}
    roles.update({("m:" + m["id"]): m.get("role") for m in co["lead"].get("macro") or []})
    bts = {("i:" + str(it.get("id"))): it.get("bt") for it in co["lead"]["items"] if it.get("bt")}
    bts.update({("m:" + m["id"]): m.get("bt") for m in co["lead"].get("macro") or [] if m.get("bt")})
    dirs = {("i:" + str(it.get("id"))): it.get("dir") for it in co["lead"]["items"] if it.get("dir")}
    rels = {}
    for it in co["lead"]["items"]:
        how = " ".join(str(s.get("how") or "") + " " + str(s.get("freq") or "") for s in it.get("src") or [])
        rels["i:" + str(it.get("id"))] = how.split("공표:")[-1] if "공표:" in how else how
    for m in co["lead"].get("macro") or []:
        a = alias.get(m["id"])
        if a:
            if a["file"] not in macf:
                try:
                    macf[a["file"]] = json.load(open(os.path.join(MAC, a["file"]), encoding="utf-8"))
                except (OSError, ValueError):
                    macf[a["file"]] = {}
            rels["m:" + m["id"]] = macf[a["file"]].get("release") or ""
    items = []
    for key, name, kind, pts, unit in B.indicators(c, co, alias, macf):
        x = B.monthly(pts)
        if not x:
            continue
        d = dirs.get(key) or Q.direction(name, kind, roles.get(key))[0]
        g, tf = B.growth(x, unit)
        if not g:
            continue
        lag_rows, lags = {}, []
        for L in range(4):
            rows, s = run_lag(g, qs, d, L)
            lag_rows[L] = rows
            lags.append(s)
        ok = [s for s in lags if s["n"] >= 8]
        best = max(ok, key=lambda s: (s["h"] / s["n"], -s["L"])) if ok else None
        rows0 = lag_rows[0]
        ev = [x_ for x_ in rows0 if x_[6] is not None]
        yrs = {}
        for x_ in ev:
            y = B.ms(x_[1])[:4]
            a = yrs.setdefault(y, [0, 0])
            a[1] += 1
            a[0] += 1 if x_[6] else 0
        years = [[y, a[0], a[1]] for y, a in sorted(yrs.items())]
        rec4 = [sum(1 for x_ in ev[-4:] if x_[6]), len(ev[-4:])]
        rec8 = [sum(1 for x_ in ev[-8:] if x_[6]), len(ev[-8:])]
        miss = [{"p": x_[0], "ym": B.ms(x_[1]), "chg": round(x_[3], 2), "acc": round(x_[5], 2), "ig": round(x_[2], 1), "sg": None if x_[7] is None else round(x_[7], 1)}
                for x_ in ev if x_[6] is False]
        miss.sort(key=lambda m: -(abs(m["chg"]) * abs(m["acc"])) ** 0.5)
        miss = miss[:6]
        miss.sort(key=lambda m: m["ym"], reverse=True)
        qser = [[x_[0], B.ms(x_[1]), round(x_[2], 2), None if x_[7] is None else round(x_[7], 2), x_[6]] for x_ in rows0]
        mser = [[B.ms(k), round(v, 2)] for k, v in sorted(g.items())][-72:]
        bt = bts.get(key)
        av, awhy = Q.avail_rule(kind, name, rels.get(key, ""))
        ld = lead_days(qs, av)
        items.append({"key": key, "name": name, "kind": kind, "dir": d, "tf": tf, "lags": lags, "best": best["L"] if best else None,
                      "years": years, "rec4": rec4, "rec8": rec8, "miss": miss, "q": qser, "m": mser, "bt": bt, "ld": ld, "awhy": awhy,
                      "text": text_for(name, d, tf, lags, best, years, rec4, rec8, miss, bt, len([q for q in qs if q.get("s") is not None]), ld, awhy)})
    out = {"c": c, "d": DAY, "nq": len(qs), "fin": "40분기" if os.path.exists(f40) else "20분기",
           "sales": [[r["p"], B.ms(r["e"]), r.get("s"), None if r.get("g") is None else round(r["g"], 2)] for r in qs], "items": items}
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, c + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return out


def main():
    kq = json.load(open(os.path.join(ROOT, "docs", "data", "jp", "kq.json"), encoding="utf-8"))
    alias = json.load(open(os.path.join(MAC, "index.json"), encoding="utf-8"))["alias"]
    macf = {}
    codes = sys.argv[1:] or sorted(f[:-5] for f in os.listdir(LEAD) if f.endswith(".json") and f[:-5][:1].isdigit())
    n = 0
    for c in codes:
        try:
            o = detail(c, kq, alias, macf)
            n += 1
            if len(codes) <= 3:
                for it in o["items"]:
                    print(c, it["name"][:30], it["lags"], it["best"], it["rec8"])
                    print("   ", " / ".join(it["text"][:4]))
        except Exception as e:  # noqa: BLE001
            print("실패", c, e)
    print("detail", n, "곳")


if __name__ == "__main__":
    main()
