# -*- coding: utf-8 -*-
"""사이클: 업황 현황(2026-11-25 사용자) — docs/data/jp/lead/cycle/<코드>.json

  사이클 업종 회사마다 「산업 전체가 올라오는지」를 한 그래프로, 그리고 과거 사이클에서 이 회사 주가·실적이
  업계와 어떤 관계였는지 백테스트한다. 선행지표가 아니라 업황 판단용.

  입력  tools/lead_cand_data/_cycle/tags.json  {코드: {type, cust[], share[], peers[], note}}  (리포트 읽고 분류)
        tools/lead_cand_data/_cycle/iip.json   광공업지수 업종별 출하·재고 YoY·갭(출하−재고)
        실적 fin40(40분기) 없으면 docs/data/jp/lead/fin(20분기) · 주가 tools/lead_bt_px/daily(10년 일봉, 수정주가)
  계산  - 밸류체인(동종·고객·공급 peers) 합산 매출·영업이익 YoY — 같은 회사끼리만 전년과 비교(편입 효과 없게)
        - 동종사 동일가중 주가 지수, 이 회사 주가, TOPIX
        - 고객 산업 재고 사이클(출하 YoY − 재고 YoY)
        - 백테스트: 업계 매출 YoY 바닥·고점 전후 이 회사 초과수익, 주가가 업계 성장률보다 몇 분기 먼저 움직였나,
          업계 성장률 1%p 당 이 회사 성장률(민감도), 재고 갭 바닥 뒤 6·12개월 초과수익
        - 지금 국면: 업계 성장률 수준·방향, 재고 갭 방향, 바닥 뒤 몇 분기
  python tools/lead_cycle.py [코드 …]
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lead_bt as B  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT, LEAD = B.ROOT, B.LEAD
CYD = os.path.join(ROOT, "tools", "lead_cand_data", "_cycle")
F40 = os.path.join(ROOT, "tools", "lead_cand_data", "fin40")
PXD = os.path.join(ROOT, "tools", "lead_bt_px", "daily")
OUT = os.path.join(LEAD, "cycle")
DAY = "2026-11-25"
CUSTK = {"mfg": "제조업 전반", "steel": "철강·비철", "prodmach": "생산용 기계", "semieq": "반도체·FPD 장비", "genmach": "범용·업무용 기계",
         "ecomp": "전자부품·디바이스", "ic": "집적회로", "elecmach": "전기기계", "infocom": "정보통신기기", "auto": "자동차",
         "ceramic": "유리·세라믹·건자재", "chem": "화학", "plastic": "플라스틱 제품"}
TYPE_KO = {"cycle": "업황 사이클형", "structural": "구조적 성장형", "policy": "관공서·정책형", "lumpy": "대형 단건형", "single": "고객 한 곳 의존형", "none": "사이클 영향 약함"}


def qend(end):
    """결산 분기 끝 달 → 그 달이 속한 달력 분기 끝(3·6·9·12월) 월 정수"""
    i = B.mi(end)
    return i + (2 - i % 3)


_fin = {}


def fin(c):
    if c in _fin:
        return _fin[c]
    p = os.path.join(F40, c + ".json")
    if not os.path.exists(p):
        p = os.path.join(LEAD, "fin", c + ".json")
    out = {}
    try:
        for r in json.load(open(p, encoding="utf-8"))["q"]:
            if r.get("end"):
                out[qend(r["end"])] = (r.get("s"), r.get("o"))
    except (OSError, ValueError, KeyError):
        pass
    _fin[c] = out
    return out


_px = {}


def mpx(c):
    """월말 종가(수정주가) {월 정수: 값}"""
    if c in _px:
        return _px[c]
    out = {}
    try:
        d = json.load(open(os.path.join(PXD, c + "_T.json"), encoding="utf-8"))["px"]
        ks = sorted(d)
        fx = B.clean({i: d[k] for i, k in enumerate(ks)})   # 하루짜리 오류 급등락(예: 1306 375→37→382) 보정 — lead_bt_q 와 같은 방식
        for i, k in enumerate(ks):
            out[B.mi(k)] = fx[i]
    except (OSError, ValueError, KeyError):
        pass
    _px[c] = out
    return out


def corr(a, b):
    n = len(a)
    if n < 6:
        return None
    ma, mb = sum(a) / n, sum(b) / n
    sa = math.sqrt(sum((x - ma) ** 2 for x in a))
    sb = math.sqrt(sum((y - mb) ** 2 for y in b))
    return None if not sa or not sb else sum((x - ma) * (y - mb) for x, y in zip(a, b)) / sa / sb


def agg_yoy(codes, k):
    """peers 합산 YoY(같은 회사끼리 전년과 비교) {분기월: (yoy, 회사 수)}"""
    allq = sorted({q for c in codes for q in fin(c)})
    out = {}
    for q in allq:
        cur = prev = 0.0
        n = 0
        for c in codes:
            f = fin(c)
            a, b = f.get(q), f.get(q - 12)
            if not a or not b or a[k] is None or b[k] is None:
                continue
            cur += a[k]
            prev += b[k]
            n += 1
        if n >= max(2, len(codes) // 3) and prev > 0:
            out[q] = ((cur / prev - 1) * 100, n)
    return out


def ret(px, a, b):
    if a in px and b in px and px[a]:
        return px[b] / px[a] - 1
    return None


def turns(ser, kind):
    """분기 계열 바닥(kind=-1)·고점(+1): 앞뒤 2분기 안에서 극값이고 다음 분기에 돌아선 곳"""
    ks = sorted(ser)
    out = []
    for i in range(2, len(ks) - 1):
        win = [ser[ks[j]] for j in range(max(0, i - 2), min(len(ks), i + 3))]
        v = ser[ks[i]]
        if kind < 0 and v == min(win) and ser[ks[i + 1]] > v:
            out.append(ks[i])
        if kind > 0 and v == max(win) and ser[ks[i + 1]] < v:
            out.append(ks[i])
    res = []
    for q in out:   # 너무 붙은 것은 하나만
        if not res or q - res[-1] >= 12:
            res.append(q)
    return res


def cycle(c, tag, iip, names, topix):
    peers = [p for p in tag.get("peers") or [] if p != c and fin(p)]
    if len(peers) < 2:
        return None
    ps = agg_yoy(peers, 0)
    po = agg_yoy(peers, 1)
    sf = fin(c)
    ss = {q: (sf[q][0] / sf[q - 12][0] - 1) * 100 for q in sf if (q - 12) in sf and sf[q][0] is not None and sf[q - 12][0]}
    so = {q: (sf[q][1] / sf[q - 12][1] - 1) * 100 for q in sf if (q - 12) in sf and sf[q][1] is not None and sf[q - 12][1] and sf[q - 12][1] > 0}
    # 월 주가 — 동종사 동일가중 지수(월 수익률 평균을 누적)
    mine, tp = mpx(c), topix
    pxs = [mpx(p) for p in peers]
    months = sorted(set(tp) & set(mine)) if mine else sorted(tp)
    idx, lvl = {}, 100.0
    for i, m in enumerate(months):
        if i == 0:
            idx[m] = lvl
            continue
        rs = [ret(x, months[i - 1], m) for x in pxs]
        rs = [r for r in rs if r is not None and abs(r) < 1.5]
        if rs:
            lvl *= 1 + sum(rs) / len(rs)
        idx[m] = lvl
    base = months[0] if months else None
    norm = lambda px: {m: px[m] / px[base] * 100 for m in months if m in px} if base in px else {}
    mi_, ti_ = norm(mine), norm(tp)
    cust = [k for k in tag.get("cust") or [] if k in (iip.get("ind") or {})]
    # 재고 갭은 재고 통계가 있는 첫 고객 산업으로(반도체·FPD 장비는 재고 지수가 없음 → 다음 고객 산업, 없으면 전자부품·디바이스)
    gk_ = next((k for k in cust if (iip["ind"][k].get("gap") or [])), None)
    if not gk_ and "semieq" in cust and (iip.get("ind") or {}).get("ecomp"):
        gk_ = "ecomp"
    if gk_ and cust and gk_ != cust[0]:
        cust = [gk_] + [k for k in cust if k != gk_]
    ci = iip["ind"][gk_] if gk_ else None
    gap = {B.mi(k): v for k, v in (ci or {}).get("gap") or []}
    shy = {B.mi(k): v for k, v in (ci or {}).get("ship_yoy") or []}
    inv = {B.mi(k): v for k, v in (ci or {}).get("inv_yoy") or []}

    # ---- 백테스트 ----
    pss = {q: v[0] for q, v in ps.items()}
    tr, pk = turns(pss, -1), turns(pss, 1)

    def exc(a, b):
        r1, r0 = ret(mine, a, b), ret(tp, a, b)
        return None if r1 is None or r0 is None else round((r1 - r0) * 100, 1)
    trough_ev = [{"q": B.ms(q), "v": round(pss[q], 1), "pre": exc(q - 6, q), "post2": exc(q, q + 6), "post4": exc(q, q + 12)} for q in tr]
    peak_ev = [{"q": B.ms(q), "v": round(pss[q], 1), "pre": exc(q - 6, q), "post2": exc(q, q + 6), "post4": exc(q, q + 12)} for q in pk]
    # 주가(분기 초과수익)가 업계 매출 YoY 변화보다 몇 분기 먼저? k>0 = 주가가 k분기 먼저
    qs_ = sorted(pss)
    dps = {q: pss[q] - pss[q - 3] for q in qs_ if (q - 3) in pss}
    lag = []
    for k in range(0, 5):
        a, b = [], []
        for q in dps:
            e = exc(q - 3 - 3 * k, q - 3 * k)
            if e is not None:
                a.append(e)
                b.append(dps[q])
        r_ = corr(a, b)
        lag.append({"k": k, "r": None if r_ is None else round(r_, 2), "n": len(a)})
    okl = [x for x in lag if x["r"] is not None and x["n"] >= 12]
    bestk = max(okl, key=lambda x: x["r"]) if okl else None
    # 민감도: 이 회사 매출 YoY = a + β × 업계 매출 YoY (±100 자름)
    pairs = [(max(-100, min(100, pss[q])), max(-100, min(100, ss[q]))) for q in pss if q in ss]
    beta = rr = None
    if len(pairs) >= 8:
        xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        vx = sum((x - mx) ** 2 for x in xs)
        if vx:
            beta = round(sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / vx, 2)
        rr = corr(xs, ys)
        rr = None if rr is None else round(rr, 2)
    # 재고 갭 바닥(월) 뒤 초과수익
    gtr = []
    gk = sorted(gap)
    for i in range(6, len(gk) - 1):
        v = gap[gk[i]]
        if v == min(gap[gk[j]] for j in range(i - 6, min(len(gk), i + 7))) and v < 0:
            if not gtr or gk[i] - gtr[-1] >= 12:
                gtr.append(gk[i])
    gap_ev = [{"m": B.ms(m), "v": round(gap[m], 1), "post6": exc(m, m + 6), "post12": exc(m, m + 12)} for m in gtr]

    # ---- 지금 국면 ----
    lastq = max(pss) if pss else None
    ph = {}
    if lastq:
        v, v2 = pss[lastq], pss.get(lastq - 6)
        ph["q"], ph["peer_yoy"] = B.ms(lastq), round(v, 1)
        ph["dir"] = None if v2 is None else ("상승" if v > v2 + 1 else "하락" if v < v2 - 1 else "횡보")
        lt = [q for q in tr if q <= lastq]
        ph["since_trough"] = (lastq - lt[-1]) // 3 if lt else None
        ph["last_trough"] = B.ms(lt[-1]) if lt else None
        if lt:
            ph["ret_since"] = exc(lt[-1], max(mine) if mine else lt[-1])
    if gap:
        lm = max(gap)
        ph["gap"], ph["gap_m"] = round(gap[lm], 1), B.ms(lm)
        g3 = gap.get(lm - 3)
        ph["gap_dir"] = None if g3 is None else ("개선" if gap[lm] > g3 + 1 else "악화" if gap[lm] < g3 - 1 else "횡보")

    # ---- 문장 ----
    t = []
    t.append(f"이 회사는 「{TYPE_KO.get(tag.get('type'), tag.get('type'))}」 — {tag.get('note') or ''}".strip())
    if ph.get("peer_yoy") is not None:
        t.append(f"밸류체인 {len(peers)}곳 합산 매출은 {ph['q'][:7]} 분기 전년비 {ph['peer_yoy']:+.1f}%, 반년 전보다 {ph.get('dir') or '—'} 중입니다."
                 + (f" 마지막 업계 바닥은 {ph['last_trough'][:7]} 분기(바닥 뒤 {ph['since_trough']}분기째)." if ph.get("last_trough") else ""))
    if ph.get("gap") is not None and cust:
        t.append(f"고객 산업({CUSTK.get(cust[0], cust[0])}) 출하−재고 갭은 {ph['gap_m']} {ph['gap']:+.1f}%p로 석 달 전보다 {ph.get('gap_dir') or '—'} — 갭이 바닥에서 올라오면 재고 조정이 끝나 가는 신호입니다.")
    good = [e for e in trough_ev if e["post4"] is not None]
    if good:
        av = sum(e["post4"] for e in good) / len(good)
        pre = [e["pre"] for e in trough_ev if e["pre"] is not None]
        t.append(f"과거 업계 매출 성장률 바닥 {len(good)}번에서, 이 회사 주가는 바닥 뒤 1년 동안 TOPIX 대비 평균 {av:+.0f}%p" + (f"(바닥 전 반년은 평균 {sum(pre) / len(pre):+.0f}%p — 주가가 먼저 움직인 정도)" if pre else "") + ".")
    if bestk and bestk["r"] is not None and bestk["r"] > 0.15:
        t.append(f"분기 초과수익은 업계 매출 성장률 변화보다 {bestk['k']}분기 먼저 움직일 때 가장 잘 맞았습니다(상관 {bestk['r']:+.2f}, {bestk['n']}개 분기)." if bestk["k"] else f"주가는 업계 매출 성장률 변화와 같은 분기에 가장 잘 맞았습니다(상관 {bestk['r']:+.2f}) — 미리 움직이는 경향은 약합니다.")
    elif okl:
        t.append("주가와 업계 매출 성장률 변화의 관계는 뚜렷하지 않습니다 — 이 회사 주가는 업황보다 회사 고유 요인(신제품·점유율·밸류에이션)에 더 움직였습니다.")
    if beta is not None:
        t.append(f"업계 매출 성장률이 10%p 바뀔 때 이 회사 매출 성장률은 평균 {beta * 10:+.0f}%p 바뀌었습니다(상관 {rr:+.2f}) — " + ("업계보다 크게 흔들리는 고베타형." if beta > 1.3 else "업계와 비슷하게 움직임." if beta > 0.7 else "업계보다 덜 흔들리는 편."))
    ge = [e for e in gap_ev if e["post12"] is not None]
    if ge:
        t.append(f"고객 산업 재고 갭 바닥 {len(ge)}번 뒤 1년 초과수익은 평균 {sum(e['post12'] for e in ge) / len(ge):+.0f}%p.")

    q_rows = sorted(set(ps) | set(ss))
    out = {"c": c, "d": DAY, "type": tag.get("type"), "type_ko": TYPE_KO.get(tag.get("type"), ""), "cust": cust, "cust_ko": [CUSTK.get(k, k) for k in cust],
           "share": tag.get("share"), "note": tag.get("note"), "peers": [[p, names.get(p, p)] for p in peers],
           "q": [[B.ms(q), None if q not in ps else round(ps[q][0], 1), None if q not in po else round(po[q][0], 1),
                  None if q not in ss else round(ss[q], 1), None if q not in so else round(so[q], 1), None if q not in ps else ps[q][1]] for q in q_rows],
           "m": [[B.ms(m), round(idx[m], 1) if m in idx else None, round(mi_[m], 1) if m in mi_ else None, round(ti_[m], 1) if m in ti_ else None,
                  gap.get(m), shy.get(m), inv.get(m)] for m in months],
           "troughs": trough_ev, "peaks": peak_ev, "lag": lag, "bestk": bestk["k"] if bestk else None, "beta": beta, "r": rr, "gap_ev": gap_ev, "phase": ph, "text": t}
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, c + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return out


def main():
    tags = json.load(open(os.path.join(CYD, "tags.json"), encoding="utf-8"))
    iip = json.load(open(os.path.join(CYD, "iip.json"), encoding="utf-8"))
    ix = json.load(open(os.path.join(LEAD, "index.json"), encoding="utf-8"))
    names = {c: o["n"] for c, o in ix["cos"].items()}
    topix = mpx("1306")
    codes = sys.argv[1:] or sorted(tags)
    done = []
    for c in codes:
        tg = tags.get(c)
        if not tg or tg.get("type") == "none":
            continue
        o = cycle(c, tg, iip, names, topix)
        if o:
            done.append(c)
            if len(codes) <= 3:
                print(c, o["phase"])
                print("  " + "\n  ".join(o["text"]))
    json.dump({"d": DAY, "cos": done, "src": iip.get("src"), "iip_last": iip.get("last")}, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print("cycle", len(done), "곳")


if __name__ == "__main__":
    main()
