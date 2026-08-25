@echo off
setlocal

rem ============================================================================
rem Start TCA.bat
rem Place this file in the root of the TCA project folder (next to the
rem bloomberg-bridge and spa directories).
rem
rem Double-click to:
rem   1. Start the Bloomberg Bridge and wait until it answers on port 8000
rem   2. Open the TCA app in your default browser
rem
rem This file must keep CRLF line endings (enforced by .gitattributes).
rem cmd.exe mis-parses LF-only batch files around goto and if blocks.
rem ============================================================================

set "ROOT=%~dp0"
set "BRIDGE=%ROOT%bloomberg-bridge\bridge.py"
set "REQS=%ROOT%bloomberg-bridge\requirements.txt"
set "LOG=%ROOT%bloomberg-bridge\bridge.log"
set "APP=%ROOT%spa\dist\index.html"
set "HEALTH=http://127.0.0.1:8000/health"

echo.
echo  TCA - Transaction Cost Analysis
echo  ================================
echo.

rem ---------------------------------------------------------------------------
rem Verify the project files are where we expect
rem ---------------------------------------------------------------------------
if not exist "%BRIDGE%" (
    echo  ERROR: bloomberg-bridge\bridge.py was not found.
    echo  Make sure "Start TCA.bat" is in the root of the TCA project folder.
    echo.
    pause
    exit /b 1
)

if not exist "%APP%" (
    echo  ERROR: spa\dist\index.html was not found.
    echo  Make sure "Start TCA.bat" is in the root of the TCA project folder.
    echo.
    pause
    exit /b 1
)

rem ---------------------------------------------------------------------------
rem Is the bridge already running? Ask it directly rather than reading netstat:
rem a findstr for ":8000" also matches ephemeral ports such as 58000.
rem ---------------------------------------------------------------------------
call :check_health
if not errorlevel 1 (
    echo  Bloomberg Bridge is already running.
    goto :open_app
)

rem ---------------------------------------------------------------------------
rem Locate Python. Try "python" first, then the "py" launcher. The -c test also
rem rejects the Microsoft Store stub, which is on PATH but runs no code.
rem ---------------------------------------------------------------------------
set "PY="

python -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY=python"

if not defined PY (
    py -3 -c "import sys" >nul 2>&1
    if not errorlevel 1 set "PY=py -3"
)

if not defined PY (
    echo  ERROR: Python was not found on your PATH.
    echo.
    echo  Install Python 3.8 or newer from https://python.org and tick
    echo  "Add python.exe to PATH" during setup.
    echo.
    pause
    exit /b 1
)

rem ---------------------------------------------------------------------------
rem Verify the bridge's dependencies. Missing packages were the usual cause of
rem the bridge appearing to do nothing: it exited immediately and the old
rem launcher used pythonw, which discards the error message.
rem ---------------------------------------------------------------------------
%PY% -c "import fastapi, uvicorn" >nul 2>&1
if errorlevel 1 (
    echo  The Bloomberg Bridge needs the 'fastapi' and 'uvicorn' packages,
    echo  which are not installed for this Python.
    echo.
    set /p "DOINSTALL=Install them now? [Y/N] "
    goto :maybe_install
)
goto :deps_ok

:maybe_install
rem Accept y, Y, yes, Yes -- test the first character only.
if /i not "%DOINSTALL:~0,1%"=="Y" (
    echo.
    echo  Skipping install. To do it yourself, run:
    echo      %PY% -m pip install -r "%REQS%"
    echo.
    echo  Opening TCA without Bloomberg data...
    echo.
    pause
    goto :open_app
)

echo.
echo  Installing...
%PY% -m pip install -r "%REQS%"
if errorlevel 1 (
    echo.
    echo  ERROR: the install failed. If you are on a corporate network you may
    echo  need your firm's package index, for example:
    echo      %PY% -m pip install -r "%REQS%" --index-url https://your.mirror/simple
    echo.
    pause
    goto :open_app
)

%PY% -c "import fastapi, uvicorn" >nul 2>&1
if errorlevel 1 (
    echo  ERROR: fastapi and uvicorn are still not importable after install.
    echo.
    pause
    goto :open_app
)

:deps_ok
rem blpapi is optional. Without it the app runs, but no Bloomberg data.
%PY% -c "import blpapi" >nul 2>&1
if errorlevel 1 (
    echo  NOTE: the Bloomberg SDK ^(blpapi^) is not installed, so market data
    echo        will be unavailable. Everything else works.
    echo.
)

rem ---------------------------------------------------------------------------
rem Start the bridge. Output goes to bridge.log so a crash leaves a trace --
rem the old pythonw launch left nothing at all to look at. /d sets the working
rem directory so the command needs no nested quoting; bridge.py resolves
rem branding.zip from __file__, so its own location is what matters, not cwd.
rem ---------------------------------------------------------------------------
echo  Starting Bloomberg Bridge...
if exist "%LOG%" del "%LOG%" >nul 2>&1
start "Bloomberg Bridge" /min /d "%ROOT%bloomberg-bridge" cmd /c "%PY% bridge.py > bridge.log 2>&1"

rem Poll until it answers, rather than assuming a fixed 3-second startup.
set "TRIES=0"

:wait_loop
set /a TRIES+=1
call :check_health
if not errorlevel 1 goto :bridge_up
if %TRIES% GEQ 20 goto :bridge_failed
timeout /t 1 /nobreak >nul 2>&1
goto :wait_loop

:bridge_up
echo  Bloomberg Bridge is running on port 8000.
goto :open_app

:bridge_failed
echo.
echo  ERROR: the bridge did not answer on %HEALTH%
if exist "%LOG%" (
    echo.
    echo  ---- last lines of bloomberg-bridge\bridge.log ----
    powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG%' -Tail 20"
    echo  ---------------------------------------------------
)
echo.
echo  Opening TCA anyway - it works without Bloomberg data.
echo.
pause

:open_app
echo  Opening TCA...
start "" "%APP%"
exit /b 0

rem ---------------------------------------------------------------------------
rem :check_health -- returns 0 when the bridge answers, 1 otherwise
rem ---------------------------------------------------------------------------
:check_health
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri '%HEALTH%' -TimeoutSec 2 -UseBasicParsing; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
exit /b %errorlevel%
