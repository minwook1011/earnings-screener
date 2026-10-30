# -*- coding: utf-8 -*-
"""리서치 대기열 — 1단계 이상 회사에 2단계 실적 브리프가 없으면 '대기'로 올린다(2026-10-28 사용자, 2단계 이상 → 1단계 이상).
  회사마다 브리프는 하나 — 1단계에서 이미 썼으면 2단계로 올라가도 다시 쓰지 않는다.
  3·4단계는 텔레 기록만, 리서치 안 함(2026-10-25 사용자). 동시에 만드는 리포트는 최대 MAX 개.

  python tools/research_queue.py          대기열 갱신 + {"running":[…], "free":빈 자리, "todo":[…]} 출력(JSON)
                                          '진행 중'이 STALE 분보다 오래되면 죽은 작업으로 보고 '대기'로 되돌린다
  python tools/research_queue.py done 5018 2 "한 줄 결론" [아티팩트 링크]   리서치 파일을 다 쓴 뒤 완료 표시
  리서치 전문은 claude.ai 아티팩트로 게시하고(공유: 링크가 있는 사람 보기) 그 링크를 넘기면 사이트에 '리서치 전문 보기' 버튼이 생긴다
"""
import html
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
MAX = 10     # 동시에 도는 리포트 최대 수(2026-10-26 사용자, 4→10)
MAX_BY = {"laptop": 15}   # 컴퓨터별로 다르게(2026-10-28 사용자, 노트북만 15). 없으면 MAX
STALE = 90   # 분
# 두 컴퓨터 분담(2026-10-28 사용자): 티커 끝자리 1·2·3 = 'home'(원래 컴퓨터), 나머지(0·4~9·영문) = 'laptop'.
# 컴퓨터마다 tools/shard.txt(커밋 안 함)에 home 또는 laptop 한 단어. 없으면 전부 맡음(예전처럼).
HOME_TAIL = "123"


def shard():
    try:
        return open(os.path.join(ROOT, "tools", "shard.txt"), encoding="utf-8").read().strip() or None
    except OSError:
        return None


def mine(c, sh=None):
    sh = sh if sh is not None else shard()
    if sh not in ("home", "laptop"):
        return True
    return (c[-1] in HOME_TAIL) == (sh == "home")


def now():
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M")


def load_idx():
    if os.path.exists(IDX):
        return json.load(open(IDX, encoding="utf-8"))
    return {"updated": None, "items": {}}


