# -*- coding: utf-8 -*-
"""텔레그램 실적 스크리너 그룹 → 단계 현황(docs/data/jp/pipeline.json).

  입력  tools/tg_raw/*.json — 텔레그램 읽기 도구(read_messages) 결과를 토픽별로 그대로 저장한 것
        (예약 작업이 토픽 2·4·6·72 를 읽어 저장한다. 원문이라 깃에 올리지 않는다)
  규칙  토픽 = 단계. 카드가 놓인 가장 높은 토픽이 그 회사의 단계다.
          2 = 1단계 · 퀵   (회사당 카드 한 통, [볼 후보] → 2단계)
          4 = 2단계 · 분석 (점수 1~5 + 코멘트, AI 렌즈, [3단계로])
          6 = 3단계 · 딥   (매수 여부·비중·근거·다시 볼 조건)
         72 = 4단계 · 결정 (다 같이 보고 살지 말지 결정 — 사기 직전 종목)
        '볼 후보 취소' 글이 그 단계의 마지막 카드보다 늦으면 그 단계에서 뺀다.
        한번 올라간 회사는 텔레에서 카드가 지워져도 남긴다(직전 pipeline.json 을 이어받고 gone 표시, 2026-10-22 사용자).
        누가 올렸나: "회사 코드\n볼 후보 · 이름 · 시각" 같은 기록 글(취소 글과 같은 꼴, 또는 카드 안 한 줄)이 있으면
        그 단계 카드의 올린 사람(by)으로 싣는다(2026-10-22 사용자 요청). 지금 봇은 취소 때만 이름을 남긴다.

  실행  python tools/tg_parse.py
"""
import glob
import json
import os
import re
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "tools", "tg_raw")
OUT = os.path.join(ROOT, "docs", "data", "jp", "pipeline.json")
KST = timezone(timedelta(hours=9))
TOPIC_STAGE = {2: 1, 4: 2, 6: 3, 72: 4}
# 이 시각 전에 3·4단계로 간 카드는 2단계로 내린다(2026-10-25 사용자 — 사이트는 2단계 리포트 중심, 3·4단계는 그 뒤로 텔레 기록만)
RESET = "2026-10-25 14:00"


def old_high(st, date):
    return int(st) >= 3 and (date or "")[:16] < RESET

HEAD = re.compile(r"^(?P<n>.+?)\((?P<c>[0-9A-Z]{4})\)\s*·\s*(?P<d>\d{1,2}/\d{1,2})(?:\s+(?P<t>\d{1,2}:\d{2}))?")
CANCEL = re.compile(r"^(?P<n>.+?)\s+(?P<c>[0-9A-Z]{4})\s*\n\s*볼 후보 취소")
PICK = re.compile(r"^(?P<n>.+?)\s+(?P<c>[0-9A-Z]{4})\s*\n\s*(?P<ev>볼 후보|3단계로|4단계로)\s*·\s*(?P<who>[^·\n]+)")
# 카드 안 한 줄 — "→ 3단계 · 손제현 · 10/22 · 메모"(2026-10-22 봇이 넣기 시작) 또는 "볼 후보 · 이름"
PICK_LINE = re.compile(r"^(?:→\s*[1-4]단계|볼 후보|3단계로|4단계로|올린 사람)\s*·\s*(?P<who>[^·\n]+?)\s*(?:·\s*(?P<d>\d{1,2}/\d{1,2})\s*)?(?:·\s*(?P<memo>[^\n]+))?$", re.M)
EV_STAGE = {"볼 후보": 2, "3단계로": 3, "4단계로": 4}
LENS_HEAD = re.compile(r"AI 렌즈[^·]*·\s*(?P<rest>.*)")
LENS_ROW = re.compile(r"^(?P<who>버핏|멍거|카밀로|린치|오닐)\s*·\s*(?P<v>3단계로|삭제)\s*\+(?P<p>\d+)[−-](?P<m>\d+)\s*·\s*(?P<why>.+)$")
NUM = re.compile(r"(?P<k>매출|영업이익)\s+(?P<v>[\d,\.]+(?:억|조)?)\s+(?P<g>[+\-−][\d,\.]+)%")


def to_f(s):
    try:
        return float(s.replace(",", "").replace("−", "-"))
    except (TypeError, ValueError):
        return None


def parse_card(text):
    lines = [x.rstrip() for x in text.split("\n")]
    m = HEAD.match(lines[0]) if lines else None
    if not m:
        return None
    card = {"c": m["c"], "n": m["n"].strip(), "ann": m["d"] + (" " + m["t"] if m["t"] else ""), "sections": []}
    if len(lines) > 1:
        card["val"] = lines[1]
        mc = re.search(r"시총\s+([\d,\.]+)(억|조)", lines[1])
        if mc:
            card["mc"] = to_f(mc.group(1)) * (10000 if mc.group(2) == "조" else 1)
        pe = re.search(r"PER\s+([\d,\.]+)배", lines[1])
        if pe:
            card["per"] = to_f(pe.group(1))
    sec = None
    for ln in lines[2:]:
        if not ln.strip():
            continue
        lh = LENS_HEAD.search(ln)
        if lh:
            card["lens"] = {"sum": lh["rest"].strip(), "rows": []}
            up = re.search(r"3단계로\s+(\d+)", lh["rest"])
            dn = re.search(r"삭제\s+(\d+)", lh["rest"])
            card["lens"]["up"] = int(up.group(1)) if up else 0
            card["lens"]["down"] = int(dn.group(1)) if dn else 0
            sec = None
            continue
        lr = LENS_ROW.match(ln)
        if lr and "lens" in card:
            card["lens"]["rows"].append({"who": lr["who"], "v": "up" if lr["v"] == "3단계로" else "down",
                                         "p": int(lr["p"]), "m": int(lr["m"]), "why": lr["why"]})
            continue
        if ln.startswith("▶️"):
            sec = {"t": ln.replace("▶️", "").strip(), "lines": []}
            card["sections"].append(sec)
            continue
        if sec is not None:
            sec["lines"].append(ln)
    for s in card["sections"]:
        if s["t"].startswith("실적 유형") and s["lines"]:
            card["tags"] = [x.strip() for x in s["lines"][0].split("·")]
            for nm in NUM.finditer(" ".join(s["lines"])):
                card["rev" if nm["k"] == "매출" else "op"] = to_f(nm["g"])
        if s["t"].startswith("주가"):
            j = " ".join(s["lines"])
            d1 = re.search(r"종가\s+([+\-−][\d\.]+)%", j)
            if d1:
                card["d1"] = to_f(d1.group(1))
            vr = re.search(r"거래량 평소의\s+([\d\.]+)배", j)
            if vr:
                card["vr"] = to_f(vr.group(1))
    return card


