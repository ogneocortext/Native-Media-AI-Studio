<#
.SYNOPSIS
    One-command launcher for Native Media AI Studio (backend + frontend).
.DESCRIPTION
    Starts the FastAPI backend and the Vite frontend as hidden background
    processes, waits for both to become healthy, syncs the resolved port
    config to the frontend, opens the browser, and stops BOTH services
    when you press 'q' or close the window.
    Supports auto-restart for crashed services with exponential backoff.
.PARAMETER NoBackend
    Skip the backend (frontend only).
.PARAMETER NoFrontend
    Skip the frontend (backend only).
.PARAMETER VideoEditor
    Also start the Remotion video-editor studio.
.PARAMETER NoBrowser
    Do not auto-open the browser.
.PARAMETER NoComfyUI
    Skip ComfyUI even if it would otherwise start.
.PARAMETER Clean
    Remove build artifacts and caches before starting.
.PARAMETER AutoQuitSeconds
    Test hook: auto-stop all services after N seconds instead of waiting
    for 'q'.
.PARAMETER StudioPython
    Path to the studio CUDA Python. Defaults to the project's standard env.
.PARAMETER ComfyPython
    Path to the ComfyUI CUDA Python.
.PARAMETER ComfyUIPath
    Path to the ComfyUI checkout directory.
.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-studio.ps1
.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-studio.ps1 -NoComfyUI -Clean
#>
#Requires -Version 7.6
[CmdletBinding(SupportsShouldProcess=$true)]

