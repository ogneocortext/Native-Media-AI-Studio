#Requires -Version 7.6
[CmdletBinding()]
param(
    [switch]$Torch
)

$ErrorActionPreference = 'Stop'

$StandalonePython = 'C:\Users\Aomega Imaging\AppData\Local\Programs\Python\Python311\python.exe'
$StandaloneDir    = 'C:\Users\Aomega Imaging\AppData\Local\Programs\Python\Python311'
$StudioEnv        = 'D:\conda-envs\nma-studio-cuda'
$ComfyEnv         = 'D:\conda-envs\comfyui-cuda'
$ForeignEnv       = 'D:\conda-envs\space-analyzer-cuda'
$ProjectRoot      = Split-Path -Parent $PSScriptRoot
$ProjectVenv      = Join-Path $ProjectRoot 'venv'

# Reuse the shared .python-env parser so this check reads the
# same declaration the launchers do (TOOLS_ENV in particular).
. (Join-Path $PSScriptRoot 'shared-utils.ps1')
$Global:ProjectRoot = $ProjectRoot
# TOOLS_ENV from .python-env is authoritative; the hardcoded
# default is only a fallback for a machine without the file.
$ToolsEnvCfg = Get-PythonEnvConfig -ProjectRoot $ProjectRoot
$ToolsEnv    = $ToolsEnvCfg['TOOLS_ENV']
if (-not $ToolsEnv) { $ToolsEnv = 'D:\conda-envs\studio-tools' }
$ToolsEnvDir = if ($ToolsEnv -match '[\\/]Scripts[\\/]python\.exe$') {
    $ToolsEnv -replace '[\\/]Scripts[\\/]python\.exe$', ''
} else { $ToolsEnv }

$script:pass = 0; $script:warn = 0; $script:fail = 0
function Write-Result([string]$status, [string]$msg) {
    switch ($status) {
        'PASS' { $script:pass++; Write-Host "  [PASS] $msg" -ForegroundColor Green }
        'WARN' { $script:warn++; Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
        'FAIL' { $script:fail++; Write-Host "  [FAIL] $msg" -ForegroundColor Red }
        default { Write-Host "  [INFO] $msg" }
    }
}

function Get-VenvHome([string]$cfgPath) {
    if (-not (Test-Path $cfgPath)) { return $null }
    foreach ($line in Get-Content $cfgPath) {
        if ($line -match '^\s*home\s*=\s*(.+)$') { return $Matches[1].Trim() }
    }
    return $null
}

Write-Host ''
Write-Host '=== Python Environment Health Check ===' -ForegroundColor Cyan

# --- 1. Standalone interpreter (the decoupling anchor) ---
Write-Host "`n[1] Standalone base interpreter"
if (Test-Path $StandalonePython) {
    $v = & $StandalonePython --version 2>&1
    Write-Result 'PASS' "Standalone interpreter present: $StandaloneDir ($v)"
} else {
    Write-Result 'FAIL' "Standalone interpreter MISSING: $StandaloneDir (project envs depend on it)"
}

# --- 2. Studio env decoupling assertion ---
Write-Host "`n[2] Studio env (nma-studio-cuda) decoupling"
if (Test-Path (Join-Path $StudioEnv 'pyvenv.cfg')) {
    $venvHome = Get-VenvHome (Join-Path $StudioEnv 'pyvenv.cfg')
    if ($venvHome -and $venvHome.StartsWith($StandaloneDir, 'OrdinalIgnoreCase')) {
        Write-Result 'PASS' "nma-studio-cuda base = $venvHome (decoupled from other projects)"
    } elseif ($venvHome -and $venvHome -like '*space-analyzer*') {
        Write-Result 'FAIL' "nma-studio-cuda is parented to space-analyzer-cuda! Recreate from standalone Python."
    } else {
        Write-Result 'FAIL' "nma-studio-cuda base is unexpected: $venvHome"
    }
    if (-not (Test-Path (Join-Path $StudioEnv 'Scripts\python.exe'))) {
        Write-Result 'FAIL' 'nma-studio-cuda\Scripts\python.exe missing - env is broken'
    }
} else {
    Write-Result 'FAIL' "nma-studio-cuda not found or has no pyvenv.cfg: $StudioEnv"
}

# --- 3. Project-local venv fallback ---
Write-Host "`n[3] Project-local venv fallback"
$vcfg = Join-Path $ProjectVenv 'pyvenv.cfg'
if (Test-Path $vcfg) {
    $venvHome = Get-VenvHome $vcfg
    if ($venvHome -and $venvHome.StartsWith($StandaloneDir, 'OrdinalIgnoreCase')) {
        Write-Result 'PASS' "venv\ base = standalone C: interpreter (decoupled)"
    } elseif ($venvHome -and $venvHome -like '*space-analyzer*') {
        Write-Result 'FAIL' "Project venv is parented to space-analyzer-cuda! Recreate from standalone Python."
    } elseif ($venvHome) {
        Write-Result 'WARN' "Project venv base is unexpected: $venvHome"
    } else {
        Write-Result 'WARN' "Could not parse pyvenv.cfg home: $vcfg"
    }
} else {
    Write-Result 'WARN' "No project venv at $ProjectVenv (fallback tier unavailable)"
}

# Functional: the fallback tier must be able to run the backend too,
# not merely exist. A venv with python.exe but no backend deps would
# otherwise be picked by the launchers' fallback chain and fail there.
$venvPy = Join-Path $ProjectVenv 'Scripts\python.exe'
if (Test-Path $venvPy) {
    $null = & $venvPy -c "import fastapi, uvicorn, watchfiles" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Result 'PASS' 'project venv can run the backend (functional probe)'
    } else {
        Write-Result 'WARN' 'project venv exists but cannot import the backend runtime'
    }
}

