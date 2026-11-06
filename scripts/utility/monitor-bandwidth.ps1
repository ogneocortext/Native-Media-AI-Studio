<#
.SYNOPSIS
  Bandwidth monitor for tunnel interfaces and overall network.
.DESCRIPTION
  Logs bytes/sec sent/received every N seconds to a rolling CSV.
  Designed to run in the background alongside localtunnel.
#>

param(
  [int]$IntervalSeconds = 5,
  [string]$LogPath = "$PSScriptRoot\..\..\output\logs\bandwidth.csv",
  [switch]$Once
)

# Re-launch hidden if this window is visible so the user is not
# disturbed by a flashing taskbar icon. Self-contained: this script
# re-launches itself (the old two-file wrapper was merged in).
try {
  $ps = Get-Process -Id $PID -ErrorAction Stop
  $mainWindowTitle = $ps.MainWindowTitle
  $mainWindowHandle = $ps.MainWindowHandle
} catch {
  $mainWindowTitle = ''
  $mainWindowHandle = 0
}
if ($mainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($mainWindowTitle)) {
  $argList = @('-NoProfile','-ExecutionPolicy','Bypass','-File', $PSCommandPath)
  if ($IntervalSeconds -ne 5) { $argList += @('-IntervalSeconds', $IntervalSeconds) }
  if ($LogPath -ne "$PSScriptRoot\..\..\output\logs\bandwidth.csv") { $argList += @('-LogPath', $LogPath) }
  if ($Once) { $argList += @('-Once') }
  Start-Process -FilePath 'pwsh.exe' -ArgumentList $argList -WindowStyle Hidden -ErrorAction Stop
  exit 0
}

$ErrorActionPreference = 'SilentlyContinue'

function Get-BandwidthSnapshot {
  $ifs = Get-NetAdapterStatistics -ErrorAction SilentlyContinue
  $result = @{}
  foreach ($if in $ifs) {
    $name = $if.Name
    $result[$name] = @{
      ReceivedBytes = $if.ReceivedBytes
      SentBytes     = $if.SentBytes
    }
  }
  return $result
}

if (-not (Test-Path (Split-Path $LogPath))) {
  New-Item -ItemType Directory -Path (Split-Path $LogPath) -Force | Out-Null
}

$header = 'Timestamp,Interface,ReceivedBytes,SentBytes,ReceivedBytesPerSec,SentBytesPerSec'
if (-not (Test-Path $LogPath)) {
  Add-Content -Path $LogPath -Value $header
}

$prev = Get-BandwidthSnapshot
while ($true) {
  Start-Sleep -Seconds $IntervalSeconds
  $now = Get-Date
  $curr = Get-BandwidthSnapshot
  foreach ($name in $curr.Keys) {
    $c = $curr[$name]
    $p = $prev[$name]
    if (-not $p) { continue }
    $rbps = if ($c.ReceivedBytes -ge $p.ReceivedBytes) { $c.ReceivedBytes - $p.ReceivedBytes } else { 0 }
    $sbps = if ($c.SentBytes -ge $p.SentBytes) { $c.SentBytes - $p.SentBytes } else { 0 }
    $line = "{0},{1},{2},{3},{4},{5}" -f `
      $now.ToString('o'), $name, $c.ReceivedBytes, $c.SentBytes, $rbps, $sbps
    Add-Content -Path $LogPath -Value $line
  }
  $prev = $curr
  if ($Once) { break }
}
