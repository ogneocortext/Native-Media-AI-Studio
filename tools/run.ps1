# tools/run.ps1
# Launcher for standalone tools.
#
# Usage:
#   pwsh -NoProfile -ExecutionPolicy Bypass -File tools\run.ps1 tools\lib\paths.py
#   pwsh -NoProfile -ExecutionPolicy Bypass -File tools\run.ps1 scripts\utility\convert_lyrics_csv.py -- --help
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

# Interpreter: the standalone-tooling chain, not a hardcoded path.
# TOOLS_ENV comes from .python-env (the Python 3.14 studio-tools
# venv); Resolve-ToolsPython verifies each candidate actually starts
# and falls back to the studio env, the project venv, then PATH
# python - warning loudly when it drops below the declared tools
# env, since that changes the interpreter version a tool runs under.
# Shared utilities live one directory up, in scripts\.
. (Join-Path $PSScriptRoot '..\scripts\shared-utils.ps1')
$Global:ProjectRoot = $repoRoot
$python = Resolve-ToolsPython
if (-not $python) {
    Write-Error "No Python environment found for standalone tools (TOOLS_ENV from .python-env: $((Get-PythonEnvs).ToolsPython))"
    exit 1
}

& $python $candidate @ScriptArgs
