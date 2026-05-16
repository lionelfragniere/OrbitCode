@echo off
setlocal enabledelayedexpansion
title OrbitCode

set "PORT=3000"
set "FAIL=0"
set "WARN=0"
set "APP_DIR=.orbitcode"
set "LOCAL_LLM_MARKER=%APP_DIR%\local-llm-choice.txt"

echo.
echo  ========================================
echo    OrbitCode
echo    Local AI coding workspace
echo  ========================================
echo.
echo  This launcher keeps OrbitCode local.
echo  It installs npm dependencies and Playwright only.
echo  Ollama, MemPalace, uv, and gcloud are guided setup steps.
echo.

if not exist "%APP_DIR%" mkdir "%APP_DIR%"
if not exist "%APP_DIR%\runs" mkdir "%APP_DIR%\runs"

echo  Checking required tools...
echo.

where node >nul 2>nul
if !errorlevel! neq 0 (
  echo  [FAIL] Node.js is not installed.
  echo         Install Node.js 20+ from https://nodejs.org
  set "FAIL=1"
) else (
  for /f "tokens=*" %%i in ('node -v') do set "NODE_V=%%i"
  echo  [OK]   Node.js !NODE_V!
)

where npm.cmd >nul 2>nul
if !errorlevel! neq 0 (
  echo  [FAIL] npm is not available on PATH.
  set "FAIL=1"
) else (
  for /f "tokens=*" %%i in ('npm.cmd -v') do set "NPM_V=%%i"
  echo  [OK]   npm !NPM_V!
)

where git >nul 2>nul
if !errorlevel! neq 0 (
  echo  [WARN] Git is not installed. Git features and GitHub publishing will be limited.
  echo         Install from https://git-scm.com/download/win
  set "WARN=1"
) else (
  for /f "tokens=*" %%i in ('git --version') do set "GIT_V=%%i"
  echo  [OK]   !GIT_V!
)

echo.
echo  Checking optional local AI and memory tools...
echo.

where ollama >nul 2>nul
if !errorlevel! neq 0 (
  echo  [WARN] Ollama was not found.
  echo         Local LLMs will work after you install Ollama from https://ollama.com
  echo         Recommended model for this PC: qwen3:8b
  set "WARN=1"
) else (
  echo  [OK]   Ollama found
  if not exist "%LOCAL_LLM_MARKER%" (
    echo.
    echo  Local model setup
    echo  1. qwen3:8b          fast safe default
    echo  2. qwen3:14b         balanced, uses more memory
    echo  3. qwen3-coder:30b   higher quality, slower and RAM-heavy
    echo  4. Skip for now
    echo.
    set /p "LLM_CHOICE=  Pull a local model now? [1/2/3/4]: "
    if "!LLM_CHOICE!"=="1" set "OLLAMA_MODEL=qwen3:8b"
    if "!LLM_CHOICE!"=="2" set "OLLAMA_MODEL=qwen3:14b"
    if "!LLM_CHOICE!"=="3" set "OLLAMA_MODEL=qwen3-coder:30b"
    if defined OLLAMA_MODEL (
      echo !OLLAMA_MODEL!>"%LOCAL_LLM_MARKER%"
      echo.
      echo  Pulling !OLLAMA_MODEL! with Ollama...
      call ollama pull !OLLAMA_MODEL!
      if !errorlevel! neq 0 (
        echo  [WARN] Ollama pull did not finish. You can retry later:
        echo         ollama pull !OLLAMA_MODEL!
        set "WARN=1"
      ) else (
        echo  [OK]   !OLLAMA_MODEL! ready
      )
    ) else (
      echo skipped>"%LOCAL_LLM_MARKER%"
      echo  [OK]   Skipped local model pull
    )
  )
)

where python >nul 2>nul
if !errorlevel! neq 0 (
  echo  [WARN] Python was not found. MemPalace memory tools may be unavailable.
  set "WARN=1"
) else (
  for /f "tokens=*" %%i in ('python --version') do set "PY_V=%%i"
  echo  [OK]   !PY_V!
)

where uv >nul 2>nul
if !errorlevel! neq 0 (
  echo  [WARN] uv was not found.
  echo         Install guide: https://docs.astral.sh/uv/getting-started/installation/
  set "WARN=1"
) else (
  echo  [OK]   uv found
)

where mempalace >nul 2>nul
if !errorlevel! neq 0 (
  echo  [WARN] MemPalace was not found.
  echo         OrbitCode will show memory setup guidance instead of installing it silently.
  echo         Project: https://github.com/MemPalace
  set "WARN=1"
) else (
  echo  [OK]   MemPalace found
)

where gcloud >nul 2>nul
if !errorlevel! neq 0 (
  echo  [INFO] gcloud not found. Vertex AI and Cloud Run deploy tools need it only if you use them.
) else (
  echo  [OK]   gcloud found
)

echo.
if "!FAIL!"=="1" (
  echo  ========================================
  echo   Cannot start yet. Fix the failed checks.
  echo  ========================================
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo  Installing npm dependencies...
  call npm.cmd install
  if !errorlevel! neq 0 (
    echo  [FAIL] npm install failed.
    pause
    exit /b 1
  )
) else (
  echo  [OK]   npm dependencies ready
)

set "PW_CACHE=%LOCALAPPDATA%\ms-playwright"
if not exist "%PW_CACHE%" (
  echo.
  echo  Installing Playwright Chromium for browser testing...
  call npx.cmd playwright install chromium
  if !errorlevel! neq 0 (
    echo  [WARN] Playwright install had issues. Browser QA may be limited.
    set "WARN=1"
  )
) else (
  echo  [OK]   Playwright browser cache found
)

netstat -ano 2>nul | findstr ":%PORT% " | findstr "LISTENING" >nul 2>nul
if !errorlevel! equ 0 (
  echo.
  echo  [WARN] Port %PORT% is already in use.
  set /p "CONTINUE=  Try starting anyway? [Y/n]: "
  if /i "!CONTINUE!"=="n" (
    echo  Exiting. Free port %PORT% and try again.
    pause
    exit /b 1
  )
)

echo.
if "!WARN!"=="1" (
  echo  ========================================
  echo   Starting with optional setup warnings
  echo  ========================================
) else (
  echo  ========================================
  echo   All checks passed
  echo  ========================================
)

echo.
echo  Opening http://localhost:%PORT%
echo  Press Ctrl+C to stop OrbitCode.
echo.
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:%PORT%"
call npx.cmd next dev --turbopack --port %PORT%
