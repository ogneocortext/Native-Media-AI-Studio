<#
.SYNOPSIS
    Expose the running local services through a public tunnel so an AI agent
    in a sandbox VM can reach them.  Primary backend is http://127.0.0.1:8000
    and frontend is http://127.0.0.1:5173.

.DESCRIPTION
    Creates public HTTPS endpoints that forward to localhost:

      Backend  -> https://<random>.ngrok-free.app/api/...
      Frontend -> https://<random>.ngrok-free.app:5173/...

    Supports:
      - ngrok  (preferred; install from https://ngrok.com/download)
      - localtunnel (`npx localtunnel`) as fallback

    The script:
      1. Detects which tunnel binary is available.
      2. Starts tunnels for backend (8000) and frontend (5173).
      3. Captures the public URLs from tunnel output.
      4. Records the URLs in the state file for downstream automation
         (agents, tests, Playwright) and exports PUBLIC_ORIGIN for this
         PowerShell session only. No CORS restart is needed: the backend
         matches tunnel origins by pattern via allow_origin_regex
         (app/core/cors.py), so the running backend never needs the env var.

.PARAMETER Provider
    Tunnel provider: "ngrok" (default) or "localtunnel".


.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-tunnel.ps1
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-tunnel.ps1 -Provider ngrok
#>
#Requires -Version 7.6
[CmdletBinding()]
param(
    [ValidateSet("ngrok", "localtunnel")]
    [string]$Provider = "ngrok",
    [ValidateSet("both", "frontend")]
    [string]$Target = "frontend"
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$UtilityDir  = Join-Path $ProjectRoot 'scripts\utility'
$TunnelStateFile = Join-Path $UtilityDir 'tunnel-urls.json'
$LogFile = Join-Path $UtilityDir 'tunnel.log'

function Write-Log {
    param([string]$Message)
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$ts] $Message"
    Write-Host $line
    Add-Content -LiteralPath $LogFile -Value $line
}

function Start-NgrokTunnel {
    param([int]$Port, [string]$Label)

    if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
        throw "ngrok not found on PATH. Install from https://ngrok.com/download"
    }

    $logFile = Join-Path $UtilityDir "ngrok-$Label.log"
    $errFile = Join-Path $UtilityDir "ngrok-$Label.err.log"
    $proc = Start-Process -FilePath 'ngrok' -ArgumentList @(
        'http', ":$Port",
        # --region is deprecated in ngrok 3.x (it picks the lowest-latency
        # region itself), so it is not passed. --random does not exist in
        # ngrok 3.x either; each invocation allocates its own hostname unless a
        # domain is reserved on the account.
        '--log', 'stdout',
        '--log-level', 'info'
    ) -NoNewWindow -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $errFile

    Write-Log "Started ngrok for $Label (PID $($proc.Id))"

    # Poll for public URL in log output.
    $url = $null
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($stopwatch.Elapsed.TotalSeconds -lt 30) {
        if (Test-Path $logFile) {
            $content = Get-Content -LiteralPath $logFile -ErrorAction SilentlyContinue
            foreach ($line in $content) {
                if ($line -match 'url=(https?://[^\s]+)') {
                    $url = $Matches[1]
                    break
                }
            }
        }
        if ($url) { break }
        Start-Sleep -Milliseconds 500
    }

    if (-not $url) {
        throw "Timed out waiting for ngrok $Label tunnel URL. Check $logFile"
    }

    Write-Log "$Label tunnel ready: $url"
    return @{ Url = $url; Pid = $proc.Id; Log = $logFile }
}

