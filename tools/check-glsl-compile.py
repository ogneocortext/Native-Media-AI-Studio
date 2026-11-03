#!/usr/bin/env python3
"""
GLSL compile-check gate for embedded frontend shaders.

Extracts GLSL shader bodies from ``/* glsl */`` tagged template literals in
``.ts``/``.tsx`` files under ``packages/frontend/src``, wraps each body in the
authoring-dialect prologue (GLSL ES 1.00 + the standard three.js
``ShaderMaterial`` injected declarations), and compiles every body with
glslangValidator.

Design notes
------------
* Stdlib only, explicit ``encoding="utf-8"`` everywhere (this machine's
  PowerShell console is cp1252; gate output contains em dashes and
  non-ASCII shader text).
* The compiler is resolved from PATH or a gitignored local tools location
  (``tools/glslang/bin/glslangValidator.exe``). If it is absent the check
  fails closed: it prints the exact install source and exits non-zero. A
  missing compiler is a *failed check*, never a silent pass.
* Shader bodies that already start with ``#version`` are "raw shaders" and
  compile as-is; every other body is prefixed with the authoring-dialect
  prologue so it compiles the way three.js presents it to
  ``ShaderMaterial``.
* Output is deterministic: files sorted, shaders within a file sorted by
  line number, verdicts printed in a fixed order.

Usage:
    python tools/check-glsl-compile.py [--json] [--save-json PATH]
    python tools/check-glsl-compile.py --changed file1.ts file2.tsx
"""

from __future__ import annotations

import argparse
import json
import operator
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# UTF-8 stdout guard (stdlib-only tool does not import cli_base): this machine's
# PowerShell console is cp1252, and gate output contains em-dashes and other
# non-ASCII characters that would render as replacement characters.
if sys.stdout is not None and sys.stdout.encoding is not None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")  # type: ignore[attr-defined]
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_SRC = ROOT / "packages" / "frontend" / "src"

__version__ = "1.0.0"

# ---------------------------------------------------------------------------
# Compiler resolution
# ---------------------------------------------------------------------------
# Resolved from PATH first, then a gitignored local tools location.
# tools/glslang/ is intentionally outside the repo (gitignored); the
# installer puts glslangValidator.exe there.
LOCAL_GLSLANG_DIR = ROOT / "tools" / "glslang" / "bin"
LOCAL_GLSLANG_EXE = LOCAL_GLSLANG_DIR / "glslangValidator.exe"


def resolve_compiler() -> Path | None:
    """Return the glslangValidator path, or None if not installed."""
    on_path = shutil.which("glslangValidator")
    if on_path:
        return Path(on_path)
    if LOCAL_GLSLANG_EXE.exists():
        return LOCAL_GLSLANG_EXE
    return None


COMPILER_INSTALL_SOURCE = (
    "https://github.com/KhronosGroup/glslang/releases/tag/16.6.0\n"
    "  Windows asset: glslang-16.6.0-windows-x86_64-release.zip\n"
    "  Extract to: tools/glslang/bin/glslangValidator.exe  (gitignored location)\n"
    "  Or add glslangValidator to PATH."
)


# ---------------------------------------------------------------------------
# Authoring-dialect prologue
# ---------------------------------------------------------------------------
# three.js injects these into every ShaderMaterial shader before compile:
#   uniform mat4 modelViewMatrix, projectionMatrix, modelMatrix
#   uniform mat3 normalMatrix
#   uniform vec3 cameraPosition
#   attribute vec3 position, normal; attribute vec2 uv, uv2; attribute vec3 color
# Author code is written assuming those exist, so we prepend them when the
# body carries no #version line of its own.
VERTEX_PROLOGUE = (
    "#version 100\n"
    "precision highp float;\n"
    "uniform mat4 modelViewMatrix;\n"
    "uniform mat4 projectionMatrix;\n"
    "uniform mat3 normalMatrix;\n"
    "uniform vec3 cameraPosition;\n"
    "attribute vec3 position;\n"
    "attribute vec3 normal;\n"
    "attribute vec2 uv;\n"
    "attribute vec3 color;\n"
    "attribute vec2 uv2;\n"
)

FRAGMENT_PROLOGUE = (
    "#version 100\n"
    "precision highp float;\n"
)


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------
# Matches `vertexShader`/`fragmentShader` followed by `/* glsl */` then a
# template literal. Captures (property_name, shader_body). Template
# substitutions (`${...}`) inside the body are detected and the shader is
# skipped with reason "unresolved template substitution".
GLSL_RE = re.compile(
    r"(vertexShader|fragmentShader)\s*:\s*/\*\s*glsl\s*\*/\s*`([^`]*)`",
    re.DOTALL,
)

