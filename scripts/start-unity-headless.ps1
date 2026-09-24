<#
.SYNOPSIS
    Starts the Unity Pipeline project in persistent headless batch mode.
.DESCRIPTION
    Uses the installed Unity Editor executable to run unity-project-mcp with
    -batchmode with GPU rendering and the HeadlessPipelineBootstrap entry point.
    The Unity project writes its authenticated Pipeline port descriptor to
    unity-project-mcp/Library/Pipeline/.unity-pipeline-port. The process is
    intentionally left running; use -Stop or manage-servers.ps1 to stop it.
.PARAMETER Stop
    Stop the headless Unity process recorded in output/runtime/unity-headless.pid.
.PARAMETER Status
    Print the headless process and Pipeline descriptor status.
#>
[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$Status
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$UnityProject = Join-Path $ProjectRoot 'unity-project-mcp'
$RuntimeDir = Join-Path $ProjectRoot 'output\runtime'
$LogDir = Join-Path $ProjectRoot 'output\logs'
$PidFile = Join-Path $RuntimeDir 'unity-headless.pid'
$LogFile = Join-Path $LogDir 'unity-headless.log'
$PortFile = Join-Path $UnityProject 'Library\Pipeline\.unity-pipeline-port'

New-Item -ItemType Directory -Force -Path $RuntimeDir, $LogDir | Out-Null

function Get-UnityExecutable {
    $configured = $env:UNITY_EXECUTABLE
    if ($configured -and (Test-Path -LiteralPath $configured)) { return $configured }
    $candidates = @(
        'C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Unity.exe',
        'C:\Program Files\Unity\Hub\Editor\6000.5.1f1\Editor\Unity.exe'
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    $hubRoot = 'C:\Program Files\Unity\Hub\Editor'
    if (Test-Path -LiteralPath $hubRoot) {
        $found = Get-ChildItem -LiteralPath $hubRoot -Filter Unity.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    throw 'Unity.exe not found. Set UNITY_EXECUTABLE to the Unity Editor executable.'
}

function Get-HeadlessProcess {
    $candidatePids = @()
    if (Test-Path -LiteralPath $PidFile) {
        $pidText = (Get-Content -LiteralPath $PidFile -Raw).Trim()
        if ($pidText -match '^\d+$') { $candidatePids += [int]$pidText }
    }
    $candidatePids += @(Get-CimInstance Win32_Process -Filter "Name='Unity.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match [regex]::Escape($UnityProject) } |
        Select-Object -ExpandProperty ProcessId)
    foreach ($candidatePid in ($candidatePids | Select-Object -Unique)) {
        $process = Get-Process -Id $candidatePid -ErrorAction SilentlyContinue
        if ($process) { return $process }
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    return $null
}

if ($Status) {
    $process = Get-HeadlessProcess
    [PSCustomObject]@{
        Running = [bool]$process
        Pid = if ($process) { $process.Id } else { $null }
        UnityProject = $UnityProject
        PipelineDescriptor = if (Test-Path -LiteralPath $PortFile) { $PortFile } else { $null }
        Log = $LogFile
    } | Format-List
    exit 0
}

if ($Stop) {
    $process = Get-HeadlessProcess
    if (-not $process) { Write-Host 'Headless Unity is not running.'; exit 0 }
    Stop-Process -Id $process.Id -Force
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped headless Unity PID $($process.Id)."
    exit 0
}

$existing = Get-HeadlessProcess
if ($existing) { Write-Host "Headless Unity already running (PID $($existing.Id))."; exit 0 }
if (-not (Test-Path -LiteralPath $UnityProject)) { throw "Unity project not found: $UnityProject" }

$unity = Get-UnityExecutable
Remove-Item -LiteralPath $PortFile -Force -ErrorAction SilentlyContinue
$unityArgs = "-batchmode -projectPath `"$UnityProject`" -executeMethod NativeMediaStudio.HeadlessPipelineBootstrap.Start -logFile `"$LogFile`""
$process = Start-Process -FilePath $unity -ArgumentList $unityArgs -WorkingDirectory $UnityProject -WindowStyle Hidden -PassThru
$process.Id | Set-Content -LiteralPath $PidFile -Encoding ascii
Write-Host "Started headless Unity PID $($process.Id)."
Write-Host "Waiting for Pipeline descriptor: $PortFile"
$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $PortFile) {
        Write-Host "Unity Pipeline descriptor is ready."
        Get-Content -LiteralPath $PortFile
        exit 0
    }
    Start-Sleep -Seconds 2
}
throw "Timed out waiting for Unity Pipeline descriptor. See $LogFile"
