#Requires -Version 7.6
$roots = @('scripts', 'tools', 'packages\backend')
$rows = @()
foreach ($r in $roots) {
    if (Test-Path $r) {
        $rows += Invoke-ScriptAnalyzer -Path $r -Recurse -Severity Error, Warning
    }
}
$rows = $rows | Where-Object { $_.RuleName -ne 'PSAvoidUsingWriteHost' }
$lines = $rows | ForEach-Object {
    $msg = $_.Message -replace '[\r\n]+', ' '
    if ($msg.Length -gt 170) { $msg = $msg.Substring(0, 170) }
    '{0}|{1}|{2}|{3}|{4}' -f $_.Severity, $_.ScriptPath, $_.Line, $_.RuleName, $msg
} | Sort-Object
$lines | Out-File -Encoding utf8NoBOM -FilePath 'docs\scratch\pssa_compact.txt'
Write-Output "WROTE $($lines.Count) findings"