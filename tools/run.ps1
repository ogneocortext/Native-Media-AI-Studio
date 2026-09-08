# tools/run.ps1
# Launcher for standalone tools using the studio-tools Python 3.14 venv.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\run.ps1 tools\lib\paths.py
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\run.ps1 scripts\utility\convert_lyrics_csv.py -- --help
#
# The double-dash (--) separates launcher args from the target script's args.
param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$ScriptPath,

    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$ScriptArgs
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$candidate = Join-Path $repoRoot $ScriptPath

if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    Write-Error "Script not found: $candidate"
    exit 1
}

$python = Join-Path $repoRoot '..\..\conda-envs\studio-tools\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    Write-Error "studio-tools Python not found at: $python"
    exit 1
}

& $python $candidate @ScriptArgs
