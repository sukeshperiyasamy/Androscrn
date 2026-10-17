@echo off
setlocal
cd /d "%~dp0"
"%~dp0androscrn.exe" %*
exit /b %ERRORLEVEL%
