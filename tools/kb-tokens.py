"""Token accounting and context-window sizing for the knowledge library.

Two questions this answers, which `kb-context.py --format index` only hints at:

1. **How big is the library?** — in tokens, for a named model. The library
   is not "N tokens"; it is "N tokens *for this tokenizer*", and the
   difference between tokenizers is up to 35% (arXiv:2605.02173, 2026).

2. **What context window does a model need to read the whole thing?**
   — and, more usefully, which of the models this studio can actually run
   can do it. The answer is a table, because a context window is a
   ceiling, not a working size: quality falls off a "context cliff" past
   roughly 2.5K tokens of retrieved context even on a 1M-window model
   (arXiv:2601.14123, 2026).

Usage:

    python tools/kb-tokens.py                      # the report
    python tools/kb-tokens.py --model qwen3        # count with a tokenizer
    python tools/kb-tokens.py --category technical # one category
    python tools/kb-tokens.py --format json        # machine-readable
    python tools/kb-tokens.py --format models      # context-window table
"""
# ruff: noqa: N999
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    from _kb_links import SPECIAL_FILES
    from _kb_tokens import (
        CONTEXT_CLIFF_TOKENS,
        FRONTIER_CONTEXT_WINDOWS,
        LOCAL_CONTEXT_WINDOWS,
        MODEL_TOKENIZERS,
        PRACTICAL_CHUNK_CEILING,
        humanize_tokens,
        measure_ratio,
        resolve_counter,
    )
    from _toolutil import REPO
except ImportError:  # pragma: no cover
    REPO = Path(__file__).resolve().parent.parent
    SPECIAL_FILES = ("index.md", "README.md", "_schema.md", "log.md")
    CONTEXT_CLIFF_TOKENS = 2_500
    FRONTIER_CONTEXT_WINDOWS = {}
    LOCAL_CONTEXT_WINDOWS = {}
    MODEL_TOKENIZERS = {}
    PRACTICAL_CHUNK_CEILING = 8_000
    humanize_tokens = str
    measure_ratio = lambda c, s: c.chars_per_token  # noqa: E731
    resolve_counter = None

BASE = REPO / "docs" / "knowledge-library"

FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n(.*)", re.S)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def parse_doc(path: Path) -> dict:
    """Return {name, title, tags, type, category, body} for a library doc."""
    text = read(path)
    tags: list[str] = []
    ptype = None
    aliases: list[str] = []
    body = text
    m = FRONTMATTER_RE.match(text)
    if m:
        block, body = m.group(1), m.group(2)
        in_tags = False
        in_aliases = False
        for line in block.split("\n"):
            if line.startswith("tags:"):
                in_tags = True
                in_aliases = False
                continue
            if line.startswith("aliases:"):
                in_aliases = True
                in_tags = False
                continue
            if in_tags:
                t = re.match(r"^\s*-\s*(\S+)\s*$", line)
                if t:
                    tags.append(t.group(1))
                    continue
                if line.strip() and not line.startswith(" "):
                    in_tags = False
            if in_aliases:
                a = re.match(r"^\s*-\s*(.+?)\s*$", line)
                if a:
                    aliases.append(a.group(1))
                    continue
                if line.strip() and not line.startswith(" "):
                    in_aliases = False
            mt = re.match(r"^type:\s*(\S+)", line)
            if mt:
                ptype = mt.group(1)
    return {
        "name": path.name,
        "title": aliases[0] if aliases else path.stem,
        "tags": tags,
        "type": ptype,
        "category": tags[0] if tags else "uncategorized",
        "body": body.strip(),
    }


def collect() -> list[dict]:
    return [parse_doc(p) for p in sorted(BASE.glob("*.md"))
            if p.name not in SPECIAL_FILES]


