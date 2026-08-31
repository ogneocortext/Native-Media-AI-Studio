$ports = @{ Backend = 8000; Frontend = 5173; ComfyUI = 8188; Video = 8080 }
foreach ($svc in $ports.GetEnumerator()) {
    $listening = Get-NetTCPConnection -LocalPort $svc.Value -State Listen -ErrorAction SilentlyContinue
    $state = if ($listening) { "RUNNING" } else { "STOPPED" }
    Write-Host "$($svc.Key): $state (port $($svc.Value))"
}
