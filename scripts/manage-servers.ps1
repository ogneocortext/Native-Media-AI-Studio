<#
.SYNOPSIS
    Unified server management for Native Media AI Studio.
.DESCRIPTION
    Manages all services: Backend, Frontend, ComfyUI, Video Editor, Go Dashboard.
    Provides start, stop, restart, and status commands.
.PARAMETER Action
    Action to perform: start, stop, restart, status
.PARAMETER Services
    Services to manage: all, backend, frontend, comfyui, video, or a
    comma-separated list / string array (e.g. -Services backend,frontend).
.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action status
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action start -Services all
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action start -Services backend,frontend
#>
#Requires -Version 7.6
[CmdletBinding()]

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'health', 'update-comfyui')]
    [string]$Action,

    [ValidateSet('all', 'backend', 'frontend', 'comfyui', 'video', 'go-dashboard', 'go-media', 'go-worker', 'go-gateway', 'go-ports', 'atomic-chat')]
    [string[]]$Services = @('all'),

    [switch]$NoOrphanScan,

    [switch]$Json
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

# Load shared utilities (Resolve-*, Write-*, port helpers)
. (Join-Path $PSScriptRoot 'shared-utils.ps1')

$Ports = Get-PortsConfig -ProjectRoot $ProjectRoot

# Service configuration
# Backend/GPU: dedicated studio env (standalone venv, decoupled from
# space-analyzer-cuda and from ComfyUI). ComfyUI service uses comfyui-cuda.
$envs = Get-PythonEnvs
$studioPython = $envs.StudioPython
$condaPython  = $envs.ComfyPython
$venvPython   = $envs.VenvPython

# Backend interpreter: the verified chain (studio > ComfyUI > project
# venv, each probed for the backend's runtime imports). A broken env
# would otherwise be launched and fail far from the cause. The probe
# costs ~1 s and only matters when the backend may be launched, so
# read-only actions (status/health/stop) keep the cheap path-existence
# chain - $backendPython is never executed by them.
$backendPython = if ($Action -in @('start', 'restart')) {
    Resolve-BackendPython
} else {
    if (Test-Path $studioPython) { $studioPython }
    elseif (Test-Path $condaPython) { $condaPython }
    else { $venvPython }
}
if (-not $backendPython) {
    Write-Err 'No Python environment found for the backend.'
    Write-Err 'Create one: py -V:3.11 -m venv D:\conda-envs\nma-studio-cuda'
    exit 1
}

# ComfyUI interpreter: same idea, probed for what ComfyUI's main.py
# actually imports (torch). Verified when it may be launched; the
# read-only actions keep the cheap existence chain. A null resolution
# keeps the declared default so the service reports its own
# "Python not found" instead of a misleading downstream error.
$comfyPython = if ($Action -in @('start', 'restart')) {
    Resolve-ComfyUIPython
} else {
    if (Test-Path $condaPython) { $condaPython }
    elseif (Test-Path $studioPython) { $studioPython }
    else { $venvPython }
}
if (-not $comfyPython) { $comfyPython = $condaPython }

# Backend dev auto-reload: outer watchfiles watcher restarts uvicorn on .py
# changes. uvicorn's own --reload is deliberately not used - its Windows
# CTRL_C_EVENT-based restart wedges against this venv's launcher chain
# (the detached worker never receives the event, so the reloader blocks in
# join() forever), while watchfiles stops the child via TerminateProcess.
$backendTarget = Get-BackendTarget -Python $backendPython -Port $Ports.backend_port

