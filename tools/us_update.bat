@echo off
chcp 65001 >nul
rem US all stocks, US earnings calendar, US real estate. Task Scheduler: daily 08 15 20 24 04 (2026-11-23). No Claude tokens.
cd /d "%~dp0.."
python tools\gpush.py --pull
python -X utf8 tools\build_us.py || exit /b 1
python -X utf8 tools\build_usre.py
python -X utf8 tools\gpush.py "data: 미국 전체 종목·실적 캘린더·부동산 갱신" docs/data/us/all.json docs/data/us/cal.json tools/us_shares.json docs/data/usre
