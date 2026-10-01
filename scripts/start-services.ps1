<#
.SYNOPSIS
    Thin wrapper: launches managed background services via manage-servers.ps1.
.DESCRIPTION
    Preserves the original start-services UX (-ComfyUI / -VideoEditor)
    while delegating all actual process management to the canonical
    manage-servers.ps1 script to avoid duplicated startup logic.
.PARAMETER ComfyUI
    Also start ComfyUI as a background service.
.PARAMETER VideoEditor
    Also start the Video Editor as a background service.
.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-services.ps1
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-services.ps1 -ComfyUI -VideoEditor
#>
#Requires -Version 7.6
[CmdletBinding()]

param(
    [switch]$ComfyUI,
    [switch]$VideoEditor
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

$services = @('backend', 'frontend', 'video', 'go-dashboard', 'go-media', 'go-worker', 'go-gateway', 'go-ports')
if ($ComfyUI) { $services += 'comfyui' }
$services = $services | Select-Object -Unique

$manageScript = Join-Path $ProjectRoot 'scripts\manage-servers.ps1'
if (-not (Test-Path -LiteralPath $manageScript)) {
    Write-Err "Canonical manager not found: $manageScript"
    exit 1
}

Write-Host "`nStarting background services via manage-servers.ps1..." -ForegroundColor Cyan
& $manageScript -Action start -Services $services
