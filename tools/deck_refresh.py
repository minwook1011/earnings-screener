# -*- coding: utf-8 -*-
"""사이트 설명회 자료 사본을 최신으로(2026-11-15 사용자) — deck_src.json 이 tdnet 인 회사 중
  사본이 없거나 더 새 자료가 나온 곳을 받아 리포트 버튼까지 바꾼다(research_queue.py deck).
  python tools/deck_refresh.py [--dry]
"""
import json, os, subprocess, sys
TOOLS = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
import deck_map, pdf_index  # noqa: E402
RES = os.path.join(ROOT, "docs", "research")
dry = "--dry" in sys.argv
m = json.load(open(os.path.join(TOOLS, "deck_src.json"), encoding="utf-8"))["items"]
done, fail = [], []
for c in sorted(os.listdir(RES)):
    e = m.get(c, {})
    if e.get("via") != "tdnet" or not os.path.isfile(os.path.join(RES, c, "stage2.html")):
        continue
    p = os.path.join(RES, c, "setsumei.pdf")
    have = pdf_index.doc_day(p)[0] if os.path.isfile(p) else ""
    cur = pdf_index.doc_day(p)[1] if os.path.isfile(p) else ""
    fl = deck_map.tdnet_decks(c) or []
    if not fl:
        continue
    f = fl[0]
    if have and have > f["date"]:   # 사본이 더 새 것(회사 IR 에서 받은 것 등) — 덮지 않는다
        continue
    if f["doc"] in cur:   # 이미 최신 자료(문서 번호 속 날짜는 공개일이 아님 — 공개일은 .day 에)
        if not os.path.isfile(p + ".day") and not dry:
            open(p + ".day", "w", encoding="utf-8").write(f["date"])
        continue
    u = f"https://www.release.tdnet.info/inbs/{f['doc']}.pdf"
    if dry:
        done.append(f"{c} {have or '없음'}→{f['date']}"); continue
    r = subprocess.run([sys.executable, os.path.join(TOOLS, "research_queue.py"), "deck", c, u], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if "버튼 바꿈" in r.stdout:
        open(p + ".doc", "w", encoding="utf-8").write(f["doc"]); open(p + ".day", "w", encoding="utf-8").write(f["date"])
        m[c]["last"] = f["doc"]; done.append(f"{c} {have or '없음'}→{f['date']}")
    else:   # 한 달 지난 공시는 거래소 보관 주소로, 리포트에 버튼 칸이 없으면 파일만(카드 칩은 pdf.json 으로 뜸)
        import build_xlsx
        b = None
        for u2 in (u, build_xlsx.PDF.format(code=c, doc=f["doc"])):
            b = build_xlsx.get(u2)
            if b and b[:4] == b"%PDF":
                break
        if b and b[:4] == b"%PDF":
            if "결산단신 칸이 없어" not in r.stdout and u2 != u:
                subprocess.run([sys.executable, os.path.join(TOOLS, "research_queue.py"), "deck", c, u2], capture_output=True)
            open(p, "wb").write(b); open(p + ".doc", "w", encoding="utf-8").write(f["doc"]); open(p + ".day", "w", encoding="utf-8").write(f["date"])
            m[c]["last"] = f["doc"]; done.append(f"{c} {have or '없음'}→{f['date']} (파일만)")
        else:
            fail.append(f"{c}: {(r.stdout + r.stderr).strip()[-80:]}")
if not dry:
    json.dump({"updated": json.load(open(os.path.join(TOOLS, "deck_src.json"), encoding="utf-8"))["updated"], "items": m},
              open(os.path.join(TOOLS, "deck_src.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    pdf_index.build()
print(f"바꿈 {len(done)} · 실패 {len(fail)}"); print("\n".join(done[:15])); print("\n".join(fail[:30]))
