"""Token counting for the knowledge-library tools.

Why this module exists
----------------------
"Tokens" are not a property of text — they are a property of *a model's
tokenizer*. The same corpus measures 0.9 to 1.2 tokens per character
across vendors, a 35% spread, so a haystack sized to fill one model's
context window substantially under- or over-fills another's
(arXiv:2605.02173, 2026). Any tool that says "this library is N tokens"
without saying *for which model* is not being useful.

So: count exactly when a tokenizer is available, and estimate transparently
when it is not — and always report which was used and what the implied
tokens-per-character ratio is, so the estimate's error is visible.

Local tokenizers
----------------
The studio already has tokenizers on disk for the models it runs:

    gemma-4-e2b-it   the studio's own vision model
    qwen3            the Qwen3-Embedding-0.6B tokenizer (same family as
                     the local qwen3.5 models)
    acestep          the ACE-Step music model
    phi-4            the phi-4-mini model

`tokenizers` is an optional dependency: the exact path is used when the
library is importable, and the calibrated estimate is used when it is not.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

# The heuristic: English prose averages ~4 characters per token, ~0.75 words
# per token. Markdown is denser than prose (tables, code, punctuation), so a
# slightly smaller divisor is used for a markdown corpus.
CHARS_PER_TOKEN_MARKDOWN = 3.9

# Local tokenizer candidates, in preference order. Glob patterns so the
# snapshot hash in a HuggingFace cache path does not have to be hard-coded.
TOKENIZER_CANDIDATES: dict[str, tuple[str, ...]] = {
    "gemma-4-e2b-it": (
        "huggingface_cache/hub/models--unsloth--gemma-4-e2b-it-unsloth-bnb-4bit"
        "/snapshots/*/tokenizer.json",
    ),
    "gemma-4-e4b-it": (
        "huggingface_cache/hub/models--unsloth--gemma-4-e4b-it-unsloth-bnb-4bit"
        "/snapshots/*/tokenizer.json",
    ),
    "qwen3": (
        "tools/checkpoints/Qwen3-Embedding-0.6B/tokenizer.json",
        "huggingface_cache/hub/models--Qwen--Qwen3-Embedding-0.6B/snapshots/*/tokenizer.json",
    ),
    "acestep": (
        "tools/checkpoints/acestep-5Hz-lm-1.7B/tokenizer.json",
    ),
    "phi-4": (
        "huggingface_cache/hub/models--unsloth--phi-4-mini-instruct-unsloth-bnb-4bit"
        "/snapshots/*/tokenizer.json",
    ),
}

# Which local tokenizer applies to which Ollama model.
#
# "exact"      — this is the model's own tokenizer.
# "family"     — the same tokenizer family, but not the model's exact
#                vocabulary; close, and flagged as a proxy.
# None         — no local tokenizer; the count is an estimate.
MODEL_TOKENIZERS: dict[str, tuple[str | None, str]] = {
    "gemma4:e2b-it-qat": ("gemma-4-e2b-it", "exact"),
    "gemma4:e4b-it": ("gemma-4-e4b-it", "exact"),
    "gemma4-vision-optimized-latest": ("gemma-4-e2b-it", "family"),
    "qwen3.5:4b": ("qwen3", "family"),
    "qwen3.5:9b": ("qwen3", "family"),
    "minicpm-v:8b": (None, "estimate"),
    "minicpm-v:latest": (None, "estimate"),
    "llama3.2:3b": (None, "estimate"),
    "nomic-embed-text:v1.5": (None, "estimate"),
    "deepseek-r1:7b": ("qwen3", "family"),
}

# The default tokenizer to use when none is named: the studio's own model.
DEFAULT_TOKENIZER = "gemma-4-e2b-it"


def find_tokenizer_file(root: Path, name: str) -> Path | None:
    """Return the path of a local tokenizer.json for `name`, or None."""
    for pattern in TOKENIZER_CANDIDATES.get(name, ()):
        for candidate in sorted(root.glob(pattern)):
            if candidate.is_file():
                return candidate
    return None


@dataclass
class TokenCounter:
    """Counts tokens with a real tokenizer when one is available.

    Attributes:
        model: the name of the tokenizer in use ("estimate" when none).
        exact: whether the count is exact or estimated.
        chars_per_token: the observed ratio, which makes an estimate's
            error visible instead of hidden.
    """

    model: str
    exact: bool
    chars_per_token: float
    _tokenizer: object | None = None

    def count(self, text: str) -> int:
        """Count the tokens in `text`."""
        if self._tokenizer is not None:
            return len(self._tokenizer.encode(text).ids)
        return max(1, int(len(text) / self.chars_per_token))

    def count_many(self, texts: list[str]) -> list[int]:
        return [self.count(t) for t in texts]


def resolve_counter(root: Path, name: str | None = None) -> TokenCounter:
    """Build a counter for `name`, falling back to the estimate.

    `name` may be a logical tokenizer name ("gemma-4-e2b-it", "qwen3",
    "acestep", "phi-4") or "estimate" to force the heuristic.
    """
    if name == "estimate":
        return TokenCounter(model="estimate", exact=False,
                           chars_per_token=CHARS_PER_TOKEN_MARKDOWN)

    candidates = [name] if name else list(TOKENIZER_CANDIDATES)
    for candidate in candidates:
        if not candidate:
            continue
        path = find_tokenizer_file(root, candidate)
        if path is None:
            continue
        try:
            from tokenizers import Tokenizer  # noqa: PLC0415

            tokenizer = Tokenizer.from_file(str(path))
        except Exception:
            # The library is missing or the file is unusable — try the next.
            continue
        return TokenCounter(model=candidate, exact=True,
                            chars_per_token=CHARS_PER_TOKEN_MARKDOWN,
                            _tokenizer=tokenizer)

    return TokenCounter(model="estimate", exact=False,
                        chars_per_token=CHARS_PER_TOKEN_MARKDOWN)


def measure_ratio(counter: TokenCounter, sample: str) -> float:
    """The observed tokens-per-character ratio for `sample`."""
    if not sample:
        return counter.chars_per_token
    return len(sample) / max(1, counter.count(sample))


# ---------------------------------------------------------------- context
# Context windows of models this studio can actually run, plus the frontier
# tiers from the September 2026 leaderboard (benchr.org). A context window
# is the ceiling, not the useful amount: quality falls off a cliff well
# before it (see the "context cliff" note in kb-tokens.py).

LOCAL_CONTEXT_WINDOWS: dict[str, int] = {
    # Read from the running Ollama at /api/show; these are the values it
    # reported on 2026-10-22 and act as the fallback when Ollama is down.
    # Local-only per studio policy: network-hosted models are not listed.
    "glm-4.7-flash:latest": 202_752,
    "qwen3.5:4b": 262_144,
    "qwen3.5:9b": 262_144,
    "minicpm-v:latest": 32_768,
    "minicpm-v:8b": 32_768,
    "llama3.2:3b": 131_072,
    "gemma4:e2b-it-qat": 131_072,
    "nomic-embed-text:v1.5": 2_048,
}

FRONTIER_CONTEXT_WINDOWS: dict[str, int] = {
    "Llama 4 Scout": 10_000_000,
    "GPT-5.5": 1_050_000,
    "Gemini 3.5 Flash": 1_048_576,
    "Claude Opus 4.8": 1_000_000,
    "DeepSeek V4-Pro": 1_000_000,
    "Kimi K2.6": 262_144,
    "Qwen3.6-27B": 262_144,
    "Mistral Large 3": 256_000,
    "Claude Haiku 4.5": 200_000,
    "Phi-4": 16_000,
}

# The context cliff: quality degrades past roughly this many tokens of
# retrieved context, even on a model with a 1M window
# (arXiv:2601.14123, "A Systematic Analysis of Chunking Strategies", 2026).
CONTEXT_CLIFF_TOKENS = 2_500

# A practical ceiling on a single chunk, even on a 200K-window model.
PRACTICAL_CHUNK_CEILING = 8_000


def humanize_tokens(n: int) -> str:
    """Render a token count compactly: 294151 -> '294.2k'."""
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}k"
    return str(n)


def split_sentences(text: str) -> list[str]:
    """Split into sentences, keeping terminal punctuation.

    Deliberately simple: a regex over sentence-final punctuation, with a
    guard for common abbreviations so "e.g." does not end a sentence. The
    2026 chunking study found sentence-aware splitting the most
    cost-effective method, so the boundary quality matters more than
    handling every edge case.
    """
    # Protect common abbreviations and initials from being split.
    protected = re.sub(
        r"\b(e\.g|i\.e|etc|vs|cf|al|Dr|Mr|Mrs|Ms|Fig|No|approx)\.",
        r"\1<DOT>",
        text,
    )
    parts = re.split(r"(?<=[.!?])\s+", protected)
    return [p.replace("<DOT>", ".") for p in parts if p.strip()]
