@echo off
rem 일본 주요 전 종목 판(신고가·근접·턴어라운드·상한가)·섹터·실적 캘린더·최근 발표일 — 윈도 작업 스케줄러가 매일 9~16시 매시 부름(2026-11-23 사용자). 클로드 토큰 안 씀.
chcp 65001 >nul
cd /d "%~dp0.."
python tools\gpush.py --pull
python -X utf8 tools\build_pxall.py || exit /b 1
python -X utf8 tools\build_cal.py
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format \"yyyy-MM-dd HH:mm\""') do set NOW=%%t
python -X utf8 tools\gpush.py "data: 일본 주요 전 종목 판·캘린더 %NOW% KST" docs/data/jp/pxall docs/data/jp/cal.json docs/data/jp/sectors.json docs/data/jp/ann.json docs/data/jp/kq.json
