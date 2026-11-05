<#
.SYNOPSIS
    Legacy developer launcher — delegates to start-studio.ps1.
.DESCRIPTION
    Preserves backwards compatibility with older docs and muscle-memory
    while the canonical launcher lives in start-studio.ps1.
.PARAMETER NoBackend
    Skip the backend (frontend only).
.PARAMETER NoFrontend
    Skip the frontend (backend only).
.PARAMETER NoWait
    Start services and return immediately instead of blocking on the
    interactive 'q' loop (start-studio.ps1).
.PARAMETER Browser
    Open the frontend in the browser on startup (start-studio.ps1).
.PARAMETER NoComfyUI
    Skip ComfyUI even if it would otherwise start (start-studio.ps1).
.PARAMETER Clean
    Remove build artifacts and caches before starting.
.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-dev.ps1
.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-dev.ps1 -NoBackend -Clean
#>
#Requires -Version 7.6
[CmdletBinding(SupportsShouldProcess=$true)]

param(
    [switch]$NoBackend,
    [switch]$NoFrontend,
    [switch]$NoWait,
    [switch]$Browser,
    [switch]$NoComfyUI,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$Launcher = Join-Path $PSScriptRoot 'start-studio.ps1'

if (-not (Test-Path -LiteralPath $Launcher)) {
    Write-Err "Canonical launcher not found: $Launcher"
    exit 1
}

$forwardArgs = @()
if ($NoBackend)  { $forwardArgs += '-NoBackend' }
if ($NoFrontend) { $forwardArgs += '-NoFrontend' }
if ($NoWait)     { $forwardArgs += '-NoWait' }
if ($Browser)    { $forwardArgs += '-Browser' }
if ($NoComfyUI)  { $forwardArgs += '-NoComfyUI' }
if ($Clean)      { $forwardArgs += '-Clean' }

Write-Host "Delegating to start-studio.ps1 $($forwardArgs -join ' ')..." -ForegroundColor Cyan
& $Launcher @forwardArgs
exit $LASTEXITCODE
