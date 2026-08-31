$pids = Get-NetTCPConnection -LocalPort 5173,8188,3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($pids) {
    $pids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Host "Stopped PID: $_" }
} else { Write-Host 'No processes found on those ports' }
