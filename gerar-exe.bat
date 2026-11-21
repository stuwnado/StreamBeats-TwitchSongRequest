@echo off
title Gerar StreamBeats
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0gerar-exe.ps1"
echo.
pause
