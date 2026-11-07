# check-shell-env.ps1 - verify the current shell meets the repo's shell
# contract. Run it in ANY shell (profile or -NoProfile) to see which layer
# is missing. Exits 1 when a required check fails; the interactive-only
# line is informational and never fails the run.
#
#   pwsh -NoProfile -File scripts/check-shell-env.ps1
#   . scripts/agent-shell-init.ps1; pwsh -NoProfile -File scripts/check-shell-env.ps1

$ErrorActionPreference = 'SilentlyContinue'
$failures = 0

function Test-Check {
    param([string]$Name, [bool]$Pass, [string]$Detail = '')
    if ($Pass) {
        Write-Host ("  [PASS] {0}" -f $Name)
    } else {
        Write-Host ("  [FAIL] {0} {1}" -f $Name, $Detail) -ForegroundColor Yellow
        $script:failures++
    }
}

Write-Host 'Shell environment check'
Write-Host ("  pwsh {0} ({1})" -f $PSVersionTable.PSVersion, $PSVersionTable.PSEdition)

Test-Check 'PowerShell 7+' ($PSVersionTable.PSVersion.Major -ge 7)
Test-Check 'Console output UTF-8' ([Console]::OutputEncoding.EncodingName -match 'UTF-8')
Test-Check 'Console input UTF-8'  ([Console]::InputEncoding.EncodingName -match 'UTF-8')
Test-Check 'Pipeline $OutputEncoding UTF-8' ($OutputEncoding.EncodingName -match 'UTF-8')
Test-Check 'PYTHONUTF8=1' ($env:PYTHONUTF8 -eq '1') "(got '$env:PYTHONUTF8')"

$pythonExe = if ($env:NMA_PYTHON) { $env:NMA_PYTHON } else { $null }
Test-Check 'NMA_PYTHON set' ([bool]$pythonExe) "(got '$pythonExe')"
if ($pythonExe -and (Test-Path -LiteralPath $pythonExe)) {
    Test-Check 'NMA_PYTHON exists' $true
} elseif ($pythonExe) {
    Test-Check 'NMA_PYTHON exists' $false "(missing: $pythonExe)"
}

$resolved = (Get-Command python -ErrorAction SilentlyContinue).Source
Test-Check 'python on PATH' ([bool]$resolved) '(no python found)'
if ($pythonExe -and $resolved) {
    $same = [string]::Equals(
        [System.IO.Path]::GetFullPath($resolved),
        [System.IO.Path]::GetFullPath($pythonExe),
        [System.StringComparison]::OrdinalIgnoreCase)
    Test-Check 'python resolves to project env' $same "(got $resolved)"
}

# Informational only - agent shells are expected to be non-interactive.
$isInteractive = -not $env:CI -and -not [Console]::IsInputRedirected
Write-Host ("  [INFO] interactive shell: {0}" -f $isInteractive)

if ($failures -gt 0) {
    Write-Host ("`n{0} check(s) failed. For -NoProfile shells run: . scripts/agent-shell-init.ps1" -f $failures) -ForegroundColor Yellow
    exit 1
}
Write-Host 'All required checks passed.' -ForegroundColor Green
exit 0
