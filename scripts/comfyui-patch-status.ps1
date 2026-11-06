<#
.SYNOPSIS
Displays ComfyUI safe-update status: local state, patches, backups, and drift.

.PARAMETER ComfyUIPath
Path to the ComfyUI git checkout.

.EXAMPLE
  .\comfyui-patch-status.ps1
#>

param(
    [string]$ComfyUIPath = 'D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI',
    [string]$PatchRoot = 'D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\scripts\comfyui-patches',
    [string]$BackupRoot = 'D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\.comfyui-backups'
)

$ErrorActionPreference = 'SilentlyContinue'

function Write-Step { param([string]$Msg) Write-Host "[STEP] $Msg" -ForegroundColor Cyan }
function Write-OK { param([string]$Msg) Write-Host "[OK] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[WARN] $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "[FAIL] $Msg" -ForegroundColor Red }

function Invoke-Git {
    # Arguments must be an array: a single string with spaces is passed to
    # git as ONE argv element, so "rev-parse --abbrev-ref HEAD" fails as an
    # unknown command and every call below silently reported nothing.
    param([string]$Path, [string[]]$Arguments)
    $output = & git -C $Path @Arguments 2>&1
    return $output -join "`n"
}

# --- ComfyUI Git State ---
Write-Host "`nComfyUI Local State" -ForegroundColor Cyan
if (-not (Test-Path "$ComfyUIPath\.git")) {
    Write-Host "  NOT A GIT REPO: $ComfyUIPath" -ForegroundColor Red
    exit 1
}

$branch = Invoke-Git -Path $ComfyUIPath -Arguments 'rev-parse','--abbrev-ref','HEAD'
$commit = Invoke-Git -Path $ComfyUIPath -Arguments 'rev-parse','--short','HEAD'
$remote = git -C $ComfyUIPath remote get-url origin
$version = if (Test-Path "$ComfyUIPath\version.txt") { Get-Content "$ComfyUIPath\version.txt" -Raw } else { 'unknown' }

Write-Host "  Path     : $ComfyUIPath"
Write-Host "  Version  : $version"
Write-Host "  Branch   : $branch"
Write-Host "  Commit   : $commit"
Write-Host "  Remote   : $remote"

# --- Upstream ---
Write-Host "`nUpstream" -ForegroundColor Cyan

# Check if we're behind/ahead
$upstreamRefOutput = Invoke-Git -Path $ComfyUIPath -Arguments 'rev-parse', "$branch@{upstream}"
if ($LASTEXITCODE -eq 0 -and $upstreamRefOutput) {
    $upstreamRef = $upstreamRefOutput
    $behind = [int](Invoke-Git -Path $ComfyUIPath -Arguments 'rev-list','--count', "$upstreamRef..HEAD")
    $ahead = [int](Invoke-Git -Path $ComfyUIPath -Arguments 'rev-list','--count', "HEAD..$upstreamRef")
    if ($ahead -gt 0) {
        Write-Host "  Ahead of upstream by $ahead commit(s)" -ForegroundColor Yellow
    } elseif ($behind -gt 0) {
        Write-Host "  Behind upstream by $behind commit(s)" -ForegroundColor Yellow
    } else {
        Write-OK "Up-to-date with upstream"
    }
} else {
    Write-Warn "No upstream tracking branch configured"
}

$tagsOutput = Invoke-Git -Path $ComfyUIPath -Arguments 'ls-remote','--tags','origin','v*'
$tags = $tagsOutput -split "`n" | ForEach-Object { ($_ -split '/')[-1] } | Where-Object { $_ -match '^v\d+\.' } | Sort-Object { [version]($_ -replace '^v','') } -Descending | Select-Object -First 5
$latest = $tags | Select-Object -First 1
if ($latest) {
    Write-Host "  Latest upstream tag: $latest"
    if ($tags.Count -gt 1) {
        Write-Host "  Recent tags:"
        $tags | Select-Object -Skip 1 | ForEach-Object { Write-Host "    $_" }
    }
} else {
    Write-Warn "Could not fetch upstream tags"
}

# --- Local Changes ---
Write-Host "`nLocal Changes" -ForegroundColor Cyan
$modified = Invoke-Git -Path $ComfyUIPath -Arguments 'diff','--name-only'
$staged = Invoke-Git -Path $ComfyUIPath -Arguments 'diff','--cached','--name-only'
$untracked = Invoke-Git -Path $ComfyUIPath -Arguments 'ls-files','--others','--exclude-standard'

if ($modified) {
    Write-Host "Modified (unstaged):" -ForegroundColor Yellow
    $modified -split "`n" | ForEach-Object { Write-Host "  M $_" }
} else {
    Write-Host "Modified (unstaged): (none)"
}
if ($staged) {
    Write-Host "`nStaged:" -ForegroundColor Yellow
    $staged -split "`n" | ForEach-Object { Write-Host "  S $_" }
} else {
    Write-Host "`nStaged: (none)"
}
if ($untracked) {
    Write-Host "`nUntracked:" -ForegroundColor Yellow
    $untracked -split "`n" | ForEach-Object { Write-Host "  ? $_" }
} else {
    Write-Host "`nUntracked: (none)"
}

# --- Patches ---
Write-Host "`nPatches" -ForegroundColor Cyan
if (Test-Path "$PatchRoot\manifest.json") {
    $patchManifest = Get-Content "$PatchRoot\manifest.json" -Raw | ConvertFrom-Json
    Write-Host "  Last exported: $($patchManifest.Timestamp)"
    $patchList = @($patchManifest.Patches)
    Write-Host "  Patch count : $($patchList.Count)"
    if ($patchList.Count -gt 0) {
        Write-Host "  Patches:"
        $patchList | ForEach-Object { Write-Host "    - $_" }
    }

    # Drift detection: compare patches against current modified files
    Write-Host "`n  Drift Detection" -ForegroundColor Cyan
    $patchFiles = @()
    foreach ($patchName in $patchList) {
        $patchPath = Join-Path $PatchRoot $patchName
        if (Test-Path $patchPath) {
            $header = Get-Content $patchPath -TotalCount 5 -Raw
            if ($header -match '^diff --git a/(.+?) b/') {
                $patchFiles += $Matches[1]
            }
        }
    }

    $currentModified = @($modified -split "`n" | Where-Object { $_ }) + @($staged -split "`n" | Where-Object { $_ })
    $driftPatches = @()
    foreach ($p in $patchFiles) {
        if ($currentModified -notcontains $p) {
            $driftPatches += $p
        }
    }
    if ($driftPatches.Count -gt 0) {
        Write-Warn "  Patches with no matching current modification:"
        $driftPatches | ForEach-Object { Write-Host "    - $_ (patch may be stale)" }
    } else {
        Write-OK "  All patches correspond to current modifications"
    }

    # Check if patches apply cleanly
    Write-Host "`n  Patch Validity" -ForegroundColor Cyan
    $diffPatches = Get-ChildItem $PatchRoot -Filter '*.diff' | Sort-Object Name
    $staleCount = 0
    $invalidCount = 0
    foreach ($p in $diffPatches) {
        # Check if patch applies to working tree (already applied = stale)
        # Only the exit code matters here; the output is noise.
        $null = Invoke-Git -Path $ComfyUIPath -Arguments 'apply','--check','--whitespace=nowarn', $p.FullName
        if ($LASTEXITCODE -eq 0) {
            $staleCount++
            Write-Warn "  Already applied (stale): $($p.Name)"
        } else {
            # Non-zero + well-formed = does not apply to the current tree.
            # That covers BOTH a stale patch and one already applied to the
            # working tree (apply --check fails on already-applied context),
            # so don't call it "invalid".
            $patchContent = Get-Content $p.FullName -Raw
            if ($patchContent -match '^diff --git') {
                $invalidCount++
                Write-Warn "  Does not apply cleanly (stale or already applied): $($p.Name)"
            } else {
                $invalidCount++
                Write-Warn "  Malformed patch: $($p.Name)"
            }
        }
    }
    Write-Host "`n  Summary: Applied=$staleCount | Invalid=$invalidCount"
} else {
    Write-Warn "  No patch manifest found at: $PatchRoot"
}

# --- Backups ---
Write-Host "`nBackups" -ForegroundColor Cyan
if (Test-Path $BackupRoot) {
    $backups = Get-ChildItem $BackupRoot -Directory | Sort-Object LastWriteTime -Descending
    if ($backups) {
        Write-Host "  Total backups : $($backups.Count)"
        Write-Host "  Most recent   : $($backups[0].Name) ($($backups[0].LastWriteTime))"
        if ($backups.Count -gt 1) {
            Write-Host "  Older backups :"
            $backups | Select-Object -Skip 1 | ForEach-Object { Write-Host "    - $($_.Name) ($($_.LastWriteTime))" }
        }
    } else {
        Write-Host "  (no backups yet)"
    }
} else {
    Write-Host "  (no backup directory)"
}

# --- Custom Nodes ---
Write-Host "`nCustom Nodes" -ForegroundColor Cyan
$nodesDir = Join-Path $ComfyUIPath 'custom_nodes'
if (Test-Path $nodesDir) {
    $nodes = Get-ChildItem $nodesDir -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
    if ($nodes) {
        $nodes | ForEach-Object { Write-Host "  $_" }
    } else {
        Write-Host "  (none found)"
    }
} else {
    Write-Host "  (no custom_nodes directory)"
}

Write-Host "`nUpdate Command" -ForegroundColor Green
Write-Host "  .\scripts\comfyui-safe-update.ps1"
Write-Host "`nRollback Command" -ForegroundColor Yellow
Write-Host "  .\scripts\comfyui-safe-update.ps1 -Rollback"
Write-Host ""
