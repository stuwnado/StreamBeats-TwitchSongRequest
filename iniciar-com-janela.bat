@echo off
chcp 65001 >nul
title StreamBeats - TwitchSongRequest (modo de teste, com janela)
cd /d "%~dp0"
rem Igual ao iniciar, mas mostra a janela preta com tudo que o app faz. Bom pra achar problemas.
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado. Baixe a versao LTS em https://nodejs.org
  pause
  exit /b
)
node streambeats.js
echo.
pause
