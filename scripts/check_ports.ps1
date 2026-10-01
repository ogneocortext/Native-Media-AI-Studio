#Requires -Version 7.6
<#
.SYNOPSIS
    Map every LISTENING TCP port to its owning process (stale-server triage).
.DESCRIPTION
    Fast triage for stale/zombie dev servers. Lists listening ports owned by
    the studio's runtime processes (node/npm/vite, uvicorn/python, Go sidecars).
    Pass -All to list every listening port on the machine.
.PARAMETER ProcessName
    Process names to include. Defaults to the studio's runtime processes.
.PARAMETER All
    Show all listening ports regardless of owning process.
.EXAMPLE
    pwsh -NoProfile -File scripts\check_ports.ps1
.EXAMPLE
    pwsh -NoProfile -File scripts\check_ports.ps1 -All
#>
[CmdletBinding()]
param(
    [string[]]$ProcessName = @(
        'node', 'npm', 'vite', 'uvicorn', 'python',
        'go-dashboard', 'go-media', 'go-worker', 'go-gateway', 'go-ports'
    ),
    [switch]$All
)

Set-StrictMode -Version Latest

Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalPort, OwningProcess, @{
        N = 'Process'
        E = {
            $owner = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
            if ($owner) { $owner.ProcessName } else { '<exited>' }
        }
    } |
    Where-Object { $All -or ($_.Process -in $ProcessName) } |
    Sort-Object LocalPort |
    Format-Table -AutoSize
