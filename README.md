# 실적발표스크리너

실적 발표 기업을 4단계로 걸러 보는 공개 사이트. 지금은 일본 탭만 동작하고, 미국·한국은 준비 중이다.

주소: https://minwook1011.github.io/earnings-screener/

| 단계 | 뜻 | 기업이 들어오는 길 | 붙는 자료 |
|---|---|---|---|
| 1단계 · 퀵 | 실적 발표 기업 전체 | 실적 발표 자료(VANTAGE) + 텔레 1단계 카드 | 발표 숫자·주가 반응·평가 |
| 2단계 · 분석 | 볼 후보 | 텔레 1단계 카드의 [볼 후보] | 텔레 2단계 카드(AI 렌즈) + **2단계 실적 분석 리서치** |
| 3단계 · 딥 | 다 같이 깊게 볼 회사 | 텔레 2단계 카드의 [3단계로] | **3단계 딥 리포트** |
| 4단계 · 결정 | 사기 직전 좋은 종목 — 살지 말지 결정 | 텔레 3단계에서 올림 | 결정 메모 |

단계 이동은 우리 텔레그램 그룹(친구 봇)에서 한다. 이 사이트는 그 그룹의 토픽을 읽어 그대로 보여 준다.

## 데이터 흐름

```
VANTAGE 일본 실적(C:\dev\vantage-0910) ──build_stage1.py──▶ docs/data/jp/stage1.json
텔레그램 그룹 토픽 2·4·6·72 ──(읽기 도구로 저장)──▶ tools/tg_raw/*.json ──tg_parse.py──▶ docs/data/jp/pipeline.json
pipeline.json ──research_queue.py──▶ 대기열(research/index.json) ──리서치 스킬──▶ research/<코드>/stage2.md·stage3.md
```

자세한 실행 순서는 [OPERATIONS.md](OPERATIONS.md).

## 공개 사이트 원칙

- 저장소가 공개다. 텔레그램 원문(tools/tg_raw)·봇 토큰·팀원 이름·그룹 번호는 올리지 않는다. 자세한 건 [OPERATIONS.md](OPERATIONS.md)의 '보안'.
- 카드 내용은 회사·숫자·분석만 옮긴다. '볼 후보 취소'를 누가 했는지는 싣지 않는다.