def save_idx(idx):
    if os.path.exists(IDX):   # 바뀐 게 없으면 안 씀(시각만 바뀌어 두 컴퓨터가 충돌하지 않게)
        old = json.load(open(IDX, encoding="utf-8"))
        if old.get("items") == idx.get("items"):
            return
    idx["updated"] = now()
    os.makedirs(os.path.dirname(IDX), exist_ok=True)
    json.dump(idx, open(IDX, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def refresh():
    pipe = json.load(open(os.path.join(DATA, "pipeline.json"), encoding="utf-8"))
    idx = load_idx()
    cut = (datetime.now(KST) - timedelta(minutes=STALE)).strftime("%Y-%m-%d %H:%M")
    todo, running, wait = [], [], []
    sh = shard()
    for c, co in pipe["companies"].items():
        if co["stage"] < 1 or not mine(c, sh):   # 1단계부터(2026-10-28 사용자). 다른 컴퓨터 몫은 손대지 않음
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
        card = co["cards"].get("2") or co["cards"].get(str(co["stage"])) or {}   # 1단계 회사는 1단계 카드의 발표일
        ann = card.get("ann")
        if not filed(c, ann):   # 이번 결산단신이 아직 안 잡히면 지난 분기로 쓰게 되니 기다린다(2026-10-26 신에츠폴리머)
            wait.append(c)
            continue
        todo.append({"c": c, "n": co["n"], "stage": 2, "lv": co["stage"], "ann": ann, "since": co.get("since")})
    todo.sort(key=lambda x: x.get("since") or "", reverse=True)   # 막 올라온 회사부터(2026-10-28 사용자, 보자마자 생성)
    save_idx(idx)
    print(json.dumps({"shard": sh or "전부", "running": running, "free": max(0, MAX_BY.get(sh, MAX) - len(running)), "todo": todo, "wait": wait}, ensure_ascii=False, indent=1))


def oku(v):   # 엔 → 억 엔
    if isinstance(v, list):
        return [oku(a) for a in v]
    return round(v / 1e8, 1) if isinstance(v, (int, float)) else None


def refresh_req():
    """요청 목록 모드(2026-10-30 사용자) — 대상은 tools/req_raw.json(req_fetch.py 가 받음). 봇은 index.json 에서
    요청 발표 시각(pub) 뒤에 쓴 '완료'를 보고 카드를 올린다. 그래서 그 뒤 '완료'가 없으면 할 일."""
    try:
        reqs = json.load(open(os.path.join(ROOT, "tools", "req_raw.json"), encoding="utf-8"))["items"]
    except (OSError, ValueError, KeyError):
        sys.exit("tools/req_raw.json 없음 — 먼저 python tools/req_fetch.py")
    idx = load_idx()
    cut = (datetime.now(KST) - timedelta(minutes=STALE)).strftime("%Y-%m-%d %H:%M")
    todo, running, wait, seen = [], [], [], set()
    sh = shard()
    for r in sorted(reqs, key=lambda r: r.get("pub", ""), reverse=True):
        c, pub = r["code"], r.get("pub", "")
        if c in seen or not mine(c, sh):
            continue
        seen.add(c)
        it = idx["items"].setdefault(c, {}).get("2")
        if it and it.get("status") == "진행 중" and (it.get("since") or "") < cut:
            it["status"] = "대기"   # 죽은 작업
        if it and it.get("status") == "완료" and (it.get("written") or "") >= pub:
            continue
        if it and it.get("status") == "진행 중":
            running.append(c)
            continue
        if it and it.get("status") == "멈춤":
            continue
        if not it:
            idx["items"][c]["2"] = {"status": "대기", "queued": now(), "kind": SKILL[2]}
        ann = f"{int(pub[5:7])}/{int(pub[8:10])} {pub[11:16]}" if len(pub) >= 16 else None
        if r.get("kind") != "preannounce" and not filed(c, ann):   # 이번 결산단신이 아직 안 잡힘
            wait.append(c)
            continue
        t = {"c": c, "n": r.get("name", c), "stage": 2, "ann": ann, "pub": pub, "rid": r.get("rid"),
             "q": r.get("period"), "kind": r.get("kind")}
        if r.get("kind") == "preannounce":   # 실적 미리 발표 — 숫자는 억 엔(eps 는 엔)
            for k in ("revised_cum", "previous_forecast_cum", "prior_year_cum", "fy_forecast"):
                if isinstance(r.get(k), dict):
                    t[k] = {n: (v if n == "eps" else oku(v)) for n, v in r[k].items()}
            for k in ("revised_period", "revision_doc", "revision_pdf"):
                t[k] = r.get(k)
        todo.append(t)
    save_idx(idx)
    print(json.dumps({"shard": sh or "전부", "running": running, "free": max(0, MAX_BY.get(sh, MAX) - len(running)),
                      "todo": todo, "wait": wait}, ensure_ascii=False, indent=1))


def filed(c, ann):
    """발표일(카드 'MM/DD HH:MM')이 최근 7일이면 그날 이후 결산단신이 목록에 있어야 시작한다."""
    m = re.match(r"(\d+)/(\d+)", ann or "")
    if not m:
        return True
    t = datetime.now(KST)
    d = datetime(t.year, int(m.group(1)), int(m.group(2)), tzinfo=KST)
    if d > t + timedelta(days=1):
        d = d.replace(year=t.year - 1)
    if (t - d).days > 7:
        return True
    try:
        import build_xlsx
        fs = build_xlsx.filings(c)
    except BaseException:   # 목록을 못 받으면 다음 번에
        return False
    return bool(fs) and fs[0]["date"] >= d.strftime("%Y-%m-%d")


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


def attach(c, st, html, verdict, rid=None):
    """리서치 스킬이 만든 HTML 을 다시 쓰지 않고 사이트로 복사(토큰 0). 검색 노출 안 함 표시를 넣는다."""
    src = open(html, encoding="utf-8").read()
    if 'name="robots"' not in src:
        meta = '<meta name="robots" content="noindex, nofollow, noarchive">'
        if re.search(r"<head[^>]*>", src, re.I):
            src = re.sub(r"(<head[^>]*>)", lambda m: m.group(1) + NL + meta, src, count=1, flags=re.I)
        else:   # 아티팩트용 파일은 <head> 없이 시작한다
            src = NL.join(['<!doctype html>', '<meta charset="utf-8">',
                           '<meta name="viewport" content="width=device-width, initial-scale=1">', meta, src])
    src = light(src)
    src = tanshin(c, src)
    try:   # 실적 분석을 ① 실적 요약 ② 질의응답 탭으로(질의응답은 나중에 예약 작업이 채움)
        import qa
        if 'class="es-tabs"' not in src:   # 빌더가 이미 탭(질의응답 포함)을 만들었으면 그대로
            src = qa.tabs(src, qa.none_html(c))
    except Exception as e:
        print(f"{c} 질의응답 탭 실패: {e}")
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
    if rid:   # 요청 목록의 요청 번호(봇이 카드와 맞춤)
        idx["items"][c][str(st)]["rid"] = rid
    save_idx(idx)
    print(f"{c} {st}단계 리서치 HTML 올림 → docs/{rel}")


TBTN = ('<style>.es-tanshin-bar{margin:0 0 14px}.es-tanshin{display:inline-block;padding:7px 14px;border-radius:999px;'
        'background:#c62828;color:#fff;font:600 13px/1 system-ui,"Malgun Gothic",sans-serif;text-decoration:none}'
        '.es-tanshin:hover{background:#a31f1f}.es-call{display:inline-block;margin-left:10px;padding:6px 12px;border-radius:999px;'
        'border:1.5px solid #c62828;color:#c62828;font:600 13px/1 system-ui,"Malgun Gothic",sans-serif;vertical-align:1px}</style>'
        '<div class="es-tanshin-bar"><a class="es-tanshin" href="tanshin.pdf" download="{name}">결산단신 PDF 다운로드</a>{call}</div>')


def tanshin(c, src):
    """실적 분석 바로 아래 '결산단신 PDF 다운로드'(2026-10-26 사용자). 배지 날짜의 결산단신을 사이트에 복사해 둔다
    (거래소 공식 PDF 주소는 한 달 뒤 사라지고, JPX 보관본은 발표 당일엔 아직 없어서)."""
    m = re.search(r'class="resd">[^<]*?(\d{2})\.(\d{1,2})\.(\d{1,2})', src)
    day = f"20{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None
    out = os.path.join(DATA, "..", "..", "research", c, "tanshin.pdf")
    try:
        import build_xlsx
        fs = build_xlsx.filings(c)
        if not day:   # 실적 분석 칸이 없는 옛 형식 — 리포트를 쓴 날까지 나온 최신 결산단신
            w = (load_idx()["items"].get(c, {}).get("2") or {}).get("written") or now()
            day = next((f["date"] for f in fs if f["date"] <= w[:10]), None)
        f = next((f for f in fs if f["date"] == day), None)
        if not f:
            print(f"{c} {day} 결산단신 못 찾음 — PDF 버튼 없음")
            return src
        tag = out + ".doc"   # 받아 둔 PDF 의 문서 번호
        if not (os.path.exists(out) and os.path.exists(tag) and open(tag, encoding="utf-8").read() == f["doc"]):
            b = build_xlsx.get(f"https://www.release.tdnet.info/inbs/{f['doc']}.pdf") or build_xlsx.get(build_xlsx.PDF.format(code=c, doc=f["doc"]))
            if not b or b[:4] != b"%PDF":
                print(f"{c} 결산단신 PDF 못 받음")
                return src
            os.makedirs(os.path.dirname(out), exist_ok=True)
            open(out, "wb").write(b)
            open(out + ".doc", "w", encoding="utf-8").write(f["doc"])
    except Exception as e:
        print(f"{c} 결산단신 PDF 실패: {e}")
        return src
    name = f"{c} 결산단신 {day}.pdf"
    if 'class="es-tanshin-bar"' in src:   # 빌더가 공식 주소로 단 버튼 → 사이트 사본으로(옆의 콜 일정은 그대로)
        src = re.sub(r'<a class="es-tanshin" href="[^"]*"[^>]*>',
                     lambda _: f'<a class="es-tanshin" href="tanshin.pdf" download="{name}">', src, count=1)
        if 'class="es-call"' not in src:   # 보고서에 콜 일정이 없으면 결산단신 칸으로
            src = re.sub(r'(<div class="es-tanshin-bar">.*?)(</div>)', lambda k: k.group(1) + call_chip(out) + k.group(2),
                         src, count=1, flags=re.S)
        return deck(c, day, src)
    btn = TBTN.replace("{name}", name).replace("{call}", call_chip(out))
    if not m:   # 실적 분석 칸이 없으면 맨 위(xlsx 버튼 아래)에 발표일과 함께
        btn = btn.replace('<div class="es-tanshin-bar">', '<div class="es-tanshin-bar" style="padding:8px 16px 0">', 1)
        btn = btn.replace("결산단신 PDF 다운로드</a>", f"결산단신 PDF 다운로드 ({int(day[5:7])}/{int(day[8:])} 발표)</a>", 1)
        if 'id="es-xlsx-bar"' in src:
            src = re.sub(r'(<div id="es-xlsx-bar">.*?</div>)', lambda k: k.group(1) + btn, src, count=1, flags=re.S)
        else:
            src = re.sub(r"(<body[^>]*>)", lambda k: k.group(1) + btn, src, count=1, flags=re.I)
        return deck(c, day, src)
    src = re.sub(r'(<details class="tg an res">.*?</summary>\s*<div class="tgb">)', lambda k: k.group(1) + btn, src, count=1, flags=re.S)
    return deck(c, day, src)


DCSS = ('<style>.es-deck{display:inline-block;margin-left:10px;padding:7px 14px;border-radius:999px;background:#1f4e9c;color:#fff;'
        'font:600 13px/1 system-ui,"Malgun Gothic",sans-serif;text-decoration:none}.es-deck:hover{background:#163a75}</style>')


def deck(c, day, src):
    """결산단신 버튼 옆 '설명회 자료 PDF'(2026-10-26 사용자) — 같은 날 낸 결산 설명 자료(PPT)를 사이트에 복사. 안 냈으면 버튼 없음."""
    if 'class="es-tanshin"' not in src:
        return src
    out = os.path.join(DATA, "..", "..", "research", c, "setsumei.pdf")
    try:
        import build_xlsx
        ds = build_xlsx.decks(c, day)
        if ds:
            f = ds[0]
            urls = [f"https://www.release.tdnet.info/inbs/{f['doc']}.pdf", build_xlsx.PDF.format(code=c, doc=f["doc"])]
        else:   # 거래소에 안 내고 회사 IR 사이트에만 올린 자료(10/26 코에이테크모) — 빌더가 단 주소를 받음
            m = re.search(r'<a class="es-deck" href="(https?://[^"]+)"', src)
            if not m:
                return src
            u = html.unescape(m.group(1))
            f, urls = {"doc": u}, [u]
        tag = out + ".doc"
        if not (os.path.exists(out) and os.path.exists(tag) and open(tag, encoding="utf-8").read() == f["doc"]):
            b = next((x for x in map(build_xlsx.get, urls) if x), None)
            if not b or b[:4] != b"%PDF":
                print(f"{c} 설명회 자료 PDF 못 받음")
                return src
            open(out, "wb").write(b)
            open(tag, "w", encoding="utf-8").write(f["doc"])
    except Exception as e:
        print(f"{c} 설명회 자료 실패: {e}")
        return src
    a = f'<a class="es-deck" href="setsumei.pdf" download="{c} 설명회 자료 {day}.pdf">설명회 자료 PDF 다운로드</a>'
    if 'class="es-deck"' in src:   # 빌더가 공식 주소로 단 버튼 → 사이트 사본으로
        src = re.sub(r'<a class="es-deck"[^>]*>[^<]*</a>', lambda _: a, src, count=1)
    else:
        src = re.sub(r'(<a class="es-tanshin"[^>]*>[^<]*</a>)', lambda k: k.group(1) + a, src, count=1)
    if ".es-deck{" not in src:
        src = src.replace('<div class="es-tanshin-bar">', DCSS + '<div class="es-tanshin-bar">', 1)
    return src


def call_chip(pdf):
    """리포트에 콜 일정이 없을 때 — 결산단신 첫 쪽 '결산설명회 개최 유무' 칸만으로(날짜는 IR 사이트에만 있음)."""
    try:
        import pypdf
        t = re.sub(r"\s+", "", pypdf.PdfReader(pdf).pages[0].extract_text())
    except Exception:
        return ""
    m = re.search(r"決算説明会開催の有無[:：]?(有|無)[（(]?([^）)]{0,30})", t)
    if not m:
        return ""
    if m.group(1) == "無":
        return '<span class="es-call">결산설명회 없음</span>'
    who = "·".join(k for j, k in (("機関投資家", "기관"), ("アナリスト", "애널리스트"), ("個人投資家", "개인")) if j in m.group(2))
    return f'<span class="es-call">결산설명회 있음{f"({who} 대상)" if who else ""} · 날짜 미확인</span>'


def light(src):
    """리포트는 늘 밝은 화면 — 휴대폰 다크 모드에서 일부 칸 글자가 안 보여서(2026-10-26)."""
    if not re.search(r"<html[^>]*data-theme", src, re.I):
        src = re.sub(r"<html", '<html data-theme="light"', src, count=1, flags=re.I)
    if 'name="color-scheme"' not in src:   # 브라우저 강제 다크(크롬·삼성 인터넷)도 끔
        src = re.sub(r"(<head[^>]*>)", lambda m: m.group(1) + '<meta name="color-scheme" content="only light">'
                     '<style>:root{color-scheme:only light}</style>', src, count=1, flags=re.I)
    return src


def mark(c, st, status):
    idx = load_idx()
    it = idx["items"].setdefault(c, {}).setdefault(str(st), {"kind": SKILL[int(st)]})
    it["status"] = status
    it["since"] = now()
    save_idx(idx)


def cli():
    if len(sys.argv) >= 5 and sys.argv[1] == "mark":   # mark <코드> <단계> 진행 중|대기|멈춤
        mark(sys.argv[2], sys.argv[3], " ".join(sys.argv[4:]))
    elif len(sys.argv) >= 6 and sys.argv[1] == "attach":   # attach <코드> <단계> <HTML> "<결론>" [--rid <요청 번호>]
        rid = sys.argv[sys.argv.index("--rid") + 1] if "--rid" in sys.argv[:-1] else None
        attach(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], rid)
    elif len(sys.argv) >= 2 and sys.argv[1] == "--req":
        refresh_req()
    elif len(sys.argv) >= 5 and sys.argv[1] == "done":
        done(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else None)
    else:
        refresh()


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import gitlock
    with gitlock.held():   # gpush 의 rebase 와 겹쳐 쓰지 않게(2026-10-28)
        cli()
