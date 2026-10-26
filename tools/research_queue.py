# -*- coding: utf-8 -*-
"""리서치 대기열 — 2단계 이상 회사에 2단계 실적 브리프가 없으면 '대기'로 올린다.
  3·4단계는 텔레 기록만, 리서치 안 함(2026-10-25 사용자). 동시에 만드는 리포트는 최대 MAX 개.

  python tools/research_queue.py          대기열 갱신 + {"running":[…], "free":빈 자리, "todo":[…]} 출력(JSON)
                                          '진행 중'이 STALE 분보다 오래되면 죽은 작업으로 보고 '대기'로 되돌린다
  python tools/research_queue.py done 5018 2 "한 줄 결론" [아티팩트 링크]   리서치 파일을 다 쓴 뒤 완료 표시
  리서치 전문은 claude.ai 아티팩트로 게시하고(공유: 링크가 있는 사람 보기) 그 링크를 넘기면 사이트에 '리서치 전문 보기' 버튼이 생긴다
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "docs", "data", "jp")
IDX = os.path.join(DATA, "research", "index.json")
KST = timezone(timedelta(hours=9))
NL = chr(10)
SKILL = {2: "2단계 실적 분석", 3: "3단계 딥 리포트"}
MAX = 4      # 동시에 도는 리포트 최대 수(2026-10-25 사용자)
STALE = 90   # 분


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
    cut = (datetime.now(KST) - timedelta(minutes=STALE)).strftime("%Y-%m-%d %H:%M")
    todo, running = [], []
    for c, co in pipe["companies"].items():
        if co["stage"] < 2:
            continue
        it = idx["items"].setdefault(c, {}).get("2")
        if it and it.get("status") == "진행 중" and (it.get("since") or "") < cut:
            it["status"] = "대기"   # 죽은 작업
        if it and it.get("status") == "완료":
            continue
        if it and it.get("status") == "진행 중":
            running.append(c)
            continue
        if it and it.get("status") == "멈춤":   # 사용자가 멈춰 둔 곳
            continue
        if not it:
            idx["items"][c]["2"] = {"status": "대기", "queued": now(), "kind": SKILL[2]}
        todo.append({"c": c, "n": co["n"], "stage": 2, "ann": (co["cards"].get("2") or {}).get("ann"),
                     "since": co.get("since")})
    todo.sort(key=lambda x: x.get("since") or "")   # 먼저 올라온 순
    save_idx(idx)
    print(json.dumps({"running": running, "free": max(0, MAX - len(running)), "todo": todo}, ensure_ascii=False, indent=1))


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


def attach(c, st, html, verdict):
    """리서치 스킬이 만든 HTML 을 다시 쓰지 않고 사이트로 복사(토큰 0). 검색 노출 안 함 표시를 넣는다."""
    src = open(html, encoding="utf-8").read()
    if 'name="robots"' not in src:
        meta = '<meta name="robots" content="noindex, nofollow, noarchive">'
        if re.search(r"<head[^>]*>", src, re.I):
            src = re.sub(r"(<head[^>]*>)", lambda m: m.group(1) + NL + meta, src, count=1, flags=re.I)
        else:   # 아티팩트용 파일은 <head> 없이 시작한다
            src = NL.join(['<!doctype html>', '<meta charset="utf-8">',
                           '<meta name="viewport" content="width=device-width, initial-scale=1">', meta, src])
    try:   # 표준 재무제표 엑셀도 같이(파이썬만, 토큰 0) → 리포트 안에 'xlsx 다운로드' 버튼
        import build_xlsx
        build_xlsx.build(c)
        src = build_xlsx.add_button(src, c)
    except Exception as e:
        print(f"{c} 엑셀 실패: {e}")
    rel = f"research/{c}/stage{st}.html"
    os.makedirs(os.path.join(DATA, "..", "..", "research", c), exist_ok=True)
    open(os.path.join(DATA, "..", "..", rel), "w", encoding="utf-8").write(src)
    title = (re.search(r"<title>([^<]*)", src) or [None, ""])[1].strip()
    idx = load_idx()
    idx["items"].setdefault(c, {})[str(st)] = {"status": "완료", "written": now(), "kind": SKILL[int(st)],
                                               "html": rel, "title": title, "verdict": verdict}
    save_idx(idx)
    print(f"{c} {st}단계 리서치 HTML 올림 → docs/{rel}")


def mark(c, st, status):
    idx = load_idx()
    it = idx["items"].setdefault(c, {}).setdefault(str(st), {"kind": SKILL[int(st)]})
    it["status"] = status
    it["since"] = now()
    save_idx(idx)


if __name__ == "__main__":
    if len(sys.argv) >= 5 and sys.argv[1] == "mark":   # mark <코드> <단계> 진행 중|대기|멈춤
        mark(sys.argv[2], sys.argv[3], " ".join(sys.argv[4:]))
    elif len(sys.argv) >= 6 and sys.argv[1] == "attach":
        attach(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    elif len(sys.argv) >= 5 and sys.argv[1] == "done":
        done(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else None)
    else:
        refresh()
