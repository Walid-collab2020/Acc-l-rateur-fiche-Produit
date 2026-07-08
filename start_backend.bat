@echo off
cd /d %~dp0\backend
echo Demarrage du backend KELIA Migration IA...
echo.
py -m pip install -r requirements.txt
echo.
py -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
pause
