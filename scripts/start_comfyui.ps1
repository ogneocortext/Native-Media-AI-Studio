# ComfyUI Management Script
# Starts ComfyUI with the dedicated comfyui-cuda conda environment

param(
    [switch]$LowVRAM,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'SilentlyContinue'

# Configuration - uses the dedicated ComfyUI conda environment
$ComfyUIPath = "D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI"
$PythonExe = "D:\conda-envs\comfyui-cuda\Scripts\python.exe"
$ComfyUIPort = 8188

Write-Host "ComfyUI Management" -ForegroundColor Cyan
Write-Host "=================="
Write-Host "Path: $ComfyUIPath" -ForegroundColor Gray
Write-Host "Python: $PythonExe" -ForegroundColor Gray
Write-Host "Port: $ComfyUIPort" -ForegroundColor Gray

# Verify paths
if (-not (Test-Path $ComfyUIPath)) {
    Write-Host "ERROR: ComfyUI not found at $ComfyUIPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $PythonExe)) {
    Write-Host "ERROR: Python not found at $PythonExe" -ForegroundColor Red
    Write-Host "The comfyui-cuda conda environment may not exist." -ForegroundColor Yellow
    exit 1
}

# Check if ComfyUI is already running
$existing = Get-NetTCPConnection -LocalPort $ComfyUIPort -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "ComfyUI is already running on port $ComfyUIPort" -ForegroundColor Green
    Write-Host "Access it at: http://127.0.0.1:$ComfyUIPort" -ForegroundColor Green
    
    # Verify it's healthy
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$ComfyUIPort/system_stats" -TimeoutSec 5
        Write-Host "Health check: OK" -ForegroundColor Green
    } catch {
        Write-Host "Health check: FAILED (service may be starting)" -ForegroundColor Yellow
    }
    exit 0
}

# Change to ComfyUI directory
Set-Location $ComfyUIPath

# Build arguments
$arguments = @(
    "main.py",
    "--port", $ComfyUIPort,
    "--disable-pinned-memory"
)

if ($LowVRAM) {
    $arguments += "--lowvram"
}

Write-Host "Starting ComfyUI..." -ForegroundColor Cyan
Write-Host "Command: $PythonExe $arguments" -ForegroundColor Gray

# Start ComfyUI as a background process
$proc = Start-Process -FilePath $PythonExe `
    -ArgumentList $arguments `
    -WindowStyle Normal `
    -PassThru

Write-Host "ComfyUI starting (PID: $($proc.Id))..." -ForegroundColor Yellow
Write-Host "Wait 10-30 seconds for initialization" -ForegroundColor Gray
Write-Host "Access it at: http://127.0.0.1:$ComfyUIPort" -ForegroundColor Green
