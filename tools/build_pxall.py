# -*- coding: utf-8 -*-
"""일본 주요 전 종목 판 — 100억 사이트(vantage-0910)에 있는 일본 종목 전부(소비재·주요 기업·추가분, 앞으로 늘어나는 것 포함)
   신고가 · 신고가 근접 · 턴어라운드 · 상한가(+8% 이상) — 2026-10-29 사용자. 매일 10:00 · 15:30, 상한가만 19:00 에도(카부탄).

  종목 목록  100억 docs/data/jp/screener-data.js(RAW) · major-data.js(RAW_MAJ) · consumer-extra.js(RAW_EXT)를 그때그때 읽는다
             (C:\\dev\\vantage-0910 → 없으면 깃허브 원본). 추가된 종목은 다음 회차에 저절로 들어온다.
  주가       야후 일봉. 처음엔 5년치, 그 뒤엔 최근 1달치만 받아 tools/pxall_cache/<코드>.json(깃 제외)에 덧붙인다.
  판정       build_px.judge 와 같음(신고가 = 최근 5거래일 안에 52주 고가 새로 씀 · 근접 = 52주 고가에서 15% 이내 · 턴어라운드 = 20·60·120일선 역배열→정배열)
  상한가     +8% 이상 상승. 야후 마지막 일봉(전일 종가 대비) + 카부탄 상승률 순위(장중 '今日の株価上昇率' · 시간외 'PTSナイトタイムセッション')
             카부탄 'S' 표시 = 진짜 상한가(ストップ高)
  결과       docs/data/jp/pxall/index.json — 판에 걸린 종목만(카드용 1년 종가 포함)
             docs/data/jp/pxall/<코드>.json — 판에 걸린 종목만 5년 일봉(카드 누르면 큰 차트). 판에서 빠지면 지운다.

  python tools/build_pxall.py               전부(야후 + 카부탄)
  python tools/build_pxall.py --kabutan     카부탄만 다시 보고 상한가 판만 갈아 끼움(19:00 회차)
"""
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_px import judge  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "jp", "pxall")
CACHE = os.path.join(ROOT, "tools", "pxall_cache")
KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0"}
VANTAGE = [os.environ.get("VANTAGE_DIR", ""), r"C:\dev\vantage-0910", os.path.join(os.path.expanduser("~"), "repos", "vantage-0910")]
RAWGH = "https://raw.githubusercontent.com/minwook1011/vantage-0910/main/"
UP = 8.0


def get(url, timeout=25):
    for i in range(3):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read().decode("utf-8", "replace")
        except Exception:
            time.sleep(1.5 * (i + 1))
    return ""


def vfile(rel):
    for v in VANTAGE:
        p = os.path.join(v, rel)
        if os.path.exists(p):
            return open(p, encoding="utf-8").read()
    return get(RAWGH + rel.replace("\\", "/"))


def arr(text, name):
    m = re.search(r"const " + name + r" = (\[.*?\]);\s*\n", text, re.S)
    return json.loads(m.group(1)) if m else []


