"""PreToolUse hook: block exec commands that use non-pwsh or unsafe syntax.

Registered in .devin/hooks.v1.json and .claude/settings.json. Receives the
tool-call payload as JSON on stdin ({"tool_input": {"command": "..."}}) and
prints a block decision on stdout when the command matches a banned pattern.
Exit 0 always — the JSON decision carries the outcome. Any crash exits
non-zero, which the CLI logs but does NOT block on, so a broken hook can
never wedge the session.

Blocked patterns (all verified recurring failures on this machine):
  - Bash heredocs: <<EOF, <<'PY', python - <<'PY', cat <<EOF, etc. pwsh has
    no heredoc syntax; the command fails with a parser error every time.
  - Non-pwsh shells in command position: bash, sh, zsh, cmd, wsl — all
    resolve to WSL/cmd on this box and produce confusing errors.
  - powershell.exe / bare `powershell` — Windows PowerShell 5.1, retired.
    The project shell is pwsh 7+.
  - Multi-line `git commit -m` — embedded newlines in -m arguments are the
    classic mangled-commit-message failure; use `git commit -F <file>`.
  - Multi-line `python -c` / `node -e` — inline scripts with newlines get
    parsed as multiple pwsh statements; write a scratch file instead.
  - Expandable here-strings (@"..."@) piped to file-writing cmdlets —
    backtick expansion corrupts markdown/code content; use the write/edit
    tools or the literal @'...'@ form.
  - Destructive git ops (push --force, reset --hard, clean -fd, checkout --,
    restore .) — repo rules require explicit user approval. Override: the
    user creates .devin/.allow-destructive to permit them once.

See docs/powershell-command-sheet.md §0 for the patterns agents should use
instead (write a file, run the file).
"""

import json
import os
import re
import sys

PROJECT_DIR = os.environ.get("DEVIN_PROJECT_DIR") or os.getcwd()
DESTRUCTIVE_FLAG = os.path.join(PROJECT_DIR, ".devin", ".allow-destructive")

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

GIT_COMMIT_RE = re.compile(r"\bgit\s+commit\b")
# `-m "...` or `-m '...` opened and NOT closed before a newline — the
# mangled multi-line message case. A closed quote before the newline
# (separate statements) does not match.
COMMIT_M_MULTILINE_RE = re.compile(r"""-m\s+["'][^"'\n]*\n""")
INLINE_SCRIPT_RE = re.compile(r"\b(?:python3?|node)\s+(?:-c|-e)\b")
# Expandable here-string opener: `@"` as a standalone token at end-of-line.
# The leading whitespace/start anchor avoids matching `"foo@"` literals.
EXPANDABLE_HERESTRING_RE = re.compile(r'(?:^|\s)@"[ \t]*(?:\r?\n|$)', re.MULTILINE)

DESTRUCTIVE_RES = [
    re.compile(r"\bgit\s+push\b[^|;&\n]*?(?:--force\b|(?:\s|^)-f\b)", re.IGNORECASE),
    re.compile(r"\bgit\s+reset\s+--hard\b", re.IGNORECASE),
    re.compile(r"\bgit\s+clean\b[^|;&\n]*?-[a-zA-Z]*f", re.IGNORECASE),
    re.compile(r"\bgit\s+checkout\s+--", re.IGNORECASE),
    re.compile(r"\bgit\s+restore\s+(?:--worktree\s+)?\.(?:\s|$)", re.IGNORECASE),
]

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
    "commit-msg": (
        "Multi-line `git commit -m` arguments get mangled by pwsh parsing — "
        "this is the classic corrupted-commit-message failure. Write the "
        "message to a file and use `git commit -F <msgfile>`. "
        "See docs/powershell-command-sheet.md §0."
    ),
    "inline-script": (
        "Multi-line `python -c` / `node -e` payloads are parsed as separate "
        "pwsh statements and mangle every time. Write a scratch file "
        "(docs/scratch/<name>.py or $env:TEMP) and run the file. "
        "See docs/powershell-command-sheet.md §0."
    ),
    "expandable-herestring": (
        "Expandable here-strings (@\"...\"@) expand backticks and $vars — "
        "they corrupt markdown/code file content. Use the write/edit tools "
        "for file content, or the literal @'...'@ form for shell text. "
        "See docs/powershell-command-sheet.md §9."
    ),
    "destructive": (
        "Destructive git operations (force-push, reset --hard, clean -fd, "
        "checkout --, restore .) require explicit user approval per repo "
        "rules — they are blocked by tools/hooks/check-exec-command.py. "
        "If the user has approved this specific operation, ask them to run "
        "it themselves or create .devin/.allow-destructive to permit it once."
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

    has_newline = "\n" in command or "\r" in command

    if HEREDOC_RE.search(command):
        block("heredoc")
    elif FOREIGN_SHELL_RE.search(command):
        block("foreign-shell")
    elif PS51_RE.search(command):
        block("ps51")
    elif GIT_COMMIT_RE.search(command) and COMMIT_M_MULTILINE_RE.search(command):
        block("commit-msg")
    elif has_newline and INLINE_SCRIPT_RE.search(command):
        block("inline-script")
    elif EXPANDABLE_HERESTRING_RE.search(command):
        block("expandable-herestring")
    elif not os.path.exists(DESTRUCTIVE_FLAG) and any(r.search(command) for r in DESTRUCTIVE_RES):
        block("destructive")
    return 0


if __name__ == "__main__":
    sys.exit(main())
