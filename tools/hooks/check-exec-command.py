"""PreToolUse hook: block exec commands that use non-pwsh or unsafe syntax.

Registered in .devin/hooks.v1.json and .claude/settings.json. Receives the
tool-call payload as JSON on stdin ({"tool_input": {"command": "..."}}) and
prints a block decision on stdout when the command matches a banned pattern.
Exit 0 always — the JSON decision carries the outcome. Any crash exits
non-zero, which the CLI logs but does NOT block on, so a broken hook can
never wedge the session.

Blocked patterns (all verified recurring failures on this machine):
  - Bash heredocs/herestrings: <<EOF, <<'PY', python - <<'PY', cat <<EOF,
    cat <<< "text", etc. pwsh has no such syntax; the command fails with a
    parser error every time. Detected quote-aware so `echo "a << b"` and
    bit-shifts don't trip it.
  - Non-pwsh shells in command position: bash, sh, zsh, cmd, wsl — all
    resolve to WSL/cmd on this box and produce confusing errors.
  - Unix-only utilities in command position: find, grep, xargs, env,
    export, chmod, wget, etc. — they resolve to WSL launchers or fail;
    use pwsh cmdlets or the dedicated file/search tools.
  - powershell.exe / bare `powershell` — Windows PowerShell 5.1, retired.
    The project shell is pwsh 7+.
  - Multi-line `git commit -m` — an -m quote left open across a newline is
    the classic mangled-commit-message failure; use `git commit -F <file>`.
  - Multi-line `python -c` / `node -e` — inline scripts with newlines get
    parsed as multiple pwsh statements; write a scratch file instead.
  - Expandable here-strings (@"..."@ ... "@) — backtick expansion corrupts
    markdown/code content; use the write/edit tools or literal @'...'@.
    Requires both opener and closer so `echo "foo @"` doesn't trip it.
  - Destructive git ops (push --force, reset --hard, clean -fd, checkout --,
    restore ., restore --staged .) — repo rules require explicit user
    approval. Override: the user creates .devin/.allow-destructive.

See docs/powershell-command-sheet.md §0 for the patterns agents should use
instead (write a file, run the file).
"""

import json
import os
import re
import sys

PROJECT_DIR = os.environ.get("DEVIN_PROJECT_DIR") or os.getcwd()
DESTRUCTIVE_FLAG = os.path.join(PROJECT_DIR, ".devin", ".allow-destructive")

HEREDOC_TAIL_RE = re.compile(r"<<-?\s*['\"]?[A-Za-z_]")

