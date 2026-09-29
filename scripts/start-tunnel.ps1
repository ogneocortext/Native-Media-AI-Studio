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
    [string]$Provider = "ngrok"
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
$backendTunnel = if ($Provider -eq 'ngrok') {
    Start-NgrokTunnel -Port 8000 -Label 'backend'
} else {
    Start-LocaltunnelTunnel -Port 8000 -Label 'backend'
}

# A free ngrok account serves ONE endpoint at a time (ERR_NGROK_334 if a second
# process asks for the same hostname), so the frontend tunnel is optional: fall
# back to localtunnel for it, and skip it entirely if that fails too. Agents
# mostly need the backend API, which is the tunnel that must not be dropped.
$frontendTunnel = $null
$frontendError = $null
if ($Provider -eq 'ngrok') {
    try {
        $frontendTunnel = Start-NgrokTunnel -Port 5173 -Label 'frontend'
    } catch {
        $frontendError = $_.Exception.Message
        Write-Log "ngrok frontend tunnel failed: $frontendError"
        Write-Log "Falling back to localtunnel for the frontend."
        try {
            $frontendTunnel = Start-LocaltunnelTunnel -Port 5173 -Label 'frontend'
        } catch {
            Write-Warning "Frontend tunnel unavailable; the backend tunnel is still live."
        }
    }
} else {
    $frontendTunnel = Start-LocaltunnelTunnel -Port 5173 -Label 'frontend'
}

# Strip trailing slashes for clean URLs.
$backendUrl  = $backendTunnel.Url.TrimEnd('/')
$frontendUrl = if ($frontendTunnel) { $frontendTunnel.Url.TrimEnd('/') } else { '' }

# ---------------------------------------------------------------------------
# Verify the tunnels actually serve traffic before advertising them.
#
# A tunnel can print a URL and still be dead (the agent then gets 503/404 with
# no clue why). Probe the backend through the tunnel, including the
# bypass-tunnel-reminder header localtunnel requires, and abort on failure.
# ---------------------------------------------------------------------------
$probeHeaders = @{ 'bypass-tunnel-reminder' = 'true' }
$verified = $false
try {
    $probe = Invoke-WebRequest -Uri "$backendUrl/api/health" -Headers $probeHeaders -UseBasicParsing -TimeoutSec 25
    if ($probe.StatusCode -eq 200) {
        $verified = $true
        Write-Log "Verified backend tunnel end-to-end: $backendUrl/api/health -> 200"
    }
} catch {
    Write-Log "WARNING: backend tunnel probe failed: $($_.Exception.Message)"
}

if (-not $verified) {
    Write-Warning "Tunnel did not verify. A sandbox VM agent will NOT be able to reach the backend."
    Write-Warning "Check $($backendTunnel.Log) and that the backend is listening on 127.0.0.1:8000."
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
    backend_pid  = $backendTunnel.Pid
    frontend_pid = if ($frontendTunnel) { $frontendTunnel.Pid } else { $null }
    backend_node_pid  = $backendTunnel.NodePid
    frontend_node_pid = if ($frontendTunnel) { $frontendTunnel.NodePid } else { $null }
    backend_process_tree  = @($backendTunnel.Tree)
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
Write-Host " Backend  : $backendUrl" -ForegroundColor Green
Write-Host " Frontend : $frontendUrl" -ForegroundColor Green
Write-Host " State    : $TunnelStateFile" -ForegroundColor Green
Write-Host "============================================================`n" -ForegroundColor Green
Write-Host "Sandbox VM agent should use:" -ForegroundColor Yellow
Write-Host "  Backend API : $backendUrl" -ForegroundColor Yellow
Write-Host "  Frontend    : $frontendUrl" -ForegroundColor Yellow
Write-Host "  Verified    : $verified" -ForegroundColor $(if ($verified) { 'Green' } else { 'Red' })
Write-Host "`nlocaltunnel requires this header on EVERY request (otherwise the" -ForegroundColor Cyan
Write-Host "agent gets an HTML interstitial instead of JSON):" -ForegroundColor Cyan
Write-Host "  bypass-tunnel-reminder: true" -ForegroundColor Cyan
Write-Host "`nExample:" -ForegroundColor Cyan
Write-Host "  curl -H 'bypass-tunnel-reminder: true' $backendUrl/api/health" -ForegroundColor Cyan
Write-Host "`nTo stop tunnels:" -ForegroundColor Cyan
Write-Host "  .\scripts\stop-tunnel.ps1`n" -ForegroundColor Cyan
