try {
    $r = Invoke-WebRequest -Uri 'http://localhost:8000/api/health' -UseBasicParsing
    Write-Host "Backend Status: $($r.StatusCode)"
} catch {
    Write-Host "Backend Error: $($_.Exception.Message)"
}
