#!/usr/bin/env python3
"""미국 부동산 화면(us-re.html) 데이터 — 한국·일본 기업 스크리너와 같은 꼴(RAW·BUNDLE·CATS)로 만든다.

  python tools/build_usre.py          # 스크리너 + 주가×금리×경기 차트 데이터 전부 다시 만들기

유니버스: 미국 건설사·상업용·주거용 부동산 26개 사업모델(BM), 95개 내외 종목(아래 SEG).
자료
  주가  : 야후 파이낸스 일봉(최근 10년, 분할 반영 종가). 차트 탭 주가는 배당·분할 반영 수정주가(2000년~).
  실적  : SEC EDGAR XBRL companyfacts(10-Q·10-K). 4분기는 연간 − 1~3분기.
  매크로: FRED — MORTGAGE30US(프레디맥 30년 모기지), DGS10(10년물), DFEDTAR·DFEDTARU(기준금리),
          UNRATE(실업률), PPIFIS(최종수요 PPI, 2010-11~), WPUFD49207(완제품 PPI, 그 이전).
  판매·매물·집값: FRED — HSN1F(신규주택 판매), MSACSR(신규주택 재고 개월수), ACTLISCOUUS(Realtor.com 활성 매물),
          CSUSHPINSA(케이스-실러), CPIAUCSL, MEHOINUSA646N(중위가구소득), TTLHH(가구 수)
          + Zillow Research 공개 CSV(미국 전체 판매 건수·매물·신규 매물).
출력: docs/data/usre/screener-con.js (RAW·BUNDLE·CATS), docs/data/usre/macro.js (REM), docs/data/usre/demand.js (RED),
      docs/data/usre/cycle.js (CYC — 금리 사이클) + docs/data/usre/cyc/<티커>.js (주간 수정주가 1999~·분기 매출·영업이익),
      docs/data/usre/screener-meta.json
단위: 시총·매출·이익 = 억달러, 주가 = 달러(묶음 px 는 ×100 정수, vo 는 ÷100), 날짜 = 1970-01-01 부터 일수
"""
import csv
import io
import json
import socket
import statistics
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# FRED·SEC 는 IPv6 로 붙으면 멈추는 일이 있어 IPv4 만 쓴다
_gai = socket.getaddrinfo
socket.getaddrinfo = lambda h, p, f=0, *a, **k: _gai(h, p, socket.AF_INET, *a, **k)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data" / "usre"
F_SCR, F_MAC, META = OUT / "screener-con.js", OUT / "macro.js", OUT / "screener-meta.json"
F_DEM = OUT / "demand.js"
F_CYC, CYC_DIR = OUT / "cycle.js", OUT / "cyc"          # 금리 사이클 탭(2026-11-05 사용자) — 종목별 파일은 고를 때만 읽는다
CYC_START = date(1999, 1, 2)
F_HIST = ROOT / "tools" / "usre_hist.json"   # XBRL(2009~) 이전 분기 실적 — 10-K 원문에서 손으로 옮긴 홈빌더 5사(2026-11-05 사용자)                             # 1999-06 인상기부터 보이도록. 토요일 → 2000-01-01 과 같은 주 격자
KST = timezone(timedelta(hours=9))
EPOCH = date(1970, 1, 1)
UA_WEB = {"User-Agent": "Mozilla/5.0"}
UA_SEC = {"User-Agent": "vantage sector-research script admin@example.com"}   # SEC 는 연락처 형식 UA 를 요구
YEARS = 10

# (그룹, 분류 이름, 설명, 종목) — 분류 이름이 화면 레일 칸이 된다
SEG = [
    ("주거", "첫 구매·중가 빌더", "첫 구매자·중가 주택. 금리 민감도 가장 큼", ["DHI", "LEN", "KBH", "MTH", "CCS", "LGIH"]),
    ("주거", "무브업·고가 빌더", "상향 이동·고가·은퇴층 고객", ["PHM", "NVR", "TOL"]),
    ("주거", "건축자재 유통", "목재·트러스·창호 유통. 착공과 거의 동행", ["BLDR", "BCC"]),
    ("주거", "주택 건축 제품", "단열·지붕·창호·데크·HVAC", ["MAS", "LII", "OC", "FBIN", "TREX"]),
    ("주거", "리모델링·홈센터", "기존 주택 수리·리모델링 소매", ["HD", "LOW", "FND"]),
    ("주거", "거래 플랫폼·중개", "매물 포털·중개·아이바잉", ["Z", "COMP", "OPEN", "EXPI"]),
    ("주거", "모기지", "주택담보대출 취급·서비싱", ["RKT", "PFSI", "UWMC"]),
    ("주거", "아파트 리츠", "멀티패밀리 임대", ["VMRK", "ESS", "MAA", "UDR", "CPT"]),
    ("주거", "단독주택 임대 리츠", "단독주택 대량 임대", ["INVH", "AMH"]),
    ("상업", "헬스케어 리츠", "시니어하우징·의료시설", ["WELL", "VTR"]),
    ("상업", "물류·산업 리츠", "물류창고·산업용 임대", ["PLD", "EGP", "REXR", "FR", "STAG"]),
    ("상업", "데이터센터 리츠", "코로케이션·하이퍼스케일 임대", ["EQIX", "DLR"]),
    ("상업", "리테일 리츠", "몰·쇼핑센터·넷리스", ["SPG", "O", "KIM", "REG", "FRT"]),
    ("상업", "셀프스토리지 리츠", "개인 보관창고 임대", ["PSA", "EXR", "CUBE"]),
    ("상업", "호텔 리츠", "호텔 소유", ["HST", "PK"]),
    ("상업", "오피스 리츠", "도심·교외 오피스 임대", ["BXP", "VNO", "CUZ", "SLG", "KRC", "HIW"]),
    ("상업", "부동산 서비스", "중개·임대대행·자산관리", ["CBRE", "JLL", "CWK"]),
    ("상업", "상업용 부동산 대출", "CRE 대출 모기지 리츠", ["STWD", "BXMT", "ARI"]),
    ("건설", "전력망·발전 시공", "송배전선·변전소·발전소 연결 공사", ["PWR", "MTZ", "MYRG", "PRIM"]),
    ("건설", "기계·전기 전문시공", "건물 안 전기·냉난방·배관(MEP). 데이터센터 비중 큼", ["EME", "FIX", "IESC", "LMB"]),
    ("건설", "부지·토목·도로", "부지 정지·지반·도로·교량", ["STRL", "GVA", "ROAD", "TPC"]),
    ("건설", "통신·광케이블 시공", "광케이블·통신망 구축", ["DY"]),
    ("건설", "엔지니어링·설계", "설계·사업관리·EPC", ["J", "ACM", "TTEK", "FLR", "KBR"]),
    ("건설", "골재·시멘트", "골재·레미콘·시멘트·포장", ["CRH", "VMC", "MLM", "EXP", "KNF", "USLM"]),
    ("건설", "건설장비·렌탈", "굴삭기·발전기·장비 렌탈", ["CAT", "URI", "OSK", "TEX", "HRI"]),
    ("건설", "데이터센터 전력·냉각", "UPS·배전·냉각·HVAC 장비", ["ETN", "VRT", "TT"]),
]
CATS = [f"{g}: {n}" for g, n, _, _ in SEG]

