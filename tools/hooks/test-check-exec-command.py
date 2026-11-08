"""Adversarial test matrix for tools/hooks/check-exec-command.py.

Each case: (command, expected) where expected is None (pass) or a reason key.
POSIX_CASES simulate a Linux/macOS clone via EXEC_GUARD_FORCE_POSIX=1 —
there only the destructive-git guard should fire.
Run: python tools/hooks/test-check-exec-command.py
"""

import json
import os
import subprocess
import sys

HOOK = "tools/hooks/check-exec-command.py"

CASES = [
    # --- must BLOCK ---
    ('git commit -m "$(cat <<\'EOF\'\nmsg\nEOF\n)"', "heredoc"),
    ("python - <<'PY'\nprint(1)\nPY", "heredoc"),
    ("cat <<EOF > out.txt\nhello\nEOF", "heredoc"),
    ("git commit -m <<'MSG'\nsubject\nMSG", "heredoc"),
    ("cat<<EOF\ntext\nEOF", "heredoc"),
    ('cat <<< "herestring text"', "heredoc"),
    ("echo $(cat <<EOF\nx\nEOF\n)", "heredoc"),
    ("bash -lc 'ls -la'", "foreign-shell"),
    ("sh -c 'echo hi'", "foreign-shell"),
    ("zsh script.zsh", "foreign-shell"),
    ("cmd /c dir", "foreign-shell"),
    ("wsl ls", "foreign-shell"),
    ("git status; bash deploy.sh", "foreign-shell"),
    ("find . -name '*.py'", "unix-util"),
    ("grep -r foo src/", "unix-util"),
    ("cat file.txt | grep x", "unix-util"),
    ("export FOO=bar", "unix-util"),
    ("env python script.py", "unix-util"),
    ("which python", "unix-util"),
    ("chmod +x script.sh", "unix-util"),
    ("powershell -File script.ps1", "ps51"),
    ("powershell script.ps1", "foreign-shell"),
    ("powershell.exe -Command Get-Date", "ps51"),
    ("& 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' -File x.ps1", "ps51"),
    ('git commit -m "line1\nline2"', "commit-msg"),
    ("git commit -m 'subject\nbody'", "commit-msg"),
    ('git commit -m "subject" -m "body\nmore"', "commit-msg"),
    ('python -c "print(1)\nprint(2)"', "inline-script"),
    ('node -e "const a=1\nconsole.log(a)"', "inline-script"),
    ('Set-Content f.md @"\n# Title\n"@', "expandable-herestring"),
    ("$msg = @\"\nhello $name\n\"@\nSet-Content f.txt $msg", "expandable-herestring"),
    ("git push --force", "destructive"),
    ("git push -f origin main", "destructive"),
    ("git push origin main --force-with-lease", "destructive"),
    ("git reset --hard HEAD~1", "destructive"),
    ("git clean -fd", "destructive"),
    ("git clean -fdx", "destructive"),
    ("git checkout -- file.py", "destructive"),
    ("git restore .", "destructive"),
    ("git restore --staged .", "destructive"),
    # --- must PASS ---
    ("git status", None),
    ("git commit -m \"subject\" -m \"Co-authored-by: Devin\"", None),
    ("git commit -F $env:TEMP\\msg.txt", None),
    ("git commit -m \"subject\"\ngit push origin main", None),
    ("git log --oneline -5", None),
    ("git push origin main", None),
    ("git push --force-with-lease=false origin main", "destructive"),  # still force-ish flag? actually contains --force -> block
    ("git clean -n", None),
    ("git checkout -b feature/x", None),
    ("git checkout main", None),
    ("git restore --staged file.py", None),
    ("pwsh -NoProfile -File scripts\\manage-servers.ps1 -Action status", None),
    ("python -c \"print(1<<2)\"", None),
    ("python -c \"print('a<<b')\"", None),
    ("python -c \"x = 1 << 3; print(x)\"", None),
    ("$x = 5; $y = $x << 1", None),
    ("Write-Output \"result: $(1 + 2)\"", None),
    ('echo "a << b"', None),
    ("echo 'x <<EOF y'", None),
    ("git grep 'pattern'", None),
    ("rg -n 'foo' src/", None),
    ("Select-String -Path f.txt -Pattern 'x'", None),
    ("Get-ChildItem -Recurse -Filter *.py", None),
    ("$env:FOO = 'bar'", None),
    ("Set-Content f.txt @'\nliteral $notExpanded\n'@", None),
    ('Write-Output "email me @"', None),
    ("node -e \"console.log(1)\"", None),
    ("python script.py", None),
    ("python -c \"import sys; print(sys.argv)\"", None),
    ("git diff HEAD~1..HEAD -- tools/", None),
    ("npm run build", None),
    ("pnpm --filter=x type-check", None),
    ("mkdir -p docs/scratch", None),
    ("cp a.txt b.txt", None),  # pwsh alias for Copy-Item — works
    ("ls packages/", None),    # pwsh alias for Get-ChildItem — works
]


