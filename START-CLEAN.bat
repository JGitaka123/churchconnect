@echo off
title ChurchConnect - restart on port 4000
cd /d "%~dp0"

echo Stopping anything still holding port 4000...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%P >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo Starting the ChurchConnect server...
call npm start