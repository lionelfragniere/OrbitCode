@echo off
setlocal enabledelayedexpansion
title OrbitCode

set "PORT=3000"
set "FAIL=0"
set "WARN=0"
set "APP_DIR=.orbitcode"
set "LOCAL_TOOLS_DIR=%CD%\%APP_DIR%\tools"
set "LOCAL_UV_DIR=%LOCAL_TOOLS_DIR%\uv"
set "LOCAL_UV_EXE=%LOCAL_UV_DIR%\uv.exe"
set "USER_BIN=%USERPROFILE%\.local\bin"
set "UV_EXE=uv"

echo.
echo  ========================================
echo    OrbitCode
echo    Local AI coding workspace
echo  ========================================
echo.
echo  This launcher keeps OrbitCode local.
echo  It installs npm dependencies, Playwright, uv, and MemPalace when needed.
echo  Ollama stays optional because the app and model downloads can be large.
echo.

if not exist "%APP_DIR%" mkdir "%APP_DIR%"
if not exist "%APP_DIR%\runs" mkdir "%APP_DIR%\runs"
if not exist "%LOCAL_TOOLS_DIR%" mkdir "%LOCAL_TOOLS_DIR%"
set "PATH=%USER_BIN%;%LOCAL_UV_DIR%;%PATH%"

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
  echo  [INFO] Ollama was not found. Local models are optional and can be large.
  echo         OrbitCode will ask in the UI before you choose local AI.
) else (
  echo  [OK]   Ollama found
  echo         Model downloads are handled in the OrbitCode UI.
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
  if exist "%LOCAL_UV_EXE%" (
    set "UV_EXE=%LOCAL_UV_EXE%"
    echo  [OK]   uv found in OrbitCode tools
  ) else (
    echo  [SETUP] Installing uv quietly...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $env:UV_INSTALL_DIR='%LOCAL_UV_DIR%'; $env:UV_NO_MODIFY_PATH='1'; irm https://astral.sh/uv/install.ps1 | iex" >nul
    if !errorlevel! neq 0 (
      where winget >nul 2>nul
      if !errorlevel! equ 0 (
        winget install --id=astral-sh.uv -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity >nul
      )
    )
    if exist "%LOCAL_UV_EXE%" (
      set "UV_EXE=%LOCAL_UV_EXE%"
      echo  [OK]   uv installed locally for OrbitCode
    ) else (
      where uv >nul 2>nul
      if !errorlevel! equ 0 (
        set "UV_EXE=uv"
        echo  [OK]   uv installed
      ) else (
        echo  [WARN] uv could not be installed automatically.
        echo         OrbitCode will still start, but memory setup may be limited.
        set "WARN=1"
      )
    )
  )
) else (
  set "UV_EXE=uv"
  echo  [OK]   uv found
)

where mempalace >nul 2>nul
if !errorlevel! neq 0 (
  echo  [SETUP] Installing MemPalace quietly...
  call "!UV_EXE!" tool install mempalace >nul
  if !errorlevel! neq 0 (
    echo  [WARN] MemPalace could not be installed automatically.
    echo         OrbitCode will still start, but memory search may be unavailable.
    set "WARN=1"
  ) else (
    echo  [OK]   MemPalace installed
  )
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
