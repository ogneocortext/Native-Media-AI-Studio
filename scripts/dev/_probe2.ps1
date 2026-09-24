#Requires -Version 7.6
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$File,

    [Parameter(Mandatory)]
    [ValidateRange(1, [int]::MaxValue)]
    [int]$Line,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$Old,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$New,

    [switch]$UseRegex
)
$ErrorActionPreference = 'Stop'
$root = git rev-parse --show-toplevel
$p = Join-Path $root $File
$enc = New-Object Text.UTF8Encoding $false
$text = [IO.File]::ReadAllText($p, $enc)
$lines = $text -split "`n"
$idx = $Line - 1
if ($idx -ge $lines.Count) { throw "Line $Line beyond EOF ($($lines.Count) lines) in $File" }
if ($UseRegex) {
    if ($lines[$idx] -notmatch ('(?s).*' + $Old + '.*')) { throw "Line $Line does not match regex in $File. Actual: [$($lines[$idx])]" }
    $lines[$idx] = $lines[$idx] -replace $Old, $New
}
else {
    if ($lines[$idx] -ne $Old) { throw "Line $Line mismatch in $File. Actual: [$($lines[$idx])]" }
    $lines[$idx] = $New
}
[IO.File]::WriteAllText($p, ($lines -join "`n") + "`n", $enc)
Write-Output "patched $File line $Line"