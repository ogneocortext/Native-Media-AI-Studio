# ComfyUI Safe Update System
# - Backs up local modifications before updating
# - Reapplies tracked patches after git pull
# - Reports drift and allows rollback
#
# Usage:
#   .\comfyui-patch-status.ps1
#   .\comfyui-safe-update.ps1
#   .\comfyui-safe-update.ps1 -Rollback
#   .\comfyui-safe-update.ps1 -DryRun
#   .\comfyui-safe-update.ps1 -KeepBackups 10

param(
    [switch]$Rollback,
    [switch]$ListPatches,
    [switch]$DryRun,
    [switch]$ContinueOnPatchError,
    [switch]$SkipBackup,
    [switch]$Force,
    [int]$KeepBackups = 5,
    [string]$ComfyUIPath = 'D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI',
    [string]$PatchRoot = 'D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\scripts\comfyui-patches',
    [string]$BackupRoot = 'D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\.comfyui-backups'
)

$ErrorActionPreference = 'Stop'

#region Utility Functions

function Write-Step { param([string]$Msg) Write-Host "[STEP] $Msg" -ForegroundColor Cyan }
function Write-OK { param([string]$Msg) Write-Host "[OK] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[WARN] $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "[FAIL] $Msg" -ForegroundColor Red }

function Test-ComfyUI {
    if (-not (Test-Path "$ComfyUIPath\.git")) {
        Write-Fail "ComfyUI is not a git checkout at: $ComfyUIPath"
        exit 1
    }
}

function Get-CommitHash {
    param([string]$Path)
    return & git -C $Path rev-parse HEAD 2>$null
}

function Get-LocalChanges {
    param([string]$Path)
    # Capture modified tracked files (both staged and unstaged)
    $modified = git -C $Path diff --name-only
    $staged = git -C $Path diff --cached --name-only
    $untracked = git -C $Path ls-files --others --exclude-standard
    # Merge and deduplicate
    $allModified = @($modified + $staged | Sort-Object -Unique)
    return @{ Modified = $allModified; Staged = $staged; Untracked = $untracked }
}

function New-Backup {
    param([string]$Path, [string]$Dest)
    if (-not (Test-Path $Dest)) { New-Item -ItemType Directory -Path $Dest -Force | Out-Null }
    $changes = Get-LocalChanges -Path $Path
    $commitHash = Get-CommitHash -Path $Path
    $manifest = @{
        Timestamp   = Get-Date -Format o
        CommitHash  = $commitHash
        Modified    = @()
        Staged      = @()
        Untracked   = @()
        Skipped     = @()
        BackupDir   = $Dest
    }
    foreach ($f in $changes.Modified) {
        $rel = $f
        $src = Join-Path $Path $rel
        $dst = Join-Path $Dest $rel
        $dstDir = Split-Path $dst -Parent
        if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
        Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $dst)) {
            $manifest.Skipped += $rel
        } else {
            $manifest.Modified += $rel
        }
    }
    foreach ($f in $changes.Staged) {
        if ($manifest.Modified -notcontains $f) {
            $rel = $f
            $src = Join-Path $Path $rel
            $dst = Join-Path $Dest $rel
            $dstDir = Split-Path $dst -Parent
            if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
            Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction SilentlyContinue
            if (Test-Path $dst) { $manifest.Staged += $rel }
        }
    }
    foreach ($f in $changes.Untracked) {
        $rel = $f
        $base = Split-Path $rel -Leaf
        $skip = @('nul','con','aux','prn','clock$','com1','com2','com3','com4','com5','com6','com7','com8','com9','lpt1','lpt2','lpt3','lpt4','lpt5','lpt6','lpt7','lpt8','lpt9')
        if ($skip -contains $base.ToLower()) {
            $manifest.Skipped += $rel
            continue
        }
        $src = Join-Path $Path $rel
        $dst = Join-Path $Dest $rel
        $dstDir = Split-Path $dst -Parent
        if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
        Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $dst)) { $manifest.Skipped += $rel } else { $manifest.Untracked += $rel }
    }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Dest 'manifest.json') -Encoding UTF8
    return $manifest
}

function Restore-Backup {
    param([string]$Path, [string]$Dest)
    if (-not (Test-Path "$Dest\manifest.json")) {
        Write-Fail "No backup manifest found at: $Dest"
        exit 1
    }
    $manifest = Get-Content "$Dest\manifest.json" -Raw | ConvertFrom-Json
    foreach ($rel in @($manifest.Modified + $manifest.Staged)) {
        $src = Join-Path $Dest $rel
        $dst = Join-Path $Path $rel
        if (Test-Path $src) {
            $dstDir = Split-Path $dst -Parent
            if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
            Copy-Item -LiteralPath $src -Destination $dst -Force
        }
    }
    foreach ($rel in $manifest.Untracked) {
        $src = Join-Path $Dest $rel
        $dst = Join-Path $Path $rel
        if (Test-Path $src) {
            $dstDir = Split-Path $dst -Parent
            if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
            Copy-Item -LiteralPath $src -Destination $dst -Force
        }
    }
    Write-OK "Restored backup from $Dest"
}

