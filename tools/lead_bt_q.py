# -*- coding: utf-8 -*-
"""선행지표 백테스트 — 분기 정렬 방식(2026-11-24 사용자)

  생각  월별 지표는 결국 그 분기 실적의 방향을 미리 보여 준다.
        → 「그 분기 월별 지표 → 그 분기 실적 → 실적 발표 전후 주가」로 맞춰 본다.

  방법
   1) 회사 결산 분기(docs/data/jp/lead/fin/<코드>.json 의 end 달)마다 그 분기 3개월의 지표를 묶는다.
      분기 지표값 = 그 3개월 성장률(lead_bt.growth — 전년비 %·지수−100·전년 차이)의 평균. 3개월이 다 있어야 한다.
   2) 신호 = 이번 분기 값 − 직전 분기 값(가속 +, 감속 −). 직전 분기 끝 달이 3개월 앞이어야 한다.
   3) 방향은 데이터로 고르지 않고 지표 성격으로 미리 정한다 — 기본 정방향, 원가·원자재·경쟁사·환율처럼
      오르면 불리한 지표만 역방향(REV 단어 규칙, 원장 role="원가"). 시차 탐색 없음.
   4) 잣대
      실적 일치율  신호 부호 = 그 분기 매출 전년비 성장률의 변화(직전 분기 대비 가속 +/감속 −) 부호
      주가 일치율  그 분기 마지막 달 지표를 쓸 수 있게 된 날(공표일) 종가 → 실적 발표 다음 거래일 종가,
                   종목 − TOPIX(1306.T) 초과수익 부호 = 신호 부호. 공표일 > 발표일이면 그 분기는 뺀다.
      공표일: 구글트렌드 = 다음 달 3일(주 단위 자료가 월말에 다 나옴) · 후생연금 = 다음 달 5일(둘째 영업일 무렵 갱신)
              · 공용 통계 = macro 파일의 release 문구로(전전월·다다음 달 → 2개월 뒤, 10일·20일·25일·중순 등)
              · 그 밖(모름) = 다음 달 말.
   5) 판정  실적 분기 수 < 8 → 판정 보류. 문턱은 위약 검사(무작위 ± 신호, 시드 5개)로 정한다(EARN_T·PX_T).
            둘 다 문턱 이상 → 선행 유력 · 실적만 → 실적 반영형(주가가 먼저 앎) · 실적 미달 → 교체 후보
            · 실적은 높은데 주가 분기 수 < 8 → 판정 보류(주가 표본 부족)

  데이터  분기 매출·발표일 = fin/<코드>.json(TDnet 결산단신 XBRL·PDF 표지) — 발표일은 원장 rel·카부탄 kq.json 과
          비교해 가장 이른 날(정정 공시일이 섞인 경우 원 발표일로).
          주가 = 야후 일봉 수정주가(adjclose) 10년, tools/lead_bt_px/daily/ 캐시(깃 제외) — 짧은 오류 급등락은 lead_bt.clean 으로 보정.
  결과    docs/data/jp/lead/bt_q.json  {updated, method, placebo, s:{코드:{키:[판정, 실적일치율, 주가일치율, 분기수]}}}
          docs/data/jp/lead/bt_q/<코드>.json  {키: {이름, 방향, 분기별 표, …}}
  python tools/lead_bt_q.py            전부(주가 캐시가 7일 넘으면 다시 받음)
  python tools/lead_bt_q.py --offline  캐시만
"""
import bisect
import calendar
import json
import os
import random
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lead_bt as B  # noqa: E402  growth · monthly · indicators · clean · mi · ms 를 그대로 쓴다

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT, LEAD, MAC = B.ROOT, B.LEAD, B.MAC
PXD = os.path.join(ROOT, "tools", "lead_bt_px", "daily")      # .gitignore 의 tools/lead_bt_px/ 아래
KST = timezone(timedelta(hours=9))
MIN_Q = 8
SEEDS = (1, 2, 3, 4, 5)
EARN_T, PX_T = 0.75, 0.60      # 위약 검사(2026-11-24)로 확정 — 실적 75% 이상에서 진짜가 무작위의 2.3배(134 대 58). 주가는 어느 문턱에서도 무작위와 비슷해 관례값 60%

