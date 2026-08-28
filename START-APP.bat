@echo off
title Church 2.0 - App Launcher
echo Starting Church 2.0 backend on http://localhost:4000 ...
start "Church 2.0 Backend" cmd /k "cd /d %~dp0server && npm start"
timeout /t 5 /nobreak >nul
echo Opening the app in your browser...
start http://localhost:4000
echo Done. Keep the black backend window open. Close it to stop the app.
