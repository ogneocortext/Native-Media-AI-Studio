#Requires -Version 7.0
<#
.SYNOPSIS
    Start the Music Generation subprocess service.

.DESCRIPTION
    Launches the FastAPI server for ACE-Step music generation.

.PARAMETER Engine
    Music generation engine: ace

.PARAMETER Port
    Port to listen on (default: 8201)

.PARAMETER VramBudget
    VRAM budget in GB (default: 6 for ace on 8 GB hardware)

.PARAMETER Background
    Run as detached background process

.EXAMPLE
    .\start-service.ps1 -Engine ace -Background
#>

param(
    [ValidateSet("ace")]
    [string]$Engine = "ace",

    [int]$Port = 0,

    [int]$VramBudget = 0,

    [switch]$Background
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Resolve defaults
if ($Port -eq 0) {
    $Port = 8201
}
if ($VramBudget -eq 0) {
    # ACE-Step Tier 3 on GTX 1070 Ti (8 GB / Pascal): 2B turbo + 0.6B LM, INT8, CPU offload
    $VramBudget = 6
}

# Find Python: walk the candidate chain and take the first
# interpreter that can actually run the server. server.py
# imports `acestep` at startup, so an env without it fails
# seconds into the launch - the probe rejects those before
# anything is started. Order follows the README: ACE-Step
# venv, then the service-local venv, then MUSIC_GEN_PYTHON,
# then a conda env named music-gen, then system Python.
function Test-MusicGenEnv {
    param([string]$Python)
    if (-not $Python) { return $false }
    # A bare name (e.g. 'python') resolves through PATH; a path must exist.
    if ($Python -match '[\\/]' -and -not (Test-Path -LiteralPath $Python)) {
        return $false
    }
    $null = & $Python -c "import acestep" 2>$null
    return $LASTEXITCODE -eq 0
}

$candidates = @(
    (Join-Path $ScriptDir "ACE-Step-1.5\.venv\Scripts\python.exe"),
    (Join-Path $ScriptDir ".venv\Scripts\python.exe")
)
if ($env:MUSIC_GEN_PYTHON) { $candidates += $env:MUSIC_GEN_PYTHON }
try {
    $condaInfo = & conda info --envs 2>$null | Select-String "music-gen"
    if ($condaInfo) {
        $condaBase = & conda info --base 2>$null
        $candidates += (Join-Path $condaBase "envs\music-gen\python.exe")
    }
} catch { }
$candidates += "python"

$Python = $null
foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if (Test-MusicGenEnv -Python $candidate) {
        $Python = $candidate
        break
    }
    if ($candidate -match '[\\/]' -and (Test-Path -LiteralPath $candidate)) {
        Write-Warn "$candidate exists but cannot import acestep - skipping"
    }
}

if (-not $Python) {
    Write-Err "No Python environment with the acestep package found."
    Write-Err "acestep is vendored in tools\music-gen\ACE-Step-1.5\acestep - restore that checkout's .venv, or set MUSIC_GEN_PYTHON to an interpreter that has it (see tools\music-gen\README.md)"
    exit 1
}

Write-Host "Music Gen Service: engine=$Engine port=$Port vram=${VramBudget}GB" -ForegroundColor Cyan
Write-Host "Python: $Python" -ForegroundColor DarkGray

$ServerScript = Join-Path $ScriptDir "server.py"
# ScriptDir is tools\music-gen — the repo root (where output/ lives) is two levels up.
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$OutputDir = Join-Path $RepoRoot "output\music"

# Build command
$ServerArgs = @(
    $ServerScript,
    "--port", $Port,
    "--engine", $Engine,
    "--output-dir", $OutputDir
)

if ($Background) {
    Write-Host "Starting in background..." -ForegroundColor Yellow
    $proc = Start-Process -FilePath $Python -ArgumentList $ServerArgs `
        -WorkingDirectory $ScriptDir `
        -WindowStyle Hidden `
        -PassThru
    Write-Host "PID: $($proc.Id)" -ForegroundColor Green
    Write-Host "Health: http://127.0.0.1:$Port/health" -ForegroundColor Green
} else {
    Write-Host "Starting foreground (Ctrl+C to stop)..." -ForegroundColor Yellow
    & $Python @ServerArgs
}