function Export-Patches {
    param([string]$Path, [string]$PatchDir)
    if (-not (Test-Path $PatchDir)) { New-Item -ItemType Directory -Path $PatchDir -Force | Out-Null }
    $changes = Get-LocalChanges -Path $Path
    $idx = 0
    foreach ($f in $changes.Modified) {
        $idx++
        $rel = $f
        $patchFile = Join-Path $PatchDir ("patch_{0:D3}_{1}.diff" -f $idx, ($rel -replace '[\\/]','_'))
        & cmd /c "git -C `"$Path`" diff --no-color -- `"$rel`" > `"$patchFile`""
        if (Test-Path $patchFile) {
            Write-Host "  Exported patch: $rel -> $(Split-Path $patchFile -Leaf)"
        }
    }
    # Also export staged changes as patches
    foreach ($f in $changes.Staged) {
        if ($changes.Modified -notcontains $f) {
            $idx++
            $rel = $f
            $patchFile = Join-Path $PatchDir ("patch_{0:D3}_{1}.diff" -f $idx, ($rel -replace '[\\/]','_'))
            & cmd /c "git -C `"$Path`" diff --cached --no-color -- `"$rel`" > `"$patchFile`""
            if (Test-Path $patchFile) {
                Write-Host "  Exported staged patch: $rel -> $(Split-Path $patchFile -Leaf)"
            }
        }
    }
    $patchManifest = Join-Path $PatchDir 'manifest.json'
    $patchList = Get-ChildItem $PatchDir -Filter '*.diff' | Select-Object -ExpandProperty Name
    [PSCustomObject]@{ Timestamp = Get-Date -Format o; Patches = $patchList } | ConvertTo-Json -Depth 3 | Set-Content $patchManifest -Encoding UTF8
}

function Test-Patches {
    param([string]$Path, [string]$PatchDir)
    if (-not (Test-Path $PatchDir)) { return $true }
    $patches = Get-ChildItem $PatchDir -Filter '*.diff' | Sort-Object Name
    $allOk = $true

    # Stash current changes so we can validate patches against upstream HEAD
    # Only $LASTEXITCODE is consumed; the stash output is noise.
    $null = & cmd /c "git -C `"$Path`" stash push -m `"temp-patch-validation`" --include-untracked 2>&1"
    $stashCreated = $LASTEXITCODE -eq 0

    foreach ($p in $patches) {
        Write-Step "Validating patch: $($p.Name)"
        $output = & cmd /c "git -C `"$Path`" apply --check --whitespace=nowarn `"$($p.FullName)`" 2>&1"
        $outputStr = $output -join "`n"
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Patch validation FAILED against upstream: $($p.Name). Output: $outputStr"
            $allOk = $false
        } else {
            Write-OK "Patch validates against upstream: $($p.Name)"
        }
    }

    # Restore working tree. A failed pop leaves the changes in the stash —
    # surface that loudly instead of silently losing the working tree.
    if ($stashCreated) {
        $popOutput = & cmd /c "git -C `"$Path`" stash pop 2>&1"
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "stash pop FAILED - local changes are still in the stash!"
            Write-Fail ($popOutput -join "`n")
            Write-Fail "Recover manually: git -C `"$Path`" stash list / stash pop"
        }
    }

    return $allOk
}

function Apply-Patches {
    param([string]$Path, [string]$PatchDir)
    if (-not (Test-Path $PatchDir)) { return }
    $patches = Get-ChildItem $PatchDir -Filter '*.diff' | Sort-Object Name
    foreach ($p in $patches) {
        Write-Step "Applying patch: $($p.Name)"
        $output = & cmd /c "git -C `"$Path`" apply --whitespace=nowarn `"$($p.FullName)`" 2>&1"
        $outputStr = $output -join "`n"
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "Patch apply FAILED: $($p.Name). Output: $outputStr"
            if (-not $ContinueOnPatchError) {
                Write-Fail "Aborting update. Run with -ContinueOnPatchError to skip failed patches."
                exit 1
            }
        } else {
            Write-OK "Patch applied: $($p.Name)"
        }
    }
}

function Remove-OldBackups {
    param([string]$BackupRoot, [int]$KeepCount)
    if (-not (Test-Path $BackupRoot)) { return }
    $backups = Get-ChildItem $BackupRoot -Directory | Sort-Object LastWriteTime -Descending
    if ($backups.Count -gt $KeepCount) {
        Write-Step "Cleaning old backups (keeping last $KeepCount)..."
        $toRemove = $backups | Select-Object -Skip $KeepCount
        foreach ($b in $toRemove) {
            Remove-Item $b.FullName -Recurse -Force
            Write-Host "  Removed: $($b.Name)"
        }
    }
}

