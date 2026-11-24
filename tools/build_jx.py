# -*- coding: utf-8 -*-
"""전 종목 실적 스크리닝(#jpx) — 2026-11-24 사용자. 일본 주요 전 종목(sectors.json) 모두에 1단계 기준을 돌린다.

  자료  결산단신 XBRL(build_xlsx.collect 와 같은 자료 · tools/xbrl_cache). 회사마다 최근 결산단신 4개면
        이번 분기·직전 2개 분기와 각 전년 같은 분기(비교 칸)까지 나온다.
  기준  발송(하나라도) ① 매출 +20%↑ & 영업이익 전년 이상 ② 영업이익 +30%↑ & 매출 +5%↑
        ③ 영업이익 +10~30% & 증가율이 직전 분기보다 20%p↑ ④ 매출 +10%↑ & 흑자 전환(전년 같은 분기 적자, 또는 직전 2개 분기 연속 적자)
        ⑤ 수주잔고 가속 — 설명회 자료 숫자라 아직 자동 판정 안 함
        제외 ⓐ 매출·영업이익 증가율 둘 다 직전 분기보다 낮아짐 ⓑ 매출 2개 분기 연속 전 분기보다 감소 ⓒ GPM 20% 미만 ⓓ 분기 영업이익 1억 엔 미만
        예외 SW(정보·통신업)는 분기 매출 5억 엔 이상이면 ⓓ 안 봄
        제외 섹터 은행·증권·보험·기타 금융 · 의약품 · 철강 · 펄프·종이 · 목재 · 화학(반도체 소재·생활용품·화장품은 남김)
  겹침  docs/data/jp/px/q3.json(일본 스크리닝 3Q26 판)에 있던 회사는 prev 로 표시.
  결과  docs/data/jp/jx.json

  python tools/build_jx.py                 새 결산단신이 들어온 회사·아직 없는 회사만(매일)
  python tools/build_jx.py --all [--n 4]   전부 다시
  python tools/build_jx.py 7203 6758       몇 곳만
"""
import json
import os
import re
import sys
import threading
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_xlsx as bx  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = os.path.join(ROOT, "docs", "data", "jp")
OUT = os.path.join(J, "jx.json")
KST = timezone(timedelta(hours=9))
NF = 5
EXSEC = {"銀行業": "금융", "証券、商品先物取引業": "금융", "保険業": "금융", "その他金融業": "금융", "医薬品": "의약품",
         "鉄鋼": "철강", "パルプ・紙": "펄프·종이"}
CHEM_KEEP = {"반도체", "화장품·퍼스널케어", "생활·홈"}
LOCK = threading.Lock()

if os.environ.get("XBRL_CACHE"):          # 메인 폴더의 결산단신 보관함을 같이 씀(worktree 에서 돌릴 때)
    bx.CACHE = os.environ["XBRL_CACHE"]
_files = bx.filings


def load(p, d=None):
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return d


def cq_of(fy, end_m, q):
    """결산기(fy년 end_m월 끝) q분기 → 그 분기가 끝난 달의 달력 분기 '3Q26'."""
    m, y = end_m - 3 * (4 - q), fy
    while m <= 0:
        m, y = m + 12, y - 1
    return f"{(m - 1) // 3 + 1}Q{y % 100:02d}"


def g(a, b):
    return None if a is None or b is None or b <= 0 else (a / b - 1) * 100


