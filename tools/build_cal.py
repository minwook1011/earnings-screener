# -*- coding: utf-8 -*-
"""일본 주요 전 종목 실적 발표 캘린더 — 2026-10-30 사용자
  종목  build_pxall.universe() 와 같음(100억 일본 종목 전부 + 일본 소비재 전 종목)
  날짜  도쿄증권거래소(JPX) 공식 「決算発表予定日」 엑셀(회사가 거래소에 알린 날짜)
  결과  docs/data/jp/cal.json  {updated, n_universe, days: {"YYYY-MM-DD": [{c, n, cat, q, mc, sales, revg, opm, roe, per, ytd, py}]}}
        오늘 기준 5주 전 ~ 13주 뒤. 엑셀을 하나도 못 받으면 파일을 건드리지 않는다.
  python tools/build_cal.py
"""
import io
import json
import os
import re
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_pxall import KST, ROOT, get, universe  # noqa: E402

OUT = os.path.join(ROOT, "docs", "data", "jp", "cal.json")
PAGE = "https://www.jpx.co.jp/listing/event-schedules/financial-announcement/index.html"
FIN = ("mc", "sales", "revg", "opm", "roe", "per", "ytd", "py")   # 클릭하면 나오는 요약 재무(억엔·%·배)
Q = {"第１四半期": "1Q", "第２四半期": "2Q", "第３四半期": "3Q", "本決算": "FY", "決算": "FY"}


def raw(url):
    import urllib.request
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=40).read()


def parse_xlsx(b):
    import openpyxl
    ws = openpyxl.load_workbook(io.BytesIO(b), read_only=True, data_only=True).active
    out = []
    for r in ws.iter_rows(values_only=True):
        if not r or not isinstance(r[0], datetime) or r[1] is None:
            continue
        code = str(r[1]).strip().upper()
        if re.fullmatch(r"[0-9A-Z]{4}", code):
            out.append((code, r[0].strftime("%Y-%m-%d"), Q.get(str(r[7] or "").strip(), str(r[8] or "").strip() or None)))
    return out


def main():
    links = sorted(set(re.findall(r'href="([^"]*kessan[^"]*\.xlsx)"', get(PAGE))))
    rows, ok = [], 0
    for h in links:
        try:
            rows += parse_xlsx(raw(h if h.startswith("http") else "https://www.jpx.co.jp" + h))
            ok += 1
        except Exception as e:
            print(f"  {h}: 실패 {e}")
    if not ok:
        print("JPX 엑셀을 하나도 못 받음 — 기존 파일 유지")
        return 1
    U = universe()
    now = datetime.now(KST).date()
    lo, hi = (now - timedelta(days=35)).isoformat(), (now + timedelta(days=91)).isoformat()
    days, seen = {}, set()
    for code, d, q in sorted(rows, key=lambda x: x[1]):
        if code not in U or not (lo <= d <= hi) or (code, d) in seen:
            continue
        seen.add((code, d))
        u = U[code]
        o = {"c": code, "n": u.get("n"), "cat": u.get("con") or u.get("cat"), "q": q}
        o.update({k: u[k] for k in FIN if u.get(k) is not None})
        days.setdefault(d, []).append(o)
    for v in days.values():
        v.sort(key=lambda x: -(x["mc"] or 0))
    json.dump({"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "n_universe": len(U), "days": days},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"JPX 엑셀 {ok}개 · 대상 {len(U)}종목 · 캘린더 {len(seen)}건 / {len(days)}일")
    try:   # 오늘 발표한 회사의 최근 발표일·분기 실적(카부탄) — 2026-10-30 사용자
        import build_ann
        build_ann.main([])
    except Exception as e:
        print(f"최근 발표일 실패: {e}")


if __name__ == "__main__":
    sys.exit(main())
