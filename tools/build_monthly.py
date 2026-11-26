# -*- coding: utf-8 -*-
"""월차(月次) — 월차를 내는 회사만 docs/data/jp/monthly/<코드>.json 으로(최근 24개월, 열 이름 한국어).

  원천  VANTAGE docs/data/jp/monthly/<코드>.json (TDnet·회사 IR 월차 원장, 매일 갱신)
        tools/monthly_extra/<코드>.json         (VANTAGE 에 없는 회사 — jp_monthly 도구로 받아 넣음)
  번역  VANTAGE jp-screener.js 의 MO_DICT(일본어 → 한국어, 긴 낱말부터 바꿈)
  대상  원장에 있는 회사 전부(2026-11-24 사용자: 월차 탭 — 월차 내는 회사 모두. 전에는 사이트 회사만)
  결과  docs/data/jp/monthly/<코드>.json + index.json(월차 있는 코드 목록·최신 달)
        + hub.json  월차 탭 목록 {updated, items:[{c, n, sec, m(최신 달), pub(발표일), pre(속보), src, k(최신 달 값)}]}
  VANTAGE 폴더가 없으면 깃허브 원본(raw.githubusercontent.com)에서 읽는다(노트북, 2026-11-24).

  실행  python tools/build_monthly.py [--vantage C:\\dev\\vantage-0910]
"""
import argparse
import glob
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "jp", "monthly")
EXTRA = os.path.join(ROOT, "tools", "monthly_extra")
N = 24


def load(p):
    return json.load(open(p, encoding="utf-8"))


def mo_dict(vantage):
    js = open(os.path.join(vantage, "docs", "jp-screener.js"), encoding="utf-8").read()
    m = re.search(r"const MO_DICT=(\[.*?\]);", js, re.S)
    pairs = json.loads(m.group(1)) if m else []
    return sorted(pairs, key=lambda p: -len(p[0]))


def ko(s, pairs):
    for a, b in pairs:
        s = s.replace(a, b)
    s = re.sub(r"사업(?=[^\s·])", "사업 ", s)
    return re.sub(r"\s+", " ", s).replace("전년비", "전년 대비").strip()


def universe():
    d = os.path.join(ROOT, "docs", "data", "jp")
    s1 = load(os.path.join(d, "stage1.json"))
    codes = {r["c"] for r in s1.get("rows", [])} | {r["c"] for r in s1.get("upcoming", [])}
    pf = os.path.join(d, "pipeline.json")
    if os.path.exists(pf):
        codes |= set(load(pf).get("companies", {}))
    return codes


GH = "https://raw.githubusercontent.com/minwook1011/vantage-0910/main/"
GH_LIST = "https://api.github.com/repos/minwook1011/vantage-0910/contents/docs/data/jp/monthly"


def _get(url):
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=60).read().decode("utf-8")


def sources(vantage):
    """{코드: 원장 dict} — VANTAGE 폴더 → 없으면 깃허브. tools/monthly_extra 가 덮어씀."""
    out = {}
    if os.path.isdir(os.path.join(vantage, "docs", "data", "jp", "monthly")):
        for f in glob.glob(os.path.join(vantage, "docs", "data", "jp", "monthly", "*.json")):
            out[os.path.basename(f)[:-5]] = load(f)
    else:
        for it in json.loads(_get(GH_LIST)):
            if it["name"].endswith(".json") and it["name"] != "index.json":
                try:
                    out[it["name"][:-5]] = json.loads(_get(GH + "docs/data/jp/monthly/" + it["name"]))
                except Exception as e:  # noqa: BLE001
                    print("  못 받음", it["name"], e)
    for f in glob.glob(os.path.join(EXTRA, "*.json")):
        out[os.path.basename(f)[:-5]] = load(f)
    return out


