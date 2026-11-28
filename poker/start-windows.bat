@echo off
chcp 65001 > nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js 가 필요합니다.
  echo   https://nodejs.org 에서 LTS 버전을 설치한 뒤 이 파일을 다시 실행하세요.
  echo.
  start https://nodejs.org
  pause
  exit /b
)
node server.js
pause
