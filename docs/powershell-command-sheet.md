# PowerShell 7 Command Sheet — Mandatory for All Agent Command Work

**Platform: Windows 11. All terminal commands MUST go through PowerShell 7 (`pwsh`). Do NOT use `bash`, `cmd`, or Unix shells on this machine.** `bash` here resolves to the WSL launcher — it is NOT Git Bash and will produce confusing errors.

**CRITICAL:** Some agent shells expose a tool literally named `bash` that actually runs PowerShell 7 on this machine — NOT bash, NOT WSL, NOT Git Bash. Do NOT use `tail`, `wc`, `head`, `grep`, `cat`, `ls`, `cp`, `mv`, `rm`, `find`, `ps`, `kill`, `netstat`, `env`, `export`, `xargs`, `&&`-chained Unix utilities, or any other Unix utility in shell commands. All of these either fail in PowerShell 7 or resolve to the WSL launcher.

Use PowerShell 7 cmdlets instead (see the Bash → PowerShell translation table at the end of this document), or better yet, use the dedicated file tools (`read`, `glob`, `grep`, `filesystem_*`) for file operations — they work cross-platform and avoid shell issues entirely.

If you need to search file contents, use the `grep` tool, not `Select-String` or `grep`. If you need to list files, use `glob` or `filesystem_list_directory`, not `Get-ChildItem`. Only use shell commands for genuine PowerShell 7 operations (git, pwsh scripts, python, etc.).

**This machine runs PowerShell 7.6.9 (LTS, built on .NET 10).** Windows 11 also ships PowerShell 5.1 (built on .NET Framework 4.x) — that version is retired for repo work. The two versions install side-by-side: `pwsh.exe` is v7+, `powershell.exe` is v5.1. Always use `pwsh`.

Read this before running your first command. Keep it open while working.

---

## 0. Escaping Rules — the #1 recurring agent failure

> **Enforced:** `.devin/hooks.v1.json` + `.claude/settings.json` run
> `tools/hooks/check-exec-command.py` as a PreToolUse hook on every shell
> command. Blocked before execution: heredocs (`<<EOF`, `python - <<'PY'`),
> non-pwsh shells (`bash`, `sh`, `cmd`, `wsl`), `powershell.exe`, multi-line
> `git commit -m` / `python -c` / `node -e` payloads, expandable
> here-strings (`@"..."@`), and destructive git ops (`push --force`,
> `reset --hard`, `clean -fd`, `checkout --`, `restore .` — override via
> `.devin/.allow-destructive`). Each block reason carries the correct
> pattern. Do not test whether the hook is active — it is. Write
> file-based commands from the start.

**The decision rule: if a command contains a newline, a backtick, `$`, or both
single AND double quotes — do NOT inline it. Write it to a file with the `write`
tool, then execute the file.** Every escaping incident this repo has seen
(heredoc syntax errors, mangled commit messages, corrupted markdown writes,
broken `python -c` one-liners) traces back to ignoring this rule.

### Banned inline patterns (they fail EVERY time in pwsh)

| Pattern | Why it fails | Do this instead |
|---------|-------------|-----------------|
| `git commit -m "$(cat <<'EOF' ... EOF)"` | Bash heredoc — pwsh has no `$(cat <<)`; `<` is a reserved operator | Write message to `$env:TEMP\commit-msg.txt` with the `write` tool, then `git commit -F $env:TEMP\commit-msg.txt` |
| `python - <<'PY' ... PY` | Same — heredoc is not pwsh | Write `docs/scratch/<name>.py`, run `python docs/scratch/<name>.py` |
| `Add-Content file @'...'@` mid-line | Here-strings must start at the beginning of a line; embedded in a compound command they parse as separate statements | Put the here-string on its own lines, or use the `write`/`edit` tool for file content |
| `python -c "...multi-line..."` / `node -e "..."` | pwsh parses the whole string first; embedded `"`, `$`, backticks get eaten | Write a `.py`/`.mjs` scratch file and run it |
| Double-quoted strings containing `` ` `` or `$` | `` ` `` is pwsh's escape char (`` `n ``→newline, `` `t ``→tab); `$var` expands | Single-quote `'...'` for literal text, or `@'...'@` here-string |

### Safe patterns (use these)

