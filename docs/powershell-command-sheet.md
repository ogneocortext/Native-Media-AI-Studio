# PowerShell 7 Command Sheet — Mandatory for All Agent Command Work

**Platform: Windows 11. All terminal commands MUST go through PowerShell 7 (`pwsh`). Do NOT use `bash`, `cmd`, or Unix shells on this machine.** `bash` here resolves to the WSL launcher — it is NOT Git Bash and will produce confusing errors.

Read this before running your first command. Keep it open while working.

---

## 1. Shell Identity Check (run first)

```powershell
# Verify you are in PowerShell 7, not 5.1 or cmd
$PSVersionTable.PSVersion

# Expected output: Major = 7 (e.g. 7.6.6)
# If Major = 5, you are in the wrong shell. Exit and use pwsh.
```

**The project shell is `pwsh` 7.6.6.** The old `powershell` (5.1) is retired. Never invoke scripts as `powershell ...`.

---

## 2. File & Directory Operations (replaces bash `ls/cp/mv/rm/find/grep/cat`)

| Task | PowerShell 7 | Notes |
|------|-------------|-------|
| List directory | `Get-ChildItem` | Alias: `ls`, `dir`, `gci` |
| List with sizes | `Get-ChildItem \| Format-Table -AutoSize` | |
| Read file contents | `Get-Content` | Alias: `cat`, `type`, `gc` |
| Read first N lines | `Get-Content file -Head 50` | |
| Read last N lines | `Get-Content file -Tail 50` | |
| Search content | `Select-String "pattern" file` | Alias: `sls`. Use Kilo `grep` tool when available. |
| Search recursively | `Select-String -Path "dir\*" -Pattern "pattern"` | |
| Create directory | `New-Item -ItemType Directory -Path "dir"` | Alias: `md`, `mkdir` |
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

**PowerShell works with objects, not text.** Pipe output to objects, not strings:
```powershell
# Wrong (text): Get-Content file | Select-String "error" | ForEach-Object { ... }
# Right (object): Get-EventLog -LogName Application | Where-Object { $_.EntryType -eq "Error" }
```

---

## 3. Running External Commands & Scripts

### PowerShell scripts (.ps1)

```powershell
# Run a project script (REQUIRED method)
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-services.ps1 -Action start -Services all

# Check ports
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\check_ports.ps1

# Start services (one name, array, or 'all')
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action start -Services all
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action status
```

**Important:** Via `-File`, a comma-separated list arrives as ONE string and fails `ValidateSet`. Pass arrays with `-Command`, or one service per invocation.

### Python

```powershell
# Default backend Python (conda env)
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

## 4. Git Operations

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

## 5. Process & Service Management

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

---

## 6. Environment Variables

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
```

---

## 7. Common Traps to Avoid

| Trap | Wrong | Right |
|------|-------|-------|
| **Unix shell** | `bash`, `sh`, `zsh`, `cmd` | `pwsh` only |
| **Unix path separators** | `packages/frontend/src` | `packages\frontend\src` or `packages/frontend/src` (PowerShell accepts both, but use backslashes for native commands) |
| **`bash` is WSL** | `bash script.sh` | `pwsh -File script.ps1` — `bash` is the WSL launcher, NOT Git Bash |
| **`powershell` = 5.1** | `powershell -File script.ps1` | `pwsh -NoProfile -ExecutionPolicy Bypass -File script.ps1` |
| **Comma list via -File** | `-Services a,b,c` | Pass one service per `-Services` invocation, or use `-Command` |
| **Text pipeline** | `Get-Content file \| grep "x"` | `Select-String -Path "file" -Pattern "x"` |
| **Empty capture = success** | `$x = cmd.exe /c ...; if (-not $x) { ... }` | Check `$LASTEXITCODE` after native commands |
| **UTF-8 decoding** | `subprocess.run(text=True)` (Python) | Pass `encoding="utf-8"` explicitly (see `tools/check-subprocess-encoding.py`) |
| **Background with `&`** | `npm run dev &` | Use `background_process` tool or `Start-Process` |

---

## 8. Common One-Liners

```powershell
# Check PowerShell version
$PSVersionTable.PSVersion.Major

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
```

---

## 9. Running Gates

```powershell
# All gates
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/run-gates.py

# Subset (substring match)
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/run-gates.py --only lint docs
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/run-gates.py --only ruff --fix
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/run-gates.py --only type
```

---

## 10. When PowerShell Fails

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

---

**Remember: You are on Windows. PowerShell 7 is the only shell. No bash. No cmd. No Unix utilities.**