# 오르면 회사에 불리한 지표 — 역방향
REV = ("원가", "원재료", "원료", "연료", "원유", "나프타", "LNG", "석탄", "철광석", "고철", "펄프", "수입 단가", "수입단가",
       "운임", "용선료", "임금", "인건비", "전기요금", "가스요금", "전력 가격", "경쟁", "환율", "엔/달러", "달러/엔", "엔화")


def direction(name, kind, role):
    if role == "원가":
        return -1, "원장 role=원가"
    for w in REV:
        if w in (name or ""):
            return -1, f"이름에 「{w}」"
    return 1, ""


# ---------- 날짜 ----------
def month_end(mi_):
    y, m = mi_ // 12, mi_ % 12 + 1
    return f"{y:04d}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}"


def day_of(mi_, d):
    y, m = mi_ // 12, mi_ % 12 + 1
    return f"{y:04d}-{m:02d}-{min(d, calendar.monthrange(y, m)[1]):02d}"


def avail_rule(kind, name, release):
    """그 달(E) 자료를 쓸 수 있게 되는 날 → 함수(E 월 정수 → 날짜)와 설명"""
    if kind == "trends" or (name or "").startswith("구글트렌드"):
        return (lambda e: day_of(e + 1, 3)), "구글트렌드 — 다음 달 3일"
    if kind == "pension":
        return (lambda e: day_of(e + 1, 5)), "후생연금 — 다음 달 5일(둘째 영업일 무렵 갱신)"
    r = release or ""
    if "전전" in r or "1.5개월" in r or "2개월" in r or "두 달" in r:
        if "초순" in r:
            return (lambda e: day_of(e + 2, 10)), f"공표 「{r}」 → 2개월 뒤 10일"
        return (lambda e: month_end(e + 2)), f"공표 「{r}」 → 2개월 뒤 말"
    if "다다음" in r or "확보" in r:
        return (lambda e: day_of(e + 2, 15)), f"공표 「{r}」 → 2개월 뒤 15일(확보치)"
    for key, d in (("10일", 10), ("초순", 10), ("20일", 20), ("셋째", 20), ("중순", 20), ("25일", 25)):
        if key in r:
            return (lambda e, d=d: day_of(e + 1, d)), f"공표 「{r}」 → 다음 달 {d}일"
    if r and any(k in r for k in ("4주", "하순", "말")):
        return (lambda e: month_end(e + 1)), f"공표 「{r}」 → 다음 달 말"
    return (lambda e: month_end(e + 1)), "공표일 모름 → 다음 달 말"


# ---------- 주가(일봉 수정주가) ----------
def yahoo_d(sym):
    u = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=10y&interval=1d"
    r = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read())["chart"]["result"][0]
    adj = (r["indicators"].get("adjclose") or [{}])[0].get("adjclose") or r["indicators"]["quote"][0]["close"]
    out = {}
    for t, c in zip(r["timestamp"], adj):
        if c:
            out[datetime.fromtimestamp(t, KST).strftime("%Y-%m-%d")] = c
    return out


def daily(sym, offline=False):
    os.makedirs(PXD, exist_ok=True)
    p = os.path.join(PXD, sym.replace(".", "_") + ".json")
    try:
        d = json.load(open(p, encoding="utf-8"))
        if offline or (datetime.now(KST) - datetime.fromisoformat(d["at"])).days < 7:
            return d["px"]
    except (OSError, ValueError, KeyError):
        if offline:
            return None
    try:
        px = yahoo_d(sym)
    except Exception:
        return None
    json.dump({"at": datetime.now(KST).isoformat(timespec="seconds"), "px": px}, open(p, "w", encoding="utf-8"))
    time.sleep(0.12)
    return px


class Px:
    def __init__(self, raw):
        ks = sorted(raw)
        fixed = B.clean({i: raw[k] for i, k in enumerate(ks)})      # 짧은 오류 급등락 보정(앞뒤 로그 보간)
        self.d = ks
        self.c = [fixed[i] for i in range(len(ks))]
        self.n_fix = sum(1 for i, k in enumerate(ks) if abs(fixed[i] - raw[k]) > 1e-9)

    def on_or_after(self, date):
        i = bisect.bisect_left(self.d, date)
        return i if i < len(self.d) else None

    def after(self, date):          # date 다음 거래일
        i = bisect.bisect_right(self.d, date)
        return i if i < len(self.d) else None


