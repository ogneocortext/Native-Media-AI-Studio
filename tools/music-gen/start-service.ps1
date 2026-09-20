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

# Find Python
$Python = $null

# Check for ACE-Step dedicated venv first (contains the `acestep` package)
if (-not $Python) {
    $aceVenv = Join-Path $ScriptDir "ACE-Step-1.5\.venv\Scripts\python.exe"
    if (Test-Path $aceVenv) { $Python = $aceVenv }
}

# Check MUSIC_GEN_PYTHON env var
if (-not $Python) {
    if ($env:MUSIC_GEN_PYTHON -and (Test-Path $env:MUSIC_GEN_PYTHON)) {
        $Python = $env:MUSIC_GEN_PYTHON
    }
}

# Check for conda env
if (-not $Python) {
    $condaEnv = "music-gen"
    try {
        $condaInfo = & conda info --envs 2>$null | Select-String $condaEnv
        if ($condaInfo) {
            $condaBase = & conda info --base 2>$null
            $Python = Join-Path $condaBase "envs\$condaEnv\python.exe"
            if (-not (Test-Path $Python)) { $Python = $null }
        }
    } catch { }
}

# Check for venv in service directory
if (-not $Python) {
    $venvPython = Join-Path $ScriptDir ".venv\Scripts\python.exe"
    if (Test-Path $venvPython) { $Python = $venvPython }
}

# Fallback to system Python
if (-not $Python) { $Python = "python" }

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
