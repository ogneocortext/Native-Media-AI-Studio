"""PreToolUse hook: block exec commands that use non-pwsh shell syntax.

Registered in .devin/hooks.v1.json. Receives the tool-call payload as JSON
on stdin ({"tool_input": {"command": "..."}}) and prints a block decision on
stdout when the command matches a banned pattern. Exit 0 always — the JSON
decision carries the outcome. Any crash exits non-zero, which the CLI logs
but does NOT block on, so a broken hook can never wedge the session.

Blocked patterns (all verified recurring failures on this machine):
  - Bash heredocs: <<EOF, <<'PY', python - <<'PY', cat <<EOF, etc. pwsh has
    no heredoc syntax; the command fails with a parser error every time.
  - Non-pwsh shells in command position: bash, sh, zsh, cmd, wsl — all
    resolve to WSL/cmd on this box and produce confusing errors.
  - powershell.exe / bare `powershell` — Windows PowerShell 5.1, retired.
    The project shell is pwsh 7+.

See docs/powershell-command-sheet.md §0 for the patterns agents should use
instead (write a file, run the file).
"""

import json
import re
import sys

# Heredoc operator: << or <<- followed by an optional quote and a word.
# Bit-shift false positives inside `python -c "a << b"` are accepted —
# inline -c scripts are discouraged anyway (write a file instead).
HEREDOC_RE = re.compile(r"<<-?\s*['\"]?[A-Za-z_]")

# Non-pwsh shells, only in command position (start of string or after a
# command separator) so paths/arguments like "script.sh" don't trip it.
FOREIGN_SHELL_RE = re.compile(
    r"(?:^|[;&|\n]\s*)(?:bash|sh|zsh|cmd|wsl|powershell)(?:\.exe)?(?:\s|$)",
    re.IGNORECASE,
)

# Windows PowerShell 5.1 invoked anywhere (powershell.exe, or `powershell`
# followed by flags). pwsh never contains the substring "powershell".
PS51_RE = re.compile(r"\bpowershell\.exe\b|\bpowershell\s+-", re.IGNORECASE)

REASONS = {
    "heredoc": (
        "Bash heredocs (<<EOF / python - <<'PY') do not exist in PowerShell 7 "
        "and fail every time — do not retry them. Write the script or message "
        "to a file with the write tool, then execute the file "
        "(git commit -F <msgfile>; python docs/scratch/<name>.py). "
        "See docs/powershell-command-sheet.md §0."
    ),
    "foreign-shell": (
        "Only pwsh 7 is permitted on this machine — bash/sh/zsh/cmd/wsl resolve "
        "to WSL or cmd and produce confusing errors. Rewrite the command in "
        "PowerShell 7 or move the logic into a script file. "
        "See docs/powershell-command-sheet.md."
    ),
    "ps51": (
        "`powershell` is Windows PowerShell 5.1 — retired for repo work. "
        "Use `pwsh` (7.x). See docs/powershell-command-sheet.md §1."
    ),
}


def block(reason_key: str) -> None:
    print(json.dumps({"decision": "block", "reason": REASONS[reason_key]}))


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    command = (payload.get("tool_input") or {}).get("command") or ""
    if not isinstance(command, str) or not command:
        return 0

    if HEREDOC_RE.search(command):
        block("heredoc")
    elif FOREIGN_SHELL_RE.search(command):
        block("foreign-shell")
    elif PS51_RE.search(command):
        block("ps51")
    return 0


if __name__ == "__main__":
    sys.exit(main())
