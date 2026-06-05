@echo off
title Start CCTV Bridge for Smart Farm Website
color 0A

echo ============================================
echo   SMART FARM CCTV STARTER
echo ============================================
echo.

set PROJECT_DIR=D:\TEEP-smart-farm-growth-monitoring
set CCTV_BRIDGE_DIR=%PROJECT_DIR%\cctv-bridge
set WEB_URL=https://smart-farm-growth-monitoring.vercel.app
set CCTV_LOCAL_URL=http://localhost:5001/cctv.jpg
set CCTV_NGROK_DOMAIN=https://credible-ceremony-species.ngrok-free.dev/cctv.jpg

echo Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js belum terinstall atau belum masuk PATH.
    pause
    exit /b
)

echo Checking ngrok...
where ngrok >nul 2>nul
if errorlevel 1 (
    echo ERROR: ngrok belum terinstall atau belum masuk PATH.
    pause
    exit /b
)

echo.
echo Starting CCTV bridge...
start "CCTV Bridge - Node Server" cmd /k "cd /d %CCTV_BRIDGE_DIR% && node server.js"

echo Waiting for CCTV bridge to start...
timeout /t 5 /nobreak >nul

echo.
echo Starting ngrok tunnel...
start "CCTV Ngrok Tunnel" cmd /k "ngrok http 5001"

echo Waiting for ngrok...
timeout /t 5 /nobreak >nul

echo.
echo Opening test pages...
start "" "%CCTV_LOCAL_URL%"
timeout /t 2 /nobreak >nul
start "" "%CCTV_NGROK_DOMAIN%"
timeout /t 2 /nobreak >nul
start "" "%WEB_URL%"

echo.
echo ============================================
echo CCTV system started.
echo.
echo Keep these windows open:
echo 1. CCTV Bridge - Node Server
echo 2. CCTV Ngrok Tunnel
echo.
echo If one of them is closed, CCTV on Vercel may stop.
echo ============================================
echo.
pause