def ko_names():
    """한국어 회사 이름·섹터 — 100억 전 종목(sectors.json) · 리포트 · 1단계 · 텔레 단계"""
    d = os.path.join(ROOT, "docs", "data", "jp")
    nm, sec = {}, {}
    try:
        sj = load(os.path.join(d, "sectors.json"))
        for c, v in sj.get("items", {}).items():
            nm[c], sec[c] = v.get("n"), v.get("s")
        sec.update({c: v for c, v in sj.get("x", {}).items() if c not in sec})
    except (OSError, ValueError):
        pass
    for f, get in (("stage1.json", lambda j: [(r["c"], r.get("n")) for r in j.get("rows", []) + j.get("upcoming", [])]),
                   ("pipeline.json", lambda j: [(c, v.get("n")) for c, v in j.get("companies", {}).items()])):
        try:
            for c, n in get(load(os.path.join(d, f))):
                if n and not nm.get(c):
                    nm[c] = n
        except (OSError, ValueError):
            pass
    return nm, sec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vantage", default=r"C:\devantage-0910")
    a = ap.parse_args()
    if os.path.exists(os.path.join(a.vantage, "docs", "jp-screener.js")):
        js = open(os.path.join(a.vantage, "docs", "jp-screener.js"), encoding="utf-8").read()
    else:
        js = _get(GH + "docs/jp-screener.js")
    m = re.search(r"const MO_DICT=(\[.*?\]);", js, re.S)
    # 100억 MO_DICT 에 없는 낱말(2026-11-26, 료힌케이카쿠 해외 지역별 등)
    more = [["東南アジア・オセアニア", "동남아·오세아니아"], ["東アジア", "동아시아"], ["欧米", "유럽·미주"], ["中国大陸", "중국 대륙"], ["全世界", "전 세계"],
            ["衣服・雑貨", "의류·잡화"], ["生活雑貨", "생활잡화"], ["月末店舗数", "월말 점포 수"], ["店舗数", "점포 수"], ["大陸", "대륙"], ["数", " 수"],
            ["食品", "식품"], ["店頭", "매장"], ["冷蔵庫", "냉장고"], ["携帯電話", "휴대전화"], ["支店", "지점"], ["リフォーム", "리폼"], ["寮", "기숙사"]]
    pairs = sorted((json.loads(m.group(1)) if m else []) + more, key=lambda p: -len(p[0]))
    os.makedirs(OUT, exist_ok=True)
    nm, sec = ko_names()
    index, hub = {}, []
    for c, d in sorted(sources(a.vantage).items()):
        cols = d.get("cols") or []
        if "rows" in d:
            rows = d["rows"]
        else:
            rows = [[m] + [d["data"][m].get(k) for k in cols] for m in sorted(d.get("data", {}), reverse=True)]
        rows = sorted(rows, key=lambda r: r[0])[-N:]
        if not rows:
            continue
        units = d.get("units") or {}
        ratio = [("전년比" in k) or ("伸長率" in k) or (units.get(k, units.get("*", "")).startswith("전년")) for k in cols]
        kcols = [ko(k, pairs) for k in cols]
        lt = d.get("latest") or {}
        out = {"c": c, "cols": kcols, "ratio": ratio, "rows": rows, "units": [ko(units.get(k, units.get("*", "")), pairs) for k in cols],
               "note": d.get("note"), "src": lt.get("url") or lt.get("pdf"), "pub": lt.get("published"), "fy": d.get("fy_end_month")}
        json.dump(out, open(os.path.join(OUT, f"{c}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        index[c] = rows[-1][0]
        hub.append({"c": c, "n": nm.get(c) or d.get("name_en") or c, "sec": sec.get(c, ""), "m": rows[-1][0],
                    "pub": lt.get("published") if lt.get("month") == rows[-1][0] else None, "pre": bool(lt.get("preliminary")),
                    "src": out["src"], "cols": kcols, "ratio": ratio, "k": rows[-1][1:], "p": rows[-13][1:] if len(rows) >= 13 else None})
    json.dump(index, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    from datetime import datetime, timedelta, timezone
    json.dump({"updated": datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M"), "items": hub},
              open(os.path.join(OUT, "hub.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"월차 {len(index)}곳 →", OUT)


if __name__ == "__main__":
    main()
