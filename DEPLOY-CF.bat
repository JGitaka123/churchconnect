@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   ChurchConnect - Cloudflare Pages one-click deploy
echo ============================================================
echo.
echo Deploys the app + API to https://churchconnect.pages.dev
echo directly from this PC - no GitHub Actions needed.
echo.
echo Have ready:
echo   - Your Neon database URL (free at https://neon.tech)
echo     e.g. postgresql://user:pass@ep-xxx.region.aws.neon.tech/db?sslmode=require
echo.
pause

echo.
echo [1/5] Installing dependencies...
call npm install
if errorlevel 1 goto :err
pushd server
call npm install
if errorlevel 1 goto :err
popd

echo.
echo [2/5] Building SPA + API worker into dist/...
call npm run build
if errorlevel 1 goto :err

echo.
echo [3/5] Logging into Cloudflare (browser will open)...
call npx --yes wrangler@4 login
if errorlevel 1 goto :err

echo.
echo [4/5] Creating the Pages project (first time only)...
call npx --yes wrangler@4 pages project create churchconnect --production-branch main
echo   (an "already exists" message here is fine - continuing)

echo.
echo [5/5] Setting environment secrets and deploying...
set /p DATABASE_URL=Neon connection string: 
if "%DATABASE_URL%"=="" goto :err
echo %DATABASE_URL%| call npx --yes wrangler@4 pages secret put DATABASE_URL --project-name churchconnect
echo neon| call npx --yes wrangler@4 pages secret put DB_DRIVER --project-name churchconnect
echo production| call npx --yes wrangler@4 pages secret put NODE_ENV --project-name churchconnect
echo 4| call npx --yes wrangler@4 pages secret put BCRYPT_ROUNDS --project-name churchconnect
echo https://churchconnect.pages.dev| call npx --yes wrangler@4 pages secret put CORS_ORIGINS --project-name churchconnect
set /p JWT_SECRET=JWT secret (press Enter to auto-generate): 
if "%JWT_SECRET%"=="" for /f %%i in ('node -e "console.log(require('"'"'crypto'"'"').randomBytes(48).toString('"'"'hex'"'"'))"') do set JWT_SECRET=%%i
echo %JWT_SECRET%| call npx --yes wrangler@4 pages secret put JWT_SECRET --project-name churchconnect

echo.
echo Deploying...
call npx --yes wrangler@4 pages deploy dist --project-name churchconnect --branch main
if errorlevel 1 goto :err

echo.
echo ============================================================
echo  DONE - test it now:
echo    https://churchconnect.pages.dev/api/health
echo  should return: {"status":"ok","db":"up"}
echo ============================================================
pause
exit /b 0

:err
echo.
echo  DEPLOY FAILED - read the error above, fix it, then run again.
pause
exit /b 1