# -*- coding: utf-8 -*-
"""선행지표 원장 만들기(2026-11-16 사용자) — 조사 결과(out_*.json)를 docs/data/jp/lead/<코드>.json 으로.

  입력  조사 파일들(기업별 ko·sub·about·thesis·tags·fy_end·next·rows·fc_eps·fc_net·lead[]·note)
        rows = jp_guidance(history=quarterly) 의 [기간, 공표일, basis, 매출(엔), 문서번호]
        lead = [{kind: pension|trends|macro, rank, why, term?, pts?, id?, name?}]
        EDINET 코드표(법인번호) — --edinet ind.json
  출력  기업 원장 + index.json 섹터 트리(그룹·세부 섹터에 코드 추가)
  원칙  선행지표 = 회사 밖 월간 데이터만. 회사 발표 숫자·가이던스는 넣지 않는다.

  python tools/lead_build.py --edinet <ind.json> out_it1.json out_it2.json …
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAD = os.path.join(ROOT, "docs", "data", "jp", "lead")

GROUPS = [  # 대분류 → 세부 섹터(id, 이름, 설명)
    ("it", "IT·서비스", "IT SERVICES", [
        ("consult", "컨설팅 · 인력형(상주·프로젝트)", None), ("advisory", "컨설팅 · 중소기업·M&A 자문형", None), ("think", "싱크탱크 · SI", None),
        ("si", "SI · 수탁개발 · IT 인력", "엔지니어 수 × 단가가 매출 — 연금 가입자 수가 인력 흐름을 먼저 보여 준다."),
        ("saas", "SaaS · 클라우드 SW", "구독 매출. 서비스 이름 검색 관심도와 인력 흐름으로 고객 유입·투자 속도를 본다."),
        ("game", "게임", "타이틀 검색 관심도가 매출을 먼저 보여 준다."),
        ("content", "미디어 · 엔터 · 콘텐츠", "작품·IP 검색 관심도와 관련 시장 통계."),
        ("platform", "인터넷 플랫폼 · EC · 결제", "서비스 이름 검색 관심도·시장 통계로 이용자 흐름을 본다."),
        ("infra", "통신 · 데이터센터 · IoT", "인프라 수요 통계와 인력 흐름.")]),
    ("re", "부동산·건설", "REAL ESTATE · CONSTRUCTION", [
        ("house", "주택 분양 · 재판매", "착공·분양·중고 거래 통계가 매출을 먼저 보여 준다."),
        ("develop", "수익 부동산 매입 · 개발", "부동산 거래·가격·오피스 공실 통계."),
        ("reservice", "부동산 서비스 · 임대 · 공간", "공실률·임대 시세·이용 수요 통계."),
        ("mep", "전기 · 설비 · 공조 공사", "건설 수주·착공 통계와 인력 흐름."),
        ("civil", "토목 · 플랜트 · 기타 건설", "건설 수주·공공 투자 통계.")]),
    ("cons", "소비재", "CONSUMER", [
        ("dining", "외식", "업계 월간 외식 매출·브랜드 검색 관심도."),
        ("grocery", "슈퍼 · 드럭 · 할인점 · 편의점", "업태별 상업동태통계·브랜드 검색 관심도."),
        ("apparel", "의류 · 잡화 전문점 · 명품", "브랜드 검색 관심도·백화점·인바운드 통계."),
        ("home", "생활 · 홈 · 가전 · 인테리어", "브랜드 검색 관심도·주택 착공·가전 출하 통계."),
        ("beauty", "화장품 · 뷰티 · 헬스케어 소비재", "브랜드 검색 관심도·인바운드·수출 통계."),
        ("food", "식품 · 음료", "브랜드 검색 관심도·수출 통계."),
        ("ec", "EC · 통신판매", "서비스 검색 관심도·EC 시장 통계."),
        ("leisure", "레저 · 여행 · 엔터 시설", "검색 관심도·인바운드·여행 통계.")]),
    ("svc", "서비스", "SERVICES", [
        ("lifesvc", "교육 · 관혼상제 · 의료/돌봄 · 생활 서비스", "검색 관심도·인력 흐름."),
        ("hr", "인재 · HR · 아웃소싱", "구인 통계와 인력 흐름."),
        ("b2bsvc", "기타 B2B 서비스", "인력 흐름·관련 시장 통계.")]),
    ("semi", "반도체", "SEMICONDUCTOR", [
        ("equip", "반도체 장비", "반도체 장비 판매·수출, 세계 반도체 출하."),
        ("mat", "반도체 소재", "웨이퍼·소재 수출입과 세계 반도체 출하."),
        ("sub", "기판 · 패키지", "기판·패키지 부품 수출입."),
        ("optic", "광 · 광통신", "광부품·레이저 수출입.")]),
    ("elec", "전자 · 전기", "ELECTRONICS", [
        ("ecomp", "전자부품", "부품 품목별 수출 물량·단가, 전자부품 출하."),
        ("power", "중전 · 전력기기", "전력 설비 투자·수주, 품목 수출."),
        ("emach", "전기기기 · 계측 · 정밀", "기계 수주·품목 수출입·생산.")]),
    ("mach", "기계", "MACHINERY", [
        ("fa", "FA · 로봇 · 공작기계", "공작기계·로봇 수주, 품목 수출."),
        ("indmach", "산업 · 건설 · 환경 기계", "기계 수주·건설 투자·품목 수출.")]),
    ("mats", "소재", "MATERIALS", [
        ("chem", "화학", "제품 수출 물량·단가, 원재료(나프타 등) 가격."),
        ("metal", "철강 · 비철 · 금속제품", "금속 가격·수출입·생산."),
        ("ceram", "유리 · 세라믹 · 고무", "제품 수출입·원재료 가격·생산.")]),
    ("auto", "자동차 · 운송기기", "AUTOMOTIVE", [("autop", "자동차 · 부품", "자동차 생산·판매·부품 수출.")]),
    ("trade", "상사 · 도매", "TRADING", [("trading", "상사 · 전문 도매", "취급 품목 수출입·가격.")]),
    ("enrg", "에너지 · 운송", "ENERGY · TRANSPORT", [
        ("util", "전력 · 가스 · 자원", "연료 가격·전력 수요·자원 가격."),
        ("trans", "운송 · 물류", "물동량·여객 수·운임.")]),
]
SUBGROUP = {s[0]: g[0] for g in GROUPS for s in g[3]}
WHY = {"pension": "직원을 뽑으면 그 달에 후생연금 가입자가 늘어난다. 일본연금기구가 법인별 가입자 수를 매달 공개하므로 결산보다 2~3개월 먼저 인력 증감을 본다.",
       "trends": "소비자·고객이 이름으로 검색하는 양이 늘면 이용·구매가 뒤따른다. 구글 트렌드는 주 단위로 바로 나와 결산보다 훨씬 먼저 수요 흐름을 본다.",
       "macro": "회사가 속한 시장 전체의 월간 통계 — 회사 매출의 바탕 수요를 먼저 보여 준다."}


def lab(p):
    m = re.match(r"(\d{4})/\d+期 (\d)Q", p or "")
    return "%02d.%sQ" % (int(m.group(1)) % 100, m.group(2)) if m else None


def qi(q): return int(q[:2]) * 4 + int(q[3]) - 1
def qs(i): return "%02d.%dQ" % (i // 4, i % 4 + 1)


def fy_end(x, rows):
    if x:
        return int(x)
    for r in rows:
        m = re.match(r"\d{4}/(\d+)期", r[0] or "")
        if m:
            return int(m.group(1))
    return 3


def build(code, x, ed):
    rows = sorted([r for r in x.get("rows") or [] if lab(r[0]) and r[3] is not None], key=lambda r: qi(lab(r[0])))
    sales, rel, refs = {}, {}, {}
    for p, pub, basis, v, doc in [r[:5] for r in rows]:
        q, rid = lab(p), "t" + str(doc)[-6:]
        rel[q] = pub
        refs[rid] = {"date": pub, "t": p + " 決算短信", "doc": doc}
        if basis in ("reported", "derived"):
            sales[q] = (round(v / 1e8, 2), rid)
        else:
            prev = [qs(qi(q) - k) for k in range(1, int(q[3]))]
            if all(y in sales for y in prev):
                sales[q] = (round(v / 1e8 - sum(sales[y][0] for y in prev), 2), rid)
    corp = (ed.get(code) or {}).get("corp", "")
    items, macro = [], []
    for L in sorted(x.get("lead") or [], key=lambda l: l.get("rank") or 9):
        k = L.get("kind")
        if k == "pension" and corp:
            items.append({"id": "pen", "kind": "pension", "t": "후생연금 가입자 수", "short": "연금 가입자", "unit": "명", "entity": (ed.get(code) or {}).get("n", ""), "corp": corp,
                          "note": "연금기구 법인번호 직접 조회로 26년 10월부터 쌓는 중 — 1년 뒤부터 YoY·R", "why": L.get("why", ""), "nenkin": [corp], "pts": [],
                          "src": [{"doc": "일본연금기구 適用事業所検索 — 법인번호 직접 조회", "where": "법인번호 %s 의 被保険者数" % corp, "freq": "월 1회(둘째 영업일 무렵 갱신)", "auto": "자동", "how": "tools/lead_update.py ②"}]})
        elif k == "trends" and L.get("pts"):
            items.append({"id": "gt", "kind": "trends", "t": "구글 검색 관심도 — " + L["term"], "short": "검색 「%s」" % L["term"], "unit": "지수", "term": L["term"], "entity": "구글 트렌드(전 세계, 일본어 검색어)", "corp": L["term"],
                          "note": "0~100 상대 지수(5년 중 최고 = 100). 주별 값을 월평균으로", "why": L.get("why", ""),
                          "pts": [[p[0], round(p[1], 1), "gt"] for p in L["pts"] if p and p[1] is not None],
                          "src": [{"doc": "Google Trends (google_trends 도구, region=world, period=5y)", "where": "검색어 「%s」 주별 관심도 → 월평균" % L["term"], "freq": "주 단위(월로 묶음)", "auto": "반자동", "how": "월 1회 클로드 예약 작업으로 갱신 예정"}]})
        elif k == "trends":   # 검색 관심도 — 아직 못 받았으면 수집 대기 목록으로
            macro.append({"id": "gt:" + (L.get("term") or ""), "name": "구글 검색 관심도 「%s」(수집 대기)" % L.get("term"), "why": L.get("why", "")})
        elif k == "macro":
            macro.append({"id": L.get("id"), "name": L.get("name"), "why": L.get("why", "")})
    if not items and corp and x.get("sub") in ("consult", "advisory", "think", "si"):
        items.append({"id": "pen", "kind": "pension", "t": "후생연금 가입자 수", "short": "연금 가입자", "unit": "명", "entity": (ed.get(code) or {}).get("n", ""), "corp": corp,
                      "note": "맞는 외부 지표를 찾는 중 — 우선 인력 흐름만", "why": "", "nenkin": [corp], "pts": [],
                      "src": [{"doc": "일본연금기구 適用事業所検索", "where": "법인번호 %s" % corp, "freq": "월 1회", "auto": "자동", "how": "tools/lead_update.py ②"}]})
    kinds = {i["kind"] for i in items}
    refs["gt"] = {"date": "2026-11-16", "t": "Google Trends", "url": "https://trends.google.com/"}
    nx = x.get("next") or {}
    fe = fy_end(x.get("fy_end"), rows)
    shares = (x["fc_net"] / x["fc_eps"]) if x.get("fc_net") and x.get("fc_eps") and x["fc_eps"] > 0 else None
    d = {"c": code, "n": x.get("ko") or code, "jp": (ed.get(code) or {}).get("n", "").replace("株式会社", "").strip(), "en": x.get("en") or "", "market": x.get("market") or "",
         "sec": "%s/%s" % (SUBGROUP.get(x.get("sub"), "it"), x.get("sub")),
         "fy": {"end_month": fe, "label": "%d월 결산" % fe, "rule": "YY.nQ = 20YY년 %d월에 끝나는 회계연도의 n분기" % fe},
         "updated": "2026-11-16", "about": x.get("about", ""), "thesis": x.get("thesis", ""), "tags": x.get("tags") or [], "report": None,
         "next": {"q": nx.get("q") or "", "period": nx.get("period") or "", "date": nx.get("date") or "2027-02-14", "fixed": bool(nx.get("fixed")), "note": "JPX 決算発表予定日" if nx.get("fixed") else "예년 발표일 기준 추정"},
         "rel": dict(sorted(rel.items())), "refs": refs, "consensus": None,
         "mkt": {"shares": round(shares) if shares else None, "fc_eps": x.get("fc_eps")},
         "series": {"sales": {"n": "매출", "unit": "억엔", "kind": "money", "src": {"doc": "결산단신", "where": "売上高 누계 → 분기 차감", "freq": "분기", "auto": "자동", "how": "jp_guidance(history=quarterly)"},
                              "pts": [[q, v, r, 1] for q, (v, r) in sorted(sales.items(), key=lambda z: qi(z[0]))]}},
         "lead": {"why": " ".join(WHY[k] for k in ("trends", "pension") if k in kinds), "caveat": "검색 관심도는 상대 지수라 수준보다 방향을 본다. 연금 가입자 수에는 연수 중 신입·본사 인력이 들어 있다." if "trends" in kinds else "연금 가입자 수에는 연수 중 신입·본사 인력이 들어 있다 — 수준보다 증가 속도를 본다.",
                  "next": {"date": "2026-12-02", "basis": "2026-11-20", "note": "일본연금기구 데이터 갱신일(매달 둘째 영업일 무렵)"}, "items": items, "macro": macro},
         "ir": {"tdnet": "https://www2.jpx.co.jp/disc/%s0/" % code, "docs": [{"ref": "t" + str(r[4])[-6:], "kind": "결산단신"} for r in sorted(rows, key=lambda r: -qi(lab(r[0])))[:4]]},
         "note": x.get("note", ""),
         "log": [{"d": "2026-11-16", "by": "Claude", "t": "2단계 리포트 기업으로 추가 — 선행지표: " + " · ".join(i["short"] for i in items) + ((" / 시장 통계 예정: " + " · ".join(m["name"] or m["id"] for m in macro)) if macro else "")}]}
    return d


def main():
    args = sys.argv[1:]
    ed = {}
    if "--edinet" in args:
        i = args.index("--edinet")
        ed = json.load(open(args[i + 1], encoding="utf-8"))
        args = args[:i] + args[i + 2:]
    idx = json.load(open(os.path.join(LEAD, "index.json"), encoding="utf-8"))
    res = json.load(open(os.path.join(ROOT, "docs", "data", "jp", "research", "index.json"), encoding="utf-8"))["items"]
    # 섹터 트리 — 기존 세부 섹터의 회사는 유지하고 GROUPS 순서대로 다시 짠다
    old = {k["id"]: k for g in idx["tree"] for k in g["kids"]}
    tree = []
    for gid, gn, en, subs in GROUPS:
        kids = []
        for sid, sn, desc in subs:
            o = old.get(sid, {})
            kids.append({"id": sid, "n": (o.get("n") if sid in ("consult", "advisory", "think") else None) or sn, "desc": (o.get("desc") if sid in ("consult", "advisory", "think") else None) or desc or "", "cos": list(o.get("cos") or [])})
        tree.append({"id": gid, "n": gn, "en": en, "kids": kids})
    n = 0
    for f in args:
        for code, x in json.load(open(f, encoding="utf-8")).items():
            if x.get("sub") not in SUBGROUP:
                print("세부 섹터 모름:", code, x.get("sub"))
                continue
            d = build(code, x, ed)
            r = res.get(code) or {}
            for k in ("2", "m", "3"):
                if isinstance(r.get(k), dict) and r[k].get("html") and r[k].get("status") == "완료":
                    d["report"] = {"html": r[k]["html"], "written": (r[k].get("written") or "")[:10], "title": r[k].get("title", ""), "verdict": r[k].get("verdict", "")}
                    break
            json.dump(d, open(os.path.join(LEAD, code + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            idx["cos"][code] = {"n": d["n"], "jp": d["jp"], "sec": d["sec"]}
            for g in tree:
                for k in g["kids"]:
                    if code in k["cos"]:
                        k["cos"].remove(code)
                    if k["id"] == x["sub"] and g["id"] == d["sec"].split("/")[0]:
                        k["cos"].append(code)
            n += 1
    for g in tree:
        for k in g["kids"]:
            if k["cos"]:
                k.pop("soon", None)
            else:
                k["soon"] = True
    idx["tree"] = tree
    json.dump(idx, open(os.path.join(LEAD, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("원장", n, "곳 ·", sum(len(k["cos"]) for g in tree for k in g["kids"]), "곳 트리")


if __name__ == "__main__":
    main()
