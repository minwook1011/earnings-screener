# -*- coding: utf-8 -*-
"""선행지표 첫 화면 데이터(2026-11-25 사용자) — docs/data/jp/lead/calendar.json · cards.json

  calendar.json  큰 달력: 날짜마다 어떤 지표가 나오는지, 누르면 그 지표를 쓰는 기업들
                 - 공용 통계(macro): 파일의 next 에 날짜가 있으면 그 날(확정), 아니면 공표 규칙으로 추정
                 - 원장 지표: 공표 문구(src how 「공표:」·freq)로 lead_bt_q.avail_rule → 날짜 추정
                 - 회사 월차·구글트렌드·연금 가입자는 같은 날 것을 하나로 묶음
                 창: 오늘 기준 45일 전 ~ 90일 뒤 (그 달 자료가 나오는 날)
  cards.json     오른쪽 기업 카드: 시가총액·PER·주가·1개월·3개월·1년 수익률, 키 데이터(가장 앞 지표)와 등급, 다음 실적·지표 발표
  python tools/lead_home.py
"""
import json
import os
import re
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lead_bt as B  # noqa: E402
import lead_bt_q as Q  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT, LEAD, MAC = B.ROOT, B.LEAD, B.MAC
PX = os.path.join(ROOT, "docs", "data", "jp", "px")
TODAY = date.today()
LO, HI = TODAY - timedelta(days=45), TODAY + timedelta(days=90)
DRE = re.compile(r"(20\d\d)[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})")


def first_date(s):
    m = DRE.search(s or "")
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def releases(kind, name, rel, exact=None):
    """[(공표일, 자료 달 'YYYY-MM', 추정 여부)]"""
    av, _ = Q.avail_rule(kind, name, rel)
    out = []
    cur = B.mi(TODAY.isoformat()[:7])
    for m in range(cur - 4, cur + 3):
        try:
            d = date.fromisoformat(av(m))
        except ValueError:
            continue
        if LO <= d <= HI:
            out.append([d, B.ms(m), True])
    if exact and LO <= exact <= HI:   # 공표일이 정해진 달은 그 날로(가장 가까운 추정을 바꿔 끼움)
        if out:
            k = min(range(len(out)), key=lambda i: abs((out[i][0] - exact).days))
            if abs((out[k][0] - exact).days) <= 20:
                out[k][0], out[k][2] = exact, False
            else:
                out.append([exact, "", False])
        else:
            out.append([exact, "", False])
    return out


def cat_of(kind, name, src):
    t = (name or "") + " " + (src or "")
    if kind == "trends" or t.startswith("구글트렌드"):
        return "트렌드"
    if kind == "monthly":
        return "월차"
    if kind == "pension":
        return "연금"
    if any(w in t for w in ("수출", "수입", "무역", "HS", "貿易", "概況品")):
        return "무역"
    if "월매출" in t or "월차" in t:
        return "다른 회사 월차"
    return "통계"


