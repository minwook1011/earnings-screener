# -*- coding: utf-8 -*-
"""일본 주요 전 종목 — 가장 최근 실적 발표일 + 최근 8개 분기 실적(2026-10-30 사용자)
  원천  카부탄 결산 페이지(kabutan.jp/stock/finance) 「3ヵ月決算【実績】」 표 — 분기마다 매출·영업이익·경상·순이익(백만엔)과 発表日
  결과  docs/data/jp/ann.json  {updated, items: {코드: {ld: 최근 발표일, lp: 그 분기(26.04-06), at: 받은 날}}}
        docs/data/jp/kq.json   {코드: [[분기, 매출, 영업이익, 순이익, 발표일], …최근 8개]}  금액은 억엔(소수 1자리)
        다음 발표일은 사이트가 cal.json(JPX 예정일)에서 바로 찾는다.
  다시 받는 종목  처음 보는 종목 · 캘린더상 발표일이 지났는데 ld 가 그보다 옛날인 종목(하루 한 번, 발표 뒤 10일까지) · 받은 지 45일 넘은 종목
                  → 평소엔 그날 발표한 회사만 받는다. 이 파일이 곧 캐시라 다른 컴퓨터에서도 처음부터 다시 받지 않는다.
  build_cal.py 가 끝날 때 같이 돈다. 따로: python tools/build_ann.py [--all] [--limit N]
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_pxall import KST, ROOT, get, universe  # noqa: E402

JP = os.path.join(ROOT, "docs", "data", "jp")
ANN, KQ, CAL = os.path.join(JP, "ann.json"), os.path.join(JP, "kq.json"), os.path.join(JP, "cal.json")
NUM = r"(－|-?[\d,]+(?:\.\d+)?)"
ROW = re.compile(r"(\d\d\.\d\d-\d\d)\s+" + r"\s+".join([NUM] * 6) + r"\s+(\d\d/\d\d/\d\d)")


def parse(html):
    """3ヵ月決算 표 → [[분기, 매출, 영업이익, 순이익, 발표일]] (억엔)"""
    i = html.find("3ヵ月決算【実績】")
    if i < 0:
        return []
    j = html.find("前年同期比", i)
    seg = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html[i:j if j > 0 else i + 15000].replace("&nbsp;", " ")))
    def v(x):
        return None if x == "－" else round(float(x.replace(",", "")) / 100, 1)
    out = []
    for m in ROW.finditer(seg):
        g = m.groups()
        out.append([g[0], v(g[1]), v(g[2]), v(g[4]), "20" + g[7].replace("/", "-")])
    return out[-8:]


def load(p):
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def main(a):
    U = universe()
    ann, kq, cal = load(ANN) or {"items": {}}, load(KQ), load(CAL).get("days", {})
    it = ann.setdefault("items", {})
    today = datetime.now(KST).date()
    t, old = today.isoformat(), (today - timedelta(days=45)).isoformat()
    last_cal = {}   # 오늘까지 캘린더상 가장 최근 발표일
    for d, rows in cal.items():
        if d <= t:
            for o in rows:
                last_cal[o["c"]] = max(last_cal.get(o["c"], ""), d)
    def due(c):
        x = it.get(c)
        if "--all" in a or not x:
            return True
        lc = last_cal.get(c)
        if lc and (x.get("ld") or "") < lc and x.get("at") != t and lc >= (today - timedelta(days=10)).isoformat():
            return True
        return (x.get("at") or "") < old
    todo = [c for c in sorted(U) if due(c)]
    if "--limit" in a:
        todo = todo[: int(a[a.index("--limit") + 1])]
    ok = bad = 0
    for n, c in enumerate(todo, 1):
        h = get(f"https://kabutan.jp/stock/finance?code={c}", timeout=20)
        q = parse(h) if h else []
        if q:
            kq[c] = q
            it[c] = {"ld": max(r[4] for r in q), "lp": max(q, key=lambda r: r[4])[0], "at": t}
            ok += 1
        else:
            it.setdefault(c, {})["at"] = t
            bad += 1
        if n % 100 == 0:
            print(f"  {n}/{len(todo)}", flush=True)
            save(ann, kq, U)
        time.sleep(0.4)
    save(ann, kq, U)
    print(f"카부탄 결산 {len(todo)}곳 확인 · 받음 {ok} · 표 없음 {bad} · 최근 발표일 있는 종목 {sum(1 for x in it.values() if x.get('ld'))}/{len(U)}")
    return 0


def save(ann, kq, U):
    for c in [c for c in ann["items"] if c not in U]:   # 같은 dict 를 고침(main 의 it 가 계속 가리키게)
        del ann["items"][c]
    ann["updated"] = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    json.dump(ann, open(ANN, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump({c: v for c, v in kq.items() if c in U}, open(KQ, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main(sys.argv[1:]))
