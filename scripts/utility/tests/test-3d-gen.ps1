$ErrorActionPreference = 'Stop'
$body = @{ prompt = 'a happy shrimp character'; steps = 15 } | ConvertTo-Json
$logPath = 'D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\output\logs\3d-test.log'

Write-Output 'Starting 3D generation test...' | Out-File -FilePath $logPath -Encoding utf8

try {
    $r = Invoke-WebRequest -Uri 'http://localhost:8000/api/health/3d/generate' -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 300
    $result = "SUCCESS: $($r.Content)"
    Write-Output $result | Out-File -FilePath $logPath -Append -Encoding utf8
} catch {
    $error = "FAIL: $($_.Exception.Message)"
    Write-Output $error | Out-File -FilePath $logPath -Append -Encoding utf8
}
