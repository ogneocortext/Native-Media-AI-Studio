#!/usr/bin/env python3
"""Reject invisible, control, and mojibake characters in tracked text files.

Agents have repeatedly injected characters that are valid UTF-8 but wrong
for source: C-escape accidents turn 'a' into BEL (\\x07), 'b' into BS
(\\x08), 'e' into ESC (\\x1b) - decision-log.md carried "\\x07gent_output"
for months. Zero-width joiners, soft hyphens, and UTF-8-read-as-Latin1
mojibake triples break diffs, searches, and Windows consoles.

Rules:
  - C0 controls other than TAB/LF/CR, DEL, and C1 (0x80-0x9F) are banned.
  - U+FFFD, zero-width/format characters, soft hyphen, and interlinear
    annotation anchors are banned.
  - U+FEFF (BOM / zero-width no-break space) is allowed ONLY as the very
    first byte of a file - PowerShell and Unity require it in .ps1,
    .csproj, .slnx, .json. Anywhere else it is an invisible no-break space.
  - Common UTF-8-as-Latin1 mojibake bigrams are banned (smart-quote
    triples, accented pairs, the BOM-as-Latin1 triple). Written as
    codepoint tuples below so this file stays pure ASCII.
    tools/check-subprocess-encoding.py is exempt because it documents
    the phenomenon on purpose.

Run:  python tools/check-banned-chars.py [--verbose]
Exit 0 = clean, 1 = at least one violation.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

TEXT_EXTENSIONS = (
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".md", ".json", ".yaml", ".yml", ".toml",
    ".ps1", ".sh", ".css", ".html", ".txt", ".cfg", ".ini", ".go",
)

# Zero-width and format characters that carry no visible glyph.
INVISIBLE = frozenset(chr(c) for c in (
    0x200B, 0x200C, 0x200D, 0x200E, 0x200F,  # ZWSP/ZWNJ/ZWJ/LRM/RLM
    0x202A, 0x202B, 0x202C, 0x202D, 0x202E,  # bidi embeddings/overrides
    0x2060, 0x2061, 0x2062, 0x2063, 0x2064,  # word joiner, invisible ops
    0x2066, 0x2067, 0x2068, 0x2069,          # bidi isolates
    0xFEFF,                                # BOM / zero-width no-break
    0x00AD,                                # soft hyphen
    0x180E,                                # Mongolian vowel separator
    0xFFF9, 0xFFFA, 0xFFFB,                # interlinear annotation
))

# UTF-8 bytes decoded as cp1252 (the Windows default that produces this
# repo's mojibake). Generated from the real characters; written as \u
# escapes so this file stays pure ASCII - a literal sample would trip
# the gate. Each tuple is one mojibake string.
MOJIBAKE = tuple(
    "".join(chr(c) for c in cps)
    for cps in (
        (0x00E2, 0x20AC, 0x2122), (0x00E2, 0x20AC, 0x02DC),
        (0x00E2, 0x20AC, 0x0153), (0x00E2, 0x20AC, 0x017E),
        (0x00E2, 0x20AC, 0x0178), (0x00E2, 0x20AC, 0x00A6),
        (0x00E2, 0x20AC, 0x201C), (0x00E2, 0x20AC, 0x201D),
        (0x00E2, 0x201A, 0x00AC), (0x00E2, 0x201E, 0x00A2),
        (0x00C2, 0x00A9), (0x00C2, 0x00AE), (0x00C2, 0x00B1),
        (0x00C2, 0x00B0), (0x00C2, 0x00B2), (0x00C2, 0x00B3),
        (0x00C3, 0x2014), (0x00C3, 0x00B7), (0x00C2, 0x00AB),
        (0x00C2, 0x00BB), (0x00C2, 0x00BF), (0x00C2, 0x00A1),
        (0x00C3, 0x00B1), (0x00C3, 0x00A1), (0x00C3, 0x00A9),
        (0x00C3, 0x00AD), (0x00C3, 0x00B3), (0x00C3, 0x00BA),
        (0x00C3, 0x00BC), (0x00C3, 0x00B6), (0x00C3, 0x00A4),
        (0x00C3, 0x00A0), (0x00C3, 0x00A8), (0x00C3, 0x00AC),
        (0x00C3, 0x00B2), (0x00C3, 0x00B9), (0x00C3, 0x00A7),
        (0x00C3, 0x2018), (0x00C3, 0x2030), (0x00C3, 0x201C),
        (0x00C3, 0x0161), (0x00C3, 0x0153), (0x00C3, 0x2013),
        (0x00C3, 0x201E), (0x00C3, 0x20AC), (0x00C3, 0x02C6),
        (0x00C3, 0x0152), (0x00C3, 0x2019), (0x00C3, 0x2122),
        (0x00C3, 0x2021),
        (0x00E2, 0x02C6, 0x2019), (0x00E2, 0x20AC, 0x2018),
        (0x00E2, 0x20AC, 0x2019), (0x00E2, 0x20AC, 0x2022),
        (0x00EF, 0x00BB, 0x00BF),   # UTF-8 BOM read as Latin-1
    )
)

# Files that legitimately contain a mojibake sample as documentation.
MOJIBAKE_EXEMPT = {"tools/check-subprocess-encoding.py"}

ALLOWED_C0 = {0x09, 0x0A, 0x0D}  # tab, LF, CR


def tracked_files():
    proc = subprocess.Popen(
        ["git", "ls-files"], cwd=ROOT,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    out, _ = proc.communicate()
    return [p for p in out.decode("utf-8", "replace").splitlines() if p.strip()]


def check_file(rel):
    """Return list of (line_no, reason) violations."""
    full = ROOT / rel
    try:
        raw = full.read_bytes()
    except OSError:
        return []
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return []  # check-text-encoding.py owns undecodable files
    # A BOM at byte 0 is allowed; strip it so it is not flagged as FEFF.
    if raw.startswith(b"\xef\xbb\xbf"):
        text = text.lstrip(chr(0xFEFF))
    violations = []
    for lineno, line in enumerate(text.split("\n"), 1):
        for ch in line:
            o = ord(ch)
            if o < 0x20 and o not in ALLOWED_C0:
                violations.append((lineno, f"control char U+{o:04X}"))
                break
            if o == 0x7F or 0x80 <= o <= 0x9F:
                violations.append((lineno, f"control char U+{o:04X}"))
                break
            if ch in INVISIBLE:
                violations.append((lineno, f"invisible char U+{o:04X}"))
                break
        else:
            for mg in MOJIBAKE:
                if mg in line:
                    violations.append((lineno, f"mojibake {mg!r}"))
                    break
    return violations


def main():
    verbose = "--verbose" in sys.argv
    bad = []
    for rel in tracked_files():
        if not rel.endswith(TEXT_EXTENSIONS):
            continue
        rel_norm = rel.replace("\\", "/")
        violations = check_file(rel_norm)
        if rel_norm in MOJIBAKE_EXEMPT:
            violations = [v for v in violations if "mojibake" not in v[1]]
        if violations:
            bad.append((rel_norm, violations))
            if verbose:
                for lineno, reason in violations[:5]:
                    print(f"  {rel_norm}:{lineno}: {reason}")
    if bad:
        print(f"BANNED CHARACTERS in {len(bad)} file(s):")
        for rel, violations in bad:
            first = violations[0]
            more = f" (+{len(violations) - 1} more)" if len(violations) > 1 else ""
            print(f"  {rel}:{first[0]}: {first[1]}{more}")
            if verbose:
                for lineno, reason in violations[1:]:
                    print(f"      :{lineno}: {reason}")
        print("\nFix: replace control/invisible chars with the intended ASCII "
              "character; re-type mojibake as proper UTF-8.")
        return 1
    print("OK: no banned characters in tracked text files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