function Start-LocaltunnelTunnel {
    param([int]$Port, [string]$Label)

    if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
        throw "npx not found on PATH. Install Node.js to use localtunnel."
    }

    $logFile = Join-Path $UtilityDir "lt-$Label.log"
    $errFile = Join-Path $UtilityDir "lt-$Label.err.log"

    # npx spawns node -> cmd children. The previous version recorded only the
    # cmd wrapper PID, so stop-tunnel.ps1 never killed the real node process
    # and repeated start/stop cycles leaked orphaned tunnels that stayed bound
    # to the public hostname. Track the node PID too and kill the whole tree.
    $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList @(
        '/c', "npx localtunnel --port $Port"
    ) -NoNewWindow -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $errFile

    Write-Log "Started localtunnel for $Label (cmd PID $($proc.Id), port $Port)"

    $nodePid = $null
    $url = $null
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($stopwatch.Elapsed.TotalSeconds -lt 60) {
        if (Test-Path $logFile) {
            foreach ($line in (Get-Content -LiteralPath $logFile -ErrorAction SilentlyContinue)) {
                # localtunnel prints "your url is: <url>"; ngrok prints "url=<url>".
                if ($line -match 'your url is:\s*(https?://[^\s]+)') { $url = $Matches[1]; break }
                if ($line -match 'url=(https?://[^\s]+)')            { $url = $Matches[1]; break }
            }
        }
        if (-not $nodePid) {
            $nodePid = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
                Where-Object { $_.CommandLine -match 'localtunnel' -and $_.CommandLine -match "--port $Port" } |
                Select-Object -First 1 -ExpandProperty ProcessId
        }
        if ($url -and $nodePid) { break }
        Start-Sleep -Milliseconds 500
    }

    if (-not $url) {
        Write-Log "ERROR: no URL for $Label within 60s. See $logFile"
        Write-Log "stderr: $((Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue))"
        throw "Timed out waiting for localtunnel $Label URL. Check $logFile"
    }

    Write-Log "$Label tunnel ready: $url (node PID $nodePid)"
    return @{
        Url     = $url
        Pid     = $proc.Id
        NodePid = $nodePid
        Tree    = @($proc.Id, $nodePid)
        Log     = $logFile
    }
}

# ---------------------------------------------------------------------------
# Validate services are running locally
# ---------------------------------------------------------------------------
$backendOk = $false
$frontendOk = $false

try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/health' -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
    if ($r.StatusCode -eq 200) { $backendOk = $true }
} catch { }

try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
    if ($r.StatusCode -eq 200) { $frontendOk = $true }
} catch { }

if (-not $backendOk) {
    Write-Warning "Backend not responding at http://127.0.0.1:8000. Start it before tunnelling."
}
if (-not $frontendOk) {
    Write-Warning "Frontend not responding at http://127.0.0.1:5173. Start it before tunnelling."
}

Write-Host "`nStarting $Provider tunnels..." -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# Start tunnels
# ---------------------------------------------------------------------------
# -Target frontend (default) publishes ONLY the Vite dev server. It proxies
# /api, /output and /ws to 127.0.0.1:8000, so a single public endpoint reaches
# both the UI and the API. This is what fits a free ngrok account, which serves
# one endpoint at a time (ERR_NGROK_334 on the second).
#
# -Target both publishes the backend API directly instead. Useful when the
# agent calls the API from a non-browser client and you would rather not depend
# on the Vite proxy, but it consumes the account's single endpoint.
$startFrontend = {
    if ($Provider -eq 'ngrok') { Start-NgrokTunnel -Port 5173 -Label 'frontend' }
    else { Start-LocaltunnelTunnel -Port 5173 -Label 'frontend' }
}
$startBackend = {
    if ($Provider -eq 'ngrok') { Start-NgrokTunnel -Port 8000 -Label 'backend' }
    else { Start-LocaltunnelTunnel -Port 8000 -Label 'backend' }
}

$backendTunnel = $null
$frontendTunnel = $null
$frontendError = $null

if ($Target -eq 'frontend') {
    $frontendTunnel = & $startFrontend
} else {
    $backendTunnel = & $startBackend
    # The second ngrok endpoint is refused on a free account; fall back to
    # localtunnel, and carry on backend-only if that fails too.
    try {
        $frontendTunnel = & $startFrontend
    } catch {
        $frontendError = $_.Exception.Message
        Write-Log "frontend tunnel failed: $frontendError"
        Write-Log "Falling back to localtunnel for the frontend."
        try {
            $frontendTunnel = Start-LocaltunnelTunnel -Port 5173 -Label 'frontend'
        } catch {
            Write-Warning "Frontend tunnel unavailable; the backend tunnel is still live."
        }
    }
}

# Strip trailing slashes for clean URLs.
$backendUrl  = if ($backendTunnel) { $backendTunnel.Url.TrimEnd('/') } else { '' }
$frontendUrl = if ($frontendTunnel) { $frontendTunnel.Url.TrimEnd('/') } else { '' }

