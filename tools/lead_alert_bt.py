# -*- coding: utf-8 -*-
"""선행지표 알림 기준 백테스트(2026-11-26 사용자) — 「데이터가 튄 날」에 알림이 왔다면 그 뒤 주가는 어땠나.

  사용자 의도: 지금 지표들로 알림 기준을 세우고(섹터마다 다르게), 과거 날짜마다 그 기준에 걸린 알림을 본 뒤
              3일·1주·3주·1개월·3개월·6개월·1년 뒤 수익률로 기준과 핵심지표의 신뢰성을 확인한다.

  지표 값 → 전년 같은 달 대비 성장률 g(이미 %·YoY 면 그대로, lead_bt.growth) → 3개월 평균 g3.
  원가 지표(원장 role=원가, 이름에 원료·운임·환율 …)는 부호를 뒤집어 「원가가 내려감 = 좋아짐」으로 본다.
  매달 그 달까지의 값만 써서 판정(미래 값 안 씀). 같은 회사·지표·신호는 3개월 안에 다시 울리지 않는다.

  신호 4가지
    A 한 달 급가속  g − 직전 3개월 g 평균의 z ≥ 문턱, g > 0            (빨리 아는 게 가치인 월차·트렌드·연금)
    B 3개월 가속    g3 − 3개월 전 g3 의 z ≥ 문턱, g3 상승, g3 ≥ 하한     (전부)
    C 바닥 반전     g3 가 0 이하 → 0 초과로, 2개월 연속 상승, 직전 12개월 최저 ≤ −5   (사이클·건설·소재)
    D 검색 폭발     구글트렌드 값 ≥ 직전 12개월 중앙값 × 1.8 이고 24개월 최고    (트렌드만)
    z = (이번 값 − 직전 36개월 중앙값) ÷ (1.4826 × MAD), 표본 18개 이상
    악화 쪽은 같은 조건을 거꾸로(A·B·C) — 기본 화면은 개선 신호.

  섹터별 기준(RULES) — 소비재·IP 는 빠른 A·D, 반도체·전자·기계·자동차는 사이클 C·B, 소재·상사·에너지는 가격 반전 C·B,
                        IT 인력·서비스는 느린 지표라 B 문턱을 낮춤, 부동산·건설은 C·B.

  수익률: 공표일 다음 거래일 종가에 사서 3·5·15·21·63·126·252 거래일 뒤 종가(수정주가, lead_bt_q 일봉 캐시).
          초과 = 종목 − TOPIX(1306.T). 「주가 동반」 = 공표일까지 20거래일 초과수익 ≥ +5%, 「주가 역행」 ≤ −5%.
  비교 기준: 같은 지표의 모든 공표일(신호 없는 날 포함)에 샀을 때 평균 — 섹터별로.

  python tools/lead_alert_bt.py   → 아티팩트용 JSON(스크래치 또는 인자 경로)
"""
import bisect
import json
import os
import statistics as st
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lead_bt as B          # noqa: E402
import lead_bt_q as Q        # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAD = os.path.join(ROOT, "docs", "data", "jp", "lead")
MAC = os.path.join(LEAD, "macro")
HZ = [3, 5, 15, 21, 63, 126, 252]
HZN = ["3일", "1주", "3주", "1개월", "3개월", "6개월", "1년"]

# 섹터 묶음별 기준 — fam: 켤 신호, zA·zB: 문턱, gB: B 의 g3 하한(None=제한 없음), rise: B 에서 g3 연속 상승 개월
STYLE = {
    "소비·IP": {"fam": "ABD", "zA": 2.5, "zB": 2.0, "gB": 0, "rise": 1,
              "why": "월차·검색량처럼 매달 빨리 나오는 지표가 핵심. 한 달 급가속(A)과 검색 폭발(D)을 바로 잡고, 3개월 가속(B)으로 확인."},
    "사이클": {"fam": "BC", "zA": 9, "zB": 1.5, "gB": None, "rise": 3,
             "why": "수주·생산·수출은 한 달 값이 들쭉날쭉. 3개월 평균이 바닥에서 플러스로 돌아서는 반전(C)과, 마이너스라도 3개월 연속 좋아지는 가속(B)을 잡음."},
    "가격·소재": {"fam": "BC", "zA": 9, "zB": 2.0, "gB": 0, "rise": 2,
              "why": "제품 가격·수출 단가는 방향이 바뀌는 순간이 중요. 전년비가 마이너스에서 플러스로 반전(C), 플러스 구간의 뚜렷한 가속(B)."},
    "인력·서비스": {"fam": "AB", "zA": 2.5, "zB": 1.5, "gB": 0, "rise": 2,
               "why": "연금 가입자·구인처럼 천천히 움직이는 지표라 문턱을 낮춰 꾸준한 가속(B)을 잡고, 트렌드·월차는 급가속(A)도."},
    "건설·부동산": {"fam": "BC", "zA": 9, "zB": 2.0, "gB": None, "rise": 2,
               "why": "착공·수주는 덩어리가 커서 3개월 평균으로만 봄. 바닥 반전(C)과 3개월 가속(B)."},
}
SEC2STYLE = {"cons": "소비·IP", "it/game": "소비·IP", "it/content": "소비·IP", "it/platform": "소비·IP",
             "semi": "사이클", "elec": "사이클", "mach": "사이클", "auto": "사이클", "it/infra": "사이클",
             "mats": "가격·소재", "enrg": "가격·소재", "trade": "가격·소재",
             "it": "인력·서비스", "svc": "인력·서비스", "re": "건설·부동산"}
