# -*- coding: utf-8 -*-
"""미국 리포트용 '재무제표 한눈에 보기' — 일본 glance.py 의 차트 구성·모양을 그대로 쓰고 데이터만 SEC XBRL 40개 분기로.
  python tools/us_glance.py DHI LEN Z      → docs/research/us/<티커>/stage2.html 의 재무제표 아래에 토글을 넣거나 바꾼다
  단위 백만 달러. 분기 이름은 분기 말 달력 기준(3Q26 = 26년 7~9월 말에 끝난 분기). 영업이익을 따로 공시하지 않는 회사(홈빌더)는 세전이익으로.
"""
import json
import os
import re
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glance   # noqa: E402  일본 토글(FRAG·charts) 재사용
import us_xlsx as ux   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def yoy(a):
    return glance.yoy(a)


def gather(tk):
    co = ux.COS[tk]
    G = ux.facts(co["cik"])
    ends = ux.qends(G)
    for e in co["extra"]:
        if e not in ends:
            ends.append(e)
    ends = sorted(ends)[-40:]

    def arr(key, tags, kind):
        S, _ = ux.series(G, tags, "USD")
        out = []
        for e in ends:
            v, _ = ux.quarter_val(S, e, kind)
            if v is None and key in co["extra"].get(e, {}):
                v = co["extra"][e][key] * 1e6
            out.append(None if v is None else round(v / 1e6, 1))
        return out

    tag = {k: t for k, _, t, _, _ in ux.ITEMS if t}
    rev = arr("rev", tag["rev"], "d")
    op = arr("op", tag["op"], "d")
    use_pretax = sum(x is not None for x in op) < len(op) * 0.6
    if use_pretax:
        op = arr("pretax", tag["pretax"], "d")
    inv = arr("inv", tag["inv"], "i")
    cash = arr("cash", tag["cash"], "i")
    debt = arr("debt", tag["debt"], "i")
    liab = arr("liab", tag["liab"], "i")
    eq = arr("equity", tag["equity"], "i")
    labs = []
    for e in ends:
        d = date.fromisoformat(e)
        labs.append(f"{(d.month - 1) // 3 + 1}Q{str(d.year)[2:]}")
    T = {"매출액": rev, "매출액 YoY": yoy(rev), "영업이익": op, "영업이익 YoY": yoy(op),
         "영업이익률": [round(o / r * 100, 1) if o is not None and r else None for o, r in zip(op, rev)],
         "영업이익 전년 대비 증감": [round(op[i] - op[i - 4], 1) if i >= 4 and op[i] is not None and op[i - 4] is not None else None for i in range(len(op))],
         "재고자산": inv, "재고자산 YoY": yoy(inv), "총 차입금": debt, "현금": cash,
         "부채비율": [round(l / q * 100, 1) if l is not None and q else None for l, q in zip(liab, eq)]}
    return {"code": tk, "labs": labs, "T": T, "SRC": {}, "pretax": use_pretax, "first": ends[0], "last": ends[-1],
            "debt_missing": not any(x is not None for x in debt)}


def fragment(Gd):
    C = glance.charts(Gd)
    for ch in C:
        ch["t"] = ch["t"].replace("억 엔", "백만 달러").replace("(억)", "(백만 달러)")
        if Gd["pretax"]:
            ch["t"] = ch["t"].replace("영업이익", "세전이익").replace("OPM", "세전이익률")
            for k in ("bar", "line2", "line3"):
                if k in ch:
                    ch[k] = {n.replace("영업이익", "세전이익"): v for n, v in ch[k].items()}
        if ch["t"].startswith("재무 안정성"):
            ch["t"] = "재무 안정성 — 차입금·현금 (백만 달러) · 부채비율(총부채÷자본, %)"
            if Gd["debt_missing"]:
                ch["src"] = "차입금은 회사 고유 태그로 공시해 SEC 표준 원장에 없음 — 현금만 표시"
        if ch.get("u3") == "억":
            ch["u3"] = "백만$"
            ch["src"] = ch.get("src", "").replace("억 엔", "백만 달러")
    src = f"SEC XBRL 10-Q·10-K {Gd['first']}~{Gd['last']} 분기 말" + (" · 영업이익 미공시라 세전이익" if Gd["pretax"] else "")
    fr = glance.FRAG.format(n=len(Gd["labs"]), src=src, labs=json.dumps(Gd["labs"]), charts=json.dumps(C, ensure_ascii=False))
    return (fr.replace("달력 분기(3Q26 = 26.7~9) · 억 엔", "분기 말 달력 기준(3Q26 = 26.7~9월 말) · 백만 달러")
              .replace('" 억 엔"', '" 백만 달러"').replace("부문·지역·수주·수출은 있을 때만 · ", "")
              .replace("엑셀 '재무제표 한눈에 보기' 시트에 같은 표·차트", "엑셀(xlsx 다운로드) '분기 재무(40)' 시트에 같은 숫자"))


def insert(tk, src):
    fr = fragment(gather(tk))
    src = re.sub(r'<details class="tg gl" id="es-glance">.*?</details>\s*<script>\(function\(\)\{const L=.*?</script>', "", src, flags=re.S)
    m = re.search(r'<details class="tg (?!prof|mo\b)', src)
    if not m:
        return src, False
    return src[:m.start()] + fr + src[m.start():], True


if __name__ == "__main__":
    for t in sys.argv[1:]:
        t = t.upper()
        p = os.path.join(ROOT, "docs", "research", "us", t, "stage2.html")
        s, ok = insert(t, open(p, encoding="utf-8").read())
        open(p, "w", encoding="utf-8").write(s)
        print(t, "넣음" if ok else "자리 못 찾음")
