"""Dense and hybrid retrieval for the knowledge library.

Why hybrid
----------
The 2026 evidence says one retriever is not enough:

* On documents with precise terminology, **BM25 beats state-of-the-art
  dense retrieval** — lexical matching catches exact metric labels and
  identifiers that embeddings dilute (arXiv:2604.01733, Apr 2026). A
  corpus-scaling study over 511,959 documents reaches the same conclusion
  (arXiv:2607.26497, Jul 2026).
* But BM25 is blind to synonymy, which is where dense retrieval earns its
  keep: a paraphrased question is BM25's classic failure.
* **Hybrid fusion (Reciprocal Rank Fusion) beats both single-stage
  methods** — Recall@5 0.695 against 0.644 for BM25 and 0.587 for dense
  (arXiv:2604.01733). It is the best *single-stage* pipeline; adding a
  cross-encoder reranker on top is better still, but can regress when the
  pool carries lexical near-misses.
* Pseudo-relevance feedback (RM3) *under-performs* the plain lexical
  baseline, and query rewriting alone (CRAG) falls short of simple hybrid
  fusion. So neither is a shortcut past hybrid.

So this module provides the three first-stage retrievers, and the fusion:

    BM25      lexical, exact terms
    dense     nomic-embed-text via Ollama, semantic
    hybrid    Reciprocal Rank Fusion of the two

The embedding model
-------------------
`nomic-embed-text:v1.5` is already installed in the studio's Ollama. It
is the right choice here for three reasons: 137M parameters so it runs on
the 8 GB card, an 8192-token context (so a whole document embeds in one
pass, not just a chunk), and open weights, code *and* training data. It
is also the model nomic publishes for long-document retrieval, which
matches a corpus of long technical articles.

Nomic requires task prefixes: `search_document: ` for documents and
`search_query: ` for queries. Omitting them measurably degrades
retrieval, so they are applied here rather than left to the caller.

Usage:

    python tools/kb-retrieval.py --stats
    python tools/kb-retrieval.py --query "how do I fix tempo octave errors"
"""
# ruff: noqa: N999
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    from _toolutil import REPO
except ImportError:  # pragma: no cover
    REPO = Path(__file__).resolve().parent.parent

BASE = REPO / "docs" / "knowledge-library"
CACHE_DIR = REPO / "output" / "kb-embed-cache"

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
DEFAULT_EMBED_MODEL = "nomic-embed-text:v1.5"

DOCUMENT_PREFIX = "search_document: "
QUERY_PREFIX = "search_query: "

TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9_-]{1,}")
STOPWORDS = {
    "the", "and", "for", "that", "with", "this", "from", "are", "was", "were",
    "has", "have", "not", "but", "you", "your", "its", "it's", "can", "all",
    "any", "our", "out", "use", "using", "used", "one", "two", "may", "how",
    "what", "when", "which", "who", "why", "does", "do", "did", "been", "than",
    "then", "them", "they", "their", "there", "here", "more", "most", "some",
    "such", "only", "also", "into", "over", "under", "between", "each", "both",
}


def tokenize(text: str) -> list[str]:
    return [t for t in TOKEN_RE.findall(text.lower()) if t not in STOPWORDS]


