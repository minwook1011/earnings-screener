# -*- coding: utf-8 -*-
"""월차를 선행지표로(2026-11-17 사용자: 월차 나오는 기업은 반드시) — jp_monthly 표 → 원장 lead.items(kind monthly)

  입력 폴더: <코드>.json {c, name, headline, cols, ratio, rows:[[YYYY-MM, v…]], src, note}
  고르는 열: 기존점 매출 전년比 > 전점 매출 전년比 > 헤드라인 > 첫 전년比 열 > 첫 열
  전년比(지수 100=작년과 같음)는 YoY %(값−100)로, 금액·수준은 그대로.

  python tools/lead_monthly.py <폴더>
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAD = os.path.join(ROOT, "docs", "data", "jp", "lead")
KO = [("既存店", "기존점 "), ("全店", "전점 "), ("全社", "전사 "), ("売上高", "매출"), ("客数", "객수"), ("客単価", "객단가"), ("店舗数", "점포 수"),
      ("受注高", "수주액"), ("受注金額", "수주액"), ("受注", "수주"), ("販売台数", "판매 대수"), ("生産台数", "생산 대수"), ("会員数", "회원 수"),
      ("輸送人員", "수송 인원"), ("旅客運輸収入", "여객 수입"), ("運輸収入", "운수 수입"), ("取扱高", "취급액"), ("稼働率", "가동률"), ("合計", " 합계"),
      ("전년比", "YoY"), ("前年比", "YoY"), ("単体", "단독"), ("連結", "연결"), ("国内", "국내 "), ("海外", "해외 ")]


def ko(s):
    for a, b in KO:
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def pick(d):
    cols, ratio = d["cols"], d.get("ratio") or [False] * len(d["cols"])
    filled = [sum(1 for r in d["rows"] if len(r) > i + 1 and r[i + 1] is not None) for i in range(len(cols))]
    def find(*keys):   # 빈 달이 절반 넘는 열은 건너뜀
        for i, c in enumerate(cols):
            if all(k in c for k in keys) and ratio[i] and filled[i] * 2 >= len(d["rows"]):
                return i
        return None
    for k in (("既存店", "売上"), ("全店", "売上"), ("全社", "売上")):
        i = find(*k)
        if i is not None:
            return i
    if d.get("headline") in cols and filled[cols.index(d["headline"])] * 2 >= len(d["rows"]):
        return cols.index(d["headline"])
    for i, r in enumerate(ratio):
        if r and filled[i] * 2 >= len(d["rows"]):
            return i
    return max(range(len(cols)), key=lambda i: filled[i])


DRY = "--dry" in sys.argv
sys.argv = [a for a in sys.argv if a != "--dry"]
plan = []
n = 0
for f in sorted(g for g in glob.glob(os.path.join(sys.argv[1], "*.json")) if not os.path.basename(g).startswith("_")):
    d = json.load(open(f, encoding="utf-8"))
    c = d.get("c") or os.path.basename(f)[:-5]
    p = os.path.join(LEAD, c + ".json")
    if not os.path.exists(p) or not d.get("rows"):
        continue
    i = pick(d)
    isr = (d.get("ratio") or [False] * len(d["cols"]))[i]
    pts = [[r[0], round(r[i + 1] - 100, 1) if isr else r[i + 1], "mo"] for r in d["rows"] if len(r) > i + 1 and r[i + 1] is not None]
    if len(pts) < 6:
        continue
    name = "월차: " + ko(d["cols"][i]).replace(" YoY", "") + (" YoY" if isr else "")
    plan.append([c, name, len(pts), pts[-1][0], d.get("note") or ""])
    if DRY:
        continue
    co = json.load(open(p, encoding="utf-8"))
    co["lead"]["items"] = [x for x in co["lead"]["items"] if x.get("kind") != "monthly"]
    co["lead"]["items"].insert(0, {"id": "mo", "kind": "monthly", "rank": 0.2, "t": name, "short": name, "nm": name[:18], "unit": "%" if isr else "",
                                   "entity": d.get("name", ""), "corp": c, "note": "회사가 매달 내는 월차 — 결산보다 1~2개월 먼저 분기 매출을 확인",
                                   "why": "회사 월차(" + ko(d["cols"][i]) + ") — 매달 다음 달 초에 나와 분기 결산보다 먼저 이번 분기 매출 흐름을 보여 준다",
                                   "pts": pts, "src": [{"doc": "회사 月次 공시(TDnet·회사 IR) — jp_monthly 원장", "where": d["cols"][i], "freq": "월(다음 달 초~중순)", "auto": "반자동", "how": "월 1회 jp_monthly 다시 받기", "url": d.get("src", "")}]})
    co["log"] = [{"d": "2026-11-17", "by": "Claude", "t": "월차 지표 추가 — " + name}] + [l for l in co.get("log", []) if "월차 지표 추가" not in l.get("t", "")]
    json.dump(co, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    n += 1
if DRY:
    json.dump(plan, open(os.path.join(sys.argv[1], "_plan.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("월차", "계획" if DRY else "넣음", len(plan) if DRY else n, "곳")
