@echo off
title Stop Smart Farm System

echo ==========================================
echo Stopping Smart Farm Node Processes
echo ==========================================
echo.

taskkill /F /IM node.exe

echo.
echo All Node.js processes stopped.
echo.
pause