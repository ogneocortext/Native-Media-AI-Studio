<#
.SYNOPSIS
    One-command launcher for Native Media AI Studio (backend + frontend).
.DESCRIPTION
    Starts the FastAPI backend and the Vite frontend (and optionally
    ComfyUI / the Remotion video editor) by delegating service lifecycle
    to manage-servers.ps1, waits for both to become healthy, syncs the
    resolved port config to the frontend (the browser is no longer opened
    automatically — pass -Browser to open it), then either blocks on an
    interactive 'q' loop with auto-restart for crashed services, or
    returns immediately (-NoWait) leaving services running in the
    background. Pressing 'q' (or Ctrl+C / closing the window) stops all
    services started by this session.
    Supports auto-restart for crashed services with exponential backoff.
.PARAMETER NoBackend
    Skip the backend (frontend only).
.PARAMETER NoFrontend
    Skip the frontend (backend only).
.PARAMETER VideoEditor
    Also start the Remotion video-editor studio.
.PARAMETER Browser
    Open the frontend in the browser on startup. Off by default — the app
    no longer opens a browser tab when started from scratch.
.PARAMETER NoComfyUI
    Skip ComfyUI even if it would otherwise start.
.PARAMETER Clean
    Remove build artifacts and caches before starting.
.PARAMETER AutoQuitSeconds
    Test hook: auto-stop all services after N seconds instead of waiting
    for 'q'.
.PARAMETER NoWait
    Start services and return immediately instead of blocking on the
    interactive 'q' loop. Services keep running in the background after
    the script exits. Automatically enabled when stdin is not a console
    (e.g. launched by an AI agent with redirected input).
.PARAMETER ComfyUIPath
    Path to the ComfyUI checkout directory.
.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-studio.ps1
.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-studio.ps1 -NoComfyUI -Clean
.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-studio.ps1 -NoWait -Browser
#>
#Requires -Version 7.6
[CmdletBinding(SupportsShouldProcess=$true)]