# ---------------------------------------------------------------------------
# Verify the tunnels actually serve traffic before advertising them.
#
# A tunnel can print a URL and still be dead (the agent then gets 503/404 with
# no clue why). Probe the backend through the tunnel, including the
# bypass-tunnel-reminder header localtunnel requires, and abort on failure.
# ---------------------------------------------------------------------------
# Probe whichever endpoint is public. In -Target frontend the API is reached via
# the Vite proxy, so the frontend URL is the one that must answer /api/health.
# ngrok serves an interstitial to unknown clients, so send Accept: application/json
# to prove an API request reaches the app rather than the warning page.
$probeHeaders = @{
    'bypass-tunnel-reminder' = 'true'
    'Accept'                 = 'application/json'
}
$probeUrl = if ($backendUrl) { $backendUrl } else { $frontendUrl }
$verified = $false
if ($probeUrl) {
    try {
        $probe = Invoke-WebRequest -Uri "$probeUrl/api/health" -Headers $probeHeaders -UseBasicParsing -TimeoutSec 25
        if ($probe.StatusCode -eq 200) {
            $verified = $true
            Write-Log "Verified end-to-end: $probeUrl/api/health -> 200"
        }
    } catch {
        Write-Log "WARNING: probe failed: $($_.Exception.Message)"
    }
} else {
    Write-Log "WARNING: no public URL to probe."
}

if (-not $verified) {
    Write-Warning "Tunnel did not verify. A sandbox VM agent will NOT be able to reach the app."
    Write-Warning "Check scripts/utility/*.log and that the services are listening on 127.0.0.1."
}

# ---------------------------------------------------------------------------
# Export env vars for this session + write state file
# ---------------------------------------------------------------------------
# Process-local only: the running backend never sees this. Tunnel origins are
# matched by allow_origin_regex in app/core/cors.py, so no restart is needed.
$env:PUBLIC_ORIGIN = $backendUrl

$state = @{
    provider     = $Provider

    backend_url  = $backendUrl
    frontend_url = $frontendUrl
    backend_pid  = if ($backendTunnel) { $backendTunnel.Pid } else { $null }
    frontend_pid = if ($frontendTunnel) { $frontendTunnel.Pid } else { $null }
    backend_node_pid  = if ($backendTunnel) { $backendTunnel.NodePid } else { $null }
    frontend_node_pid = if ($frontendTunnel) { $frontendTunnel.NodePid } else { $null }
    backend_process_tree  = if ($backendTunnel) { @($backendTunnel.Tree) } else { @() }
    frontend_process_tree = if ($frontendTunnel) { @($frontendTunnel.Tree) } else { @() }
    verified     = $verified
    # localtunnel serves an interstitial to unknown clients; agents must send
    # this header or they receive the reminder page instead of JSON.
    required_headers = @{ 'bypass-tunnel-reminder' = 'true' }
    cors_note   = 'Backend CORS allows *.loca.lt via allow_origin_regex; no PUBLIC_ORIGIN restart needed.'
    started_at  = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 5

if (-not (Test-Path -LiteralPath $UtilityDir)) {
    New-Item -ItemType Directory -LiteralPath $UtilityDir -Force | Out-Null
}
Set-Content -LiteralPath $TunnelStateFile -Value $state -Encoding UTF8

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " Tunnels active" -ForegroundColor Green
Write-Host " Frontend : $frontendUrl" -ForegroundColor Green
if ($backendUrl) { Write-Host " Backend  : $backendUrl" -ForegroundColor Green }
Write-Host " State    : $TunnelStateFile" -ForegroundColor Green
Write-Host "============================================================`n" -ForegroundColor Green
Write-Host "Sandbox VM agent should use:" -ForegroundColor Yellow
if ($backendUrl) { Write-Host "  Backend API : $backendUrl" -ForegroundColor Yellow }
Write-Host "  Frontend    : $frontendUrl" -ForegroundColor Yellow
Write-Host "  Verified    : $verified" -ForegroundColor $(if ($verified) { 'Green' } else { 'Red' })

if ($backendUrl) {
    Write-Host "  API        : $backendUrl/api/..." -ForegroundColor Yellow
} else {
    Write-Host "  API        : $frontendUrl/api/...   (proxied to the local backend by Vite)" -ForegroundColor Yellow
}

Write-Host "`nlocaltunnel requires bypass-tunnel-reminder: true on every request" -ForegroundColor Cyan
Write-Host "(otherwise the agent gets an HTML interstitial instead of JSON)." -ForegroundColor Cyan
Write-Host "`nExample:" -ForegroundColor Cyan
Write-Host "  curl -H 'Accept: application/json' -H 'bypass-tunnel-reminder: true' $(if ($backendUrl) { $backendUrl } else { $frontendUrl })/api/health" -ForegroundColor Cyan
Write-Host "  .\scripts\stop-tunnel.ps1`n" -ForegroundColor Cyan