FAMN = {"A": "한 달 급가속", "B": "3개월 가속", "C": "바닥 반전", "D": "검색 폭발"}


def style_of(sec):
    return SEC2STYLE.get(sec) or SEC2STYLE.get((sec or "").split("/")[0]) or "사이클"


def zlast(hist, x):
    if len(hist) < 18:
        return None
    h = hist[-36:]
    med = st.median(h)
    mad = st.median([abs(v - med) for v in h])
    sd = max(1.4826 * mad, 0.25 * (st.median([abs(v) for v in h]) or 0), 0.5)
    return (x - med) / sd


def signals(x, kind, sty, sgn):
    """x: {월정수: 값}. 반환 [(월, 신호, 쪽, z, g3)] — 그 달까지의 값만 사용"""
    g, _ = B.growth(x, "")
    if not g:
        return []
    if sgn < 0:
        g = {k: -v for k, v in g.items()}
    ks = sorted(g)
    g3 = {k: (g[k] + g[k - 1] + g[k - 2]) / 3 for k in ks if (k - 1) in g and (k - 2) in g}
    a_d = {k: g[k] - (g[k - 1] + g[k - 2] + g[k - 3]) / 3 for k in ks if all((k - i) in g for i in (1, 2, 3))}
    b_d = {k: g3[k] - g3[k - 3] for k in g3 if (k - 3) in g3}
    is_tr = kind == "trends"
    out = []
    for k in ks:
        for side in (1, -1):
            hit = []
            if "A" in sty["fam"] and (is_tr or kind in ("monthly", "월차", "pension")) and k in a_d:
                hist = [side * a_d[j] for j in sorted(a_d) if j < k]
                z = zlast(hist, side * a_d[k])
                if z is not None and z >= sty["zA"] and side * g[k] > 0:
                    hit.append(("A", z))
            if "B" in sty["fam"] and k in b_d and (k - sty["rise"]) in g3:
                hist = [side * b_d[j] for j in sorted(b_d) if j < k]
                z = zlast(hist, side * b_d[k])
                rising = all(side * (g3[k - i] - g3[k - i - 1]) > 0 for i in range(sty["rise"]) if (k - i - 1) in g3)
                lo_ok = sty["gB"] is None or side * g3[k] >= sty["gB"]
                if z is not None and z >= sty["zB"] and rising and lo_ok:
                    hit.append(("B", z))
            if "C" in sty["fam"] and k in g3 and (k - 1) in g3 and (k - 2) in g3:
                past = [side * g3[j] for j in range(k - 12, k) if j in g3]
                if side * g3[k - 1] <= 0 < side * g3[k] and side * g3[k - 1] > side * g3[k - 2] and past and min(past) <= -5:
                    hit.append(("C", None))
            if side > 0 and "D" in sty["fam"] and is_tr and sgn > 0:
                prev = [x[j] for j in range(k - 12, k) if j in x]
                prev24 = [x[j] for j in range(k - 24, k) if j in x]
                if len(prev) >= 10 and len(prev24) >= 20:
                    med = st.median(prev)
                    if med > 0 and x[k] >= 1.8 * med and x[k] > max(prev24):
                        hit.append(("D", x[k] / med))
            for f, z in hit:
                out.append((k, f, side, z, g3.get(k)))
    return out


