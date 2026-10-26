# -*- coding: utf-8 -*-
"""2단계 리포트 '실적 분석'을 탭 둘로 — ① 실적 요약 ② 질의응답(결산설명회 질의응답 원문을 그대로 번역). 2026-10-26 사용자.
  질의응답은 설명회 며칠~2주 뒤 회사가 올린다 → 평일 15:30·16:30·17:30 예약 작업(IR 일정·질의응답)이 찾아 번역해 넣는다.

  python tools/qa.py todo                 리포트가 있고 발표 45일 안인데 이번 분기 질의응답이 아직 없는 곳 → JSON
  python tools/qa.py set <코드> <json>    번역본 넣기. json = {"title","date"(YYYY-MM-DD),"url","items":[{"q","a"}]}
  python tools/qa.py miss <코드>          찾아봤는데 아직 없음(횟수만 올림)
  python tools/qa.py tabs                 모든 2단계 리포트에 탭(없으면 '아직' 안내)만 다시 깐다
→ docs/data/jp/qa.json(상태) · docs/research/<코드>/stage2.html
"""
import glob
import html
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "docs", "research")
OUT = os.path.join(ROOT, "docs", "data", "jp", "qa.json")
IRC = os.path.join(ROOT, "docs", "data", "jp", "ircall.json")
KST = timezone(timedelta(hours=9))
DAYS = 45

CSS = ('<style>.es-tabs>input{position:absolute;opacity:0;pointer-events:none}'
       '.es-tabs>label{display:inline-block;margin:0 6px 14px 0;padding:8px 16px;border-radius:999px;border:1.5px solid #c9d2e0;'
       'color:#4a5568;font:600 14px/1 system-ui,"Malgun Gothic",sans-serif;cursor:pointer}'
       '.es-tabs>input:checked+label{background:#1d2330;border-color:#1d2330;color:#fff}'
       '.es-tabs>input:focus-visible+label{outline:2px solid #2f63d0;outline-offset:2px}'
       '.es-tp{display:none}#es-rt1:checked~.es-tp1,#es-rt2:checked~.es-tp2{display:block}'
       '.es-qa-h{margin:0 0 12px;color:#4a5568;font-size:13px}.es-qa-h a{color:#1f4e9c}'
       '.es-qa-i{margin:0 0 16px;padding:12px 14px;border-left:3px solid #c9d2e0;background:#f7f9fc;border-radius:0 8px 8px 0}'
       '.es-qa-i p{margin:0}.es-qa-i .q{font-weight:700;margin-bottom:6px}.es-qa-i .q b{color:#c62828;margin-right:6px}'
       '.es-qa-i .a b{color:#1f4e9c;margin-right:6px}.es-qa-none{color:#6b7280}</style>')


def now():
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M")


def load(p, empty):
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else empty


def none_html(c):
    t = ((load(IRC, {}).get("items") or {}).get(c) or {}).get("t") or ""
    when = f"설명회({t.split(' · ')[0]}) 뒤 " if re.match(r"\d{1,2}/\d{1,2}", t) else "결산설명회 뒤 "
    if t == "없음":
        return '<p class="es-qa-none">이 회사는 이번 결산설명회를 열지 않아 질의응답이 없습니다(결산단신 표기).</p>'
    return (f'<p class="es-qa-none">이번 분기 질의응답은 아직 나오지 않았습니다. 보통 {when}며칠~2주 안에 회사 IR 사이트에 올라오며, '
            '올라오면 원문 그대로 번역해 여기에 넣습니다. 질의응답을 내지 않는 회사도 많습니다.</p>')


def qa_html(d):
    e = html.escape
    head = f'<p class="es-qa-h">{e(d.get("title", "결산설명회 질의응답"))}'
    if d.get("date"):
        head += f' · {e(d["date"])} 공개'
    if d.get("url", "").startswith("http"):
        head += f' · <a href="{e(d["url"])}" target="_blank" rel="noopener noreferrer">원문</a>'
    head += " · 요약 없이 원문 그대로 번역</p>"
    items = "".join(f'<div class="es-qa-i"><p class="q"><b>Q{i}</b>{e(x.get("q", ""))}</p><p class="a"><b>A</b>{e(x.get("a", ""))}</p></div>'
                    for i, x in enumerate(d.get("items") or [], 1))
    return head + items


