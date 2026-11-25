# -*- coding: utf-8 -*-
"""선행지표 탭 월간 갱신(2026-11-16 사용자) — docs/data/jp/lead/<코드>.json 의 외부 월간 지표를 채운다.

  선행지표 원칙: 회사 발표·가이던스가 아닌, 밖에서 매달 나오는 데이터만(지금은 후생연금 가입자 수).

  ① Landsknecht(친구 사이트, 사용 허락) — 법인별 가입자 수 13개월 이력. lead.items[].lk = 슬러그
  ② 일본연금기구 適用事業所検索 — 법인번호로 지금 값 직접 조회. lead.items[].nenkin = [법인번호 …](여럿이면 합계, stack 이면 법인별)
     데이터 갱신일(매달 둘째 영업일 무렵)의 값 = 그 전달 20일 무렵 기준 → 원장 달 = 갱신일의 전달
  ③ 다음 갱신일(lead.next) — 다음 달 둘째 영업일(주말·공휴일 제외)
  ④ 주가 — data/jp/px/<코드>.json 이 없거나 오늘 것이 아니면 야후 일봉 5년(build_px.py 와 같은 형식)

  python tools/lead_update.py            전부
  python tools/lead_update.py 6088 9168  일부
  python tools/lead_update.py --push     갱신 뒤 사이트로 올림(작업 스케줄러 매일 실행 — 연금기구 값은 갱신일이 바뀐 날만 새로 조회)
  --force  같은 달 값이 있어도 다시 조회
"""
import datetime as dt
import json
import os
import re
import sys
import subprocess
import time

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAD = os.path.join(ROOT, "docs", "data", "jp", "lead")
PX = os.path.join(ROOT, "docs", "data", "jp", "px")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
NK = "https://www.nenkin.go.jp/do/search_section"
LK = "https://landsknecht.jp/map/"
YH = "https://query1.finance.yahoo.com/v8/finance/chart/{c}.T?range=5y&interval=1d"
HOLI = {"2026-11-03", "2026-11-23", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03", "2027-01-11",
        "2027-02-11", "2027-02-23", "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05", "2027-07-19", "2027-08-11",
        "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23", "2027-12-29", "2027-12-30", "2027-12-31"}


def ym_prev(d):
    y, m = d.year, d.month - 1
    if m == 0:
        y, m = y - 1, 12
    return f"{y}-{m:02d}"


def second_bday(y, m):
    d, n = dt.date(y, m, 1), 0
    while True:
        if d.weekday() < 5 and d.isoformat() not in HOLI:
            n += 1
            if n == 2:
                return d
        d += dt.timedelta(days=1)


def landsknecht(s):
    h = s.get(LK, timeout=30).text
    d = json.loads(re.search(r'<script type="application/json" id="cm-data">(.*?)</script>', h, re.S).group(1))
    return d["months"], {f["slug"]: f["series"] for f in d["firms"]}


def nk_page(s):
    h = s.get(NK + "/", timeout=25).text
    upd = re.search(r"データ更新日：\s*(\d{4})年(\d{2})月(\d{2})日", h)
    tok = re.search(r'name="hdnTransactionToken" value="([^"]+)"', h)
    return dt.date(*map(int, upd.groups())), tok.group(1)


def nk_lookup(s, houjin):
    _, tok = nk_page(s)
    data = [("hdnPrefectureCode", ""), ("hdnSearchOffice", "1"), ("hdnSearchCriteria", "3"), ("txtOfficeName", ""), ("txtOfficeAddress", ""),
            ("txtHoujinNo", houjin), ("hdnDisplayItemsRestorationScreenDto", ""), ("hdnDisplayItemsRestorationScreenDtoKeepParam", "false"),
            ("hdnTransactionToken", tok), ("hdnTokenKeepParam", "false"), ("gmnId", "GB10001SC010"), ("hdnErrorFlg", ""), ("eventId", "/SEARCH.HTML"), ("/search.html", "")]
    t = s.post(NK, data=data, timeout=25, headers={"Referer": NK + "/", "Origin": "https://www.nenkin.go.jp"}).text
    i, n = t.find("被保険者数"), 0
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", t[i:] if i >= 0 else "", re.S):
        cells = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) >= 3 and houjin in cells and re.fullmatch(r"\d+", cells[-1] or ""):
            n += int(cells[-1])
    return n


