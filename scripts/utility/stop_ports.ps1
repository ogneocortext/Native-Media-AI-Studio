$ports = 5173, 8000, 8188, 8080
$pids = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($pids) {
    $pids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Host "Stopped PID: $_" }
} else { Write-Host 'No processes found on those ports' }
