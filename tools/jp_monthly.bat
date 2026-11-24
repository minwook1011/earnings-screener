@echo off
rem 월차 탭(월차 내는 회사 전부·24개월) — 윈도 작업 스케줄러가 매일 09:00·14:00 부름(2026-11-24 사용자). 원장은 100억 저장소(매일 18:30~19:05 갱신). 클로드 토큰 안 씀.
chcp 65001 >nul
cd /d "%~dp0.."
python tools\gpush.py --pull
python -X utf8 tools\build_monthly.py || exit /b 1
python -X utf8 tools\gpush.py "data: 월차 갱신" docs/data/jp/monthly