def excess(px, bx, start, pub):
    """공표일(start) 종가(휴일이면 다음 거래일) → 발표 다음 거래일 종가, 종목 − TOPIX"""
    a, b = px.on_or_after(start), px.after(pub)
    if a is None or b is None or b <= a:
        return None
    ta, tb = px.d[a], px.d[b]
    ia, ib = bx.on_or_after(ta), bx.on_or_after(tb)
    if ia is None or ib is None or bx.d[ia] != ta or bx.d[ib] != tb:
        return None
    return (px.c[b] / px.c[a] - 1) - (bx.c[ib] / bx.c[ia] - 1), ta, tb


# ---------- 분기 ----------
def quarters(c, co, kq, fin_path=None):
    """fin 분기 + 발표일 보정(원장 rel · 카부탄 kq 중 가장 이른 날). fin_path 를 주면 그 파일(예: 40분기 캐시)"""
    try:
        q = json.load(open(fin_path or os.path.join(LEAD, "fin", c + ".json"), encoding="utf-8"))["q"]
    except (OSError, ValueError, KeyError):
        return []
    rel = (co or {}).get("rel") or {}
    kqd = {}
    for r in kq.get(c) or []:       # ['25.04-06', 매출, 영업, 순익, 발표일]
        try:
            y, m = r[0][:2], r[0].split("-")[1]
            kqd[f"20{y}-{m}" if int(m) >= int(r[0][3:5]) else f"20{int(y) + 1:02d}-{m}"] = r[4]
        except (IndexError, ValueError, TypeError):
            pass
    out = []
    for r in q:
        if not r.get("end"):
            continue
        cands = [x for x in (r.get("pub"), rel.get(r.get("p")), kqd.get(r["end"])) if x and x > r["end"]]
        pub = min(cands) if cands else None
        out.append({"p": r["p"], "e": B.mi(r["end"]), "pub": pub, "pub0": r.get("pub"), "s": r.get("s")})
    out.sort(key=lambda x: x["e"])
    by = {}
    for r in out:
        by[r["e"]] = r
    for r in out:      # 매출 전년비와 그 변화
        a, b = r["s"], (by.get(r["e"] - 12) or {}).get("s")
        r["g"] = (a / b - 1) * 100 if a is not None and b else None
    for r in out:
        p = by.get(r["e"] - 3)
        r["acc"] = r["g"] - p["g"] if p and r["g"] is not None and p.get("g") is not None else None
    return out


def evaluate(x, unit, qs, px, bx, dirn, avail, rng=None):
    g, tf = B.growth(x, unit)
    rows = []
    qv = {}
    for r in qs:
        e = r["e"]
        if all(m in g for m in (e - 2, e - 1, e)):
            qv[e] = (g[e - 2] + g[e - 1] + g[e]) / 3
    for r in qs:
        e = r["e"]
        if e not in qv or (e - 3) not in qv:
            continue
        raw = qv[e] - qv[e - 3]
        if raw == 0:
            continue
        sig = (rng.choice((-1, 1)) if rng else (1 if raw > 0 else -1)) * dirn
        eh = None if r["acc"] is None or r["acc"] == 0 else ((sig > 0) == (r["acc"] > 0))
        st = avail(e)
        ex = None
        if px and bx and r["pub"] and st <= r["pub"]:
            ex = excess(px, bx, st, r["pub"])
        ph = None if not ex or ex[0] == 0 else ((sig > 0) == (ex[0] > 0))
        rows.append([r["p"], B.ms(e), round(qv[e], 2), round(raw, 2), sig, None if r["acc"] is None else round(r["acc"], 2),
                     None if not ex else round(ex[0] * 100, 2), eh, ph, st, r["pub"], ex[1] if ex else None, ex[2] if ex else None])
    ne = sum(1 for x_ in rows if x_[7] is not None)
    npx = sum(1 for x_ in rows if x_[8] is not None)
    er = sum(1 for x_ in rows if x_[7]) / ne if ne else None
    pr = sum(1 for x_ in rows if x_[8]) / npx if npx else None
    return {"tf": tf, "rows": rows, "ne": ne, "np": npx, "er": er, "pr": pr}


