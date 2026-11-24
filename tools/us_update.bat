@echo off
rem 미국 전체 종목·미국 실적 캘린더·미국 부동산 갱신 — 윈도 작업 스케줄러가 매일 08·15·20·24·04시 부름(2026-11-23 사용자). 클로드 토큰 안 씀.
chcp 65001 >nul
cd /d "%~dp0.."
python tools\gpush.py --pull
python -X utf8 tools\build_us.py || exit /b 1
python -X utf8 tools\build_usre.py
python -X utf8 tools\gpush.py "data: 미국 전체 종목·실적 캘린더·부동산 갱신" docs/data/us/all.json docs/data/us/cal.json tools/us_shares.json docs/data/usre
