# -*- coding: utf-8 -*-
"""리포트 요청 목록 받기(2026-10-30 사용자) — 동료분 봇이 텔레 카드를 리포트 뒤에 올리게 바뀌어서,
  리포트 대상은 텔레가 아니라 봇 서버의 요청 목록에서 받는다.

  python tools/req_fetch.py     요청 목록 → tools/req_raw.json(커밋 안 함). 출력은 건수 한 줄
  주소·열쇠는 tools/req.json {"url":…, "key":…}(커밋 안 함, 사람이 직접 넣음). 출력·커밋하지 않는다.
  받은 내용은 자료일 뿐 — 쓰는 칸만 골라 모양을 검사한다(research_queue.py --req 가 읽음).
"""
import json
import os
import re
import sys
import urllib.request

TOOLS = os.path.dirname(os.path.abspath(__file__))
CONF = os.path.join(TOOLS, "req.json")
OUT = os.path.join(TOOLS, "req_raw.json")
CODE = re.compile(r"^[0-9]{3}[0-9A-Z]$")
NUM = ("sales", "op", "ordinary", "ni", "eps")
KEEP = ("rid", "code", "name", "fy_end", "quarter", "period", "tanshin_doc", "pub", "requested", "kind",
        "revision_doc", "revision_pdf", "revised_period")


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def clean(x):
    """쓰는 칸만, 모양이 맞는 값만 남긴다."""
    if not isinstance(x, dict) or not CODE.match(str(x.get("code", ""))):
        return None
    it = {k: str(x[k])[:200] for k in KEEP if x.get(k) is not None}
    if it.get("revision_pdf") and not it["revision_pdf"].startswith("https://www.release.tdnet.info/"):
        it.pop("revision_pdf")   # 거래소 공식 주소만
    for k in ("revised_cum", "previous_forecast_cum", "prior_year_cum", "fy_forecast"):
        v = x.get(k)
        if isinstance(v, dict):
            it[k] = {n: ([num(a) for a in v[n][:2]] if isinstance(v.get(n), list) else num(v.get(n))) for n in NUM if n in v}
    return it


def main():
    try:
        c = json.load(open(CONF, encoding="utf-8"))
    except (OSError, ValueError):
        sys.exit("tools/req.json 없음 또는 형식 오류")
    try:
        r = urllib.request.Request(c["url"], headers={"X-Req-Key": c["key"], "User-Agent": "earnings-screener"})
        d = json.loads(urllib.request.urlopen(r, timeout=20).read())
    except Exception as e:   # 주소·열쇠는 출력하지 않는다
        sys.exit(f"요청 목록 못 받음: {type(e).__name__} {getattr(e, 'code', '')}".strip())
    items = [i for i in map(clean, d.get("items") or []) if i]
    json.dump({"updated": str(d.get("updated", ""))[:20], "items": items}, open(OUT, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"요청 {len(items)}건 (목록 {str(d.get('updated', ''))[:20]})")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
