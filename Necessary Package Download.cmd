@echo off
setlocal
title Spatial Audio Essential - Necessary Package Download

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Necessary Package Download.ps1" %*
set "SETUP_EXIT=%ERRORLEVEL%"

echo.
if "%SETUP_EXIT%"=="0" (
  echo Necessary package setup completed successfully.
) else (
  echo Necessary package setup failed. Review the error above.
)
echo Press any key to close this window.
pause >nul
exit /b %SETUP_EXIT%
