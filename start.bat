@echo off
title Native Media AI Studio
where pwsh >nul 2>nul || (echo ERROR: PowerShell 7.6+ ^(pwsh^) is required but was not found on PATH. & echo Install it with: winget install --id Microsoft.PowerShell & pause & exit /b 1)
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-studio.ps1" %*
pause
