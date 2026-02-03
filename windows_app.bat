@echo off
cd /d "%~dp0"
echo Building Docker image...
docker build -t notebook-app .
echo.
echo Build finished. Starting application...
docker-compose up
pause
