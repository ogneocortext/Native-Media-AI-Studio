@echo off
REM tools\python.cmd - repo-level shim that always uses the backend venv interpreter.
REM Use this when a profile is not loaded (e.g. pwsh -NoProfile, CI, or an agent
REM shell that bypasses the user profile). Forwards all args to the interpreter.
setlocal
set "PY=D:\conda-envs\nma-studio-cuda\Scripts\python.exe"
if not exist "%PY%" (
    echo python shim: backend venv not found at %PY% 1>&2
    exit /b 1
)
"%PY%" %*
exit /b %ERRORLEVEL%
