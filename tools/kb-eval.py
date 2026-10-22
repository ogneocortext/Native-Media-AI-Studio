"""Retrieval evaluation for the knowledge library's chunking.

Answers the question the chunking design implies but does not prove: does
fetching a *parent* section instead of a small *child* chunk actually put
the answer in front of the model, and what does that cost in tokens?

The method is a cloze probe, which avoids the circularity of writing
questions about a corpus you also wrote:

1. For each document, pick the sentence containing the corpus's rarest term.
   That term is the answer.
2. Build the query from the same sentence with the answer term removed, so
   the query does not contain the answer.
3. Retrieve the top-k chunks with BM25.
4. Score whether the answer term appears in the returned context, whether
   the gold document was retrieved, and the rank of the first gold chunk.

Three configurations are compared on the same probes:

    child        index the small chunks, return the small chunks
    parent       index the parent sections, return the parent sections
    parent_child index the small chunks, return their parents

BM25 rather than embeddings: it is deterministic, needs no model, and the
MDKeyChunker study (arXiv:2603.23533) reports BM25 over structural chunks
matching or beating dense retrieval on Markdown — so a BM25 result is not
a weak baseline.

Usage:

    python tools/kb-eval.py                 # the comparison
    python tools/kb-eval.py --limit 40      # fewer probes
    python tools/kb-eval.py --json          # machine-readable
    python tools/kb-eval.py --probes 10     # print the probes
"""
# ruff: noqa: N999
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    from _kb_tokens import resolve_counter
    from _toolutil import REPO
except ImportError:  # pragma: no cover
    REPO = Path(__file__).resolve().parent.parent
    resolve_counter = None

BASE = REPO / "docs" / "knowledge-library"

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


