@echo off
title Start Smart Farm System

set PROJECT_DIR=D:\TEEP-smart-farm-growth-monitoring
set WEB_DIR=%PROJECT_DIR%\web-dashboard
set BRIDGE_DIR=%PROJECT_DIR%\supabase-bridge
set DASHBOARD_URL=http://localhost:5173/
set THINGSBOARD_URL=http://localhost:8080

echo ==========================================
echo Starting Smart Farm Monitoring System
echo ==========================================
echo.

echo [CHECK] Checking ThingsBoard...
powershell -Command "try { Invoke-WebRequest -Uri '%THINGSBOARD_URL%' -UseBasicParsing -TimeoutSec 5 | Out-Null; exit 0 } catch { exit 1 }"

if errorlevel 1 (
  echo.
  echo [WARNING] ThingsBoard tidak terdeteksi di:
  echo %THINGSBOARD_URL%
  echo.
  echo Pastikan Docker/ThingsBoard sudah running.
  echo Coba buka di browser:
  echo %THINGSBOARD_URL%
  echo.
  echo Sistem tetap akan dijalankan, tapi bridge mungkin error kalau ThingsBoard mati.
  echo.
  pause
) else (
  echo [OK] ThingsBoard detected.
)

echo.
echo [1/3] Starting React Web Dashboard...
start "Smart Farm Web Dashboard" cmd /k "cd /d %WEB_DIR% && npm run dev"

timeout /t 4 >nul

echo.
echo [2/3] Starting Telemetry Bridge: ThingsBoard to Supabase...
start "Telemetry Bridge" cmd /k "cd /d %BRIDGE_DIR% && node bridge.js"

timeout /t 4 >nul

echo.
echo [3/3] Starting Command Bridge: Supabase to ThingsBoard...
start "Command Bridge" cmd /k "cd /d %BRIDGE_DIR% && node command_bridge.cjs"

timeout /t 4 >nul

echo.
echo [OPEN] Opening dashboard...
start %DASHBOARD_URL%

echo.
echo ==========================================
echo Smart Farm System started.
echo.
echo Keep these terminal windows open:
echo - Smart Farm Web Dashboard
echo - Telemetry Bridge
echo - Command Bridge
echo.
echo Dashboard:
echo %DASHBOARD_URL%
echo.
echo ThingsBoard:
echo %THINGSBOARD_URL%
echo ==========================================
echo.

pause