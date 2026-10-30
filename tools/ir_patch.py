# -*- coding: utf-8 -*-
"""설명회 자료 보강을 올린 2단계 리포트에 넣는다(2026-10-30 사용자 — 올린 리포트는 이 칸들만 더하거나 바꿈, 본문은 그대로).
  ① 실적 요약 탭 맨 위 「설명회 자료 보강 (M/D 추가)」 칸 · BM 원그래프 바로 아래 「BM별 매출」·「지역별 매출」 표.
  다시 넣으면 같은 칸을 바꾼다(표시 주석 <!--es-boost--> · <!--es-bm-->).

  python tools/ir_patch.py <코드> <json>    json = {"date","url","boost","bm":{"title","cols","rows"}|null,"region":…}
"""
import html
import json
import os
import re
import subprocess
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
E = html.escape

CSS = ('<style>.es-boost{margin:0 0 18px;padding:14px 16px;border-left:3px solid #1f4e9c;background:#f4f7fc;border-radius:0 8px 8px 0}'
       '.es-boost h5{margin:0 0 8px}.es-boost p{margin:0 0 10px}.es-boost .src{margin:6px 0 0;font-size:12.5px;color:#6b7280}'
       '.es-boost .src a{color:#1f4e9c}</style>')


def boost_html(d):
    day = d.get("date") or ""
    md = f"{int(day[5:7])}/{int(day[8:10])}" if re.match(r"\d{4}-\d{2}-\d{2}", day) else ""
    paras = "".join(f"<p>{E(p.strip())}</p>" for p in re.split(r"\n\s*\n", d.get("boost") or "") if p.strip())
    link = f' · <a href="{E(d["url"])}" target="_blank" rel="noopener noreferrer">원문</a>' if str(d.get("url", "")).startswith("http") else ""
    return (f'<!--es-boost-->{CSS}<div class="es-boost"><h5>설명회 자료 보강{f" ({md} 추가)" if md else ""}</h5>{paras}'
            f'<p class="src">출처: 회사 결산설명회 자료{link} <span class="tag">[설명회]</span></p></div><!--/es-boost-->')


def num(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return f"{v:,.1f}"   # 억 엔 소수 한 자리(리포트 표와 같게)
    return E(str(v if v is not None else "–"))


def table_html(t):
    if not t or not t.get("rows"):
        return ""
    cols = t.get("cols") or []
    head = "<tr><th></th>" + "".join(f'<th class="n">{E(str(c))}</th>' for c in cols) + "</tr>"
    body = "".join("<tr><td>" + E(str(r[0])) + "</td>" + "".join(f'<td class="n">{num(v)}</td>' for v in r[1:]) + "</tr>"
                   for r in t["rows"] if r)
    return (f'<figure class="fig"><h4>{E(t.get("title", ""))}</h4><p class="sub">억 엔 · 회사 결산설명회 자료</p>'
            f'<div class="tw"><table class="fin"><thead>{head}</thead><tbody>{body}</tbody></table></div>'
            '<p class="src">출처: 회사 결산설명회 자료 <span class="tag">[설명회]</span></p></figure>')


def put(src, mark, block, where):
    """표시 주석 칸이 있으면 바꾸고, 없으면 where(정규식) 바로 뒤에 넣는다."""
    pat = re.compile(rf"<!--{mark}-->.*?<!--/{mark}-->", re.S)
    if pat.search(src):
        return pat.sub(lambda _: block, src, count=1), True
    m = re.search(where, src, re.S)
    if not m:
        return src, False
    return src[:m.end()] + block + src[m.end():], True


def patch(c, d):
    p = os.path.join(ROOT, "docs", "research", c, "stage2.html")
    src = open(p, encoding="utf-8").read()
    src, ok1 = put(src, "es-boost", boost_html(d),
                   r'<div class="es-tp es-tp1">' if 'class="es-tp es-tp1"' in src else
                   r'<details class="tg an res">.*?<div class="tgb">(?:(?:<style>[^<]*</style>)*<div class="es-tanshin-bar"[^>]*>.*?</div>)?')
    tb = table_html(d.get("bm")) + table_html(d.get("region"))
    ok2 = None
    if tb:
        src, ok2 = put(src, "es-bm", f"<!--es-bm-->{tb}<!--/es-bm-->", r'<figure class="fig pie">.*?</figure>')
    open(p, "w", encoding="utf-8").write(src)
    import gitlock
    import research_queue as rq
    with gitlock.held():
        idx = rq.load_idx()
        it = (idx["items"].get(c) or {}).get("2")
        if it:
            it["ir_updated"] = rq.now()
            rq.save_idx(idx)
    if d.get("url"):
        subprocess.run([sys.executable, os.path.join(TOOLS, "ir_watch.py"), "boosted", c, d["url"]], capture_output=True)
    print(f"{c} 설명회 자료 보강 {'넣음' if ok1 else '자리 못 찾음'}" + ("" if ok2 is None else f" · BM 표 {'넣음' if ok2 else '자리 못 찾음'}"))


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    patch(sys.argv[1], json.load(open(sys.argv[2], encoding="utf-8")))
