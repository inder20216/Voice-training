@echo off
title AI Training Coach

echo ====================================
echo   AI Training Coach - Starting...
echo ====================================
echo.

:: Check if node is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Download from https://nodejs.org
    pause
    exit /b
)

:: Check if .env file exists
if not exist ".env" (
    echo WARNING: .env file not found.
    echo Create a .env file with: OPENAI_API_KEY=sk-...
    echo.
    pause
    exit /b
)

:: Start server in background
echo Starting server...
start /b node server.js

:: Wait 2 seconds for server to boot
timeout /t 2 /nobreak >nul

:: Open browser
echo Opening browser at http://localhost:3000
start "" "http://localhost:3000"

echo.
echo ====================================
echo   Server running at localhost:3000
echo   Press any key to STOP the server
echo ====================================
echo.
pause >nul

:: Kill node on exit
taskkill /f /im node.exe >nul 2>&1
echo Server stopped. Goodbye!
timeout /t 2 /nobreak >nul
