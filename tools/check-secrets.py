#!/usr/bin/env python3
"""Scan tracked files for high-signal credential patterns.

There is no CI in this repo (D10), so a leaked key in a commit reaches the
remote unopposed. This check greps ``git ls-files`` for vendor-prefixed key
formats and PEM private-key blocks - patterns specific enough that a hit is
almost certainly real, unlike generic "password =" heuristics which
false-positive on config templates.

Deliberately NOT scanned: ``docs/knowledge-library/`` research articles,
which legitimately quote example tokens in prose.

Run:  python tools/check-secrets.py
Exit 0 = clean, 1 = at least one pattern found.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# (name, compiled pattern). Vendor prefixes keep the false-positive rate
# near zero; the generic assignment pattern requires 32+ chars and rejects
# obvious placeholders.
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("private-key-block",
     re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")),
    ("github-token",
     re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}"
                r"|github_pat_[A-Za-z0-9_]{30,}")),
    ("openai-key", re.compile(r"\bsk-[A-Za-z0-9_-]{32,}")),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}")),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("huggingface-token", re.compile(r"\bhf_[A-Za-z0-9]{30,}")),
    ("generic-secret",
     re.compile(r"(?i)\b(?:api[_-]?key|secret[_-]?key|access[_-]?token)"
                r"[\s]*[:=][\s]*['\"]([A-Za-z0-9/+_.=-]{32,})['\"]")),
]

PLACEHOLDER_RE = re.compile(
    r"(?i)(example|placeholder|your[_-]|xxx|changeme|<|>|todo|redacted|"
    r"dummy|sample|fake|test[_-]?key|none|null)")

# Extensions worth scanning; binary and lockfiles are skipped outright.
SCAN_EXTS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".json", ".ps1", ".sh", ".yaml", ".yml", ".toml", ".cfg", ".ini",
    ".env", ".txt",
}
SKIP_PREFIXES = ("docs/knowledge-library/",)
SKIP_NAMES = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock"}
MAX_FILE_BYTES = 2 * 1024 * 1024


def _tracked_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files"], cwd=ROOT,
        capture_output=True, text=True, encoding="utf-8",
    )
    if out.returncode != 0:
        return []
    return [line.strip() for line in out.stdout.splitlines() if line.strip()]


def _scannable(rel: str) -> bool:
    name = Path(rel).name.lower()
    if name in SKIP_NAMES or rel.startswith(SKIP_PREFIXES):
        return False
    return Path(rel).suffix.lower() in SCAN_EXTS or name.startswith(".env")


def main() -> int:
    hits: list[str] = []
    scanned = 0
    for rel in _tracked_files():
        if not _scannable(rel):
            continue
        path = ROOT / rel
        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        scanned += 1
        for lineno, line in enumerate(text.splitlines(), 1):
            for label, pattern in PATTERNS:
                m = pattern.search(line)
                if not m:
                    continue
                # For the generic pattern, check the captured secret itself
                # against placeholders; vendor formats need no such check.
                if label == "generic-secret":
                    secret = m.group(1)
                    if PLACEHOLDER_RE.search(secret):
                        continue
                hits.append(f"{rel}:{lineno}: {label}")
                break  # one report per line is enough

    if hits:
        print(f"[FAIL] {len(hits)} possible secret(s) in tracked files:")
        for h in hits[:50]:
            print(f"       {h}")
        if len(hits) > 50:
            print(f"       ... and {len(hits) - 50} more")
        print("       If real: rotate the credential, then remove it from "
              "history. If a false positive, tighten the pattern or add the "
              "path to SKIP_PREFIXES in tools/check-secrets.py.")
        return 1
    print(f"[OK] secrets scan clean ({scanned} files scanned)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