# SHADER_PRESETS in shaders.ts: fragment shaders stored as named property
# template literals (no /* glsl */ tag, no vertexShader/fragmentShader label).
# Recognised by a `name: \`...`` property whose body contains gl_FragColor.
SHADER_PRESETS_RE = re.compile(
    r"^\s*(\w+):\s*`([^`]*gl_FragColor[^`]*)`",
    re.MULTILINE | re.DOTALL,
)


def extract_shaders(text: str, file_path: Path) -> list[dict]:
    """Return [{name, body, start_line}] for every /* glsl */ block in text.

    Also extracts SHADER_PRESETS entries from shaders.ts (fragment shaders
    stored as named property template literals without /* glsl */ tags).
    """
    found: list[dict] = []
    for m in GLSL_RE.finditer(text):
        prop = m.group(1)
        body = m.group(2)
        start_line = text[: m.start()].count("\n") + 1
        # Template substitutions cannot be resolved statically — skip.
        if "${" in body:
            found.append(
                {
                    "prop": prop,
                    "body": body,
                    "start_line": start_line,
                    "skipped": True,
                    "reason": "unresolved template substitution",
                }
            )
            continue
        found.append(
            {
                "prop": prop,
                "body": body,
                "start_line": start_line,
                "skipped": False,
                "reason": "",
            }
        )

    # SHADER_PRESETS: fragment shaders in shaders.ts, property-name keyed,
    # no /* glsl */ tag. All are fragment shaders (gl_FragColor output).
    if file_path.name == "shaders.ts":
        for m in SHADER_PRESETS_RE.finditer(text):
            prop = m.group(1)
            body = m.group(2)
            start_line = text[: m.start()].count("\n") + 1
            found.append(
                {
                    "prop": "fragmentShader",
                    "body": body,
                    "start_line": start_line,
                    "skipped": False,
                    "reason": "",
                }
            )

    return found


def needs_prologue(body: str) -> bool:
    """True if the body does not already carry a #version line."""
    return not body.lstrip().startswith("#version")


def prologue_for(prop: str) -> str:
    """Return the authoring-dialect prologue for a vertex or fragment shader."""
    return VERTEX_PROLOGUE if prop == "vertexShader" else FRAGMENT_PROLOGUE


# ---------------------------------------------------------------------------
# Compilation
# ---------------------------------------------------------------------------

