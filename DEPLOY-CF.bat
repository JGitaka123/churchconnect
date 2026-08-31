@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DEPLOY-CF.ps1"
if errorlevel 1 (
  echo.
  echo  DEPLOY FAILED - read the error above, fix it, then run again.
  pause
  exit /b 1
)