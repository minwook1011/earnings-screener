# -*- coding: utf-8 -*-
"""일본 스크리닝 판(신고가 · 신고가 근접 · 턴어라운드) 주가 — 2026-10-29 사용자. 매일 10:00 · 15:30 두 번.

  결과  docs/data/jp/px/<코드>.json  5년 일봉(2026-10-29 사용자: 2년 → 5년) [[날짜, 시, 고, 저, 종, 거래량], …] — 카드를 누르면 여는 큰 차트용
        docs/data/jp/px/index.json   회사마다 판 판정 + 카드 차트(1년 종가)
  대상  build_ret.py 와 같음(2단계 이상 + 2단계 리포트 쓴 회사 + 리서치룸 일본 회사)

  판정(일봉, 52주 = 250거래일)
    신고가       최근 5거래일 안에 고가가 그 전 52주 최고가 이상(새로 씀)
    신고가 근접  신고가가 아니고, 마지막 종가가 52주 최고가에서 15% 이내
    턴어라운드   이동평균 20·60·120일이 지금 정배열(20>60>120)이고, 최근 52주 안에 역배열(20<60<120)이었던 날이 있음
                 → 역배열 뒤 정배열로 바뀐 첫날을 'turn' 으로 적는다

  python tools/build_px.py [코드 …]
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_ret import targets  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "jp", "px")
KST = timezone(timedelta(hours=9))
URL = "https://query1.finance.yahoo.com/v8/finance/chart/{c}.T?range=5y&interval=1d"
Y52, NEW_DAYS, NEAR = 250, 5, 15.0


def bars(code):
    req = urllib.request.Request(URL.format(c=code), headers={"User-Agent": "Mozilla/5.0"})
    r = json.loads(urllib.request.urlopen(req, timeout=20).read())["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    out = {"d": [], "o": [], "h": [], "l": [], "c": [], "v": []}
    for i, t in enumerate(r.get("timestamp") or []):
        o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
        if None in (o, h, l, c):
            continue
        out["d"].append(datetime.fromtimestamp(t, KST).date().isoformat())
        for k, v in (("o", o), ("h", h), ("l", l), ("c", c)):
            out[k].append(round(v, 1))
        out["v"].append(int(q["volume"][i] or 0))
    return out


def ma(xs, n):
    out, s = [], 0.0
    for i, x in enumerate(xs):
        s += x
        if i >= n:
            s -= xs[i - n]
        out.append(s / n if i >= n - 1 else None)
    return out


def judge(b):
    c, h, d = b["c"], b["h"], b["d"]
    n = len(c)
    if n < 30:
        return {}
    w = max(0, n - Y52)
    hi = max(h[w:])
    hi_i = max(i for i in range(w, n) if h[i] == hi)   # 같은 값이면 가장 최근 날
    # 신고가: 최근 5일 중 어느 날 고가가 그날 이전 52주 최고가 이상
    new = False
    for i in range(max(1, n - NEW_DAYS), n):
        prev = h[max(0, i - Y52):i]
        if prev and h[i] >= max(prev):
            new = True
    off = round((c[-1] / hi - 1) * 100, 1)
    m20, m60, m120 = ma(c, 20), ma(c, 60), ma(c, 120)
    up = lambda i: None not in (m20[i], m60[i], m120[i]) and m20[i] > m60[i] > m120[i]
    dn = lambda i: None not in (m20[i], m60[i], m120[i]) and m20[i] < m60[i] < m120[i]
    turn = None
    if up(n - 1):
        last_dn = max((i for i in range(w, n) if dn(i)), default=None)
        if last_dn is not None:
            turn = next(d[i] for i in range(last_dn + 1, n) if up(i))
    # 카드 차트 = 1년 종가 2거래일 간격(끝 값은 마지막 종가). 턴어라운드면 20·60·120일선도
    r = lambda x: None if x is None else (round(x) if x >= 100 else round(x, 1))
    step = list(range(n - 1, w - 1, -2))[::-1]
    out = {"px": c[-1], "d": d[-1], "hi": hi, "hid": d[hi_i], "off": off, "new": new,
           "near": (not new) and off >= -NEAR, "turn": turn, "d0": d[step[0]],
           "cl": [r(c[i]) for i in step]}
    if turn:
        out["tix"] = next(k for k, i in enumerate(step) if d[i] >= turn)
        out["m20"], out["m60"], out["m120"] = [r(m20[i]) for i in step], [r(m60[i]) for i in step], [r(m120[i]) for i in step]
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    codes = sys.argv[1:] or targets()
    idx_p = os.path.join(OUT, "index.json")
    try:
        idx = json.load(open(idx_p, encoding="utf-8"))
    except (OSError, ValueError):
        idx = {"items": {}}
    ok = bad = 0
    for code in codes:
        try:
            b = bars(code)
        except Exception as e:
            print(f"  [skip] {code}: {e}")
            bad += 1
            continue
        if not b["d"]:
            bad += 1
            continue
        # 하루 한 줄(깃이 늘어난 줄만 차이로 저장하게) — [날짜, 시, 고, 저, 종, 거래량]
        rows = [json.dumps([b["d"][i], b["o"][i], b["h"][i], b["l"][i], b["c"][i], b["v"][i]]) for i in range(len(b["d"]))]
        open(os.path.join(OUT, f"{code}.json"), "w", encoding="utf-8").write("[\n" + ",\n".join(rows) + "\n]\n")
        idx["items"][code] = judge(b)
        ok += 1
        time.sleep(0.3)
    idx["updated"] = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    json.dump(idx, open(idx_p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    it = idx["items"].values()
    print(f"주가 {ok}개 받음 · 실패 {bad} · 신고가 {sum(1 for x in it if x.get('new'))} · 근접 {sum(1 for x in it if x.get('near'))} · 턴어라운드 {sum(1 for x in it if x.get('turn'))}")


if __name__ == "__main__":
    main()