def grade(r, et=None, pt=None):
    et = EARN_T if et is None else et
    pt = PX_T if pt is None else pt
    if r["ne"] < MIN_Q:
        return "hold"
    if r["er"] < et:
        return "weak"
    if r["np"] < MIN_Q:
        return "hold_px"
    return "strong" if r["pr"] >= pt else "earn"


def main():
    offline = "--offline" in sys.argv
    ix = json.load(open(os.path.join(LEAD, "index.json"), encoding="utf-8"))
    alias = json.load(open(os.path.join(MAC, "index.json"), encoding="utf-8"))["alias"]
    kq = json.load(open(os.path.join(ROOT, "docs", "data", "jp", "kq.json"), encoding="utf-8"))
    raw_b = daily("1306.T", offline)
    if not raw_b:
        sys.exit("TOPIX(1306.T) 일봉을 못 받음 — 중단")
    bx = Px(raw_b)
    print("TOPIX 1306.T", bx.d[0], "~", bx.d[-1], len(bx.d), "일 · 보정", bx.n_fix)
    macf, rel_txt = {}, {}

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

    pxs, fixes, miss_px = {}, 0, []
    for i, c in enumerate(ix["cos"]):
        raw = daily(c + ".T", offline)
        if raw and len(raw) > 200:
            pxs[c] = Px(raw)
            fixes += pxs[c].n_fix
        else:
            miss_px.append(c)
        if i % 100 == 99:
            print("주가", i + 1, "/", len(ix["cos"]))
    print("주가", len(pxs), "곳 · 없음", len(miss_px), "· 보정한 날", fixes)

    # 지표 목록(한 번만 모음)
    tasks = []
    nofin = []
    for c in ix["cos"]:
        try:
            co = json.load(open(os.path.join(LEAD, c + ".json"), encoding="utf-8"))
        except (OSError, ValueError):
            continue
        qs = quarters(c, co, kq)
        if not qs:
            nofin.append(c)
        roles = {("i:" + str(it.get("id"))): it.get("role") for it in co["lead"]["items"]}
        roles.update({("m:" + m["id"]): m.get("role") for m in co["lead"].get("macro") or []})
        kinds = {("i:" + str(it.get("id"))): it.get("kind") for it in co["lead"]["items"]}
        for key, name, kind, pts, unit in B.indicators(c, co, alias, macf):
            dirn, dwhy = direction(name, kind, roles.get(key))
            av, awhy = avail_rule(kinds.get(key, kind), name, release_of(key[2:]) if key.startswith("m:") else "")
            tasks.append((c, key, name, kind, B.monthly(pts), unit, qs, dirn, dwhy, av, awhy))
    print("지표", len(tasks), "· 분기 실적 없는 곳", len(nofin))

    def run(rng=None):
        out = {}
        for c, key, name, kind, x, unit, qs, dirn, dwhy, av, awhy in tasks:
            if not x:
                r = {"grade": "na", "why": "지표 데이터가 아직 없음", "ne": 0, "np": 0, "er": None, "pr": None, "rows": []}
            elif not qs:
                r = {"grade": "na", "why": "분기 실적 없음", "ne": 0, "np": 0, "er": None, "pr": None, "rows": []}
            else:
                r = evaluate(x, unit, qs, pxs.get(c), bx, dirn, av, rng)
            out.setdefault(c, {})[key] = dict(r, name=name, kind=kind, dir=dirn, dwhy=dwhy, awhy=awhy)
        return out

    real = run()
    # 위약: 같은 분기 자리에 무작위 ± 신호(시드 5개)
    pl = []
    for sd in SEEDS:
        pl.append(run(random.Random(sd)))

    def tails(res, field, nfield):
        v = [r[field] for cc in res.values() for r in cc.values() if r.get(nfield, 0) >= MIN_Q and r.get(field) is not None]
        return {t: sum(1 for a in v if a >= t / 100 - 1e-9) for t in (55, 60, 65, 70, 75, 80)}, len(v)

    pt = {}
    for f, nf in (("er", "ne"), ("pr", "np")):
        rt, rn = tails(real, f, nf)
        ps = [tails(p, f, nf) for p in pl]
        avg = {t: round(sum(p[0][t] for p in ps) / len(ps), 1) for t in rt}
        pt[f] = {"real": rt, "placebo": avg, "n_real": rn, "n_placebo": round(sum(p[1] for p in ps) / len(ps)),
                 "ratio": {t: (round(rt[t] / avg[t], 2) if avg[t] else None) for t in rt}}
        print("위약", f, "진짜", rt, "무작위 평균", avg)
    # 둘 다 강한 것(선행 유력 후보)의 위약 비교
    both = {}
    for et in (0.60, 0.65, 0.70, 0.75, 0.80):
        for ptt in (0.55, 0.60, 0.65, 0.70):
            a = sum(1 for cc in real.values() for r in cc.values() if r.get("ne", 0) >= MIN_Q and r.get("np", 0) >= MIN_Q and r["er"] >= et and r["pr"] >= ptt)
            b = sum(sum(1 for cc in p.values() for r in cc.values() if r.get("ne", 0) >= MIN_Q and r.get("np", 0) >= MIN_Q and r["er"] >= et and r["pr"] >= ptt) for p in pl) / len(pl)
            both[f"{int(et*100)}/{int(ptt*100)}"] = [a, round(b, 1)]
    print("둘 다(실적/주가 문턱): 진짜 vs 무작위", both)

    cnt = {}
    for cc in real.values():
        for r in cc.values():
            if r.get("grade") != "na":
                r["grade"] = grade(r)
            cnt[r["grade"]] = cnt.get(r["grade"], 0) + 1
    print("판정", cnt)
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    method = {"align": "회사 결산 분기 3개월 → 분기 지표값(월 성장률 평균) · 신호 = 직전 분기 대비 변화",
              "dir": "기본 정방향 · 원가·원자재·경쟁·환율 단어 또는 role=원가 → 역방향(데이터로 고르지 않음)",
              "earn": "신호 부호 = 분기 매출 전년비 성장률의 직전 분기 대비 변화 부호",
              "px": "지표 공표일 종가 → 실적 발표 다음 거래일 종가, 종목 − TOPIX(1306.T) 초과수익 부호",
              "min_q": MIN_Q, "earn_t": EARN_T, "px_t": PX_T,
              "grade": {"strong": "선행 유력 — 실적·주가 둘 다 문턱 이상", "earn": "실적 반영형 — 실적은 맞지만 주가가 먼저 앎",
                        "weak": "교체 후보 — 실적 방향도 못 맞힘", "hold": "판정 보류 — 실적 분기 8개 미만",
                        "hold_px": "판정 보류 — 실적은 맞지만 주가 표본 8개 미만", "na": "데이터 없음"}}
    doc = {"updated": now, "method": method, "placebo": {"seeds": list(SEEDS), "earn": pt["er"], "px": pt["px"] if "px" in pt else pt["pr"], "both": both},
           "s": {c: {k: [r["grade"], None if r.get("er") is None else round(r["er"] * 100, 1), None if r.get("pr") is None else round(r["pr"] * 100, 1), r.get("ne", 0)]
                     for k, r in v.items()} for c, v in real.items()}}
    json.dump(doc, open(os.path.join(LEAD, "bt_q.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.join(LEAD, "bt_q"), exist_ok=True)
    cols = ["분기", "끝 달", "분기 지표값", "신호 원값(직전 분기 대비)", "신호(방향 반영 ±1)", "실제 매출 성장 변화(%p)", "기간 초과수익(%)",
            "실적 적중", "주가 적중", "공표일", "실적 발표일", "매수일", "매도일"]
    for c, v in real.items():
        json.dump({"cols": cols, "items": {k: {kk: vv for kk, vv in r.items()} for k, r in v.items()}},
                  open(os.path.join(LEAD, "bt_q", c + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("끝 —", len(real), "곳 · 주가 없음", miss_px[:20])


if __name__ == "__main__":
    main()
