@echo off
rem 선행지표 갱신 — 윈도 작업 스케줄러가 매일 10:00·14:00·16:30 부름(2026-11-23 사용자 — 하루 세 번). 연금기구 값은 갱신일(매달 둘째 영업일 무렵)이 바뀐 날만 새로 조회, 주가는 매일. 클로드 토큰 안 씀.
chcp 65001 >nul
cd /d "%~dp0.."
python tools\gpush.py --pull
python tools\lead_update.py --push >> tools\lead_update.log 2>&1
