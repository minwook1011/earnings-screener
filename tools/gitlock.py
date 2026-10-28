# -*- coding: utf-8 -*-
"""한 컴퓨터 안에서 git·대기열 쓰기를 한 번에 하나만(2026-10-28 사용자).
  예약 작업 회차가 겹쳐 여러 세션이 같은 폴더에서 동시에 rebase 하다가 빈 rebase-merge 가 남아
  이후 회차가 전부 '멈춤'으로 끝난 일이 있어서 만든 잠금. 파일은 .git 안이라 커밋되지 않는다.

  with gitlock.held():  ...      잠금을 잡고 실행(같은 프로세스 안에서는 다시 잡아도 됨)
"""
import contextlib
import os
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCK = os.path.join(ROOT, ".git", "screener.lock")
STALE = 600    # 초 — 이보다 오래된 잠금은 죽은 작업이 남긴 것으로 보고 치운다
WAIT = 900     # 초 — 이만큼 기다려도 못 잡으면 포기
_depth = 0


@contextlib.contextmanager
def held():
    global _depth
    if _depth:   # 이미 잡고 있음(gpush 안에서 research_queue 를 부르는 경우 등)
        _depth += 1
        try:
            yield
        finally:
            _depth -= 1
        return
    end = time.time() + WAIT
    while True:
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"{os.getpid()} {time.strftime('%H:%M:%S')}".encode())
            os.close(fd)
            break
        except FileExistsError:
            try:
                if time.time() - os.path.getmtime(LOCK) > STALE:
                    os.remove(LOCK)
                    continue
            except OSError:
                continue
            if time.time() > end:
                raise RuntimeError("잠금 대기 시간 초과 — 다른 작업이 git 을 오래 붙잡고 있음")
            time.sleep(3)
    _depth = 1
    try:
        yield
    finally:
        _depth = 0
        try:
            os.remove(LOCK)
        except OSError:
            pass