```powershell
# Commit message — always via file, never -m with complex text
Set-Content "$env:TEMP\commit-msg.txt" -Value $msg -NoNewline   # or the write tool
git commit -F "$env:TEMP\commit-msg.txt"

# Inline python that fits on ONE line with NO inner quotes
git log -1 --format=%s | python -c "import sys; print(sys.stdin.read().upper())"

# JSON payloads — single quotes are literal in pwsh
Invoke-RestMethod -Body '{"key": "value"}' -ContentType 'application/json'

# File content — NEVER through the shell. Use the write/edit tools.
# Markdown with `code` spans or ``` fences gets destroyed by backtick
# expansion in "..." and @"..."@ — see §9 trap table.
```

### The one-line test

Before running any non-trivial `exec` command, ask: **can I write this as a
file instead?** If yes — write the file (`write` tool for content,
`docs/scratch/` for scripts, `$env:TEMP` for throwaway), run the file, delete
it after. File-based execution has zero escaping surface. Inline commands are
only for short, single-quote-safe, single-line operations.

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
# start-services.ps1 takes only -ComfyUI / -VideoEditor switches — it starts
# the default service set itself. For per-service control use manage-servers.ps1.
# Agent tip: add -NonInteractive so a stray prompt fails fast instead of hanging.
pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts\start-services.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-services.ps1 -ComfyUI -VideoEditor

# Check ports
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\check-ports.ps1

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
# Bare pnpm/npm resolve to .ps1 shims in pwsh (standard arg passing —
# verified). Use pnpm.cmd only when a caller explicitly needs the .cmd.
pnpm install
pnpm test:unit
pnpm run dev

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
| **`-NoProfile` skips UTF-8 setup** | `pwsh -NoProfile -Command "<native call>"` showing mojibake, or `python` resolving to the wrong env | Dot-source `scripts/agent-shell-init.ps1` first (UTF-8 both directions + `PYTHONUTF8=1` + project-Python PATH parity). Verify with `scripts/check-shell-env.ps1` (exits 1 on failure). `PYTHONUTF8` is also a User env var, so fresh processes get it anyway — the init script covers shells with a stale parent env block. |
| **Comma list via -File** | `-Services a,b,c` | Pass one service per `-Services` invocation, or use `-Command` |
| **Text pipeline** | `Get-Content file \| grep "x"` | `Select-String -Path "file" -Pattern "x"` |
| **Empty capture = success** | `$x = cmd.exe /c ...; if (-not $x) { ... }` | Check `$LASTEXITCODE` after native commands |
| **UTF-8 decoding** | `subprocess.run(text=True)` (Python) | Pass `encoding="utf-8"` explicitly (see `tools/check-subprocess-encoding.py`) |
| **File content via `"..."` / `@"..."@`** | Writing markdown/code through an expandable string or here-string | Backtick is PowerShell's escape char: `` `a ``→BEL, `` `b ``→BS, `` `e ``→ESC, `` `t ``→TAB, `` `n ``→LF, `` `0 ``→NUL, `` `u{...} ``→unicode. A markdown `` `code` `` span becomes control-char corruption (real incident: `audioFile`→BEL+`udioFile`, ```` ```tsx ```` fences destroyed). Use the write/edit tool, Python, or a **single-quoted** here-string `@'...'@` (literal, no escapes) — never `"..."` or `@"..."@` for file content. `tools/check-banned-chars.py` catches the output corruption after the fact. |
| **Python stdio/file encoding** | Assuming Python reads/writes UTF-8 by default on Windows | `PYTHONUTF8=1` is set as a User env var and in the pwsh profile; it makes `open()` and stdio default to UTF-8. If a shell predates it, run `$env:PYTHONUTF8='1'` first or pass `python -X utf8`. |
| **Background with `&`** | `pnpm run dev &` | Use `background_process` tool or `Start-Process` |
| **`powershell` on PATH** | May resolve to 5.1 | Use `pwsh` explicitly — 5.1 is retired |
| **Module compatibility** | Assuming 5.1 modules work in 7.x | Use `Import-Module -UseWindowsPowerShell` for 5.1-only modules |
| **Profile confusion** | Editing 5.1 profile | 7.x has separate profiles — edit the 7.x profile |
| **Env-var prefix** | `FOO=bar python script.py` | `$env:FOO = "bar"; python script.py` — the `VAR=value` prefix is a bashism; pwsh parses `FOO=bar` as a command name and fails |
| **`/dev/null`** | `2>/dev/null`, `>/dev/null` | `2>$null`, `>$null` — `/dev/null` resolves to `D:\dev\null` and errors "Could not find a part of the path" |
| **`jq` / `yq`** | `... \| jq '.key'` | **Not installed.** Use `ConvertFrom-Json` / `ConvertTo-Json` (see §13) |
| **`curl` flags** | `curl -s url \| jq` | `curl.exe` IS real (System32) and most flags work, but for JSON use `Invoke-RestMethod` — it parses for you and honors the UTF-8 console setup |
| **`python` bare name** | `python script.py` in a `-NoProfile` shell | Resolves to `C:\Python314` — the wrong env. Dot-source `scripts/agent-shell-init.ps1` or use the absolute `D:\conda-envs\nma-studio-cuda\Scripts\python.exe` path |
| **`pwsh -Command` exit codes** | `pwsh -Command "native-cmd"` then checking `$LASTEXITCODE` outside | A failing NATIVE command inside `-Command` flattens to exit `1` regardless of the real code (verified). `pwsh -File` preserves it; inside `-Command` append `; exit $LASTEXITCODE` |
| **Interactive hangs** | `pwsh -File script.ps1` that hits a prompt | Add `-NonInteractive` — prompts fail fast instead of hanging an agent shell forever |
| **`.cmd`/`.bat` arg passing** | Complex quoted args through `pnpm.cmd`/`npm.cmd`/`npx.cmd` | `$PSNativeCommandArgumentPassing` = `Windows` on this machine (verified): `.cmd`/`.bat` targets always get LEGACY quoting rules. Bare `pnpm`/`npm`/`npx` in pwsh resolve to the `.ps1` shims (standard arg passing) — verified — so prefer bare names or `*.ps1`; only use `.cmd` when a caller explicitly requires it |
| **Wildcard paths** | `Get-Content 'dir[1]\file.txt'` | `[ ]` are wildcard chars — use `-LiteralPath` for real paths; `-Path` only when wildcards are intended |

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

## 13. Extended Unix → PowerShell Map (verified on this machine)

Every row below was executed on this machine — these are the commands agents actually reach for that are NOT in the basic table above. Prefer the agent file tools (`read`/`grep`/`glob`) over shell equivalents where they exist.

| Unix | PowerShell 7 (verified) |
|------|------------------------|
| `curl -s url` | `curl.exe -s url` works, but `(Invoke-RestMethod url).property` for JSON |
| `wget url` | `Invoke-WebRequest url -OutFile f` (**wget not installed**) |
| `jq '.a.b'` | `(cmd \| ConvertFrom-Json).a.b` (**jq not installed**) |
| `sleep 5` | `Start-Sleep -Seconds 5` |
| `which python` / `command -v` | `Get-Command python` → `.Source` (**note:** `type` is an alias for `Get-Content`, not command lookup) |
| `ps aux` / `top` | `Get-Process` / `Get-Process \| Sort-Object CPU -Descending \| Select-Object -First 10` |
| `kill -9 pid` | `Stop-Process -Id pid -Force` |
| `netstat -tlnp` / `ss` / `lsof -i` | `Get-NetTCPConnection -State Listen` (add `-LocalPort N`); owning PID via `.OwningProcess` |
| `nc -z host port` | `Test-NetConnection host -Port port -InformationLevel Quiet` |
| `ping -c 1` | `Test-Connection host -Count 1` or `ping.exe` (native, works) |
| `nslookup` / `dig` | `Resolve-DnsName name -Type A` |
| `df -h` | `Get-PSDrive -PSProvider FileSystem` |
| `free -h` / memory | `(Get-CimInstance Win32_OperatingSystem) \| Select-Object TotalVisibleMemorySize,FreePhysicalMemory` |
| `nproc` | `$env:NUMBER_OF_PROCESSORS` |
| `wc -l file` | `(Get-Content file).Count`; words/chars: `Get-Content file \| Measure-Object -Line -Word -Character` |
| `sort \| uniq -c` | `... \| Sort-Object \| Group-Object \| Sort-Object Count -Descending` |
| `head`/`tail`/`cat -n` | `Get-Content -Head/-Tail`; line numbers: `$i=1; gc f \| %{"{0,5}: {1}" -f $i++,$_}` (Select-String already emits `.LineNumber`) |
| `grep -v` (invert) | `... \| Where-Object { $_ -notmatch 'pat' }` |
| `sed -i 's/a/b/'` | `(gc f -Raw) -replace 'a','b' \| Set-Content f -NoNewline` — or edit the file with the edit tool |
| `awk '{print $1}'` | `ForEach-Object { ($_ -split '\s+')[0] }` |
| `tr a-z A-Z` | `-replace` or `.ToUpper()` on the string |
| `cut -d: -f1` | `($_ -split ':')[0]` |
| `tee file` | `Tee-Object file` (verified) |
| `diff a b` | `Compare-Object (gc a) (gc b)`; for tracked files `git diff` |
| `md5sum`/`sha256sum` | `Get-FileHash file -Algorithm SHA256` (verified) |
| `base64 -d` | `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))` |
| `hexdump`/`xxd` | `Format-Hex` (verified, pwsh 7 native) |
| `date +%s` | `[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()` (verified) |
| `date` | `Get-Date` |
| `uuidgen` | `[guid]::NewGuid()` (verified) |
| `seq 5` | `1..5` (verified) |
| `shuf` | `Get-Random -InputObject (1..N) -Count K` |
| `echo $PATH` / `printenv` | `$env:Path` / `Get-ChildItem env:` |
| `export VAR=x` | `$env:VAR = "x"` (session) or `[Environment]::SetEnvironmentVariable(...,"User")` (persistent) |
| `source file` | `. .\file.ps1` — dot-sourcing syntax is the same |
| `nohup cmd &` / `disown` | `Start-Process` or the agent `background_process` tool |
| `timeout 30 cmd` | `$j = Start-Job { cmd }; Wait-Job $j -Timeout 30` then `Stop-Job`/`Remove-Job` |
| `watch cmd` | `while($true){ cls; cmd; Start-Sleep 2 }` |
| `history` | `Get-History` (current session only) |
| `man cmd` / `--help` | `Get-Help cmd` / `cmd -?` for native tools |
| `pbcopy`/`pbpaste` | `Set-Clipboard`/`Get-Clipboard` (verified) |
| `open file` / `xdg-open` | `Invoke-Item file` or `Start-Process file` |
| `mkdir -p a/b/c` | `New-Item -ItemType Directory -Force a/b/c` (creates intermediates) |
| `touch file` | `New-Item file -Force` or `(Get-Item file).LastWriteTime = Get-Date` |
| `ln -s` / `chmod` / `chown` | No-op on Windows — git tracks the executable bit; use `git update-index --chmod=+x` if ever needed |
| `ssh`/`scp`/`sftp` | Real OpenSSH client installed (`C:\Windows\System32\OpenSSH`) — works natively |
| `tar czf` | `tar.exe` exists (bsdtar, System32) — works; or `Compress-Archive`/`Expand-Archive` for zip |
| `zip`/`unzip`/`7z` | **Not installed.** `Compress-Archive`/`Expand-Archive` for .zip; `tar.exe` handles .tar/.tar.gz |
| `vim`/`nano`/`tmux`/`screen` | **Not installed.** Use file tools; no terminal multiplexers — one pwsh session per agent |
| `make`/`cmake` | **Not installed.** Repo has no Makefile; gates run via `python tools/run-gates.py` |
| `apt`/`yum`/`brew` | `winget install <pkg>` |
| `crontab` | Windows Task Scheduler — see `scripts/install-maintenance-task.ps1` pattern |
| `psql`/`mysql`/`sqlite3` | `sqlite3.exe` exists but is an Android SDK stray — use Python's `sqlite3` module instead |
| `docker`/`kubectl` | **Not installed** — no containers on this machine |
| `go`/`cargo`/`rustc`/`dotnet` | Installed and on PATH — invoke directly |
| `node`/`npm`/`npx`/`yarn`/`pnpm` | Bare `pnpm`/`npm`/`npx` resolve to `.ps1` shims (verified — standard arg passing). `pnpm.cmd`/`npm.cmd` also work but get legacy `.cmd` quoting — see §9 |
| `pip install` | `python -m pip install` with the correct env python — never bare `pip` |
| `python -m pytest`/`vitest`/`playwright` | `pytest` in `packages/backend/`; `pnpm test:unit` / `pnpm exec playwright test` in `packages/frontend/` |

**Chaining that DOES work in pwsh 7:** `&&`, `||`, `;`, `$(subexpression)`, `|`, `>`, `>>`, `2>$null`. Redirects write UTF-8 (no BOM) by default in PS7 — unlike 5.1's UTF-16.

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
