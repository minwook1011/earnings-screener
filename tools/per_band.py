# -*- coding: utf-8 -*-
"""PER 밴드(2단계 보고서 7번 섹션 맨 위)를 AI 없이 만든다(토큰 0). 2026-10-26 사용자 시험.

python tools/per_band.py <코드> <작업 폴더> [--years 3]
→ <작업 폴더>/<코드>_perband.json
  chart : 빌더(build_deep.py)에 그대로 넣는 price 차트 블록(월말 주가 + 그달 유효한 회사 예상 EPS × PER 하단·평균·상단 계단)
  val   : valuation.py 입력(price·eps_guide·band) — history·guide_growth 는 AI 가 채운다
  steps : 예상 EPS 이력(공표일·출처) / gaps : 비는 곳(AI 가 도구로 채울 것)
예상 EPS = 결산단신 요약 + 실적 예상 수정 공시의 XBRL(연간 예상 EPS). 범위로 낸 회사는 가운데 값.
"""
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_xlsx as bx  # noqa: E402
from prep_data import chart, forecast  # noqa: E402

KST = timezone(timedelta(hours=9))
CAP = 60   # 이보다 높은 PER 은 이익 바닥 탓으로 보고 뺀다
EPS = ("NetIncomePerShare", "BasicEarningsPerShareIFRS", "BasicEarningsPerShare", "NetIncomePerShareUS")


def docs(code, since):
    """since(YYYY-MM-DD) 뒤 결산단신 + 실적 예상 수정, 새것부터. 수정 공시는 XBRL 이 없기도 하다(xbrl=None)."""
    raw = bx.get(bx.LIST.format(code=code))
    out = []
    for it in json.loads(raw or b"{}").get("items", []):
        t = it.get("Tdnet", it) if isinstance(it, dict) else {}
        title, day = t.get("title", ""), t.get("pubdate", "")[:10]
        if "訂正" in title or day < since:
            continue
        kind = "결산단신" if "決算短信" in title else "예상 수정" if re.search(r"業績予想|予想の修正", title) else None
        m = re.search(r"(\d{18})\.pdf", t.get("document_url", ""))
        if kind and m:
            x = re.search(r"(https://www\.release\.tdnet\.info/inbs/\d+\.zip)", t.get("url_xbrl") or "")
            out.append({"doc": m.group(1), "date": day, "kind": kind, "xbrl": x.group(1) if x else None})
    return out


def zip_path(code, f):
    """결산단신은 build_xlsx 캐시를 같이 쓰고, 수정 공시(0912…)는 주소를 그대로 받는다."""
    if f["kind"] == "결산단신":
        return bx.zip_of(code, f["doc"])
    p = os.path.join(bx.CACHE, code, "rv" + f["doc"] + ".zip")
    if os.path.exists(p) and zipfile.is_zipfile(p):
        return p
    name = f["xbrl"].rsplit("/", 1)[-1]   # 적시공시 사이트는 한 달 뒤 지워져서 거래소 보관 주소 먼저
    for u in (f"https://www2.jpx.co.jp/disc/{code}0/{name}", f["xbrl"]):
        b = bx.get(u, tries=1)
        if b and b[:2] == b"PK":
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, "wb").write(b)
            return p
    return None


def eps_of(path):
    """XBRL 안의 연간 예상 EPS(엔). 범위면 가운데. 없으면 None."""
    vals = {}
    try:
        z = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile):
        return None
    for n in z.namelist():
        if not n.endswith("ixbrl.htm"):
            continue
        s = z.read(n).decode("utf-8", "ignore")
        for m in re.finditer(r"<ix:nonFraction([^>]*)>([^<]*)</ix:nonFraction>", s):
            at, txt = m.group(1), m.group(2)
            nm = re.search(r'name="[^":]+:([^"]+)"', at)
            cx = re.search(r'contextRef="([^"]+)"', at)
            if not nm or not cx or nm.group(1) not in EPS:
                continue
            c = cx.group(1)
            if "Forecast" not in c or "Year" not in c or "Q2" in c or "NonConsolidated" in c:
                continue
            try:
                v = float(txt.replace(",", ""))
            except ValueError:
                continue
            if 'sign="-"' in at:
                v = -v
            # 다음 해 예상(결산단신 4분기)이 있으면 그걸, 아니면 올해 예상
            yr = "next" if "NextYear" in c else "cur"
            rng = "lo" if "Lower" in c else "hi" if "Upper" in c else "mid"
            vals.setdefault(yr, {})[rng] = v
    for yr in ("next", "cur"):
        d = vals.get(yr)
        if d:
            return d.get("mid", (d.get("lo", 0) + d.get("hi", 0)) / 2 if "lo" in d and "hi" in d else d.get("lo", d.get("hi")))
    return None


