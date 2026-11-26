@echo off
chcp 65001 >nul
rem Japan all-stock board (new high, near, turnaround, limit-up), sectors, earnings calendar, last report dates. Task Scheduler: daily 09-16 hourly (2026-11-23). No Claude tokens.
cd /d "%~dp0.."
python tools\gpush.py --pull
python -X utf8 tools\build_pxall.py || exit /b 1
python -X utf8 tools\build_cal.py
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format \"yyyy-MM-dd HH:mm\""') do set NOW=%%t
python -X utf8 tools\gpush.py "data: 일본 주요 전 종목 판·캘린더 %NOW% KST" docs/data/jp/pxall docs/data/jp/cal.json docs/data/jp/sectors.json docs/data/jp/ann.json docs/data/jp/kq.json
