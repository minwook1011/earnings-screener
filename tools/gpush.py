# -*- coding: utf-8 -*-
"""커밋·푸시 — 두 컴퓨터가 같은 저장소에 올릴 때(2026-10-28) 밀리면 받아 와서 다시 올린다.

  python tools/gpush.py "<커밋 제목>" <경로…>
  python tools/gpush.py --pull        받아 오기만(작업 시작 전). 리서치 상태가 바뀌어 있으면 먼저 커밋해 둔다

  - 리서치 상태 docs/data/jp/research/index.json 이 바뀌어 있으면 늘 같이 커밋한다(남아 있으면 rebase 가 막힘).
  - 밀리면 git fetch → git rebase origin/main. 충돌이 아래 JSON 파일에서만 나면 회사(키)별로 합친다:
    한쪽만 바꾼 키는 바꾼 쪽, 둘 다 바꾼 키는 내 것. 다른 파일에서 충돌하면 rebase --abort 하고 멈춤(사람이 봄).
  - 강제 푸시·reset·stash 는 쓰지 않는다.
  - 한 컴퓨터에서 회차가 겹쳐도 git 작업은 한 번에 하나만(tools/gitlock.py 잠금, 2026-10-28).
    시작할 때 남은 rebase(다른 작업이 죽으며 남긴 것)가 있으면 abort 로 치우고 시작한다.
"""
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gitlock  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):   # cp949 창에서 '멈춤' 메시지 출력하다 죽던 것(2026-10-28)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDX = "docs/data/jp/research/index.json"
MERGE = {IDX, "docs/data/jp/xlsx/index.json", "tools/jp_labels_ko.json"}
TAIL = "\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"


def git(*a, ok=False):
    for i in range(2):
        r = subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                           env={**os.environ, "GIT_EDITOR": "true"})
        if "index.lock" in (r.stderr or "") and i == 0:
            time.sleep(10)
            continue
        break
    if not ok and r.returncode:
        raise RuntimeError(f"git {' '.join(a)}: {r.stderr.strip()[:300]}")
    return r


def show(stage, path):
    r = git("show", f":{stage}:{path}", ok=True)
    if r.returncode:
        return {}
    try:
        return json.loads(r.stdout)
    except ValueError:
        return {}


def merge(base, up, me):
    """키별 3방향 합치기. up = 받아 온 쪽, me = 내 커밋."""
    if not (isinstance(base, dict) and isinstance(up, dict) and isinstance(me, dict)):
        return me if me != base else up
    out = {}
    for k in list(up) + [k for k in me if k not in up]:
        b, u, m = base.get(k), up.get(k), me.get(k)
        if k not in me and k in base:          # 내가 지운 키
            if u == b:
                continue
            out[k] = u
        elif k not in up and k in base:        # 저쪽이 지운 키
            if m == b:
                continue
            out[k] = m
        elif m == b:
            out[k] = u
        elif u == b or u is None:
            out[k] = m
        elif isinstance(u, dict) and isinstance(m, dict):
            out[k] = merge(b if isinstance(b, dict) else {}, u, m)
        else:
            out[k] = m
    return out


def rebase():
    git("fetch", "-q", "origin", "main")
    for _ in range(9):   # 같은 폴더의 다른 작업(동기화)이 파일을 쓰는 중이면 rebase 가 안 됨 → 20초씩 기다림
        r = git("rebase", "origin/main", ok=True)
        if r.returncode == 0 or "changes" not in (r.stderr or ""):
            break
        time.sleep(20)
    else:
        print("보류: 커밋 안 된 다른 변경이 있어 못 받아 옴 — 커밋은 남아 있고 다음 gpush 때 같이 올라감")
        return False
    for _ in range(50):
        if r.returncode == 0:
            return True
        bad = [f for f in git("diff", "--name-only", "--diff-filter=U").stdout.split() if f]
        if not bad or any(f not in MERGE for f in bad):
            git("rebase", "--abort", ok=True)
            print("멈춤: 합칠 수 없는 충돌 —", ", ".join(bad) or r.stderr.strip()[:200])
            return False
        for f in bad:   # rebase 중에는 :2 = 받아 온 쪽(HEAD), :3 = 내 커밋
            m = merge(show(1, f), show(2, f), show(3, f))
            json.dump(m, open(os.path.join(ROOT, f), "w", encoding="utf-8"), ensure_ascii=False,
                      indent=1 if f == IDX else None)
            git("add", f)
        r = git("rebase", "--continue", ok=True)
    git("rebase", "--abort", ok=True)
    return False


def heal():
    """잠금을 잡은 뒤라 지금 rebase 중인 다른 작업은 없다 — 남아 있는 rebase 는 죽은 작업의 흔적."""
    for d in ("rebase-merge", "rebase-apply"):
        p = os.path.join(ROOT, ".git", d)
        if not os.path.isdir(p):
            continue
        git("rebase", "--abort", ok=True)
        if os.path.isdir(p) and not os.listdir(p):   # 빈 폴더만 남으면 abort 도 못 함(10/28 실제로 있었음)
            os.rmdir(p)
        print(f"남은 rebase 치움({d})")


def main():
    with gitlock.held():
        heal()
        run()


def run():
    if sys.argv[1:] == ["--pull"]:
        if git("status", "--porcelain", "--", IDX).stdout.strip():
            git("add", "--", IDX)
            git("commit", "-q", "-m", "research: 대기열 상태" + TAIL)
        if not rebase():
            sys.exit(1)
        print("받아 옴:", git("log", "--oneline", "-1").stdout.strip())
        return
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    msg, paths = sys.argv[1], sys.argv[2:]
    if git("status", "--porcelain", "--", IDX).stdout.strip():
        paths.append(IDX)
    git("add", "--", *paths)
    if git("diff", "--cached", "--quiet", ok=True).returncode == 0:
        print("올릴 것 없음")
        return
    git("commit", "-q", "-m", msg + TAIL)
    for _ in range(4):
        if git("push", "-q", "origin", "main", ok=True).returncode == 0:
            print("올림:", git("log", "--oneline", "-1").stdout.strip())
            return
        if not rebase():
            sys.exit(1)
    print("멈춤: 4번 밀림")
    sys.exit(1)


if __name__ == "__main__":
    main()
