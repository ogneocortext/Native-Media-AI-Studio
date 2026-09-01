<#
.SYNOPSIS
    Unified server management for Native Media AI Studio.
.DESCRIPTION
    Manages all services: Backend, Frontend, ComfyUI, Video Editor.
    Provides start, stop, restart, and status commands.
.PARAMETER Action
    Action to perform: start, stop, restart, status
.PARAMETER Services
    Services to manage: all, backend, frontend, comfyui, video
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action status
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action start -Services all
#>
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('start', 'stop', 'restart', 'status')]
    [string]$Action,

    [ValidateSet('all', 'backend', 'frontend', 'comfyui', 'video')]
    [string]$Services = 'all'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

# Service configuration
# Use CUDA-enabled conda environment for GPU features
$condaPython = 'D:\conda-envs\comfyui-cuda\Scripts\python.exe'
$venvPython = Join-Path $ProjectRoot 'venv\Scripts\python.exe'

# Prefer conda environment if available (CUDA support)
$backendPython = if (Test-Path $condaPython) { $condaPython } else { $venvPython }

$ServiceConfig = @{
    backend = @{
        Name = 'Backend'
        Port = 8000
        Python = $backendPython
        WorkingDir = Join-Path $ProjectRoot 'packages\backend'
        Args = @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000')
        LogFile = 'backend.log'
    }
    frontend = @{
        Name = 'Frontend'
        Port = 5173
        WorkingDir = Join-Path $ProjectRoot 'packages\frontend'
        LogFile = 'frontend.log'
        # Preferred: npm run dev
        Args = @('run', 'dev')
        # Fallback when npm is broken (fnm v26 ships incomplete npm):
        # node <packages/frontend>\node_modules\vite\bin\vite.js --port 5173
        NodeScript = Join-Path $ProjectRoot 'packages\frontend\node_modules\vite\bin\vite.js'
        NodeArgs = @('--port', '5173')
    }
    comfyui = @{
        Name = 'ComfyUI'
        Port = 8188
        Python = 'D:\conda-envs\comfyui-cuda\Scripts\python.exe'
        WorkingDir = 'D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI'
        Args = @('main.py', '--port', '8188', '--disable-pinned-memory')
        LogFile = 'comfyui.log'
    }
    video = @{
        Name = 'Video Editor'
        Port = 8080
        WorkingDir = Join-Path $ProjectRoot 'packages\video-editor'
        LogFile = 'video.log'
        # Preferred: npm run dev
        Args = @('run', 'dev')
        # Fallback: the package-local remotion CLI does not need a global npm.
        LocalCmd = Join-Path $ProjectRoot 'packages\video-editor\node_modules\.bin\remotion.cmd'
        LocalArgs = @('studio')
    }
}

