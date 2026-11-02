# -*- coding: utf-8 -*-
"""사이트에 이미 있는 월차·주가로 월차 리포트의 monthly 블록 만들기(조회 0, 2026-11-02 사용자).
  원천  docs/data/jp/monthly/<코드>.json (build_monthly.py — 열 이름 한국어, 전년 같은 달=100)
        docs/data/jp/co/<코드>.json px (일봉 1년, 1970-01-01부터 날수)
  사용  python tools/site_monthly.py <코드> <출력 monthly.json> [--pub YYYY-MM-DD]
        --pub = 이번 달 월차 발표일(모르면 비움 — 그럼 다음 달 5일로 추정 표시)
  그다음 월차 스킬의 scripts/add_monthly.py 로 2단계 HTML 위에 붙인다.
"""
import calendar
import datetime as dt
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "docs", "data", "jp")
N = 12


def label(c):
    c = re.sub(r"\s*전년\s*(대비|比)\s*$", "", c)
    return re.sub(r"\s+", " ", c.replace(" 계 ", " ")).strip()


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    c, out = sys.argv[1], sys.argv[2]
    pub = sys.argv[sys.argv.index("--pub") + 1] if "--pub" in sys.argv[:-1] else ""
    m = json.load(open(os.path.join(DATA, "monthly", f"{c}.json"), encoding="utf-8"))
    rows = sorted(m["rows"], key=lambda r: r[0])[-N:]
    months = [r[0][:7] for r in rows]
    labs = [label(x) for x in m["cols"]]
    ratio = m.get("ratio") or [True] * len(labs)
    key = next((i for i, l in enumerate(labs) if "기존점" in l and "매출" in l), next((i for i, l in enumerate(labs) if "매출" in l), 0))
    out_rows = []
    for i, l in enumerate(labs):
        r = {"label": l, "fmt": "idx" if ratio[i] else "num", "v": [x[i + 1] if i + 1 < len(x) else None for x in rows]}
        if i == key:
            r["key"] = True
        out_rows.append(r)
    out_rows.insert(0, out_rows.pop(key))   # 핵심 줄(기존점 매출)을 맨 위로
    # 발표일 — 이번 달만 알면 실제, 나머지는 같은 '다음 달 n일'로 추정
    day = int(pub[8:10]) if pub else 5
    pd = {}
    for mo in months:
        y, mm = int(mo[:4]), int(mo[5:7])
        y, mm = (y + 1, 1) if mm == 12 else (y, mm + 1)
        d = dt.date(y, mm, min(day, calendar.monthrange(y, mm)[1])).isoformat()
        pd[mo] = pub if (pub and mo == months[-1]) else {"d": d, "est": True}
    px = json.load(open(os.path.join(DATA, "co", f"{c}.json"), encoding="utf-8")).get("px") or []
    series = [[(dt.date(1970, 1, 1) + dt.timedelta(days=int(a))).isoformat(), b] for a, b in px if b is not None]
    # 한 줄 요약 — 숫자만(판단 없음): 핵심 줄 + 같은 묶음의 객수·객단가
    def yo(r):
        v = r["v"][-1]
        return None if v is None else (v - 100 if r["fmt"] == "idx" else v)
    head = out_rows[0]
    grp = head["label"].replace("매출", "").strip()
    parts = []
    for w in ("객수", "객단가"):
        r = next((r for r in out_rows if w in r["label"] and r["label"].replace(w, "").strip() == grp), None) or \
            next((r for r in out_rows if r["label"].endswith(w)), None)
        if r and yo(r) is not None:
            parts.append(f"{w} {yo(r):+.1f}%".replace("-", "−"))
    hv = yo(head)
    hl = (f"{int(months[-1][5:7])}월 {head['label']} **{hv:+.1f}%**".replace("-", "−") + (" — " + ", ".join(parts) if parts else "")) if hv is not None else ""
    block = {"title": "월차 데이터 발표", "latest": months[-1], "published": pub, "headline": hl,
             "tables": [{"name": "최근 12개월", "head": "전년 같은 달 대비", "months": months, "rows": out_rows}],
             "pub_dates": pd, "price": {"unit": "엔", "series": series},
             "source": f"[월차 회사 IR {m['src']}]" if m.get("src") else "[월차]"}
    json.dump({"monthly": block}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"OK {out} — {months[0]}~{months[-1]} {len(out_rows)}줄, 주가 {len(series)}일" + ("" if pub else " (발표일 추정)"))


if __name__ == "__main__":
    main()
