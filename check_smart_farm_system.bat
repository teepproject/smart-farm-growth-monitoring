@echo off
title Check Smart Farm System

set THINGSBOARD_URL=http://localhost:8080
set DASHBOARD_URL=http://localhost:5173/

echo ==========================================
echo Smart Farm System Check
echo ==========================================
echo.

echo [1] Checking ThingsBoard...
powershell -Command "try { Invoke-WebRequest -Uri '%THINGSBOARD_URL%' -UseBasicParsing -TimeoutSec 5 | Out-Null; Write-Host '[OK] ThingsBoard reachable'; exit 0 } catch { Write-Host '[ERROR] ThingsBoard not reachable'; exit 1 }"

echo.
echo [2] Checking Dashboard...
powershell -Command "try { Invoke-WebRequest -Uri '%DASHBOARD_URL%' -UseBasicParsing -TimeoutSec 5 | Out-Null; Write-Host '[OK] Dashboard reachable'; exit 0 } catch { Write-Host '[ERROR] Dashboard not reachable'; exit 1 }"

echo.
echo [3] Running Node processes:
tasklist | findstr node.exe

echo.
echo ==========================================
echo Check completed.
echo ==========================================
pause