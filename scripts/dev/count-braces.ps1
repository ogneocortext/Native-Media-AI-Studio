$content = Get-Content -Path "scripts/start-studio.ps1" -Raw
$opens = ($content -replace '[^{]', '').Length
$closes = ($content -replace '[^}]', '').Length
Write-Host "Opens: $opens, Closes: $closes, Diff: $($opens - $closes)"
