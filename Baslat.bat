@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi. Kurmak icin: winget install OpenJS.NodeJS.LTS
  pause
  exit /b
)
start "" http://localhost:5170
title Mod Yoneticisi - http://localhost:5170
node server.js
pause
