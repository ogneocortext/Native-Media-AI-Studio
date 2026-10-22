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
import os
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
kr = load_module("kb-retrieval.py", "kb_retrieval")

# One BM25, one dense index, one fusion — the retrieval module owns them so
# the evaluator and the serving path cannot drift apart.
BM25 = kr.BM25
rrf_fuse = kr.rrf_fuse
enrich = kr.enrich
Embedder = kr.Embedder
DenseIndex = kr.DenseIndex
document_summary = kr.document_summary
contextualize = kr.contextualize
hyde_query = kr.hyde_query


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
    ``sentence``  the query is the whole sentence with the answer term
                  withheld — a natural-language question, which is what a
                  conversational agent actually sends. This is the mode that
                  gives dense retrieval a fair test: an embedding of four
                  keywords carries almost no semantics, so a keyword-bag
                  probe measures the embedding's ability to rank noise.
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
        if mode == "sentence":
            # The whole sentence, minus the answer term: natural language.
            query_text = re.sub(rf"\b{re.escape(answer)}\b", " ", sentence)
            query_text = " ".join(query_text.split())
        else:
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
def score_fuse(bm25_scores, cosine_scores, k):
    """Fuse by *normalised score* rather than by rank.

    RRF is the safe default because BM25 scores and cosine similarities
    are not on the same scale. But RRF throws the score magnitudes away,
    so it cannot reward a document that one retriever is very confident
    about. This variant min-max normalises each retriever's scores over
    its own candidate pool and adds them, which keeps the magnitudes.

    Returns the fused ranking.
    """
    def norm(values):
        if not values:
            return []
        lo = min(values)
        hi = max(values)
        if hi - lo < 1e-12:
            return [0.0] * len(values)
        return [(v - lo) / (hi - lo) for v in values]

    b = norm(bm25_scores)
    c = norm(cosine_scores)
    fused = [b[i] + c[i] for i in range(min(len(b), len(c)))]
    order = sorted(range(len(fused)), key=lambda i: -fused[i])
    return order[:k]