# On POSIX clones only destructive git is blocked — heredocs, bash, unix
# utilities, and multi-line payloads are all valid there.
POSIX_CASES = [
    ("python - <<'PY'\nprint(1)\nPY", None),
    ("cat <<EOF > out.txt\nhello\nEOF", None),
    ("bash -lc 'ls -la'", None),
    ("find . -name '*.py' | xargs grep -l foo", None),
    ("git commit -m \"line1\nline2\"", None),
    ("python -c \"print(1)\nprint(2)\"", None),
    ("powershell.exe -Command Get-Date", None),
    ("git push --force", "destructive"),
    ("git reset --hard HEAD~1", "destructive"),
    ("git status", None),
]


def run_hook(command: str, *, posix: bool = False):
    payload = json.dumps({"tool_input": {"command": command}})
    env = dict(os.environ)
    if posix:
        env["EXEC_GUARD_FORCE_POSIX"] = "1"
    proc = subprocess.run(
        [sys.executable, HOOK],
        input=payload,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=10,
        env=env,
    )
    out = proc.stdout.strip()
    if not out:
        return None
    try:
        decision = json.loads(out)
    except json.JSONDecodeError:
        return f"UNPARSEABLE: {out[:120]}"
    if decision.get("decision") == "block":
        reason = decision.get("reason", "")
        for key, text in [
            ("heredoc", "heredocs"), ("foreign-shell", "pwsh 7 is permitted"),
            ("unix-util", "Unix utilities"), ("ps51", "PowerShell 5.1"),
            ("commit-msg", "git commit -m"), ("inline-script", "python -c"),
            ("expandable-herestring", "here-strings"), ("destructive", "Destructive git"),
        ]:
            if text in reason:
                return key
        return f"UNKNOWN-BLOCK: {reason[:80]}"
    return f"UNEXPECTED: {out[:120]}"


def main() -> int:
    failures = []
    for command, expected in CASES:
        got = run_hook(command)
        status = "OK " if got == expected else "FAIL"
        if got != expected:
            failures.append((command, expected, got))
        print(f"{status} expected={expected or 'pass':<22} got={got or 'pass':<22} cmd={command[:70]!r}")
    print(f"\n{len(CASES) - len(failures)}/{len(CASES)} passed")

    posix_failures = []
    for command, expected in POSIX_CASES:
        got = run_hook(command, posix=True)
        if got != expected:
            posix_failures.append((command, expected, got))
        print(f"{'OK ' if got == expected else 'FAIL'} [posix] expected={expected or 'pass':<22} got={got or 'pass':<22} cmd={command[:60]!r}")
    total = len(CASES) + len(POSIX_CASES)
    failed = len(failures) + len(posix_failures)
    print(f"\n{total - failed}/{total} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
