@echo off
chcp 65001 >nul
rem Monthly tab (all companies, 24 months). Task Scheduler: daily 09:00 14:00 (2026-11-24). Ledger = 100eok repo (updated 18:30-19:05). No Claude tokens.
cd /d "%~dp0.."
python tools\gpush.py --pull
python -X utf8 tools\build_monthly.py || exit /b 1
python -X utf8 tools\gpush.py "data: 월차 갱신" docs/data/jp/monthly
