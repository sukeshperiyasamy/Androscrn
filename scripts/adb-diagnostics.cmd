@echo off
setlocal enabledelayedexpansion

:: ==============================================================================
:: AndroScrn - ADB Live Device Discovery & Connection Diagnostics
:: ==============================================================================

title AndroScrn - ADB Live Diagnostics Console
color 0B

set ADB_EXE=%~1
set TIMEOUT_SEC=%~2
set INTERVAL_SEC=%~3
set SESSION_DIR=%~4

if "%ADB_EXE%"=="" (
    echo [ERROR] No ADB executable path provided.
    echo Usage: %~nx0 "<adb_path>" [timeout_sec] [interval_sec] [session_dir]
    pause
    exit /b 1
)

if not exist "%ADB_EXE%" (
    echo [ERROR] ADB executable not found at: "%ADB_EXE%"
    echo Please verify that the bundled ADB binary is present in bin\scrcpy-win64\adb.exe.
    pause
    exit /b 1
)

if "%TIMEOUT_SEC%"=="" set TIMEOUT_SEC=60
if "%INTERVAL_SEC%"=="" set INTERVAL_SEC=2

set /a TIMEOUT_NUM=%TIMEOUT_SEC%
set /a INTERVAL_NUM=%INTERVAL_SEC%
if %INTERVAL_NUM% LSS 1 set INTERVAL_NUM=2
if %TIMEOUT_NUM% LSS 5 set TIMEOUT_NUM=60

set ATTEMPT=0
set ELAPSED=0
set TMP_OUT=%TEMP%\androscrn_adb_diag_%RANDOM%.txt

cls
echo ==============================================================================
echo                      ANDROSCRN - LIVE ADB DIAGNOSTICS                         
echo ==============================================================================
echo  Host Time         : %DATE% %TIME%
echo  Bundled ADB       : %ADB_EXE%
echo  Discovery Timeout : %TIMEOUT_NUM% seconds
echo  Poll Interval     : %INTERVAL_NUM% seconds
if not "%SESSION_DIR%"=="" echo  Session Temp Dir  : %SESSION_DIR%
echo ==============================================================================
echo.

:RETRY_LOOP
set /a ATTEMPT+=1

:: Check if cancellation was requested from AndroScrn UI
if not "%SESSION_DIR%"=="" (
    if exist "%SESSION_DIR%\cancel.flag" (
        goto CANCELLED_EXIT
    )
    if %ATTEMPT% GTR 1 if exist "%SESSION_DIR%\success.flag" (
        goto SUCCESS_EXTERNAL
    )
)

echo [%TIME:~0,8%] Attempt #%ATTEMPT% (%ELAPSED%s / %TIMEOUT_NUM%s): Querying attached devices...
"%ADB_EXE%" devices -l > "%TMP_OUT%" 2>&1

echo ------------------------------------------------------------------------------
type "%TMP_OUT%"
echo ------------------------------------------------------------------------------

:: Analyze device output
set TOTAL_DEV=0
set AUTH_DEV=0
set UNAUTH_DEV=0
set OFFLINE_DEV=0
set FIRST_SERIAL=
set FIRST_STATE=
set FIRST_INFO=

for /f "tokens=1,2,*" %%A in ('type "%TMP_OUT%" ^| findstr /v /c:"List of devices attached" ^| findstr /v /c:"* daemon" ^| findstr /v /c:"adb server version" ^| findstr /v /c:"cannot connect to daemon"') do (
    set /a TOTAL_DEV+=1
    if "!FIRST_SERIAL!"=="" (
        set FIRST_SERIAL=%%A
        set FIRST_STATE=%%B
        set FIRST_INFO=%%C
    )
    if "%%B"=="device" (
        set /a AUTH_DEV+=1
    ) else if "%%B"=="unauthorized" (
        set /a UNAUTH_DEV+=1
    ) else if "%%B"=="offline" (
        set /a OFFLINE_DEV+=1
    )
)

:: Branch based on discovered device state
if %AUTH_DEV% GTR 0 (
    goto SUCCESS_EXIT
)

