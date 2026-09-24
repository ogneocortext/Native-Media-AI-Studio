# One-off: full PSScriptAnalyzer report for the repo's PowerShell files.
param(
    [string[]]$Paths = @('scripts', 'tools'),
    [string]$Exclude = 'PSAvoidUsingWriteHost'
)

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $root
try {
    foreach ($p in $Paths) {
        Invoke-ScriptAnalyzer -Path $p -Recurse -Severity Error, Warning |
            Where-Object { $_.RuleName -ne $Exclude } |
            ForEach-Object {
                '{0,-6} {1,-48} {2,-26} L{3}' -f
                    $_.Severity.ToString().ToUpper(),
                    (Split-Path $_.ScriptName -Leaf),
                    $_.RuleName,
                    $_.Line
            }
    }
}
finally {
    Pop-Location
}

