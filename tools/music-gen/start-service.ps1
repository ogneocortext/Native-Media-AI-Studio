#Requires -Version 7.0
<#
.SYNOPSIS
    Start the Music Generation subprocess service.

.DESCRIPTION
    Launches the FastAPI server for YuE2 or ACE-Step music generation.
    Each engine runs on its own port as a separate process.

.PARAMETER Engine
    Music generation engine: yue2 or ace (default: yue2)

.PARAMETER Port
    Port to listen on (default: 8200 for yue2, 8201 for ace)

.PARAMETER VramBudget
    VRAM budget in GB (default: 6 for yue2, 4 for ace)

.PARAMETER Background
    Run as detached background process

.EXAMPLE
    .\start-service.ps1 -Engine yue2 -Background
    .\start-service.ps1 -Engine ace -Port 8201
#>

param(
    [ValidateSet("yue2", "ace")]
    [string]$Engine = "yue2",

    [int]$Port = 0,

    [int]$VramBudget = 0,

    [switch]$Background
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Resolve defaults
if ($Port -eq 0) {
    $Port = if ($Engine -eq "yue2") { 8200 } else { 8201 }
}
if ($VramBudget -eq 0) {
    $VramBudget = if ($Engine -eq "yue2") { 6 } else { 4 }
}

# Find Python
$Python = $null

# Check MUSIC_GEN_PYTHON env var
if ($env:MUSIC_GEN_PYTHON -and (Test-Path $env:MUSIC_GEN_PYTHON)) {
    $Python = $env:MUSIC_GEN_PYTHON
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
$OutputDir = Join-Path (Split-Path -Parent $ScriptDir) "output\music"

# Build command
$Args = @(
    $ServerScript,
    "--port", $Port,
    "--engine", $Engine,
    "--vram-budget", $VramBudget,
    "--output-dir", $OutputDir
)

if ($Background) {
    Write-Host "Starting in background..." -ForegroundColor Yellow
    $proc = Start-Process -FilePath $Python -ArgumentList $Args `
        -WorkingDirectory $ScriptDir `
        -WindowStyle Hidden `
        -PassThru
    Write-Host "PID: $($proc.Id)" -ForegroundColor Green
    Write-Host "Health: http://127.0.0.1:$Port/health" -ForegroundColor Green
} else {
    Write-Host "Starting foreground (Ctrl+C to stop)..." -ForegroundColor Yellow
    & $Python @Args
}
