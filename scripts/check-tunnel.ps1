<#
.SYNOPSIS
    Check whether the public tunnel is actually serving right now.

.DESCRIPTION
    start-tunnel.ps1 verifies a tunnel once, at startup. Localtunnel's free
    tier drops connections minutes later, so a `Verified: True` in
    tunnel-urls.json can be stale by the time you look. This re-probes the
    live endpoints so "is the tunnel up?" is one command instead of a dig.

    Probes each published URL with Accept: application/json, which is what an
    API client sends and which also avoids ngrok's ERR_NGROK_6024 interstitial
    page. A frontend-only tunnel is verified through its /api proxy path,
    because that is the route an agent actually uses.

.PARAMETER StateFile
    Path to tunnel-urls.json (defaults to the one start-tunnel.ps1 writes).

.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\check-tunnel.ps1
#>
#Requires -Version 7.6
[CmdletBinding()]
param(
    [string]$StateFile
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $StateFile) {
    $StateFile = Join-Path $ProjectRoot 'scripts\utility\tunnel-urls.json'
}

if (-not (Test-Path -LiteralPath $StateFile)) {
    Write-Error "No tunnel state at $StateFile. Run scripts\start-tunnel.ps1 first."
    exit 1
}

$state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json

function Test-PublicUrl {
    param(
        [string]$Name,
        [string]$BaseUrl,
        [string]$ProbePath
    )
    if (-not $BaseUrl) {
        Write-Host ("  {0,-10} : not published" -f $Name) -ForegroundColor DarkGray
        return $false
    }
    $uri = "$($BaseUrl.TrimEnd('/'))$ProbePath"
    # Accept: application/json both matches real API clients and bypasses
    # ngrok's interstitial warning page.
    $headers = @{
        'bypass-tunnel-reminder' = 'true'
        'Accept'                 = 'application/json'
    }
    foreach ($attempt in 1..2) {
        try {
            $r = Invoke-WebRequest -Uri $uri -Headers $headers -UseBasicParsing -TimeoutSec 20
            if ($r.StatusCode -eq 200) {
                Write-Host ("  {0,-10} : UP   {1} -> 200" -f $Name, $BaseUrl) -ForegroundColor Green
                return $true
            }
        } catch {
            if ($attempt -eq 2) {
                $code = 'ERR'
                if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
                Write-Host ("  {0,-10} : DOWN {1} -> {2}" -f $Name, $BaseUrl, $code) -ForegroundColor Red
            }
        }
        Start-Sleep -Milliseconds 800
    }
    return $false
}

Write-Host ""
Write-Host "Tunnel check ($($state.provider))" -ForegroundColor Cyan
Write-Host "  started_at: $($state.started_at)"

$ok = $false
if ($state.backend_url) {
    $ok = Test-PublicUrl -Name 'backend' -BaseUrl $state.backend_url -ProbePath '/api/health'
}

if ($state.frontend_url) {
    # Probe the API through the frontend too: in -Target frontend mode this is
    # the only route an agent has, so the frontend is unusable if it fails.
    $frontOk = Test-PublicUrl -Name 'frontend' -BaseUrl $state.frontend_url -ProbePath '/api/health'
    $pageOk = $false
    try {
        $r = Invoke-WebRequest -Uri $state.frontend_url -Headers @{ 'User-Agent' = 'Mozilla/5.0' } -UseBasicParsing -TimeoutSec 20
        $pageOk = ($r.StatusCode -eq 200)
    } catch { }
    if ($pageOk) {
        Write-Host "  (page)     : UP   HTML served" -ForegroundColor Green
    }
    $ok = $ok -or $frontOk
}

Write-Host ""
if ($ok) {
    Write-Host "Tunnel is serving." -ForegroundColor Green
    exit 0
}
Write-Host "Tunnel is NOT serving. Restart with: .\scripts\start-tunnel.ps1" -ForegroundColor Red
exit 1
