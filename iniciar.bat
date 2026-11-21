@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado.
  echo Baixe a versao LTS em https://nodejs.org e instale. Depois abra este arquivo de novo.
  echo Ou use o StreamBeats - TwitchSongRequest.exe, que nao precisa de Node.js.
  pause
  exit /b
)
rem Abre o app escondido: so o painel aparece. Para desligar, use o botao Desligar do painel.
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0ferramentas\iniciar-oculto.ps1"
