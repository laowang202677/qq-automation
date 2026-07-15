@echo off
node server.js
if %errorlevel% neq 0 (
    echo Node.js not found. Please install Node.js from https://nodejs.org
    pause
    exit /b
)
pause