param(
    [switch]$NoBackend,
    [switch]$NoFrontend,
    [switch]$VideoEditor,
    [switch]$Browser,
    [switch]$NoComfyUI,
    [switch]$Clean,
    [int]$AutoQuitSeconds = 0,
    [switch]$NoWait,
    [string]$ComfyUIPath = 'D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

# Load shared utilities, then manage-servers.ps1 for service lifecycle
# (start / stop / health-check / process registry). manage-servers.ps1
# dot-sources shared-utils itself, but we dot-source it first so its
# helpers are available for our own calls below.
. (Join-Path $PSScriptRoot 'shared-utils.ps1')
. (Join-Path $PSScriptRoot 'manage-servers.ps1')

# manage-servers.ps1 only runs its action dispatcher when invoked directly
# (-Action). When dot-sourced it sets up $ServiceConfig, $Ports, $LogDir,
# $backendPython, $comfyPython, … using the cheap path-existence chain.
# Re-resolve with the verified chain so service starts use a working
# interpreter rather than merely an existing one.
$backendPython = Resolve-BackendPython
if (-not $backendPython) {
    Write-Err 'No Python environment found for the backend.'
    Write-Err 'Create one: py -V:3.11 -m venv D:\conda-envs\nma-studio-cuda'
    exit 1
}
$comfyPython = Resolve-ComfyUIPython
$ServiceConfig.backend.Python  = $backendPython
$ServiceConfig.comfyui.Python  = $comfyPython

Write-Ok "Using backend environment: $backendPython"

$BackendPort   = $Ports.backend_port
$FrontendPort  = $Ports.frontend_port
$ComfyUIPort   = $Ports.comfyui_port
$VideoEditorPort = $Ports.video_editor_port

$BackendDir    = Join-Path $ProjectRoot 'packages\backend'
$FrontendDir   = Join-Path $ProjectRoot 'packages\frontend'
$VideoDir      = Join-Path $ProjectRoot 'packages\video-editor'
$LogDir        = Join-Path $ProjectRoot 'output\logs'

$envs = Get-PythonEnvs

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ---------------------------------------------------------------------------
# Local state
# ---------------------------------------------------------------------------

$restartCounts  = @{}
$maxRestarts    = 3
$script:NoWait  = $NoWait

# When stdin is not a console (redirected input, as AI agents typically run),
# do not block on the interactive 'q' loop — start services and return, leaving
# them running in the background.
try {
    if ([Console]::IsInputRedirected) { $script:NoWait = $true }
} catch {}

# Build the service list from switches. manage-servers.ps1 also knows about
# Go services and Atomic Chat, but start-studio.ps1 only manages the core
# frontend/backend stack by default.
$serviceList = @()
if (-not $NoBackend)  { $serviceList += 'backend' }
if (-not $NoFrontend) { $serviceList += 'frontend' }
if (-not $NoComfyUI)  { $serviceList += 'comfyui' }
if ($VideoEditor)     { $serviceList += 'video' }

# ---------------------------------------------------------------------------
# Service start / stop helpers (delegated to manage-servers.ps1)
# ---------------------------------------------------------------------------

function Restart-LaunchedService {
    param([string]$Service)
    if (-not $restartCounts.ContainsKey($Service)) { $restartCounts[$Service] = 0 }
    $restartCounts[$Service]++

    if ($restartCounts[$Service] -gt $maxRestarts) {
        Write-Warn "$Service has crashed $maxRestarts times - not restarting"
        return
    }

    $backoff = [Math]::Pow(2, $restartCounts[$Service] - 1)
    Write-Warn "$Service exited unexpectedly. Restarting ($($restartCounts[$Service])/$maxRestarts) in ${backoff}s..."

    $errLog = Join-Path $LogDir "$Service.err.log"
    Get-LogTail $errLog 10

    Start-Sleep -Seconds $backoff

    # Start-StudioService (from manage-servers.ps1) handles port checks,
    # process launch, health probing, and registration.
    Start-StudioService $Service
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

try {
    Write-Host '==============================================' -ForegroundColor Cyan
    Write-Host '  Native Media AI Studio - starting' -ForegroundColor Cyan
    Write-Host '==============================================' -ForegroundColor Cyan

    if ($Clean) {
        Write-Step "Clean mode — removing build artifacts and caches"
        $cleanDirs = @(
            Join-Path $ProjectRoot 'packages\frontend\dist',
            Join-Path $ProjectRoot 'packages\video-editor\dist',
            Join-Path $ProjectRoot 'packages\frontend\node_modules\.vite',
            Join-Path $ProjectRoot 'packages\video-editor\node_modules\.vite'
        )
        foreach ($dir in $cleanDirs) {
            if (Test-Path -LiteralPath $dir) {
                Remove-Item -LiteralPath $dir -Recurse -Force
                Write-Ok "Removed $dir"
            }
        }
    }

    # Reap stale processes from previous sessions so orphaned watchfiles,
    # uvicorn, vite, or node processes don't block new launches.
    Write-Step "Reaping stale processes from previous sessions"
    Reap-StaleProcesses

    # Free ports from stale owners before starting.
    foreach ($svc in $serviceList) {
        $port = $ServiceConfig[$svc].Port
        Stop-PortOwner -Port $port -Service $svc
    }
    Start-Sleep -Milliseconds 500

    Write-Step 'Starting services'
    foreach ($svc in $serviceList) {
        Start-StudioService $svc
    }

    Sync-PortsConfigToFrontend -ProjectRoot $ProjectRoot -FrontendDir $FrontendDir

    Write-Host ''
    Write-Host '==============================================' -ForegroundColor Green
    Write-Host '  Native Media AI Studio is running' -ForegroundColor Green
    Write-Host '==============================================' -ForegroundColor Green
    if ($serviceList -contains 'backend')  { Write-Host "  Backend : http://localhost:$BackendPort  (docs: /docs)" -ForegroundColor White }
    if ($serviceList -contains 'frontend') { Write-Host "  Frontend: http://localhost:$FrontendPort" -ForegroundColor White }
    if ($serviceList -contains 'comfyui')  { Write-Host "  ComfyUI : http://localhost:$ComfyUIPort" -ForegroundColor White }
    if ($VideoEditor)                      { Write-Host "  Video   : http://localhost:$VideoEditorPort" -ForegroundColor White }
    Write-Host "  Logs    : $LogDir" -ForegroundColor Gray
    Write-Host ''

    if ($Browser -and ($serviceList -contains 'frontend')) {
        Start-Process "http://localhost:$FrontendPort"
    }

    if ($script:NoWait) {
        Write-Host ''
        Write-Host 'Services started in the background (-NoWait). They keep running after this script exits.' -ForegroundColor Gray
    } else {
        Write-Host "Press 'q' (or Ctrl+C / close window) to stop everything..." -ForegroundColor Gray
        Write-Host "Auto-restart enabled for crashed services (max $maxRestarts restarts per service)" -ForegroundColor Gray

        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        while ($true) {
            if ($AutoQuitSeconds -gt 0 -and $sw.Elapsed.TotalSeconds -ge $AutoQuitSeconds) {
                Write-Host "`nAuto-quit after ${AutoQuitSeconds}s (test mode)" -ForegroundColor Gray
                break
            }
            try {
                if ([Console]::KeyAvailable) {
                    if ([Console]::ReadKey($true).Key -eq 'Q') { break }
                }
            } catch {
                Write-Verbose 'stdin is not a console; skipping key check'
            }

            # Auto-restart any crashed service.
            foreach ($svc in $serviceList) {
                $status = Get-ServiceStatus $svc
                if (-not $status.Running) {
                    Restart-LaunchedService -Service $svc
                }
            }

            # TTL-based reaping: kill any tracked process that has been running
            # longer than StaleProcessMaxAgeMinutes (default 30 min).
            $staleTracked = Get-TrackedProcesses | Where-Object {
                [int]((Get-Date) - $_.StartTime).TotalMinutes -gt $script:StaleProcessMaxAgeMinutes
            }
            foreach ($t in $staleTracked) {
                Write-Warn "TTL reaping: $($t.Name) (PID $($t.ProcessId)) has run for $([int]((Get-Date) - $t.StartTime).TotalMinutes)m — stopping"
                Stop-TrackedProcess -ProcessId $t.ProcessId
            }

            Start-Sleep -Milliseconds 500
        }
    }
} finally {
    Write-Host ''
    if ($script:NoWait) {
        Write-Host 'Services left running in the background.' -ForegroundColor Gray
    } else {
        Write-Host 'Stopping all services...' -ForegroundColor Yellow
        foreach ($svc in $serviceList) {
            try { Stop-StudioService $svc } catch { Write-Warn "Failed to stop ${svc}: $_" }
        }
        Stop-AllTrackedProcesses
        Write-Host 'All services stopped.' -ForegroundColor Green
    }
}
