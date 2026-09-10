$content = Get-Content -Path "scripts/start-studio.ps1"
$depth = 0
for ($i = 0; $i -lt $content.Count; $i++) {
    $opens = ($content[$i] -replace '[^{]', '').Length
    $closes = ($content[$i] -replace '[^}]', '').Length
    $depth += $opens - $closes
    if ($depth -gt 3) {
        Write-Host "Line $($i+1): depth=$depth - $($content[$i].Trim())"
    }
}
Write-Host "Final depth: $depth"
