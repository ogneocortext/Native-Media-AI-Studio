# agent-shell-init.ps1 - dot-source at the top of agent-launched shells.
#
# Agents run `pwsh -NoProfile` (per docs/powershell-command-sheet.md), which
# skips the user profile entirely - so Set-ConsoleUtf8 and the PYTHONUTF8
# line in Microsoft.PowerShell_profile.ps1 never execute. This file is the
# -NoProfile equivalent: same two encoding fixes, nothing else.
#
# Usage:
#   pwsh -NoProfile -Command ". 'scripts/agent-shell-init.ps1'; <cmd>"
# or as the first line of a generated .ps1:
#   . "$PSScriptRoot\agent-shell-init.ps1"
#
# Idempotent and safe to dot-source repeatedly. Keeps parity with the
# profile so a -NoProfile shell behaves like a profile shell for anything
# that touches text encoding.

try {
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = $utf8
    [Console]::InputEncoding  = $utf8
    $global:OutputEncoding    = $utf8
} catch { }

# PYTHONUTF8=1 is also a User env var, but a shell spawned from a stale
# parent env block won't see it - set it for child python.exe processes.
$env:PYTHONUTF8 = '1'
