# -*- coding: utf-8 -*-
"""2단계 리포트에 '월차' 표 넣기(2026-10-30 사용자) — 월차를 내는 회사만, 재무제표 표 바로 아래.

  원천  docs/data/jp/monthly/<코드>.json (build_monthly.py — 가장 최근 발표까지, 열 이름 한국어)
  표    행 = 회사가 내는 지표 전부(기존점·전점 매출·객수·객단가·카테고리·점포 수…), 열 = 최근 12개월
  색    전년 대비(%) 칸은 100 넘으면 빨강, 밑이면 파랑

  research_queue.attach 가 glance.insert 다음에 부른다(그래서 한눈에 보기보다 위에 놓임).
  python tools/monthly_tbl.py <코드> <리포트.html>   — 손으로 넣기
"""
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MO = os.path.join(ROOT, "docs", "data", "jp", "monthly")
N = 12

CSS = ("#es-monthly .mo-sub{color:#6b7280;font-size:12px;margin:0 0 8px}"
       "#es-monthly table td{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}"
       "#es-monthly table td:first-child{text-align:left}#es-monthly .up{color:#d62f2f}#es-monthly .dn{color:#1f5fbf}#es-monthly .na{color:#b0b6bf}")


def load(code):
    p = os.path.join(MO, f"{code}.json")
    if not os.path.exists(p):
        return None
    d = json.load(open(p, encoding="utf-8"))
    have = {r[0][:7]: r for r in d.get("rows") or [] if any(v is not None for v in r[1:])}
    if not have:
        return None
    y, m = map(int, max(have).split("-"))
    months = [f"{y + (m - 1 - k) // 12}-{(m - 1 - k) % 12 + 1:02d}" for k in range(N - 1, -1, -1)]   # 최근 달까지 달력 12개월(빈 달은 —)
    w = len(d["cols"])
    return d, [have.get(x) or [x] + [None] * w for x in months]


def cell(v, ratio):
    if v is None:
        return '<td class="na">—</td>'
    if ratio:
        cls = ' class="up"' if v > 100 else ' class="dn"' if v < 100 else ""
        return f"<td{cls}>{v:.1f}%</td>"
    return f"<td>{v:,.0f}</td>" if float(v).is_integer() else f"<td>{v:,.1f}</td>"


def fragment(code):
    got = load(code)
    if not got:
        return ""
    d, rows = got
    cols, ratio = d["cols"], d.get("ratio") or [False] * len(d["cols"])
    keep = [i for i in range(len(cols)) if any(r[i + 1] is not None for r in rows)]   # 12개월 내내 빈 지표는 뺌
    head = "".join(f"<th>{r[0][2:4]}.{r[0][5:7]}</th>" for r in rows)
    body = "".join(
        f"<tr><td>{html.escape(cols[i])}{' <small>(전년 대비)</small>' if ratio[i] and '전년' not in cols[i] else ''}</td>"
        + "".join(cell(r[i + 1], ratio[i]) for r in rows) + "</tr>" for i in keep)
    src = d.get("src") or ""
    src_h = f' · <a href="{html.escape(src)}" target="_blank" rel="noopener noreferrer">가장 최근 월차 원문</a>' if src.startswith("https://") else ""
    note = f" · {html.escape(d['note'])}" if d.get("note") else ""
    return (f'<details class="tg mo" id="es-monthly" open><summary><b>월차 — 최근 12개월 ({rows[0][0][:7]} ~ {rows[-1][0][:7]})</b>'
            f"<small>회사가 매달 내는 지표 전부 · 전년 대비는 % · 눌러서 접기</small></summary><div class=\"tgb\"><style>{CSS}</style>"
            f'<p class="mo-sub">가장 최근 발표 {rows[-1][0][:7]}분{note}{src_h}</p>'
            f'<div class="tw"><table class="fst"><thead><tr><th>지표</th>{head}</tr></thead><tbody>{body}</tbody></table></div></div></details>')


def insert(code, src):
    """재무제표 표 바로 아래(첫 토글 앞)에 넣는다. 이미 있으면 바꾼다. 월차가 없는 회사는 그대로."""
    src = re.sub(r'<details class="tg mo" id="es-monthly".*?</details>', "", src, flags=re.S)
    fr = fragment(code)
    m = re.search(r'<details class="tg (?!prof)', src)
    if not fr or not m:
        return src
    return src[:m.start()] + fr + src[m.start():]


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    code, path = sys.argv[1], sys.argv[2]
    s = open(path, encoding="utf-8").read()
    t = insert(code, s)
    if t != s:
        open(path, "w", encoding="utf-8").write(t)
    print(code, "월차 넣음" if "es-monthly" in t else "월차 없음")
