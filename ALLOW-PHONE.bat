@echo off
title ChurchConnect - Allow phone access (port 4000)
net session >nul 2>&1
if %errorlevel% neq 0 (
  copy /y "%~f0" "%TEMP%\allow-phone.bat" >nul
  echo Requesting administrator permission...
  powershell -Command "Start-Process -FilePath '%TEMP%\allow-phone.bat' -Verb RunAs"
  exit /b
)
netsh advfirewall firewall delete rule name="ChurchConnect 4000" >nul 2>&1
netsh advfirewall firewall add rule name="ChurchConnect 4000" dir=in action=allow protocol=TCP localport=4000
echo.
echo Done! Your phone can now reach the app at http://192.168.1.101:4000
echo If the server is not running, double-click START-APP.bat first.
pause