def universe():
    """{코드: {n, en, cat, mc, per, ytd, py, revg, roe, opm, sales}} — RAW 열: 코드, 영문, 업종, 세부, 주가, 시총(억엔), 매출성장, 1Y, YTD, PER, ROE, OPM, 매출"""
    rows = arr(vfile(r"docs\data\jp\screener-data.js"), "RAW") + arr(vfile(r"docs\data\jp\consumer-extra.js"), "RAW_EXT")
    maj = arr(vfile(r"docs\data\jp\major-data.js"), "RAW_MAJ")
    try:
        ko = json.loads(re.search(r"const KO_NAMES = (\{.*?\});", vfile(r"docs\data\jp\names-ko.js"), re.S).group(1))
    except Exception:
        ko = {}
    try:
        ta = {x.get("code") or x.get("c"): x.get("name") for x in json.loads(vfile(r"docs\data\ta\jp.json")).get("items", [])}
    except Exception:
        ta = {}
    out = {}
    for r, jp in [(r, None) for r in rows] + [(r, r[3]) for r in maj]:
        c = str(r[0])
        if c in out or not re.fullmatch(r"\d{3}[0-9A-Z]\d?", c):
            continue
        n = ta.get(c) or (ko.get(c) or "").split(" ")[0] or jp or r[1]
        out[c] = {"n": n, "en": r[1], "cat": r[2], "mc": r[5], "revg": r[6], "py": r[7], "ytd": r[8], "per": r[9]}
        if len(r) > 12:   # 실적 캘린더 요약 재무용(build_cal.py)
            out[c].update({"roe": r[10], "opm": r[11], "sales": r[12]})
    # 일본 소비재 전 종목(소형주 포함, 2026-10-30 사용자) — docs/data/jp/consumer_all.json. 100억에 없는 종목은 YTD 만 일봉으로 계산
    try:
        ca = json.load(open(os.path.join(ROOT, "docs", "data", "jp", "consumer_all.json"), encoding="utf-8")).get("items", {})
    except (OSError, ValueError):
        ca = {}
    for c, v in ca.items():
        if c in out:
            out[c]["con"] = v.get("cat")
        elif re.fullmatch(r"\d{3}[0-9A-Z]\d?", c):
            out[c] = {"n": v.get("n") or v.get("jp") or c, "en": v.get("jp") or "", "cat": v.get("cat"), "mc": v.get("mc"), "revg": None, "py": None, "ytd": None, "per": None, "con": v.get("cat")}
    return out


def yahoo(code, rng):
    t = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{code}.T?range={rng}&interval=1d", timeout=20)
    if not t:
        return []
    r = json.loads(t)["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    rows = []
    for i, ts in enumerate(r.get("timestamp") or []):
        o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
        if None in (o, h, l, c):
            continue
        rows.append([datetime.fromtimestamp(ts, KST).date().isoformat(), round(o, 1), round(h, 1), round(l, 1), round(c, 1), int(q["volume"][i] or 0)])
    return rows


def bars(code):
    """캐시 + 최근 1달 → 5년 일봉 rows"""
    p = os.path.join(CACHE, f"{code}.json")
    try:
        old = json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        old = []
    new = yahoo(code, "1mo" if len(old) > 200 else "5y")
    if not new:
        return old
    keep = {r[0]: r for r in old}
    keep.update({r[0]: r for r in new})   # 같은 날은 새 값(장중 → 종가)
    rows = sorted(keep.values())
    cut = (datetime.now(KST).date() - timedelta(days=5 * 366)).isoformat()
    rows = [r for r in rows if r[0] >= cut]
    json.dump(rows, open(p, "w", encoding="utf-8"), separators=(",", ":"))
    return rows


def kabutan_up():
    """카부탄 상승률 순위에서 +8% 이상 → {코드: {"day": %, "stop": bool, "pts": %, "pts_px": 가격}}"""
    out = {}
    for kind, path in (("day", "warning/?mode=2_1"), ("pts", "warning/pts_night_price_increase")):
        for page in range(1, 40):
            h = get(f"https://kabutan.jp/{path}{'&' if '?' in path else '?'}page={page}")
            h = h[h.find("stock_table st_market"):]
            tb = h[h.find("<tbody>"):h.find("</tbody>")]
            rows = re.findall(r"<tr>(.*?)</tr>", tb, re.S)
            if not rows:
                break
            low = False
            for r in rows:
                cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)]
                pc = [c for c in cells if re.fullmatch(r"[+-]?\d+(\.\d+)?%", c)]
                if not cells or not pc:
                    continue
                v = float(pc[0].rstrip("%"))
                if v < UP:
                    low = True
                    break
                d = out.setdefault(cells[0], {})
                d[kind] = v
                if kind == "day":
                    d["stop"] = "S" in cells[5:8]
                else:
                    try:
                        d["pts_px"] = float(cells[6].replace(",", ""))
                    except (IndexError, ValueError):
                        pass
            if low:
                break
            time.sleep(0.8)
    return out


