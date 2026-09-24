try {
    $r = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing
    Write-Host "Status: $($r.StatusCode)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