$LogDir = Join-Path $ProjectRoot 'output\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Step { param([string]$msg) Write-Host "`n[$msg]" -ForegroundColor Cyan }
function Write-Ok   { param([string]$msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Err  { param([string]$msg) Write-Host "  [ERR] $msg" -ForegroundColor Red }

# Resolve a WORKING npm.cmd if one exists. On this machine npm can be broken
# (fnm v26 ships incomplete npm), so we probe it before trusting it.
function Resolve-Npm {
    $candidates = @()
    $fnmAlias = Join-Path $env:APPDATA 'fnm\aliases\default\npm.cmd'
    if (Test-Path $fnmAlias) { $candidates += $fnmAlias }
    $onPath = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($onPath) { $candidates += $onPath.Source }

    foreach ($cand in $candidates) {
        try {
            $null = & $cand --version 2>&1 | ForEach-Object { "$_" }
            if ($LASTEXITCODE -eq 0) { return $cand }
        } catch { }
    }
    return $null
}

# Resolve a WORKING node.exe runtime. fnm's "default" alias path is stable.
function Resolve-NodeExe {
    $candidates = @()
    $fnmAlias = Join-Path $env:APPDATA 'fnm\aliases\default\node.exe'
    if (Test-Path $fnmAlias) { $candidates += $fnmAlias }
    $onPath = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($onPath) { $candidates += $onPath.Source }

    foreach ($cand in $candidates) {
        try {
            $null = & $cand --version 2>&1 | ForEach-Object { "$_" }
            if ($LASTEXITCODE -eq 0) { return $cand }
        } catch { }
    }
    return $null
}

function Get-ServiceStatus {
    param([string]$ServiceName)
    $config = $ServiceConfig[$ServiceName]
    $port = $config.Port

    $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($listening) {
        return @{ Running = $true; Port = $port }
    }
    return @{ Running = $false; Port = $port }
}

function Stop-Service {
    param([string]$ServiceName)
    $config = $ServiceConfig[$ServiceName]
    $port = $config.Port

    $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique

    if ($pids) {
        Write-Warn "Stopping $($config.Name) (PIDs: $($pids -join ', '))"
        $pids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
    }
}

function Start-Service {
    param([string]$ServiceName)
    $config = $ServiceConfig[$ServiceName]

    # Check if already running
    $status = Get-ServiceStatus $ServiceName
    if ($status.Running) {
        Write-Ok "$($config.Name) already running on port $($config.Port)"
        return
    }

    Write-Step "Starting $($config.Name)"

    $logFile = Join-Path $LogDir $config.LogFile
    $errFile = Join-Path $LogDir ($config.LogFile -replace '\.log$', '.err.log')

    if ($config.Python) {
        # Python-based service
        if (-not (Test-Path $config.Python)) {
            Write-Err "Python not found: $($config.Python)"
            return
        }
        $proc = Start-Process -FilePath $config.Python `
            -ArgumentList $config.Args `
            -WorkingDirectory $config.WorkingDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput $logFile `
            -RedirectStandardError $errFile `
            -PassThru
    } else {
        # Node-based service. Try a working npm first, then fall back to
        # launching the package-local CLI directly (npm can be broken under fnm).
        $npm = Resolve-Npm
        if ($npm -and $npm -notmatch '\s') {
            # Only use npm if its path has no spaces (spaces break cmd.exe /c quoting)
            $argString = ($config.Args | ForEach-Object { "`"$_`"" }) -join ' '
            $proc = Start-Process -FilePath 'cmd.exe' `
                -ArgumentList '/c', "`"$npm`" $argString" `
                -WorkingDirectory $config.WorkingDir `
                -WindowStyle Hidden `
                -RedirectStandardOutput $logFile `
                -RedirectStandardError $errFile `
                -PassThru
        }
        elseif ($npm -and $npm -match '\s') {
            # npm path has spaces — use node directly with the package script
            Write-Warn "npm path has spaces ($npm), using node fallback"
            $node = Resolve-NodeExe
            if ($config.LocalCmd -and (Test-Path $config.LocalCmd)) {
                # e.g. video editor: node_modules\.bin\remotion.cmd studio
                # Call the .cmd directly (not through cmd.exe /c) to handle spaces in path
                $allArgs = @($config.LocalArgs | ForEach-Object { "$_" })
                $proc = Start-Process -FilePath $config.LocalCmd `
                    -ArgumentList $allArgs `
                    -WorkingDirectory $config.WorkingDir `
                    -WindowStyle Hidden `
                    -RedirectStandardOutput $logFile `
                    -RedirectStandardError $errFile `
                    -PassThru
            }
            elseif ($node -and $config.NodeScript -and (Test-Path $config.NodeScript)) {
                $nodeArgs = @("`"$($config.NodeScript)`"")
                $nodeArgs += $config.NodeArgs
                $proc = Start-Process -FilePath $node `
                    -ArgumentList $nodeArgs `
                    -WorkingDirectory $config.WorkingDir `
                    -WindowStyle Hidden `
                    -RedirectStandardOutput $logFile `
                    -RedirectStandardError $errFile `
                    -PassThru
            }
            else {
                Write-Err "No node fallback available for $($config.Name) (npm path has spaces)"
                return
            }
        }
        elseif ($config.LocalCmd -and (Test-Path $config.LocalCmd)) {
            # e.g. video editor: node_modules\.bin\remotion.cmd studio
            $localArgString = ($config.LocalArgs | ForEach-Object { "`"$_`"" }) -join ' '
            $proc = Start-Process -FilePath 'cmd.exe' `
                -ArgumentList '/c', "`"$($config.LocalCmd)`" $localArgString" `
                -WorkingDirectory $config.WorkingDir `
                -WindowStyle Hidden `
                -RedirectStandardOutput $logFile `
                -RedirectStandardError $errFile `
                -PassThru
        }
        elseif ($config.NodeScript -and (Test-Path $config.NodeScript)) {
            # e.g. frontend: node <repo>\node_modules\vite\bin\vite.js --port 5173
            $node = Resolve-NodeExe
            if (-not $node) {
                Write-Err "No working node.exe found (checked fnm default alias and PATH) - cannot start $($config.Name)"
                return
            }
            $nodeArgs = @("`"$($config.NodeScript)`"")
            $nodeArgs += $config.NodeArgs
            $proc = Start-Process -FilePath $node `
                -ArgumentList $nodeArgs `
                -WorkingDirectory $config.WorkingDir `
                -WindowStyle Hidden `
                -RedirectStandardOutput $logFile `
                -RedirectStandardError $errFile `
                -PassThru
        }
        else {
            Write-Err "No working npm, local CLI, or node script available for $($config.Name)"
            return
        }
    }

    Write-Host "  PID: $($proc.Id)" -ForegroundColor Gray

    # Wait for port to open
    for ($i = 1; $i -le 30; $i++) {
        Start-Sleep -Seconds 1
        $status = Get-ServiceStatus $ServiceName
        if ($status.Running) {
            Write-Ok "$($config.Name) listening on port $($config.Port) (waited ${i}s)"
            return
        }
    }
    Write-Warn "$($config.Name) did not open port $($config.Port) within 30s"
}

# Determine which services to manage
$serviceList = if ($Services -eq 'all') { @('backend', 'frontend', 'comfyui', 'video') } else { @($Services) }

switch ($Action) {
    'status' {
        Write-Host "`nService Status" -ForegroundColor Cyan
        Write-Host "===============" -ForegroundColor Cyan
        foreach ($svc in $serviceList) {
            $config = $ServiceConfig[$svc]
            $status = Get-ServiceStatus $svc
            $color = if ($status.Running) { 'Green' } else { 'Red' }
            $state = if ($status.Running) { 'RUNNING' } else { 'STOPPED' }
            Write-Host "  $($config.Name): " -NoNewline
            Write-Host $state -ForegroundColor $color -NoNewline
            Write-Host " (port $($config.Port))"
        }
        Write-Host ""
    }
    'start' {
        Write-Host "`nStarting services..." -ForegroundColor Cyan
        foreach ($svc in $serviceList) {
            try {
                Start-Service $svc
            } catch {
                Write-Warn "Failed to start $($ServiceConfig[$svc].Name): $_"
            }
        }
        Write-Host "`nAll requested services started." -ForegroundColor Green
    }
    'stop' {
        Write-Host "`nStopping services..." -ForegroundColor Yellow
        foreach ($svc in $serviceList) {
            try {
                Stop-Service $svc
            } catch {
                Write-Warn "Failed to stop $($ServiceConfig[$svc].Name): $_"
            }
        }
        Write-Host "`nAll requested services stopped." -ForegroundColor Green
    }
    'restart' {
        Write-Host "`nRestarting services..." -ForegroundColor Cyan
        foreach ($svc in $serviceList) {
            try {
                Stop-Service $svc
                Start-Sleep -Seconds 1
                Start-Service $svc
            } catch {
                Write-Warn "Failed to restart $($ServiceConfig[$svc].Name): $_"
            }
        }
        Write-Host "`nAll requested services restarted." -ForegroundColor Green
    }
}
