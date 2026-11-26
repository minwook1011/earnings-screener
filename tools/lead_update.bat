@echo off
chcp 65001 >nul
rem Lead indicators. Task Scheduler: daily 10:00 14:00 16:30 (2026-11-23). Pension values re-read only when their update date changes, prices daily. No Claude tokens.
cd /d "%~dp0.."
python tools\gpush.py --pull
python tools\lead_update.py --push >> tools\lead_update.log 2>&1
