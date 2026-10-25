# -*- coding: utf-8 -*-
"""주가 수익률 1D·5D·7D·1M·3M·12M — 2단계 이상 회사와 리서치룸 관심 기업(docs/data/jp/ret.json).
  야후 일봉(2년)으로 마지막 값 대비 수익률(%)을 낸다. D = 거래일, M = 달력 기준.
  너무 자주 받지 않게 마지막 갱신에서 MIN_AGE 분이 안 지났으면 건너뛴다(--force 로 무시).

  python tools/build_ret.py [--force] [코드 …]
"""
import json
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JP = os.path.join(ROOT, "docs", "data", "jp")
OUT = os.path.join(JP, "ret.json")
KST = timezone(timedelta(hours=9))
MIN_AGE = 20   # 분
URL = "https://query1.finance.yahoo.com/v8/finance/chart/{c}.T?range=2y&interval=1d"


def closes(code):
    req = urllib.request.Request(URL.format(c=code), headers={"User-Agent": "Mozilla/5.0"})
    r = json.loads(urllib.request.urlopen(req, timeout=20).read())["chart"]["result"][0]
    out = []
    for t, c in zip(r["timestamp"], r["indicators"]["quote"][0]["close"]):
        if c is not None:
            out.append((datetime.fromtimestamp(t, KST).date(), c))
    return out


def ret(px):
    if len(px) < 2:
        return {}
    d0, p0 = px[-1]

    def back_n(n):
        return px[-1 - n][1] if len(px) > n else None

    def back_m(months):
        y, m = d0.year, d0.month - months
        while m <= 0:
            y, m = y - 1, m + 12
        target = date(y, m, min(d0.day, 28))
        prev = [p for d, p in px if d <= target]
        return prev[-1] if prev else None

    out = {"d": d0.isoformat(), "px": round(p0, 1)}
    for k, base in (("d1", back_n(1)), ("d5", back_n(5)), ("d7", back_n(7)),
                    ("m1", back_m(1)), ("m3", back_m(3)), ("m12", back_m(12))):
        out[k] = round((p0 / base - 1) * 100, 1) if base else None
    return out


def targets():
    cs = set()
    try:
        for c, t in json.load(open(os.path.join(JP, "pipeline.json"), encoding="utf-8"))["companies"].items():
            if t.get("stage", 1) >= 2:
                cs.add(c)
    except (OSError, ValueError, KeyError):
        pass
    try:
        for w in json.load(open(os.path.join(ROOT, "docs", "data", "room.json"), encoding="utf-8")).get("watch", []):
            if w.get("m", "jp") == "jp":
                cs.add(w["c"])
    except (OSError, ValueError):
        pass
    return sorted(cs)


def main(args):
    force = "--force" in args
    codes = [a for a in args if not a.startswith("--")]
    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except (OSError, ValueError):
        old = {"updated": "", "items": {}}
    now = datetime.now(KST)
    if not force and not codes and old.get("updated"):
        age = now - datetime.strptime(old["updated"], "%Y-%m-%d %H:%M").replace(tzinfo=KST)
        if age < timedelta(minutes=MIN_AGE):
            print(f"수익률: {int(age.total_seconds() // 60)}분 전에 갱신 — 건너뜀")
            return
    items = old.get("items", {})
    todo = codes or targets()
    ok = 0
    for c in todo:
        try:
            r = ret(closes(c))
            if r:
                items[c] = r
                ok += 1
        except Exception as e:   # 하나 실패해도 나머지는 계속
            print("  야후 실패", c, e)
        time.sleep(0.3)
    old = {"updated": now.strftime("%Y-%m-%d %H:%M"), "items": items}
    json.dump(old, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"수익률 {ok}/{len(todo)}곳 → docs/data/jp/ret.json")


if __name__ == "__main__":
    main(sys.argv[1:])