# ------------------------------------------------------------------ BM25
class BM25:
    """Okapi BM25. Same implementation as kb-eval.py — kept here so the
    retrieval module stands alone."""

    def __init__(self, docs: list[list[str]], k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.docs = docs
        self.n = len(docs)
        self.tf = [Counter(d) for d in docs]
        self.len = [len(d) for d in docs]
        self.avgdl = (sum(self.len) / self.n) if self.n else 0.0
        df: Counter = Counter()
        for d in docs:
            df.update(set(d))
        self.idf = {
            t: math.log(1 + (self.n - n + 0.5) / (n + 0.5)) for t, n in df.items()
        }

    def scores(self, query: list[str]) -> list[float]:
        out = []
        for i, tf in enumerate(self.tf):
            dl = self.len[i]
            s = 0.0
            for t in query:
                f = tf.get(t, 0)
                if not f:
                    continue
                idf = self.idf.get(t, 0.0)
                s += idf * (f * (self.k1 + 1)) / (
                    f + self.k1 * (1 - self.b + self.b * dl / (self.avgdl or 1))
                )
            out.append(s)
        return out

    def top(self, query: list[str], k: int) -> list[int]:
        scores = self.scores(query)
        order = sorted(range(len(scores)), key=lambda i: -scores[i])
        return order[:k]


# -------------------------------------------------------------- embeddings
class Embedder:
    """Embeds text with the local Ollama embedding model.

    Embeddings are cached on disk, keyed by the model and a hash of the
    text, so a re-run of the evaluation does not re-embed the library.
    """

    def __init__(self, model: str = DEFAULT_EMBED_MODEL, cache: bool = True):
        self.model = model
        self.cache = cache
        self.cache_dir = CACHE_DIR / model.replace(":", "_").replace("/", "_")
        self._mem: dict[str, list[float]] = {}
        self.hits = 0
        self.misses = 0
        if cache:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _key(self, text: str) -> str:
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]
        return f"{digest}.json"

    def _cached(self, key: str) -> list[float] | None:
        if key in self._mem:
            return self._mem[key]
        if not self.cache:
            return None
        path = self.cache_dir / key
        if path.exists():
            try:
                vec = json.loads(path.read_text(encoding="utf-8"))
                self._mem[key] = vec
                self.hits += 1
                return vec
            except Exception:
                return None
        return None

    def _store(self, key: str, vec: list[float]) -> None:
        self._mem[key] = vec
        if self.cache:
            try:
                (self.cache_dir / key).write_text(json.dumps(vec), encoding="utf-8")
            except OSError:
                pass

    def embed(self, texts: list[str], kind: str = "document") -> list[list[float]]:
        """Embed texts. `kind` is "document" or "query"."""
        prefix = DOCUMENT_PREFIX if kind == "document" else QUERY_PREFIX
        keys = [self._key(prefix + t) for t in texts]
        out: list[list[float] | None] = [self._cached(k) for k in keys]

        missing = [i for i, v in enumerate(out) if v is None]
        if missing:
            self.misses += len(missing)
            # Ollama takes a list; keep batches modest so a large request
            # does not time out.
            batch = 64
            for start in range(0, len(missing), batch):
                idxs = missing[start:start + batch]
                payload = {"model": self.model,
                           "input": [prefix + texts[i] for i in idxs]}
                vecs = self._post(payload)
                for i, v in zip(idxs, vecs, strict=True):
                    out[i] = v
                    self._store(keys[i], v)
        return [v if v is not None else [] for v in out]

    def _post(self, payload: dict) -> list[list[float]]:
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/embed",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=600) as r:
            data = json.loads(r.read())
        return data.get("embeddings", [])


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


class DenseIndex:
    """Dense index over a corpus, searched by cosine similarity."""

    def __init__(self, texts: list[str], embedder: Embedder):
        self.texts = texts
        self.embedder = embedder
        self.vectors = embedder.embed(texts, kind="document")

    def cosines(self, query: str) -> list[float]:
        """Cosine similarity of the query against every indexed document."""
        qv = self.embedder.embed([query], kind="query")[0]
        if not qv:
            return [0.0] * len(self.vectors)
        return [cosine(qv, v) for v in self.vectors]

    def top(self, query: str, k: int) -> list[int]:
        qv = self.embedder.embed([query], kind="query")[0]
        if not qv:
            return []
        scores = [cosine(qv, v) for v in self.vectors]
        order = sorted(range(len(scores)), key=lambda i: -scores[i])
        return order[:k]


# -------------------------------------------------------------- fusion
def rrf_fuse(rankings: list[list[int]], k: int = 60) -> list[int]:
    """Reciprocal Rank Fusion.

    score(d) = sum over retrievers of 1 / (k + rank_i(d))

    RRF is used rather than a score sum because BM25 scores and cosine
    similarities are not on the same scale, so they cannot be added
    directly; ranks can.
    """
    scores: dict[int, float] = {}
    for ranking in rankings:
        for rank, doc in enumerate(ranking, 1):
            scores[doc] = scores.get(doc, 0.0) + 1.0 / (k + rank)
    return [d for d, _ in sorted(scores.items(), key=lambda kv: -kv[1])]


