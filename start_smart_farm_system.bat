@echo off
title Start Smart Farm Full System
color 0A

set "PROJECT_DIR=D:\TEEP-smart-farm-growth-monitoring"

set "WEB_DIR=%PROJECT_DIR%\web-dashboard"
set "SUPABASE_BRIDGE_DIR=%PROJECT_DIR%\supabase-bridge"
set "CCTV_BRIDGE_DIR=%PROJECT_DIR%\cctv-bridge"
set "THINGSBOARD_DIR=%PROJECT_DIR%\thingsboard"

set "DASHBOARD_URL=http://localhost:5173/"
set "THINGSBOARD_URL=http://localhost:8080"
set "CCTV_BACKEND_URL=http://localhost:3001"
set "CCTV_BACKEND_PORT=3001"

echo ==========================================
echo      STARTING SMART FARM FULL SYSTEM
echo ==========================================
echo.

echo Project folder:
echo %PROJECT_DIR%
echo.

REM ============================================================
REM CHECK PROJECT FOLDER
REM ============================================================

if not exist "%PROJECT_DIR%" (
  echo [ERROR] Project folder tidak ditemukan:
  echo %PROJECT_DIR%
  echo.
  pause
  exit /b
)

REM ============================================================
REM CHECK NODE JS
REM ============================================================

echo [CHECK] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js belum terinstall atau belum masuk PATH.
  echo Install Node.js dulu, lalu jalankan ulang file ini.
  echo.
  pause
  exit /b
)
echo [OK] Node.js detected.
echo.

echo [CHECK] Checking npm...
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm belum terinstall atau belum masuk PATH.
  echo.
  pause
  exit /b
)
echo [OK] npm detected.
echo.

REM ============================================================
REM START THINGSBOARD IF DOCKER COMPOSE EXISTS
REM ============================================================

echo [CHECK] Checking ThingsBoard...
powershell -Command "try { Invoke-WebRequest -Uri '%THINGSBOARD_URL%' -UseBasicParsing -TimeoutSec 5 | Out-Null; exit 0 } catch { exit 1 }"

if errorlevel 1 (
  echo [WARNING] ThingsBoard belum terdeteksi di:
  echo %THINGSBOARD_URL%
  echo.

  where docker >nul 2>nul
  if errorlevel 1 (
    echo [WARNING] Docker tidak terdeteksi dari CMD.
    echo Pastikan Docker Desktop sudah menyala jika ThingsBoard memakai Docker.
    echo Sistem lain tetap akan dijalankan.
    echo.
  ) else (
    echo [INFO] Docker terdeteksi.

    if exist "%THINGSBOARD_DIR%\docker-compose.yml" (
      echo [INFO] Menjalankan ThingsBoard Docker Compose...
      start "ThingsBoard Docker" /D "%THINGSBOARD_DIR%" cmd /k "docker compose up -d"
      echo Waiting ThingsBoard to start...
      timeout /t 10 /nobreak >nul
    ) else (
      echo [WARNING] docker-compose.yml tidak ditemukan di:
      echo %THINGSBOARD_DIR%
      echo Lewati auto-start ThingsBoard.
      echo.
    )
  )
) else (
  echo [OK] ThingsBoard detected.
)

echo.

REM ============================================================
REM START REACT WEB DASHBOARD
REM ============================================================

echo [1/6] Starting React Web Dashboard...

if not exist "%WEB_DIR%\package.json" (
  echo [ERROR] package.json tidak ditemukan di:
  echo %WEB_DIR%
  echo.
) else (
  start "Smart Farm Web Dashboard" /D "%WEB_DIR%" cmd /k "npm run dev -- --host 0.0.0.0"
)

timeout /t 4 /nobreak >nul

REM ============================================================
REM START TELEMETRY BRIDGE
REM ============================================================

echo.
echo [2/6] Starting Telemetry Bridge: ThingsBoard to Supabase...

if not exist "%SUPABASE_BRIDGE_DIR%\bridge.js" (
  echo [WARNING] bridge.js tidak ditemukan di:
  echo %SUPABASE_BRIDGE_DIR%
  echo Telemetry Bridge dilewati.
) else (
  start "Telemetry Bridge" /D "%SUPABASE_BRIDGE_DIR%" cmd /k "node bridge.js"
)

timeout /t 3 /nobreak >nul

REM ============================================================
REM START COMMAND BRIDGE
REM ============================================================

echo.
echo [3/6] Starting Command Bridge: Supabase to ThingsBoard...

if not exist "%SUPABASE_BRIDGE_DIR%\command_bridge.cjs" (
  echo [WARNING] command_bridge.cjs tidak ditemukan di:
  echo %SUPABASE_BRIDGE_DIR%
  echo Command Bridge dilewati.
) else (
  start "Command Bridge" /D "%SUPABASE_BRIDGE_DIR%" cmd /k "node command_bridge.cjs"
)

timeout /t 3 /nobreak >nul

REM ============================================================
REM START CCTV / ESP32-CAM BACKEND
REM ============================================================

echo.
echo [4/6] Starting CCTV / ESP32-CAM Backend...

if not exist "%CCTV_BRIDGE_DIR%\server.js" (
  echo [ERROR] server.js tidak ditemukan di:
  echo %CCTV_BRIDGE_DIR%
  echo CCTV / ESP32-CAM Backend tidak bisa dijalankan.
) else (
  start "CCTV ESP32-CAM Backend" /D "%CCTV_BRIDGE_DIR%" cmd /k "node server.js"
)

timeout /t 5 /nobreak >nul

REM ============================================================
REM START CLOUDFLARE TUNNEL
REM ============================================================

echo.
echo [5/6] Starting Cloudflare Tunnel for CCTV / ESP32-CAM Backend...

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [WARNING] cloudflared tidak ditemukan.
  echo Cloudflare Tunnel dilewati.
  echo.
  echo Kalau ingin link online trycloudflare, install cloudflared dulu.
) else (
  echo.
  echo Cloudflare akan membuat link seperti:
  echo https://xxxxx.trycloudflare.com
  echo.
  echo Gunakan link tersebut untuk:
  echo https://xxxxx.trycloudflare.com/esp32cam.jpg
  echo https://xxxxx.trycloudflare.com/api/cctv-proxy
  echo.
  start "Cloudflare Tunnel - CCTV Backend" cmd /k "cloudflared tunnel --url http://localhost:%CCTV_BACKEND_PORT%"
)

timeout /t 3 /nobreak >nul

REM ============================================================
REM OPEN DASHBOARD
REM ============================================================

echo.
echo [6/6] Opening dashboard...

start "" "%DASHBOARD_URL%"

echo.
echo ==========================================
echo SMART FARM FULL SYSTEM STARTED
echo ==========================================
echo.
echo Keep these terminal windows open:
echo - Smart Farm Web Dashboard
echo - Telemetry Bridge
echo - Command Bridge
echo - CCTV ESP32-CAM Backend
echo - Cloudflare Tunnel
echo.
echo Dashboard:
echo %DASHBOARD_URL%
echo.
echo ThingsBoard:
echo %THINGSBOARD_URL%
echo.
echo CCTV / ESP32-CAM local backend:
echo %CCTV_BACKEND_URL%
echo.
echo Cloudflare:
echo Lihat link trycloudflare di window "Cloudflare Tunnel - CCTV Backend"
echo.
echo Jika Cloudflare window ditutup, link online akan mati dan bisa muncul Error 1033.
echo ==========================================
echo.

pause