function Show-Status {
    param([string]$Path)
    Test-ComfyUI
    Write-Host "`nComfyUI Status:" -ForegroundColor Cyan
    Write-Host "  Path    : $Path"
    Write-Host "  Branch  : $(git -C $Path rev-parse --abbrev-ref HEAD)"
    Write-Host "  Commit  : $(git -C $Path rev-parse --short HEAD)"
    Write-Host "  Remote  : $(git -C $Path remote get-url origin)"
    Write-Host ""
    $changes = Get-LocalChanges -Path $Path
    if ($changes.Modified) {
        Write-Host "Modified files:" -ForegroundColor Yellow
        foreach ($f in $changes.Modified) { Write-Host "  M $f" }
    }
    if ($changes.Staged) {
        Write-Host "`nStaged files:" -ForegroundColor Yellow
        foreach ($f in $changes.Staged) { Write-Host "  S $f" }
    }
    if ($changes.Untracked) {
        Write-Host "`nUntracked files:" -ForegroundColor Yellow
        foreach ($f in $changes.Untracked) { Write-Host "  ? $f" }
    }
    if (-not $changes.Modified -and -not $changes.Staged -and -not $changes.Untracked) {
        Write-Host "Working tree is clean." -ForegroundColor Green
    }
    Write-Host ""
}

#endregion

# Main
Test-ComfyUI

if ($Rollback) {
    Write-Step "Rolling back ComfyUI to last backup..."
    if (-not (Test-Path $BackupRoot)) {
        Write-Fail "No backup directory found at: $BackupRoot"
        exit 1
    }
    $latest = Get-ChildItem $BackupRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) {
        Write-Fail "No backup found in: $BackupRoot"
        exit 1
    }
    Restore-Backup -Path $ComfyUIPath -Dest $latest.FullName
    exit 0
}

if ($ListPatches) {
    Write-Step "Available patches in: $PatchRoot"
    if (Test-Path "$PatchRoot\manifest.json") {
        Get-Content "$PatchRoot\manifest.json" -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 3
    } else {
        Write-Warn "No patch manifest found."
    }
    exit 0
}

Show-Status -Path $ComfyUIPath

if (-not $SkipBackup) {
    Write-Step "Creating backup..."
    if (-not (Test-Path $BackupRoot)) { New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null }
    $backupDir = Join-Path $BackupRoot ("backup-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $manifest = New-Backup -Path $ComfyUIPath -Dest $backupDir
    Write-OK "Backup saved to: $backupDir"
    Write-Host "  Modified: $($manifest.Modified.Count) files"
    Write-Host "  Staged  : $($manifest.Staged.Count) files"
    Write-Host "  Untracked: $($manifest.Untracked.Count) files"
    Write-Host "  Commit  : $($manifest.CommitHash)"
    if ($manifest.Skipped) { Write-Warn "  Skipped: $($manifest.Skipped.Count) files (reserved device names)" }
    Write-Host ""

    # Rotate old backups
    Remove-OldBackups -BackupRoot $BackupRoot -KeepCount $KeepBackups
} else {
    Write-Warn "Skipping backup as requested (-SkipBackup)."
    Write-Host ""
}

Write-Step "Exporting patches..."
if (-not (Test-Path $PatchRoot)) { New-Item -ItemType Directory -Path $PatchRoot -Force | Out-Null }
Export-Patches -Path $ComfyUIPath -PatchDir $PatchRoot
Write-OK "Patches exported to: $PatchRoot`n"

if ($DryRun) {
    Write-Step "Validating patches against current tree..."
    $patchesOk = Test-Patches -Path $ComfyUIPath -PatchDir $PatchRoot
    if ($patchesOk) {
        Write-OK "All patches pass dry-run validation."
    } else {
        Write-Fail "Some patches failed dry-run validation. Fix before updating."
        exit 1
    }
    Write-Warn "Dry run complete. No git pull performed."
    exit 0
}

# Pre-flight: validate patches apply cleanly before pulling
Write-Step "Validating patches before update..."
$patchesOk = Test-Patches -Path $ComfyUIPath -PatchDir $PatchRoot
if (-not $patchesOk) {
    Write-Fail "Patch validation failed. Fix or remove broken patches before updating."
    Write-Host "  Rollback (if needed): .\comfyui-safe-update.ps1 -Rollback"
    exit 1
}
Write-OK "All patches validated.`n"

Write-Step "Pulling latest ComfyUI..."
$pullOutput = & cmd /c "git -C `"$ComfyUIPath`" pull origin master 2>&1"
$pull = $pullOutput -join "`n"
if ($LASTEXITCODE -ne 0) {
    Write-Fail "git pull failed: $pull"
    Write-Warn "Rollback with: .\comfyui-safe-update.ps1 -Rollback"
    exit 1
}
Write-OK "git pull completed."
Write-Host "  $pull`n"

$postChanges = Get-LocalChanges -Path $ComfyUIPath
if ($postChanges.Modified -or $postChanges.Staged -or $postChanges.Untracked) {
    Write-Step "Reapplying local patches..."
    Apply-Patches -Path $ComfyUIPath -PatchDir $PatchRoot
} else {
    Write-OK "No local changes after update. Tree is clean."
}

Write-Host "`nPost-update status:" -ForegroundColor Cyan
Show-Status -Path $ComfyUIPath

Write-Host "If something broke, roll back with:" -ForegroundColor Yellow
Write-Host "  .\comfyui-safe-update.ps1 -Rollback`n"
