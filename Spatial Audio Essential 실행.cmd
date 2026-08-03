@echo off
setlocal
title Spatial Audio Essential
set "LAUNCH_ARGS="
if /I "%SPATIAL_AUDIO_NO_BROWSER%"=="1" set "LAUNCH_ARGS=-NoBrowser"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %LAUNCH_ARGS%
set "LAUNCH_EXIT=%ERRORLEVEL%"
if not "%LAUNCH_EXIT%"=="0" (
  echo.
  echo Failed to start Spatial Audio Essential.
  echo Review the error above, then press any key to close this window.
  pause >nul
)
exit /b %LAUNCH_EXIT%
