@echo off
chcp 65001 >nul
rem Japan screening prices (board, 5y charts), returns, screening numbers. Task Scheduler: daily 10:00 14:00 16:30 (2026-11-23). No Claude tokens.
cd /d "%~dp0.."
python tools\gpush.py --pull
python -X utf8 tools\build_px.py || exit /b 1
python -X utf8 tools\build_ret.py --force
python -X utf8 tools\build_scr.py
python -X utf8 tools\build_jx.py
python -X utf8 tools\gpush.py "data: 일본 스크리닝 주가·수익률" docs/data/jp/px docs/data/jp/ret.json docs/data/jp/scr.json docs/data/jp/jx.json tools/px_shares.json
