# PowerShell 7 Command Sheet — Mandatory for All Agent Command Work

**Platform: Windows 11. All terminal commands MUST go through PowerShell 7 (`pwsh`). Do NOT use `bash`, `cmd`, or Unix shells on this machine.** `bash` here resolves to the WSL launcher — it is NOT Git Bash and will produce confusing errors.

**This machine runs PowerShell 7.6.9 (LTS, built on .NET 10).** Windows 11 also ships PowerShell 5.1 (built on .NET Framework 4.x) — that version is retired for repo work. The two versions install side-by-side: `pwsh.exe` is v7+, `powershell.exe` is v5.1. Always use `pwsh`.

Read this before running your first command. Keep it open while working.

---

## 1. Shell Identity Check (run first)

```powershell
# Verify you are in PowerShell 7, not 5.1 or cmd
$PSVersionTable.PSVersion

# Expected: Major = 7 (e.g. 7.6.9), Edition = Core
# If Major = 5, you are in the wrong shell. Exit and use pwsh.
# If Edition = Desktop, you are in Windows PowerShell 5.1 — wrong shell.
```

**The project shell is `pwsh` 7.6.x.** Never invoke scripts as `powershell ...` (that's 5.1).

---

## 2. PowerShell 7.6 vs Windows PowerShell 5.1 — Key Differences

| Feature | PowerShell 5.1 (retired) | PowerShell 7.6 (use this) |
|---------|-------------------------|--------------------------|
| Executable | `powershell.exe` | `pwsh.exe` |
| Install location | `$Env:windir\System32\WindowsPowerShell\v1.0` | `$Env:ProgramFiles\PowerShell\7` |
| .NET base | .NET Framework 4.x | .NET 10 (LTS) |
| Platform | Windows only | Cross-platform (Windows, macOS, Linux) |
| Profiles | `Microsoft.PowerShell_profile.ps1` | Separate 7.x profiles |
| PSModulePath | Separate from 7.x | Separate from 5.1 |
| Ternary operator `? :` | ❌ | ✅ |
| `ForEach-Object -Parallel` | ❌ | ✅ (runspace pool, ThrottleLimit default 5) |
| `Start-ThreadJob` | ❌ (installable module) | ✅ (Microsoft.PowerShell.ThreadJob) |
| `PSForEach()` / `PSWhere()` | ❌ | ✅ (intrinsic method aliases) |
| `Get-Clipboard -Delimiter` | ❌ | ✅ |
| `Join-Path -ChildPath` as string[] | ❌ | ✅ |
| `NO_COLOR` respected | ❌ | ✅ |
| Hex native exit codes | ❌ | ✅ |
| `Import-Module -UseWindowsPowerShell` | N/A | ✅ (load 5.1-only modules in 7.x) |

**Side-by-side rule:** PowerShell 7 installs to a separate directory with a separate executable name (`pwsh.exe`). Both versions can run simultaneously. The new name (`pwsh`) makes it easy to support side-by-side execution.

---

## 3. File & Directory Operations (replaces bash `ls/cp/mv/rm/find/grep/cat`)

| Task | PowerShell 7 | Notes |
|------|-------------|-------|
| List directory | `Get-ChildItem` | Alias: `ls`, `dir`, `gci` |
| List with sizes | `Get-ChildItem \| Format-Table -AutoSize` | |
| Read file contents | `Get-Content` | Alias: `cat`, `type`, `gc` |
| Read first N lines | `Get-Content file -Head 50` | |
| Read last N lines | `Get-Content file -Tail 50` | |
| Search content | `Select-String "pattern" file` | Alias: `sls`. Use Kilo `grep` tool when available. |
| Search recursively | `Select-String -Path "dir\*" -Pattern "pattern"` | |
| Create directory | `New-Item -ItemType Directory -Path "dir"` | Alias: `md`, `mkdir`. `-Target` is literal in 7.6 |
| Create file | `New-Item -ItemType File -Path "file"` | |
| Copy file | `Copy-Item -Path "src" -Destination "dst"` | Alias: `cp`, `cpi` |
| Move/rename | `Move-Item -Path "src" -Destination "dst"` | Alias: `mv`, `mi` |
| Delete file | `Remove-Item -Path "file"` | Alias: `rm`, `ri`, `del`, `erase` |
| Delete directory (recursive) | `Remove-Item -Path "dir" -Recurse -Force` | |
| Check if exists | `Test-Path -Path "file"` | Returns `$true`/`$false` |
| Get file info | `Get-Item -Path "file"` or `Get-ChildItem -File` | |
| Current directory | `Get-Location` | Alias: `pwd`, `cd` (no args) |
| Change directory | `Set-Location "dir"` | Alias: `cd`, `chdir`, `sl` |
| Push/pop directory | `Push-Location "dir"` / `Pop-Location` | Like `pushd`/`popd` |
| Clipboard | `Get-Clipboard -Delimiter ","` | 7.6+ only |
| Command lookup | `Get-Command -ExcludeModule "name"` | 7.6+ only |

**PowerShell works with objects, not text.** Pipe objects, not strings:

```powershell
# Wrong (text-based, fragile): Get-Content file | Select-String "error"
# Right (object-based): Get-Process | Where-Object { $_.CPU -gt 100 }
```

**Filter left:** Apply filters at the source (command parameters) before piping to `Where-Object`:

```powershell
# Good: filter at source
Get-Service -Name w32time

# Bad: retrieve all, then filter
Get-Service | Where-Object Name -EQ w32time
```

---

## 4. Running External Commands & Scripts

### PowerShell scripts (.ps1)

```powershell
# Run a project script (REQUIRED method)
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-services.ps1 -Action start -Services all

# Check ports
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\check_ports.ps1

# Start services — one name per invocation, or use -Command for arrays
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action start -Services all
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action status
```

**Important:** Via `-File`, a comma-separated list arrives as ONE string and fails `ValidateSet`. Pass arrays with `-Command`, or one service per `-Services` invocation.

**In 7.6, `New-Item -Target` is treated as literal** (not expanded). Use literal paths for `-Target`.

### Native command exit codes

In 7.6+, native command exit codes can be shown in hex format. Check `$LASTEXITCODE` after any native command:

```powershell
cmd.exe /c "some-command"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Command failed with exit code $LASTEXITCODE (0x$($LASTEXITCODE.ToString('X')))"
}
```

**Empty capture ≠ success.** Always check `$LASTEXITCODE`, not whether output is empty.

### Python

```powershell
# Default backend Python (conda env — 3.11.9)
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/run-gates.py

# Or via NMA_PYTHON env var if set
python tools/run-gates.py  # ONLY if python resolves to the right env (check first!)

# Run a specific gate subset
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/run-gates.py --only lint docs
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/run-gates.py --only ruff --fix
```

**Never use `C:\Python314\python.exe` for backend work** — it passes ruff but fails pytest (WinError 5 on temp files). Verify with `$env:NMA_PYTHON` or run `tools/run-gates.py` which probes candidates.

### Node.js / pnpm

```powershell
# node is an fnm alias (may be older). Prefer pnpm.cmd with explicit cwd.
pnpm.cmd install
pnpm.cmd test:unit
pnpm.cmd run dev

# From Python with explicit cwd:
D:\conda-envs\nma-studio-cuda\Scripts\python.exe -c "import subprocess; subprocess.run(['pnpm.cmd','test:unit'], cwd='packages/frontend', shell=True)"
```

---

## 5. Parallel Execution (PowerShell 7.6+)

PowerShell 7 offers three parallel execution options. Choose based on workload:

| Option | Best for | Overhead | Notes |
|--------|----------|----------|-------|
| `ForEach-Object -Parallel` | I/O-bound or compute-bound, moderate count | Medium (runspace pool) | ThrottleLimit default 5, runspaces reused from pool |
| `Start-ThreadJob` | Lightweight parallel tasks, fire-and-forget | Low (runspaces) | Module: Microsoft.PowerShell.ThreadJob |
| `Start-Job` | Heavy isolation, separate processes | High (separate process each) | Built-in, no ThrottleLimit |

### `ForEach-Object -Parallel` (7.0+, runspaces reused from pool in 7.1+)

```powershell
# Run scriptblocks in parallel with a throttle limit
1..10 | ForEach-Object -Parallel {
    # $_ is the current input object
    # Use Using: to pass variables from caller scope
    $result = Do-Work -Input $_ -Using:$someVar
    $result
} -ThrottleLimit 5
```

**Important:** Parallel scriptblocks run in temporary runspaces. Objects decorated with ScriptProperties/ScriptMethods may not work correctly across runspaces. PipelineVariable is not supported. Errors are non-deterministic in order.

### `Start-ThreadJob` (lighter than Start-Job)

```powershell
# Thread-based job — lighter weight than Start-Job
$job = Start-ThreadJob -ScriptBlock { Get-Process } -ThrottleLimit 5
$job | Receive-Job -Wait
```

ThreadJob module was renamed to `Microsoft.PowerShell.ThreadJob` in PowerShell 7.6. Installable from PowerShell Gallery for 5.1.

---

## 6. Git Operations

| Task | PowerShell command |
|------|-------------------|
| Status | `git status` |
| Diff | `git diff` |
| Diff stat | `git diff --stat` |
| Log | `git log --oneline -10` |
| Stage files | `git add <file1> <file2>` |
| Commit | `git commit -m "message"` |
| Push | `git push origin main` |
| Pull (rebase) | `git pull --rebase origin main` |
| Check branch | `git branch --show-current` |

**Git via PowerShell:** `git` is a native Windows command. Pipe chain with `&&` works via PowerShell's pipeline-chain operator:

```powershell
git add . && git commit -m "msg" && git push origin main
```

---

## 7. Process & Service Management

| Task | PowerShell command |
|------|-------------------|
| List running processes | `Get-Process` |
| Find process by name | `Get-Process -Name "python"` |
| Kill process | `Stop-Process -Id <pid>` or `Stop-Process -Name "name"` |
| Check if port is listening | `Get-NetTCPConnection -LocalPort 5173` |
| Check all listening ports | `Get-NetTCPConnection -State Listen` |
| Start backend + frontend | `scripts\start-services.ps1` (via pwsh -File) |
| Check service status | `scripts\manage-servers.ps1 -Action status` |

**Port check example:**
```powershell
# Is port 5173 (frontend) listening?
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue

# Is port 8000 (backend) listening?
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
```

**Start-Process improvements in 7.6:** `-Wait` polling is more efficient. Standard handles are explicitly set when using `-NoNewWindow`.

---

## 8. Environment Variables

| Task | PowerShell command |
|------|-------------------|
| Set for current session | `$env:VAR = "value"` |
| View | `$env:VAR` |
| Unset | `$env:VAR = $null` |
| List all | `Get-ChildItem env:` |
| Persistent (user) | `[System.Environment]::SetEnvironmentVariable("VAR", "value", "User")` |

**Example:**
```powershell
$env:NMA_PYTHON = "D:\conda-envs\nma-studio-cuda\Scripts\python.exe"
$env:VISION_VRAM_WARN_PCT = "70"
$env:NO_COLOR = "1"  # Respected by pwsh 7.6+ for stderr output
```

---

## 9. Common Traps to Avoid

| Trap | Wrong | Right |
|------|-------|-------|
| **Unix shell** | `bash`, `sh`, `zsh`, `cmd` | `pwsh` only |
| **`bash` is WSL** | `bash script.sh` | `pwsh -File script.ps1` — `bash` is the WSL launcher, NOT Git Bash |
| **`powershell` = 5.1** | `powershell -File script.ps1` | `pwsh -NoProfile -ExecutionPolicy Bypass -File script.ps1` |
| **Comma list via -File** | `-Services a,b,c` | Pass one service per `-Services` invocation, or use `-Command` |
| **Text pipeline** | `Get-Content file \| grep "x"` | `Select-String -Path "file" -Pattern "x"` |
| **Empty capture = success** | `$x = cmd.exe /c ...; if (-not $x) { ... }` | Check `$LASTEXITCODE` after native commands |
| **UTF-8 decoding** | `subprocess.run(text=True)` (Python) | Pass `encoding="utf-8"` explicitly (see `tools/check-subprocess-encoding.py`) |
| **Background with `&`** | `npm run dev &` | Use `background_process` tool or `Start-Process` |
| **`powershell` on PATH** | May resolve to 5.1 | Use `pwsh` explicitly — 5.1 is retired |
| **Module compatibility** | Assuming 5.1 modules work in 7.x | Use `Import-Module -UseWindowsPowerShell` for 5.1-only modules |
| **Profile confusion** | Editing 5.1 profile | 7.x has separate profiles — edit the 7.x profile |

---

## 10. Common One-Liners

```powershell
# Check PowerShell version
$PSVersionTable.PSVersion

# Check if a port is in use
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue

# Find Python processes
Get-Process -Name "python" -ErrorAction SilentlyContinue

# Kill all Python processes (use with caution)
Get-Process -Name "python" | Stop-Process

# Run backend health check
D:\conda-envs\nma-studio-cuda\Scripts\python.exe -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/health').read().decode())"

# Recursively find .ts files
Get-ChildItem -Path "packages/frontend/src" -Filter "*.ts" -Recurse

# Search for text in all .ts files
Select-String -Path "packages/frontend\src\**\*.ts" -Pattern "useVisualizerState"

# Create a temp dir and cd into it
New-Item -ItemType Directory -Path "$env:TEMP\nma-scratch" -Force; Set-Location "$env:TEMP\nma-scratch"

# View file tail (like `tail -f`)
Get-Content -Path "output/logs/backend.log" -Tail 50 -Wait

# Use intrinsic collection methods (PS 4.0+, 7.6 aliases)
$files = Get-ChildItem "packages/frontend/src\*.ts"
$tsFiles = $files.Where({ $_.Length -gt 1000 })    # alias: PSWhere()
$names   = $files.ForEach({ $_.Name })              # alias: PSForEach()

# Parallel file processing
Get-ChildItem "packages\frontend\src\*.ts" | ForEach-Object -Parallel {
    Select-String -Path $_.FullName -Pattern "TODO"
} -ThrottleLimit 5
```

---

## 11. Running Gates

```powershell
# All gates
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/run-gates.py

# Subset (substring match)
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/run-gates.py --only lint docs
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/run-gates.py --only ruff --fix
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/run-gates.py --only type
```

---

## 12. When PowerShell Fails

Per AGENTS.md: **On any PowerShell failure, fall back to Python immediately.** Use `D:\conda-envs\nma-studio-cuda\Scripts\python.exe` with `subprocess` and explicit `encoding="utf-8"`.

```powershell
# If a .ps1 script fails, diagnose with Python instead of retrying in pwsh
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/check-subprocess-encoding.py
```

---

## Quick Reference: Bash → PowerShell Translation

| Bash | PowerShell 7 |
|------|-------------|
| `ls` | `Get-ChildItem` (`ls`, `dir`, `gci`) |
| `cat file` | `Get-Content file` (`cat`, `type`, `gc`) |
| `grep "pat" file` | `Select-String -Path "file" -Pattern "pat"` (`sls`) |
| `cp src dst` | `Copy-Item src dst` (`cp`, `cpi`) |
| `mv src dst` | `Move-Item src dst` (`mv`, `mi`) |
| `rm file` | `Remove-Item file` (`rm`, `ri`, `del`) |
| `rm -rf dir` | `Remove-Item dir -Recurse -Force` |
| `mkdir dir` | `New-Item -ItemType Directory dir` (`md`, `mkdir`) |
| `pwd` | `Get-Location` (`pwd`, `cd`) |
| `cd dir` | `Set-Location dir` (`cd`, `sl`) |
| `find . -name "*.ts"` | `Get-ChildItem -Recurse -Filter "*.ts"` |
| `head -n 50 file` | `Get-Content file -Head 50` |
| `tail -n 50 file` | `Get-Content file -Tail 50` |
| `pushd dir` | `Push-Location dir` |
| `popd` | `Pop-Location` |
| `ps aux` | `Get-Process` |
| `kill -9 <pid>` | `Stop-Process -Id <pid>` |
| `netstat -tlnp` | `Get-NetTCPConnection -State Listen` |
| `env` | `Get-ChildItem env:` |
| `export VAR=val` | `$env:VAR = "val"` |
| `xargs` | `ForEach-Object` or `ForEach-Object -Parallel` |

---

**Remember: You are on Windows. PowerShell 7 is the only shell for repo work. No bash. No cmd. No Unix utilities. `powershell.exe` (5.1) is retired — use `pwsh.exe` only.**
