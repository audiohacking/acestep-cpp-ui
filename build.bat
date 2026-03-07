@echo off
:: Build acestep.cpp with hardware-accelerated GPU support on Windows.
:: Automatically detects CUDA (NVIDIA) and Vulkan.
:: Called automatically by start.bat on first launch — or run manually to rebuild.
::
:: Usage: build.bat [options]
::   --cuda      force CUDA build
::   --vulkan    force Vulkan build
::   --cpu       CPU-only build (disable GPU auto-detection)
::   --src DIR   acestep.cpp source directory (default: .\acestep.cpp)
::   --bin DIR   directory to install binaries into (default: .\bin)
::   --repo URL  override the git repository to clone

setlocal EnableDelayedExpansion

set DIR=%~dp0
set SRC_DIR=%DIR%acestep.cpp
set BIN_DIR=%DIR%bin
set BUILD_DIR=%SRC_DIR%\build
if "%ACESTEP_CPP_REPO%"=="" set ACESTEP_CPP_REPO=https://github.com/audiohacking/acestep.cpp.git

set FORCE_FLAGS=
set CPU_ONLY=0

:: Parse arguments
:parse
if "%~1"=="" goto :done_parse
if /I "%~1"=="--cuda"   ( set FORCE_FLAGS=-DGGML_CUDA=ON   & shift & goto :parse )
if /I "%~1"=="--vulkan" ( set FORCE_FLAGS=-DGGML_VULKAN=ON & shift & goto :parse )
if /I "%~1"=="--cpu"    ( set CPU_ONLY=1                   & shift & goto :parse )
if /I "%~1"=="--src"    ( set SRC_DIR=%~2 & set BUILD_DIR=%~2\build & shift & shift & goto :parse )
if /I "%~1"=="--bin"    ( set BIN_DIR=%~2                  & shift & shift & goto :parse )
if /I "%~1"=="--repo"   ( set ACESTEP_CPP_REPO=%~2         & shift & shift & goto :parse )
echo Unknown option: %~1 & exit /b 1
:done_parse

echo ========================================
echo   Building acestep.cpp
echo ========================================
echo.

:: Check cmake
where cmake >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Error: cmake is required.
    echo.
    echo   Install from https://cmake.org/download/
    echo   Or via winget:  winget install Kitware.CMake
    echo   Or via choco:   choco install cmake
    exit /b 1
)

:: Check git
where git >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Error: git is required.
    echo.
    echo   Install from https://git-scm.com/download/win
    echo   Or via winget:  winget install Git.Git
    exit /b 1
)

:: Clone if source is not present
if not exist "%SRC_DIR%\.git" (
    echo Cloning acestep.cpp from %ACESTEP_CPP_REPO% ...
    git clone --depth 1 "%ACESTEP_CPP_REPO%" "%SRC_DIR%"
    echo.
) else (
    echo acestep.cpp source found at %SRC_DIR%
)

echo Initializing submodules...
cd /d "%SRC_DIR%"
git submodule update --init --recursive --depth 1
cd /d "%DIR%"
echo.

:: Determine cmake flags
set CMAKE_FLAGS=
if %CPU_ONLY%==1 (
    echo CPU-only build requested -- skipping GPU detection
    goto :skip_detect
)
if not "!FORCE_FLAGS!"=="" (
    set CMAKE_FLAGS=!FORCE_FLAGS!
    echo Using forced cmake flags: !CMAKE_FLAGS!
    goto :skip_detect
)

:: Auto-detect GPU
where nvcc >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set CMAKE_FLAGS=!CMAKE_FLAGS! -DGGML_CUDA=ON
    echo Detected: CUDA ^(NVIDIA GPU^)
)

where vulkaninfo >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set CMAKE_FLAGS=!CMAKE_FLAGS! -DGGML_VULKAN=ON
    echo Detected: Vulkan GPU
)

if "!CMAKE_FLAGS!"=="" echo No GPU accelerator detected -- CPU-only build

:skip_detect
echo.
echo cmake flags:!CMAKE_FLAGS!
echo.

:: Configure
cmake -S "%SRC_DIR%" -B "%BUILD_DIR%" -DCMAKE_BUILD_TYPE=Release !CMAKE_FLAGS!
if %ERRORLEVEL% NEQ 0 ( echo cmake configure failed & exit /b 1 )

:: Build
cmake --build "%BUILD_DIR%" --config Release --parallel
if %ERRORLEVEL% NEQ 0 ( echo cmake build failed & exit /b 1 )

:: Copy binaries
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
set COPIED=0
for %%N in (ace-qwen3 dit-vae neural-codec) do (
    set FOUND=
    for /r "%BUILD_DIR%" %%F in (%%N.exe) do (
        if exist "%%F" if "!FOUND!"=="" set FOUND=%%F
    )
    if not "!FOUND!"=="" (
        copy /Y "!FOUND!" "%BIN_DIR%\%%N.exe" >nul
        echo [OK] %%N.exe -^> %BIN_DIR%\%%N.exe
        set /a COPIED+=1
    ) else (
        echo [WARN] %%N.exe not found in build output
    )
)

echo.
if !COPIED! GTR 0 (
    echo Build complete^^! !COPIED! binaries installed to %BIN_DIR%\
) else (
    echo Error: build completed but no binaries were found in %BUILD_DIR%\.
    echo Check the cmake output above for errors.
    exit /b 1
)
echo.