def evaluate(chunks, parents, probes, k=5, doc_texts=None, dense_index=None,
             hyde_index=None):
    """Score the retrieval configurations on the same probes.

    `dense_index` is a DenseIndex over the same chunks; when present the
    dense and hybrid configurations are scored too.

    `hyde_index` is a list of LLM-written hypothetical answers, one per
    probe, in the same order.
    """
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
    if dense_index is not None:
        results["dense"] = []
        results["hybrid"] = []
        results["hybrid_score"] = []
    if hyde_index is not None:
        results["hyde"] = []

    for probe_index, probe in enumerate(probes):
        # A written question set uses "question" and "fact"; a cloze probe
        # uses "query" and "ngram". Normalise here rather than at the call
        # site, so every scoring path sees one shape.
        query_text = probe.get("query") or probe.get("question") or ""
        ngram = probe.get("ngram") or probe.get("fact") or ""
        answer_term = probe.get("answer") or (
            ngram.split()[0] if ngram.split() else "")
        q = tokenize(query_text)
        gold_doc = probe["doc"]
        answer = answer_term
        answer_re = re.compile(rf"\b{re.escape(answer)}\b", re.I)

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

        if dense_index is not None:
            # --- dense: semantic only
            dtop = dense_index.top(query_text, k)
            dctx = " ".join(chunks[i]["text"] for i in dtop)
            results["dense"].append(_score(probe, dtop, dctx, answer_re, ngram,
                                          chunks, gold_doc))

            # --- hybrid: BM25 + dense fused with Reciprocal Rank Fusion.
            # RRF rather than a score sum, because BM25 scores and cosine
            # similarities are not on the same scale; ranks can be fused.
            htop = rrf_fuse([child_index.top(q, k), dtop])[:k]
            hctx = " ".join(chunks[i]["text"] for i in htop)
            results["hybrid"].append(_score(probe, htop, hctx, answer_re, ngram,
                                           chunks, gold_doc))

            # --- hybrid_score: the same two retrievers fused by normalised
            # score instead of rank.
            pool = list(set(child_index.top(q, k * 3) + dtop))
            bs = child_index.scores(q)
            cs = dense_index.cosines(query_text)
            st = score_fuse([bs[i] for i in pool], [cs[i] for i in pool], k)
            stop = [pool[i] for i in st]
            sctx = " ".join(chunks[i]["text"] for i in stop)
            results["hybrid_score"].append(_score(probe, stop, sctx, answer_re,
                                                  ngram, chunks, gold_doc))

        if hyde_index is not None:
            # --- hyde: retrieve with a generated hypothetical answer.
            # The literature is specific that HyDE helps *sparse* retrieval
            # substantially and dense retrieval barely at all, and that it
            # underperforms plain hybrid fusion — so it is scored on its own
            # rather than folded in silently.
            hq = hyde_index[probe_index]
            htop = child_index.top(tokenize(hq), k)
            hctx = " ".join(chunks[i]["text"] for i in htop)
            results["hyde"].append(_score(probe, htop, hctx, answer_re, ngram,
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


def generate_questions(docs: list[dict], counter, model: str, limit: int,
                       out_path: Path) -> list[dict]:
    """Write one realistic question per document with the local LLM.

    A cloze probe cannot produce a realistic query: the query is derived
    from the answer's own sentence, so lexical retrieval saturates and
    dense retrieval is handed a bag of keywords rather than a question.
    The published benchmarks use real questions, so this writes them.

    The model is asked for a question *and* the short fact from the source
    that answers it, so the evaluation has a real answer to look for
    rather than a document label alone.

    The question must be answerable only from that document, and must not
    quote the source verbatim — otherwise the probe degenerates back into
    the cloze it was meant to replace.
    """
    import urllib.request

    url = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    questions: list[dict] = []

    # Resume: a long generation run should not start over.
    already: set[str] = set()
    if out_path and out_path.exists():
        try:
            for prior in json.loads(out_path.read_text(encoding="utf-8")):
                if prior.get("doc"):
                    already.add(prior["doc"])
                    questions.append(prior)
        except Exception:
            already = set()
            questions = []
    if already:
        print(f"  Resuming: {len(already)} question(s) already written")

    for d in docs[:limit]:
        if d["name"] in already:
            continue
        # A distinctive, self-contained passage to write a question from.
        sentences = [s for s in re.split(r"(?<=[.!?])\s+|\n{2,}", d["body"])
                     if len(s) >= 60]
        if not sentences:
            continue
        passage = " ".join(sentences[:4])[:1200]

        prompt = (
            "Read this excerpt from a technical article about music and "
            "video production.\n\n"
            f"EXCERPT:\n{passage}\n\n"
            "Write ONE question a practitioner would actually ask that this "
            "excerpt answers. Paraphrase — do not copy the excerpt's wording. "
            'Reply with JSON only: {"question": "...", "fact": "<a short '
            'verbatim phrase from the excerpt that answers the question>"}\n'
        )
        payload = {"model": model, "prompt": prompt, "stream": False,
                   "options": {"temperature": 0.3, "num_predict": 220}}
        try:
            req = urllib.request.Request(
                f"{url}/api/generate",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=300) as r:
                raw = json.loads(r.read()).get("response", "")
        except Exception as exc:  # noqa: BLE001 - a failed generation is skipped
            print(f"  ! {d['name']}: {type(exc).__name__}: {exc}",
                  file=sys.stderr)
            continue

        parsed = _parse_json_object(raw)
        if not parsed:
            continue
        question = (parsed.get("question") or "").strip()
        fact = (parsed.get("fact") or "").strip()
        if not question or not fact:
            continue
        # A fact that is a fragment, an ellipsis or too short cannot be
        # checked for containment meaningfully.
        if len(fact) < 20 or "..." in fact or len(fact.split()) < 3:
            continue
        questions.append({
            "doc": d["name"],
            "title": d["title"],
            "question": question,
            "fact": fact,
            "ngram": fact,
            "answer": fact.split()[0] if fact.split() else fact,
        })

    if out_path:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(questions, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8", newline="\n",
        )
    return questions


def _parse_json_object(raw: str) -> dict | None:
    """Pull a JSON object out of a model reply that may be wrapped in prose
    or a fenced block."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def fact_ceiling(probes, doc_texts) -> tuple[int, int, int]:
    """How findable each answer fact is in its own source document.

    A fact written by a model is a *paraphrase* of the source, not a copy,
    so a literal string match under-reports. This measures the metric's
    ceiling: how many facts are findable in the source at all. The passage
    column is a lower bound, and this is what it is bounded by.

    Returns (literal, paraphrased, unfindable).
    """
    literal = paraphrased = unfindable = 0
    for probe in probes:
        body = _squash(doc_texts.get(probe["doc"], ""))
        fact = _squash(probe.get("ngram") or probe.get("fact") or "")
        if not fact:
            continue
        if fact in body:
            literal += 1
            continue
        words = [w for w in fact.split() if len(w) > 3]
        if words and sum(1 for w in words if w in body) / len(words) >= 0.6:
            paraphrased += 1
        else:
            unfindable += 1
    return literal, paraphrased, unfindable


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
    parser.add_argument("--probe-mode", choices=["specific", "generic", "sentence"],
                        default="specific",
                        help="Query style: distinctive terms (specific), "
                             "plain-words terms (generic), or a full "
                             "natural-language sentence (sentence)")
    parser.add_argument("--json", action="store_true",
                        help="Emit JSON instead of a table")
    parser.add_argument("--sweep", action="store_true",
                        help="Sweep chunk target and k, reporting the "
                             "trade-off between passage recall and context size")
    parser.add_argument("--dense", action="store_true",
                        help="Also score the dense (nomic) and hybrid (RRF) "
                             "retrievers. Needs the local Ollama.")
    parser.add_argument("--enrich", action="store_true",
                        help="Prepend each chunk's heading path to its text "
                             "before indexing (contextual chunk headers)")
    parser.add_argument("--questions", default=None,
                        help="Path to a written question set (JSON). Built "
                             "with --generate-questions.")
    parser.add_argument("--generate-questions", action="store_true",
                        help="Write a question set with the local LLM — one "
                             "realistic question per document — and save it")
    parser.add_argument("--question-model", default="llama3.2:3b",
                        help="LLM used to write the questions")
    parser.add_argument("--hyde", action="store_true",
                        help="Also score HyDE: retrieve with an LLM-written "
                             "hypothetical answer instead of the question")
    parser.add_argument("--contextual", action="store_true",
                        help="Also score contextual retrieval: prepend each "
                             "document's LLM-written summary to its chunks")
    args = parser.parse_args(argv)

    counter = resolve_counter(REPO, None) if resolve_counter else None
    chunks, parents = [], []
    for path in sorted(BASE.glob("*.md")):
        if path.name in ("index.md", "README.md", "_schema.md", "log.md"):
            continue
        c, p, _defects = kb.chunk_document(path, counter, args.target, 0)
        chunks.extend(c)
        parents.extend(p)

    if args.enrich:
        # The chunk's own heading is in its text, but its ancestors are not,
        # and the heading path is metadata no retriever sees. Prefixing it
        # makes the section's subject matchable.
        for c in chunks:
            c["text"] = enrich(c["text"], c.get("heading_path", ""))
        for p in parents:
            p["text"] = enrich(p["text"], p.get("heading_path", ""))

    docs = [kbc.parse_doc(p, counter) for p in sorted(BASE.glob("*.md"))
            if p.name not in ("index.md", "README.md", "_schema.md", "log.md")]

    if args.contextual:
        # Contextual retrieval: an LLM-written summary of each document,
        # prepended to its chunks at index time. The one augmentation the
        # literature finds consistently helpful.
        summaries = {}
        for d in docs:
            summary = document_summary(d["body"], args.question_model, d["title"])
            if summary:
                summaries[d["name"]] = summary
        contextualize(chunks, summaries)
        contextualize(parents, summaries)
        print(f"  Contextual: {len(summaries)} document summary/summaries added")

    if args.generate_questions:
        out = Path(args.questions) if args.questions else (
            REPO / "docs" / "knowledge-library" / "kb-eval-questions.json")
        print(f"  Writing questions with {args.question_model} …")
        written = generate_questions(docs, counter, args.question_model,
                                     args.limit, out)
        print(f"  Wrote {len(written)} question(s) to {out}")
        return 0

    if args.questions:
        written = json.loads(Path(args.questions).read_text(encoding="utf-8"))
        probes = written[: args.limit] if args.limit else written
    else:
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

    dense_index = None
    if args.dense:
        embedder = Embedder()
        dense_index = DenseIndex([c["text"] for c in chunks], embedder)
        print(f"  Dense index: {len(chunks)} chunks embedded "
              f"({embedder.hits} cached, {embedder.misses} computed)")

    hyde_index = None
    if args.hyde:
        hyde_index = []
        for p in probes:
            generated = hyde_query(p.get("query") or p.get("question", ""),
                                    args.question_model)
            hyde_index.append(generated or p.get("query") or "")
        print(f"  HyDE: {len(hyde_index)} hypothetical answer(s) generated")

    results = evaluate(chunks, parents, probes, args.k,
                       doc_texts={d["name"]: d["body"] for d in docs},
                       dense_index=dense_index, hyde_index=hyde_index)

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
    for name in ("child", "parent", "parent_child", "doc", "dense", "hybrid",
                 "hybrid_score", "hyde"):
        if name in results:
            summarize(name, results[name], args.k)

    # The passage column is a lower bound: an LLM-written answer fact is a
    # paraphrase, so a literal match under-reports. Show the ceiling so the
    # number cannot be misread.
    lit, para, unf = fact_ceiling(probes, {d["name"]: d["body"] for d in docs})
    total = lit + para + unf
    if total:
        print(f"\n  passage is a LOWER BOUND — of {total} answer facts, "
              f"{lit} ({lit/total:.0%}) appear verbatim in their source "
              f"document and {para} ({para/total:.0%}) are paraphrases of it; "
              f"{unf} are unfindable.")
    print("\n  child       = index small chunks, return small chunks")
    print("  parent      = index parent sections, return parent sections")
    print("  parent_child= index small chunks, return their parents")
    print("  doc         = index small chunks, return the whole document")
    if "dense" in results:
        print("  dense       = nomic embeddings only, semantic")
        print("  hybrid      = BM25 + dense, fused with Reciprocal Rank Fusion")
        print("  hybrid_score= BM25 + dense, fused by normalised score")
    if "hyde" in results:
        print("  hyde        = BM25 over an LLM-written hypothetical answer")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
