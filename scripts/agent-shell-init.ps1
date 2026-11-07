# agent-shell-init.ps1 - dot-source at the top of agent-launched shells.
#
# Agents run `pwsh -NoProfile` (per docs/powershell-command-sheet.md), which
# skips the user profile entirely - so Set-ConsoleUtf8, the PYTHONUTF8 line,
# and the NMA_PYTHON/PATH setup in Microsoft.PowerShell_profile.ps1 never
# execute. This file is the -NoProfile equivalent: same contract, nothing
# interactive (no fnm, no startup check, no PSReadLine).
#
# Usage:
#   pwsh -NoProfile -Command ". 'scripts/agent-shell-init.ps1'; <cmd>"
# or as the first line of a generated .ps1:
#   . "$PSScriptRoot\agent-shell-init.ps1"
#
# Idempotent and safe to dot-source repeatedly. Keeps parity with the
# profile so a -NoProfile shell behaves like a profile shell for anything
# that touches text encoding or resolves the project Python.

try {
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = $utf8
    [Console]::InputEncoding  = $utf8
    $global:OutputEncoding    = $utf8
} catch { }

# PYTHONUTF8=1 is also a User env var, but a shell spawned from a stale
# parent env block won't see it - set it for child python.exe processes.
$env:PYTHONUTF8 = '1'

# ---------------------------------------------------------------------------
# Project Python parity with the interactive profile.
#
# The profile prepends the studio env's Scripts dir to PATH and exports
# NMA_PYTHON / PYTHON_ENV. Without this a -NoProfile shell resolves `python`
# to whatever sits on the system PATH - the wrong interpreter for repo work.
# The interpreter path comes from .python-env (PYTHON_ENV) so it tracks the
# declared source of truth; the hardcoded path is only a fallback.
# ---------------------------------------------------------------------------

$repoRoot   = Split-Path -Parent $PSScriptRoot
$pythonExe  = $null
$envFile    = Join-Path -Path $repoRoot -ChildPath '.python-env'

if (Test-Path -LiteralPath $envFile) {
    foreach ($line in Get-Content -LiteralPath $envFile -ErrorAction SilentlyContinue) {
        if ($line -match '^\s*PYTHON_ENV\s*=\s*(.+?)\s*$') {
            $pythonExe = $Matches[1].Trim('"').Trim("'")
            break
        }
    }
}
if (-not $pythonExe) {
    $pythonExe = 'D:\conda-envs\nma-studio-cuda\Scripts\python.exe'
}

if (Test-Path -LiteralPath $pythonExe) {
    $env:NMA_PYTHON = $pythonExe
    $env:PYTHON_ENV  = $pythonExe

    $scriptsDir = Split-Path -Parent $pythonExe
    $pathEntries = @($env:Path -split ';' | Where-Object { $_ })
    if ($pathEntries -notcontains $scriptsDir) {
        $env:Path = "$scriptsDir;$env:Path"
    }
}
