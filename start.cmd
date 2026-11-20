@echo off
REM echo-show-doom. Desktop: start.cmd   Echo: start.cmd --tunnel --tunnel-protocol http2
cd /d "%~dp0"
node server.js %*
pause
