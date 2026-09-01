$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $ProjectRoot 'packages\backend'
$venvPython = Join-Path $ProjectRoot 'venv\Scripts\python.exe'
$LogDir = Join-Path $ProjectRoot 'output\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Write-Host "Starting Backend..."
$backendLog = Join-Path $LogDir 'backend.log'
$backendErr = Join-Path $LogDir 'backend.err.log'
$proc = Start-Process -FilePath $venvPython `
    -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000','--ws','websockets' `
    -WorkingDirectory $BackendDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $backendLog `
    -RedirectStandardError $backendErr `
    -PassThru

Write-Host "Backend PID: $($proc.Id)"
Start-Sleep -Seconds 3
$listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    Write-Host "Backend listening on port 8000"
} else {
    Write-Host "WARNING: Backend not listening yet, check logs"
}
