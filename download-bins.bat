@echo off
REM download-bins.bat — Download pre-built acestep.cpp binaries (Windows).
REM
REM Downloads ace-lm.exe, ace-synth.exe, ace-understand.exe, neural-codec.exe
REM and their DLLs into the bin\ directory.  Always replaces existing files so
REM the script can be used both for first-time installation and to update.
REM
REM Usage: download-bins.bat [--version TAG] [--bin DIR]
REM   --version TAG   Release tag  (default: %BINARY_VERSION% or v0.0.2)
REM   --bin DIR       Target dir   (default: %ACESTEP_BIN_DIR% or .\bin)
REM
REM Requires PowerShell (available on all modern Windows 10/11 systems).
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
if "%ACESTEP_BIN_DIR%"=="" (set "BIN_DIR=%SCRIPT_DIR%bin") else (set "BIN_DIR=%ACESTEP_BIN_DIR%")
if "%BINARY_VERSION%"==""   (set "VERSION=v0.0.2")         else (set "VERSION=%BINARY_VERSION%")
set "REPO=audiohacking/acestep.cpp"
set "ARCHIVE=acestep-windows-x64.zip"

REM ── Parse arguments ──────────────────────────────────────────────────────────
:parse
if "%~1"=="" goto :done_parse
if /I "%~1"=="--version" ( set "VERSION=%~2" & shift & shift & goto :parse )
if /I "%~1"=="--bin"     ( set "BIN_DIR=%~2" & shift & shift & goto :parse )
echo Unknown option: %~1 >&2
echo Usage: download-bins.bat [--version TAG] [--bin DIR] >&2
exit /b 1
:done_parse

set "URL=https://github.com/%REPO%/releases/download/%VERSION%/%ARCHIVE%"
set "TMP_ARCHIVE=%TEMP%\acestep-bins-%RANDOM%.zip"

echo ==========================================
echo   Downloading acestep.cpp binaries
echo ==========================================
echo.
echo   Version : %VERSION%
echo   Archive : %ARCHIVE%
echo   Dest    : %BIN_DIR%
echo.

if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"

echo Downloading: %URL%
powershell -NoProfile -NonInteractive -Command ^
  "[Net.ServicePointManager]::SecurityProtocol = 'Tls12,Tls13';" ^
  "$wc = New-Object Net.WebClient;" ^
  "$wc.Headers['User-Agent'] = 'ACE-Step-UI/1.0';" ^
  "try { $wc.DownloadFile('%URL%', '%TMP_ARCHIVE%') }" ^
  "catch { Write-Error $_.Exception.Message; exit 1 }"
if %ERRORLEVEL% NEQ 0 (
    echo Error: download failed. Check that %VERSION% has a Windows release. >&2
    exit /b 1
)
echo.

echo Extracting to %BIN_DIR%\ ...
powershell -NoProfile -NonInteractive -Command ^
  "Expand-Archive -Path '%TMP_ARCHIVE%' -DestinationPath '%BIN_DIR%' -Force"
if %ERRORLEVEL% NEQ 0 (
    echo Error: extraction failed. >&2
    del /f /q "%TMP_ARCHIVE%" 2>nul
    exit /b 1
)
del /f /q "%TMP_ARCHIVE%" 2>nul
echo.

REM ── Verify binaries ──────────────────────────────────────────────────────────
set ALL_OK=1
for %%N in (ace-lm ace-synth ace-understand neural-codec) do (
    if exist "%BIN_DIR%\%%N.exe" (
        echo [OK] %%N.exe
    ) else (
        echo [WARN] %%N.exe not found
        set ALL_OK=0
    )
)

echo.
echo ==========================================
echo   Binaries ready in %BIN_DIR%\
echo ==========================================
echo.
if %ALL_OK%==0 (
    echo Warning: some binaries were not found. Verify the release has a Windows archive.
    exit /b 1
)
