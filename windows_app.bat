@echo off
cd /d "%~dp0"
echo Building Docker image...
docker build -t notebook-app .
if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b
)

echo.
echo Build finished. Starting application...
echo Opening browser in 3 seconds...
start /b cmd /c "timeout /t 3 >nul & start http://localhost:8005"
docker-compose up -d

exit
