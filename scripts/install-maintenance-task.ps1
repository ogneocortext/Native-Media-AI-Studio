# Install/remove the daily maintenance scheduled task.
#
# Registers "NativeMediaAIStudio-Maintenance": runs
# tools/maintenance_daily.py once a day (default 04:00 local) so the
# non-GPU upkeep loop - metrics digest, model-catalog refresh, dangling-
# commit check, doc drift, backup rotation, history pruning, dedup probe -
# happens without anyone remembering.
#
# Usage:
#   pwsh -File scripts/install-maintenance-task.ps1            # install @04:00
#   pwsh -File scripts/install-maintenance-task.ps1 -Time '03:30'
#   pwsh -File scripts/install-maintenance-task.ps1 -Uninstall
#
# Digest output lands in tools/self-metrics/daily/<date>.txt.

[CmdletBinding()]
param(
    [string]$Time = '04:00',
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'NativeMediaAIStudio-Maintenance'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Python = (Get-Command python -ErrorAction Stop).Source

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "Removed scheduled task '$TaskName' (if present)."
    exit 0
}

$Action = New-ScheduledTaskAction `
    -Execute 'pwsh.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -Command `"Set-Location '$RepoRoot'; & '$Python' tools/maintenance_daily.py`""

$Trigger = New-ScheduledTaskTrigger -Daily -At $Time

$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description 'Daily non-GPU maintenance: metrics digest, model catalog, doc drift, backup rotation, dedup probe.' `
    -Force | Out-Null

Write-Output "Installed '$TaskName' - daily at $Time, repo: $RepoRoot"
Write-Output "Digest: tools/self-metrics/daily/<date>.txt"
Write-Output "Remove with: pwsh -File scripts/install-maintenance-task.ps1 -Uninstall"
