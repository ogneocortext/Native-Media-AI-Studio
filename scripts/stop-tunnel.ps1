<#
.SYNOPSIS
    Stop tunnels started by start-tunnel.ps1.

.DESCRIPTION
    Reads scripts/utility/tunnel-urls.json and kills the tunnel processes.

.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\stop-tunnel.ps1
#>
#Requires -Version 7.6
[CmdletBinding()]
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TunnelStateFile = Join-Path $ProjectRoot 'scripts\utility\tunnel-urls.json'
$LogFile = Join-Path $ProjectRoot 'scripts\utility\tunnel.log'

function Write-Log {
    param([string]$Message)
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$ts] $Message"
    Write-Host $line
    if (Test-Path $LogFile) {
        Add-Content -LiteralPath $LogFile -Value $line
    }
}

if (-not (Test-Path -LiteralPath $TunnelStateFile)) {
    Write-Warning "No tunnel state found at $TunnelStateFile"
    exit 0
}

$state = Get-Content -LiteralPath $TunnelStateFile -Raw | ConvertFrom-Json

# Collect every PID we know about: the recorded wrapper PIDs, the node PIDs
# (the actual tunnel processes), and any explicit process trees.
$pids = @()
foreach ($key in @('backend_pid', 'frontend_pid', 'dashboard_pid', 'backend_node_pid', 'frontend_node_pid')) {
    if ($state.$key) { $pids += [int]$state.$key }
}
foreach ($key in @('backend_process_tree', 'frontend_process_tree')) {
    if ($state.$key) { $pids += @($state.$key | ForEach-Object { [int]$_ }) }
}
$pids = $pids | Where-Object { $_ -gt 0 } | Sort-Object -Unique

foreach ($procId in $pids) {
    try {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            Write-Log "Stopped tunnel process PID $procId"
        }
    } catch {
        Write-Log "Could not stop PID $procId : $_"
    }
}

# Sweep any orphaned localtunnel/ngrok processes left behind by earlier runs
# (the old state file only tracked the cmd wrapper, so the node process
# survived and stayed bound to its public hostname).
$swept = 0
foreach ($proc in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    if ($proc.ProcessId -in $pids) { continue }
    $cl = $proc.CommandLine
    if (-not $cl) { continue }
    if ($cl -match 'localtunnel' -or $proc.Name -eq 'ngrok.exe') {
        if ($proc.Name -eq 'ngrok.exe' -or $cl -match '--port (8000|5173)') {
            try {
                Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
                $swept++
                Write-Log "Swept orphaned tunnel process $($proc.Name) PID $($proc.ProcessId)"
            } catch { }
        }
    }
}
if ($swept -gt 0) { Write-Log "Swept $swept orphaned tunnel process(es)." }

# Clean up state so a subsequent start-tunnel.ps1 is fresh.
Remove-Item -LiteralPath $TunnelStateFile -Force -ErrorAction SilentlyContinue
Write-Log "Tunnel state cleared."