def main():
    ix = json.load(open(os.path.join(LEAD, "index.json"), encoding="utf-8"))
    alias = json.load(open(os.path.join(MAC, "index.json"), encoding="utf-8"))["alias"]
    try:
        scr = json.load(open(os.path.join(ROOT, "docs", "data", "jp", "scr.json"), encoding="utf-8")).get("items") or {}
    except (OSError, ValueError):
        scr = {}
    macf = {}
    ev = {}      # (날짜, 키) → 이벤트
    cards = []
    sec = {}
    for g in ix["tree"]:
        for k in g["kids"]:
            sec[g["id"] + "/" + k["id"]] = (g["n"], k["n"])

    def add(d, key, name, cat, est, dm, c, bt, src):
        e = ev.setdefault((d.isoformat(), key), {"d": d.isoformat(), "k": key, "n": name, "cat": cat, "est": est, "m": dm, "src": src, "cos": [], "bt": []})
        if c not in e["cos"]:
            e["cos"].append(c)
        if bt and c not in e["bt"]:
            e["bt"].append(c)
        e["est"] = e["est"] and est

    for c in ix["cos"]:
        try:
            co = json.load(open(os.path.join(LEAD, c + ".json"), encoding="utf-8"))
        except (OSError, ValueError):
            continue
        L = co.get("lead") or {}
        key_it, key_rank = None, 99
        for it in L.get("items") or []:
            kind = it.get("kind") or ""
            name = it.get("t") or it.get("short") or ""
            pts = it.get("pts") or []
            if len(pts) >= 6 and (it.get("rank") if it.get("rank") is not None else 9) < key_rank:
                key_it, key_rank = it, (it.get("rank") if it.get("rank") is not None else 9)
            how = " ".join(str(s.get("how") or "") + " " + str(s.get("freq") or "") for s in it.get("src") or [])
            rel = how.split("공표:")[-1] if "공표:" in how else how
            src = ((it.get("src") or [{}])[0].get("doc") or "")[:80]
            cat = cat_of(kind, name, src)
            if cat == "월차":
                key, nm = "monthly", "회사 월차"
            elif cat == "트렌드":
                key, nm = "trends", "구글트렌드 월 집계"
            elif cat == "연금":
                key, nm = "pension", "후생연금 가입자 수"
            else:
                key, nm = "i:" + re.sub(r"\s+", "", name), name
            for d, dm, est in releases(kind, name, rel):
                add(d, key, nm, cat, est, dm, c, bool(it.get("bt")), src if key.startswith("i:") else "")
        for m in L.get("macro") or []:
            a = alias.get(m.get("id"))
            if not a:
                continue
            if a["file"] not in macf:
                try:
                    macf[a["file"]] = json.load(open(os.path.join(MAC, a["file"]), encoding="utf-8"))
                except (OSError, ValueError):
                    macf[a["file"]] = {}
            md = macf[a["file"]]
            nm = m.get("name") or md.get("name") or m["id"]
            for d, dm, est in releases("macro", nm, md.get("release") or "", first_date(md.get("next"))):
                add(d, "m:" + a["file"][:-5], md.get("name_ko") or nm if False else nm, cat_of("macro", nm, md.get("src")), est, dm, c, bool(m.get("bt")), (md.get("src") or "")[:80])
        # 카드
        rows = []
        try:
            rows = [r for r in json.load(open(os.path.join(PX, c + ".json"), encoding="utf-8")) if r and r[4] is not None]
        except (OSError, ValueError):
            pass

        def ret(days):
            if not rows:
                return None
            last = date.fromisoformat(rows[-1][0])
            tgt = (last - timedelta(days=days)).isoformat()
            base = next((r for r in rows if r[0] >= tgt), None)
            return None if not base or not base[4] else round((rows[-1][4] / base[4] - 1) * 100, 1)
        sc = scr.get(c) or {}
        last = rows[-1][4] if rows else None
        k = last / sc["px"] if sc.get("px") and last else 1
        mk = co.get("mkt") or {}
        mc = round(sc["mc"] * k, 1) if sc.get("mc") else (round(last * mk["shares"] / 1e8, 1) if last and mk.get("shares") else None)
        per = round(sc["per"] * k, 1) if sc.get("per") else (round(last / mk["fc_eps"], 1) if last and (mk.get("fc_eps") or 0) > 0 else None)
        o = ix["cos"][c]
        g = sec.get(o.get("sec"), ("", ""))
        cards.append({"c": c, "n": o["n"], "jp": o.get("jp"), "g": g[0], "s": g[1], "sec": o.get("sec"), "mc": mc, "per": per, "px": last,
                      "r1m": ret(30), "r3m": ret(91), "r1y": ret(365), "key": (key_it or {}).get("short") or (key_it or {}).get("t"),
                      "kid": (key_it or {}).get("id"), "bt": ((key_it or {}).get("bt") or {}).get("g"), "bter": ((key_it or {}).get("bt") or {}).get("er"),
                      "weak": bool(L.get("weak")), "nd": o.get("nd"), "nq": o.get("nq"), "ln": (L.get("next") or {}).get("date")})
    evs = sorted(ev.values(), key=lambda e: (e["d"], -len(e["cos"])))
    json.dump({"updated": TODAY.isoformat(), "from": LO.isoformat(), "to": HI.isoformat(), "ev": evs},
              open(os.path.join(LEAD, "calendar.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump({"updated": TODAY.isoformat(), "cards": cards}, open(os.path.join(LEAD, "cards.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("calendar", len(evs), "events · days", len({e["d"] for e in evs}), "· est", sum(1 for e in evs if e["est"]), "| cards", len(cards))


if __name__ == "__main__":
    main()