def main(code, folder, years=3):
    os.makedirs(folder, exist_ok=True)
    steps, gaps = [], []
    now = datetime.now(KST)
    since = f"{now.year - years - 1}-{now.month:02d}-01"   # 밴드 첫 달에 유효한 예상까지
    fl = docs(code, since)
    tanshin_days = {f["date"] for f in fl if f["kind"] == "결산단신"}
    for f in fl:
        if f["kind"] == "예상 수정" and f["date"] in tanshin_days:
            continue          # 같은 날 결산단신 요약에 바뀐 예상이 들어 있다
        p = zip_path(code, f) if (f["kind"] == "결산단신" or f["xbrl"]) else None
        e = eps_of(p) if p else None
        if e is None:
            gaps.append(f'{f["date"]} {f["kind"]} 예상 EPS 못 읽음' + ("(XBRL 없음 — 공시 PDF 에서 확인)" if not p else ""))
            continue
        steps.append({"date": f["date"], "eps": round(e, 2), "src": f["kind"]})
    last_t = next((f for f in fl if f["kind"] == "결산단신"), None)   # 새것부터라 첫 번째가 최신
    if last_t:   # 순이익 예상이 경상이익의 80%를 넘으면 특별이익(자산 매각 등)이 섞였을 가능성 — PER 이 싸 보인다
        fc = forecast(bx.zip_of(code, last_t["doc"]))
        if fc.get("순이익") and fc.get("경상이익") and fc["경상이익"] > 0 and fc["순이익"] > fc["경상이익"] * 0.8:
            gaps.append(f'최신 회사 예상 순이익 {fc["순이익"]}억 엔이 경상이익 {fc["경상이익"]}억 엔의 {fc["순이익"] / fc["경상이익"] * 100:.0f}% '
                        f'— 일회성 특별이익이 섞였을 수 있음. 결산단신에서 확인하고, 맞으면 정상 EPS 로 지금 PER 을 다시 적는다')
    steps.sort(key=lambda x: x["date"])
    # 같은 날 두 건이면 나중 것(수정)만
    steps = list({s["date"]: s for s in steps}.values())

    daily = chart(code + ".T", "10y", "1mo")   # 월간 = 월말 종가
    if not daily:
        sys.exit("주가를 못 받았습니다")
    cut =f"{now.year - years}-{now.month:02d}"
    months = list({d[:7]: (d[:7], c) for d, c in daily if d[:7] > cut}.values())   # 이번 달은 마지막 값(지금 주가)
    labels, price, eps, per = [], [], [], []
    for ym, c in months:
        last = [s for s in steps if s["date"][:7] <= ym]
        e = last[-1]["eps"] if last else None
        labels.append(ym[2:].replace("-", "."))
        price.append(round(c))
        eps.append(e)
        per.append(c / e if e and e > 0 else None)
    if steps and steps[0]["date"][:7] > months[0][0]:
        gaps.append(f'{months[0][0]}~{steps[0]["date"][:7]} 예상 EPS 없음(결산단신이 그보다 오래됨) — 밴드 비움')
    neg = sorted({labels[i] for i, e in enumerate(eps) if e is not None and e <= 0})
    if neg:
        gaps.append(f"예상 EPS 0 이하(적자 예상) 구간 {neg[0]}~{neg[-1]} — PER 계산 빼고 밴드 비움")
    big = [labels[i] for i, p in enumerate(per) if p and p > CAP]
    if big:   # 예상 이익이 바닥이라 PER 이 튀는 달 — 범위를 망가뜨려서 뺀다
        gaps.append(f"예상 EPS 가 너무 작아 PER {CAP}배 넘는 달 {len(big)}개({big[0]}~{big[-1]}) — 범위 계산·밴드에서 뺌")
        per = [None if p and p > CAP else p for p in per]
        eps = [None if per[i] is None and eps[i] and eps[i] > 0 and price[i] / eps[i] > CAP else eps[i] for i in range(len(eps))]
    ok = [p for p in per if p]
    if len(ok) < 6:
        sys.exit(f"PER 계산 가능한 달이 {len(ok)}개뿐 — AI 가 도구로 채워야 함")
    # 하단·상단 = 하위·상위 10%(최저·최고 한 달이 범위를 끌고 가지 않게), 평균 = 산술평균
    srt = sorted(ok)
    pct = lambda q: srt[min(len(srt) - 1, max(0, round(q * (len(srt) - 1))))]   # noqa: E731
    lo, hi, avg = pct(0.1), pct(0.9), sum(ok) / len(ok)
    band = lambda m: [round(e * m) if e and e > 0 else None for e in eps]   # noqa: E731
    cur_per = per[-1]
    where = "아래쪽" if cur_per and cur_per < avg * 0.85 else "위쪽" if cur_per and cur_per > avg * 1.15 else "평균 근처"
    chart_blk = {
        "type": "chart", "kind": "price", "height": 300,
        "title": f"지금 PER {cur_per:.1f}배 — {years}년 범위의 {where}" if cur_per else "PER 밴드",
        "subtitle": f"월말 주가와 그달 유효한 회사 예상 EPS × PER {lo:.1f}(하위 10%)·{avg:.1f}(평균)·{hi:.1f}배(상위 10%), 엔 · {labels[0]}~{labels[-1]}",
        "unit": "엔", "zero": False, "end_labels": True,
        "source": "결산단신·실적 예상 수정 공시의 회사 예상 EPS(공표일 기준), 야후 월간 수정주가 (직접 계산)",
        "labels": labels,
        "series": [{"name": "주가", "data": price, "color": "resi"}],
        "bands": [{"name": f"PER {hi:.1f}배", "data": band(hi), "color": "pos"},
                  {"name": f"PER {avg:.1f}배", "data": band(avg), "color": "cni"},
                  {"name": f"PER {lo:.1f}배", "data": band(lo), "color": "oth"}],
    }
    res = {"code": code, "made": now.strftime("%Y-%m-%d %H:%M"),
           "note": "per_band.py 가 AI 없이 만든 PER 밴드. chart 는 deep.json 7번 섹션 맨 위에 그대로 넣는다. gaps 가 있으면 그 부분만 도구로 확인해 고친다.",
           "now": {"price": price[-1], "eps": eps[-1], "per": round(cur_per, 1) if cur_per else None},
           "band": {"lo": round(lo, 1), "avg": round(avg, 1), "hi": round(hi, 1), "months": len(ok)},
           "val": {"price": price[-1], "eps_guide": {"lo": eps[-1], "mid": eps[-1], "hi": eps[-1]},
                   "band": {"lo": round(lo, 1), "avg": round(avg, 1), "hi": round(hi, 1)}},
           "steps": steps, "gaps": gaps, "chart": chart_blk}
    out = os.path.join(folder, f"{code}_perband.json")
    json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{code} PER 밴드 → {out}")
    print(f"  지금 {price[-1]}엔 · 예상 EPS {eps[-1]} · PER {res['now']['per']}배 · 밴드 {lo:.1f}/{avg:.1f}/{hi:.1f}배({len(ok)}개월) · 예상 이력 {len(steps)}건 · 빈 곳 {len(gaps)}")
    for g in gaps:
        print("  빈 곳:", g)


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) < 2:
        sys.exit(__doc__)
    y = int(a[a.index("--years") + 1]) if "--years" in a else 3
    main(a[0], a[1], y)