def main(out_path):
    ix = json.load(open(os.path.join(LEAD, "index.json"), encoding="utf-8"))
    alias = json.load(open(os.path.join(MAC, "index.json"), encoding="utf-8")).get("alias", {})
    cards = {x["c"]: x for x in json.load(open(os.path.join(LEAD, "cards.json"), encoding="utf-8"))["cards"]}
    raw_b = Q.daily("1306.T", True)
    bx = Q.Px(raw_b)
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
        """공표일 d 다음 거래일 종가 진입 → 지평별 [절대%, 초과%], 공표일까지 20거래일 초과(동반 판정)"""
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
                ra = px.c[b] / px.c[a] - 1
                rb = bx.c[ib] / bx.c[ia] - 1
                r.append(round(ra * 100, 1))
                xr.append(round((ra - rb) * 100, 1))
            else:
                r.append(None)
                xr.append(None)
        pre = None
        if a >= 21 and ia >= 21:
            pre = round(((px.c[a - 1] / px.c[a - 21] - 1) - (bx.c[ia - 1] / bx.c[ia - 21] - 1)) * 100, 1)
        return ta, r, xr, pre

    ind_tab, ind_ix, events = [], {}, []
    base = {}      # 스타일 → 지평별 초과수익 목록 (모든 공표일)
    macf = {}
    ncos = 0
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
        sec = cd.get("sec") or ""
        sty_n = style_of(sec)
        sty = STYLE[sty_n]
        kid = cd.get("kid")
        det = {}
        try:
            for xx in json.load(open(os.path.join(LEAD, "detail", c + ".json"), encoding="utf-8"))["items"]:
                det[xx["key"]] = xx
        except (OSError, ValueError, KeyError):
            pass
        roles = {("i:" + str(it.get("id"))): it for it in co["lead"]["items"]}
        mroles = {("m:" + m["id"]): m for m in co["lead"].get("macro") or []}
        ncos += 1
        for key, name, kind, pts, unit in B.indicators(c, co, alias, macf):
            x = B.monthly(pts)
            if len(x) < 30:
                continue
            meta = roles.get(key) or mroles.get(key) or {}
            sgn, _ = Q.direction(name, kind, meta.get("role"))
            ik = kind if kind != "macro" else "macro"
            if key == "mon":
                ik = "monthly"
            if ik == "monthly":
                av, awhy = (lambda e: Q.day_of(e + 1, 10)), "회사 월차 — 다음 달 10일 무렵"
            else:
                av, awhy = Q.avail_rule(ik, name, release_of(key[2:]) if key.startswith("m:") else "")
            dt_ = det.get(key) or next((v for kk, v in det.items() if kk.startswith(key)), None)
            hr = None
            if dt_ and dt_.get("lags") and dt_["lags"][0]["n"] >= 10:
                hr = [dt_["lags"][0]["h"], dt_["lags"][0]["n"]]
            is_key = kid is not None and key in ("i:" + str(kid), "m:" + str(kid))
            bt = (meta.get("bt") or {}).get("g") if isinstance(meta.get("bt"), dict) else None
            # 비교 기준: 모든 공표일
            for k in sorted(x)[24:]:
                f = fwd(px, av(k))
                if not f:
                    continue
                bb = base.setdefault(sty_n, [[] for _ in HZ])
                for i, v in enumerate(f[2]):
                    if v is not None:
                        bb[i].append(v)
            sig = signals(x, ik, sty, sgn)
            last = {}
            for k, fam, side, z, g3 in sig:
                lk = (fam, side)
                if lk in last and k - last[lk] <= 3:
                    continue
                last[lk] = k
                d = av(k)
                f = fwd(px, d)
                if not f:
                    continue
                tk = (c, key)
                if tk not in ind_ix:
                    ind_ix[tk] = len(ind_tab)
                    ind_tab.append({"c": c, "k": key, "n": name[:60], "kind": ik, "key": is_key, "bt": bt, "cost": sgn < 0, "rel": awhy, "hr": hr})
                events.append([d, f[0], ind_ix[tk], fam, side, None if z is None else round(z, 1), None if g3 is None else round(g3 * (1 if sgn > 0 else -1), 1),
                               f[3], f[1], f[2], B.ms(k)])
    cos = {c: {"n": cards[c]["n"], "sec": cards[c].get("sec"), "s": cards[c].get("s"), "g": cards[c].get("g"), "st": style_of(cards[c].get("sec"))} for c in {t["c"] for t in ind_tab} if c in cards}
    baseline = {k: {"med": [round(st.median(v), 2) if v else None for v in base[k]], "avg": [round(st.mean(v), 2) if v else None for v in base[k]],
                    "win": [round(sum(1 for a in v if a > 0) / len(v) * 100, 1) if v else None for v in base[k]], "n": [len(v) for v in base[k]]} for k in base}
    events.sort(key=lambda e: e[0])
    res = {"updated": json.load(open(os.path.join(LEAD, "cards.json"), encoding="utf-8")).get("updated"),
           "hz": HZN, "hzd": HZ, "styles": {k: {kk: vv for kk, vv in v.items()} for k, v in STYLE.items()}, "sec2style": SEC2STYLE, "fam": FAMN,
           "cos": cos, "ind": ind_tab, "ev": events, "base": baseline,
           "tree": [{"id": g["id"], "n": g["n"], "kids": [{"id": k["id"], "n": k["n"]} for k in g["kids"]]} for g in ix["tree"]]}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    up = [e for e in events if e[4] > 0]
    print("회사", ncos, "지표", len(ind_tab), "알림", len(events), "개선", len(up), "→", out_path, round(os.path.getsize(out_path) / 1e6, 2), "MB")
    for sn in STYLE:
        E = [e for e in up if cos.get(ind_tab[e[2]]["c"], {}).get("st") == sn]
        row = []
        for i in (2, 3, 4, 5):
            v = [e[9][i] for e in E if e[9][i] is not None]
            row.append(f"{HZN[i]} {st.mean(v):+.2f}%/{sum(1 for a in v if a > 0) / len(v) * 100:.0f}%" if v else "-")
        print(sn, len(E), row, "기준 중앙값", baseline.get(sn, {}).get("med", [None] * 7)[2:6])


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get("TEMP", "."), "alert_bt.json"))