def facts(code):
    bx.filings = lambda c: _files(c)[:NF]
    data, used, fsm = bx.collect(code)
    if not used:
        return None
    PL = data["PL"]
    rev, op = bx.pick(PL, bx.PLMAP["revenue"]), bx.pick(PL, bx.PLMAP["op"])
    if not rev:   # 회사 고유 매출 요소(도요타 co:TotalNetRevenuesIFRS 등) — 이름에 Revenue·Sales 가 든 멤버 없는 줄, Total 먼저
        loc = [bx.local(PL["seen"][k]["name"]) for k in PL["rows"] if not PL["seen"][k]["mem"]]
        cand = [n for n in loc if re.search(r"(Revenue|NetSales|Sales)", n) and not re.search(r"Cost|Expense|Gross|Profit|Loss|Margin", n)]
        cand.sort(key=lambda n: (not n.startswith("Total"), loc.index(n)))
        rev = bx.pick(PL, cand[:1]) if cand else {}
    if not op:    # 영업이익 요소가 회사 고유인 경우(히타치 등) — OperatingProfit/OperatingIncome 이 든 줄
        loc = [bx.local(PL["seen"][k]["name"]) for k in PL["rows"] if not PL["seen"][k]["mem"]]
        cand = [n for n in loc if re.search(r"Operating(Profit|Income)", n) and not re.search(r"NonOperating|Other|Margin|Ratio", n)]
        op = bx.pick(PL, cand[:1]) if cand else {}
    gp = bx.pick(PL, bx.PLMAP["gp"])
    if not rev or not op:
        return {"d": used[0]["date"], "doc": used[0]["doc"], "t": used[0]["title"], "err": "영업이익 줄 없음(IFRS 영업이익 미공시)" if rev else "매출 줄을 못 찾음"}
    end_m = (fsm - 2) % 12 + 1 if fsm else 3
    t = unicodedata.normalize("NFKC", used[0]["title"])
    mt = re.search(r"(\d{4})年\s*(\d{1,2})月期", t)
    last = max(rev)
    if mt:
        end_m = int(mt.group(2))   # 결산월은 제목(「2027年3月期」)이 가장 확실
        mq = re.search(r"第\s*(\d)\s*四半期", t)
        tq = int(mq.group(1)) if mq else 2 if "中間" in t else 4
        # 결산단신의 통기 예상(予想)이 4Q 누계로 잡혀 max() 가 미래 분기를 고르는 일 막기(2026-11-24 시마무라)
        if (int(mt.group(1)), tq) in rev:
            last = (int(mt.group(1)), tq)
    seq = bx.qseq(last, 7)[::-1]          # 이번 분기부터 과거로 7개
    S = [bx.standalone(rev, *k) for k in seq]
    O = [bx.standalone(op, *k) for k in seq]
    G = [bx.standalone(gp, *k) if gp else None for k in seq]
    m = lambda v: None if v is None else round(v / 1e6)   # 백만엔
    cum = 0
    if S[0] is None and rev.get(last) is not None and rev.get((last[0] - 1, last[1])) is not None and op.get(last) is not None and op.get((last[0] - 1, last[1])) is not None:
        # 직전 분기 결산단신이 없어(1Q 단신 안 내는 회사) 단독 분기를 못 만들면 누계끼리 YoY(2026-11-24 도에이애니메이션)
        py = (last[0] - 1, last[1])
        S, O = [rev[last], None, None, None, rev[py], None, None], [op[last], None, None, None, op[py], None, None]
        G = [gp.get(last) if gp else None, None, None, None, None, None, None]
        cum = 1
    return {"cum": cum, "d": used[0]["date"], "doc": used[0]["doc"], "t": used[0]["title"], "fy": last[0], "q": last[1], "em": end_m,
            "S": [m(x) for x in S], "O": [m(x) for x in O], "G": [m(x) for x in G]}


def judge(f, info, ind):
    """f = facts() → 판정. S/O/G[0]=이번 분기, [1]=직전, [2]=그 전, [4]=전년 같은 분기, [5]=직전 분기의 전년."""
    S, O, G = f["S"], f["O"], f["G"]
    r = {}
    if S[0] is None or O[0] is None:
        return {"st": "nodata", "why": "이번 분기 단독 숫자를 못 구함"}
    gs, go = g(S[0], S[4]), g(O[0], O[4])
    gs1, go1 = g(S[1], S[5]), g(O[1], O[5])
    r.update({"gs": rnd(gs), "go": rnd(go), "gs1": rnd(gs1), "go1": rnd(go1),
              "gpm": rnd(G[0] / S[0] * 100) if G[0] is not None and S[0] else None})
    hit = []
    if gs is not None and gs >= 20 and O[4] is not None and O[0] >= O[4]:
        hit.append(1)
    if go is not None and go >= 30 and gs is not None and gs >= 5:
        hit.append(2)
    if go is not None and 10 <= go < 30 and go1 is not None and go - go1 >= 20:
        hit.append(3)
    if gs is not None and gs >= 10 and O[0] > 0 and ((O[4] is not None and O[4] < 0) or (O[1] is not None and O[2] is not None and O[1] < 0 and O[2] < 0)):
        hit.append(4)
    drop = []
    if gs is not None and gs1 is not None and gs < gs1 and (go is None or go1 is None or go < go1) and not (go is None and go1 is None):
        drop.append("a")
    if None not in (S[0], S[1], S[2]) and S[0] < S[1] < S[2]:
        drop.append("b")
    if r["gpm"] is not None and r["gpm"] < 20:
        drop.append("c")
    sw = ind == "情報・通信業"
    if O[0] < 100 and not (sw and S[0] >= 500):
        drop.append("d")
    r["hit"], r["drop"] = hit, drop
    r["st"] = "pass" if hit and not drop else "drop" if hit else "none"
    return r


