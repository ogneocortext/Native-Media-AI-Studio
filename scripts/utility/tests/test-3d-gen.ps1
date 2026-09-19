<#
.SYNOPSIS
    Quick smoke-test for the backend 3D generation endpoint.
.DESCRIPTION
    Sends a small text-to-3D generation request to the running backend and
    writes the result to output/logs/3d-test.log.
    Port is resolved from config/ports.json so it works with dynamic ports.
.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\utility\tests\test-3d-gen.ps1
#>
#Requires -Version 7.6
[CmdletBinding(SupportsShouldProcess=$true)]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot '..\..\shared-utils.ps1')

$Ports = Get-PortsConfig -ProjectRoot $ProjectRoot
$BackendPort = $Ports.backend_port
$baseUrl = "http://127.0.0.1:$BackendPort"

$body = @{ prompt = 'a happy shrimp character'; steps = 15 } | ConvertTo-Json
$logPath = Join-Path $ProjectRoot 'output\logs\3d-test.log'

Write-Output "Testing 3D generation at $baseUrl/api/3d/generate ..." | Set-Content -Path $logPath -Encoding utf8NoBOM

try {
    $r = Invoke-RestMethod -Uri "$baseUrl/api/3d/generate" -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 300
    $result = "SUCCESS: $($r | ConvertTo-Json -Depth 5)"
    Write-Output $result | Set-Content -Path $logPath -Append -Encoding utf8NoBOM
} catch {
    $failure = "FAIL: $($_.Exception.Message)"
    Write-Output $failure | Set-Content -Path $logPath -Append -Encoding utf8NoBOM
    Write-Err $failure
    exit 1
}
