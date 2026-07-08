@echo off
echo ==========================================
echo  KELIA Migration IA - Demarrage
echo ==========================================
echo.

echo [1/2] Demarrage du backend (port 8000)...
start "KELIA Backend" cmd /k "cd /d %~dp0backend && py -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

echo [2/2] Demarrage du frontend (port 3000)...
start "KELIA Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Les deux serveurs demarrent dans des fenetres separees.
echo Backend  : http://localhost:8000/api/docs
echo Frontend : http://localhost:3000
echo.
timeout /t 5 /nobreak >nul
start "" "http://localhost:3000"
