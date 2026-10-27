# -*- coding: utf-8 -*-
"""3·4단계 하루 한 번 스냅숏 — 텔레 토픽 6(3단계)·72(4단계)를 통째로 읽은 결과를 topicN.json 으로 바꿔 쓴다.

  입력  tools/tg_raw/snap6.json · snap72.json — read_messages(topic_id=6|72, limit=200) 결과를 그대로 저장한 것
  결과  tools/tg_raw/topic6.json · topic72.json — {"snapshot": 시각, "messages": [...]}
        snapshot 이 붙은 토픽은 '지금 텔레에 있는 것 = 전부'로 본다. 여기 없는 3·4단계 회사는 tg_parse.py 가 2단계로 내린다
        (2026-10-27 사용자: 매일 17시 한 번, 있다가 없어지면 2단계로).
  안전  읽기가 잘렸거나(200개 꽉 참) 형식이 이상하면 그 토픽은 손대지 않는다 — 전에 쓴 스냅숏을 그대로 둔다.

  실행  python tools/tg_snapshot.py
"""
import json
import os
from datetime import datetime, timedelta, timezone

RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tg_raw")
KST = timezone(timedelta(hours=9))
LIMIT = 200


def main():
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    for t in (6, 72):
        src = os.path.join(RAW, f"snap{t}.json")
        if not os.path.exists(src):
            print(f"토픽 {t}: 읽은 파일 없음 — 건너뜀")
            continue
        try:
            d = json.load(open(src, encoding="utf-8"))
            msgs = d["messages"]
        except (OSError, ValueError, KeyError, TypeError):
            print(f"토픽 {t}: 형식 이상 — 건너뜀")
            continue
        if len(msgs) >= LIMIT:
            print(f"토픽 {t}: {len(msgs)}개 꽉 참(잘렸을 수 있음) — 건너뜀")
            continue
        keep = [{"id": m["id"], "date": m["date"], "text": m["text"], "topic_id": t}
                for m in msgs if m.get("text") and m.get("topic_id") == t]
        out = {"chat": d.get("chat"), "topic": t, "read_at": now, "snapshot": now, "messages": keep}
        json.dump(out, open(os.path.join(RAW, f"topic{t}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        os.remove(src)
        print(f"토픽 {t}: 스냅숏 {len(keep)}개 글")


if __name__ == "__main__":
    main()
