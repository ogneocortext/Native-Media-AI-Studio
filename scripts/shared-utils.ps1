<#
.SYNOPSIS
    Shared utility functions for Native Media AI Studio PowerShell scripts.
.DESCRIPTION
    Dot-source this file from other scripts to get common utilities:
    - Package manager resolution (Resolve-Npm, Resolve-Pnpm)
    - Node runtime resolution (Resolve-NodeExe)
    - Port configuration loading (Get-PortsConfig)
    - Port testing (Test-PortInUse, Test-ServiceRunning)
    - Process helpers (Start-ProcessSafe, Wait-ForPort, Get-LogTail, Stop-PortOwner)
    - Console output helpers (Write-Step, Write-Ok, Write-Warn, Write-Err)
.NOTES
    This module is intentionally free of side effects. Scripts that dot-source
    it must define $ProjectRoot before calling Get-PortsConfig.
#>

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Package manager / runtime resolution
# ---------------------------------------------------------------------------

function Resolve-Executable {
    <#
    .SYNOPSIS
        Return the first WORKING executable path for a tool, or $null.
    .DESCRIPTION
        fnm v26 can ship broken shims, so every candidate is probed with
        `--version` before being trusted. The fnm "default" alias is tried
        before PATH because it stays stable across shell restarts.
    .PARAMETER Name
        Executable name to resolve, e.g. 'pnpm.cmd' or 'node.exe'.
    #>
    param([Parameter(Mandatory)][string]$Name)

    $candidates = @(
        Join-Path -Path $env:APPDATA -ChildPath 'fnm', 'aliases', 'default', $Name
        (Get-Command $Name -ErrorAction SilentlyContinue).Source
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

    foreach ($candidate in $candidates) {
        try {
            $null = & $candidate --version 2>$null
            if ($LASTEXITCODE -eq 0) { return $candidate }
        } catch {
            Write-Verbose "Resolve-Executable: '$candidate' failed: $($_.Exception.Message)"
        }
    }
    return $null
}

function Resolve-Npm { Resolve-Executable -Name 'npm.cmd' }
function Resolve-Pnpm { Resolve-Executable -Name 'pnpm.cmd' }
function Resolve-NodeExe { Resolve-Executable -Name 'node.exe' }

# ---------------------------------------------------------------------------
# Port configuration
# ---------------------------------------------------------------------------

function Get-PortFromUrl {
    <#
    .SYNOPSIS
        Extract the port from a service URL, falling back to a default.
    .DESCRIPTION
        Replaces fragile `$url.Split(':')[-1]` parsing with [Uri] parsing so
        IPv6 hosts, trailing slashes, or path segments cannot corrupt it.
    #>
    param([string]$Url, [int]$Default)
    if ([string]::IsNullOrWhiteSpace($Url)) { return $Default }
    $uri = $null
    if ([uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -and $uri.Port -gt 0) {
        return $uri.Port
    }
    return $Default
}

function Get-PortsConfig {
    <#
    .SYNOPSIS
        Load service ports from config/ports.json, falling back to defaults.
    .DESCRIPTION
        Falls back per key, so one missing/invalid entry no longer discards
        every other resolved port.
    .PARAMETER ProjectRoot
        Repo root directory.
    #>
    param([string]$ProjectRoot)

    if (-not $ProjectRoot) { throw 'Get-PortsConfig: -ProjectRoot is required' }

    $defaults = @{
        backend_port      = 8000
        frontend_port     = 5173
        comfyui_port      = 8188
        video_editor_port = 8080
        dashboard_port    = 3847
        go_dashboard_port = 3847
        go_media_port     = 3848
        go_worker_port    = 3849
        go_gateway_port   = 3850
        go_ports_port     = 3851
    }

    $portsFile = Join-Path $ProjectRoot 'config\ports.json'
    if (Test-Path -LiteralPath $portsFile) {
        try {
            $json = Get-Content -LiteralPath $portsFile -Raw | ConvertFrom-Json -AsHashtable
            return @{
                backend_port      = [int]($json['backend_port'] ?? $defaults.backend_port)
                frontend_port     = [int]($json['frontend_port'] ?? $defaults.frontend_port)
                comfyui_port      = [int]($json['comfyui_port'] ?? $defaults.comfyui_port)
                video_editor_port = [int]($json['video_editor_port'] ?? $defaults.video_editor_port)
                dashboard_port    = [int]($json['dashboard_port'] ?? $defaults.dashboard_port)
                go_dashboard_port = [int]($json['go_dashboard_port'] ?? $json['dashboard_port'] ?? $defaults.go_dashboard_port)
                go_media_port     = Get-PortFromUrl -Url $json['go_media_url'] -Default $defaults.go_media_port
                go_worker_port    = Get-PortFromUrl -Url $json['go_worker_url'] -Default $defaults.go_worker_port
                go_gateway_port   = Get-PortFromUrl -Url $json['go_gateway_url'] -Default $defaults.go_gateway_port
                go_ports_port     = Get-PortFromUrl -Url $json['go_ports_url'] -Default $defaults.go_ports_port
            }
        } catch {
            Write-Warn "Failed to parse config/ports.json ($($_.Exception.Message)) - using defaults"
        }
    }
    return $defaults
}

function Sync-PortsConfigToFrontend {
    <#
    .SYNOPSIS
        Copy config/ports.json into the frontend's public config directory
        so the UI can read resolved ports at runtime.
    .PARAMETER ProjectRoot
        Repo root directory.
    .PARAMETER FrontendDir
        Absolute path to packages/frontend.
    #>
    param([string]$ProjectRoot, [string]$FrontendDir)
    $portsFile = Join-Path $ProjectRoot 'config\ports.json'
    if (Test-Path -LiteralPath $portsFile) {
        $publicConfig = Join-Path $FrontendDir 'public\config'
        New-Item -ItemType Directory -Force -Path $publicConfig | Out-Null
        Copy-Item -LiteralPath $portsFile -Destination (Join-Path $publicConfig 'ports.json') -Force
    }
}

# ---------------------------------------------------------------------------
# Port probing
# ---------------------------------------------------------------------------

function Test-PortInUse {
    param([int]$Port)
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Test-ServiceRunning {
    <#
    .SYNOPSIS
        Probe a local HTTP endpoint to verify a service is actually responding.
    .PARAMETER Port
        Local TCP port.
    .PARAMETER HealthPath
        HTTP path to request (default /api/health).
    #>
    param([int]$Port, [string]$HealthPath = '/api/health')
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port$HealthPath" -TimeoutSec 6
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Stop-PortOwner {
    <#
    .SYNOPSIS
        Stop all processes listening on a given TCP port.
    .PARAMETER Port
        Local TCP port to free.
    .PARAMETER Service
        Human-readable service name for log messages.
    #>
    param([int]$Port, [string]$Service)
    $pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    if ($pids) {
        Write-Warn "Port $Port busy - stopping stale $Service process(es): $($pids -join ', ')"
        $pids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
        for ($i = 1; $i -le 5; $i++) {
            Start-Sleep -Seconds 1
            if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
                Write-Ok "Port $Port freed after ${i}s"
                return
            }
        }
        Write-Warn "Port $Port still busy after 5s — service may fail to bind"
    }
}

function Get-PythonEnvConfig {
    <#
    .SYNOPSIS
        Parse the repo-root .python-env declaration (KEY=VALUE).
    .DESCRIPTION
        .python-env is the declared source of truth for which
        interpreter each tier uses (PYTHON_ENV, COMFYUI_ENV,
        TOOLS_ENV, FALLBACK_VENV). Until now every launcher
        hardcoded the same paths, so the file and reality could
        drift apart. Comments (#) and blank lines are skipped;
        surrounding quotes are stripped from values.
    .PARAMETER ProjectRoot
        Repo root directory (where .python-env lives).
    .OUTPUTS
        Hashtable of KEY -> VALUE (empty when the file is absent).
    #>
    param([Parameter(Mandatory)][string]$ProjectRoot)

    $cfg = @{}
    $file = Join-Path -Path $ProjectRoot -ChildPath '.python-env'
    if (-not (Test-Path -LiteralPath $file)) { return $cfg }
    foreach ($line in Get-Content -LiteralPath $file -ErrorAction SilentlyContinue) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $eq = $trimmed.IndexOf('=')
        if ($eq -le 0) { continue }
        $key = $trimmed.Substring(0, $eq).Trim()
        $val = $trimmed.Substring($eq + 1).Trim().Trim('"').Trim("'")
        if ($key) { $cfg[$key] = $val }
    }
    return $cfg
}

function Get-PythonEnvs {
    <#
    .SYNOPSIS
        Python environment paths for the studio, from .python-env.
    .OUTPUTS
        Hashtable with StudioPython, ComfyPython, ToolsPython,
        VenvPython keys.
    .NOTES
        .python-env (repo root) is the source of truth: it declares
        PYTHON_ENV, COMFYUI_ENV, TOOLS_ENV and FALLBACK_VENV. The
        hardcoded defaults below are only a fallback for a machine
        without the file, so the launchers and the declaration can
        never diverge. FALLBACK_VENV may be relative (resolved
        against the repo root) or absolute.
        Paths only: these say nothing about whether an env works.
        Use Resolve-BackendPython / Resolve-ComfyUIPython /
        Resolve-ToolsPython for a verified choice.
    #>
    $projectRoot = if ($ProjectRoot) { $ProjectRoot }
                   elseif ($Global:ProjectRoot) { $Global:ProjectRoot }
                   else { Split-Path -Parent $PSScriptRoot }
    $cfg = Get-PythonEnvConfig -ProjectRoot $projectRoot

    $studio = $cfg['PYTHON_ENV']
    if (-not $studio) { $studio = 'D:\conda-envs\nma-studio-cuda\Scripts\python.exe' }
    $comfy = $cfg['COMFYUI_ENV']
    if (-not $comfy) { $comfy = 'D:\conda-envs\comfyui-cuda\Scripts\python.exe' }
    $tools = $cfg['TOOLS_ENV']
    if (-not $tools) { $tools = 'D:\conda-envs\studio-tools\Scripts\python.exe' }
    $venvRel = $cfg['FALLBACK_VENV']
    if (-not $venvRel) { $venvRel = 'venv\Scripts\python.exe' }
    $venv = if ([System.IO.Path]::IsPathRooted($venvRel)) { $venvRel }
            else { Join-Path -Path $projectRoot -ChildPath $venvRel }

    return @{
        StudioPython = $studio
        ComfyPython  = $comfy
        ToolsPython  = $tools
        VenvPython   = $venv
    }
}

function Test-PythonEnv {
    <#
    .SYNOPSIS
        True when a Python interpreter can actually run the backend.
    .DESCRIPTION
        Path existence says nothing about whether an env works: a
        half-upgraded venv still has Scripts\python.exe but imports
        nothing. Probe the backend's runtime imports instead — the
        same lesson run-gates.py applies to its interpreter choice.
        fastapi + uvicorn are the server; watchfiles is the dev
        reload wrapper the launchers use (`python -m watchfiles`).
    .PARAMETER Python
        Interpreter path (or bare command name resolved via PATH).
    #>
    param([Parameter(Mandatory)][string]$Python)

    if (-not $Python) { return $false }
    # A bare name (e.g. 'python') resolves through PATH; a path must exist.
    if ($Python -match '[\\/]' -and -not (Test-Path -LiteralPath $Python)) {
        return $false
    }
    $null = & $Python -c "import fastapi, uvicorn, watchfiles" 2>$null
    return $LASTEXITCODE -eq 0
}

function Resolve-BackendPython {
    <#
    .SYNOPSIS
        First backend Python in the standard chain that actually works.
    .DESCRIPTION
        Walks Get-PythonEnvs' chain (studio > ComfyUI > project venv)
        and returns the first interpreter that passes Test-PythonEnv,
        warning about each broken one. If none pass, the first
        *existing* candidate is returned anyway so the caller fails
        with the service's own error instead of a misleading
        "no Python found"; $null only when no candidate exists at all.
    .OUTPUTS
        Interpreter path, or $null when no candidate exists.
    #>
    $envs = Get-PythonEnvs
    $chain = @($envs.StudioPython, $envs.ComfyPython, $envs.VenvPython) |
             Select-Object -Unique
    $existing = @()
    foreach ($candidate in $chain) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        $existing += $candidate
        if (Test-PythonEnv -Python $candidate) { return $candidate }
        Write-Warn "$candidate exists but cannot import the backend runtime (fastapi/uvicorn/watchfiles) - skipping"
    }
    if ($existing.Count -gt 0) { return $existing[0] }
    return $null
}

function Test-ComfyUIEnv {
    <#
    .SYNOPSIS
        True when a Python interpreter can run the ComfyUI service.
    .DESCRIPTION
        ComfyUI's main.py hard-imports torch, so an env without it
        dies seconds into launch with a traceback far from the cause.
        Probe that import — the same lesson Test-PythonEnv applies to
        the backend runtime.
    .PARAMETER Python
        Interpreter path (or bare command name resolved via PATH).
    #>
    param([Parameter(Mandatory)][string]$Python)

    if (-not $Python) { return $false }
    # A bare name (e.g. 'python') resolves through PATH; a path must exist.
    if ($Python -match '[\\/]' -and -not (Test-Path -LiteralPath $Python)) {
        return $false
    }
    $null = & $Python -c "import torch" 2>$null
    return $LASTEXITCODE -eq 0
}

function Resolve-ComfyUIPython {
    <#
    .SYNOPSIS
        First ComfyUI Python in the chain that can actually run it.
    .DESCRIPTION
        Walks the ComfyUI env, then the studio env (both carry the
        same cu126 torch build), then the project venv, returning the
        first interpreter that passes Test-ComfyUIEnv and warning about
        each broken one. If none pass, the first *existing* candidate is
        returned so the service reports its own failure rather than a
        misleading "no Python found"; $null only when no candidate
        exists at all.
    .OUTPUTS
        Interpreter path, or $null when no candidate exists.
    #>
    $envs = Get-PythonEnvs
    $chain = @($envs.ComfyPython, $envs.StudioPython, $envs.VenvPython) |
             Select-Object -Unique
    $existing = @()
    foreach ($candidate in $chain) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        $existing += $candidate
        if (Test-ComfyUIEnv -Python $candidate) { return $candidate }
        Write-Warn "$candidate exists but cannot import torch - skipping"
    }
    if ($existing.Count -gt 0) { return $existing[0] }
    return $null
}

function Test-ToolsEnv {
    <#
    .SYNOPSIS
        True when a Python interpreter can run standalone tool scripts.
    .DESCRIPTION
        Standalone tools have heterogeneous imports (csv-only utilities,
        httpx/PIL clients, Blender's bpy), so no single dependency probe
        is honest for all of them. The floor is that the interpreter
        exists and starts; a tool's own imports then fail with their own
        error naming the missing module. check-env-health.ps1 reports
        per-dependency drift against tools/requirements-standalone.txt.
    .PARAMETER Python
        Interpreter path (or bare command name resolved via PATH).
    #>
    param([Parameter(Mandatory)][string]$Python)

    if (-not $Python) { return $false }
    # A bare name (e.g. 'python') resolves through PATH; a path must exist.
    if ($Python -match '[\\/]' -and -not (Test-Path -LiteralPath $Python)) {
        return $false
    }
    $null = & $Python -c "import sys" 2>$null
    return $LASTEXITCODE -eq 0
}

function Resolve-ToolsPython {
    <#
    .SYNOPSIS
        First Python in the standalone-tooling chain that starts.
    .DESCRIPTION
        Walks the tools env (.python-env TOOLS_ENV, the Python 3.14
        studio-tools venv), then the studio env (a superset of the
        pure-Python tooling deps), then the project venv, then python
        on PATH — returning the first interpreter that passes
        Test-ToolsEnv and warning about each broken one. A fallback
        below the tools env is reported loudly: it changes the
        interpreter version a tool runs under.
    .OUTPUTS
        Interpreter path, or $null when no candidate exists.
    #>
    $envs = Get-PythonEnvs
    $chain = @($envs.ToolsPython, $envs.StudioPython, $envs.VenvPython, 'python') |
             Select-Object -Unique
    $existing = @()
    foreach ($candidate in $chain) {
        if ($candidate -match '[\\/]' -and -not (Test-Path -LiteralPath $candidate)) { continue }
        $existing += $candidate
        if (Test-ToolsEnv -Python $candidate) {
            if ($candidate -ne $envs.ToolsPython) {
                Write-Warn "tools env unavailable - falling back to $candidate (tool runs under a different interpreter than TOOLS_ENV declares)"
            }
            return $candidate
        }
        Write-Warn "$candidate exists but does not start - skipping"
    }
    if ($existing.Count -gt 0) { return $existing[0] }
    return $null
}

function Get-BackendTarget {
    <#
    .SYNOPSIS
        Build the backend launch target string used by both
        manage-servers.ps1 and start-studio.ps1.
    .PARAMETER Python
        Python interpreter path.
    .PARAMETER Port
        Backend port (from Get-PortsConfig).
    #>
    param(
        [Parameter(Mandatory)][string]$Python,
        [Parameter(Mandatory)][int]$Port
    )
    $exe = $Python -replace '\\', '/'
    return '"' + ($exe + ' -m uvicorn app.main:app --host 127.0.0.1 --port ' + $Port) + '"'
}

# ---------------------------------------------------------------------------
# Process helpers
# ---------------------------------------------------------------------------

function Start-ProcessSafe {
    <#
    .SYNOPSIS
        Start a process and validate it launched successfully.
    .OUTPUTS
        The process object, or $null if it failed to start.
    .PARAMETER FilePath
        Executable to start.
    .PARAMETER ArgumentList
        Arguments to pass.
    .PARAMETER WorkingDirectory
        Working directory for the new process.
    .PARAMETER LogFile
        Standard output log path.
    .PARAMETER ErrorLog
        Standard error log path.
    .PARAMETER AppendLog
        Append to logs instead of overwriting.
    #>
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$ArgumentList,
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$LogFile,
        [Parameter(Mandatory)][string]$ErrorLog,
        [switch]$AppendLog
    )
    try {
        $procArgs = @{
            FilePath       = $FilePath
            ArgumentList   = $ArgumentList
            WorkingDirectory = $WorkingDirectory
            WindowStyle    = 'Hidden'
            PassThru       = $true
        }
        if ($AppendLog) {
            $redirect = ">> `"$LogFile`" 2>> `"$ErrorLog`""
            $procArgs['FilePath'] = 'cmd.exe'
            $procArgs['ArgumentList'] = @('/c', "`"$FilePath`" $($ArgumentList -join ' ') $redirect")
        } else {
            $procArgs['RedirectStandardOutput'] = $LogFile
            $procArgs['RedirectStandardError']  = $ErrorLog
        }
        $proc = Start-Process @procArgs
        Start-Sleep -Milliseconds 200
        if ($proc.HasExited) {
            Write-Warn "Process exited immediately (code $($proc.ExitCode)) - check $ErrorLog"
            return $null
        }
        return $proc
    } catch {
        Write-Warn "Failed to start process: $_"
        return $null
    }
}

function Wait-ForPort {
    <#
    .SYNOPSIS
        Wait up to N seconds for a TCP port to enter LISTEN state.
    .OUTPUTS
        $true when the port opens, $false on timeout.
    .PARAMETER Port
        Local TCP port.
    .PARAMETER Name
        Service name for log messages.
    .PARAMETER MaxSeconds
        Timeout in seconds (default 45).
    #>
    param(
        [Parameter(Mandatory)][int]$Port,
        [Parameter(Mandatory)][string]$Name,
        [int]$MaxSeconds = 45
    )
    for ($i = 1; $i -le $MaxSeconds; $i++) {
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            Write-Ok "$Name listening on port $Port (waited ${i}s)"
            return $true
        }
        Start-Sleep -Seconds 1
    }
    Write-Warn "$Name did not open port $Port within ${MaxSeconds}s (check logs in output\logs)"
    return $false
}

function Get-LogTail {
    <#
    .SYNOPSIS
        Print the last N lines of a log file for diagnostics.
    .PARAMETER LogFile
        Path to the log file.
    .PARAMETER Lines
        Number of lines to show (default 10).
    #>
    param(
        [Parameter(Mandatory)][string]$LogFile,
        [int]$Lines = 10
    )
    if (Test-Path -LiteralPath $LogFile) {
        $content = Get-Content -LiteralPath $LogFile -Tail $Lines -ErrorAction SilentlyContinue
        if ($content) {
            Write-Host "  --- Last $Lines lines of $LogFile ---" -ForegroundColor DarkGray
            $content | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        }
    }
}

function Test-ServicePort {
    <#
    .SYNOPSIS
        Check whether a service is already running on a given port.
    .DESCRIPTION
        Returns a hashtable with Running, Port, and Note keys.
        Consumed by manage-servers.ps1 and start-studio.ps1.
    .PARAMETER Port
        Local TCP port.
    .PARAMETER HealthPath
        HTTP path to probe (default /api/health).
    #>
    param(
        [Parameter(Mandatory)][int]$Port,
        [string]$HealthPath = '/api/health'
    )
    $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listening) {
        if (Test-ServiceRunning -Port $Port -HealthPath $HealthPath) {
            return @{ Running = $true; Port = $Port }
        }
        return @{ Running = $false; Port = $Port; Note = 'Port bound but service not responding' }
    }
    return @{ Running = $false; Port = $Port }
}

# ---------------------------------------------------------------------------
# Console output helpers
# ---------------------------------------------------------------------------

function Write-Step { param([string]$msg) Write-Host "`n[$msg]" -ForegroundColor Cyan }
function Write-Ok   { param([string]$msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Err  { param([string]$msg) Write-Host "  [ERR] $msg" -ForegroundColor Red }
