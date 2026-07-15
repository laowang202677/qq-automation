@echo off
where node >nul 2>&1
if %errorlevel% equ 0 (
    start "" http://localhost:3456
    node server.js
    pause
    exit /b
)
start https://nodejs.org
echo Node.js not found. Please install Node.js first.
pause
