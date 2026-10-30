# -*- coding: utf-8 -*-
"""실발 후 주가 — 실적 발표 20분쯤 뒤 카부탄에서 본 등락(2026-10-30 사용자). 실적 발표 캘린더에 '실발 후 주가: +5.2%'로 뜬다.
  결과  docs/data/jp/rx.json  {updated, items: {코드: {d: 발표일, v: 등락 %, t: 확인 시각}}}

  python tools/rx.py <코드> <등락%> [<코드> <등락%> ...] [--t 15:50] [--d YYYY-MM-DD]
        --d 를 안 주면 오늘(한국 시각). 등락에 x 를 주면 지운다.
  python tools/rx.py list
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "jp", "rx.json")
KST = timezone(timedelta(hours=9))


def load():
    try:
        return json.load(open(OUT, encoding="utf-8"))
    except (OSError, ValueError):
        return {"updated": "", "items": {}}


def main(a):
    if not a or a[0] == "list":
        print(json.dumps(load(), ensure_ascii=False, indent=1))
        return 0
    opt = {k[2:]: a[a.index(k) + 1] for k in ("--t", "--d") if k in a}
    rest = [x for i, x in enumerate(a) if x not in ("--t", "--d") and (i == 0 or a[i - 1] not in ("--t", "--d"))]
    if len(rest) % 2:
        sys.exit(__doc__)
    now = datetime.now(KST)
    d = load()
    for c, v in zip(rest[::2], rest[1::2]):
        c = c.upper()
        if v.lower() == "x":
            d["items"].pop(c, None)
            print(f"지움: {c}")
            continue
        x = {"d": opt.get("d") or now.strftime("%Y-%m-%d"), "v": round(float(v.replace("%", "")), 1), "t": opt.get("t") or now.strftime("%H:%M")}
        d["items"][c] = x
        print(f"{c} 실발 후 주가 {x['v']:+.1f}% ({x['d']} {x['t']})")
    d["updated"] = now.strftime("%Y-%m-%d %H:%M")
    json.dump(d, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
