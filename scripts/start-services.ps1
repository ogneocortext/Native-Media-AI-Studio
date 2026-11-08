<#
.SYNOPSIS
    Thin wrapper: launches managed background services via manage-servers.ps1.
.DESCRIPTION
    Preserves the original start-services UX (-ComfyUI / -VideoEditor)
    while delegating all actual process management to the canonical
    manage-servers.ps1 script to avoid duplicated startup logic.
.PARAMETER ComfyUI
    Also start ComfyUI as a background service.
.PARAMETER VideoEditor
    Also start the Video Editor as a background service.
.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-services.ps1
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-services.ps1 -ComfyUI -VideoEditor
#>
#Requires -Version 7.6
[CmdletBinding()]

param(
    [switch]$ComfyUI,
    [switch]$VideoEditor
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

$services = @('backend', 'frontend', 'go-studio', 'atomic-chat')
if ($ComfyUI) { $services += 'comfyui' }
if ($VideoEditor) { $services += 'video' }
$services = $services | Select-Object -Unique

$manageScript = Join-Path $ProjectRoot 'scripts\manage-servers.ps1'
if (-not (Test-Path -LiteralPath $manageScript)) {
    Write-Err "Canonical manager not found: $manageScript"
    exit 1
}

Write-Host "`nStarting background services via manage-servers.ps1..." -ForegroundColor Cyan
& $manageScript -Action start -Services $services

# Resource watchdog: monitors RAM/commit charge and reaps orphaned worker
# processes (dead parent, >60 min old, not in the service allowlist).
# Logs to output\logs\resource-watchdog.jsonl. Skipped if already running.
$watchdogScript = Join-Path $ProjectRoot 'tools\resource-watchdog.py'
$watchdogRunning = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'resource-watchdog\.py' }
if (-not $watchdogRunning -and (Test-Path -LiteralPath $watchdogScript)) {
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCmd) {
        $logDir = Join-Path $ProjectRoot 'output\logs'
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
        Start-Process -FilePath $pythonCmd.Source `
            -ArgumentList @('tools\resource-watchdog.py', 'watch', '--interval', '60', '--reap', '--min-age', '60') `
            -WorkingDirectory $ProjectRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $logDir 'watchdog.out.log') `
            -RedirectStandardError (Join-Path $logDir 'watchdog.err.log')
        Write-Host "Resource watchdog started (log: output\logs\resource-watchdog.jsonl)" -ForegroundColor DarkGray
    }
}
