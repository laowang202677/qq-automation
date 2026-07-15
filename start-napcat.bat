@echo off
cd napcat
start /B "" node loadNapCat.cjs
cd ..
start /B "" node server.js
timeout /t 2 /nobreak >nul
start http://localhost:3456
echo Management: http://localhost:3456
pause