NAME_KO = {
    "DHI": "D.R. 호튼", "LEN": "레나", "KBH": "KB홈", "MTH": "메리티지 홈즈", "CCS": "센추리 커뮤니티스", "LGIH": "LGI 홈즈",
    "PHM": "펄티그룹", "NVR": "NVR", "TOL": "톨브라더스", "BLDR": "빌더스퍼스트소스", "BCC": "보이시 캐스케이드",
    "MAS": "마스코", "LII": "레녹스", "OC": "오웬스코닝", "FBIN": "포춘 브랜즈 이노베이션", "TREX": "트렉스",
    "HD": "홈디포", "LOW": "로우스", "FND": "플로어앤데코", "Z": "질로우", "COMP": "컴퍼스", "OPEN": "오픈도어",
    "EXPI": "eXp 월드", "RKT": "로켓 컴퍼니스", "PFSI": "페니맥 파이낸셜", "UWMC": "UWM 홀딩스",
    "VMRK": "비브마크 레지덴셜", "ESS": "에섹스 프로퍼티", "MAA": "미드아메리카 아파트", "UDR": "UDR", "CPT": "캠든 프로퍼티",
    "INVH": "인비테이션 홈즈", "AMH": "아메리칸 홈즈 4 렌트", "WELL": "웰타워", "VTR": "벤타스",
    "PLD": "프로로지스", "EGP": "이스트그룹", "REXR": "렉스포드", "FR": "퍼스트 인더스트리얼", "STAG": "STAG 인더스트리얼",
    "EQIX": "에퀴닉스", "DLR": "디지털 리얼티", "SPG": "사이먼 프로퍼티", "O": "리얼티인컴", "KIM": "킴코",
    "REG": "리전시 센터스", "FRT": "페더럴 리얼티", "PSA": "퍼블릭 스토리지", "EXR": "엑스트라 스페이스", "CUBE": "큐브스마트",
    "HST": "호스트 호텔스", "PK": "파크 호텔스", "BXP": "BXP", "VNO": "보네이도", "CUZ": "커즌스", "SLG": "SL 그린",
    "KRC": "킬로이 리얼티", "HIW": "하이우즈", "CBRE": "CBRE", "JLL": "존스랑라살", "CWK": "쿠시먼앤웨이크필드",
    "STWD": "스타우드 프로퍼티", "BXMT": "블랙스톤 모기지", "ARI": "아폴로 커머셜", "PWR": "퀀타 서비스",
    "MTZ": "마스텍", "MYRG": "MYR 그룹", "PRIM": "프리모리스", "EME": "엠코어", "FIX": "컴포트 시스템즈", "IESC": "IES 홀딩스",
    "LMB": "림바크", "STRL": "스털링 인프라", "GVA": "그래닛 컨스트럭션", "ROAD": "컨스트럭션 파트너스", "TPC": "튜터 페리니",
    "DY": "다이컴", "J": "제이콥스", "ACM": "에이컴", "TTEK": "테트라테크", "FLR": "플루어", "KBR": "KBR",
    "CRH": "CRH", "VMC": "벌칸 머티리얼즈", "MLM": "마틴 마리에타", "EXP": "이글 머티리얼즈", "KNF": "나이프 리버",
    "USLM": "US 라임", "CAT": "캐터필러", "URI": "유나이티드 렌탈", "OSK": "오시코시", "TEX": "테렉스", "HRI": "허크 홀딩스",
    "ETN": "이튼", "VRT": "버티브", "TT": "트레인 테크놀로지스",
}
NOTE_TK = {"VMRK": "2026-08-18 AvalonBay·Equity Residential 합병 — 2026-08 이전 주가는 Equity Residential(EQR)"}

REV_TAGS = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet",
            "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesNetOfInterestExpense", "RealEstateRevenueNet",
            "OperatingLeasesIncomeStatementLeaseRevenue", "InterestAndDividendIncomeOperating", "HomeBuildingRevenue",
            "SalesRevenueGoodsNet", "OperatingLeaseLeaseIncome", "LeaseIncome", "RevenueFromLeases"]
OI_TAGS = ["OperatingIncomeLoss",
           "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
           "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic",
           "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"]
NI_TAGS = ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"]
EQ_TAGS = ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]


def get(url, headers=UA_WEB, tries=3, timeout=60):
    err = None
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout).read()
        except Exception as e:
            err = e
            time.sleep(1.5 * (i + 1))
    raise err


def eday(iso):
    return (date.fromisoformat(iso) - EPOCH).days


def D(s):
    return date.fromisoformat(s)