$ServiceConfig = @{
    backend = @{
        Name = 'Backend'
        Port = $Ports.backend_port
        HealthPath = '/api/health'
        Python = $backendPython
        WorkingDir = Join-Path $ProjectRoot 'packages\backend'
        Args = @('-m', 'watchfiles', '--filter', 'python', '--target-type', 'command', $backendTarget)
        LogFile = 'backend.log'
    }
    frontend = @{
        Name = 'Frontend'
        Port = $Ports.frontend_port
        HealthPath = '/'
        WorkingDir = Join-Path $ProjectRoot 'packages\frontend'
        LogFile = 'frontend.log'
        # Preferred: pnpm run dev
        Args = @('run', 'dev')
        # Fallback when package manager path has spaces: run vite directly via node
        NodeScript = Join-Path -Path $ProjectRoot -ChildPath 'packages', 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'
        NodeArgs = @('--port', "$($Ports.frontend_port)")
    }
    comfyui = @{
        Name = 'ComfyUI'
        Port = $Ports.comfyui_port
        HealthPath = '/'
        Python = $comfyPython
        WorkingDir = 'D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI'
        Args = @('main.py', '--port', "$($Ports.comfyui_port)", '--disable-pinned-memory')
        LogFile = 'comfyui.log'
    }
    video = @{
        Name = 'Video Editor'
        Port = $Ports.video_editor_port
        HealthPath = '/'
        WorkingDir = Join-Path $ProjectRoot 'packages\video-editor'
        LogFile = 'video.log'
        # Preferred: pnpm run dev
        Args = @('run', 'dev')
        # Fallback: the package-local remotion CLI does not need a global npm.
        LocalCmd = Join-Path -Path $ProjectRoot -ChildPath 'packages', 'video-editor', 'node_modules', '.bin', 'remotion.cmd'
        LocalArgs = @('studio')
    }
    'atomic-chat' = @{
        Name = 'Atomic Chat'
        Port = $Ports.atomic_chat_port
        HealthPath = '/v1/models'
        LogFile = 'atomic-chat.log'
        # Atomic Chat is a desktop app (Electron/Jan-based) that exposes an
        # OpenAI-compatible API on port 1337. It is a native binary, not
        # Python or Node, so we launch it via LocalCmd with no args.
        LocalCmd = Join-Path -Path $env:LOCALAPPDATA -ChildPath 'Atomic Chat\Atomic-Chat.exe'
        LocalArgs = @()
    }
    'go-dashboard' = @{
        Name = 'Go Dashboard'
        Port = $Ports.dashboard_port
        HealthPath = '/api/health'
        WorkingDir = $ProjectRoot
        LogFile = 'go-dashboard.log'
        LocalCmd = Join-Path $ProjectRoot 'bin\go-dashboard.exe'
    }
    'go-media' = @{
        Name = 'Go Media'
        Port = $Ports.go_media_port
        HealthPath = '/api/health'
        WorkingDir = $ProjectRoot
        LogFile = 'go-media.log'
        LocalCmd = Join-Path $ProjectRoot 'bin\go-media.exe'
        LocalArgs = @('--server', '--port', "$($Ports.go_media_port)")
    }
    'go-worker' = @{
        Name = 'Go Worker'
        Port = $Ports.go_worker_port
        HealthPath = '/health'
        WorkingDir = $ProjectRoot
        LogFile = 'go-worker.log'
        LocalCmd = Join-Path $ProjectRoot 'bin\go-worker.exe'
    }
    'go-gateway' = @{
        Name = 'Go Gateway'
        Port = $Ports.go_gateway_port
        HealthPath = '/health'
        WorkingDir = $ProjectRoot
        LogFile = 'go-gateway.log'
        LocalCmd = Join-Path $ProjectRoot 'bin\go-gateway.exe'
    }
    'go-ports' = @{
        Name = 'Go Ports'
        Port = $Ports.go_ports_port
        HealthPath = '/api/health'
        WorkingDir = $ProjectRoot
        LogFile = 'go-ports.log'
        LocalCmd = Join-Path $ProjectRoot 'bin\go-ports.exe'
    }
}

$LogDir = Join-Path $ProjectRoot 'output\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$FrontendDir = Join-Path $ProjectRoot 'packages\frontend'

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

function Get-OrphanReloaders {
    # A `uvicorn --reload` (watchfiles) supervisor whose server child has died
    # keeps running: watchfiles waits for the next file change and respawns, so
    # killing the uvicorn child alone leaves a permanent no-op supervisor.
    # It holds no port, so Get-ServiceStatus reports the service as STOPPED and
    # `status` looks clean while the process tree leaks. Detect supervisors that
    # own no port and have no live server descendant.
    $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    $supervisors = $procs | Where-Object {
        $_.Name -eq 'python.exe' -and $_.CommandLine -match 'app\.main:app'
    }
    # The innermost process in the chain is the real server and owns the port.
    # Without this, it looks like a supervisor with no child and is flagged.
    $portHolders = @{}
    foreach ($c in (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)) {
        $portHolders[$c.OwningProcess] = $c.LocalPort
    }
    $orphans = @()
    foreach ($s in $supervisors) {
        if ($portHolders.ContainsKey($s.ProcessId)) { continue }
        $descendants = @()
        $frontier = @($s.ProcessId)
        while ($frontier.Count -gt 0) {
            $next = @()
            foreach ($p in $frontier) {
                $kids = @($procs | Where-Object { $_.ParentProcessId -eq $p })
                foreach ($k in $kids) { $descendants += $k; $next += $k.ProcessId }
            }
            $frontier = $next
        }
        # A healthy supervisor has a child that is the actual server process.
        $hasServer = @($descendants | Where-Object {
            $_.CommandLine -match 'app\.main:app' -and $_.ProcessId -ne $s.ProcessId
        }).Count -gt 0
        if (-not $hasServer) { $orphans += $s }
    }
    return $orphans
}