param(
    [switch]$NoBackend,
    [switch]$NoFrontend,
    [switch]$VideoEditor,
    [switch]$NoBrowser,
    [switch]$NoComfyUI,
    [switch]$Clean,
    [int]$AutoQuitSeconds = 0,
    [string]$StudioPython = 'D:\conda-envs\nma-studio-cuda\Scripts\python.exe',
    [string]$ComfyPython = 'D:\conda-envs\comfyui-cuda\Scripts\python.exe',
    [string]$ComfyUIPath = 'D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

# Load shared utilities (Resolve-*, Write-*, port/process helpers)
. (Join-Path $PSScriptRoot 'shared-utils.ps1')

$Ports = Get-PortsConfig -ProjectRoot $ProjectRoot
$BackendPort      = $Ports.backend_port
$FrontendPort     = $Ports.frontend_port
$ComfyUIPort      = $Ports.comfyui_port
$VideoEditorPort  = $Ports.video_editor_port

$BackendDir    = Join-Path $ProjectRoot 'packages\backend'
$FrontendDir   = Join-Path $ProjectRoot 'packages\frontend'
$VideoDir      = Join-Path $ProjectRoot 'packages\video-editor'
$LogDir        = Join-Path $ProjectRoot 'output\logs'
$ProjectVenv   = Join-Path $ProjectRoot 'venv\Scripts\python.exe'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ---------------------------------------------------------------------------
# Local state
# ---------------------------------------------------------------------------

$script:started = @()   # @{ Name = 'Backend'; Process = <proc> }
$restartCounts  = @{}
$maxRestarts    = 3

# ---------------------------------------------------------------------------
# Preflight: Python environment
# ---------------------------------------------------------------------------

$python = if (Test-Path $StudioPython) {
    Write-Ok "Using studio environment: $StudioPython"
    $StudioPython
} elseif (Test-Path $ComfyPython) {
    Write-Ok "Using ComfyUI environment: $ComfyPython"
    $ComfyPython
} elseif (Test-Path $ProjectVenv) {
    Write-Ok "Using project venv: $ProjectVenv"
    $ProjectVenv
} else {
    Write-Err 'No Python environment found.'
    Write-Err 'Create one: py -V:3.11 -m venv D:\conda-envs\nma-studio-cuda'
    exit 1
}

# ---------------------------------------------------------------------------
# Service startup helpers
# ---------------------------------------------------------------------------

function Start-Backend {
    if (Test-PortInUse -Port $BackendPort) {
        if (Test-ServiceRunning -Port $BackendPort) {
            Write-Ok "Backend already running on port $BackendPort"
            return
        }
        Write-Warn "Port $BackendPort occupied but backend not responding"
        return
    }

    $backendLog    = Join-Path $LogDir 'backend.log'
    $backendErrLog = Join-Path $LogDir 'backend.err.log'
    $proc = Start-ProcessSafe `
        -FilePath $python `
        -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$BackendPort") `
        -WorkingDirectory $BackendDir `
        -LogFile $backendLog -ErrorLog $backendErrLog

    if ($proc) {
        $script:started += @{ Name = 'Backend'; Process = $proc }
        Wait-ForPort -Port $BackendPort -Name 'Backend' | Out-Null
    }
}

function Start-ComfyUI {
    if (Test-PortInUse -Port $ComfyUIPort) {
        if (Test-ServiceRunning -Port $ComfyUIPort -HealthPath '/') {
            Write-Ok "ComfyUI already running on port $ComfyUIPort"
            return
        }
        Write-Warn "Port $ComfyUIPort occupied but ComfyUI not responding"
        return
    }
    if (-not (Test-Path $ComfyPython)) {
        Write-Warn "ComfyUI Python not found at $ComfyPython - skipping"
        return
    }
    if (-not (Test-Path $ComfyUIPath)) {
        Write-Warn "ComfyUI path not found at $ComfyUIPath - skipping"
        return
    }

    $comfyuiLog    = Join-Path $LogDir 'comfyui.log'
    $comfyuiErrLog = Join-Path $LogDir 'comfyui.err.log'
    $proc = Start-ProcessSafe `
        -FilePath $ComfyPython `
        -ArgumentList @('main.py', '--port', "$ComfyUIPort", '--disable-pinned-memory') `
        -WorkingDirectory $ComfyUIPath `
        -LogFile $comfyuiLog -ErrorLog $comfyuiErrLog

    if ($proc) {
        $script:started += @{ Name = 'ComfyUI'; Process = $proc }
        Wait-ForPort -Port $ComfyUIPort -Name 'ComfyUI' | Out-Null
    }
}

function Start-Frontend {
    if (Test-PortInUse -Port $FrontendPort) {
        if (Test-ServiceRunning -Port $FrontendPort -HealthPath '/') {
            Write-Ok "Frontend already running on port $FrontendPort"
            return
        }
        Write-Warn "Port $FrontendPort occupied but frontend not responding"
        return
    }

    $frontendLog    = Join-Path $LogDir 'frontend.log'
    $frontendErrLog = Join-Path $LogDir 'frontend.err.log'
    $viteJs         = Join-Path $FrontendDir 'node_modules\vite\bin\vite.js'

    $proc = $null
    $pnpm = Resolve-Pnpm
    if ($pnpm) {
        $proc = Start-ProcessSafe -FilePath 'cmd.exe' `
            -ArgumentList @('/c', "`"$pnpm`" run dev") `
            -WorkingDirectory $FrontendDir `
            -LogFile $frontendLog -ErrorLog $frontendErrLog
    } else {
        $npm = Resolve-Npm
        if ($npm) {
            $proc = Start-ProcessSafe -FilePath 'cmd.exe' `
                -ArgumentList @('/c', "`"$npm`" run dev") `
                -WorkingDirectory $FrontendDir `
                -LogFile $frontendLog -ErrorLog $frontendErrLog
        } else {
            $node = Resolve-NodeExe
            if ($node -and (Test-Path $viteJs)) {
                $proc = Start-ProcessSafe -FilePath $node `
                    -ArgumentList @("`"$viteJs`"", '--port', "$FrontendPort") `
                    -WorkingDirectory $FrontendDir `
                    -LogFile $frontendLog -ErrorLog $frontendErrLog
            } else {
                Write-Warn 'Cannot start frontend: no working npm/pnpm/node+vite found'
            }
        }
    }

    if ($proc) {
        $script:started += @{ Name = 'Frontend'; Process = $proc }
        Wait-ForPort -Port $FrontendPort -Name 'Frontend' | Out-Null
    }
}

function Start-VideoEditor {
    if (Test-PortInUse -Port $VideoEditorPort) {
        if (Test-ServiceRunning -Port $VideoEditorPort -HealthPath '/') {
            Write-Ok "Video Editor already running on port $VideoEditorPort"
            return
        }
        Write-Warn "Port $VideoEditorPort occupied but Video Editor not responding"
        return
    }

    $videoLog    = Join-Path $LogDir 'video.log'
    $videoErrLog = Join-Path $LogDir 'video.err.log'
    $remotionCmd = Join-Path $VideoDir 'node_modules\.bin\remotion.cmd'

    $proc = $null
    if ($remotionCmd -and (Test-Path $remotionCmd)) {
        $proc = Start-ProcessSafe -FilePath 'cmd.exe' `
            -ArgumentList @('/c', "`"$remotionCmd`" studio") `
            -WorkingDirectory $VideoDir `
            -LogFile $videoLog -ErrorLog $videoErrLog
    } else {
        $pnpm = Resolve-Pnpm
        if ($pnpm) {
            $proc = Start-ProcessSafe -FilePath 'cmd.exe' `
                -ArgumentList @('/c', "`"$pnpm`" run dev") `
                -WorkingDirectory $VideoDir `
                -LogFile $videoLog -ErrorLog $videoErrLog
        } else {
            Write-Warn 'Cannot start Video Editor: no remotion CLI and no pnpm found'
        }
    }

    if ($proc) {
        $script:started += @{ Name = 'VideoEditor'; Process = $proc }
        Write-Ok "Video Editor starting (default http://localhost:$VideoEditorPort)"
    }
}

function Restart-Service {
    param([string]$Name)
    if (-not $restartCounts.ContainsKey($Name)) { $restartCounts[$Name] = 0 }
    $restartCounts[$Name]++

    if ($restartCounts[$Name] -gt $maxRestarts) {
        Write-Warn "$Name has crashed $maxRestarts times - not restarting"
        $script:started = @($script:started | Where-Object Name -ne $Name)
        return
    }

    $backoff = [Math]::Pow(2, $restartCounts[$Name] - 1)
    Write-Warn "$Name exited unexpectedly. Restarting ($($restartCounts[$Name])/$maxRestarts) in ${backoff}s..."

    $errLog = Join-Path $LogDir "$($Name.ToLower()).err.log"
    Get-LogTail $errLog 10

    Start-Sleep -Seconds $backoff

    $proc = $null
    switch ($Name) {
        'Backend' {
            $backendLog    = Join-Path $LogDir 'backend.log'
            $backendErrLog = Join-Path $LogDir 'backend.err.log'
            $proc = Start-ProcessSafe -FilePath $python `
                -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$BackendPort") `
                -WorkingDirectory $BackendDir `
                -LogFile $backendLog -ErrorLog $backendErrLog -AppendLog
            if ($proc) { Wait-ForPort -Port $BackendPort -Name 'Backend' | Out-Null }
        }
        'Frontend' {
            $frontendLog    = Join-Path $LogDir 'frontend.log'
            $frontendErrLog = Join-Path $LogDir 'frontend.err.log'
            $viteJs = Join-Path -Path $FrontendDir -ChildPath 'node_modules', 'vite', 'bin', 'vite.js'
            $pnpm = Resolve-Pnpm
            if ($pnpm) {
                $proc = Start-ProcessSafe -FilePath 'cmd.exe' `
                    -ArgumentList @('/c', "`"$pnpm`" run dev") `
                    -WorkingDirectory $FrontendDir `
                    -LogFile $frontendLog -ErrorLog $frontendErrLog -AppendLog
            } else {
                $npm = Resolve-Npm
                if ($npm) {
                    $proc = Start-ProcessSafe -FilePath 'cmd.exe' `
                        -ArgumentList @('/c', "`"$npm`" run dev") `
                        -WorkingDirectory $FrontendDir `
                        -LogFile $frontendLog -ErrorLog $frontendErrLog -AppendLog
                } elseif (Resolve-NodeExe -and (Test-Path $viteJs)) {
                    $proc = Start-ProcessSafe -FilePath (Resolve-NodeExe) `
                        -ArgumentList @("`"$viteJs`"", '--port', "$FrontendPort") `
                        -WorkingDirectory $FrontendDir `
                        -LogFile $frontendLog -ErrorLog $frontendErrLog -AppendLog
                }
            }
            if ($proc) { Wait-ForPort -Port $FrontendPort -Name 'Frontend' | Out-Null }
        }
        'ComfyUI' {
            $comfyuiLog    = Join-Path $LogDir 'comfyui.log'
            $comfyuiErrLog = Join-Path $LogDir 'comfyui.err.log'
            $proc = Start-ProcessSafe -FilePath $ComfyPython `
                -ArgumentList @('main.py', '--port', "$ComfyUIPort", '--disable-pinned-memory') `
                -WorkingDirectory $ComfyUIPath `
                -LogFile $comfyuiLog -ErrorLog $comfyuiErrLog -AppendLog
            if ($proc) { Wait-ForPort -Port $ComfyUIPort -Name 'ComfyUI' | Out-Null }
        }
        'VideoEditor' {
            $videoLog    = Join-Path $LogDir 'video.log'
            $videoErrLog = Join-Path $LogDir 'video.err.log'
    $remotionCmd = Join-Path -Path $VideoDir -ChildPath 'node_modules', '.bin', 'remotion.cmd'
            if ($remotionCmd -and (Test-Path $remotionCmd)) {
                $proc = Start-ProcessSafe -FilePath 'cmd.exe' `
                    -ArgumentList @('/c', "`"$remotionCmd`" studio") `
                    -WorkingDirectory $VideoDir `
                    -LogFile $videoLog -ErrorLog $videoErrLog -AppendLog
            } else {
                $pnpm = Resolve-Pnpm
                if ($pnpm) {
                    $proc = Start-ProcessSafe -FilePath 'cmd.exe' `
                        -ArgumentList @('/c', "`"$pnpm`" run dev") `
                        -WorkingDirectory $VideoDir `
                        -LogFile $videoLog -ErrorLog $videoErrLog -AppendLog
                }
            }
        }
    }

    if ($proc) {
        $idx = -1
        for ($i = 0; $i -lt $script:started.Length; $i++) {
            if ($script:started[$i].Name -eq $Name) { $idx = $i; break }
        }
        if ($idx -ge 0) { $script:started[$idx].Process = $proc }
        if ($proc) {
            Write-Ok "$Name restarted successfully"
        } else {
            Write-Warn "$Name restart failed - check logs"
        }
    }
}

function Stop-StartedServices {
    foreach ($s in $script:started) {
        if ($s.Process -and -not $s.Process.HasExited) {
            Stop-Process -Id $s.Process.Id -Force -ErrorAction SilentlyContinue
            Write-Host "  Stopped $($s.Name)" -ForegroundColor Gray
        }
    }
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

    if (-not $NoBackend) {
        Write-Step 'Starting backend (FastAPI)'
        Stop-PortOwner -Port $BackendPort -Service 'backend'
        Start-Sleep -Milliseconds 500
        Start-Backend
        Sync-PortsConfigToFrontend -ProjectRoot $ProjectRoot -FrontendDir $FrontendDir
    }

    if (-not $NoComfyUI) {
        Write-Step 'Starting ComfyUI'
        Stop-PortOwner -Port $ComfyUIPort -Service 'ComfyUI'
        Start-ComfyUI
    }

    if (-not $NoFrontend) {
        Write-Step 'Starting frontend (Vite)'
        Stop-PortOwner -Port $FrontendPort -Service 'frontend'
        Start-Frontend
    }

    if ($VideoEditor) {
        Write-Step 'Starting video editor (Remotion)'
        Start-VideoEditor
    }

    Write-Host ''
    Write-Host '==============================================' -ForegroundColor Green
    Write-Host '  Native Media AI Studio is running' -ForegroundColor Green
    Write-Host '==============================================' -ForegroundColor Green
    if (-not $NoBackend)  { Write-Host "  Backend : http://localhost:$BackendPort  (docs: /docs)" -ForegroundColor White }
    if (-not $NoFrontend) { Write-Host "  Frontend: http://localhost:$FrontendPort" -ForegroundColor White }
    if (-not $NoComfyUI)  { Write-Host "  ComfyUI : http://localhost:$ComfyUIPort" -ForegroundColor White }
    if ($VideoEditor)     { Write-Host "  Video   : http://localhost:$VideoEditorPort" -ForegroundColor White }
    Write-Host "  Logs    : $LogDir" -ForegroundColor Gray
    Write-Host ''

    if (-not $NoFrontend -and -not $NoBrowser) {
        Start-Process "http://localhost:$FrontendPort"
    }

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
        } catch { }

        foreach ($s in $script:started) {
            if ($s.Process -and $s.Process.HasExited) {
                Restart-Service -Name $s.Name
            }
        }
        Start-Sleep -Milliseconds 500
    }
} finally {
    Write-Host ''
    Write-Host 'Stopping all services...' -ForegroundColor Yellow
    Stop-StartedServices
    Write-Host 'All services stopped.' -ForegroundColor Green
}
