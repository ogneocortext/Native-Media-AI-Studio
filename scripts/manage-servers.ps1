<#
.SYNOPSIS
    Unified server management for Native Media AI Studio.
.DESCRIPTION
    Manages all services: Backend, Frontend, ComfyUI, Video Editor, Go Dashboard.
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

    [ValidateSet('all', 'backend', 'frontend', 'comfyui', 'video', 'go-dashboard', 'go-media', 'go-worker', 'go-gateway', 'go-ports')]
    [string]$Services = 'all'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

# Service configuration
# Backend/GPU: dedicated studio env (standalone venv, decoupled from
# space-analyzer-cuda and from ComfyUI). ComfyUI service uses comfyui-cuda.
$studioPython = 'D:\conda-envs\nma-studio-cuda\Scripts\python.exe'
$condaPython = 'D:\conda-envs\comfyui-cuda\Scripts\python.exe'
$venvPython = Join-Path $ProjectRoot 'venv\Scripts\python.exe'

# Prefer studio env > ComfyUI env > CPU fallback
$backendPython = if (Test-Path $studioPython) { $studioPython }
                 elseif (Test-Path $condaPython) { $condaPython }
                 else { $venvPython }

$ServiceConfig = @{
    backend = @{
        Name = 'Backend'
        Port = 8000
        HealthPath = '/api/health'
        Python = $backendPython
        WorkingDir = Join-Path $ProjectRoot 'packages\backend'
        Args = @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000', '--reload')
        LogFile = 'backend.log'
    }
    frontend = @{
        Name = 'Frontend'
        Port = 5173
        HealthPath = '/'
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
        HealthPath = '/'
        Python = 'D:\conda-envs\comfyui-cuda\Scripts\python.exe'
        WorkingDir = 'D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI'
        Args = @('main.py', '--port', '8188', '--disable-pinned-memory')
        LogFile = 'comfyui.log'
    }
    video = @{
        Name = 'Video Editor'
        Port = 8080
        HealthPath = '/'
        WorkingDir = Join-Path $ProjectRoot 'packages\video-editor'
        LogFile = 'video.log'
        # Preferred: npm run dev
        Args = @('run', 'dev')
        # Fallback: the package-local remotion CLI does not need a global npm.
        LocalCmd = Join-Path $ProjectRoot 'packages\video-editor\node_modules\.bin\remotion.cmd'
        LocalArgs = @('studio')
    }
    'go-dashboard' = @{
        Name = 'Go Dashboard'
        Port = 3847
        HealthPath = '/api/health'
        WorkingDir = $ProjectRoot
        LogFile = 'go-dashboard.log'
        LocalCmd = Join-Path $ProjectRoot 'bin\go-dashboard.exe'
    }
    'go-media' = @{
        Name = 'Go Media'
        Port = 3848
        HealthPath = '/api/health'
        WorkingDir = $ProjectRoot
        LogFile = 'go-media.log'
        LocalCmd = Join-Path $ProjectRoot 'bin\go-media.exe'
        LocalArgs = @('--server', '--port', '3848')
    }
    'go-worker' = @{
        Name = 'Go Worker'
        Port = 3849
        HealthPath = '/health'
        WorkingDir = $ProjectRoot
        LogFile = 'go-worker.log'
        LocalCmd = Join-Path $ProjectRoot 'bin\go-worker.exe'
    }
    'go-gateway' = @{
        Name = 'Go Gateway'
        Port = 3850
        HealthPath = '/health'
        WorkingDir = $ProjectRoot
        LogFile = 'go-gateway.log'
        LocalCmd = Join-Path $ProjectRoot 'bin\go-gateway.exe'
    }
    'go-ports' = @{
        Name = 'Go Ports'
        Port = 3851
        HealthPath = '/api/health'
        WorkingDir = $ProjectRoot
        LogFile = 'go-ports.log'
        LocalCmd = Join-Path $ProjectRoot 'bin\go-ports.exe'
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
    $healthPath = $config.HealthPath

    $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($listening) {
        # Verify the service is actually responding, not just the port being bound.
        if (Test-ServiceRunning -Port $port -HealthPath $healthPath) {
            return @{ Running = $true; Port = $port }
        }
        return @{ Running = $false; Port = $port; Note = "Port bound but service not responding" }
    }
    return @{ Running = $false; Port = $port }
}

function Test-ServiceRunning {
    param([int]$Port, [string]$HealthPath = "/api/health")
    try {
        # The backend /api/health handler probes adapters live (ComfyUI alone can
        # take >2s when offline), so allow enough time for a truthful result.
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port$HealthPath" -UseBasicParsing -TimeoutSec 6
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-PortInUse {
    param([int]$Port)
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Stop-Service {
    param([string]$ServiceName)
    $config = $ServiceConfig[$ServiceName]
    $port = $config.Port

    # uvicorn --reload spawns a reloader parent (cmdline contains `app.main:app`)
    # plus a child that actually binds the port. Killing only the child lets the
    # parent respawn it — so kill the reloader parents first, then reap listeners.
    if ($ServiceName -eq 'backend') {
        $reloaders = Get-CimInstance Win32_Process -Filter 'Name="python.exe"' -ErrorAction SilentlyContinue |
                     Where-Object { $_.CommandLine -match 'app\.main:app' }
        if ($reloaders) {
            Write-Warn "Stopping $($config.Name) reloader PIDs: $(($reloaders | Select-Object -ExpandProperty ProcessId) -join ', ')"
            $reloaders | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        }
    }

    # Reap all remaining listeners on the service port. Repeated passes tolerate
    # Windows stale sockets (netstat can still show a LISTENING entry for a dead
    # PID until the socket is released) and any respawned reloader children.
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique
        if (-not $pids) { break }
        Write-Warn "Stopping $($config.Name) (PIDs: $($pids -join ', '), attempt $attempt)"
        $pids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 1
    }

    if (Test-PortInUse -Port $port) {
        Write-Warn "$($config.Name): port $port still bound after stop (stale socket may take a few seconds to release)"
    } else {
        Write-Ok "$($config.Name) stopped (port $port free)"
    }
}

function Start-Service {
    param([string]$ServiceName)
    $config = $ServiceConfig[$ServiceName]
    $port = $config.Port

    # Check if already running (our service responding)
    $status = Get-ServiceStatus $ServiceName
    if ($status.Running) {
        Write-Ok "$($config.Name) already running on port $port"
        return
    }

    # Port is either free or bound by something else. If it is bound by a
    # non-responding process, do NOT start a duplicate on a different port —
    # the user must free the port manually.
    if (Test-PortInUse -Port $port) {
        Write-Err "$($config.Name) cannot start: port $port is occupied by a non-responding process"
        Write-Err "Recovery: run 'scripts\manage-servers.ps1 -Action stop -Services $ServiceName' to free the port, then start again"
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
    }
    elseif ($config.LocalCmd) {
        # Native binary service (Go dashboard, etc.)
        if (-not (Test-Path $config.LocalCmd)) {
            Write-Err "Binary not found: $($config.LocalCmd)"
            return
        }
        $proc = Start-Process -FilePath $config.LocalCmd `
            -WorkingDirectory $config.WorkingDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput $logFile `
            -RedirectStandardError $errFile `
            -PassThru
    }
    else {
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
    $serviceList = if ($Services -eq 'all') { @('backend', 'frontend', 'comfyui', 'video', 'go-dashboard', 'go-media', 'go-worker', 'go-gateway', 'go-ports') } else { @($Services) }

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