# --- 4. ComfyUI env + foreign env guard ---
Write-Host "`n[4] ComfyUI env & foreign env guard"
if (Test-Path (Join-Path $ComfyEnv 'pyvenv.cfg')) {
    $venvHome = Get-VenvHome (Join-Path $ComfyEnv 'pyvenv.cfg')
    if ($venvHome -and $venvHome.StartsWith($StandaloneDir, 'OrdinalIgnoreCase')) {
        Write-Result 'PASS' "comfyui-cuda base = $venvHome (standalone, decoupled)"
    } elseif ($venvHome -and $venvHome -like '*space-analyzer*') {
        Write-Result 'FAIL' "comfyui-cuda is parented to space-analyzer-cuda! Recreate from standalone Python."
    } else {
        Write-Result 'FAIL' "comfyui-cuda base is unexpected: $venvHome"
    }
    if (-not (Test-Path (Join-Path $ComfyEnv 'Scripts\python.exe'))) {
        Write-Result 'FAIL' 'comfyui-cuda\Scripts\python.exe missing - env is broken'
    }
} else {
    Write-Result 'FAIL' "comfyui-cuda missing: $ComfyEnv (ComfyUI service cannot start)"
}
if (Test-Path $ForeignEnv) {
    Write-Result 'PASS' "space-analyzer-cuda untouched (belongs to a different project - never modify)"
} else {
    Write-Result 'WARN' "space-analyzer-cuda is gone (fine for this project, but moto-vision-venv + any leftover references are now broken)"
}

# --- 5. Standalone tooling env (studio-tools) ---
Write-Host "`n[5] Standalone tooling env (studio-tools)"
$toolsPy = Join-Path $ToolsEnvDir 'Scripts\python.exe'
if (Test-Path $toolsPy) {
    $v = & $toolsPy --version 2>&1
    Write-Result 'PASS' "studio-tools interpreter present: $ToolsEnvDir ($v)"
    # Per-dependency report against tools/requirements-standalone.txt.
    # The env can exist yet be missing declared deps (measured
    # 2026-10-06: numpy and librosa were absent), which only
    # surfaces when a tool that needs them is run - so report
    # each missing one here instead.
    $reqs = @('httpx', 'mss', 'PIL', 'numpy', 'librosa')
    $missing = @()
    foreach ($mod in $reqs) {
        $null = & $toolsPy -c "import $mod" 2>$null
        if ($LASTEXITCODE -ne 0) { $missing += $mod }
    }
    if ($missing.Count -eq 0) {
        Write-Result 'PASS' 'all requirements-standalone.txt deps importable'
    } else {
        Write-Result 'WARN' "missing declared deps: $($missing -join ', ') (restore: tools\requirements-standalone.txt)"
    }
} else {
    Write-Result 'WARN' "studio-tools not found: $ToolsEnvDir (tools\run.ps1 falls back to the studio env)"
}

# --- 6. Functional probe: the studio env can run the backend ---
Write-Host "`n[6] Studio env functional probe"
$studioPy = Join-Path $StudioEnv 'Scripts\python.exe'
if (Test-Path $studioPy) {
    # Presence of python.exe proves nothing (section 2 checks that);
    # the backend needs these three imports to boot at all.
    $null = & $studioPy -c "import fastapi, uvicorn, watchfiles" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Result 'PASS' 'backend runtime imports (fastapi, uvicorn, watchfiles)'
    } else {
        Write-Result 'FAIL' 'backend runtime import failed - env cannot run the backend despite a present python.exe'
    }
}

# --- 7. Optional: torch / CUDA validation in studio env ---
if ($Torch) {
    Write-Host "`n[7] Torch CUDA validation (nma-studio-cuda)"
    $py = Join-Path $StudioEnv 'Scripts\python.exe'
    if (Test-Path $py) {
        $code = "import torch; print('torch', torch.__version__, '| cuda', torch.version.cuda); print('arch', torch.cuda.get_arch_list()); print('available', torch.cuda.is_available())"
        $out = & $py -c $code 2>&1
        if ($LASTEXITCODE -eq 0) {
            $out | ForEach-Object { Write-Host "         $_" }
            $pascalOK = ($out -join ' ') -match 'sm_61'
            $avail    = ($out -join ' ') -match 'available True'
            if ($avail -and $pascalOK) { Write-Result 'PASS' 'CUDA available and sm_61 (Pascal) kernels present' }
            elseif ($avail) { Write-Result 'WARN' 'CUDA available but sm_61 not in arch list - GPU ops may fail' }
            else { Write-Result 'FAIL' 'torch.cuda.is_available() is False (wrong wheel for GTX 1070 Ti?)' }
        } else {
            Write-Result 'FAIL' "torch import failed: $($out | Select-Object -First 3)"
        }
    } else {
        Write-Result 'FAIL' "Studio python not found: $py"
    }
}

# --- Summary ---
Write-Host ''
Write-Host ('=== Summary: {0} pass, {1} warn, {2} fail ===' -f $script:pass, $script:warn, $script:fail) -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
exit 0
