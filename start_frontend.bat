@echo off
cd /d %~dp0\frontend
echo Demarrage du frontend KELIA Migration IA...
echo.
call npm install
echo.
call npm run dev
pause