# ------------------------------------------------------- chunk enrichment
def enrich(text: str, heading_path: str) -> str:
    """Prepend the heading path to a chunk's text.

    A chunk's own heading is in its text, but its *ancestors* are not — a
    chunk under "### CUDA Optimization" inside "## 3D Rendering Pipeline"
    does not contain the words "3D rendering pipeline". The heading path
    is metadata and is not indexed, so the ancestors are invisible to
    both retrievers. Prepending it makes the section's subject matchable.
    """
    if not heading_path:
        return text
    return f"{heading_path}\n{text}"


# ------------------------------------------------------- contextual index
CONTEXTUAL_DIR = REPO / "output" / "kb-context-cache"


def document_summary(body: str, model: str, title: str = "") -> str:
    """A one-paragraph summary of a document, written by the local LLM.

    Contextual retrieval: prepending a summary of the source document to
    each of its chunks at index time is the one augmentation the literature
    finds consistently helpful — it gives a chunk the document's context
    ("which entities, which topic") so a chunk that says "it supports 8 GB"
    can still be matched to a question about the model it belongs to.

    Cached on disk, keyed by the document text, because it costs one LLM
    call per document.
    """
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()[:32]
    cache_dir = CONTEXTUAL_DIR / model.replace(":", "_").replace("/", "_")
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{digest}.txt"
    if cache_path.exists():
        try:
            cached = cache_path.read_text(encoding="utf-8").strip()
            if cached:
                return cached
        except OSError:
            pass

    head = body[:6000]
    prompt = (
        "Summarise this technical article in two sentences, naming the "
        "specific topic, the entities it concerns, and what it concludes. "
        "Write it as search context that could sit above a passage from "
        "the article, so a reader can tell what the passage is about.\n\n"
        f"ARTICLE{': ' + title if title else ''}:\n{head}\n\nSUMMARY:"
    )
    try:
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate",
            data=json.dumps({
                "model": model, "prompt": prompt, "stream": False,
                "options": {"temperature": 0.2, "num_predict": 120},
            }).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=300) as r:
            summary = (json.loads(r.read()).get("response") or "").strip()
    except Exception:
        return ""
    if summary:
        try:
            cache_path.write_text(summary, encoding="utf-8", newline="\n")
        except OSError:
            pass
    return summary


def contextualize(chunks: list[dict], summaries: dict[str, str]) -> None:
    """Prepend each document's summary to its chunks, in place."""
    for c in chunks:
        summary = summaries.get(c.get("doc", ""), "")
        if summary:
            c["text"] = f"{summary}\n{c['text']}"


def hyde_query(question: str, model: str, timeout: int = 120) -> str:
    """A hypothetical answer to the question, for HyDE.

    HyDE retrieves with a generated *answer* rather than the question,
    which helps when the question's wording differs from the document's.
    The literature is specific about where it helps: it improves *sparse*
    retrieval substantially and dense retrieval barely at all, and it
    underperforms plain hybrid fusion, so it is worth measuring rather
    than assuming.
    """
    prompt = (
        "Write a short passage that would answer this question, in the "
        "voice of a technical reference document. Two sentences. Do not "
        "ask questions or hedge.\n\n"
        f"QUESTION: {question}\n\nPASSAGE:"
    )
    try:
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate",
            data=json.dumps({
                "model": model, "prompt": prompt, "stream": False,
                "options": {"temperature": 0.4, "num_predict": 120},
            }).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return (json.loads(r.read()).get("response") or "").strip()
    except Exception:
        return ""