def ollama_context_windows(timeout: float = 6.0) -> dict[str, int]:
    """Read the context windows of the models the running Ollama serves.

    Falls back to the recorded values when Ollama is not reachable, so the
    report is still produced on a machine with no Ollama.
    """
    windows: dict[str, int] = {}
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/tags",
                                    timeout=timeout) as r:
            models = json.load(r).get("models", [])
    except Exception:
        return dict(LOCAL_CONTEXT_WINDOWS)
    for m in models:
        name = m.get("name", "")
        if not name:
            continue
        ctx = None
        try:
            req = urllib.request.Request(
                "http://127.0.0.1:11434/api/show",
                data=json.dumps({"model": name}).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as r:
                info = json.load(r)
            for k, v in (info.get("model_info") or {}).items():
                if k.endswith("context_length"):
                    ctx = v
                    break
        except Exception:
            ctx = None
        if ctx:
            windows[name] = int(ctx)
    return windows or dict(LOCAL_CONTEXT_WINDOWS)


def report(docs, counter, filters) -> dict:
    """Build the token report."""
    selected = [d for d in docs if matches(d, filters)]
    by_category: dict[str, int] = defaultdict(int)
    by_type: dict[str, int] = defaultdict(int)
    per_doc = []
    total = 0
    for d in selected:
        n = counter.count(d["body"])
        total += n
        by_category[d["category"]] += n
        by_type[d["type"] or "untyped"] += n
        per_doc.append((n, d["title"], d["name"], d["category"]))
    per_doc.sort(reverse=True)
    return {
        "documents": len(selected),
        "total_tokens": total,
        "by_category": dict(by_category),
        "by_type": dict(by_type),
        "largest": per_doc[:15],
        "per_doc": per_doc,
    }


def matches(doc: dict, filters) -> bool:
    if filters["categories"] and doc["category"] not in filters["categories"]:
        return False
    if filters["types"] and (doc["type"] or "") not in filters["types"]:
        return False
    if filters["tags"] and not any(t in doc["tags"] for t in filters["tags"]):
        return False
    return True


def print_report(rep, counter, docs) -> None:
    total = rep["total_tokens"]
    print("[TOKENS] Knowledge library token report\n")
    print(f"  Counter          : {counter.model}"
          f"{' (exact tokenizer)' if counter.exact else ' (estimate)'}")
    if not counter.exact:
        print(f"  Assumption       : {counter.chars_per_token} chars per token "
              f"(English markdown average)")
    print(f"  Documents        : {rep['documents']}")
    print(f"  Total            : {total:,} tokens ({humanize_tokens(total)})\n")

    print("  By primary category:")
    for cat, n in sorted(rep["by_category"].items(), key=lambda x: -x[1]):
        share = (n / total * 100) if total else 0
        bar = "#" * max(1, int(share / 2))
        print(f"    {cat:<14} {n:>8,}  {share:>5.1f}%  {bar}")

    print("\n  By page type:")
    for typ, n in sorted(rep["by_type"].items(), key=lambda x: -x[1]):
        print(f"    {typ:<14} {n:>8,}")

    print("\n  Largest documents:")
    for n, title, _name, cat in rep["largest"][:10]:
        print(f"    {n:>7,}  {title[:52]:<52} {cat}")

    windows = ollama_context_windows()
    print("\n  Context window required to hold the whole library:")
    if not windows:
        print("    (no context-window data)")
        return
    fits = [(m, w) for m, w in sorted(windows.items(), key=lambda x: x[1])
            if w >= total]
    print(f"    Whole library = {total:,} tokens.")
    if fits:
        print("    Fits in:")
        for m, w in fits:
            print(f"      + {m:<28} {w:>10,}  (headroom {w - total:,})")
    else:
        smallest = min(windows.values())
        biggest = max(windows.values())
        print(f"    Fits in NONE of the {len(windows)} local models "
              f"(largest window {biggest:,} < {total:,}).")
        print(f"    The smallest window here is {smallest:,}; the corpus is "
              f"{total / smallest:.1f}x that.")
    print("\n    But a window is a ceiling, not a working size:")
    print(f"      - the context cliff is around {CONTEXT_CLIFF_TOKENS:,} tokens "
          f"of retrieved context;")
    print(f"      - one chunk above ~{PRACTICAL_CHUNK_CEILING:,} tokens is noise "
          f"even on a 200K model.")
    print("      - so 'the whole library in one prompt' is the wrong target. "
          "Route to it.")


def library_size(root: Path, tokenizer_name: str) -> tuple[int, float]:
    """The library's token count under one tokenizer, and its ratio.

    `tokenizer_name` is a logical tokenizer name, or "estimate" to force the
    calibrated heuristic. Returns (tokens, chars_per_token) measured over
    the whole corpus.
    """
    counter = resolve_counter(root, tokenizer_name)
    docs = collect()
    total_chars = 0
    total_tokens = 0
    for d in docs:
        total_chars += len(d["body"])
        total_tokens += counter.count(d["body"])
    ratio = (total_chars / total_tokens) if total_tokens else 0.0
    return total_tokens, ratio


def print_models(counter, root: Path) -> None:
    """Per-model sizing: the library measured with each model's own tokenizer.

    A token count belongs to a tokenizer, not to the text. The same corpus
    measures differently under each model's vocabulary, so applying one
    model's count to another's window is how a haystack comes to
    under- or over-fill (arXiv:2605.02173, 2026).
    """
    windows = ollama_context_windows()
    print("[MODELS] The library against each model's context window\n")

    # Cache the corpus count per tokenizer so each is computed once.
    sizes: dict[str, tuple[int, float]] = {}

    def size_for(name: str | None) -> tuple[int, float]:
        key = name or "estimate"
        if key not in sizes:
            sizes[key] = library_size(root, name or "estimate")
        return sizes[key]

    exact_total, exact_ratio = size_for(counter.model)
    print(f"  Counted with {counter.model} "
          f"({'exact' if counter.exact else 'estimate'}): "
          f"{exact_total:,} tokens, {exact_ratio:.2f} chars/token\n")

    print(f"  {'Model':<28} {'Window':>11} {'Library':>11} {'Ratio':>7}  "
          f"{'Basis':<9} Verdict")
    print(f"  {'-'*28} {'-'*11} {'-'*11} {'-'*7}  {'-'*9} -------")

    rows = []
    for model, window in sorted(windows.items(), key=lambda x: -x[1]):
        tok_name, basis = MODEL_TOKENIZERS.get(model, (None, "estimate"))
        total, ratio = size_for(tok_name)
        if window >= total:
            verdict = f"fits, {window - total:,} spare"
        else:
            verdict = f"needs {total / window:.2f}x"
        rows.append((model, window, total, ratio, basis, verdict))

    for model, window, total, ratio, basis, verdict in rows:
        print(f"  {model:<28} {window:>11,} {total:>11,} {ratio:>7.2f}  "
              f"{basis:<9} {verdict}")

    # The spread between tokenizers, made visible.
    if len(sizes) > 1:
        print("\n  Spread between tokenizers on the same text:")
        for key, (total, ratio) in sorted(sizes.items(),
                                         key=lambda kv: kv[1][0]):
            label = key if key != "estimate" else "estimate (chars/3.9)"
            print(f"    {label:<20} {total:>9,} tokens  "
                  f"{ratio:.2f} chars/token")

    est_total, est_ratio = size_for(None)
    print("\n  Frontier tiers (benchr.org, September 2026) — sized with the "
          f"estimate ({est_ratio:.2f} chars/token):")
    for model, window in sorted(FRONTIER_CONTEXT_WINDOWS.items(),
                                key=lambda x: -x[1]):
        fits = "yes" if window >= est_total else "no"
        extra = "" if fits else f" (needs {est_total / window:.2f}x)"
        print(f"  {model:<28} {window:>11,}  {fits:<4}{extra}")

    print("\n  A window is a ceiling, not a working size: the context cliff is "
          f"~{CONTEXT_CLIFF_TOKENS:,} tokens of retrieved context.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Token accounting and context-window sizing for the "
                    "knowledge library.",
    )
    parser.add_argument("--model", default=None,
                        help="Tokenizer to count with: gemma-4-e2b-it, qwen3, "
                             "acestep, phi-4, or 'estimate' to force the "
                             "heuristic. Default: the first local tokenizer "
                             "found.")
    parser.add_argument("--category", action="append", default=[],
                        help="Limit to a primary category (can repeat)")
    parser.add_argument("--type", action="append", default=[],
                        help="Limit to a page type (can repeat)")
    parser.add_argument("--tag", action="append", default=[],
                        help="Limit to a cross-cutting tag (can repeat)")
    parser.add_argument("--format", choices=["report", "json", "models"],
                        default="report", help="Output format")
    args = parser.parse_args(argv)

    counter = resolve_counter(REPO, args.model)
    docs = collect()

    if args.format == "models":
        print_models(counter, REPO)
        return 0

    filters = {"categories": args.category, "types": args.type,
               "tags": args.tag}
    rep = report(docs, counter, filters)

    if args.format == "json":
        out = {
            "counter": counter.model,
            "exact": counter.exact,
            "chars_per_token": counter.chars_per_token,
            "documents": rep["documents"],
            "total_tokens": rep["total_tokens"],
            "by_category": rep["by_category"],
            "by_type": rep["by_type"],
            "largest": [
                {"tokens": n, "title": t, "file": f, "category": c}
                for n, t, f, c in rep["largest"]
            ],
        }
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0

    print_report(rep, counter, docs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
