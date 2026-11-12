# -*- coding: utf-8 -*-
"""2단계 deep.json 의 분기 키 'YYYY-NQ'(예 2026-3Q)를 빌더가 읽는 'YYYY-QN'(2026-Q3)으로 고치고 HTML 을 다시 빌드한다.
   키가 'NQ' 형식이면 빌더가 1년 전 분기를 못 찾아 재무표 YoY 줄이 통째로 빠진다(2026-11-12 사용자: 우리 형식대로).
   사용:  python tools/fix_qkeys.py "<..._deep.html 또는 _deep.json 경로>"
   고칠 키가 없으면 아무것도 하지 않는다. 고치기 전 파일은 _deep.before_keyfix.json/.html 로 남긴다.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys

pat = re.compile(r'^(\d{4})-(\d)Q$')


def find_builder():
    home = os.path.expanduser("~")
    hits = glob.glob(os.path.join(home, "AppData", "Local", "Claude-Data", "*", "local-agent-mode-sessions",
                                  "skills-plugin", "*", "*", "skills", "jp-earnings-screening", "stage2-deep",
                                  "scripts", "build_deep.py"))
    return max(hits, key=os.path.getmtime) if hits else None


def fix(o, n):
    if isinstance(o, dict):
        out = {}
        for k, v in o.items():
            nk = pat.sub(r'\1-Q\2', k) if isinstance(k, str) else k
            if nk != k:
                n[0] += 1
            if k == 'p' and isinstance(v, str) and pat.match(v):
                v = pat.sub(r'\1-Q\2', v)
                n[0] += 1
            out[nk] = fix(v, n)
        return out
    if isinstance(o, list):
        return [fix(x, n) for x in o]
    return o


def main(path):
    dj = re.sub(r'\.html$', '.json', path)
    if not os.path.exists(dj):
        print(f"건너뜀: {dj} 없음")
        return 0
    d = json.load(open(dj, encoding='utf-8'))
    n = [0]
    d2 = fix(d, n)
    if not n[0]:
        print("분기 키 형식 정상 — 그대로")
        return 0
    html = re.sub(r'\.json$', '.html', dj)
    for src in (dj, html):
        b = src.replace('_deep.', '_deep.before_keyfix.')
        if os.path.exists(src) and not os.path.exists(b):
            shutil.copy(src, b)
    json.dump(d2, open(dj, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    b = find_builder()
    if not b:
        print("멈춤: build_deep.py 를 못 찾음 — JSON 만 고쳤다")
        return 1
    r = subprocess.run([sys.executable, b, dj, html])
    print(f"분기 키 {n[0]}개 고치고 다시 빌드 → {html}")
    return r.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
