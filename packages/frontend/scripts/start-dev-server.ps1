<# 
.SYNOPSIS
    Robust Vite Dev Server Startup for Windows
    Handles cache cleanup, dependency optimization, and stable server startup.

.DESCRIPTION
    This script wraps the Node.js startup script to provide a PowerShell-native
    experience with proper error handling and colored output.

.PARAMETER Clean
    Clean Vite cache before starting (recommended after branch switch)

.PARAMETER ForceReoptimize
    Force dependency re-optimization (recommended after package changes)

.PARAMETER NoWarmup
    Disable server.warmup

.PARAMETER Port
    Override frontend port (default: from config/ports.json)

.PARAMETER Host
    Override host (default: 0.0.0.0)

.EXAMPLE
    .\scripts\start-dev-server.ps1

.EXAMPLE
    .\scripts\start-dev-server.ps1 -Clean -ForceReoptimize

.EXAMPLE
    .\scripts\start-dev-server.ps1 -Port 3000
#>

param(
    [switch]$Clean,
    [switch]$ForceReoptimize,
    [switch]$NoWarmup,
    [int]$Port,
    [string]$HostName = "0.0.0.0",
    [switch]$Help
)

# Handle Help early
if ($Help) {
    Get-Help $MyInvocation.MyCommand.Definition -Full
    exit 0
}

# Colors
$Red = [ConsoleColor]::Red
$Green = [ConsoleColor]::Green
$Yellow = [ConsoleColor]::Yellow
$Cyan = [ConsoleColor]::Cyan
$Gray = [ConsoleColor]::DarkGray

function Write-Log {
    param([string]$Message, [ConsoleColor]$Color = $Gray)
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$timestamp] $Message" -ForegroundColor $Color
}

function Write-ErrorLog {
    param([string]$Message)
    Write-Log "ERROR: $Message" $Red
}

function Write-Success {
    param([string]$Message)
    Write-Log "✓ $Message" $Green
}

function Write-Warning {
    param([string]$Message)
    Write-Log "⚠ $Message" $Yellow
}

# Determine paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
# Script is at packages/frontend/scripts/start-dev-server.ps1
# Frontend dir is packages/frontend (one level up from scripts)
$FrontendDir = Resolve-Path "$ScriptDir\.."
$ProjectRoot = Resolve-Path "$FrontendDir\..\.."
$ViteCacheDir = "$FrontendDir\node_modules\.vite"
$PortsConfig = "$ProjectRoot\config\ports.json"

Write-Log "============================================" $Cyan
Write-Log "  Native Media AI Studio - Vite Dev Server" $Cyan
Write-Log "============================================" $Cyan
Write-Log "Frontend directory: $FrontendDir"
Write-Log "Vite cache: $ViteCacheDir"

# Load ports config
$FrontendPort = 5173
$BackendPort = 8000
if (Test-Path $PortsConfig) {
    try {
        $config = Get-Content $PortsConfig -Raw | ConvertFrom-Json
        $FrontendPort = $config.frontend_port ?? 5173
        $BackendPort = $config.backend_port ?? 8000
        Write-Log "Loaded ports: frontend=$FrontendPort, backend=$BackendPort" $Gray
    } catch {
        Write-Warning "Failed to load ports.json, using defaults"
    }
}

$ActualPort = if ($Port) { $Port } else { $FrontendPort }
$ActualHost = $HostName

# Clean Vite cache
if ($Clean) {
    Write-Log "Cleaning Vite cache..." $Yellow
    if (Test-Path $ViteCacheDir) {
        try {
            Remove-Item -Recurse -Force -Path $ViteCacheDir -ErrorAction Stop
            Write-Success "Vite cache removed"
        } catch {
            Write-ErrorLog "Failed to remove Vite cache: $_"
        }
    } else {
        Write-Log "No Vite cache to clean" $Gray
    }

    # Clean Turbo cache
    $TurboCache = "$ProjectRoot\.turbo"
    if (Test-Path $TurboCache) {
        try {
            Remove-Item -Recurse -Force -Path $TurboCache -ErrorAction Stop
            Write-Success "Turbo cache removed"
        } catch {
            Write-Warning "Failed to remove Turbo cache: $_"
        }
    }
}

# Force re-optimization
if ($ForceReoptimize) {
    Write-Log "Forcing dependency re-optimization..." $Yellow
    $Env:VITE_FORCE_REOPTIMIZE = "true"
    
    $DepsCache = "$FrontendDir\node_modules\.vite\deps"
    if (Test-Path $DepsCache) {
        try {
            Remove-Item -Recurse -Force -Path $DepsCache -ErrorAction Stop
            Write-Success "Dependency pre-bundle cache removed"
        } catch {
            Write-Warning "Failed to remove deps cache: $_"
        }
    }
}

# Disable warmup if requested
if ($NoWarmup) {
    $Env:VITE_DISABLE_WARMUP = "true"
    Write-Log "Warmup disabled" $Gray
}

# Verify node_modules
Write-Log "Verifying node_modules..." $Gray
$NodeModules = "$FrontendDir\node_modules"
$PnpmLock = "$ProjectRoot\pnpm-lock.yaml"

if (-not (Test-Path $NodeModules)) {
    Write-ErrorLog "node_modules missing! Run 'pnpm install' first."
    exit 1
}

if (-not (Test-Path $PnpmLock)) {
    Write-Warning "pnpm-lock.yaml not found at project root"
}

$CriticalPackages = @("vite", "@vitejs/plugin-react", "@tailwindcss/vite", "react", "react-dom")
$AllPresent = $true
foreach ($pkg in $CriticalPackages) {
    $pkgPath = "$NodeModules\$pkg"
    if (-not (Test-Path $pkgPath)) {
        Write-ErrorLog "Missing critical package: $pkg"
        $AllPresent = $false
    }
}

if (-not $AllPresent) {
    Write-ErrorLog "Cannot start: node_modules verification failed"
    exit 1
}
Write-Success "Critical packages present"

# Start Vite
Write-Log "Starting Vite dev server on ${ActualHost}:${ActualPort}..." $Cyan

$ViteArgs = @("exec", "vite", "--port", $ActualPort.ToString(), "--host", $ActualHost)
$exe = "pnpm.cmd"
$env:FORCE_COLOR = "1"
$env:NODE_ENV = "development"

try {
    # Use Start-Process for better signal handling on Windows
    $process = Start-Process -FilePath $exe -ArgumentList $ViteArgs -WorkingDirectory $FrontendDir -Wait -NoNewWindow -PassThru
    $exitCode = $process.ExitCode
    
    if ($exitCode -ne 0) {
        Write-ErrorLog "Vite exited with code $exitCode"
        exit $exitCode
    }
} catch {
    Write-ErrorLog "Failed to start Vite: $_"
    exit 1
}

Write-Log "Vite dev server stopped" $Gray