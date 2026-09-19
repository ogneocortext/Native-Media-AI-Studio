#Requires -Version 7.6
$files = @(
  'scripts\check_ports.ps1',
  'scripts\dev\count-braces.ps1',
  'scripts\dev\count-depth.ps1',
  'scripts\utility\tests\test-3d-gen.ps1',
  'scripts\start_dev.ps1',
  'tools\run.ps1',
  'scripts\start-services.ps1',
  'scripts\start-studio.ps1',
  'scripts\check-env-health.ps1',
  'scripts\shared-utils.ps1',
  'scripts\archive\hermes-profiles.ps1',
  'scripts\manage-servers.ps1'
)
foreach ($f in $files) {
    $b = [IO.File]::ReadAllBytes($f)
    $crlf = 0
    for ($i = 0; $i -lt $b.Length - 1; $i++) { if ($b[$i] -eq 13 -and $b[$i+1] -eq 10) { $crlf++ } }
    $lf = 0
    for ($i = 0; $i -lt $b.Length; $i++) { if ($b[$i] -eq 10) { $lf++ } }
    $bom = ($b.Length -ge 3 -and $b[0] -eq 239 -and $b[1] -eq 187 -and $b[2] -eq 191)
    Write-Output "$f CRLF=$crlf BareLF=$($lf - $crlf) BOM=$bom"
}