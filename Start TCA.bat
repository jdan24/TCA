@echo off
setlocal

:: ============================================================================
:: Start TCA.bat
:: Place this file in the root of the TCA project folder (next to the
:: bloomberg-bridge and spa directories).
::
:: Double-click to:
::   1. Start the Bloomberg Bridge (background, no blocking window)
::   2. Open the TCA app in your default browser
:: ============================================================================

set "ROOT=%~dp0"
set "BRIDGE=%ROOT%bloomberg-bridge\bridge.py"
set "APP=%ROOT%spa\dist\index.html"

:: ── Verify Python is available ───────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ERROR: Python was not found on your PATH.
    echo  Install Python 3.8+ from https://python.org and ensure it is added to PATH.
    echo.
    pause
    exit /b 1
)

:: ── Verify bridge.py exists ──────────────────────────────────────────────────
if not exist "%BRIDGE%" (
    echo.
    echo  ERROR: bloomberg-bridge\bridge.py was not found.
    echo  Make sure Start TCA.bat is in the root of the TCA project folder.
    echo.
    pause
    exit /b 1
)

:: ── Skip bridge if it is already listening on port 8000 ─────────────────────
netstat -ano 2>nul | findstr ":8000" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo Bloomberg Bridge is already running on port 8000.
    goto :open_app
)

:: ── Start bridge ─────────────────────────────────────────────────────────────
:: Prefer pythonw.exe (no console window) when available; fall back to minimised
:: python.exe window so the user can see logs if something goes wrong.
echo Starting Bloomberg Bridge...

where pythonw >nul 2>&1
if not errorlevel 1 (
    start "" pythonw "%BRIDGE%"
) else (
    start "Bloomberg Bridge" /min python "%BRIDGE%"
)

:: Give the bridge ~3 seconds to initialise before opening the browser
timeout /t 3 /nobreak >nul

:open_app
:: ── Open TCA in the default browser ─────────────────────────────────────────
echo Opening TCA...
start "" "%APP%"

exit /b 0
