@echo off
REM ACE-Step UI — build frontend and start the unified server (Windows)
setlocal

echo ==================================
echo   ACE-Step UI
echo ==================================
echo.

REM Check dependencies
if not exist "node_modules" (
    echo Error: UI dependencies not installed!
    echo Please run setup.bat first.
    pause
    exit /b 1
)

if not exist "server\node_modules" (
    echo Error: Server dependencies not installed!
    echo Please run setup.bat first.
    pause
    exit /b 1
)

REM Binary auto-detection hint
if exist "bin\ace-qwen3.exe" (
    echo acestep.cpp binaries: bin\ OK
) else (
    echo Note: No acestep.cpp binaries found in bin\
    echo   Run build.bat to build them, or set ACESTEP_BIN_DIR in .env
    echo   The UI will still start; music generation needs the binaries.
    echo.
)

REM Build frontend
echo Building frontend...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo Error: frontend build failed.
    pause
    exit /b 1
)
echo   Frontend built OK
echo.

REM Start unified server in new window
echo Starting server...
start "ACE-Step UI" cmd /k "cd /d "%~dp0server" && npm run dev"

REM Wait for server to start
timeout /t 5 /nobreak >nul

echo.
echo ==================================
echo   ACE-Step UI running!
echo ==================================
echo.
echo   UI + API : http://localhost:3001
echo.
echo   Close the server window to stop.
echo.
echo ==================================
echo.
echo Opening browser...
timeout /t 2 /nobreak >nul
start http://localhost:3001

echo.
echo Press any key to close this window (server keeps running)
pause >nul