def load_module(filename: str, alias: str):
    spec = importlib.util.spec_from_file_location(alias, REPO / "tools" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


kb = load_module("kb-chunk.py", "kb_chunk")
kbc = load_module("kb-context.py", "kb_context")


# ------------------------------------------------------------------ BM25
class BM25:
    """Okapi BM25 over a set of documents."""

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
            t: math.log(1 + (self.n - n + 0.5) / (n + 0.5))
            for t, n in df.items()
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


# ---------------------------------------------------------------- probes
def build_probes(docs: list[dict], limit: int,
                 max_answer_df: float = 0.05,
                 mode: str = "specific") -> list[dict]:
    """Build cloze probes: the query hides the answer term.

    For each document, the sentence holding the corpus's rarest *usable*
    term is chosen; the query is drawn from the same sentence with the
    answer term withheld.

    The answer term must be rare enough to be informative — a term that
    appears in half the corpus would be "found" by any context, and the
    measurement would mean nothing. It must also be a real word, not a
    fragment like "js" out of "Anime.js".

    Two query styles, because they stress the chunker differently:

    ``specific``  the query uses the sentence's *distinctive* terms — a user
                  who knows the jargon. Easy for any retriever.
    ``generic``   the query uses the sentence's most *common* terms — a user
                  who does not know the jargon and describes the topic in
                  plain words. This is where the chunking strategy matters:
                  many documents match, and what you return decides whether
                  the answer is in front of the model.
    """
    n = len(docs)
    # Document frequency over the whole corpus.
    df: Counter = Counter()
    doc_tokens = []
    for d in docs:
        toks = tokenize(d["body"])
        doc_tokens.append(toks)
        df.update(set(toks))
    idf = {t: math.log(1 + n / (1 + c)) for t, c in df.items()}

    max_df = max(2, int(n * max_answer_df))
    probes = []
    for d in docs:
        body = d["body"]
        sentences = [s for s in re.split(r"(?<=[.!?])\s+|\n{2,}", body)
                     if len(s) >= 40]
        best = None
        best_score = -1.0
        for s in sentences:
            st = tokenize(s)
            if len(st) < 6:
                continue
            # The answer is the sentence's rarest term that is still a
            # real, distinctive word.
            eligible = [t for t in st
                        if len(t) >= 4 and df.get(t, n) <= max_df
                        and not t.isdigit()]
            if not eligible:
                continue
            answer = max(eligible, key=lambda t: idf.get(t, 0.0))
            score = idf.get(answer, 0.0)
            if score > best_score:
                best_score = score
                best = (s, answer)
        if not best:
            continue
        sentence, answer = best
        # The query is a keyword query over the sentence's terms, with the
        # answer term withheld. Using the whole sentence minus one term
        # makes retrieval trivial (the gold document always ranks first),
        # which measures nothing; a bag of content words is what a
        # search-driven agent actually sends.
        pool = [t for t in tokenize(sentence) if t != answer]
        if not pool:
            continue
        if mode == "generic":
            # The most common terms — the plain-words case.
            pool.sort(key=lambda t: -df.get(t, 0))
        else:
            # The most distinctive terms — the jargon case.
            pool.sort(key=lambda t: -idf.get(t, 0.0))
        query_terms = pool[:4]
        if not query_terms:
            continue
        query_text = " ".join(query_terms)
        probes.append({
            "doc": d["name"],
            "title": d["title"],
            "sentence": " ".join(sentence.split())[:300],
            "answer": answer,
            "answer_df": df.get(answer, n),
            "ngram": _ngram(sentence),
            "query": query_text[:300],
        })
        if len(probes) >= limit:
            break
    return probes


def _ngram(sentence: str, size: int = 6) -> str:
    """A distinctive word n-gram of the sentence, for passage containment."""
    words = " ".join(sentence.split()).split()
    if len(words) < size:
        return " ".join(words)
    return " ".join(words[:size])


# ------------------------------------------------------------ evaluation
def evaluate(chunks, parents, probes, k=5, doc_texts=None):
    """Score the retrieval configurations on the same probes."""
    doc_texts = doc_texts or {}
    # Children carry the ids of the sections they came from, so the parent
    # lookup is exact rather than inferred. A merged chunk spans several
    # sections, so it has several parents.
    parent_by_id = {p["id"]: p for p in parents}
    parent_of = [[parent_by_id[pid] for pid in c.get("parents", [])
                   if pid in parent_by_id] for c in chunks]

    child_docs = [tokenize(c["text"]) for c in chunks]
    parent_docs = [tokenize(p["text"]) for p in parents]
    child_index = BM25(child_docs)
    parent_index = BM25(parent_docs)

    results = {"child": [], "parent": [], "parent_child": [], "doc": []}

    for probe in probes:
        q = tokenize(probe["query"])
        gold_doc = probe["doc"]
        answer = probe["answer"]
        answer_re = re.compile(rf"\b{re.escape(answer)}\b", re.I)
        ngram = probe.get("ngram", "")

        # --- child: index children, return children
        top = child_index.top(q, k)
        ctx = " ".join(chunks[i]["text"] for i in top)
        results["child"].append(_score(probe, top, ctx, answer_re, ngram,
                                      chunks, gold_doc))

        # --- parent: index parents, return parents
        ptop = parent_index.top(q, k)
        pctx = " ".join(parents[i]["text"] for i in ptop)
        results["parent"].append(_score(probe, ptop, pctx, answer_re, ngram,
                                       parents, gold_doc))

        # --- parent_child: index children, return their parents
        ctop = child_index.top(q, k)
        pids = []
        seen_ids = set()
        for i in ctop:
            for p in parent_of[i]:
                if id(p) not in seen_ids:
                    seen_ids.add(id(p))
                    pids.append(p)
        pc_ctx = " ".join(p["text"] for p in pids)
        results["parent_child"].append(_score(probe, ctop, pc_ctx, answer_re,
                                              ngram, chunks, gold_doc))

        # --- doc: index children, return the whole document
        dctx_parts = []
        seen_docs = set()
        for i in ctop:
            name = chunks[i]["doc"]
            if name in seen_docs:
                continue
            seen_docs.add(name)
            dctx_parts.append(doc_texts.get(name, ""))
        dctx = " ".join(dctx_parts)
        results["doc"].append(_score(probe, ctop, dctx, answer_re, ngram,
                                     chunks, gold_doc))

    return results


def _score(probe, top, context, answer_re, ngram, corpus, gold_doc):
    """One probe's score: answer present? passage present? gold rank?"""
    answer_hit = bool(answer_re.search(context))
    # The library's markdown is hard-wrapped, so a phrase read off one
    # line is not contiguous in the body: the newline sits inside it.
    # Compare on whitespace-collapsed text, or the metric measures the
    # line wrapping rather than the retrieval.
    passage_hit = bool(ngram) and _squash(ngram) in _squash(context)
    # Rank of the first retrieved item from the gold document.
    rank = 0
    for r, i in enumerate(top, 1):
        if corpus[i].get("doc") == gold_doc:
            rank = r
            break
    return {
        "answer_hit": answer_hit,
        "passage_hit": passage_hit,
        "doc_rank": rank,
        "tokens": len(context) // 4,
    }


def _squash(text: str) -> str:
    """Collapse every whitespace run to a single space, and lowercase."""
    return " ".join(text.lower().split())


def summarize(name, rows, k):
    n = len(rows)
    if not n:
        return
    hits = sum(1 for r in rows if r["answer_hit"])
    passages = sum(1 for r in rows if r["passage_hit"])
    doc_hits = sum(1 for r in rows if 0 < r["doc_rank"] <= k)
    rr = sum(1.0 / r["doc_rank"] for r in rows if r["doc_rank"]) / n
    mean_tokens = sum(r["tokens"] for r in rows) / n
    print(f"  {name:<14} answer@{k} {hits / n:>6.1%}   "
          f"passage {passages / n:>6.1%}   doc@{k} {doc_hits / n:>6.1%}   "
          f"MRR {rr:>6.3f}   ~{mean_tokens:>5.0f} tok")


def _sweep(docs, probes, args) -> int:
    """Sweep the chunk target and k, for the child configuration.

    The question the sweep answers: is 400 the right chunk size, and does
    retrieving more help enough to be worth the tokens?
    """
    counter = resolve_counter(REPO, None) if resolve_counter else None
    doc_texts = {d["name"]: d["body"] for d in docs}
    print("[SWEEP] Chunk target x k (child configuration)\n")
    print(f"  {'target':>7} {'k':>3} {'chunks':>7} {'passage':>9} "
          f"{'doc@k':>8} {'MRR':>7} {'context':>9}")
    print(f"  {'-'*7} {'-'*3} {'-'*7} {'-'*9} {'-'*8} {'-'*7} {'-'*9}")
    for target in (200, 400, 800, 1200):
        chunks, parents = [], []
        for path in sorted(BASE.glob("*.md")):
            if path.name in ("index.md", "README.md", "_schema.md", "log.md"):
                continue
            c, p, _d = kb.chunk_document(path, counter, target, 0)
            chunks.extend(c)
            parents.extend(p)
        for k in (3, 5, 8):
            res = evaluate(chunks, parents, probes, k, doc_texts)
            rows = res["child"]
            n = len(rows)
            passage = sum(1 for r in rows if r["passage_hit"]) / n
            doc_hit = sum(1 for r in rows if 0 < r["doc_rank"] <= k) / n
            mrr = sum(1.0 / r["doc_rank"] for r in rows if r["doc_rank"]) / n
            tok = sum(r["tokens"] for r in rows) / n
            print(f"  {target:>7} {k:>3} {len(chunks):>7,} {passage:>9.1%} "
                  f"{doc_hit:>8.1%} {mrr:>7.3f} {tok:>8.0f}t")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate the knowledge library's chunking for retrieval.",
    )
    parser.add_argument("--limit", type=int, default=60,
                        help="How many probes to build (default 60)")
    parser.add_argument("--k", type=int, default=5,
                        help="How many chunks to retrieve (default 5)")
    parser.add_argument("--target", type=int, default=400,
                        help="Chunk target in tokens (default 400)")
    parser.add_argument("--probes", type=int, default=0,
                        help="Print this many probes and exit")
    parser.add_argument("--probe-mode", choices=["specific", "generic"],
                        default="specific",
                        help="Query style: distinctive terms (specific) or "
                             "plain-words terms (generic)")
    parser.add_argument("--json", action="store_true",
                        help="Emit JSON instead of a table")
    parser.add_argument("--sweep", action="store_true",
                        help="Sweep chunk target and k, reporting the "
                             "trade-off between passage recall and context size")
    args = parser.parse_args(argv)

    counter = resolve_counter(REPO, None) if resolve_counter else None
    chunks, parents = [], []
    for path in sorted(BASE.glob("*.md")):
        if path.name in ("index.md", "README.md", "_schema.md", "log.md"):
            continue
        c, p, _defects = kb.chunk_document(path, counter, args.target, 0)
        chunks.extend(c)
        parents.extend(p)

    docs = [kbc.parse_doc(p, counter) for p in sorted(BASE.glob("*.md"))
            if p.name not in ("index.md", "README.md", "_schema.md", "log.md")]
    probes = build_probes(docs, args.limit, mode=args.probe_mode)

    if args.probes:
        for p in probes[: args.probes]:
            print(f"\n--- {p['title']} ({p['doc']})")
            print(f"  query : {p['query'][:150]}")
            print(f"  answer: {p['answer']}")
        return 0

    if args.sweep:
        return _sweep(docs, probes, args)

    if not probes:
        print("No probes could be built.", file=sys.stderr)
        return 1

    results = evaluate(chunks, parents, probes, args.k,
                       doc_texts={d["name"]: d["body"] for d in docs})

    if args.json:
        out = {}
        for name, rows in results.items():
            n = len(rows)
            out[name] = {
                "answer_hit": sum(1 for r in rows if r["answer_hit"]) / n,
                "passage_hit": sum(1 for r in rows if r["passage_hit"]) / n,
                "doc_hit": sum(1 for r in rows if 0 < r["doc_rank"] <= args.k) / n,
                "mrr": sum(1.0 / r["doc_rank"] for r in rows if r["doc_rank"]) / n,
                "mean_context_tokens": sum(r["tokens"] for r in rows) / n,
            }
        print(json.dumps({"probes": len(probes), "k": args.k,
                          "configurations": out}, indent=2))
        return 0

    print("[EVAL] Retrieval over the knowledge library\n")
    print(f"  Probes      : {len(probes)} (cloze — the query hides the answer term)")
    print(f"  Query style : {args.probe_mode} "
          f"({'distinctive terms' if args.probe_mode == 'specific' else 'plain-words terms'})")
    print(f"  Chunks      : {len(chunks)} children, {len(parents)} parents")
    print(f"  Chunk target: {args.target} tokens")
    print(f"  Retrieved k : {args.k}\n")
    print(f"  {'configuration':<14} {'answer@k':>10} {'passage':>9} "
          f"{'doc@k':>8} {'MRR':>8} {'context':>11}")
    print(f"  {'-'*14} {'-'*10} {'-'*9} {'-'*8} {'-'*8} {'-'*11}")
    for name in ("child", "parent", "parent_child", "doc"):
        summarize(name, results[name], args.k)
    print("\n  child       = index small chunks, return small chunks")
    print("  parent      = index parent sections, return parent sections")
    print("  parent_child= index small chunks, return their parents")
    print("  doc         = index small chunks, return the whole document")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