def rnd(v):
    return None if v is None else round(v, 1)


def exsec(info, ind):
    if ind in EXSEC:
        return EXSEC[ind]
    if ind == "化学" and info.get("s") not in CHEM_KEEP:
        return "화학"
    if "목재" in (info.get("cat") or "") or "목재" in (info.get("n") or ""):
        return "목재"
    return None


def one(code, info, ind):
    try:
        f = facts(code)
    except SystemExit:
        f = None
    except Exception as e:
        return {"st": "nodata", "why": f"읽기 실패 {type(e).__name__}"}
    if not f:
        return {"st": "nodata", "why": "결산단신 XBRL 없음"}
    base = {"d": f["d"], "pdf": bx.PDF.format(code=code, doc=f["doc"]), "t": f["t"]}
    if f.get("err"):
        return dict(base, st="nodata", why=f["err"])
    base.update({"cq": cq_of(f["fy"], f["em"], f["q"]), "fq": f"{f['fy']}/{f['em']} {f['q']}Q",
                 "s0": f["S"][0], "o0": f["O"][0], "S": f["S"][:6], "O": f["O"][:6]})
    base.update(judge(f, info, ind))
    if f.get("cum"):
        base["cum"] = 1
    return base


def main(argv):
    sec = load(os.path.join(J, "sectors.json"), {}).get("items", {})
    ind = load(os.path.join(ROOT, "tools", "jpx_ind.json"), {}).get("items", {})
    q3 = set(load(os.path.join(J, "px", "q3.json"), {}).get("items", {}))
    ann = load(os.path.join(J, "ann.json"), {}).get("items", {})
    old = load(OUT, {}) or {}
    items = old.get("items", {})
    codes = [a for a in argv if re.fullmatch(r"[0-9A-Z]{4}", a)]
    if not codes:
        if "--all" in argv:
            codes = list(sec)
        else:   # 아직 없는 회사 + 카부탄 최근 발표일이 저장된 결산단신 날짜보다 새로운 회사
            codes = [c for c in sec if c not in items or items[c].get("st") == "nodata"
                     or ((ann.get(c) or {}).get("ld") or "") > (items[c].get("d") or "")]
    print(f"대상 {len(codes)}곳 / 전체 {len(sec)}곳")
    todo = []
    for c in codes:
        info, i = sec.get(c, {}), ind.get(c, "")
        ex = exsec(info, i)
        if ex:
            items[c] = {"st": "exsec", "why": ex}
            continue
        todo.append(c)
    done = [0]

    def work(c):
        r = one(c, sec.get(c, {}), ind.get(c, ""))
        with LOCK:
            items[c] = r
            done[0] += 1
            if done[0] % 50 == 0:
                print(f"  {done[0]}/{len(todo)}", flush=True)
                save(items, sec, ind, q3)
    with ThreadPoolExecutor(3) as ex:
        list(ex.map(work, todo))
    save(items, sec, ind, q3)


def save(items, sec, ind, q3):
    for c, r in items.items():
        info = sec.get(c, {})
        r.update({"n": info.get("n") or r.get("n"), "s": info.get("s"), "ind": ind.get(c), "mc": info.get("mc")})
        r["prev"] = 1 if c in q3 else 0
    items = {c: items[c] for c in sec if c in items}
    n = {}
    for r in items.values():
        n[r["st"]] = n.get(r["st"], 0) + 1
    tmp = OUT + ".part"
    json.dump({"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "n_universe": len(sec), "count": n,
               "prev_label": "3Q26", "items": items}, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)


if __name__ == "__main__":
    main(sys.argv[1:])
