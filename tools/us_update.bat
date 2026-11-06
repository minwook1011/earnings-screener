@echo off
rem 미국 전체 종목·미국 실적 캘린더 갱신 — 노트북 윈도 작업 스케줄러가 부름(2026-11-06). 클로드 토큰 안 씀.
chcp 65001 >nul
cd /d "%~dp0.."
python tools\gpush.py --pull
python -X utf8 tools\build_us.py || exit /b 1
python -X utf8 tools\gpush.py "data: 미국 전체 종목·실적 캘린더 갱신" docs/data/us/all.json docs/data/us/cal.json tools/us_shares.json
