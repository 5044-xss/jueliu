@echo off
setlocal
cd /d "%~dp0"

rem ============================================================
rem  Jueliu desktop build script
rem  Double-click to build the installer -> release\Jueliu-Setup-*.exe
rem  To bump version, edit "version" in package.json first.
rem ============================================================

rem Node / electron-builder do not use the system proxy; set it here.
rem Change the port below if your proxy is not 7890.
set "HTTPS_PROXY=http://127.0.0.1:7890"
set "HTTP_PROXY=http://127.0.0.1:7890"

echo ==========================================
echo   Jueliu desktop build
echo ==========================================
echo.
echo [1/2] Building... (first run downloads ffmpeg/Electron, ~350MB)
echo.
call npm run dist
if errorlevel 1 (
  echo.
  echo [FAILED] Build error. See the log above.
  echo          Common causes: proxy off; dependencies missing ^(run: npm install^).
  pause
  exit /b 1
)

echo.
echo [2/2] Done. Installer:
for %%F in ("release\Jueliu-Setup-*.exe") do echo     %%~fF
echo.
start "" "%~dp0release"
echo Opened the release folder. Send Jueliu-Setup-*.exe to users.
echo.
pause
