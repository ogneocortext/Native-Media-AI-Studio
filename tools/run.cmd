@echo off
REM tools/run.cmd
REM Launcher for standalone tools using the studio-tools Python 3.14 venv.
REM
REM Usage:
REM   tools\run.cmd tools\lib\paths.py
REM   tools\run.cmd scripts\utility\convert_lyrics_csv.py -- --help
REM
REM The double-dash (--) separates launcher args from the target script's args.

setlocal EnableDelayedExpansion

set "REPO_ROOT=%~dp0.."
set "SCRIPT_PATH=%~1"
shift

if "%SCRIPT_PATH%"=="" (
    echo Usage: tools\run.cmd ^<script.py^> [-- script-args...]
    exit /b 1
)

if not exist "%REPO_ROOT%\tools\%SCRIPT_PATH%" (
    echo Script not found: %REPO_ROOT%\tools\%SCRIPT_PATH%
    exit /b 1
)

set "PYTHON=%REPO_ROOT%\..\..\conda-envs\studio-tools\Scripts\python.exe"
if not exist "%PYTHON%" (
    echo studio-tools Python not found at: %PYTHON%
    exit /b 1
)

"%PYTHON%" "%REPO_ROOT%\tools\%SCRIPT_PATH%" %*
