@echo off
title Stop CCTV Bridge for Smart Farm Website
color 0C

echo ============================================
echo   STOP SMART FARM CCTV
echo ============================================
echo.

echo Stopping node.exe...
taskkill /F /IM node.exe

echo.
echo Stopping ngrok.exe...
taskkill /F /IM ngrok.exe

echo.
echo CCTV bridge and ngrok stopped.
echo.
pause