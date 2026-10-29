# -*- coding: utf-8 -*-
"""2단계 보고서 제목 옆에 트레이딩뷰·카부탄 링크 붙이기(2026-10-29 사용자).
  노트북에 깔린 옛 스킬(10/28 판)은 이 링크를 안 넣어서, 빠진 보고서에 집 컴퓨터 보고서와 같은 모양으로 붙인다.
  이미 있으면 건너뛴다.

  python tools/add_links.py            docs/research/*/stage2.html 전부
  python tools/add_links.py <코드…>     그 회사만
"""
import glob
import os
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = (".mast h1 .xl{font:500 11px var(--sans);margin-left:8px;vertical-align:middle}\n"
       ".mast h1 .xl a{color:var(--muted);text-decoration:none;border:1px solid var(--rule,#ccc);border-radius:4px;padding:1px 5px;margin-right:4px}\n"
       ".mast h1 .xl a:hover{color:var(--ink)}\n")


def links(c):
    return ('<span class="xl"><a href="https://www.tradingview.com/chart/?symbol=TSE%3A' + c +
            '" target="_blank" rel="noopener noreferrer">트레이딩뷰</a><a href="https://kabutan.jp/stock/?code=' + c +
            '" target="_blank" rel="noopener noreferrer">카부탄</a></span>')


def fix(path):
    c = os.path.basename(os.path.dirname(path))
    t = open(path, encoding="utf-8").read()
    if "tradingview.com" in t:
        return "있음"
    tk = '<span class="tk">(' + c + ")</span>"
    m = re.search(r"<h1>.*?</h1>", t, re.S)
    if not m or tk not in m.group(0):
        return "제목 못 찾음"
    h1 = m.group(0).replace(tk, tk + links(c), 1)
    t = t[:m.start()] + h1 + t[m.end():]
    if ".mast h1 .xl" not in t:
        i = t.find("</style>")
        if i < 0:
            return "스타일 못 찾음"
        t = t[:i] + CSS + t[i:]
    open(path, "w", encoding="utf-8", newline="").write(t)
    return "붙임"


def main():
    codes = sys.argv[1:]
    paths = ([os.path.join(ROOT, "docs", "research", c, "stage2.html") for c in codes] if codes
             else sorted(glob.glob(os.path.join(ROOT, "docs", "research", "*", "stage2.html"))))
    n = 0
    for p in paths:
        if not os.path.exists(p):
            print(os.path.basename(os.path.dirname(p)), "보고서 없음")
            continue
        r = fix(p)
        if r != "있음":
            print(os.path.basename(os.path.dirname(p)), r)
        n += r == "붙임"
    print("붙인 곳", n)


if __name__ == "__main__":
    main()
