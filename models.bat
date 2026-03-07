@echo off
:: Download pre-quantized ACE-Step GGUF models from HuggingFace
:: No Python required — uses PowerShell's Invoke-WebRequest
::
:: Usage: models.bat [options]
::   default:      Q8_0 turbo essentials
::   --quant X:    Q4_K_M, Q5_K_M, Q6_K, Q8_0, BF16  (default: Q8_0)
::   --lm SIZE:    0.6B, 1.7B, 4B  (default: 4B)
::   --sft         include SFT DiT
::   --base        include base DiT
::   --shifts      include shift1/shift3/continuous DiT
::   --dir DIR     download directory (default: .\models)
::   --hf-token T  HuggingFace token for private/gated repos

setlocal EnableDelayedExpansion

set REPO=Serveurperso/ACE-Step-1.5-GGUF
set DIR=models
set QUANT=Q8_0
set LM_SIZE=4B
set ALL=0
set SFT=0
set BASE=0
set SHIFTS=0
set HF_TOKEN=

:: Parse arguments
:parse
if "%~1"=="" goto :done_parse
if /I "%~1"=="--all"      ( set ALL=1 & shift & goto :parse )
if /I "%~1"=="--sft"      ( set SFT=1 & shift & goto :parse )
if /I "%~1"=="--base"     ( set BASE=1 & shift & goto :parse )
if /I "%~1"=="--shifts"   ( set SHIFTS=1 & shift & goto :parse )
if /I "%~1"=="--quant"    ( set QUANT=%~2 & shift & shift & goto :parse )
if /I "%~1"=="--lm"       ( set LM_SIZE=%~2 & shift & shift & goto :parse )
if /I "%~1"=="--dir"      ( set DIR=%~2 & shift & shift & goto :parse )
if /I "%~1"=="--hf-token" ( set HF_TOKEN=%~2 & shift & shift & goto :parse )
echo Unknown option: %~1 & exit /b 1
:done_parse

if not exist "%DIR%" mkdir "%DIR%"

set HF_BASE=https://huggingface.co/%REPO%/resolve/main

:: ── Download function (via PowerShell) ──────────────────────────────────────
goto :main

:dl
set FILE=%~1
set DEST=%DIR%\%FILE%
set URL=%HF_BASE%/%FILE%

if exist "%DEST%" (
    for %%F in ("%DEST%") do set SIZE=%%~zF
    if !SIZE! GTR 1048576 (
        echo [OK]       %FILE%
        exit /b 0
    )
)

echo [Download] %FILE%

if "%HF_TOKEN%"=="" (
    powershell -NoProfile -Command ^
        "Invoke-WebRequest -Uri '%URL%' -OutFile '%DEST%.part' -UseBasicParsing"
) else (
    powershell -NoProfile -Command ^
        "$h=@{'Authorization'='Bearer %HF_TOKEN%'}; Invoke-WebRequest -Uri '%URL%' -OutFile '%DEST%.part' -Headers $h -UseBasicParsing"
)

move /Y "%DEST%.part" "%DEST%" >nul
echo [Saved]    %DEST%
exit /b 0

:: ── Quant resolver ───────────────────────────────────────────────────────────
:resolve_quant_emb
:: Embedding/small LM: only BF16 or Q8_0
if "%QUANT%"=="BF16" ( set RESOLVED=BF16 ) else ( set RESOLVED=Q8_0 )
exit /b 0

:resolve_quant_lm4B
if "%QUANT%"=="BF16"   ( set RESOLVED=BF16   & exit /b 0 )
if "%QUANT%"=="Q8_0"   ( set RESOLVED=Q8_0   & exit /b 0 )
if "%QUANT%"=="Q6_K"   ( set RESOLVED=Q6_K   & exit /b 0 )
if "%QUANT%"=="Q5_K_M" ( set RESOLVED=Q5_K_M & exit /b 0 )
if "%QUANT%"=="Q4_K_M" ( set RESOLVED=Q5_K_M & exit /b 0 )
set RESOLVED=Q8_0
exit /b 0

:: ── Main ─────────────────────────────────────────────────────────────────────
:main

:: VAE — always BF16
call :dl "vae-BF16.gguf"

:: Text encoder
call :resolve_quant_emb
call :dl "Qwen3-Embedding-0.6B-%RESOLVED%.gguf"

:: LM
if "%LM_SIZE%"=="4B" (
    call :resolve_quant_lm4B
    call :dl "acestep-5Hz-lm-4B-%RESOLVED%.gguf"
) else (
    call :resolve_quant_emb
    call :dl "acestep-5Hz-lm-%LM_SIZE%-%RESOLVED%.gguf"
)

:: DiT turbo (always)
call :dl "acestep-v15-turbo-%QUANT%.gguf"

:: Optional variants
if "%SFT%"=="1"    call :dl "acestep-v15-sft-%QUANT%.gguf"
if "%BASE%"=="1"   call :dl "acestep-v15-base-%QUANT%.gguf"
if "%SHIFTS%"=="1" (
    call :dl "acestep-v15-turbo-shift1-%QUANT%.gguf"
    call :dl "acestep-v15-turbo-shift3-%QUANT%.gguf"
    call :dl "acestep-v15-turbo-continuous-%QUANT%.gguf"
)

if "%ALL%"=="1" (
    call :dl "Qwen3-Embedding-0.6B-BF16.gguf"
    for %%L in (0.6B 1.7B) do (
        call :dl "acestep-5Hz-lm-%%L-BF16.gguf"
        call :dl "acestep-5Hz-lm-%%L-Q8_0.gguf"
    )
    for %%Q in (BF16 Q5_K_M Q6_K Q8_0) do call :dl "acestep-5Hz-lm-4B-%%Q.gguf"
    for %%D in (turbo sft base turbo-shift1 turbo-shift3 turbo-continuous) do (
        for %%Q in (BF16 Q4_K_M Q5_K_M Q6_K Q8_0) do call :dl "acestep-v15-%%D-%%Q.gguf"
    )
)

echo.
echo [Done] Models ready in %DIR%\
echo.
echo Set ACESTEP_MODEL to your primary DiT model, e.g.:
echo   set ACESTEP_MODEL=%CD%\%DIR%\acestep-v15-turbo-%QUANT%.gguf
echo.