def tabs(src, inner):
    """'실적 분석' 안을 ① 실적 요약 ② 질의응답 탭으로. 이미 탭이면 ② 내용만 바꾼다."""
    box = f'<div class="es-qa">{inner}</div>'
    if 'class="es-tabs"' in src:
        return re.sub(r'<div class="es-qa">.*?</div><!--/es-qa-->', lambda _: box + "<!--/es-qa-->", src, count=1, flags=re.S)
    i = src.find('<details class="tg an res">')
    if i < 0:
        return src
    j = src.find('<button type="button" class="tgx">', i)
    k = src.find('<div class="tgb">', i)
    if j < 0 or k < 0 or k > j:
        return src
    k += len('<div class="tgb">')
    bar = re.compile(r'(?:<style>[^<]*</style>)*<div class="es-tanshin-bar"[^>]*>.*?</div>', re.S).match(src, k)
    if bar:
        k = bar.end()
    body = src[k:j]
    t = (CSS + '<div class="es-tabs"><input type="radio" name="es-rt" id="es-rt1" checked><label for="es-rt1">① 실적 요약</label>'
         '<input type="radio" name="es-rt" id="es-rt2"><label for="es-rt2">② 질의응답</label>'
         f'<div class="es-tp es-tp1">{body}</div><div class="es-tp es-tp2">{box}<!--/es-qa--></div></div>')
    return src[:k] + t + src[j:]


def page(c):
    return os.path.join(RES, c, "stage2.html")


def put_tabs(c):
    """리포트에 탭을 깐다(질의응답이 이미 들어 있으면 그대로)."""
    p = page(c)
    if not os.path.exists(p):
        return False
    s = open(p, encoding="utf-8").read()
    st = (load(OUT, {"items": {}})["items"].get(c) or {})
    if 'class="es-tabs"' in s and st.get("done"):
        return False
    s2 = tabs(s, qa_html(st["data"]) if st.get("done") else none_html(c))
    if s2 != s:
        open(p, "w", encoding="utf-8").write(s2)
    return s2 != s


def ann_of(c):
    m = re.search(r'class="resd">[^<]*?(\d{2})\.(\d{1,2})\.(\d{1,2})', open(page(c), encoding="utf-8").read())
    return f"20{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None


def todo():
    st = load(OUT, {"items": {}})
    irc = load(IRC, {}).get("items") or {}
    names = {c: co.get("n") for c, co in load(os.path.join(ROOT, "docs", "data", "jp", "pipeline.json"), {"companies": {}})["companies"].items()}
    cut = (datetime.now(KST) - timedelta(days=DAYS)).strftime("%Y-%m-%d")
    today = datetime.now(KST).strftime("%m/%d")
    out = []
    for p in glob.glob(os.path.join(RES, "*", "stage2.html")):
        c = os.path.basename(os.path.dirname(p))
        a = ann_of(c)
        it = st["items"].get(c) or {}
        call = (irc.get(c) or {}).get("t") or ""
        if not a or a < cut or it.get("done") or call == "없음" or 'class="es-qa-i"' in open(p, encoding="utf-8").read():
            continue
        m = re.match(r"(\d{1,2})/(\d{1,2})", call)
        if m and f"{int(m.group(1)):02d}/{int(m.group(2)):02d}" > today:   # 설명회 전이면 아직 볼 것 없음
            continue
        out.append({"c": c, "n": names.get(c), "ann": a, "call": call, "tries": it.get("tries", 0)})
    out.sort(key=lambda x: x["ann"], reverse=True)
    print(json.dumps(out, ensure_ascii=False, indent=1))


def save(st):
    st["updated"] = now()
    json.dump(st, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    a = sys.argv[1:]
    st = load(OUT, {"items": {}})
    if a[:1] == ["todo"]:
        todo()
    elif a[:1] == ["set"] and len(a) == 3:
        d = json.load(open(a[2], encoding="utf-8"))
        if not d.get("items"):
            sys.exit("items 가 비었습니다")
        st["items"][a[1]] = {"done": now(), "data": d}
        save(st)
        p = page(a[1])
        s = open(p, encoding="utf-8").read()
        open(p, "w", encoding="utf-8").write(tabs(s, qa_html(d)))
        print(f"{a[1]} 질의응답 {len(d['items'])}개 넣음")
    elif a[:1] == ["miss"] and len(a) == 2:
        it = st["items"].setdefault(a[1], {})
        it.update({"tries": it.get("tries", 0) + 1, "chk": now()})
        save(st)
        print(f"{a[1]} 아직 없음({it['tries']}번째)")
    elif a[:1] == ["tabs"]:
        n = sum(put_tabs(os.path.basename(os.path.dirname(p))) for p in glob.glob(os.path.join(RES, "*", "stage2.html")))
        print(f"탭 깐 리포트 {n}곳")
    else:
        sys.exit(__doc__)