function Stop-StudioService {
    param([string]$ServiceName)
    $config = $ServiceConfig[$ServiceName]
    $port = $config.Port

    # uvicorn --reload spawns a reloader parent (cmdline contains `app.main:app`)
    # plus a child that actually binds the port. Kill the reloader parents first,
    # then reap listeners. Use Stop-ProcessTree so child processes (uvicorn
    # workers, etc.) are reaped too — not just the port owner.
    if ($ServiceName -eq 'backend') {
        $reloaders = Get-CimInstance Win32_Process -Filter 'Name="python.exe"' -ErrorAction SilentlyContinue |
                     Where-Object { $_.CommandLine -match 'app\.main:app' }
        if ($reloaders) {
            Write-Warn "Stopping $($config.Name) reloader PIDs: $(($reloaders | Select-Object -ExpandProperty ProcessId) -join ', ')"
            foreach ($r in $reloaders) {
                Stop-ProcessTree -ProcessId $r.ProcessId -Force
            }
        }
    }

    # Also stop any tracked process for this service (covers processes started
    # by start-studio.ps1 that may share the same PID space).
    $tracked = Get-TrackedProcesses | Where-Object { $_.Service -eq $ServiceName }
    foreach ($t in $tracked) {
        Stop-TrackedProcess -ProcessId $t.ProcessId
    }

    # Reap all remaining listeners on the service port. Repeated passes tolerate
    # Windows stale sockets (netstat can still show a LISTENING entry for a dead
    # PID until the socket is released) and any respawned reloader children.
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique
        if (-not $pids) { break }
        Write-Warn "Stopping $($config.Name) port listeners (PIDs: $($pids -join ', '), attempt $attempt)"
        foreach ($pid in $pids) {
            Stop-ProcessTree -ProcessId $pid -Force
        }
        Start-Sleep -Seconds 1
    }

    if (Test-PortInUse -Port $port) {
        Write-Warn "$($config.Name): port $port still bound after stop (stale socket may take a few seconds to release)"
    } else {
        Write-Ok "$($config.Name) stopped (port $port free)"
    }
}

