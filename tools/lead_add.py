# -*- coding: utf-8 -*-
"""새 기업 묶음 넣기(2026-11-17) — 조사 결과 out_*.json(기본 정보 + 데이터 붙은 선행지표)을 한 번에 원장으로.

  1) lead_build.py  : 원장 뼈대(실적 rows·다음 발표·섹터 트리) — lead 는 비워서
  2) lead_apply.py  : macro_ref / series 선행지표 + 결과 리포트
  3) lead_ko.py     : 핵심지표 한 줄·일본어 이름 번역
  4) lead_update.py : 새 기업 주가·index(ln/nd/nq)

  python tools/lead_add.py --edinet ind.json --report 결과.md out_1.json …
"""
import json
import os
import subprocess
import sys
import tempfile

T = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
ed = args[args.index("--edinet") + 1]
rep = args[args.index("--report") + 1] if "--report" in args else None
outs = [a for a in args if a.endswith(".json") and a != ed]
skel, codes = {}, []
for f in outs:
    for c, x in json.load(open(f, encoding="utf-8")).items():
        y = dict(x)
        y["lead"] = []
        skel[c] = y
        codes.append(c)
tmp = os.path.join(tempfile.gettempdir(), "lead_skel.json")
json.dump(skel, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
py = sys.executable
subprocess.run([py, os.path.join(T, "lead_build.py"), "--edinet", ed, tmp], check=True)
subprocess.run([py, os.path.join(T, "lead_apply.py")] + (["--report", rep] if rep else []) + outs, check=True)
subprocess.run([py, os.path.join(T, "lead_ko.py")], check=True)
subprocess.run([py, os.path.join(T, "lead_overview.py")], check=True)
subprocess.run([py, os.path.join(T, "lead_update.py")] + codes, check=False)
print("완료", len(codes), "곳")
