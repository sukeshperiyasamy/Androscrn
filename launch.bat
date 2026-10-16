@echo off
setlocal
title AndroScrn Launcher

echo ========================================================
echo                 ANDROSCRN CONTROL PLATFORM              
echo ========================================================
echo Starting AndroScrn desktop application...

set "ANDROSCRN_ROOT=%~dp0"
set "PATH=%ANDROSCRN_ROOT%bin\scrcpy-win64;C:\Program Files\nodejs;%PATH%"

cd /d "%ANDROSCRN_ROOT%apps\desktop"
call npx electron .
