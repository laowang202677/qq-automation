@echo off
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js not found. Please install Node.js first.
    pause
    exit /b
)
call npx @yao-pkg/pkg server.js --targets node18-win-x64 --output QQ_Automation.exe
if exist QQ_Automation.exe (
    echo Success! QQ_Automation.exe created.
) else (
    echo Build failed.
)
pause