function Start-StudioService {
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
        Register-StartedProcess -Process $proc -Service $ServiceName -ServiceName $config.Name
    }
    elseif ($config.LocalCmd) {
        # Native binary service (Go dashboard, etc.)
        if (-not (Test-Path $config.LocalCmd)) {
            Write-Err "Binary not found: $($config.LocalCmd)"
            return
        }
        $nativeArgs = if ($config.LocalArgs) { @($config.LocalArgs) } else { @() }
        $startParams = @{
            FilePath = $config.LocalCmd
            WorkingDirectory = $config.WorkingDir
            WindowStyle = 'Hidden'
            RedirectStandardOutput = $logFile
            RedirectStandardError = $errFile
            PassThru = $true
        }
        if ($nativeArgs.Count -gt 0) { $startParams.ArgumentList = $nativeArgs }
        $proc = Start-Process @startParams
        Register-StartedProcess -Process $proc -Service $ServiceName -ServiceName $config.Name
    }
    else {
        # Node-based service. Prefer pnpm (workspace-aware), then npm, then fall back to
        # launching the package-local CLI directly (npm can be broken under fnm).
        $packageManager = Resolve-Pnpm
        if (-not $packageManager) { $packageManager = Resolve-Npm }
        
        if ($packageManager -and $packageManager -notmatch '\s') {
            # Only use package manager if its path has no spaces (spaces break cmd.exe /c quoting)
            $argString = ($config.Args | ForEach-Object { "`"$_`"" }) -join ' '
            $proc = Start-Process -FilePath 'cmd.exe' `
                -ArgumentList '/c', "`"$packageManager`" $argString" `
                -WorkingDirectory $config.WorkingDir `
                -WindowStyle Hidden `
                -RedirectStandardOutput $logFile `
                -RedirectStandardError $errFile `
                -PassThru
            Register-StartedProcess -Process $proc -Service $ServiceName -ServiceName $config.Name
        }
        elseif ($packageManager -and $packageManager -match '\s') {
            # Package manager path has spaces — use node directly with the package script
            $pmName = [System.IO.Path]::GetFileNameWithoutExtension($packageManager)
            Write-Warn "$pmName path has spaces ($packageManager), using node fallback"
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
                Register-StartedProcess -Process $proc -Service $ServiceName -ServiceName $config.Name
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
                Register-StartedProcess -Process $proc -Service $ServiceName -ServiceName $config.Name
            }
            else {
                Write-Err "No node fallback available for $($config.Name) ($pmName path has spaces)"
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
            Register-StartedProcess -Process $proc -Service $ServiceName -ServiceName $config.Name
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
            Register-StartedProcess -Process $proc -Service $ServiceName -ServiceName $config.Name
        }
        else {
            Write-Err "No working package manager, local CLI, or node script available for $($config.Name)"
            return
        }
    }

    Write-Host "  PID: $($proc.Id)" -ForegroundColor Gray

    # Wait for port to open, then confirm the service is actually responding.
    # Use Wait-ForPort for the TCP listen, then a quick health probe loop
    # so a service that binds but doesn't respond fails fast (~5s) instead
    # of waiting the full window.
    $portOpened = Wait-ForPort -Port $port -Name $config.Name -MaxSeconds 15
    if (-not $portOpened) {
        Write-Warn "$($config.Name) did not open port $($config.Port) within 15s"
        return
    }

    # Confirm the service responds to HTTP (not just bound the port).
    for ($i = 1; $i -le 5; $i++) {
        if (Test-ServiceRunning -Port $port -HealthPath $config.HealthPath -TimeoutSec 2) {
            Write-Ok "$($config.Name) responding on port $($config.Port)"
            return
        }
        Start-Sleep -Seconds 1
    }
    Write-Warn "$($config.Name) bound port $($config.Port) but is not responding to HTTP"
}

# Determine which services to manage
# $Services is a string array: a single -Services all, a comma list, or
# the array start-services.ps1 passes all bind correctly.
$allServices = @('backend', 'frontend', 'comfyui', 'video', 'go-dashboard', 'go-media', 'go-worker', 'go-gateway', 'go-ports', 'atomic-chat')
$serviceList = if ($Services -contains 'all') { $allServices } else { $Services }

switch ($Action) {
    'status' {
        if ($Json) {
            # Machine-readable JSON output for agents
            $services = @()
            foreach ($svc in $serviceList) {
                $config = $ServiceConfig[$svc]
                $status = Get-ServiceStatus $svc
                $services += @{
                    name = $config.Name
                    id = $svc
                    port = $config.Port
                    running = $status.Running
                    note = $status.Note
                }
            }
            $tracked = Get-TrackedProcesses
            $trackedProcesses = if ($tracked) {
                foreach ($t in $tracked) {
                    $age = [int]((Get-Date) - $t.StartTime).TotalMinutes
                    @{
                        pid = $t.ProcessId
                        name = $t.Name
                        age_minutes = $age
                        service = $t.ServiceName
                    }
                }
            } else { @() }

            $orphans = if (-not $NoOrphanScan) { Get-OrphanReloaders } else { @() }
            $orphanProcesses = if ($orphans) {
                foreach ($o in $orphans) {
                    $age = [int]((Get-Date) - $o.CreationDate).TotalMinutes
                    @{
                        pid = $o.ProcessId
                        age_minutes = $age
                    }
                }
            } else { @() }

            $result = @{
                timestamp = (Get-Date).ToUniversalTime().ToString("o")
                services = $services
                tracked_processes = $trackedProcesses
                orphan_reloaders = $orphanProcesses
            }
            $result | ConvertTo-Json -Depth 10
        } else {
            # Human-readable output
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
            # Show any tracked processes (from start-studio.ps1 sessions).
            $tracked = Get-TrackedProcesses
            if ($tracked) {
                Write-Host "Tracked processes:" -ForegroundColor Cyan
                foreach ($t in $tracked) {
                    $age = [int]((Get-Date) - $t.StartTime).TotalMinutes
                    Write-Host "  PID $($t.ProcessId) $($t.Name) (started ${age}m ago, service: $($t.ServiceName))" -ForegroundColor Gray
                }
                Write-Host ""
            }
            if (-not $NoOrphanScan) {
                $orphans = Get-OrphanReloaders
                if ($orphans) {
                    Write-Host "Orphaned reloaders (no port held, safe to reap):" -ForegroundColor Yellow
                    foreach ($o in $orphans) {
                        $age = [int]((Get-Date) - $o.CreationDate).TotalMinutes
                        Write-Host "  pid $($o.ProcessId) (started ${age}m ago)" -ForegroundColor Yellow
                    }
                }
            } else {
                Write-Host "Orphan scan skipped (-NoOrphanScan). Run without the flag to scan." -ForegroundColor Gray
            }
        }
    }
    'start' {
        Write-Host "`nStarting services..." -ForegroundColor Cyan
        # Reap stale processes from previous sessions before starting anything,
        # so orphaned watchfiles/uvicorn/vite processes don't block new launches.
        Reap-StaleProcesses
        # PS 7+ parallel start: each service launches independently so a slow
        # service (ComfyUI, video editor) doesn't block the others. Throttle
        # to 4 to avoid port contention and log file storms.
        $serviceList | ForEach-Object -Parallel {
            $cfg = $using:ServiceConfig
            ${name} = $cfg[$_].Name
            try {
                Start-StudioService ${name}
            } catch {
                Write-Warn "Failed to start ${name}: $_"
            }
        } -ThrottleLimit 4
        Sync-PortsConfigToFrontend -ProjectRoot $ProjectRoot -FrontendDir $FrontendDir
        Write-Host "`nAll requested services started." -ForegroundColor Green
    }
    'stop' {
        Write-Host "`nStopping services..." -ForegroundColor Yellow
        $serviceList | ForEach-Object -Parallel {
            $cfg = $using:ServiceConfig
            ${name} = $cfg[$_].Name
            try {
                Stop-StudioService ${name}
            } catch {
                Write-Warn "Failed to stop ${name}: $_"
            }
        } -ThrottleLimit 4
        # Stop any remaining tracked processes (e.g. started by start-studio.ps1
        # in a previous session, or processes that weren't tied to a service config).
        Stop-AllTrackedProcesses
        Write-Host "`nAll requested services stopped." -ForegroundColor Green
    }
    'restart' {
        Write-Host "`nRestarting services..." -ForegroundColor Cyan
        # Stop all first (parallel), then start all (parallel).
        $serviceList | ForEach-Object -Parallel {
            $cfg = $using:ServiceConfig
            ${name} = $cfg[$_].Name
            try {
                Stop-StudioService ${name}
            } catch {
                Write-Warn "Failed to stop ${name}: $_"
            }
        } -ThrottleLimit 4
        Start-Sleep -Seconds 1
        $serviceList | ForEach-Object -Parallel {
            $cfg = $using:ServiceConfig
            ${name} = $cfg[$_].Name
            try {
                Start-StudioService ${name}
            } catch {
                Write-Warn "Failed to start ${name}: $_"
            }
        } -ThrottleLimit 4
        Sync-PortsConfigToFrontend -ProjectRoot $ProjectRoot -FrontendDir $FrontendDir
        Write-Host "`nAll requested services restarted." -ForegroundColor Green
    }
    'health' {
        Write-Host "`nHealth Check" -ForegroundColor Cyan
        Write-Host "============" -ForegroundColor Cyan
        foreach ($svc in $serviceList) {
            $config = $ServiceConfig[$svc]
            $status = Get-ServiceStatus $svc
            if ($status.Running) {
                $health = Test-ServiceRunning -Port $config.Port -HealthPath $config.HealthPath
                $color = if ($health) { 'Green' } else { 'Yellow' }
                $state = if ($health) { 'HEALTHY' } else { 'PORT OPEN BUT NOT RESPONDING' }
                Write-Host "  $($config.Name): " -NoNewline
                Write-Host $state -ForegroundColor $color -NoNewline
                Write-Host " (port $($config.Port))"
            } else {
                Write-Host "  $($config.Name): " -NoNewline
                Write-Host "DOWN" -ForegroundColor Red -NoNewline
                Write-Host " (port $($config.Port))"
            }
        }
        Write-Host ""
    }
    'update-comfyui' {
        Write-Host "`nTriggering ComfyUI Update" -ForegroundColor Cyan
        Write-Host "=========================" -ForegroundColor Cyan
        $comfyui = $ServiceConfig['comfyui']
        if (-not (Get-ServiceStatus 'comfyui').Running) {
            Write-Err "ComfyUI is not running. Start it first with: scripts\manage-servers.ps1 -Action start -Services comfyui"
            break
        }
        try {
            $body = @{} | ConvertTo-Json
            $response = Invoke-RestMethod -Uri "http://127.0.0.1:$($comfyui.Port)/api/services/comfyui/update" -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 120
            $response | ConvertTo-Json -Depth 10 | Write-Host
            Write-Ok "ComfyUI update request sent. Monitor logs for progress."
        } catch {
            Write-Err "Update request failed: $_"
        }
    }
}