# Non-pwsh shells and unix-only utilities, only in command position (start
# of string or after a command separator) so paths/arguments don't trip it.
FOREIGN_SHELL_RE = re.compile(
    r"(?:^|[;&|\n]\s*)(?:bash|sh|zsh|cmd|wsl|powershell)(?:\.exe)?(?:\s|$)",
    re.IGNORECASE,
)
UNIX_UTIL_RE = re.compile(
    r"(?:^|[;&|\n]\s*)(?:find|grep|xargs|which|env|export|chmod|chown|chgrp|"
    r"ln|sudo|su|wget|dos2unix|file|make|diff|patch)(?:\s|$)",
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

# Expandable here-string: `@"` as a standalone token at end-of-line AND a
# `"@` closer at the start of a later line. Requiring both avoids matching
# literals like `echo "foo @"`.
HERESTRING_OPEN_RE = re.compile(r'(?:^|\s)@"[ \t]*\r?\n', re.MULTILINE)
HERESTRING_CLOSE_RE = re.compile(r'(?:^|\n)[ \t]*"@')

DESTRUCTIVE_RES = [
    re.compile(r"\bgit\s+push\b[^|;&\n]*?(?:--force\b|(?:\s|^)-f\b)", re.IGNORECASE),
    re.compile(r"\bgit\s+reset\s+--hard\b", re.IGNORECASE),
    re.compile(r"\bgit\s+clean\b[^|;&\n]*?-[a-zA-Z]*f", re.IGNORECASE),
    re.compile(r"\bgit\s+checkout\s+--", re.IGNORECASE),
    re.compile(r"\bgit\s+restore\s+(?:(?:--worktree|--staged)\s+)?\.(?:\s|$)", re.IGNORECASE),
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
    "unix-util": (
        "Unix utilities (find/grep/xargs/env/export/chmod/wget/…) are not "
        "pwsh — they resolve to WSL launchers or fail. Use PowerShell 7 "
        "cmdlets (Get-ChildItem, Select-String, Where-Object, $env:) or the "
        "dedicated file/search tools. See docs/powershell-command-sheet.md."
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
        "checkout --, restore ., restore --staged .) require explicit user "
        "approval per repo rules — they are blocked by "
        "tools/hooks/check-exec-command.py. If the user has approved this "
        "specific operation, ask them to run it themselves or create "
        ".devin/.allow-destructive to permit it once."
    ),
}


def block(reason_key: str) -> None:
    print(json.dumps({"decision": "block", "reason": REASONS[reason_key]}))


def _has_heredoc(command: str) -> bool:
    """Find `<<` outside quotes, not part of a bit-shift like `a<<b`."""
    i = 0
    n = len(command)
    quote = None
    while i < n:
        c = command[i]
        if quote is None:
            if c in "'\"":
                quote = c
                i += 1
                continue
            if command.startswith("<<<", i):
                return True  # bash here-string — also invalid in pwsh
            if command.startswith("<<", i):
                m = HEREDOC_TAIL_RE.match(command, i)
                if m:
                    prev = command[i - 1] if i > 0 else " "
                    if prev.isalnum() or prev in "_$":
                        # Glued to a word (a<<b bit-shift vs cat<<EOF): only
                        # treat it as a heredoc for UPPERCASE delimiters.
                        word = re.match(
                            r"<<-?\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)", command[i:]
                        )
                        delimiter = word.group(1) if word else ""
                        if not re.fullmatch(r"[A-Z_][A-Z0-9_]+", delimiter):
                            i += 1
                            continue
                    return True
            i += 1
        elif quote == "'":
            if c == "'":
                if i + 1 < n and command[i + 1] == "'":
                    i += 2
                    continue
                quote = None
            i += 1
        else:  # double quote — $(...) subexpressions are live code in pwsh
            if c == "`":
                i += 2
                continue
            if c == "$" and i + 1 < n and command[i + 1] == "(":
                # Extract the subexpression and scan it as code: a heredoc
                # inside "$(cat <<'EOF' ...)" is still a heredoc attempt.
                depth = 1
                j = i + 2
                while j < n and depth > 0:
                    cj = command[j]
                    if cj == "(":
                        depth += 1
                    elif cj == ")":
                        depth -= 1
                    elif cj in "'\"":
                        q = cj
                        j += 1
                        while j < n and command[j] != q:
                            if q == '"' and command[j] == "`":
                                j += 1
                            j += 1
                    j += 1
                if _has_heredoc(command[i + 2 : j - 1]):
                    return True
                i = j
                continue
            if c == '"':
                if i + 1 < n and command[i + 1] == '"':
                    i += 2
                    continue
                quote = None
            i += 1
    return False


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    command = (payload.get("tool_input") or {}).get("command") or ""
    if not isinstance(command, str) or not command:
        return 0

    has_newline = "\n" in command or "\r" in command

    if _has_heredoc(command):
        block("heredoc")
    elif PS51_RE.search(command):
        block("ps51")
    elif FOREIGN_SHELL_RE.search(command):
        block("foreign-shell")
    elif UNIX_UTIL_RE.search(command):
        block("unix-util")
    elif GIT_COMMIT_RE.search(command) and COMMIT_M_MULTILINE_RE.search(command):
        block("commit-msg")
    elif has_newline and INLINE_SCRIPT_RE.search(command):
        block("inline-script")
    elif HERESTRING_OPEN_RE.search(command) and HERESTRING_CLOSE_RE.search(command):
        block("expandable-herestring")
    elif not os.path.exists(DESTRUCTIVE_FLAG) and any(r.search(command) for r in DESTRUCTIVE_RES):
        block("destructive")
    return 0


if __name__ == "__main__":
    sys.exit(main())