def ytd(c):
    try:
        rows = json.load(open(os.path.join(CACHE, f"{c}.json"), encoding="utf-8"))
    except (OSError, ValueError):
        return None
    y = datetime.now(KST).strftime("%Y")
    base = [r[4] for r in rows if r[0] < y]
    return round((rows[-1][4] / base[-1] - 1) * 100, 1) if base and rows else None


def card(rows, u):
    b = {"d": [r[0] for r in rows], "o": [r[1] for r in rows], "h": [r[2] for r in rows], "l": [r[3] for r in rows], "c": [r[4] for r in rows]}
    j = judge(b)
    if len(rows) >= 2:
        j["chg"] = round((rows[-1][4] / rows[-2][4] - 1) * 100, 2)
    return j


def main():
    only_kb = "--kabutan" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    U = universe()
    idx_p = os.path.join(OUT, "index.json")
    try:
        prev = json.load(open(idx_p, encoding="utf-8"))
    except (OSError, ValueError):
        prev = {"items": {}}
    kb = kabutan_up()
    items, ok, bad = {}, 0, 0
    if only_kb:
        # 다른 판은 그대로 두고 상한가 표시만 새로
        items = {c: dict(v, up=None) for c, v in prev["items"].items()}
        for c, k in kb.items():
            if c not in U:
                continue
            p = os.path.join(CACHE, f"{c}.json")
            if c not in items:
                try:
                    items[c] = card(json.load(open(p, encoding="utf-8")), U[c])
                except (OSError, ValueError):
                    continue
            items[c]["up"] = {"day": k.get("day"), "pts": k.get("pts"), "stop": k.get("stop", False), "pts_px": k.get("pts_px")}
    else:
        for c in sorted(U):
            try:
                rows = bars(c)
            except Exception as e:
                print(f"  [skip] {c}: {e}")
                bad += 1
                continue
            if len(rows) < 30:
                bad += 1
                continue
            ok += 1
            j = card(rows, U[c])
            k = kb.get(c) or {}
            up = None
            if (j.get("chg") or 0) >= UP or k:
                up = {"day": k.get("day", j.get("chg") if (j.get("chg") or 0) >= UP else None), "pts": k.get("pts"), "stop": k.get("stop", False), "pts_px": k.get("pts_px")}
            j["up"] = up
            items[c] = j
            time.sleep(0.25)
    # 판에 걸린 종목만 남김
    keep = {}
    for c, j in items.items():
        if c not in U or not (j.get("new") or j.get("near") or j.get("turn") or j.get("up")):
            continue
        keep[c] = dict(j, **U[c])
        if keep[c].get("ytd") is None:
            keep[c]["ytd"] = ytd(c)
    for c in keep:
        src = os.path.join(CACHE, f"{c}.json")
        if os.path.exists(src):
            rows = json.load(open(src, encoding="utf-8"))
            open(os.path.join(OUT, f"{c}.json"), "w", encoding="utf-8").write("[\n" + ",\n".join(json.dumps(r) for r in rows) + "\n]\n")
    for f in os.listdir(OUT):
        if f.endswith(".json") and f != "index.json" and f[:-5] not in keep:
            os.remove(os.path.join(OUT, f))
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    out = {"updated": now if not only_kb else prev.get("updated", now), "kabutan": now, "n_universe": len(U), "items": keep}
    json.dump(out, open(idx_p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    cnt = lambda f: sum(1 for j in keep.values() if j.get(f))
    print(f"전 종목 {len(U)}개" + ("" if only_kb else f" · 주가 {ok}개 받음 · 실패 {bad}") +
          f" · 신고가 {cnt('new')} · 근접 {cnt('near')} · 턴어라운드 {cnt('turn')} · 상한가(+8%) {cnt('up')} (카부탄 {len(kb)}곳 중 해당 {sum(1 for c in kb if c in U)})")


if __name__ == "__main__":
    main()