# ----------------------------------------------------------- reranking
class CrossEncoderReranker:
    """A cross-encoder reranker: scores a (query, passage) pair *jointly*.

    A bi-encoder embeds the query and the passage separately, so a passage
    can be retrieved for a query it never mentions in the same words. A
    cross-encoder reads both together, which is why it can reorder a pool
    that the first stage got right but in the wrong order — and why the
    literature is split on it: a cross-encoder on top of hybrid is the
    best single pipeline in one benchmark, and *regresses* in another
    where the pool's lexical near-misses bias it. So it has to be
    measured here.

    Requires `transformers` and `torch`; without them the reranker
    reports itself unavailable and the caller skips the configuration
    rather than silently falling back to something else.
    """

    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2",
                 max_length: int = 512):
        self.model_name = model_name
        self.max_length = max_length
        self._model = None
        self._tokenizer = None
        self.available: bool | None = None

    def _ensure(self) -> bool:
        if self._model is not None:
            return True
        if self.available is False:
            return False
        try:
            from transformers import (  # noqa: PLC0415
                AutoModelForSequenceClassification,
                AutoTokenizer,
            )
        except ImportError:
            self.available = False
            return False
        try:
            self._tokenizer = AutoTokenizer.from_pretrained(self.model_name)
            self._model = AutoModelForSequenceClassification.from_pretrained(
                self.model_name
            )
            self._model.eval()
            self.available = True
        except Exception:
            self.available = False
            return False
        return True

    def score(self, query: str, passages: list[str],
              batch_size: int = 32) -> list[float]:
        """Relevance score for each passage against the query."""
        if not passages or not self._ensure():
            return [0.0] * len(passages)
        import torch  # noqa: PLC0415

        scores: list[float] = []
        with torch.no_grad():
            for start in range(0, len(passages), batch_size):
                batch = passages[start:start + batch_size]
                enc = self._tokenizer(
                    [query] * len(batch), batch, padding=True, truncation=True,
                    max_length=self.max_length, return_tensors="pt",
                )
                logits = self._model(**enc).logits
                # A cross-encoder emits a single relevance logit; a
                # two-logit head (query/relevance) is handled by taking the
                # difference.
                if logits.shape[-1] == 1:
                    row = logits.squeeze(-1)
                else:
                    row = logits[:, -1] - logits[:, 0]
                scores.extend(float(x) for x in row.tolist())
        return scores

    def rerank(self, query: str, candidates: list[int], passages: list[str],
               k: int) -> list[int]:
        """Reorder `candidates` (indices into `passages`) by relevance."""
        if not candidates:
            return []
        scores = self.score(query, [passages[i] for i in candidates])
        order = sorted(range(len(candidates)), key=lambda j: -scores[j])
        return [candidates[j] for j in order[:k]]

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Dense and hybrid retrieval over the knowledge library.",
    )
    parser.add_argument("--query", help="Run one query and print the hits")
    parser.add_argument("--stats", action="store_true",
                        help="Report index size and embedding cost")
    parser.add_argument("--k", type=int, default=5, help="Hits to return")
    parser.add_argument("--model", default=DEFAULT_EMBED_MODEL,
                        help="Ollama embedding model")
    parser.add_argument("--no-cache", action="store_true",
                        help="Do not cache embeddings on disk")
    args = parser.parse_args(argv)

    paths = [p for p in sorted(BASE.glob("*.md"))
              if p.name not in ("index.md", "README.md", "_schema.md", "log.md")]
    texts = [p.read_text(encoding="utf-8-sig") for p in paths]

    if args.stats:
        embedder = Embedder(args.model, cache=not args.no_cache)
        index = DenseIndex(texts, embedder)
        print(f"  documents      : {len(texts)}")
        print(f"  embedding model: {args.model}")
        print(f"  dimensions     : {len(index.vectors[0]) if index.vectors else 0}")
        print(f"  cache hits     : {embedder.hits}")
        print(f"  cache misses   : {embedder.misses}")
        print(f"  cache dir      : {embedder.cache_dir}")
        return 0

    if not args.query:
        parser.error("give --query or --stats")

    embedder = Embedder(args.model, cache=not args.no_cache)
    dense = DenseIndex(texts, embedder)
    bm25 = BM25([tokenize(t) for t in texts])

    d = dense.top(args.query, args.k)
    b = bm25.top(tokenize(args.query), args.k)
    h = rrf_fuse([b, d])[: args.k]

    print(f"  query: {args.query!r}\n")
    for name, ranking in (("bm25", b), ("dense", d), ("hybrid", h)):
        print(f"  {name}:")
        for rank, i in enumerate(ranking, 1):
            print(f"    {rank}. {paths[i].name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