if %UNAUTH_DEV% GTR 0 (
    echo [STATUS] Device attached but UNAUTHORIZED: !FIRST_SERIAL!
    echo [ACTION REQUIRED] Please check your Android phone screen:
    echo   1. Unlock the phone.
    echo   2. Look for the prompt: "Allow USB debugging?".
    echo   3. Check "Always allow from this computer" and tap "Allow" or "OK".
    echo.
    goto WAIT_NEXT
)

if %OFFLINE_DEV% GTR 0 (
    echo [STATUS] Device is OFFLINE: !FIRST_SERIAL!
    echo [ACTION REQUIRED] Reconnect the USB cable or toggle Developer Options -^> USB Debugging.
    echo.
    goto WAIT_NEXT
)

if %TOTAL_DEV% EQU 0 (
    echo [STATUS] No devices detected.
    echo Ensure phone is connected via USB cable with Developer Options and USB Debugging ON.
    echo.
    goto WAIT_NEXT
)

:WAIT_NEXT
:: Check if timeout reached
if %ELAPSED% GEQ %TIMEOUT_NUM% (
    goto TIMEOUT_EXIT
)

:: Wait for INTERVAL_NUM seconds
timeout /t %INTERVAL_NUM% /nobreak >nul
set /a ELAPSED+=%INTERVAL_NUM%

goto RETRY_LOOP

:SUCCESS_EXIT
if not "%SESSION_DIR%"=="" if exist "%SESSION_DIR%" (
    echo 1 > "%SESSION_DIR%\success.flag"
)
echo.
echo ==============================================================================
echo  [SUCCESS] AUTHORIZED ANDROID DEVICE DETECTED!
echo ==============================================================================
echo  Serial  : !FIRST_SERIAL!
echo  State   : Authorized (device)
echo  Details : !FIRST_INFO!
echo.
echo  Ready for screen mirroring and control. Return to AndroScrn desktop window.
echo  This diagnostic console will remain open for troubleshooting.
echo ==============================================================================
echo Press any key to close this window...
if exist "%TMP_OUT%" del "%TMP_OUT%" >nul 2>&1
pause >nul
exit /b 0

:SUCCESS_EXTERNAL
echo.
echo ==============================================================================
echo  [SUCCESS] Device connection verified by AndroScrn UI!
echo ==============================================================================
echo Press any key to close this window...
if exist "%TMP_OUT%" del "%TMP_OUT%" >nul 2>&1
pause >nul
exit /b 0

:CANCELLED_EXIT
echo.
echo ==============================================================================
echo  [CANCELLED] Device discovery cancelled by user from AndroScrn UI.
echo ==============================================================================
echo Press any key to close this window...
if exist "%TMP_OUT%" del "%TMP_OUT%" >nul 2>&1
pause >nul
exit /b 0

:TIMEOUT_EXIT
if not "%SESSION_DIR%"=="" if exist "%SESSION_DIR%" (
    echo 1 > "%SESSION_DIR%\timeout.flag"
)
echo.
echo ==============================================================================
echo  [TIMEOUT] NO AUTHORIZED DEVICE DETECTED WITHIN %TIMEOUT_NUM% SECONDS
echo ==============================================================================
echo  Troubleshooting Checklist:
echo   1. Verify your USB cable supports high-speed data (not charging-only).
echo   2. Connect directly to a motherboard USB 3.0/USB-C port; avoid unpowered hubs.
echo   3. On Phone: Settings -^> About Phone -^> Tap "Build Number" 7 times.
echo   4. On Phone: Settings -^> Developer Options -^> Enable "USB Debugging".
echo   5. For Xiaomi / Redmi / POCO (HyperOS / MIUI):
echo      - Enable "Install via USB"
echo      - Enable "USB debugging (Security settings)"
echo   6. Check Windows Device Manager under "Android Phone" / "Universal Serial Bus".
echo   7. Re-seat the USB cable or reboot the phone.
echo ==============================================================================
echo Press any key to close this window...
if exist "%TMP_OUT%" del "%TMP_OUT%" >nul 2>&1
pause >nul
exit /b 0
