@echo off
cd /d "%~dp0"
echo Starting Docker Desktop...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"

echo Waiting for Docker to start...
:check_docker
docker info >nul 2>&1
if %errorlevel% equ 0 goto docker_ready

echo Docker is not ready yet...
timeout /t 5 >nul
goto check_docker

:docker_ready

echo Docker is ready!
echo Checking if Docker image exists...
docker inspect --type=image notebook-app >nul 2>&1
if %errorlevel% neq 0 (
    echo Image 'notebook-app' not found. Building...
    docker build -t notebook-app .
    if %errorlevel% neq 0 (
        echo Build failed!
        pause
        exit /b
    )
) else (
    echo Image 'notebook-app' found. Skipping build.
)

echo.
echo Build finished. Starting application...
echo Opening browser in 3 seconds...
start /b cmd /c "timeout /t 3 >nul & start http://localhost:8005"
docker-compose up -d --no-build

exit