def compile_shader(
    compiler: Path | None,
    shader_source: str,
    shader_kind: str,
    temp_dir: Path,
) -> tuple[bool, str]:
    """Compile one shader source string. Returns (ok, stderr_or_empty).

    ``shader_kind`` is "vertex" or "fragment". Writes the source to a temp
    .vert/.frag file and invokes glslangValidator with GLSL ES 1.00.
    """
    if compiler is None:
        return False, COMPILER_INSTALL_SOURCE

    suffix = ".vert" if shader_kind == "vertex" else ".frag"
    tmp_file = temp_dir / f"shader_{abs(hash(shader_source)) % 100000}{suffix}"
    try:
        tmp_file.write_text(shader_source, encoding="utf-8")
    except OSError as exc:
        return False, f"could not write temp file: {exc}"

    try:
        proc = subprocess.run(
            [
                str(compiler),
                str(tmp_file),
            ],
            capture_output=True,
            timeout=30,
        )
        ok = proc.returncode == 0
        stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        if not ok and not stderr:
            stderr = proc.stdout.decode("utf-8", errors="replace").strip()
        return ok, stderr
    except subprocess.TimeoutExpired:
        return False, "glslangValidator timed out (>30s)"
    except OSError as exc:
        return False, f"could not run compiler: {exc}"
    finally:
        try:
            tmp_file.unlink(missing_ok=True)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def scan_files(changed: set[str] | None) -> list[Path]:
    """Return the .ts/.tsx files under packages/frontend/src to scan.

    When ``changed`` is given (non-empty), only files in that set are scanned
    (changed-file scoping); otherwise every file under the tree is scanned,
    sorted for deterministic output.
    """
    if changed:
        hits = []
        for name in changed:
            p = ROOT / name
            if p.suffix.lower() in (".ts", ".tsx") and p.is_relative_to(
                FRONTEND_SRC
            ):
                if p.exists():
                    hits.append(p)
        return sorted(hits)

    hits = []
    for p in FRONTEND_SRC.rglob("*"):
        if p.is_file() and p.suffix.lower() in (".ts", ".tsx"):
            hits.append(p)
    return sorted(hits)


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="check-glsl-compile.py",
        description=(
            "Compile-check every GLSL shader embedded in frontend TS/TSX "
            "against glslangValidator (GLSL ES 1.00). Fails closed when the "
            "compiler is not installed."
        ),
    )
    parser.add_argument(
        "--version", action="version", version=f"check-glsl-compile {__version__}"
    )
    parser.add_argument(
        "--json", action="store_true",
        help="machine-readable JSON report",
    )
    parser.add_argument(
        "--save-json", metavar="PATH",
        help="write the JSON report to a file",
    )
    parser.add_argument(
        "--changed", nargs="*", metavar="FILE",
        help="only scan these changed file names (e.g. the unpushed batch). "
        "Without this, every file under packages/frontend/src is scanned.",
    )
    parser.add_argument(
        "--changed-from-file", metavar="PATH",
        help="read changed file names from a file, one per line (used instead "
        "of --changed when the list is long enough to exceed the OS "
        "command-line limit); can be combined with --changed",
    )
    args = parser.parse_args()

    json_mode = bool(args.json or args.save_json)
    changed = set(args.changed) if args.changed else None
    if args.changed_from_file:
        try:
            from_file = {
                line.strip() for line in Path(args.changed_from_file).read_text(
                    encoding="utf-8").splitlines() if line.strip()
            }
        except OSError as e:
            print(f"could not read --changed-from-file {args.changed_from_file}: {e}", file=sys.stderr)
            return 1
        changed = from_file if changed is None else changed | from_file

    compiler = resolve_compiler()
    compiler_missing = compiler is None

    files = scan_files(changed)

    file_reports: list[dict] = []
    total_files = 0
    total_extracted = 0
    total_checked = 0
    total_skipped = 0
    total_failed = 0
    any_failed = compiler_missing  # missing compiler = global failure

    temp_dir = Path(tempfile.gettempdir()) / "glsl-check"
    temp_dir.mkdir(parents=True, exist_ok=True)

    for file_path in files:
        total_files += 1
        try:
            text = file_path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            file_reports.append(
                {
                    "file": str(file_path.relative_to(ROOT)),
                    "error": f"could not read: {exc}",
                    "shaders": [],
                }
            )
            continue

        shaders = extract_shaders(text, file_path)
        if not shaders:
            continue  # file has no embedded GLSL — not reported

        shader_reports: list[dict] = []
        for s in sorted(shaders, key=operator.itemgetter("start_line")):
            total_extracted += 1
            rel = str(file_path.relative_to(ROOT))
            entry: dict = {
                "file": rel,
                "prop": s["prop"],
                "start_line": s["start_line"],
            }

            if s["skipped"]:
                total_skipped += 1
                entry["status"] = "SKIP"
                entry["reason"] = s["reason"]
                shader_reports.append(entry)
                continue

            kind = "vertex" if s["prop"] == "vertexShader" else "fragment"
            body = s["body"]
            if needs_prologue(body):
                source = prologue_for(s["prop"]) + body
            else:
                source = body

            ok, stderr = compile_shader(compiler, source, kind, temp_dir)
            entry["status"] = "PASS" if ok else "FAIL"
            entry["kind"] = kind
            if not ok:
                total_failed += 1
                any_failed = True
                entry["error"] = stderr
            else:
                total_checked += 1
            shader_reports.append(entry)

        file_reports.append(
            {"file": rel, "shaders": shader_reports}
        )

    # ---- reporting ----
    if json_mode:
        report = {
            "compiler": str(compiler) if compiler else None,
            "compiler_missing": compiler_missing,
            "files_scanned": total_files,
            "shaders_extracted": total_extracted,
            "shaders_checked": total_checked,
            "shaders_skipped": total_skipped,
            "shaders_failed": total_failed,
            "all_passed": not any_failed,
            "files": file_reports,
        }
        if args.save_json:
            try:
                Path(args.save_json).write_text(
                    json.dumps(report, indent=2), encoding="utf-8"
                )
            except OSError as exc:
                print(f"could not write {args.save_json}: {exc}", file=sys.stderr)
        if args.json:
            print(json.dumps(report, indent=2))
        return 1 if any_failed else 0

    # Human-readable output
    print(f"files scanned: {total_files}")
    print(f"shaders extracted: {total_extracted}")
    print(f"shaders checked:   {total_checked}")
    print(f"shaders skipped:   {total_skipped}")
    print(f"shaders failed:    {total_failed}")
    print()

    if compiler_missing:
        print("COMPILER NOT INSTALLED — failing closed.")
        print("Install source:")
        print(COMPILER_INSTALL_SOURCE)
        print()
        print("No shader bodies were compiled; all are treated as unchecked.")
        print("RESULT: FAIL (compiler missing)")
        return 1

    for fr in file_reports:
        rel = fr["file"]
        for s in fr["shaders"]:
            mark = "PASS" if s["status"] == "PASS" else s["status"]
            kind_suffix = f" ({s['kind']})" if "kind" in s else ""
            print(f"  [{mark}] {rel}:{s['start_line']}  {s['prop']}{kind_suffix}")
            if s["status"] == "SKIP":
                print(f"        skipped: {s['reason']}")
            elif s["status"] == "FAIL":
                print("        FAILED:")
                for line in s["error"].splitlines()[:12]:
                    print(f"        {line}")

    print()
    if any_failed:
        print(f"RESULT: FAIL ({total_failed} shader(s) did not compile)")
        return 1
    print(f"RESULT: PASS ({total_checked} shader(s) compiled cleanly)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
