@echo off
rem 일본 스크리닝 주가(판·5년 차트)·주가 수익률·스크리닝 숫자 — 윈도 작업 스케줄러가 매일 10:00·14:00·16:30 부름(2026-11-23 사용자). 클로드 토큰 안 씀.
chcp 65001 >nul
cd /d "%~dp0.."
python tools\gpush.py --pull
python -X utf8 tools\build_px.py || exit /b 1
python -X utf8 tools\build_ret.py --force
python -X utf8 tools\build_scr.py
python -X utf8 tools\gpush.py "data: 일본 스크리닝 주가·수익률" docs/data/jp/px docs/data/jp/ret.json docs/data/jp/scr.json tools/px_shares.json
