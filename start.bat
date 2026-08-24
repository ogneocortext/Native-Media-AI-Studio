@echo off
title Native Media AI Studio
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-studio.ps1" %*
pause
