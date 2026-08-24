# Legacy developer launcher - delegates to the maintained start-studio.ps1 so there
# is one canonical source of truth for starting the stack.
# Kept for backwards compatibility with older docs/muscle-memory.
param(
    [switch]$NoBackend,
    [switch]$NoFrontend,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $PSScriptRoot 'start-studio.ps1'

if (-not (Test-Path $Launcher)) {
    Write-Host "ERROR: start-studio.ps1 not found at $Launcher" -ForegroundColor Red
    exit 1
}

$forwardArgs = @()
if ($NoBackend) { $forwardArgs += '-NoBackend' }
if ($NoFrontend) { $forwardArgs += '-NoFrontend' }

# -Clean is delegated through; the target recreates venv/node_modules as needed.
if ($Clean) { Write-Host "Note: -Clean is handled by start-studio.ps1 (recreates venv / node_modules)." -ForegroundColor Yellow }

Write-Host "Delegating to start-studio.ps1 $($forwardArgs -join ' ')..." -ForegroundColor Cyan
& $Launcher @forwardArgs
exit $LASTEXITCODE
