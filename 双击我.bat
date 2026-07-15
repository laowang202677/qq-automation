@echo off
set PATH=%~dp0node-win;%PATH%
start "" http://localhost:3456
node server.js
pause
