#Requires -Version 7.6
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Write-Host '=== PARSE CHECK (all scripts) ==='
Get-ChildItem -Path (Join-Path $root 'scripts'), (Join-Path $root 'tools') -Filter *.ps1 -Recurse |
    Where-Object { $_.FullName -notmatch '\\(node_modules|third_party)\\' } |
    ForEach-Object {
        $errors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$errors)
        if ($errors -and $errors.Count -gt 0) {
            Write-Host "PARSE_ERROR $($_.Name): $($errors[0].Message)"
        }
    }
Write-Host 'PARSE_CHECK_DONE'

Write-Host "`n=== STRICT MODE PROBE ==="
Set-StrictMode -Version Latest
$hashtable = @{ a = 1 }
try {
    $v = $hashtable.missing
    Write-Host "hashtable missing key -> OK (returns null, no throw); value=[$v]"
}
catch {
    Write-Host "hashtable missing key -> THROWS: $($_.Exception.Message)"
}
$psobject = [pscustomobject]@{ a = 1 }
try {
    $v = $psobject.missing
    Write-Host "PSCustomObject missing property -> OK (returns null); value=[$v]"
}
catch {
    Write-Host "PSCustomObject missing property -> THROWS (expected under StrictMode >=2.0)"
}
try {
    $undefinedVar
    Write-Host 'undefined variable -> OK (no throw)'
}
catch {
    Write-Host 'undefined variable -> THROWS (expected under StrictMode Latest)'
}
try {
    $empty = @()
    Write-Host "empty array index 0 -> $($empty[0])"
}
catch {
    Write-Host 'empty array index 0 -> THROWS (expected under StrictMode >=3.0)'
}
