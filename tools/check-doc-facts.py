#!/usr/bin/env python3
"""Fail when AGENTS.md states a fact the repository can disprove.

Why this gate exists
--------------------
AGENTS.md is loaded into **every request from every agent**, so a wrong fact in
it is not a cosmetic problem: it is a tax paid on each turn and, worse, it sends
the agent down the wrong path. A stale number in an instruction file does not
merely misinform — it costs a tool call to discover the truth, and often several
more to recover from acting on the lie.

Measured on 2026-11-21, AGENTS.md claimed the docs tree was "197 markdown files
across 13 directories". The real values were **293 across 27**. An agent that
trusted the number would conclude its search was exhaustive after finding 197,
or go looking for 16 directories that no longer exist.

The same audit found the model inventory table missing
`hf.co/lmstudio-community/Bonsai-27B-GGUF:Q1_0` entirely — a 4.7 GB local model
that was on disk but absent from the one file an agent reads before choosing a
model. An agent would reasonably conclude it did not exist and try to pull it,
which the project's own "MANDATORY: check before download" rule exists to
prevent.

The sibling rule is already written down in AGENTS.md for a different count
("count lives in `knowledge-tracker.md`, not here - R3"): a number in prose
goes stale the moment anything is added. This gate enforces the general form.

What it checks
--------------
Only claims that can be verified mechanically, so it can never cry wolf:

1. **Doc tree size** - the "N markdown files across M directories" sentence.
   Both numbers must match a live count, within a tolerance (the text is allowed
   to say "~290" for 293).
2. **Model inventory** - every model in the `| Model | Size | ...` table must
   still exist per `ollama list`, and every *local* model on disk must appear in
   the table. Cloud models are exempt from the second half: they are remote, so
   `ollama list` lists them but they are documented in a separate list.
3. **No duplicate table rows** - a duplicated row means the table was edited by
   hand and drifted (two `llama3.2:3b` rows were found and removed).

`ollama list` is skipped when the binary is absent, so this gate is safe on a
machine without Ollama: the doc-count checks still run.

Usage::

    python tools/check-doc-facts.py            # check AGENTS.md
    python tools/check-doc-facts.py --verbose  # show what was verified

Exit 0 = every stated fact still holds, 1 = at least one is stale.
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AGENTS = ROOT / "AGENTS.md"

# AGENTS.md is the always-loaded file, so it must stay small; reference material
# it used to carry has moved into docs/agents/. The model table lives in
# local-model-inventory.md, so the inventory cross-check reads that file when
# AGENTS.md points at it. Following a pointer rather than hardcoding a path keeps
# this working if the table moves again - and if the pointer is wrong, the check
# finds no table and reports nothing, which is why the pointer itself is verified.
MODEL_INVENTORY_DOC = ROOT / "docs" / "agents" / "local-model-inventory.md"

# Docs-count claims look like: "the tree is 197 markdown files across 13
# directories". The number may be approximate ("~290").
#
# AGENTS.md is a blockquote, so a sentence can wrap across lines with a "> "
# prefix on each one ("...across ~27\n> directories..."). Allow the prefix and
# any whitespace between the two numbers, or the check silently matches nothing
# and always reports "no claim to verify" - which is worse than failing, because
# it looks like a pass.
_DOC_COUNT_RE = re.compile(
    r"(\d+|~\s*\d+)\s+markdown\s+files?\s+across\s+(?:>\s*)*(\d+|~\s*\d+)\s+(?:>\s*)*directories",
    re.IGNORECASE,
)

# Table rows look like: | `model:tag` | 4.3 GB | Purpose | Status | Verified |
_MODEL_ROW_RE = re.compile(r"^\|\s*`([^`]+)`\s*\|")

# A model is "local" when ollama reports a numeric size for it. Cloud/proxy
# models report "-" as their size.
_LOCAL_SIZE_RE = re.compile(r"^\s*(\S+)\s+\S+\s+(?:(\d+(?:\.\d+)?)\s*(GB|MB)|-)")


def _num(token: str) -> int:
    """Parse '293' or '~290' into an int."""
    return int(re.sub(r"[^\d]", "", token) or 0)


def _is_approx(token: str) -> bool:
    return token.strip().startswith("~")


def _within(claimed_token: str, actual: int) -> bool:
    """True when the claim is consistent with `actual`.

    An approximate claim ("~290") is allowed to be off by up to 10% - the point
    is to catch an order-of-magnitude drift, not to demand an exact match that
    would go stale again on the next commit.
    """
    claimed = _num(claimed_token)
    if _is_approx(claimed_token):
        if claimed == 0:
            return actual == 0
        return abs(claimed - actual) <= max(1, round(claimed * 0.10))
    return claimed == actual


def count_docs() -> tuple[int, int]:
    """(markdown file count, directory count) under docs/."""
    docs = ROOT / "docs"
    if not docs.is_dir():
        return 0, 0
    files = [p for p in docs.rglob("*.md") if p.is_file()]
    dirs = {p.parent for p in files}
    return len(files), len(dirs)


def ollama_models() -> dict[str, str] | None:
    """model name -> size string, or None when ollama is unavailable."""
    binary = shutil.which("ollama")
    if not binary:
        # Windows: ollama is usually not on the agent PATH; try the default install
        candidate = Path.home() / "AppData" / "Local" / "Programs" / "Ollama" / "ollama.exe"
        if candidate.exists():
            binary = str(candidate)
    if not binary:
        return None
    try:
        proc = subprocess.run(
            [binary, "list"], capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None

    models: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        m = _LOCAL_SIZE_RE.match(line)
        if not m:
            continue
        name, size, unit = m.group(1), m.group(2), m.group(3)
        models[name] = f"{size} {unit}" if size else "-"
    return models or None


def parse_model_table(text: str) -> tuple[list[str], list[str]]:
    """Return (model names, duplicate names) from the inventory table."""
    start = text.find("| Model | Size |")
    if start < 0:
        return [], []
    end = text.find("\n\n", start)
    table = text[start:end if end > 0 else len(text)]

    names: list[str] = []
    for line in table.splitlines():
        m = _MODEL_ROW_RE.match(line)
        if m:
            names.append(m.group(1))

    seen: set[str] = set()
    dupes: list[str] = []
    for n in names:
        if n in seen and n not in dupes:
            dupes.append(n)
        seen.add(n)
    return names, dupes


# Interpreter -> (path to probe, label). Missing paths are skipped, not failed.
# (probe path, label, distinguishing fragment to locate the claim)
# The fragment matters: both paths end in "python.exe", so locating the claim by
# file name alone makes every probe match the first python.exe in the document.
_PROBES = {
    "python3.14": (r"C:\Python314\python.exe", "Python 3.14", "Python314"),
    "nma-studio-cuda": (r"D:\conda-envs\nma-studio-cuda\Scripts\python.exe",
                        "Python 3.11 (nma-studio-cuda)", "nma-studio-cuda"),
}


def _probe_pwsh() -> str | None:
    """Return the PowerShell 7 version, or None when pwsh is unavailable."""
    import shutil
    exe = shutil.which("pwsh") or shutil.which("pwsh.exe")
    if not exe:
        candidate = Path(r"C:\kilo\pwsh7\pwsh.exe")
        if candidate.is_file():
            exe = str(candidate)
    if not exe:
        return None
    try:
        proc = subprocess.run(
            [exe, "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=25,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return proc.stdout.strip() or None if proc.returncode == 0 else None


def _check_pwsh(text: str, *, verbose: bool) -> list[str]:
    """Compare the pwsh version stated in AGENTS.md against the installed one."""
    actual = _probe_pwsh()
    if not actual:
        return []
    out: list[str] = []
    # AGENTS.md states it as "pwsh **7.6.6**" or "pwsh 7.6.6+"
    m = re.search(r"pwsh(?:\s*\*\*)?\s*(\d+\.\d+\.\d+)", text)
    if not m:
        m = re.search(r"PowerShell\s*\*\*?\s*(\d+\.\d+\.\d+)", text)
    if not m:
        return []
    claimed = m.group(1)
    if claimed != actual:
        out.append(
            f"tool version: AGENTS.md says PowerShell is {claimed} "
            f"but pwsh reports {actual}"
        )
    elif verbose:
        print(f"OK   tool version: PowerShell {claimed} matches")
    return out


def _probe_version(path: Path) -> str | None:
    """Return the version string a Python interpreter reports, or None."""
    if not path.is_file():
        return None
    try:
        proc = subprocess.run(
            [str(path), "-c", "import sys; print(sys.version.split()[0])"],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout.strip() or None


def _check_tool_versions(text: str, *, verbose: bool) -> list[str]:
    """Compare version numbers stated in AGENTS.md against the local reality.

    Matches a path and a version in the same table row or sentence, e.g.
    "`C:\\Python314\\python.exe` (3.14.7)". A claim with no version beside a
    probeable path is ignored, and an unprobeable path is skipped, so the check
    cannot invent a failure.
    """
    out: list[str] = []
    for raw, label, fragment in _PROBES.values():
        path = Path(raw)
        actual = _probe_version(path)
        if actual is None:
            continue
        # Find "<fragment>" ... "<version>" within a short window.
        for m in re.finditer(re.escape(fragment), text):
            window = text[m.start(): m.start() + 160]
            vm = re.search(r"(\d+)\.(\d+)\.(\d+)", window)
            if not vm:
                continue
            claimed = vm.group(0)
            if claimed != actual:
                out.append(
                    f"tool version: AGENTS.md says {label} is {claimed} "
                    f"but {path.name} reports {actual}"
                )
            elif verbose:
                print(f"OK   tool version: {label} {claimed} matches")
            break
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--verbose", action="store_true", help="show every verified fact")
    args = ap.parse_args()

    if not AGENTS.is_file():
        print(f"FAIL: {AGENTS} not found")
        return 1

    text = AGENTS.read_text(encoding="utf-8")
    problems: list[str] = []

    # --- 1. doc tree size -------------------------------------------------
    actual_files, actual_dirs = count_docs()
    for m in _DOC_COUNT_RE.finditer(text):
        claim_files, claim_dirs = m.group(1), m.group(2)
        ok_files = _within(claim_files, actual_files)
        ok_dirs = _within(claim_dirs, actual_dirs)
        label = m.group(0).strip()
        if ok_files and ok_dirs:
            if args.verbose:
                print(f"OK   doc count: '{label}' matches {actual_files} files / {actual_dirs} dirs")
        else:
            problems.append(
                f"doc count: AGENTS.md says '{label}' but docs/ has "
                f"{actual_files} markdown files in {actual_dirs} directories"
            )
    if args.verbose and not list(_DOC_COUNT_RE.finditer(text)):
        print("note: AGENTS.md states no doc-tree size to verify")

    # --- 2. model inventory ----------------------------------------------
    # The table may live in AGENTS.md or in the doc it defers to.
    inventory_text = text
    if "| Model | Size |" not in text:
        if MODEL_INVENTORY_DOC.is_file():
            inventory_text = MODEL_INVENTORY_DOC.read_text(encoding="utf-8")
            if args.verbose:
                print(f"note: reading model table from {MODEL_INVENTORY_DOC.relative_to(ROOT).as_posix()}")
        else:
            problems.append(
                "model inventory: AGENTS.md has no model table and "
                f"{MODEL_INVENTORY_DOC.relative_to(ROOT).as_posix()} does not exist"
            )
            inventory_text = ""
    names, dupes = parse_model_table(inventory_text)
    if dupes:
        problems.append(f"model table: duplicate rows for {', '.join(dupes)}")

    installed = ollama_models()
    if installed is None:
        if args.verbose:
            print("note: ollama not available, skipping model-inventory cross-check")
    else:
        # Every documented model must exist.
        for name in names:
            if name not in installed:
                problems.append(
                    f"model table: documents `{name}` but ollama does not have it installed"
                )
        # Every local model on disk must be documented.
        for name, size in installed.items():
            if size == "-":
                continue  # cloud/proxy model: documented in a separate list
            if name not in names:
                problems.append(
                    f"model table: `{name}` is installed locally ({size}) but not documented"
                )
        if args.verbose:
            print(f"OK   model table: {len(names)} documented, {len(installed)} installed checked")

    # --- 3. tool version claims ------------------------------------------
    # AGENTS.md states interpreter versions as fact; a stale one sends an agent
    # down the wrong path when diagnosing a version-sensitive failure. Only
    # versions that can be probed locally are checked, so this never cries wolf.
    problems.extend(_check_tool_versions(text, verbose=args.verbose))
    problems.extend(_check_pwsh(text, verbose=args.verbose))

    if problems:
        print(f"FAIL: {len(problems)} stale fact(s) in AGENTS.md")
        print()
        for p in problems:
            print(f"  {p}")
        print()
        print("AGENTS.md is loaded into every agent request, so a wrong fact here")
        print("costs a tool call to discover and misdirects the agent that trusts it.")
        print("Prefer an approximate or derived value over a hardcoded exact count.")
        return 1

    print(f"check-doc-facts: {len(names)} models + doc count verified against the repo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
