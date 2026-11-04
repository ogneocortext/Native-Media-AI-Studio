#Requires -Version 7.6
# Functional test for the modernized scripts/shared-utils.ps1
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'scripts\shared-utils.ps1')

$failures = 0
function Assert-Equal {
    param($Expected, $Actual, [string]$What)
    if ($Expected -ne $Actual) {
        Write-Host "FAIL $What : expected '$Expected' got '$Actual'" -ForegroundColor Red
        $script:failures++
    }
    else {
        Write-Host "ok   $What = $Actual"
    }
}

Write-Host "--- Get-PortsConfig from config/ports.json ---"
$ports = Get-PortsConfig -ProjectRoot $root
Assert-Equal 8000 $ports.backend_port 'backend_port'
Assert-Equal 5173 $ports.frontend_port 'frontend_port'
Assert-Equal 8188 $ports.comfyui_port 'comfyui_port'
Assert-Equal 8080 $ports.video_editor_port 'video_editor_port'
Assert-Equal 3847 $ports.dashboard_port 'dashboard_port'
Assert-Equal 3847 $ports.go_dashboard_port 'go_dashboard_port'
Assert-Equal 3848 $ports.go_media_port 'go_media_port'
Assert-Equal 3849 $ports.go_worker_port 'go_worker_port'
Assert-Equal 3850 $ports.go_gateway_port 'go_gateway_port'
Assert-Equal 3851 $ports.go_ports_port 'go_ports_port'

Write-Host "--- Get-PortsConfig fallback (missing config dir) ---"
$fallback = Get-PortsConfig -ProjectRoot (Join-Path $env:TEMP 'nma-does-not-exist')
Assert-Equal 8000 $fallback.backend_port 'fallback backend_port'
Assert-Equal 3851 $fallback.go_ports_port 'fallback go_ports_port'

Write-Host "--- Get-PortsConfig guard (no -ProjectRoot) ---"
try {
    $null = Get-PortsConfig
    Write-Host 'FAIL expected throw' -ForegroundColor Red
    $failures++
}
catch {
    Write-Host "ok   threw: $($_.Exception.Message)"
}

Write-Host "--- Get-PortFromUrl ---"
Assert-Equal 3848 (Get-PortFromUrl -Url 'http://127.0.0.1:3848' -Default 1) 'plain url'
Assert-Equal 3848 (Get-PortFromUrl -Url 'http://127.0.0.1:3848/api/health' -Default 1) 'url with path'
Assert-Equal 3848 (Get-PortFromUrl -Url 'http://[::1]:3848' -Default 1) 'ipv6 url'
Assert-Equal 7 (Get-PortFromUrl -Url '' -Default 7) 'empty url falls back'
Assert-Equal 7 (Get-PortFromUrl -Url 'not a url' -Default 7) 'garbage url falls back'

Write-Host "--- resolvers ---"
foreach ($name in 'Resolve-Pnpm', 'Resolve-Npm', 'Resolve-NodeExe') {
    $resolved = & $name
    if ($resolved) { Write-Host "ok   $name -> $resolved" }
    else { Write-Host "WARN $name -> `$null (tool not installed?)" -ForegroundColor Yellow }
}

Write-Host "--- Test-PortInUse / Test-ServiceRunning (types) ---"
Write-Host "ok   Test-PortInUse 59999 = $([bool](Test-PortInUse -Port 59999))"
Write-Host "ok   Test-ServiceRunning 59999 = $([bool](Test-ServiceRunning -Port 59999))"

if ($failures -gt 0) { Write-Host "`n$failures FAILURE(S)" -ForegroundColor Red; exit 1 }
Write-Host "`nALL_SHARED_UTILS_CHECKS_PASSED" -ForegroundColor Green
