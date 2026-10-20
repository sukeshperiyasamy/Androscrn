@echo off
setlocal
title AndroScrn Launcher

echo ========================================================
echo                 ANDROSCRN CONTROL PLATFORM              
echo ========================================================
echo Starting AndroScrn desktop application...

set "ANDROSCRN_ROOT=%~dp0"
set "PATH=%ANDROSCRN_ROOT%bin\scrcpy-win64;C:\Program Files\nodejs;%PATH%"
set "NODE_ENV=development"

cd /d "%ANDROSCRN_ROOT%apps\desktop"
call npx electron .
if %ERRORLEVEL% neq 0 (
    echo.
    echo Application exited with code %ERRORLEVEL%.
    pause
)
