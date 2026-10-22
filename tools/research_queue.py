# -*- coding: utf-8 -*-
"""단계별 리서치 대기열 — 단계가 올라간 회사에 그 단계 리서치가 없으면 '대기'로 올린다.

  2단계에 들어온 회사 → 2단계 실적 분석 리서치(docs/data/jp/research/<코드>/stage2.md)
  3단계에 들어온 회사 → 3단계 딥 리포트       (…/stage3.md)
  4단계 회사          → 3단계 리포트를 그대로 쓰고, 결정 메모(stage4.md)는 사람이 쓴다

  python tools/research_queue.py          대기열 갱신 + 할 일 목록 출력(JSON)
  python tools/research_queue.py done 5018 2 "한 줄 결론" [아티팩트 링크]   리서치 파일을 다 쓴 뒤 완료 표시
  리서치 전문은 claude.ai 아티팩트로 게시하고(공유: 링크가 있는 사람 보기) 그 링크를 넘기면 사이트에 '리서치 전문 보기' 버튼이 생긴다
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "docs", "data", "jp")
IDX = os.path.join(DATA, "research", "index.json")
KST = timezone(timedelta(hours=9))
SKILL = {2: "2단계 실적 분석", 3: "3단계 딥 리포트"}


def now():
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M")


def load_idx():
    if os.path.exists(IDX):
        return json.load(open(IDX, encoding="utf-8"))
    return {"updated": None, "items": {}}


def save_idx(idx):
    idx["updated"] = now()
    os.makedirs(os.path.dirname(IDX), exist_ok=True)
    json.dump(idx, open(IDX, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def refresh():
    pipe = json.load(open(os.path.join(DATA, "pipeline.json"), encoding="utf-8"))
    idx = load_idx()
    todo = []
    for c, co in pipe["companies"].items():
        for st in (2, 3):
            if co["stage"] < st:
                continue
            it = idx["items"].setdefault(c, {}).get(str(st))
            path = os.path.join(DATA, "research", c, f"stage{st}.md")
            if it and it.get("status") == "완료" and os.path.exists(path):
                continue
            if not it:
                idx["items"][c][str(st)] = {"status": "대기", "queued": now(), "kind": SKILL[st]}
            todo.append({"c": c, "n": co["n"], "stage": st, "kind": SKILL[st],
                         "file": f"docs/data/jp/research/{c}/stage{st}.md"})
    save_idx(idx)
    print(json.dumps(todo, ensure_ascii=False, indent=1))


def done(c, st, verdict, artifact=None):
    idx = load_idx()
    path = os.path.join(DATA, "research", c, f"stage{st}.md")
    if not os.path.exists(path):
        sys.exit(f"리서치 파일이 없습니다: {path}")
    title = open(path, encoding="utf-8").readline().lstrip("# ").strip()
    idx["items"].setdefault(c, {})[str(st)] = {"status": "완료", "written": now(), "kind": SKILL[int(st)],
                                               "file": f"research/{c}/stage{st}.md", "title": title, "verdict": verdict}
    if artifact and artifact.startswith("https://claude.ai/"):
        idx["items"][c][str(st)]["artifact"] = artifact
    save_idx(idx)
    print(f"{c} {st}단계 리서치 완료 표시")


if __name__ == "__main__":
    if len(sys.argv) >= 5 and sys.argv[1] == "done":
        done(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else None)
    else:
        refresh()