def px(s, code):
    p = os.path.join(PX, f"{code}.json")
    today = dt.date.today().isoformat()
    try:
        if json.load(open(p, encoding="utf-8"))[-1][0] >= today:
            return "그대로"
    except Exception:
        pass
    r = s.get(YH.format(c=code), timeout=30).json()["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    rows = []
    for i, t in enumerate(r["timestamp"]):
        if q["close"][i] is None:
            continue
        d = dt.datetime.fromtimestamp(t + 9 * 3600, dt.timezone.utc).date().isoformat()
        rows.append([d] + [round(q[k][i], 1) if q[k][i] is not None else None for k in ("open", "high", "low", "close")] + [int(q["volume"][i] or 0)])
    with open(p, "w", encoding="utf-8") as f:
        f.write("[\n" + ",\n".join(json.dumps(x, ensure_ascii=False) for x in rows) + "\n]\n")
    return f"{len(rows)}일"


def put(pts, ym, v, ref, extra=None):
    for p in pts:
        if p[0] == ym:
            if p[2] == "lk" and ref != "lk":   # 같은 달이면 직접 조회 값을 우선
                p[1], p[2] = v, ref
                if extra:
                    p[3:] = [extra]
            return
    pts.append([ym, v, ref] + ([extra] if extra else []))
    pts.sort(key=lambda p: p[0])


FORCE = False


def main():
    global FORCE
    FORCE = "--force" in sys.argv
    only = {a for a in sys.argv[1:] if not a.startswith("--")}
    idx = json.load(open(os.path.join(LEAD, "index.json"), encoding="utf-8"))
    codes = [c for c in idx["cos"] if not only or c in only]
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "ja"})
    months, lks = landsknecht(s)
    upd, _ = nk_page(s)
    ym = ym_prev(upd)
    nxt = second_bday(upd.year + (upd.month == 12), upd.month % 12 + 1)
    print(f"Landsknecht {months[0]}~{months[-1]} · 연금기구 갱신일 {upd}({ym} 기준) · 다음 갱신 {nxt}")
    for c in codes:
        p = os.path.join(LEAD, f"{c}.json")
        if not os.path.exists(p):
            continue
        d = json.load(open(p, encoding="utf-8"))
        for it in d.get("lead", {}).get("items", []):
            if it.get("lk") in lks:
                for m, v in zip(months, lks[it["lk"]]):
                    if v is not None:
                        put(it["pts"], m, v, "lk")
            if it.get("nenkin") and (FORCE or not any(p[0] == ym and p[2] == "nk" for p in it["pts"])):
                parts = {}
                for h in it["nenkin"]:
                    parts[h] = nk_lookup(s, h)
                    time.sleep(1.2)
                if all(v == 0 for v in parts.values()):
                    print("  조회 실패", c, it["id"])
                    continue
                if it.get("stack"):
                    keys = [k[0] for k in it["stack"]]
                    extra = {k: parts[h] for k, h in zip(keys, it["nenkin"])}
                    put(it["pts"], ym, sum(parts.values()), "nk", extra)
                else:
                    put(it["pts"], ym, sum(parts.values()), "nk")
        d["lead"]["next"] = {"date": nxt.isoformat(), "basis": f"{nxt.year if nxt.month > 1 else nxt.year - 1}-{(nxt.month - 2) % 12 + 1:02d}-20",
                             "note": "일본연금기구 데이터 갱신일(매달 둘째 영업일 무렵) — 그 전달 20일 무렵 기준 값이 나옴"}
        d.setdefault("refs", {})["nk"] = {"date": upd.isoformat(), "t": "일본연금기구 厚生年金保険・健康保険 適用事業所検索(법인번호 직접 조회)", "url": "https://www.nenkin.go.jp/do/search_section/"}
        d["updated"] = dt.date.today().isoformat()
        json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        try:
            pr = px(s, c)
        except Exception as e:
            pr = f"실패 {e}"
        last = [it["pts"][-1][:2] for it in d["lead"]["items"]]
        print(f"  {c} {d['n']} 지표 {last} · 주가 {pr}")
    idx = json.load(open(os.path.join(LEAD, "index.json"), encoding="utf-8"))   # 목록용 요약(다음 지표·실적 발표일)
    for c in idx["cos"]:
        try:
            d = json.load(open(os.path.join(LEAD, f"{c}.json"), encoding="utf-8"))
            idx["cos"][c].update({"ln": d["lead"]["next"]["date"], "nd": d["next"].get("date"), "nq": d["next"].get("q")})
        except Exception:
            pass
    json.dump(idx, open(os.path.join(LEAD, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    try:   # 주가 선행 백테스트(일치율) — 하루 한 번(2026-11-23 사용자). 실패해도 갱신은 그대로
        bt = json.load(open(os.path.join(LEAD, "bt.json"), encoding="utf-8")).get("updated", "")
    except (OSError, ValueError):
        bt = ""
    if not bt.startswith(dt.date.today().isoformat()):
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "lead_bt.py")], cwd=ROOT)
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "lead_detail.py")], cwd=ROOT)   # 「자세히」 지표별 분석(2026-11-25)
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "lead_cycle.py")], cwd=ROOT)    # 사이클: 업황 현황(2026-11-25)
    subprocess.run([sys.executable, os.path.join(ROOT, "tools", "lead_home.py")], cwd=ROOT)         # 첫 화면 달력·기업 카드(2026-11-25) — 주가 수익률이 바뀌니 매번
    if "--push" in sys.argv:
        paths = ["docs/data/jp/lead"] + [f"docs/data/jp/px/{c}.json" for c in codes if os.path.exists(os.path.join(PX, f"{c}.json"))]
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "gpush.py"), f"data: 선행지표 갱신 {dt.date.today()}"] + paths, cwd=ROOT)


if __name__ == "__main__":
    main()
