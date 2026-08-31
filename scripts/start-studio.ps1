<#
.SYNOPSIS
    One-command launcher for Native Media AI Studio (backend + frontend).
.DESCRIPTION
    Starts the FastAPI backend (repo-root venv) and the Vite frontend,
    waits for both to become healthy, syncs the resolved port config to the
    frontend, opens the browser, and stops BOTH services when you press
    'q' or close the window.
.PARAMETER NoBackend
    Skip the backend (frontend only)
.PARAMETER NoFrontend
    Skip the frontend (backend only)
.PARAMETER VideoEditor
    Also start the Remotion video-editor studio
.PARAMETER NoBrowser
    Do not auto-open the browser
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-studio.ps1
#>
param(
    [switch]$NoBackend,
    [switch]$NoFrontend,
    [switch]$VideoEditor,
    [switch]$NoBrowser,
    [switch]$NoComfyUI,
    # Test hook: auto-stop all services after N seconds instead of waiting for 'q'
    [int]$AutoQuitSeconds = 0
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $ProjectRoot 'packages\backend'
$FrontendDir = Join-Path $ProjectRoot 'packages\frontend'
$VideoDir = Join-Path $ProjectRoot 'packages\video-editor'
$LogDir = Join-Path $ProjectRoot 'output\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$BackendPort = 8000
$FrontendPort = 5173
$ComfyUIPort = 8188
$started = @()   # @{ Name; Process }

function Write-Step { param([string]$msg) Write-Host "`n[$msg]" -ForegroundColor Cyan }
function Write-Ok   { param([string]$msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn2{ param([string]$msg) Write-Host "  [!!] $msg" -ForegroundColor Yellow }

function Stop-PortOwner {
    param([int]$Port, [string]$Service)
    $pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    if ($pids) {
        Write-Warn2 "Port $Port busy - stopping stale $Service process(es): $($pids -join ', ')"
        $pids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
    }
}

function Wait-ForPort {
    param([int]$Port, [string]$Name, [int]$MaxSeconds = 45)
    for ($i = 1; $i -le $MaxSeconds; $i++) {
        # Port-listen check is immune to IPv4/IPv6 binding differences
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            Write-Ok "$Name listening on port $Port (waited ${i}s)"
            return $true
        }
        Start-Sleep -Seconds 1
    }
    Write-Warn2 "$Name did not open port $Port within ${MaxSeconds}s (check logs in output\logs)"
    return $false
}

function Start-ProcessSafe {
    <#
    .SYNOPSIS
        Start a process and validate it launched successfully.
    .OUTPUTS
        The process object, or $null if it failed to start.
    #>
    param(
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory,
        [string]$LogFile,
        [string]$ErrorLog,
        [switch]$AppendLog
    )
    try {
        $procArgs = @{
            FilePath = $FilePath
            ArgumentList = $ArgumentList
            WorkingDirectory = $WorkingDirectory
            WindowStyle = 'Hidden'
            PassThru = $true
        }
        if ($AppendLog) {
            # Append mode: use cmd.exe to redirect with >>
            $redirect = ">> `"$LogFile`" 2>> `"$ErrorLog`""
            $procArgs['FilePath'] = 'cmd.exe'
            $procArgs['ArgumentList'] = @('/c', "`"$FilePath`" $($ArgumentList -join ' ') $redirect")
        } else {
            $procArgs['RedirectStandardOutput'] = $LogFile
            $procArgs['RedirectStandardError'] = $ErrorLog
        }
        $proc = Start-Process @procArgs
        # Validate process started (not immediately exited)
        Start-Sleep -Milliseconds 200
        if ($proc.HasExited) {
            Write-Warn2 "Process exited immediately (code $($proc.ExitCode)) - check $ErrorLog"
            return $null
        }
        return $proc
    } catch {
        Write-Warn2 "Failed to start process: $_"
        return $null
    }
}

function Get-LogTail {
    param([string]$LogFile, [int]$Lines = 10)
    if (Test-Path $LogFile) {
        $content = Get-Content $LogFile -Tail $Lines -ErrorAction SilentlyContinue
        if ($content) {
            Write-Host "  --- Last $Lines lines of $LogFile ---" -ForegroundColor DarkGray
            $content | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        }
    }
}

# Resolve a WORKING npm.cmd if one exists (may not - see Resolve-NodeExe).
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



# Cleanup on exit: Ctrl+C, 'q', or window close
function Stop-All {
    foreach ($s in $script:started) {
        if ($s.Process -and -not $s.Process.HasExited) {
            Stop-Process -Id $s.Process.Id -Force -ErrorAction SilentlyContinue
            Write-Host "  Stopped $($s.Name)" -ForegroundColor Gray
        }
    }
}

try {

Write-Host '==============================================' -ForegroundColor Cyan
Write-Host '  Native Media AI Studio - starting' -ForegroundColor Cyan
Write-Host '==============================================' -ForegroundColor Cyan

# --- Preflight: Python environment ---
# Use CUDA-enabled conda environment for GPU features
$condaPython = 'D:\conda-envs\comfyui-cuda\Scripts\python.exe'
$venvPython = Join-Path $ProjectRoot 'venv\Scripts\python.exe'

# Prefer conda environment if available (CUDA support)
if (Test-Path $condaPython) {
    $venvPython = $condaPython
    Write-Ok "Using CUDA-enabled conda environment: $condaPython"
} elseif (Test-Path $venvPython) {
    Write-Ok "Using local venv: $venvPython (CPU-only, no CUDA)"
} else {
    Write-Warn2 "No Python environment found!"
    Write-Warn2 "Create conda env: conda env create -f environment.yml"
    Write-Warn2 "Or create venv: py -V:3.11 -m venv venv && venv\Scripts\python -m pip install -r packages\backend\requirements.txt"
    exit 1
}

# --- Backend ---
if (-not $NoBackend) {
    Write-Step 'Starting backend (FastAPI)'
    Stop-PortOwner -Port $BackendPort -Service 'backend'

    $backendLog = Join-Path $LogDir 'backend.log'
    $backendErrLog = Join-Path $LogDir 'backend.err.log'
    # Fresh log on initial start (restarts append)
    $proc = Start-ProcessSafe -FilePath $venvPython `
        -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$BackendPort") `
        -WorkingDirectory $BackendDir `
        -LogFile $backendLog -ErrorLog $backendErrLog
    
    if ($proc) {
        $script:started += @{ Name = 'Backend'; Process = $proc }
        $ready = Wait-ForPort -Port $BackendPort -Name 'Backend'
        if (-not $ready) {
            Write-Warn2 "Backend failed to start - check $backendErrLog"
            Get-LogTail $backendErrLog 15
        }
    } else {
        Write-Warn2 "Could not launch backend process"
    }

    # Sync the resolved port config into the frontend's static public config
    $portsFile = Join-Path $ProjectRoot 'config\ports.json'
    $publicConfig = Join-Path $FrontendDir 'public\config'
    if (Test-Path $portsFile) {
        New-Item -ItemType Directory -Force -Path $publicConfig | Out-Null
        Copy-Item $portsFile (Join-Path $publicConfig 'ports.json') -Force
        Write-Ok 'Synced config/ports.json -> frontend/public/config/'
    }
}

# --- ComfyUI ---
if (-not $NoComfyUI) {
    Write-Step 'Starting ComfyUI'
    Stop-PortOwner -Port $ComfyUIPort -Service 'ComfyUI'

    $comfyuiPython = 'D:\conda-envs\comfyui-cuda\Scripts\python.exe'
    $comfyuiPath = 'D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI'

    if (Test-Path $comfyuiPython) {
        $comfyuiLog = Join-Path $LogDir 'comfyui.log'
        $comfyuiErrLog = Join-Path $LogDir 'comfyui.err.log'
        $proc = Start-ProcessSafe -FilePath $comfyuiPython `
            -ArgumentList @('main.py', '--port', "$ComfyUIPort", '--disable-pinned-memory') `
            -WorkingDirectory $comfyuiPath `
            -LogFile $comfyuiLog -ErrorLog $comfyuiErrLog
        
        if ($proc) {
            $script:started += @{ Name = 'ComfyUI'; Process = $proc }
            $ready = Wait-ForPort -Port $ComfyUIPort -Name 'ComfyUI'
            if (-not $ready) {
                Write-Warn2 "ComfyUI failed to start - check $comfyuiErrLog"
                Get-LogTail $comfyuiErrLog 15
            }
        } else {
            Write-Warn2 "Could not launch ComfyUI process"
        }
    } else {
        Write-Warn2 "ComfyUI Python not found at $comfyuiPython - skipping"
    }
}

# --- Frontend ---
if (-not $NoFrontend) {
    Write-Step 'Starting frontend (Vite)'
    Stop-PortOwner -Port $FrontendPort -Service 'frontend'

    $frontendLog = Join-Path $LogDir 'frontend.log'
    $frontendErrLog = Join-Path $LogDir 'frontend.err.log'
    $npm = Resolve-Npm
    if ($npm) {
        Write-Ok "Using npm: $npm"
        $proc = Start-ProcessSafe -FilePath 'cmd.exe' `
            -ArgumentList @('/c', "`"$npm`" run dev") `
            -WorkingDirectory $FrontendDir `
            -LogFile $frontendLog -ErrorLog $frontendErrLog
    } else {
        # npm is broken on this system (fnm v26 ships incomplete npm) -
        # launch Vite directly through the node runtime instead.
        $node = Resolve-NodeExe
        $viteJs = Join-Path $FrontendDir 'node_modules\vite\bin\vite.js'
        if (-not $node) {
            Write-Warn2 'No working node.exe found (checked fnm default alias and PATH)'
            return
        }
        if (-not (Test-Path $viteJs)) {
            Write-Warn2 "Vite not found at $viteJs - run an install first"
            return
        }
        Write-Warn2 "npm unavailable - launching Vite directly via $node"
        $proc = Start-ProcessSafe -FilePath $node `
            -ArgumentList @("`"$viteJs`"", '--port', "$FrontendPort") `
            -WorkingDirectory $FrontendDir `
            -LogFile $frontendLog -ErrorLog $frontendErrLog
    }
    
    if ($proc) {
        $script:started += @{ Name = 'Frontend'; Process = $proc }
        $ready = Wait-ForPort -Port $FrontendPort -Name 'Frontend'
        if (-not $ready) {
            Write-Warn2 "Frontend failed to start - check $frontendErrLog"
            Get-LogTail $frontendErrLog 15
        }
    } else {
        Write-Warn2 "Could not launch frontend process"
    }
}

# --- Optional: video editor ---
if ($VideoEditor) {
    Write-Step 'Starting video editor (Remotion)'
    # Use the package-local remotion CLI - does not depend on global npm
    $remotionCmd = Join-Path $VideoDir 'node_modules\.bin\remotion.cmd'
    if (Test-Path $remotionCmd) {
        $proc = Start-Process -FilePath 'cmd.exe' `
            -ArgumentList '/c', "`"$remotionCmd`" studio" `
            -WorkingDirectory $VideoDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $LogDir 'video.log') `
            -RedirectStandardError (Join-Path $LogDir 'video.err.log') `
            -PassThru
    } else {
        Write-Warn2 'Local remotion CLI missing - falling back to npm run dev'
        $proc = Start-Process -FilePath 'cmd.exe' `
            -ArgumentList '/c', 'npm run dev' `
            -WorkingDirectory $VideoDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $LogDir 'video.log') `
            -RedirectStandardError (Join-Path $LogDir 'video.err.log') `
            -PassThru
    }
    $script:started += @{ Name = 'VideoEditor'; Process = $proc }
    Write-Ok 'Video editor studio starting (default http://localhost:3000)'
}

# --- Monitor until user quits ---
Write-Host ''
Write-Host '==============================================' -ForegroundColor Green
Write-Host '  Native Media AI Studio is running' -ForegroundColor Green
Write-Host '==============================================' -ForegroundColor Green
if (-not $NoBackend)  { Write-Host "  Backend : http://localhost:$BackendPort  (docs: /docs)" -ForegroundColor White }
if (-not $NoFrontend) { Write-Host "  Frontend: http://localhost:$FrontendPort" -ForegroundColor White }
if (-not $NoComfyUI)  { Write-Host '  ComfyUI : http://localhost:8188' -ForegroundColor White }
if ($VideoEditor)     { Write-Host '  Video   : http://localhost:3000' -ForegroundColor White }
Write-Host "  Logs    : $LogDir" -ForegroundColor Gray
Write-Host ''

if (-not $NoFrontend -and -not $NoBrowser) {
    Start-Process "http://localhost:$FrontendPort"
}

# --- Monitor until user quits ---
Write-Host "Press 'q' (or Ctrl+C / close window) to stop everything..." -ForegroundColor Gray
Write-Host "Auto-restart enabled for crashed services (max 3 restarts per service)" -ForegroundColor Gray
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$restartCounts = @{}  # Track restart counts per service
$maxRestarts = 3

while ($true) {
    if ($AutoQuitSeconds -gt 0 -and $sw.Elapsed.TotalSeconds -ge $AutoQuitSeconds) {
        Write-Host "`nAuto-quit after ${AutoQuitSeconds}s (test mode)" -ForegroundColor Gray
        break
    }
    try {
        if ([Console]::KeyAvailable) {
            if ([Console]::ReadKey($true).Key -eq 'Q') { break }
        }
    } catch { }  # stdin not a console (redirected) - just keep watching

    foreach ($s in $script:started) {
        if ($s.Process.HasExited) {
            $name = $s.Name
            $exitCode = $s.Process.ExitCode

            if (-not $restartCounts.ContainsKey($name)) { $restartCounts[$name] = 0 }
            $restartCounts[$name]++

            if ($restartCounts[$name] -le $maxRestarts) {
                # Exponential backoff: 1s, 2s, 4s
                $backoff = [Math]::Pow(2, $restartCounts[$name] - 1)
                Write-Warn2 "$name exited unexpectedly (code $exitCode). Restarting ($($restartCounts[$name])/$maxRestarts) in ${backoff}s..."
                
                # Show crash diagnostics
                $errLog = Join-Path $LogDir "$($name.ToLower()).err.log"
                Get-LogTail $errLog 10
                
                Start-Sleep -Seconds $backoff
                
                # Restart the service based on its type (append logs on restart)
                switch ($name) {
                    "Backend" {
                        $s.Process = Start-ProcessSafe -FilePath $venvPython `
                            -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$BackendPort") `
                            -WorkingDirectory $BackendDir `
                            -LogFile $backendLog -ErrorLog $backendErrLog -AppendLog
                        if ($s.Process) {
                            Wait-ForPort -Port $BackendPort -Name 'Backend' | Out-Null
                        }
                    }
                    "Frontend" {
                        $npm = Resolve-Npm
                        if ($npm) {
                            $s.Process = Start-ProcessSafe -FilePath 'cmd.exe' `
                                -ArgumentList @('/c', "`"$npm`" run dev") `
                                -WorkingDirectory $FrontendDir `
                                -LogFile $frontendLog -ErrorLog $frontendErrLog -AppendLog
                        } else {
                            $node = Resolve-NodeExe
                            $viteJs = Join-Path $FrontendDir 'node_modules\vite\bin\vite.js'
                            $s.Process = Start-ProcessSafe -FilePath $node `
                                -ArgumentList @("`"$viteJs`"", '--port', "$FrontendPort") `
                                -WorkingDirectory $FrontendDir `
                                -LogFile $frontendLog -ErrorLog $frontendErrLog -AppendLog
                        }
                        if ($s.Process) {
                            Wait-ForPort -Port $FrontendPort -Name 'Frontend' | Out-Null
                        }
                    }
                    "ComfyUI" {
                        $s.Process = Start-ProcessSafe -FilePath $comfyuiPython `
                            -ArgumentList @('main.py', '--port', "$ComfyUIPort", '--disable-pinned-memory') `
                            -WorkingDirectory $comfyuiPath `
                            -LogFile $comfyuiLog -ErrorLog $comfyuiErrLog -AppendLog
                        if ($s.Process) {
                            Wait-ForPort -Port $ComfyUIPort -Name 'ComfyUI' | Out-Null
                        }
                    }
                    "VideoEditor" {
                        $remotionCmd = Join-Path $VideoDir 'node_modules\.bin\remotion.cmd'
                        if (Test-Path $remotionCmd) {
                            $s.Process = Start-ProcessSafe -FilePath 'cmd.exe' `
                                -ArgumentList @('/c', "`"$remotionCmd`" studio") `
                                -WorkingDirectory $VideoDir `
                                -LogFile (Join-Path $LogDir 'video.log') -ErrorLog (Join-Path $LogDir 'video.err.log') -AppendLog
                        } else {
                            $s.Process = Start-ProcessSafe -FilePath 'cmd.exe' `
                                -ArgumentList @('/c', 'npm run dev') `
                                -WorkingDirectory $VideoDir `
                                -LogFile (Join-Path $LogDir 'video.log') -ErrorLog (Join-Path $LogDir 'video.err.log') -AppendLog
                        }
                    }
                    default {
                        Write-Warn2 "Cannot auto-restart $name - unknown service type"
                    }
                }
                if ($s.Process) {
                    Write-Ok "$name restarted successfully"
                } else {
                    Write-Warn2 "$name restart failed - check logs"
                }
            } else {
                Write-Warn2 "$name has crashed $maxRestarts times - not restarting. Check logs."
                # Remove from monitoring list to prevent infinite loop
                $script:started = @($script:started | Where-Object { $_.Name -ne $name })
            }
        }
    }
    Start-Sleep -Milliseconds 500
}

} finally {
    Write-Host ''
    Write-Host 'Stopping all services...' -ForegroundColor Yellow
    Stop-All
    Write-Host 'All services stopped.' -ForegroundColor Green
}