# ── 주가 ──
def yahoo_daily(t, since):
    p1 = int(datetime(since.year, since.month, since.day, tzinfo=timezone.utc).timestamp())
    p2 = int(time.time()) + 86400
    j = json.loads(get(f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?period1={p1}&period2={p2}&interval=1d&events=div,split"))
    r = j["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    adj = r["indicators"].get("adjclose", [{}])[0].get("adjclose") or q["close"]
    rows = []
    for ts, c, a, v in zip(r["timestamp"], q["close"], adj, q["volume"]):
        if c is None:
            continue
        d = (datetime.fromtimestamp(ts, timezone.utc) - timedelta(hours=5)).date().isoformat()
        if rows and rows[-1][0] == d:
            rows[-1] = (d, c, a, v or 0)
        else:
            rows.append((d, c, a, v or 0))
    return rows, r["meta"]


def spikes(rows):
    """거래량이 직전 60거래일 중앙값의 5배 이상이면서 그날 주가가 5% 넘게 움직인 날(일본·한국 화면과 같은 기준)"""
    out, last = [], -99
    c = [r[1] for r in rows]; v = [r[2] for r in rows]
    for i in range(60, len(rows)):
        med = statistics.median(v[i - 60:i]) or 0
        if med <= 0 or v[i] < med * 5 or not c[i - 1]:
            continue
        d1 = (c[i] / c[i - 1] - 1) * 100
        if abs(d1) < 5 or i - last < 5:
            continue
        last = i
        f = lambda n: round((c[min(i + n, len(c) - 1)] / c[i] - 1) * 100, 1) if i + n < len(c) else None
        out.append({"i": i, "dy": eday(rows[i][0]), "m": round(v[i] / med, 1), "d1": round(d1, 1), "f5": f(5), "f20": f(20)})
    return out


def week_grid():
    out, d = [], CYC_START
    while d <= date.today():
        out.append(d.isoformat()); d += timedelta(days=7)
    return out


def wsamp(dates, ser, stale=10):
    """주 시작일 격자 → 그 주(시작일+6일) 안의 마지막 관측치. 관측치가 stale 일보다 오래되면 비운다"""
    out, j, lv = [], 0, None
    for ds in dates:
        a = (D(ds) + timedelta(days=6)).isoformat()
        while j < len(ser) and ser[j][0] <= a:
            lv = ser[j]; j += 1
        out.append(lv[1] if lv is not None and (D(a) - D(lv[0])).days <= stale else None)
    return out


def sig4(v):
    return None if v is None else float(f"{v:.4g}")


def pack(rows):
    d = [eday(r[0]) for r in rows]
    return {"d0": d[0], "dd": [0] + [d[i] - d[i - 1] for i in range(1, len(d))],
            "px": [int(round(r[1] * 100)) for r in rows], "vo": [int(round((r[2] or 0) / 100)) for r in rows]}


def ret_since(rows, day_iso):
    base = None
    for d, c, _ in rows:
        if d <= day_iso:
            base = c
        else:
            break
    return round((rows[-1][1] / base - 1) * 100, 1) if base else None


# ── 실적(SEC XBRL) ──
def _facts(facts, tag, unit="USD"):
    node = facts.get("us-gaap", {}).get(tag)
    return node["units"].get(unit, []) if node else []


def periods(facts, tags, pick_max=False):
    """분기(80~100일)·연간(350~380일) 값. 4분기는 연간 − 같은 회계연도 3개 분기로 채운다. 키 = 기간 종료일"""
    q, ann = {}, {}
    for tg in tags:
        for f in _facts(facts, tg):
            if f.get("form") not in ("10-Q", "10-K", "10-Q/A", "10-K/A") or "start" not in f:
                continue
            days = (D(f["end"]) - D(f["start"])).days
            tgt = q if 80 <= days <= 100 else ann if 350 <= days <= 380 else None
            if tgt is None:
                continue
            cur = tgt.get(f["end"]); cand = (f["val"], f.get("filed", ""), f["start"], tg)
            if cur is None:
                tgt[f["end"]] = cand
            elif pick_max and cur[3] != tg:
                if cand[0] > cur[0]:
                    tgt[f["end"]] = cand
            elif cur[3] == tg and cand[1] > cur[1]:
                tgt[f["end"]] = cand
            # 이익(pick_max 아님)은 앞 태그가 우선, 뒤 태그는 빈 기간만 채운다
    out = {k: v[0] for k, v in q.items()}
    for end, (val, _, start, _) in ann.items():
        if end in out:
            continue
        inside = [k for k in out if D(start) < D(k) < D(end)]
        if len(inside) == 3:
            out[end] = val - sum(out[k] for k in inside)
    a = {k: v[0] for k, v in ann.items()}
    return dict(sorted(out.items())), dict(sorted(a.items()))


def periods_oi(facts):
    """영업이익 태그가 없거나 최근이 비면 세전이익으로(빌더·리츠는 영업이익을 따로 안 쓰는 곳이 많다)"""
    for tg in OI_TAGS:
        q, a = periods(facts, [tg])
        if len(q) >= 8:
            return q, a, ("영업이익" if tg == "OperatingIncomeLoss" else "세전이익")
    return {}, {}, "영업이익"


def label_q(end, fm):
    e = D(end) - timedelta(days=15)          # 52·53주 회계(9/27 등)를 달 단위로 맞춘다
    y, m = e.year, e.month
    k = (m - fm) % 12
    qn = 4 if k == 0 else k // 3
    fy = y if m <= fm else y + 1
    return f"{fy % 100:02d}Q{qn}"


def fin_of(t, cik):
    facts = json.loads(get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", UA_SEC))["facts"]
    time.sleep(0.15)
    rq, ra = periods(facts, REV_TAGS, pick_max=True)
    oq, oa, oik = periods_oi(facts)
    nq, na = periods(facts, NI_TAGS)
    if not rq:
        return None
    last_a = max(ra) if ra else max(rq)
    fm = (D(last_a) - timedelta(days=15)).month
    ends = list(rq)[-12:][::-1]                  # 최근이 앞
    M = lambda v: None if v is None else round(v / 1e8, 2)   # 억달러
    qd = {"lb": [label_q(e, fm) for e in ends], "rev": [M(rq.get(e)) for e in ends],
          "oi": [M(oq.get(e)) for e in ends], "ni": [M(nq.get(e)) for e in ends]}
    aends = list(ra)[-7:][::-1]
    ttm = None
    e4 = list(rq)[-4:]
    if len(e4) == 4 and (D(e4[-1]) - D(e4[0])).days < 300:
        s = lambda m: sum(m[e] for e in e4) if all(e in m for e in e4) else None
        ttm = {"rev": s(rq), "oi": s(oq), "ni": s(nq)}
    lb, rv, oi, ni = [], [], [], []
    if ttm and not (aends and aends[0] == e4[-1]):
        lb.append("TTM"); rv.append(ttm["rev"]); oi.append(ttm["oi"]); ni.append(ttm["ni"])
    for e in aends[:6]:
        lb.append(str((D(e) - timedelta(days=15)).year)); rv.append(ra.get(e)); oi.append(oa.get(e)); ni.append(na.get(e))
    ad = {"lb": lb, "rev": [M(x) for x in rv], "oi": [M(x) for x in oi], "ni": [M(x) for x in ni]}
    def ttm_last(m):   # 이익 태그가 최근 분기만 비면 그 직전 연속 4분기 합(매출 최근 분기와 120일 안일 때만)
        k = list(m)[-4:]
        if len(k) == 4 and (D(k[-1]) - D(k[0])).days < 300 and e4 and (D(e4[-1]) - D(k[-1])).days <= 120:
            return sum(m[x] for x in k)
        return None
    rev_ttm = ttm["rev"] if ttm else (ra.get(aends[0]) if aends else None)
    oi_ttm = (ttm["oi"] if ttm and ttm["oi"] is not None else ttm_last(oq)) if ttm else (oa.get(aends[0]) if aends else None)
    ni_ttm = (ttm["ni"] if ttm and ttm["ni"] is not None else ttm_last(nq)) if ttm else (na.get(aends[0]) if aends else None)
    revg = None
    e8 = list(rq)[-8:]
    if len(e8) == 8 and (D(e8[-1]) - D(e8[0])).days < 700:
        prev = sum(rq[e] for e in e8[:4])
        revg = round((sum(rq[e] for e in e8[4:]) / prev - 1) * 100, 1) if prev > 0 else None
    rev_for_opm = rev_ttm
    if ttm and ttm["oi"] is None and oi_ttm is not None:
        k = list(oq)[-4:]; rv = [rq.get(x) for x in k]
        rev_for_opm = sum(rv) if all(v is not None for v in rv) else None
    opm = round(oi_ttm / rev_for_opm * 100, 1) if oi_ttm is not None and rev_for_opm and rev_for_opm > 0 else None
    roe = None
    for tg in EQ_TAGS:
        eq = [f for f in _facts(facts, tg) if f.get("form", "").startswith("10")]
        if eq and ni_ttm is not None:
            last = max(eq, key=lambda f: (f["end"], f.get("filed", "")))
            if last["val"] > 0:
                roe = round(ni_ttm / last["val"] * 100, 1)
            break
    # 주식 수: 표지(dei) 발행주식 합 → 없거나 오래되면 희석 가중평균
    shares = None
    sh = facts.get("dei", {}).get("EntityCommonStockSharesOutstanding", {}).get("units", {}).get("shares", [])
    if sh:
        le = max(x["end"] for x in sh)
        if le >= (date.today() - timedelta(days=200)).isoformat():
            shares = sum(x["val"] for x in sh if x["end"] == le and x.get("form", "").startswith("10")) or None
    if not shares:
        dil = [f for f in facts.get("us-gaap", {}).get("WeightedAverageNumberOfDilutedSharesOutstanding", {}).get("units", {}).get("shares", [])
               if f.get("form", "").startswith("10")]
        if dil:
            shares = max(dil, key=lambda f: (f["end"], f.get("filed", "")))["val"]
    oq_all = dict(oq)
    if oik == "세전이익":   # 세전이익 태그는 시기마다 이름이 달라 빈 분기를 다른 세전이익 태그로 채운다(같은 뜻이라 섞어도 된다)
        for tg in OI_TAGS[1:]:
            for k, v in periods(facts, [tg])[0].items():
                oq_all.setdefault(k, v)
    qall = [[e, round(rq[e] / 1e6, 1), (round(oq_all[e] / 1e6, 1) if e in oq_all else None)] for e in rq]   # 백만달러, 전 기간(금리 사이클 탭)
    return {"qall": qall, "q": qd, "a": ad, "fm": fm, "rev": rev_ttm, "revg": revg, "opm": opm, "ni": ni_ttm, "roe": roe,
            "shares": shares, "oik": oik, "lastq": ends[0] if ends else None}


SHARES_FIX = {"VMRK": 7.72e8}   # 합병(2026-08-18) 뒤 첫 10-Q 전 — AvalonBay 1주 = Equity Residential 2.793주로 환산한 추정


def merge_hist(t, qall):
    """10-K 원문 분기표에서 옮긴 분기 매출·세전이익(1999~2012)을 넣는다. 그 기간은 원문 값이 우선, 이후는 XBRL"""
    try:
        H = json.load(open(F_HIST, encoding="utf-8")).get(t)
    except FileNotFoundError:
        return qall
    if not H:
        return qall
    rows = {r[0]: list(r) for r in (qall or [])}
    for e, rv, oi in H["rows"]:
        k = next((x for x in rows if abs((D(x) - D(e)).days) <= 6), None)
        if k is None:
            rows[e] = [e, rv, oi]
        else:   # 원문 10-K 분기표가 있는 기간(~2012)은 그 값으로 통일 — XBRL 은 태그가 분기마다 달라 세전이익 정의가 들쭉날쭉하다
            rows[k][1] = rv if rv is not None else rows[k][1]
            rows[k][2] = oi if oi is not None else rows[k][2]
    return [rows[k] for k in sorted(rows)]


def one_stock(t, grp, cat, desc, cik, grid):
    try:
        rows_all, meta = yahoo_daily(t, CYC_START)
    except Exception:   # 상장이 늦은 종목은 1999년부터 물으면 빈 응답이 오기도 한다
        rows_all, meta = yahoo_daily(t, date.today() - timedelta(days=365 * YEARS + 10))
    cut = (date.today() - timedelta(days=365 * YEARS + 10)).isoformat()
    rows = [(d, c, v) for d, c, _, v in rows_all if d >= cut]
    if len(rows) < 40:
        return None, None, None, None
    fin = None
    try:
        fin = fin_of(t, cik) if cik else None
    except Exception as e:
        print("  실적 실패", t, e)
    fin = fin or {"q": None, "a": None, "fm": 12, "rev": None, "revg": None, "opm": None, "ni": None, "roe": None, "shares": None}
    close = round(rows[-1][1], 2); last = rows[-1][0]
    ld = D(last)
    py = ret_since(rows, ld.replace(year=ld.year - 1).isoformat())
    pytd = ret_since(rows, f"{ld.year - 1}-12-31")
    shares = SHARES_FIX.get(t) or fin["shares"]
    mcap = round(shares * close / 1e8) if shares else None
    M = lambda v: None if v is None else round(v / 1e8, 1)
    ni = fin["ni"]
    per = None
    if ni is not None and mcap:
        per = round(mcap / (ni / 1e8), 1) if ni > 0 else -1
    rev = M(fin["rev"])
    raw = [t, NAME_KO.get(t, meta.get("shortName") or t), cat, desc, close, mcap, fin["revg"], py, pytd, per,
           fin["roe"], fin["opm"], round(rev) if rev is not None else None]
    b = {"c": t, "n": raw[1], "en": meta.get("longName") or meta.get("shortName") or t, "cat": cat, "ind": desc,
         "mcap": mcap, "fm": fin["fm"], "ex": meta.get("fullExchangeName") or meta.get("exchangeName") or ""}
    if t in NOTE_TK:
        b["note"] = NOTE_TK[t]
    if fin.get("oik"):
        b["oik"] = fin["oik"]
    b.update(pack(rows)); b["sp"] = spikes(rows)
    for k in ("q", "a"):
        if fin.get(k):
            b[k] = fin[k]
    wk = wsamp(grid, [(d, a) for d, _, a, _ in rows_all if a])
    s0 = next((i for i, v in enumerate(wk) if v is not None), len(wk))
    cyc = {"s": s0, "p": [sig4(v) for v in wk[s0:]], "q": merge_hist(t, fin.get("qall")), "fm": fin["fm"], "oik": fin.get("oik") or "영업이익"}
    return raw, b, last, cyc


def build_screener():
    tick = json.loads(get("https://www.sec.gov/files/company_tickers.json", UA_SEC))
    cik = {v["ticker"].upper(): v["cik_str"] for v in tick.values()}
    jobs = [(t, g, f"{g}: {n}", de) for g, n, de, ts in SEG for t in ts]
    grid = week_grid()

    def run(j):
        t, g, cat, de = j
        for i in range(3):
            try:
                return one_stock(t, g, cat, de, cik.get(t), grid)
            except Exception as e:
                if i == 2:
                    print("  실패", t, e)
                time.sleep(1 + i)
        return None, None, None, None

    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(run, jobs))
    raw = [r for r, _, _, _ in res if r]; bun = [b for _, b, _, _ in res if b]
    CYC_DIR.mkdir(parents=True, exist_ok=True)
    for j, (_, _, _, cy) in zip(jobs, res):
        if cy:
            with open(CYC_DIR / f"{j[0]}.js", "w", encoding="utf-8", newline="\n") as f:
                f.write(f"/* {j[0]} 주간 수정주가(1999~)·분기 매출·{cy['oik']}(백만달러) — build_usre.py */\n")
                f.write(f"(window.CYCT=window.CYCT||{{}})[{json.dumps(j[0])}]={json.dumps(cy, ensure_ascii=False, separators=(',', ':'))};\n")
    raw.sort(key=lambda r: -(r[5] or 0))
    asof = max((l for _, _, l, _ in res if l), default=None)
    bm = {f"{g}: {n}": de for g, n, de, _ in SEG}
    with open(F_SCR, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"/* 미국 부동산 스크리너 데이터 — build_us_re.py 가 만든다({datetime.now(KST):%Y-%m-%d %H:%M} KST) */\n")
        f.write(f"const RAW = {json.dumps(raw, ensure_ascii=False, separators=(',', ':'))};\n")
        f.write(f"const BUNDLE = {json.dumps(bun, ensure_ascii=False, separators=(',', ':'))};\n")
        f.write(f"const CATS = {json.dumps(CATS, ensure_ascii=False)};\n")
        f.write(f"const CAT_DESC = {json.dumps(bm, ensure_ascii=False)};\n")
        f.write("const KPI = {};\nconst NEWS = {};\nconst BM = {};\n")
    fails = [j[0] for j, (r, _, _, _) in zip(jobs, res) if not r]
    return {"n": len(raw), "asof": asof, "fails": fails}


# ── 주가×금리×경기 차트 ──
MAC_GROUPS = {"hb": ["DHI", "LEN", "PHM", "NVR", "TOL"], "pf": ["Z", "COMP", "OPEN"],
              "rr": ["VMRK", "ESS", "INVH"], "cr": ["WELL", "PLD", "EQIX"]}


def fred(sid):
    txt = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}", {}).decode()
    out = []
    for row in list(csv.reader(io.StringIO(txt)))[1:]:
        if len(row) >= 2 and row[1] not in ("", "."):
            out.append((row[0], float(row[1])))
    return out


def build_macro():
    start = date(2000, 1, 1)
    px = {}
    for g in MAC_GROUPS.values():
        for t in g:
            rows, _ = yahoo_daily(t, start)
            px[t] = [(d, a) for d, _, a, _ in rows if a is not None]
    last = max(r[-1][0] for r in px.values())
    dates, d = [], start
    while d.isoformat() <= last:
        dates.append(d.isoformat()); d += timedelta(days=7)
    if dates[-1] != last:
        dates.append(last)

    def samp(ser):
        out, j, lv = [], 0, None
        for i, ds in enumerate(dates):
            a = D(ds) + timedelta(days=6)
            if i + 1 < len(dates):
                a = min(a, D(dates[i + 1]) - timedelta(days=1))
            a = a.isoformat()
            while j < len(ser) and ser[j][0] <= a:
                lv = ser[j]; j += 1
            ok = lv is not None and (D(a) - D(lv[0])).days <= 10
            out.append(round(lv[1], 4 if lv[1] < 10 else 2) if ok else None)
        return out

    P = {t: samp(s) for t, s in px.items()}
    mort = [[d, v] for d, v in fred("MORTGAGE30US") if d >= "2000-01-01"]
    t10d = [(d, v) for d, v in fred("DGS10") if d >= "2000-01-01"]
    t10, wk = [], None
    for d, v in t10d:                       # 주 마지막 관측치 + 맨 끝 값
        k = D(d).isocalendar()[:2]
        if k == wk:
            t10[-1] = [d, v]
        else:
            t10.append([d, v]); wk = k
    tar = [(d, v) for d, v in fred("DFEDTAR") if d < "2008-12-16"] + [(d, v) for d, v in fred("DFEDTARU") if d >= "2008-12-16"]
    tar = [(d, v) for d, v in tar if d >= "1999-12-01"]
    fed, cur = [], None
    fed_start = None
    for d, v in tar:
        if d <= "2000-01-01":
            fed_start = v; cur = v; continue
        if cur is not None and abs(v - cur) > 1e-9:
            fed.append([d, cur, v])
        cur = v
    ur = fred("UNRATE"); um = dict(ur)
    pf = dict(fred("PPIFIS")); pg = dict(fred("WPUFD49207"))
    yago = lambda k: f"{int(k[:4]) - 1}{k[4:]}"
    urs = [[k, v, round(v - um[yago(k)], 2) if yago(k) in um else None] for k, v in ur if k >= "2000-01-01"]
    pps = []
    for k in sorted(set(pf) | set(pg)):
        if k < "2000-01-01":
            continue
        src = pf if k >= "2010-11-01" else pg
        if k in src and yago(k) in src:
            pps.append([k, round((src[k] / src[yago(k)] - 1) * 100, 2)])
    data = {"dates": dates, "px": P, "mort": mort, "t10": t10, "fedStart": fed_start, "fed": fed,
            "fedLast": [tar[-1][0], tar[-1][1]], "ur": urs, "ppi": pps}
    with open(F_MAC, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"/* 미국 부동산 · 주가×금리×경기 차트 데이터 — build_us_re.py ({datetime.now(KST):%Y-%m-%d %H:%M} KST) */\n")
        f.write(f"const REM = {json.dumps(data, separators=(',', ':'))};\n")
    return {"weeks": len(dates), "last": last, "ur_last": urs[-1], "ppi_last": pps[-1]}


# ── 금리 사이클 탭(2026-11-05 사용자: "인상·인하·동결 구간을 2000년부터, 그 사이 기준금리·모기지가 몇 bp 움직였는지,
#    기업을 골라 주가를 겹치고, 구간을 고르면 확대, 그 구간 매출·영업이익과 전년 대비") ──
CYC_GAP = 400                 # 같은 방향 결정이 이 일수 안에 다시 나오면 한 사이클(중간 쉼 포함) — 2001~03 인하, 2015~18 인상, 2024~ 인하를 하나로
CYC_SPLIT = {"2020-03-03"}    # 코로나 긴급 인하는 2019년 예방적 인하와 따로 본다


def build_cycles():
    grid = week_grid()
    today = date.today().isoformat()
    tar = [(d, v) for d, v in fred("DFEDTAR") if d < "2008-12-16"] + [(d, v) for d, v in fred("DFEDTARU") if d >= "2008-12-16"]
    tar = [x for x in tar if x[0] >= "1998-12-01"]
    ev, cur = [], None
    for d, v in tar:
        if cur is not None and abs(v - cur) > 1e-9:
            ev.append([d, cur, v])
        cur = v
    mort = [(d, v) for d, v in fred("MORTGAGE30US") if d >= "1998-01-01"]
    t10 = [(d, v) for d, v in fred("DGS10") if d >= "1998-01-01"]
    cyc = []
    for d, a, b in ev:
        dr = 1 if b > a else -1
        c = cyc[-1] if cyc else None
        if c and c["dir"] == dr and d not in CYC_SPLIT and (D(d) - D(c["b"])).days <= CYC_GAP:
            gap = (D(d) - D(c["b"])).days
            if gap >= 120:
                c["pause"].append([c["b"], d])
            c["b"] = d; c["f1"] = b; c["n"] += 1
        else:
            cyc.append({"dir": dr, "a": d, "b": d, "f0": a, "f1": b, "n": 1, "pause": []})
    per = []
    for i, c in enumerate(cyc):
        per.append({"k": "up" if c["dir"] > 0 else "dn", "a": c["a"], "b": c["b"], "f0": c["f0"], "f1": c["f1"], "n": c["n"], "pause": c["pause"]})
        nxt = cyc[i + 1]["a"] if i + 1 < len(cyc) else None
        if nxt is None and (D(today) - D(c["b"])).days < 120:   # 마지막 결정이 4개월 안이면 그 사이클이 진행 중
            per[-1]["b"] = today; per[-1]["open"] = True
            continue
        end = nxt or today
        if (D(end) - D(c["b"])).days >= 30:
            per.append({"k": "hold", "a": c["b"], "b": end, "f0": c["f1"], "f1": c["f1"], "n": 0, "pause": [], "open": nxt is None})

    def at(ser, iso):
        r = None
        for d, v in ser:
            if d <= iso:
                r = (d, v)
            else:
                break
        return r

    def stat(ser, a, b):
        s0, s1 = at(ser, a), at(ser, b)
        ins = [(d, v) for d, v in ser if a <= d <= b]
        if s0:
            ins = [s0] + ins
        hi = max(ins, key=lambda x: x[1]) if ins else None
        lo = min(ins, key=lambda x: x[1]) if ins else None
        pre = at(ser, (D(a) - timedelta(days=182)).isoformat())
        return {"s": s0, "e": s1, "hi": hi, "lo": lo, "pre": pre}

    for p in per:
        p["m"] = stat(mort, p["a"], p["b"])
        p["t"] = stat(t10, p["a"], p["b"])
    fedw = []
    j, lv = 0, tar[0][1]
    for ds in grid:
        a = (D(ds) + timedelta(days=6)).isoformat()
        while j < len(tar) and tar[j][0] <= a:
            lv = tar[j][1]; j += 1
        fedw.append(lv)
    mw = [sig4(v) for v in wsamp(grid, mort)]
    tw = wsamp(grid, t10)
    tick = [[t, NAME_KO.get(t, t), f"{g}: {n}"] for g, n, _, ts in SEG for t in ts]
    data = {"dates": grid, "fed": fedw, "mort": mw, "t10": [None if v is None else round(v, 2) for v in tw],
            "ev": ev, "per": per, "tick": tick, "rangeEra": "2008-12-16",
            "last": {"fed": tar[-1], "mort": mort[-1], "t10": t10[-1]}}
    with open(F_CYC, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"/* 미국 부동산 · 금리 사이클 탭 데이터 — build_usre.py ({datetime.now(KST):%Y-%m-%d %H:%M} KST) */\n")
        f.write(f"const CYC = {json.dumps(data, ensure_ascii=False, separators=(',', ':'))};\n")
    return {"periods": len(per), "weeks": len(grid), "last_fed": tar[-1]}


# ── 판매·매물·집값 탭(2026-11-04 사용자: "신규 판매·기존 매물·기존 판매가 금리 오를 때와 내릴 때 어떻게 다른지,
#    평균 수요가 고금리 때만 잠깐 둔화되는지, 집값이 얼마나 올랐는지") ──
ZILLOW = {"zs": "sales_count_now/Metro_sales_count_now_uc_sfrcondo_month.csv",
          "zi": "invt_fs/Metro_invt_fs_uc_sfrcondo_sm_month.csv",
          "zn": "new_listings/Metro_new_listings_uc_sfrcondo_sm_month.csv",
          # 수급(2026-11-04 사용자: "그런 데이터들도 아래서 다 볼 수 있게") — 사는 쪽·파는 쪽·시장 온도
          "zp": "new_pending/Metro_new_pending_uc_sfrcondo_sm_month.csv",
          "cut": "perc_listings_price_cut/Metro_perc_listings_price_cut_uc_sfrcondo_sm_month.csv",
          "above": "pct_sold_above_list/Metro_pct_sold_above_list_uc_sfrcondo_sm_month.csv",
          "stl": "mean_sale_to_list/Metro_mean_sale_to_list_uc_sfrcondo_sm_month.csv",
          "doz": "med_doz_pending/Metro_med_doz_pending_uc_sfrcondo_sm_month.csv",
          "heat": "market_temp_index/Metro_market_temp_index_uc_sfrcondo_month.csv"}
FHFA_OUT = "https://www.fhfa.gov/document/d/nmdb/nmdb-outstanding-mortgage-statistics-national-census-areas-quarterly.zip"


def fhfa_lock():
    """FHFA 전국 모기지 DB(NMDB) — 남아 있는 모기지 전체의 평균 금리·금리대별 비중(분기). {YYYY-MM(분기 말): {...}}"""
    import zipfile
    z = zipfile.ZipFile(io.BytesIO(get(FHFA_OUT, timeout=120)))
    txt = z.read(z.namelist()[0]).decode("utf-8", "replace")
    out = {}
    for r in csv.DictReader(io.StringIO(txt)):
        if r["GEOLEVEL"] != "National" or r["MARKET"] != "All Mortgages" or r["VALUE1"] in ("", "."):
            continue
        k = f"{r['YEAR']}-{int(r['MONTH']):02d}"
        out.setdefault(k, {})[r["SERIESID"]] = float(r["VALUE1"])
    return out


def zillow_us(path):
    """Zillow Research 공개 CSV 에서 'United States' 줄 → {YYYY-MM: 값}."""
    txt = get("https://files.zillowstatic.com/research/public_csvs/" + path).decode("utf-8", "replace")
    rd = csv.reader(io.StringIO(txt)); h = next(rd)
    for r in rd:
        if len(r) > 2 and r[2] == "United States":
            return {h[i][:7]: float(r[i]) for i in range(5, min(len(h), len(r))) if r[i] not in ("", ".")}
    return {}


def build_demand():
    ym = lambda d: d[:7]

    def ymadd(k, m):
        t = int(k[:4]) * 12 + int(k[5:7]) - 1 + m
        return f"{t // 12}-{t % 12 + 1:02d}"

    def monthly(sid, avg=False):
        o = {}
        for d, v in fred(sid):
            o.setdefault(ym(d), []).append(v)
        return {k: (sum(v) / len(v) if avg else v[-1]) for k, v in o.items()}

    mort = monthly("MORTGAGE30US", avg=True)
    nhs, msa = monthly("HSN1F"), monthly("MSACSR")
    cs, cpi = monthly("CSUSHPINSA"), monthly("CPIAUCSL")
    rl = monthly("ACTLISCOUUS")
    inc = {d[:4]: v for d, v in fred("MEHOINUSA646N")}
    hh = {d[:4]: v for d, v in fred("TTLHH")}
    Z = {}
    for k, p in ZILLOW.items():
        try:
            Z[k] = zillow_us(p)
        except Exception as e:  # Zillow 주소가 바뀌어도 나머지는 만든다
            print("Zillow", k, "실패", e); Z[k] = {}
    zs, zi, zn = Z["zs"], Z["zi"], Z["zn"]
    rnl, rpl, rcut, rdom = monthly("NEWLISCOUUS"), monthly("PENLISCOUUS"), monthly("PRIREDCOUUS"), monthly("MEDDAYONMARUS")
    try:
        LK = fhfa_lock()
    except Exception as e:
        print("FHFA 실패", e); LK = {}

    def roll12(s):
        out = {}
        for k in s:
            ks = [ymadd(k, -i) for i in range(12)]
            if all(x in s for x in ks):
                out[k] = sum(s[x] for x in ks)
        return out

    zs12, zn12 = roll12(zs), roll12(zn)

    def yoy(s, k):
        p = ymadd(k, -12)
        return (s[k] / s[p] - 1) * 100 if k in s and p in s and s[p] else None

    def d12(s, k):
        p = ymadd(k, -12)
        return s[k] - s[p] if k in s and p in s else None

    real = {k: cs[k] / cpi[k] for k in cs if k in cpi}
    r0 = real["2000-01"]
    cs_y = {}
    for k, v in cs.items():
        cs_y.setdefault(k[:4], []).append(v)
    pti0 = statistics.mean(cs_y["2000"]) / inc["2000"]
    pti = {y: round(statistics.mean(v) / inc[y] / pti0 * 100, 1) for y, v in cs_y.items() if y in inc and y >= "2000"}
    last = max(list(nhs) + list(zs) + list(cs))
    months, k = [], "2000-01"
    while k <= last:
        months.append(k); k = ymadd(k, 1)
    r = lambda v, n=1: None if v is None else round(v, n)
    th = lambda v: None if v is None else round(v / 1000, 1)
    ser = {
        "mort": [r(mort.get(m), 2) for m in months],
        "nhs": [nhs.get(m) for m in months],
        "msa": [msa.get(m) for m in months],
        "zs12": [th(zs12.get(m)) for m in months],
        "zn12": [th(zn12.get(m)) for m in months],
        "zi": [th(zi.get(m)) for m in months],
        "rl": [th(rl.get(m)) for m in months],
        "csy": [r(yoy(cs, m)) for m in months],
        "real": [r(real[m] / r0 * 100) if m in real else None for m in months],
        "pti": [pti.get(m[:4]) for m in months],
        "dr": [r(d12(mort, m), 2) for m in months],
    }
    # ── 수급: 파는 사람(신규 매물) vs 사는 사람(신규 계약), 시장 온도, 잠금 효과 ──
    zp = Z["zp"]
    lkq = sorted(LK)
    def lkv(m, f):   # 분기 값을 그 분기 3개월에 채움(계단선)
        q = next((k for k in lkq if k >= m and ymadd(k, -2) <= m), None)
        return f(LK[q]) if q else None
    lt4 = lambda d: round(d.get("PCT_INTRATE_LT_3", 0) + d.get("PCT_INTRATE_3_4", 0), 1)
    pct = lambda a, b: round(a / b * 100, 1) if a is not None and b else None
    ser.update({
        "znm": [th(zn.get(m)) for m in months],
        "zp": [th(zp.get(m)) for m in months],
        "abs": [pct(zp.get(m), zn.get(m)) for m in months],
        "mos": [r(zi[m] / zp[m], 1) if m in zi and zp.get(m) else None for m in months],
        "rnl": [th(rnl.get(m)) for m in months],
        "rpl": [th(rpl.get(m)) for m in months],
        "cut": [r(Z["cut"][m] * 100) if m in Z["cut"] else None for m in months],
        "rcut": [pct(rcut.get(m), rl.get(m)) for m in months],
        "above": [r(Z["above"][m] * 100) if m in Z["above"] else None for m in months],
        "stl": [r(Z["stl"][m] * 100, 2) if m in Z["stl"] else None for m in months],
        "doz": [r(Z["doz"].get(m), 0) for m in months],
        "rdom": [rdom.get(m) for m in months],
        "heat": [r(Z["heat"].get(m), 0) for m in months],
        "lka": [lkv(m, lambda d: d.get("AVE_INTRATE")) for m in months],
        "lt4": [lkv(m, lt4) for m in months],
        "ge6": [lkv(m, lambda d: d.get("PCT_INTRATE_GE_6")) for m in months],
    })
    lock = [{"q": f"{k[:4]}Q{(int(k[5:7]) - 1) // 3 + 1}", "m": k, "ave": d.get("AVE_INTRATE"), "lt3": d.get("PCT_INTRATE_LT_3"),
             "r34": d.get("PCT_INTRATE_3_4"), "r45": d.get("PCT_INTRATE_4_5"), "r56": d.get("PCT_INTRATE_5_6"),
             "ge6": d.get("PCT_INTRATE_GE_6"), "loans": d.get("TOT_LOANS"), "ten11": d.get("PCT_TENURE_11PL"),
             "ltv": d.get("AVE_MTMLTV"),
             "mkt": r(statistics.mean([mort[x] for x in (ymadd(k, -2), ymadd(k, -1), k) if x in mort]), 2)}
            for k, d in sorted(LK.items())]
    # 연도 표
    yrs = []
    for y in range(2000, int(last[:4]) + 1):
        ys = str(y)
        mm = [m for m in months if m[:4] == ys]

        def avg(s):
            v = [s[m] for m in mm if m in s]
            return statistics.mean(v) if v else None

        zm = [zs[m] for m in mm if m in zs]
        znm = [zn[m] for m in mm if m in zn]
        dec = max([m for m in mm if m in cs], default=None)
        rv = [real[m] for m in mm if m in real]
        yrs.append({"y": ys, "mort": r(avg(mort), 2), "nhs": r(avg(nhs), 0),
                    "zs": r(sum(zm) * 12 / len(zm) / 1000, 0) if zm else None, "zsn": len(zm),
                    "zi": r(avg(zi) / 1000, 0) if avg(zi) else None,
                    "zn": r(sum(znm) * 12 / len(znm) / 1000, 0) if znm else None,
                    "rl": r(avg(rl) / 1000, 0) if avg(rl) else None, "msa": r(avg(msa), 1),
                    "csy": r(yoy(cs, dec)) if dec else None, "real": r(statistics.mean(rv) / r0 * 100) if rv else None,
                    "pti": pti.get(ys), "hh": hh.get(ys)})

    # 금리 상승기/하락기 비교(모기지 12개월 변화의 부호) + 시차별 상관
    def regime(s, start, name):
        up, dn, pr = [], [], []
        for k in sorted(s):
            if k < start:
                continue
            dr, g = d12(mort, k), yoy(s, k)
            if dr is None or g is None:
                continue
            pr.append((dr, g)); (up if dr > 0 else dn).append(g)
        if len(pr) < 24:
            return None
        lags = []
        for lag in (0, 3, 6, 9, 12):
            xs, ys2 = [], []
            for k in sorted(s):
                if k < start:
                    continue
                dr, g = d12(mort, ymadd(k, -lag)), yoy(s, k)
                if dr is not None and g is not None:
                    xs.append(dr); ys2.append(g)
            lags.append(round(statistics.correlation(xs, ys2), 2))
        xs, ys2 = zip(*pr)
        return {"name": name, "from": start[:4], "up": r(statistics.median(up)), "nu": len(up), "dn": r(statistics.median(dn)),
                "nd": len(dn), "corr": round(statistics.correlation(xs, ys2), 2), "lags": lags}

    reg = [x for x in [regime(nhs, "1972-01", "신규주택 판매"), regime(nhs, "2009-01", "신규주택 판매"),
                       regime(zs, "2009-01", "전체 판매(Zillow)"), regime(zn, "2019-01", "신규 매물(Zillow)"),
                       regime(zi, "2019-01", "매물 재고(Zillow)"), regime(cs, "1988-01", "집값(케이스-실러)")] if x]
    # 금리 급등(모기지가 1년 새 +1%p 이상) 구간의 신규주택 판매
    ks = sorted(k for k in nhs if k >= "1972-01")
    eps, inep = [], False
    for k in ks:
        dr = d12(mort, k)
        if dr is None:
            continue
        if dr >= 1.0 and not inep:
            eps.append([k, k]); inep = True
        elif dr >= 1.0:
            eps[-1][1] = k
        elif inep:
            inep = False
    mon = lambda a, b: (int(b[:4]) * 12 + int(b[5:7])) - (int(a[:4]) * 12 + int(a[5:7]))
    epi = []
    for a, b in eps:
        pre = [nhs[ymadd(a, -i)] for i in range(1, 13) if ymadd(a, -i) in nhs]
        if not pre:
            continue
        base = statistics.mean(pre)
        win = [k for k in ks if a <= k <= ymadd(b, 12)]
        tk = min(win, key=lambda k: nhs[k])
        rec = next((k for k in ks if k > tk and nhs[k] >= base), None)
        epi.append({"a": a, "b": b, "m0": r(mort.get(ymadd(a, -12)), 1),
                    "m1": r(max(mort[k] for k in ks if a <= k <= b and k in mort), 1),
                    "base": round(base), "low": nhs[tk], "lowAt": tk, "chg": round((nhs[tk] / base - 1) * 100),
                    "rec": rec, "recM": mon(tk, rec) if rec else None})
    # 평균 수요 대비 부족분(2016~19 평균 기준, Zillow 전체 판매)
    basey = [x for x in yrs if x["zs"] and x["zsn"] == 12 and "2016" <= x["y"] <= "2019"]
    base = statistics.mean(x["zs"] for x in basey) if basey else None
    gap = [{"y": x["y"], "zs": x["zs"], "gap": round(x["zs"] - base), "part": x["zsn"] < 12}
           for x in yrs if x["zs"] and x["y"] >= "2020"] if base else []
    # 수급 연도 표(월 평균, 마지막 해는 있는 달까지)
    flow_years = []
    for y in range(2017, int(last[:4]) + 1):   # Realtor.com 은 2016-07부터라 2017년부터
        mm = [m for m in months if m[:4] == str(y)]
        def av(key, nd=1):
            v = [ser[key][months.index(m)] for m in mm if ser[key][months.index(m)] is not None]
            return round(statistics.mean(v), nd) if v else None
        flow_years.append({"y": str(y), "n": len([m for m in mm if m in zp]), "znm": av("znm"), "zp": av("zp"), "abs": av("abs"),
                           "mos": av("mos"), "cut": av("cut"), "above": av("above"), "stl": av("stl", 2), "doz": av("doz", 0),
                           "rdom": av("rdom", 0), "heat": av("heat", 0),
                           "rnl": av("rnl"), "rpl": av("rpl"), "rcut": av("rcut")})
    # 집값
    lk = max(real)
    pk = max((k for k in real if "2022-01" <= k <= "2023-12"), key=lambda k: real[k])
    price = {"last": lk, "nom19": r((cs[lk] / cs["2019-12"] - 1) * 100, 0), "real19": r((real[lk] / real["2019-12"] - 1) * 100, 0),
             "peak": pk, "nomPk": r((cs[lk] / cs[pk] - 1) * 100), "realPk": r((real[lk] / real[pk] - 1) * 100),
             "real06": r((real[lk] / real["2006-07"] - 1) * 100, 0)}
    data = {"months": [m + "-01" for m in months], "s": ser, "years": yrs, "regime": reg, "episodes": epi,
            "base": r(base, 0), "gap": gap, "price": price,
            "lock": lock, "flowYears": flow_years}
    with open(F_DEM, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"/* 미국 부동산 · 판매·매물·집값 데이터 — build_usre.py ({datetime.now(KST):%Y-%m-%d %H:%M} KST) */\n")
        f.write(f"const RED = {json.dumps(data, ensure_ascii=False, separators=(',', ':'))};\n")
    return {"months": len(months), "last": last, "zillow": {k: len(v) for k, v in Z.items()}}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        d = build_demand(); print("판매·매물·집값", d)
    except Exception as e:   # 이 탭이 실패해도 나머지는 만든다
        d = {"error": str(e)[:200]}; print("판매·매물·집값 실패", e)
    m = build_macro(); print("차트", m)
    try:
        c = build_cycles(); print("금리 사이클", c)
    except Exception as e:
        c = {"error": str(e)[:200]}; print("금리 사이클 실패", e)
    s = build_screener(); print("스크리너", s)
    meta = {"updated": datetime.now(KST).isoformat(timespec="minutes"), "screener": s, "macro": m, "demand": d, "cycle": c}
    json.dump(meta, open(META, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump({"updated": meta["updated"], "bars": {}}, open(OUT / "px_recent.json", "w", encoding="utf-8"))   # 화면이 찾는 파일(매일 이어 붙이기는 아직 없음)
    for p in (F_SCR, F_MAC, F_DEM, F_CYC):
        print(p.name, round(p.stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