def load_prev(path=OUT):
    try:
        return json.load(open(path, encoding="utf-8")).get("companies", {})
    except (OSError, ValueError):
        return {}


def keep(cos, prev):
    """한번 올라간 건 그대로 둔다(2026-10-22 사용자). 텔레에서 카드가 지워져도 전에 본 카드를 남기고 gone 표시.
    '볼 후보 취소'로 내려간 단계는 새 카드에 cancelled 가 붙어 있으니 그대로 따른다."""
    for c, old in prev.items():
        co = cos.get(c)
        if co is None:
            co = cos[c] = {"c": c, "n": old.get("n"), "cards": {}, "hist": list(old.get("hist", []))}
        for st, cd in old.get("cards", {}).items():
            if st in co["cards"] or cd.get("cancelled"):
                continue
            if old_high(st, cd.get("date")):
                st = "2"
                if st in co["cards"]:
                    continue
            cd = dict(cd)
            cd.setdefault("gone", datetime.now(KST).strftime("%Y-%m-%d %H:%M"))
            co["cards"][st] = cd


PREV = {}


def main():
    global PREV
    PREV = load_prev()
    msgs = {}
    for f in sorted(glob.glob(os.path.join(RAW, "*.json"))):
        for m in json.load(open(f, encoding="utf-8")).get("messages", []):
            if m.get("topic_id") in TOPIC_STAGE and m.get("text"):
                msgs[m["id"]] = m
    cos = {}
    cancels = []
    picks = []
    for m in sorted(msgs.values(), key=lambda x: x["id"]):
        st = TOPIC_STAGE[m["topic_id"]]
        pm = PICK.match(m["text"])
        if pm:
            picks.append((EV_STAGE[pm["ev"]], pm["c"], pm["who"].strip(), m["date"]))
            continue
        cm = CANCEL.match(m["text"])
        if cm:
            cancels.append((st, cm["c"], m["id"], m["date"]))
            continue
        card = parse_card(m["text"])
        if not card:
            continue
        co = cos.setdefault(card["c"], {"c": card["c"], "n": card["n"], "cards": {}, "hist": []})
        co["n"] = card["n"]
        if old_high(st, m["date"]):
            if "2" in co["cards"]:
                continue
            st = 2
        card.update({"msg": m["id"], "date": m["date"], "photo": bool(m.get("media"))})
        pl = PICK_LINE.search(m["text"])
        if pl:
            card["by"] = pl["who"].strip()
            if pl["memo"]:
                card["memo"] = pl["memo"].strip()
        co["cards"][str(st)] = card
        co["hist"].append({"stage": st, "date": m["date"], "ev": "카드"})
    keep(cos, PREV)   # 지워진 카드를 먼저 되살린 뒤 취소를 적용 — 취소는 남긴 카드에도 먹힌다
    for st, c, mid, d in cancels:
        co = cos.get(c)
        if co and str(st) in co["cards"] and co["cards"][str(st)]["msg"] < mid:
            co["cards"][str(st)]["cancelled"] = d
            co["hist"].append({"stage": st, "date": d, "ev": "볼 후보 취소"})
    for st, c, who, d in picks:
        co = cos.get(c)
        if co and str(st) in co["cards"]:
            co["cards"][str(st)]["by"] = who
            co["hist"].append({"stage": st, "date": d, "ev": "올림", "who": who})
    for co in cos.values():
        live = [int(s) for s, cd in co["cards"].items() if not cd.get("cancelled")]
        co["stage"] = max(live) if live else 1
        co["since"] = co["cards"][str(co["stage"])]["date"] if str(co["stage"]) in co["cards"] else None
        top = co["cards"].get(str(co["stage"]), {})
        if top.get("gone"):
            co["gone"] = top["gone"]
        else:
            co.pop("gone", None)
        co["hist"].sort(key=lambda h: h["date"])
    counts = {str(s): sum(1 for c in cos.values() if c["stage"] == s) for s in (1, 2, 3, 4)}
    out = {"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
           "source": "텔레그램 그룹",
           "topics": {"1": "1단계 · 퀵", "2": "2단계 · 분석", "3": "3단계 · 딥", "4": "4단계 · 결정"},
           "counts": counts, "companies": cos}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("텔레 단계 현황", counts, "→", OUT)


if __name__ == "__main__":
    main()
